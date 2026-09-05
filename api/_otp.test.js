// 이메일 OTP 서버리스 함수 단위 테스트 (2026-09-05 보안 감사 ⑤ 코드 해시 저장 · ⑥ 오류 문구 위생
// · 가입 개편: 이메일 OTP 는 승무원 회사 메일 전용, purpose 서버 고정).
//
// 핸들러를 가짜 req/res 로 직접 호출한다. @supabase/supabase-js 는 vi.doMock 으로 갈아끼우고
// 외부 발송(Resend)은 fetch 스텁으로 가로챈다 — 네트워크·DB 없이 돈다.
//
// 지키려는 것
//   ⑤ DB 로 나가는 insert 에 6자리 원문(code)이 없고 HMAC 해시(code_hash)만 있어야 한다.
//      해시는 "실제로 메일에 담긴 코드"의 HMAC 이어야 한다.
//   ⑥ 실패 응답 본문에 내부 예외·외부 API 응답 원문이 한 조각도 없어야 한다.
//   ⑦ airline_domains 에 없는 도메인은 발송·검증 모두 403, 조회 실패는 503(둘 다 DB 를 건드리지 않음).
//      검증 RPC 의 p_purpose 는 클라이언트가 무엇을 보내든 'airline_email'.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { extractDomain } from './_airline_domain.js';

const SECRET = 'test-otp-hash-secret-0123456789abcdef';
const hmac = (code) => createHmac('sha256', SECRET).update(String(code), 'utf8').digest('hex');

function mockRes() {
  const res = {
    statusCode: 0, body: null, headers: {}, ended: false,
    status(s) { res.statusCode = s; return res; },
    json(b) { res.body = b; return res; },
    setHeader(k, v) { res.headers[k] = v; },
    end() { res.ended = true; },
  };
  return res;
}

const post = (body) => ({ method: 'POST', headers: {}, body });

/**
 * 가짜 supabase. OTP 핸들러가 실제로 쓰는 모양만 흉내 낸다.
 *  - from('airline_domains').select().eq('domain', d).limit()   → { data: [...] | [], error: domainError }
 *  - from('email_otps').select('id').eq().gte().limit()          → { data: recent }
 *  - from('email_otps').select('id', {count,head}).eq().gte()    → { count: ipCount }
 *  - from('email_otps').insert(row)                              → { error: insertError }
 *  - rpc('otp_hash_secret')                                      → secretRpc
 *  - rpc('verify_otp_and_issue_token', args)                     → { data: rpcResult, error: rpcError }
 */
function fakeSupabase(calls, {
  airlineDomains = ['koreanair.com', 'trinityairways.com'], domainError = null,
  recent = [], ipCount = 0, insertError = null, rpcResult = 'ok', rpcError = null,
  secretRpc = undefined,
} = {}) {
  return {
    from(table) {
      const chain = { _head: false, _eqDomain: null };
      chain.select = (_cols, opts) => { chain._head = Boolean(opts?.head); return chain; };
      chain.eq = (col, val) => { if (table === 'airline_domains' && col === 'domain') chain._eqDomain = val; return chain; };
      chain.gte = () => chain;
      chain.limit = () => chain;
      chain.insert = (row) => { calls.inserts.push({ table, row }); return Promise.resolve({ error: insertError }); };
      chain.then = (resolve) => {
        if (table === 'airline_domains') {
          calls.domainLookups.push(chain._eqDomain);
          if (domainError) return resolve({ data: null, error: domainError });
          const hit = airlineDomains.includes(chain._eqDomain);
          return resolve({ data: hit ? [{ domain: chain._eqDomain, name: '항공사' }] : [], error: null });
        }
        return resolve(chain._head ? { count: ipCount, error: null } : { data: recent, error: null });
      };
      return chain;
    },
    rpc(name, args) {
      calls.rpcs.push({ name, args });
      if (name === 'otp_hash_secret') {
        return Promise.resolve(secretRpc === undefined
          ? { data: null, error: { message: 'function otp_hash_secret does not exist' } }
          : { data: secretRpc, error: null });
      }
      return Promise.resolve({ data: rpcResult, error: rpcError });
    },
  };
}

const newCalls = () => ({ inserts: [], rpcs: [], domainLookups: [] });

async function loadHandler(path, supabase) {
  vi.resetModules();
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => supabase }));
  const mod = await import(path);
  return mod.default;
}

async function loadHandlerThrowing(path, message) {
  vi.resetModules();
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => { throw new Error(message); } }));
  const mod = await import(path);
  return mod.default;
}

const BASE_ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  RESEND_API_KEY: 'resend-key',
  OTP_HASH_SECRET: SECRET,
};

let savedEnv;
beforeEach(() => { savedEnv = { ...process.env }; Object.assign(process.env, BASE_ENV); });
afterEach(() => { process.env = savedEnv; vi.unstubAllGlobals(); vi.doUnmock('@supabase/supabase-js'); vi.resetModules(); });

function stubFetch({ ok = true, status = 200, body = {} } = {}) {
  const fn = vi.fn(async () => ({ ok, status, json: async () => body }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const CREW = 'crew@koreanair.com';

// ============================================================================
describe('도메인 추출(extractDomain)', () => {
  it('소문자·마지막 @ 기준, 이상한 형식은 빈 문자열', () => {
    expect(extractDomain('  Crew@KoreanAir.com ')).toBe('koreanair.com');
    expect(extractDomain('a@b@koreanair.com')).toBe('koreanair.com');
    expect(extractDomain('crew@koreanair.com.')).toBe('');
    expect(extractDomain('crew@koreanair..com')).toBe('');
    expect(extractDomain('crew@-bad.com')).toBe('');
    expect(extractDomain('crew@한글.com')).toBe('');
    expect(extractDomain('nope')).toBe('');
    // 서브도메인은 추출은 되지만 등록돼 있지 않으면 걸러진다(정확 일치)
    expect(extractDomain('x@crew.koreanair.com')).toBe('crew.koreanair.com');
  });
});

// ============================================================================
describe('⑤ OTP 코드는 해시로만 저장된다', () => {
  it('send-email-otp: insert 에 code 원문이 없고 code_hash 가 메일에 담긴 코드의 HMAC 이다', async () => {
    const calls = newCalls();
    const fetchFn = stubFetch({ ok: true, body: { id: 'em_1' } });
    const handler = await loadHandler('./send-email-otp.js', fakeSupabase(calls));
    const res = mockRes();
    await handler(post({ email: CREW }), res);

    expect(res.statusCode).toBe(200);
    expect(calls.inserts).toHaveLength(1);
    const row = calls.inserts[0].row;
    expect(row.code).toBeUndefined();
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    const html = JSON.parse(fetchFn.mock.calls[0][1].body).html;
    // 색상 코드(#334155)도 6자리 숫자라 인증번호 상자(letter-spacing:8px)에서만 뽑는다
    const sent = html.match(/letter-spacing:8px[^>]*>(\d{6})</)[1];
    expect(row.code_hash).toBe(hmac(sent));
  });

  it('verify-email-otp: RPC 에 p_code_hash 를 넘기고 p_purpose 는 무조건 airline_email', async () => {
    const calls = newCalls();
    const handler = await loadHandler('./verify-email-otp.js', fakeSupabase(calls, { rpcResult: 'ok' }));
    const res = mockRes();
    await handler(post({ email: CREW, code: '654321', purpose: 'signup' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.verifyToken).toMatch(/^[0-9a-f]{64}$/);
    const verify = calls.rpcs.find((r) => r.name === 'verify_otp_and_issue_token');
    expect(verify.args.p_code_hash).toBe(hmac('654321'));
    expect(verify.args.p_purpose).toBe('airline_email');
  });

  it('비밀이 env·Vault 어디에도 없으면 두 핸들러 모두 503 으로 닫고 DB 를 건드리지 않는다', async () => {
    for (const [path, body] of [['./send-email-otp.js', { email: CREW }], ['./verify-email-otp.js', { email: CREW, code: '123456' }]]) {
      delete process.env.OTP_HASH_SECRET;
      const calls = newCalls();
      stubFetch();
      const handler = await loadHandler(path, fakeSupabase(calls));
      const res = mockRes();
      await handler(post(body), res);
      expect(res.statusCode, path).toBe(503);
      expect(res.body.code, path).toBe('SERVICE_UNAVAILABLE');
      expect(calls.inserts, path).toHaveLength(0);
      expect(calls.rpcs.filter((r) => r.name !== 'otp_hash_secret'), path).toHaveLength(0);
      process.env.OTP_HASH_SECRET = SECRET;
    }
  });

  it('env 가 없어도 Vault(RPC otp_hash_secret) 비밀로 해시 저장이 된다', async () => {
    delete process.env.OTP_HASH_SECRET;
    const calls = newCalls();
    stubFetch();
    const handler = await loadHandler('./send-email-otp.js', fakeSupabase(calls, { secretRpc: SECRET }));
    const res = mockRes();
    await handler(post({ email: CREW }), res);
    expect(res.statusCode).toBe(200);
    expect(calls.rpcs.filter((r) => r.name === 'otp_hash_secret')).toHaveLength(1);
    expect(calls.inserts[0].row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    process.env.OTP_HASH_SECRET = SECRET;
  });

  it('Vault RPC 가 나중에 실패해도 이 인스턴스가 읽어 둔 비밀을 계속 쓴다(순단 완충)', async () => {
    delete process.env.OTP_HASH_SECRET;
    vi.resetModules();
    const mod = await import('./_otp_hash.js');
    const ok = { rpc: async () => ({ data: SECRET, error: null }) };
    const down = { rpc: async () => ({ data: null, error: { message: 'connection reset' } }) };
    expect(await mod.otpHashSecret(ok)).toBe(SECRET);
    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000;
    try { expect(await mod.otpHashSecret(down)).toBe(SECRET); } finally { Date.now = realNow; }
    mod.resetOtpSecretCache();
    expect(await mod.otpHashSecret(down)).toBe('');
    process.env.OTP_HASH_SECRET = SECRET;
  });
});

// ============================================================================
describe('⑦ 승무원 회사 메일 전용', () => {
  it('등록되지 않은 도메인은 발송·검증 모두 403 이고 DB 에 아무것도 남기지 않는다', async () => {
    for (const [path, body] of [['./send-email-otp.js', { email: 'me@gmail.com' }], ['./verify-email-otp.js', { email: 'me@gmail.com', code: '123456' }]]) {
      const calls = newCalls();
      stubFetch();
      const handler = await loadHandler(path, fakeSupabase(calls));
      const res = mockRes();
      await handler(post(body), res);
      expect(res.statusCode, path).toBe(403);
      expect(res.body.code, path).toBe('AIRLINE_DOMAIN_REQUIRED');
      expect(calls.domainLookups, path).toEqual(['gmail.com']);
      expect(calls.inserts, path).toHaveLength(0);
      expect(calls.rpcs.filter((r) => r.name === 'verify_otp_and_issue_token'), path).toHaveLength(0);
    }
  });

  it('서브도메인·유사 도메인은 정확 일치가 아니라 403', async () => {
    for (const email of ['x@crew.koreanair.com', 'x@evil-koreanair.com', 'x@koreanair.com.attacker.io']) {
      const calls = newCalls();
      stubFetch();
      const handler = await loadHandler('./send-email-otp.js', fakeSupabase(calls));
      const res = mockRes();
      await handler(post({ email }), res);
      expect(res.statusCode, email).toBe(403);
      expect(calls.inserts, email).toHaveLength(0);
    }
  });

  it('도메인 조회가 실패하면 503 (미등록과 구분, 발송 안 함)', async () => {
    const calls = newCalls();
    stubFetch();
    const handler = await loadHandler('./send-email-otp.js', fakeSupabase(calls, { domainError: { message: 'db down' } }));
    const res = mockRes();
    await handler(post({ email: CREW }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.error).not.toContain('db down');
    expect(calls.inserts).toHaveLength(0);
  });

  it('대소문자·공백이 섞인 항공사 주소도 소문자로 정규화해 통과한다', async () => {
    const calls = newCalls();
    stubFetch();
    const handler = await loadHandler('./send-email-otp.js', fakeSupabase(calls));
    const res = mockRes();
    await handler(post({ email: '  Crew@TrinityAirways.com ' }), res);
    expect(res.statusCode).toBe(200);
    expect(calls.domainLookups).toEqual(['trinityairways.com']);
    expect(calls.inserts[0].row.email).toBe('crew@trinityairways.com');
  });
});

// ============================================================================
describe('⑥ 실패 응답에 내부 원문이 새지 않는다', () => {
  it('send-email-otp: Resend 실패 응답 원문을 그대로 내보내지 않는다', async () => {
    const calls = newCalls();
    const leak = 'The resend.dev domain is not verified. Verify your domain at resend.com/domains';
    stubFetch({ ok: false, status: 403, body: { statusCode: 403, message: leak, name: 'validation_error' } });
    const handler = await loadHandler('./send-email-otp.js', fakeSupabase(calls));
    const res = mockRes();
    await handler(post({ email: CREW }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.code).toBe('PROVIDER_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('resend.dev');
    expect(JSON.stringify(res.body)).not.toContain('validation_error');
  });

  it('verify-email-otp: Supabase RPC 오류 원문을 그대로 내보내지 않는다', async () => {
    const calls = newCalls();
    const leak = 'function public.verify_otp_and_issue_token(text, text, text, text, text, text) does not exist';
    const handler = await loadHandler('./verify-email-otp.js', fakeSupabase(calls, { rpcError: { message: leak, code: 'PGRST202' } }));
    const res = mockRes();
    await handler(post({ email: CREW, code: '123456' }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('SERVER_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('PGRST202');
    expect(JSON.stringify(res.body)).not.toContain('does not exist');
  });

  it('두 핸들러 모두: 예기치 못한 예외 메시지를 응답에 싣지 않는다', async () => {
    const leak = 'ECONNREFUSED 10.0.0.7:5432 (internal host)';
    for (const [path, body] of [['./send-email-otp.js', { email: CREW }], ['./verify-email-otp.js', { email: CREW, code: '123456' }]]) {
      stubFetch();
      const handler = await loadHandlerThrowing(path, leak);
      const res = mockRes();
      await handler(post(body), res);
      expect(res.statusCode, path).toBe(500);
      expect(JSON.stringify(res.body), path).not.toContain('10.0.0.7');
      expect(JSON.stringify(res.body), path).not.toContain('ECONNREFUSED');
    }
  });

  it('사용자가 고쳐야 하는 검증 오류는 문구를 그대로 유지한다', async () => {
    const handler = await loadHandler('./verify-email-otp.js', fakeSupabase(newCalls()));
    let res = mockRes();
    await handler(post({ email: 'not-an-email', code: '123456' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('BAD_EMAIL');
    res = mockRes();
    await handler(post({ email: CREW, code: '12' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('BAD_CODE');
  });

  it('만료·불일치는 사유를 구분해 알려주지 않는다(존재 여부 노출 방지)', async () => {
    for (const result of ['not_found', 'mismatch']) {
      const handler = await loadHandler('./verify-email-otp.js', fakeSupabase(newCalls(), { rpcResult: result }));
      const res = mockRes();
      await handler(post({ email: CREW, code: '123456' }), res);
      expect(res.statusCode, result).toBe(400);
      expect(res.body.code, result).toBe('OTP_INVALID');
    }
  });
});

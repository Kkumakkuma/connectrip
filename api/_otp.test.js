// OTP 서버리스 함수 단위 테스트 (2026-09-05 보안 감사 ⑤ 코드 해시 저장 · ⑥ 오류 문구 위생).
//
// 핸들러를 가짜 req/res 로 직접 호출한다. @supabase/supabase-js 는 vi.doMock 으로 갈아끼우고
// 외부 발송(Solapi/Resend)은 fetch 스텁으로 가로챈다 — 네트워크·DB 없이 돈다.
//
// 여기서 지키려는 것 두 가지
//   ⑤ DB 로 나가는 insert 에 6자리 원문(code)이 없고 HMAC 해시(code_hash)만 있어야 한다.
//      해시는 "실제로 사용자에게 발송된 코드"의 HMAC 이어야 한다(문자/메일 본문에서 뽑아 대조).
//   ⑥ 실패 응답 본문에 내부 예외·외부 API 응답 원문이 한 조각도 없어야 한다.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

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
 *  - from(t).select('id').eq().gte().limit()            → { data: recent }
 *  - from(t).select('id', {count,head}).eq().gte()      → { count: ipCount }
 *  - from(t).insert(row)                                → { error: insertError }
 *  - rpc(name, args)                                    → { data: rpcResult, error: rpcError }
 */
function fakeSupabase(calls, {
  recent = [], ipCount = 0, insertError = null, rpcResult = 'ok', rpcError = null,
  secretRpc = undefined, // otp_hash_secret RPC 응답. undefined = RPC 없음(오류), 문자열 = Vault 비밀
} = {}) {
  return {
    from(table) {
      const chain = {
        _head: false,
        select(_cols, opts) { chain._head = Boolean(opts?.head); return chain; },
        eq() { return chain; },
        gte() { return chain; },
        limit() { return chain; },
        insert(row) { calls.inserts.push({ table, row }); return Promise.resolve({ error: insertError }); },
        then(resolve) {
          return resolve(chain._head ? { count: ipCount, error: null } : { data: recent, error: null });
        },
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

/** 핸들러를 supabase 목과 함께 새로 불러온다(모듈 캐시 초기화 필수). */
async function loadHandler(path, supabase) {
  vi.resetModules();
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => supabase }));
  const mod = await import(path);
  return mod.default;
}

/** createClient 자체가 터지는 상황 — catch 블록 문구 위생 검사용. */
async function loadHandlerThrowing(path, message) {
  vi.resetModules();
  vi.doMock('@supabase/supabase-js', () => ({
    createClient: () => { throw new Error(message); },
  }));
  const mod = await import(path);
  return mod.default;
}

const BASE_ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SOLAPI_API_KEY: 'solapi-key',
  SOLAPI_API_SECRET: 'solapi-secret',
  SOLAPI_SENDER_NUMBER: '01000000000',
  RESEND_API_KEY: 'resend-key',
  OTP_HASH_SECRET: SECRET,
};

let savedEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  Object.assign(process.env, BASE_ENV);
});

afterEach(() => {
  process.env = savedEnv;
  vi.unstubAllGlobals();
  vi.doUnmock('@supabase/supabase-js');
  vi.resetModules();
});

function stubFetch({ ok = true, status = 200, body = {} } = {}) {
  const fn = vi.fn(async () => ({ ok, status, json: async () => body }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

// ============================================================================
// ⑤ 코드 해시 저장
// ============================================================================
describe('⑤ OTP 코드는 해시로만 저장된다', () => {
  it('send-otp: insert 에 code 원문이 없고 code_hash 가 발송된 코드의 HMAC 이다', async () => {
    const calls = { inserts: [], rpcs: [] };
    const fetchMock = stubFetch({ ok: true, status: 200, body: { statusCode: '2000' } });
    const handler = await loadHandler('./send-otp.js', fakeSupabase(calls));

    const res = mockRes();
    await handler(post({ phone: '010-1234-5678' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(calls.inserts).toHaveLength(1);

    const row = calls.inserts[0].row;
    expect(calls.inserts[0].table).toBe('phone_otps');
    expect('code' in row).toBe(false);          // 평문 컬럼은 아예 채우지 않는다
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);

    // 실제로 문자로 나간 코드의 HMAC 인지 대조 (발송값과 저장값이 어긋나면 로그인이 통째로 막힌다)
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body).message.text;
    const code = sent.match(/인증번호 (\d{6})/)[1];
    expect(row.code_hash).toBe(hmac(code));
    expect(JSON.stringify(row)).not.toContain(code);
  });

  it('send-email-otp: insert 에 code 원문이 없고 code_hash 가 메일에 담긴 코드의 HMAC 이다', async () => {
    const calls = { inserts: [], rpcs: [] };
    const fetchMock = stubFetch({ ok: true, status: 200, body: { id: 'msg_1' } });
    const handler = await loadHandler('./send-email-otp.js', fakeSupabase(calls));

    const res = mockRes();
    await handler(post({ email: 'User@Example.com' }), res);

    expect(res.statusCode).toBe(200);
    const row = calls.inserts[0].row;
    expect(calls.inserts[0].table).toBe('email_otps');
    expect('code' in row).toBe(false);
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);

    const html = JSON.parse(fetchMock.mock.calls[0][1].body).html;
    const code = html.match(/>(\d{6})</)[1];
    expect(row.code_hash).toBe(hmac(code));
  });

  it('verify-otp: RPC 에 p_code_hash 를 넘긴다(평문 p_code 는 전환기용으로만 함께)', async () => {
    const calls = { inserts: [], rpcs: [] };
    const handler = await loadHandler('./verify-otp.js', fakeSupabase(calls, { rpcResult: 'ok' }));

    const res = mockRes();
    await handler(post({ phone: '01012345678', code: '123456', purpose: 'signup' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.verifyToken).toMatch(/^[0-9a-f]{64}$/);

    expect(calls.rpcs).toHaveLength(1);
    const args = calls.rpcs[0].args;
    expect(calls.rpcs[0].name).toBe('verify_otp_and_issue_token');
    expect(args.p_kind).toBe('phone');
    expect(args.p_code_hash).toBe(hmac('123456'));
    expect(args.p_purpose).toBe('signup');
  });

  it('verify-email-otp: RPC 에 p_code_hash 를 넘긴다', async () => {
    const calls = { inserts: [], rpcs: [] };
    const handler = await loadHandler('./verify-email-otp.js', fakeSupabase(calls, { rpcResult: 'ok' }));

    const res = mockRes();
    await handler(post({ email: 'a@b.com', code: '654321' }), res);

    expect(res.statusCode).toBe(200);
    expect(calls.rpcs[0].args.p_kind).toBe('email');
    expect(calls.rpcs[0].args.p_code_hash).toBe(hmac('654321'));
  });

  it('비밀이 env·Vault 어디에도 없으면 네 핸들러 모두 503 으로 닫고 DB 를 건드리지 않는다', async () => {
    const cases = [
      ['./send-otp.js', { phone: '01012345678' }],
      ['./send-email-otp.js', { email: 'a@b.com' }],
      ['./verify-otp.js', { phone: '01012345678', code: '123456' }],
      ['./verify-email-otp.js', { email: 'a@b.com', code: '123456' }],
    ];
    for (const [path, body] of cases) {
      delete process.env.OTP_HASH_SECRET;
      const calls = { inserts: [], rpcs: [] };
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

  it('env 가 없어도 Vault(RPC otp_hash_secret) 비밀로 해시 저장·검증이 된다', async () => {
    delete process.env.OTP_HASH_SECRET;
    // 발송: code 컬럼 없이 code_hash(64 hex)만 저장
    let calls = { inserts: [], rpcs: [] };
    stubFetch();
    let handler = await loadHandler('./send-otp.js', fakeSupabase(calls, { secretRpc: SECRET }));
    let res = mockRes();
    await handler(post({ phone: '01012345678' }), res);
    expect(res.statusCode).toBe(200);
    expect(calls.rpcs.filter((r) => r.name === 'otp_hash_secret')).toHaveLength(1);
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0].row.code).toBeUndefined();
    expect(calls.inserts[0].row.code_hash).toMatch(/^[0-9a-f]{64}$/);

    // 검증: RPC 에 p_code_hash(64 hex) 가 실린다
    calls = { inserts: [], rpcs: [] };
    handler = await loadHandler('./verify-otp.js', fakeSupabase(calls, { secretRpc: SECRET, rpcResult: 'ok' }));
    res = mockRes();
    await handler(post({ phone: '01012345678', code: '123456' }), res);
    expect(res.statusCode).toBe(200);
    const verify = calls.rpcs.find((r) => r.name === 'verify_otp_and_issue_token');
    expect(verify).toBeTruthy();
    expect(verify.args.p_code_hash).toMatch(/^[0-9a-f]{64}$/);
    process.env.OTP_HASH_SECRET = SECRET;
  });

  it('Vault RPC 가 나중에 실패해도 이 인스턴스가 읽어 둔 비밀을 계속 쓴다(순단 완충)', async () => {
    delete process.env.OTP_HASH_SECRET;
    vi.resetModules();
    const mod = await import('./_otp_hash.js');
    const ok = { rpc: async () => ({ data: SECRET, error: null }) };
    const down = { rpc: async () => ({ data: null, error: { message: 'connection reset' } }) };
    expect(await mod.otpHashSecret(ok)).toBe(SECRET);
    // 캐시 만료를 흉내 내기 위해 시계를 6분 앞으로
    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000;
    try {
      expect(await mod.otpHashSecret(down)).toBe(SECRET);
    } finally {
      Date.now = realNow;
    }
    mod.resetOtpSecretCache();
    expect(await mod.otpHashSecret(down)).toBe('');
    process.env.OTP_HASH_SECRET = SECRET;
  });

  it('Vault RPC 가 실패하면 503 (평문으로 되돌아가지 않는다)', async () => {
    delete process.env.OTP_HASH_SECRET;
    const calls = { inserts: [], rpcs: [] };
    stubFetch();
    const handler = await loadHandler('./send-email-otp.js', fakeSupabase(calls, { secretRpc: undefined }));
    const res = mockRes();
    await handler(post({ email: 'a@b.com' }), res);
    expect(res.statusCode).toBe(503);
    expect(calls.inserts).toHaveLength(0);
    process.env.OTP_HASH_SECRET = SECRET;
  });
});

// ============================================================================
// ⑥ 오류 문구 위생
// ============================================================================
describe('⑥ 실패 응답에 내부 원문이 새지 않는다', () => {
  it('send-otp: Solapi 실패 응답 원문을 그대로 내보내지 않는다', async () => {
    const calls = { inserts: [], rpcs: [] };
    stubFetch({
      ok: false,
      status: 400,
      body: { errorCode: '3059', errorMessage: "발신번호 '01000000000' 이 명의도용방지 부가서비스에 가입" },
    });
    const handler = await loadHandler('./send-otp.js', fakeSupabase(calls));

    const res = mockRes();
    await handler(post({ phone: '01012345678' }), res);

    expect(res.statusCode).toBe(502);
    expect(res.body.code).toBe('PROVIDER_ERROR');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('명의도용방지');
    expect(text).not.toContain('3059');
    expect(text).not.toContain('01000000000');
  });

  it('send-email-otp: Resend 실패 응답 원문을 그대로 내보내지 않는다', async () => {
    const calls = { inserts: [], rpcs: [] };
    stubFetch({
      ok: false,
      status: 403,
      body: { message: 'The connecttrip.co.kr domain is not verified', name: 'validation_error' },
    });
    const handler = await loadHandler('./send-email-otp.js', fakeSupabase(calls));

    const res = mockRes();
    await handler(post({ email: 'a@b.com' }), res);

    expect(res.statusCode).toBe(502);
    expect(res.body.code).toBe('PROVIDER_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('not verified');
  });

  it('verify-otp / verify-email-otp: Supabase RPC 오류 원문을 그대로 내보내지 않는다', async () => {
    const rpcError = { message: 'relation "public.phone_otps" does not exist', code: '42P01', hint: 'check search_path' };
    for (const [path, body] of [
      ['./verify-otp.js', { phone: '01012345678', code: '123456' }],
      ['./verify-email-otp.js', { email: 'a@b.com', code: '123456' }],
    ]) {
      const calls = { inserts: [], rpcs: [] };
      const handler = await loadHandler(path, fakeSupabase(calls, { rpcResult: null, rpcError }));
      const res = mockRes();
      await handler(post(body), res);

      expect(res.statusCode, path).toBe(500);
      expect(res.body.code, path).toBe('SERVER_ERROR');
      const text = JSON.stringify(res.body);
      expect(text, path).not.toContain('relation');
      expect(text, path).not.toContain('42P01');
      expect(text, path).not.toContain('search_path');
    }
  });

  it('네 핸들러 모두: 예기치 못한 예외 메시지를 응답에 싣지 않는다', async () => {
    const leak = 'ECONNREFUSED 10.0.0.7:5432 password=hunter2';
    const cases = [
      ['./send-otp.js', { phone: '01012345678' }],
      ['./send-email-otp.js', { email: 'a@b.com' }],
      ['./verify-otp.js', { phone: '01012345678', code: '123456' }],
      ['./verify-email-otp.js', { email: 'a@b.com', code: '123456' }],
    ];
    for (const [path, body] of cases) {
      stubFetch();
      const handler = await loadHandlerThrowing(path, leak);
      const res = mockRes();
      await handler(post(body), res);

      expect(res.statusCode, path).toBe(500);
      expect(res.body.code, path).toBe('SERVER_ERROR');
      expect(res.body.ok, path).toBe(false);
      expect(JSON.stringify(res.body), path).not.toContain('hunter2');
      expect(JSON.stringify(res.body), path).not.toContain('ECONNREFUSED');
    }
  });

  it('사용자가 고쳐야 하는 검증 오류는 문구를 그대로 유지한다', async () => {
    const calls = { inserts: [], rpcs: [] };
    stubFetch();
    const handler = await loadHandler('./send-otp.js', fakeSupabase(calls));
    const res = mockRes();
    await handler(post({ phone: '0212345678' }), res); // 휴대폰이 아닌 번호

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('BAD_PHONE');
    expect(res.body.error).toContain('휴대폰 번호 형식');
    expect(calls.inserts).toHaveLength(0);
  });

  it('만료·불일치는 사유를 구분해 알려주지 않는다(존재 여부 노출 방지)', async () => {
    for (const result of ['not_found', 'mismatch']) {
      const calls = { inserts: [], rpcs: [] };
      const handler = await loadHandler('./verify-otp.js', fakeSupabase(calls, { rpcResult: result }));
      const res = mockRes();
      await handler(post({ phone: '01012345678', code: '123456' }), res);

      expect(res.statusCode, result).toBe(400);
      expect(res.body.code, result).toBe('OTP_INVALID');
      expect(res.body.error, result).toBe('인증번호가 일치하지 않거나 만료되었습니다.');
    }
  });
});

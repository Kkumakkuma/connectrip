// 본인확인 서버리스 함수 단위 테스트 (2026-10-02 PASS 결속 R1 — 설계 문서/커넥트립_PASS결속_설계_v2_20261002.md §2·§7).
// 파일 이름 앞 밑줄 필수: api/ 아래 밑줄 없는 .js 는 Vercel 서버리스 함수로 배포된다(함수 개수 한도 초과 → 배포 실패).
//
// 핸들러를 가짜 req/res 로 직접 호출한다. @supabase/supabase-js 는 vi.doMock 으로 갈아끼우고(rpc 이름·인자를 기록하는
// 가짜), 포트원 조회는 fetch 스텁으로 가로챈다 — 네트워크·DB 없이 돈다. RPC 와 포트원 조회는 한 기록(calls)에
// 순서대로 쌓아 "결속 확인 → 포트원 → 기록" 순서를 단언한다.
//
// 지키려는 것
//   start  : 용도·dsHash 형식 400, 비밀키 없으면 503, IP 속도 제한(10분 30회 — IP 없으면 건너뛰고 RPC 오류면 통과),
//            id 는 서버 난수(ct + hex 32자)이고 RPC 에는 dsHash 만 간다, 'exists' 면 새 id 로 한 번만 재시도.
//   confirm: ds 없음(앱·웹 문구 구분)·형식 오류는 DB·포트원 0회. 결속 확인 4종 매핑, 확인 실패 시 포트원 fetch 0회
//            (앱 Origin 이라도 면제 없음). RPC 가 오류 없이 null 을 돌려줘도 500.
//            실연동(LIVE) 채널만 발급(VERIFIED 확인 직후 — 채널 없음 502·TEST 403, 로그엔 유형만). 기록은
//            record_identity_verification_bound 로만 — 인자 13개 키가 JSON 직렬화 뒤에도 정확히 일치해야 한다
//            (supabase-js 는 인자를 JSON 으로 보내므로 값이 undefined 인 키는 빠지고, PostgREST 가 함수를 못 찾는다).
//            옛 record_identity_verification 은 0회. customer 는 가입 용도에만. 기존 검증(포트원 응답·결과 필드)은 그대로.
//   공통   : 어떤 경로에서도 ds·CI 원문은 로그에 남지 않는다(run() 이 매번 단언). 모르는 action 은 본문과 상관없이 400.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

const DS = 'a1'.repeat(32);                          // PASS 창을 띄운 페이지가 만든 비밀값(32바이트 hex)
const DS_HASH = sha256(DS);
const ID = `ct${'0123456789abcdef'.repeat(2)}`;      // 서버가 발급한 형식의 id
const CI = `${'Q'.repeat(86)}==`;                    // 88자 base64 모양
const IP = '203.0.113.7';
const SECRET = 'test-portone-secret';
const LIVE_CHANNEL = { type: 'LIVE', id: 'channel-id-live', key: 'channel-key-live-0000', name: 'KCP 본인확인', pgProvider: 'KCP_V2', pgMerchantId: 'PO05N' };
const BOUND_KEYS = [
  'p_provider_ref', 'p_ds_hash', 'p_pg', 'p_name', 'p_birthdate', 'p_gender', 'p_phone',
  'p_operator', 'p_is_foreigner', 'p_ci_hash', 'p_token_hash', 'p_purpose', 'p_ip',
];
const APP_MSG = '커넥트립 앱을 최신 버전으로 업데이트한 뒤 본인확인을 다시 진행해주세요. 업데이트 전에는 웹사이트에서 진행할 수 있습니다.';
const WEB_MSG = '화면을 새로 고친 뒤 본인확인을 다시 진행해주세요.';

const START_FIND = { action: 'start', purpose: 'find_id', dsHash: DS_HASH };
const CONFIRM = (over = {}) => ({ identityVerificationId: ID, purpose: 'find_id', ds: DS, ...over });

function mockRes() {
  const res = {
    statusCode: 0, body: null, headers: {},
    status(s) { res.statusCode = s; return res; },
    json(b) { res.body = b; return res; },
    setHeader(k, v) { res.headers[k] = v; },
    end() {},
  };
  return res;
}
// 기본은 프록시 뒤 IP 가 있는 요청(Vercel 은 x-forwarded-for 첫 값이 클라이언트)
const post = (body, headers = { 'x-forwarded-for': `${IP}, 10.0.0.1` }) => ({ method: 'POST', headers, body });

/**
 * 가짜 supabase — rpc 이름·인자를 calls 에 쌓고 이름별로 정해 둔 값을 돌려준다.
 *  register 는 호출 차례대로 꺼낸다(['exists', 'ok'] = 첫 시도 충돌, 두 번째 성공). 마지막 값은 계속 반복.
 *  계약 밖 RPC(옛 record_identity_verification 포함)는 오류로 답한다 — 정상 경로가 그쪽으로 새면 드러나게.
 */
function fakeSupabase(calls, {
  startHits = 1, startRateError = null,
  hits = 1, rateError = null,
  register = ['ok'], registerError = null,
  check = 'ok', checkError = null,
  bound = 'ok', boundError = null,
} = {}) {
  const queue = [...register];
  const reply = (data, error) => Promise.resolve(error ? { data: null, error } : { data, error: null });
  return {
    rpc(name, args) {
      calls.push({ name, args });
      if (name === 'planner_rate_hit') return reply(startHits, startRateError);
      if (name === 'identity_rate_hit') return reply(hits, rateError);
      if (name === 'identity_start_register') return reply(queue.length > 1 ? queue.shift() : queue[0], registerError);
      if (name === 'identity_start_check') return reply(check, checkError);
      if (name === 'record_identity_verification_bound') return reply(bound, boundError);
      return reply(null, { message: `unexpected rpc ${name}` });
    },
  };
}
const named = (calls, name) => calls.filter((c) => c.name === name);

async function load(supabase) {
  vi.resetModules();
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => supabase }));
  return import('./verify-identity.js');
}

/**
 * 포트원 조회 스텁 — 같은 기록(calls)에 'fetch' 로 남겨 RPC 와의 순서를 단언할 수 있게 한다.
 *  fetchError 를 주면 연결 실패(throw), badJson 이면 본문 파싱 실패를 흉내 낸다.
 */
function stubFetch(calls, body, status = 200, { fetchError = null, badJson = false } = {}) {
  const fn = vi.fn(async (url) => {
    calls.push({ name: 'fetch', args: { url } });
    if (fetchError) throw fetchError;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (badJson) throw new SyntaxError('Unexpected token < in JSON');
        return body;
      },
    };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const verified = (over = {}) => ({
  status: 'VERIFIED',
  id: ID,
  channel: { ...LIVE_CHANNEL },
  verifiedCustomer: { name: '홍길동', birthDate: '1990-01-01', phoneNumber: '010-1234-5678', ci: CI, gender: 'MALE', operator: 'SKT', isForeigner: false },
  verifiedAt: new Date().toISOString(),
  ...over,
});

/** 지금까지 console.error 로 남은 내용 전체(문자열). Error 객체는 JSON 으로 {} 가 되므로 이름·메시지로 풀어 쓴다. */
const loggedText = () => JSON.stringify(errSpy.mock.calls, (_k, v) => (v instanceof Error ? `${v.name}: ${v.message}` : v));

/** 새로 불러온 핸들러로 요청 1건을 돌린다. 어떤 경로든 ds·CI 원문이 로그에 남으면 그 자리에서 실패한다. */
async function run(body, { db = {}, portone = verified(), status = 200, headers, fetchError, badJson } = {}) {
  const calls = [];
  const fetchFn = stubFetch(calls, portone, status, { fetchError, badJson });
  const mod = await load(fakeSupabase(calls, db));
  const res = mockRes();
  await mod.default(headers ? post(body, headers) : post(body), res);
  const logged = loggedText();
  expect(logged, 'ds 원문 로그').not.toContain(DS);
  expect(logged, 'CI 원문 로그').not.toContain(CI);
  return { res, calls, fetchFn };
}

let savedEnv;
let errSpy;
beforeEach(() => {
  savedEnv = { ...process.env };
  Object.assign(process.env, { PORTONE_API_SECRET: SECRET, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sk' });
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); // 의도된 오류 로그는 조용히 — 내용은 단언에 쓴다
});
afterEach(() => {
  process.env = savedEnv;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock('@supabase/supabase-js');
  vi.resetModules();
});

// ============================================================================
describe('start — 서버가 id 를 발급하고 sha256(ds)·용도와 묶는다', () => {
  it('정상: id 는 서버 난수(ct + hex 32자). RPC 에는 dsHash 만 가고, 클라이언트가 보낸 id·ds 원문은 쓰지 않는다', async () => {
    const clientId = `ct${'f'.repeat(32)}`;
    const { res, calls, fetchFn } = await run({ action: 'start', purpose: 'password_reset', dsHash: DS_HASH, ds: DS, identityVerificationId: clientId });
    expect(res.statusCode).toBe(200);
    expect(res.body).toStrictEqual({ ok: true, identityVerificationId: expect.stringMatching(/^ct[0-9a-f]{32}$/) });
    expect(res.body.identityVerificationId).not.toBe(clientId);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(calls.map((c) => c.name)).toEqual(['planner_rate_hit', 'identity_start_register']);
    expect(named(calls, 'planner_rate_hit')[0].args).toStrictEqual({ p_key: `idstart:ip:${IP}`, p_limit: 30 });
    expect(named(calls, 'identity_start_register')[0].args).toStrictEqual({
      p_provider_ref: res.body.identityVerificationId, p_ds_hash: DS_HASH, p_purpose: 'password_reset',
    });
    const sent = JSON.stringify(calls);
    expect(sent).not.toContain(DS);        // ds 원문은 어디에도 가지 않는다
    expect(sent).not.toContain(clientId);  // 클라이언트가 고른 id 는 등록되지 않는다
    expect(fetchFn).not.toHaveBeenCalled(); // start 는 포트원을 부르지 않는다
  });

  it('부를 때마다 새 id — 같은 dsHash 로 두 번 등록해도 id 가 겹치지 않는다', async () => {
    const a = await run(START_FIND);
    const b = await run(START_FIND);
    expect(a.res.statusCode).toBe(200);
    expect(b.res.statusCode).toBe(200);
    expect(a.res.body.identityVerificationId).not.toBe(b.res.body.identityVerificationId);
  });

  it('형식: 용도가 틀리거나 없으면 400 BAD_PURPOSE, dsHash 가 소문자 hex 64자가 아니면 400 BAD_REQUEST — DB·포트원 0회', async () => {
    const cases = [
      [{ action: 'start', purpose: 'admin', dsHash: DS_HASH }, 'BAD_PURPOSE'],
      [{ action: 'start', dsHash: DS_HASH }, 'BAD_PURPOSE'],                         // start 는 용도 기본값 없음
      [{ action: 'start', purpose: 'find_id', dsHash: 'A'.repeat(64) }, 'BAD_REQUEST'], // 대문자
      [{ action: 'start', purpose: 'find_id', dsHash: DS_HASH.slice(1) }, 'BAD_REQUEST'],
      [{ action: 'start', purpose: 'find_id', dsHash: `${DS_HASH.slice(1)}g` }, 'BAD_REQUEST'],
      [{ action: 'start', purpose: 'find_id' }, 'BAD_REQUEST'],
      [{ action: 'start', purpose: 'find_id', dsHash: 12345 }, 'BAD_REQUEST'],
      [{ action: 'start', purpose: 'find_id', dsHash: ` ${DS_HASH}` }, 'BAD_REQUEST'],   // 다듬지 않는다(앞 공백)
      [{ action: 'start', purpose: 'find_id', dsHash: `${DS_HASH}\n` }, 'BAD_REQUEST'],  // 뒤 줄바꿈
      [{ action: 'register', purpose: 'find_id', dsHash: DS_HASH }, 'BAD_REQUEST'],   // 모르는 action
    ];
    for (const [body, code] of cases) {
      const label = JSON.stringify(body);
      const { res, calls, fetchFn } = await run(body);
      expect(res.statusCode, label).toBe(400);
      expect(res.body.code, label).toBe(code);
      expect(calls, label).toHaveLength(0);
      expect(fetchFn, label).not.toHaveBeenCalled();
    }
  });

  it('비밀키가 없으면 503 IDENTITY_DISABLED — 등록하지 않는다', async () => {
    delete process.env.PORTONE_API_SECRET;
    const { res, calls } = await run(START_FIND);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('IDENTITY_DISABLED');
    expect(calls).toHaveLength(0);
  });

  it('속도 제한: 10분 30회를 넘으면 429 + 등록 안 함, 30회째까지는 통과', async () => {
    let r = await run(START_FIND, { db: { startHits: 31 } });
    expect(r.res.statusCode).toBe(429);
    expect(r.res.body.code).toBe('RATE_LIMITED');
    expect(named(r.calls, 'identity_start_register')).toHaveLength(0);

    r = await run(START_FIND, { db: { startHits: 30 } });
    expect(r.res.statusCode).toBe(200);
    expect(named(r.calls, 'identity_start_register')).toHaveLength(1);
  });

  it('속도 제한 기존 관례: IP 가 없으면 건너뛰고, 제한 RPC 가 실패하면 통과시킨다', async () => {
    let r = await run(START_FIND, { headers: {} });
    expect(r.res.statusCode).toBe(200);
    expect(named(r.calls, 'planner_rate_hit')).toHaveLength(0);
    expect(named(r.calls, 'identity_start_register')).toHaveLength(1);

    r = await run(START_FIND, { db: { startRateError: { message: 'rate table down' } } });
    expect(r.res.statusCode).toBe(200);
    expect(named(r.calls, 'identity_start_register')).toHaveLength(1);

    // x-forwarded-for 가 없으면 x-real-ip 로 센다(기존 IP 추출과 같다)
    r = await run(START_FIND, { headers: { 'x-real-ip': IP } });
    expect(r.res.statusCode).toBe(200);
    expect(named(r.calls, 'planner_rate_hit')[0].args).toStrictEqual({ p_key: `idstart:ip:${IP}`, p_limit: 30 });
  });

  it("'exists' 면 새 id 로 한 번만 다시 시도한다 — 두 번 다 충돌이면 500(세 번째 시도 없음)", async () => {
    let r = await run(START_FIND, { db: { register: ['exists', 'ok'] } });
    expect(r.res.statusCode).toBe(200);
    const regs = named(r.calls, 'identity_start_register');
    expect(regs).toHaveLength(2);
    expect(regs[0].args.p_provider_ref).not.toBe(regs[1].args.p_provider_ref);
    expect(regs[1].args.p_provider_ref).toMatch(/^ct[0-9a-f]{32}$/);
    expect(r.res.body.identityVerificationId).toBe(regs[1].args.p_provider_ref);

    r = await run(START_FIND, { db: { register: ['exists', 'exists', 'ok'] } });
    expect(r.res.statusCode).toBe(500);
    expect(r.res.body.code).toBe('SERVER_ERROR');
    expect(named(r.calls, 'identity_start_register')).toHaveLength(2);
  });

  it("'invalid' 는 400 BAD_REQUEST, RPC 오류·모르는 결과는 500(내부 원문 비노출, 오류는 재시도 안 함)", async () => {
    let r = await run(START_FIND, { db: { register: ['invalid'] } });
    expect(r.res.statusCode).toBe(400);
    expect(r.res.body.code).toBe('BAD_REQUEST');

    r = await run(START_FIND, { db: { registerError: { message: 'connection to server at 10.0.0.9 failed' } } });
    expect(r.res.statusCode).toBe(500);
    expect(r.res.body.code).toBe('SERVER_ERROR');
    expect(JSON.stringify(r.res.body)).not.toContain('10.0.0.9');
    expect(named(r.calls, 'identity_start_register')).toHaveLength(1);

    r = await run(START_FIND, { db: { register: ['weird'] } });
    expect(r.res.statusCode).toBe(500);
  });
});

// ============================================================================
describe('confirm — 거절 경로', () => {
  it('ds 없음: 앱 출처면 업데이트 안내, 그 밖은 새로 고침 안내(400 IDENTITY_BINDING_REQUIRED) — DB·포트원 0회', async () => {
    const cases = [
      ['https://localhost', APP_MSG],
      ['capacitor://localhost', APP_MSG],
      ['https://www.connecttrip.co.kr', WEB_MSG],
      [undefined, WEB_MSG],
    ];
    for (const [origin, msg] of cases) {
      const headers = { 'x-forwarded-for': IP, ...(origin ? { origin } : {}) };
      // 옛 앱(1.3.4 이하)·결속 이전 화면이 보내던 본문 그대로: { identityVerificationId, purpose }
      const { res, calls, fetchFn } = await run({ identityVerificationId: ID, purpose: 'find_id' }, { headers });
      expect(res.statusCode, origin).toBe(400);
      expect(res.body, origin).toStrictEqual({ ok: false, code: 'IDENTITY_BINDING_REQUIRED', error: msg });
      expect(calls, origin).toHaveLength(0);
      expect(fetchFn, origin).not.toHaveBeenCalled();
    }
    // 빈 값·공백·null 도 '없음'으로 본다
    for (const ds of ['', '   ', null]) {
      const { res, calls } = await run(CONFIRM({ ds }));
      expect(res.body.code, String(ds)).toBe('IDENTITY_BINDING_REQUIRED');
      expect(res.body.error, String(ds)).toBe(WEB_MSG);
      expect(calls).toHaveLength(0);
    }
  });

  it('ds 형식 오류는 400 BAD_REQUEST(앞뒤 공백도 다듬지 않고 거절) — DB·포트원 0회', async () => {
    for (const ds of ['A1'.repeat(32), DS.slice(2), `${DS.slice(1)}z`, ` ${DS}`, `${DS}\n`, 12345, { v: DS }, [DS]]) {
      const label = JSON.stringify(ds);
      const { res, calls, fetchFn } = await run(CONFIRM({ ds }));
      expect(res.statusCode, label).toBe(400);
      expect(res.body.code, label).toBe('BAD_REQUEST');
      expect(calls, label).toHaveLength(0);
      expect(fetchFn, label).not.toHaveBeenCalled();
    }
  });

  it('용도·id 형식 검사는 기존과 같고 ds 검사보다 먼저 한다', async () => {
    let r = await run(CONFIRM({ purpose: 'admin' }));
    expect(r.res.statusCode).toBe(400);
    expect(r.res.body.code).toBe('BAD_PURPOSE');
    r = await run(CONFIRM({ identityVerificationId: '../../payments' }));
    expect(r.res.body.code).toBe('BAD_REQUEST');
    r = await run({ identityVerificationId: 'bad id', purpose: 'find_id' }); // ds 도 없지만 id 형식 오류가 먼저
    expect(r.res.body.code).toBe('BAD_REQUEST');
    expect(r.calls).toHaveLength(0);
  });

  it('confirm 속도 제한(identity_rate_hit, 10분 10회)을 넘으면 429, 제한 RPC 오류는 500(기존과 같음) — 결속 확인·포트원 0회', async () => {
    let r = await run(CONFIRM(), { db: { hits: 11 } });
    expect(r.res.statusCode).toBe(429);
    expect(r.res.body.code).toBe('RATE_LIMITED');
    expect(named(r.calls, 'identity_rate_hit')[0].args).toStrictEqual({ p_ip: IP, p_limit: 10 });
    expect(named(r.calls, 'identity_start_check')).toHaveLength(0);
    expect(r.fetchFn).not.toHaveBeenCalled();

    r = await run(CONFIRM(), { db: { hits: 10 } }); // 10회째까지는 통과
    expect(r.res.statusCode).toBe(200);

    r = await run(CONFIRM(), { db: { rateError: { message: 'rate table down' } } });
    expect(r.res.statusCode).toBe(500);
    expect(r.res.body.code).toBe('SERVER_ERROR');
    expect(named(r.calls, 'identity_start_check')).toHaveLength(0);
    expect(r.fetchFn).not.toHaveBeenCalled();
  });

  it('결속 확인 4종 매핑 — 확인에서 막히면 포트원 fetch 0회, 기록 RPC 0회', async () => {
    const cases = [
      ['mismatch', 403, 'IDENTITY_BINDING_INVALID'],
      ['purpose', 400, 'IDENTITY_PURPOSE_MISMATCH'],
      ['expired', 400, 'IDENTITY_STALE'],
      ['used', 400, 'IDENTITY_ALREADY_USED'],
    ];
    for (const [check, status, code] of cases) {
      const { res, calls, fetchFn } = await run(CONFIRM(), { db: { check } });
      expect(res.statusCode, check).toBe(status);
      expect(res.body.code, check).toBe(code);
      expect(res.body, check).not.toHaveProperty('verifyToken');
      expect(fetchFn, check).not.toHaveBeenCalled();
      expect(calls.map((c) => c.name), check).toEqual(['identity_rate_hit', 'identity_start_check']);
      expect(named(calls, 'identity_start_check')[0].args, check).toStrictEqual({ p_provider_ref: ID, p_ds_hash: DS_HASH, p_purpose: 'find_id' });
    }
    // 등록 없음과 ds 불일치는 같은 답(mismatch) — 문구까지 고정
    const { res } = await run(CONFIRM(), { db: { check: 'mismatch' } });
    expect(res.body.error).toBe('본인확인 요청 정보가 맞지 않습니다. 본인확인을 다시 진행해주세요.');
  });

  // Origin 은 위조할 수 있는 값이라 ds 없음 안내 문구를 고르는 데만 쓴다 — 앱 출처라고 결속 확인을 건너뛰면 결속 자체가 무너진다.
  it('Origin 은 결속을 면제하지 않는다 — 앱 출처라도 결속 확인 실패면 403, 포트원·기록 0회', async () => {
    for (const origin of ['https://localhost', 'capacitor://localhost']) {
      const { res, calls, fetchFn } = await run(CONFIRM(), { db: { check: 'mismatch' }, headers: { 'x-forwarded-for': IP, origin } });
      expect(res.statusCode, origin).toBe(403);
      expect(res.body.code, origin).toBe('IDENTITY_BINDING_INVALID');
      expect(fetchFn, origin).not.toHaveBeenCalled();
      expect(named(calls, 'record_identity_verification_bound'), origin).toHaveLength(0);
    }
  });

  it('결속 확인 RPC 오류·모르는 결과·오류 없는 null 결과는 500(원문 비노출) — 포트원 fetch 0회', async () => {
    // { check: null } = RPC 가 error 없이 data: null 로 답한 경우(함수가 NULL 을 돌려줄 때) — 'ok' 가 아니므로 통과시키면 안 된다
    for (const db of [{ checkError: { message: 'relation identity_starts does not exist' } }, { check: 'weird' }, { check: 'constructor' }, { check: null }]) {
      const label = JSON.stringify(db);
      const { res, fetchFn } = await run(CONFIRM(), { db });
      expect(res.statusCode, label).toBe(500);
      expect(res.body.code, label).toBe('SERVER_ERROR');
      expect(JSON.stringify(res.body), label).not.toContain('identity_starts');
      expect(fetchFn, label).not.toHaveBeenCalled();
    }
  });

  it('채널 없음은 502 PROVIDER_ERROR, 실연동이 아닌 채널(TEST·모르는 유형)은 403 IDENTITY_CHANNEL_INVALID — 기록 안 함, 로그엔 유형만', async () => {
    let r = await run(CONFIRM(), { portone: verified({ channel: undefined }) });
    expect(r.res.statusCode).toBe(502);
    expect(r.res.body.code).toBe('PROVIDER_ERROR');
    expect(named(r.calls, 'record_identity_verification_bound')).toHaveLength(0);

    for (const type of ['TEST', 'SANDBOX', undefined]) {
      errSpy.mockClear();
      r = await run(CONFIRM(), { portone: verified({ channel: { ...LIVE_CHANNEL, type, key: 'channel-key-test-9999' } }) });
      expect(r.res.statusCode, String(type)).toBe(403);
      expect(r.res.body.code, String(type)).toBe('IDENTITY_CHANNEL_INVALID');
      expect(named(r.calls, 'record_identity_verification_bound'), String(type)).toHaveLength(0);
      const logged = loggedText();
      expect(logged, String(type)).toContain(String(type));
      for (const hidden of ['channel-key-test-9999', 'channel-id-live', 'PO05N', '홍길동', CI, '010-1234-5678']) {
        expect(logged, hidden).not.toContain(hidden);
      }
    }

    // 순서: VERIFIED 확인 "직후"(설계 §2-6). 미완료 결과는 채널과 상관없이 NOT_VERIFIED 이고,
    // 완료 결과는 인증 시각·결과 필드 검증보다 채널을 먼저 본다(테스트 채널 결과는 내용과 상관없이 거절).
    const TEST_CHANNEL = { ...LIVE_CHANNEL, type: 'TEST' };
    r = await run(CONFIRM(), { portone: { status: 'READY', id: ID, channel: TEST_CHANNEL } });
    expect(r.res.statusCode).toBe(400);
    expect(r.res.body.code).toBe('IDENTITY_NOT_VERIFIED');
    r = await run(CONFIRM(), {
      portone: verified({ channel: TEST_CHANNEL, verifiedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), verifiedCustomer: {} }),
    });
    expect(r.res.statusCode).toBe(403);
    expect(r.res.body.code).toBe('IDENTITY_CHANNEL_INVALID');
    r = await run(CONFIRM(), { portone: verified({ channel: undefined, verifiedCustomer: {} }) });
    expect(r.res.statusCode).toBe(502);
    expect(r.res.body.code).toBe('PROVIDER_ERROR');
    expect(r.res.body.error).toBe('본인확인 서비스 응답 오류입니다. 잠시 후 다시 시도해주세요.'); // 재시도 안내(필드 누락 문구 아님)
  });

  it('기록 함수의 결속 거절 3종은 결속 확인과 같은 code, 그 밖의 결과는 기존 매핑 그대로', async () => {
    const cases = [
      ['binding_invalid', 403, 'IDENTITY_BINDING_INVALID'],
      ['binding_purpose', 400, 'IDENTITY_PURPOSE_MISMATCH'],
      ['binding_expired', 400, 'IDENTITY_STALE'],
      ['already_used', 400, 'IDENTITY_ALREADY_USED'],
      ['ci_registered', 409, 'IDENTITY_ALREADY_REGISTERED'],
      ['blocked', 403, 'IDENTITY_BLOCKED'],
    ];
    for (const [bound, status, code] of cases) {
      const { res } = await run(CONFIRM(), { db: { bound } });
      expect(res.statusCode, bound).toBe(status);
      expect(res.body.code, bound).toBe(code);
      expect(res.body, bound).not.toHaveProperty('verifyToken');
    }
    // RPC 오류·표에 없는 결과·오류 없는 null 결과({ bound: null }) 모두 500 — 토큰은 어떤 경우에도 나가지 않는다
    for (const db of [{ boundError: { message: 'permission denied at 10.0.0.9' } }, { bound: 'weird' }, { bound: 'toString' }, { bound: null }]) {
      const label = JSON.stringify(db);
      const { res } = await run(CONFIRM(), { db });
      expect(res.statusCode, label).toBe(500);
      expect(res.body.code, label).toBe('SERVER_ERROR');
      expect(res.body, label).not.toHaveProperty('verifyToken');
      expect(JSON.stringify(res.body), label).not.toContain('10.0.0.9');
    }
  });

  it('기존 검증 그대로(설계 §2-6): 포트원 응답·결과 필드 오류는 예전 code 그대로 — 포트원 1회, 기록 RPC 0회, 토큰 없음', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const under14 = `${new Date().getUTCFullYear() - 10}-01-01`;
    const customer = (over) => verified({ verifiedCustomer: { ...verified().verifiedCustomer, ...over } });
    const cases = [
      ['미완료(READY)', { portone: { status: 'READY', id: ID } }, 400, 'IDENTITY_NOT_VERIFIED'],
      ['실패(FAILED)', { portone: { status: 'FAILED', id: ID } }, 400, 'IDENTITY_NOT_VERIFIED'],
      ['포트원 404', { portone: {}, status: 404 }, 400, 'IDENTITY_NOT_FOUND'],
      ['포트원 401', { portone: {}, status: 401 }, 500, 'SERVER_CONFIG'],
      ['포트원 403', { portone: {}, status: 403 }, 500, 'SERVER_CONFIG'],
      ['포트원 429', { portone: {}, status: 429 }, 429, 'PROVIDER_BUSY'],
      ['포트원 500', { portone: {}, status: 500 }, 502, 'PROVIDER_ERROR'],
      ['포트원 시간 초과', { fetchError: Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }) }, 504, 'PROVIDER_TIMEOUT'],
      ['포트원 연결 실패', { fetchError: new TypeError('fetch failed') }, 504, 'PROVIDER_TIMEOUT'],
      ['응답 파싱 실패', { badJson: true }, 502, 'PROVIDER_ERROR'],
      ['1시간 지난 인증', { portone: verified({ verifiedAt: twoHoursAgo }) }, 400, 'IDENTITY_STALE'],
      ['이름 없음', { portone: customer({ name: '   ' }) }, 502, 'PROVIDER_ERROR'],
      ['CI 형식 이상', { portone: customer({ ci: 'short' }) }, 502, 'PROVIDER_ERROR'],
      ['생년월일 이상', { portone: customer({ birthDate: '1990-02-30' }) }, 502, 'PROVIDER_ERROR'],
      ['휴대폰 없음', { portone: customer({ phoneNumber: '' }) }, 502, 'PHONE_UNAVAILABLE'],
      ['만 14세 미만', { portone: customer({ birthDate: under14 }) }, 400, 'UNDER_14'],
    ];
    for (const [label, opts, status, code] of cases) {
      const { res, calls, fetchFn } = await run(CONFIRM(), opts);
      expect(res.statusCode, label).toBe(status);
      expect(res.body.code, label).toBe(code);
      expect(res.body.ok, label).toBe(false);
      expect(res.body, label).not.toHaveProperty('verifyToken');
      expect(fetchFn, label).toHaveBeenCalledTimes(1);
      expect(named(calls, 'record_identity_verification_bound'), label).toHaveLength(0);
    }
    // 실패(FAILED)와 미완료는 같은 code 에 다른 문구
    const failed = await run(CONFIRM(), { portone: { status: 'FAILED', id: ID } });
    expect(failed.res.body.error).toBe('본인확인에 실패했습니다. 다시 진행해주세요.');
    const ready = await run(CONFIRM(), { portone: { status: 'READY', id: ID } });
    expect(ready.res.body.error).toBe('본인확인이 완료되지 않았습니다. 인증 창에서 인증을 마친 뒤 다시 시도해주세요.');
  });
});

// ============================================================================
describe('confirm — 정상 경로', () => {
  it('가입: 결속 확인 → 포트원 1회 → bound(인자 13개 키 정확 일치, 해시만) → customer 포함. 옛 record_identity_verification 0회', async () => {
    const { res, calls, fetchFn } = await run(CONFIRM({ purpose: 'signup_identity' }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toStrictEqual({
      ok: true,
      verifyToken: expect.stringMatching(/^[0-9a-f]{64}$/),
      customer: { name: '홍길동', birthdate: '1990-01-01', phone: '01012345678' },
    });
    // 결속 확인을 통과한 뒤에만 포트원을 부르고, 기록은 그 뒤 bound 로 한 번
    expect(calls.map((c) => c.name)).toEqual(['identity_rate_hit', 'identity_start_check', 'fetch', 'record_identity_verification_bound']);
    expect(named(calls, 'record_identity_verification')).toHaveLength(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(`https://api.portone.io/identity-verifications/${ID}`);
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe(`PortOne ${SECRET}`);

    const args = named(calls, 'record_identity_verification_bound')[0].args;
    expect(Object.keys(args)).toHaveLength(13);
    expect(Object.keys(args).sort()).toEqual([...BOUND_KEYS].sort());
    // 실제로 나가는 것은 JSON 본문 — 직렬화 뒤에도 13개 키가 그대로여야 PostgREST 가 13인자 함수를 찾는다
    expect(Object.keys(JSON.parse(JSON.stringify(args))).sort()).toEqual([...BOUND_KEYS].sort());
    expect(args).toStrictEqual({
      p_provider_ref: ID,
      p_ds_hash: DS_HASH,
      p_pg: 'KCP_V2',
      p_name: '홍길동',
      p_birthdate: '1990-01-01',
      p_gender: 'MALE',
      p_phone: '01012345678',
      p_operator: 'SKT',
      p_is_foreigner: false,
      p_ci_hash: sha256(CI),
      p_token_hash: sha256(res.body.verifyToken),
      p_purpose: 'signup_identity',
      p_ip: IP,
    });
    // DB 로는 해시만 — ds·CI·토큰 원문이 RPC 인자 어디에도 없다
    const sent = JSON.stringify(calls);
    for (const raw of [DS, CI, res.body.verifyToken]) expect(sent).not.toContain(raw);
    expect(JSON.stringify(res.body)).not.toContain(CI);
  });

  it('비밀번호 찾기·아이디 찾기: 응답은 { ok, verifyToken } 뿐(customer 없음), 확인·기록 모두 그 용도로', async () => {
    for (const purpose of ['password_reset', 'find_id']) {
      const { res, calls } = await run(CONFIRM({ purpose }));
      expect(res.statusCode, purpose).toBe(200);
      expect(res.body, purpose).toStrictEqual({ ok: true, verifyToken: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(res.body, purpose).not.toHaveProperty('customer');
      for (const pii of ['홍길동', '1990-01-01', '01012345678']) expect(JSON.stringify(res.body), purpose).not.toContain(pii);
      expect(named(calls, 'identity_start_check')[0].args.p_purpose, purpose).toBe(purpose);
      const args = named(calls, 'record_identity_verification_bound')[0].args;
      expect(Object.keys(args).sort(), purpose).toEqual([...BOUND_KEYS].sort());
      expect(args.p_purpose, purpose).toBe(purpose);
      expect(args.p_ds_hash, purpose).toBe(DS_HASH);
      expect(named(calls, 'record_identity_verification'), purpose).toHaveLength(0);
    }
  });

  it('IP·선택 필드가 없어도 bound 인자 13개는 null 로 채워져 JSON 직렬화 뒤에도 빠지지 않는다', async () => {
    const portone = verified({
      channel: { type: 'LIVE' },                                                                       // pgProvider 없음
      verifiedCustomer: { name: '홍길동', birthDate: '19900101', phoneNumber: '01012345678', ci: CI }, // 성별·통신사·내외국인 없음
    });
    const { res, calls } = await run(CONFIRM({ purpose: 'password_reset' }), { portone, headers: {} });
    expect(res.statusCode).toBe(200);
    expect(named(calls, 'identity_rate_hit')[0].args).toStrictEqual({ p_ip: null, p_limit: 10 });
    const wire = JSON.parse(JSON.stringify(named(calls, 'record_identity_verification_bound')[0].args));
    expect(Object.keys(wire).sort()).toEqual([...BOUND_KEYS].sort());
    expect(wire).toMatchObject({
      p_pg: null, p_gender: null, p_operator: null, p_is_foreigner: null, p_ip: null,
      p_birthdate: '1990-01-01', p_phone: '01012345678', p_purpose: 'password_reset', p_ds_hash: DS_HASH,
    });
  });

  it("용도 생략은 기존처럼 가입으로 보고, action: 'confirm' 도 같은 흐름이다", async () => {
    let r = await run({ identityVerificationId: ID, ds: DS });
    expect(r.res.statusCode).toBe(200);
    expect(named(r.calls, 'identity_start_check')[0].args.p_purpose).toBe('signup_identity');
    expect(r.res.body).toHaveProperty('customer');

    r = await run({ action: 'confirm', ...CONFIRM() });
    expect(r.res.statusCode).toBe(200);
    expect(r.res.body).toStrictEqual({ ok: true, verifyToken: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });
});

// ============================================================================
describe('공통', () => {
  it('POST 가 아니면 405, 앱 출처 OPTIONS 는 204(CORS) — DB 0회', async () => {
    const calls = [];
    const mod = await load(fakeSupabase(calls));
    let res = mockRes();
    await mod.default({ method: 'GET', headers: {}, body: null }, res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toStrictEqual({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' }); // fail() 관례
    expect(res.headers['Cache-Control']).toBe('no-store');
    res = mockRes();
    await mod.default({ method: 'OPTIONS', headers: { origin: 'https://localhost' } }, res);
    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://localhost');
    expect(calls).toHaveLength(0);
  });

  // start 형식 사례의 모르는 action(start 본문)과 쌍 — confirm 본문을 다 갖춰도 action 이 start·confirm 밖이면 confirm 으로 새지 않는다
  it('모르는 action 은 confirm 본문을 다 갖춰도 400 BAD_REQUEST — DB·포트원 0회', async () => {
    const { res, calls, fetchFn } = await run({ action: 'register', ...CONFIRM() });
    expect(res.statusCode).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('BAD_REQUEST');
    expect(res.body).not.toHaveProperty('verifyToken');
    expect(calls).toHaveLength(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('비밀키가 없으면 start·confirm 모두 503 — 형식 검사보다 먼저 본다(기존 순서), DB·포트원 0회', async () => {
    delete process.env.PORTONE_API_SECRET;
    for (const body of [
      { identityVerificationId: ID, purpose: 'nope' },        // confirm, 용도 오류
      CONFIRM(),                                               // confirm, 정상 본문
      { action: 'start', purpose: 'nope', dsHash: 'x' },      // start, 형식 오류
    ]) {
      const label = JSON.stringify(body);
      const { res, calls, fetchFn } = await run(body);
      expect(res.statusCode, label).toBe(503);
      expect(res.body.code, label).toBe('IDENTITY_DISABLED');
      expect(calls, label).toHaveLength(0);
      expect(fetchFn, label).not.toHaveBeenCalled();
    }
  });

  it('Supabase 환경변수가 없으면 500 SERVER_CONFIG — DB·포트원 0회', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    for (const body of [START_FIND, CONFIRM()]) {
      const { res, calls, fetchFn } = await run(body);
      expect(res.statusCode).toBe(500);
      expect(res.body.code).toBe('SERVER_CONFIG');
      expect(calls).toHaveLength(0);
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  // supabase-js 는 네트워크 실패를 예외가 아니라 { error } 로 돌려준다(postgrest-js, throwOnError 미사용). 예외는 예상 밖
  // 오류뿐이므로 바깥 catch 가 받아 일반 문구로 끝나는지(return await 로 기다리는지)만 본다.
  it('RPC 호출이 예상 밖 예외를 던져도 바깥 catch 가 받아 500 일반 문구로 끝난다 — 원문 비노출', async () => {
    for (const body of [START_FIND, CONFIRM()]) {
      const calls = [];
      stubFetch(calls, verified());
      const mod = await load({ rpc: () => Promise.reject(new Error('socket hang up 10.0.0.9')) });
      const res = mockRes();
      await mod.default(post(body), res);
      expect(res.statusCode).toBe(500);
      expect(res.body).toStrictEqual({ ok: false, code: 'SERVER_ERROR', error: '본인확인 처리 중 오류가 발생했습니다.' });
    }
  });

  it('parseBirth·isUnder14 export 유지', async () => {
    const { parseBirth, isUnder14 } = await load(fakeSupabase([]));
    expect(parseBirth('19900101')).toBe('1990-01-01');
    expect(parseBirth('1990-01-01T00:00:00Z')).toBe('1990-01-01');
    expect(parseBirth('2026-02-31')).toBeNull();
    expect(isUnder14('1990-01-01')).toBe(false);
    expect(isUnder14(`${new Date().getUTCFullYear() - 5}-01-01`)).toBe(true);
    expect(isUnder14('')).toBe(true);
  });
});

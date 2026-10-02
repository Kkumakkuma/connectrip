// @vitest-environment jsdom
// 본인확인 라이브러리(2026-09-27 PASS 복귀 수정 → 2026-10-02 결속 설계 v2 §3.1·§3.2·§7).
// 저장소(시작 기록·증빙 용도·크롬 보관분), 서버 발급 id + ds 결속(start·confirm 본문), 복귀 해석 표 전 행,
// 웹 PC 미리 등록·모바일·앱 시작, attach·C2·C3·C5·R3, /app-identity 주소(v=2·legacy)와 다리 주소.
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativeFlag = vi.hoisted(() => ({ value: false }));
vi.mock('./native', () => ({ isNativeApp: () => nativeFlag.value }));
// 포트원 SDK — 실제 창 대신 호출 인자만 기록한다(기본: REDIRECTION 처럼 undefined)
const sdk = vi.hoisted(() => ({ request: null }));
vi.mock('@portone/browser-sdk/v2', () => ({ requestIdentityVerification: (...a) => sdk.request(...a) }));
// 환경과 상관없이 본인확인을 켠다(IDENTITY_ENABLED 는 모듈을 읽을 때 정해진다)
vi.stubEnv('VITE_PORTONE_STORE_ID', 'store-test');
vi.stubEnv('VITE_PORTONE_CHANNEL_KEY', 'channel-key-test');

const START_KEY = 'pendingIdentityStart';
const PROOF_KEY = 'pendingIdentityProof';
const RESULTS_KEY = 'ctAppIdResults';
const ID = 'ct0123456789abcdef0123456789abcdef';
const ID2 = 'ctfedcba9876543210fedcba9876543210';
const STATE = '0123456789abcdef0123456789abcdef';
const STATE2 = 'fedcba9876543210fedcba9876543210';
const DS = '89abcdef'.repeat(8);
const DS2 = '01234567'.repeat(8);
const MIN = 60 * 1000;
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// 웹 기록(기본) — 앱 기록은 id·ds 를 undefined 로 넘기면 JSON 에서 빠진다
const putStart = (store, over = {}) => store.setItem(START_KEY, JSON.stringify({
  id: ID, state: STATE, purpose: 'find_id', returnPath: '/find-id', ds: DS, savedAt: Date.now(), ...over,
}));
const putApp = (over = {}) => putStart(localStorage, { id: undefined, ds: undefined, ...over });
const rawStart = (store) => JSON.parse(store.getItem(START_KEY) || 'null');

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const verifiedBody = { ok: true, verifyToken: 'tok', customer: { name: '가', birthdate: '2000-01-01', phone: '01000000000' } };
// fetch 를 본문 기준으로 흉내 낸다 — route(body, n) → 응답. calls 에 { url, body } 를 쌓는다.
function stubFetch(route) {
  const calls = [];
  const fn = vi.fn(async (url, init) => {
    const body = JSON.parse(init?.body || '{}');
    calls.push({ url, body });
    return route(body, calls.length);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}
const startOk = (...ids) => (body, n) => res(200, { ok: true, identityVerificationId: ids[Math.min(n, ids.length) - 1] });

let m;
beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  nativeFlag.value = false;
  sdk.request = vi.fn(async () => undefined);
  // 모듈 상태(확인 캐시·미리 등록분·진행 중 준비)가 테스트끼리 섞이지 않게 매번 새로 읽는다
  vi.resetModules();
  m = await import('./identity');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); };

describe('시작 기록 저장소', () => {
  it('웹은 sessionStorage, 앱은 localStorage 의 기록만 본다 — { id, ds, state, purpose, returnPath, savedAt }', () => {
    putStart(sessionStorage);
    expect(m.loadPendingIdentity()).toMatchObject({ id: ID, ds: DS, state: STATE, purpose: 'find_id', returnPath: '/find-id' });
    nativeFlag.value = true;
    expect(m.loadPendingIdentity()).toBeNull();          // 앱은 세션 기록을 보지 않는다
    putApp();
    expect(m.loadPendingIdentity()).toMatchObject({ id: '', ds: '', state: STATE, purpose: 'find_id', returnPath: '/find-id' });
  });
  it('1시간이 지난 기록은 없는 것으로 보고 지운다(codex #10)', () => {
    nativeFlag.value = true;
    putApp({ savedAt: Date.now() - 61 * MIN });
    expect(m.loadPendingIdentity()).toBeNull();
    expect(localStorage.getItem(START_KEY)).toBeNull();
  });
  it.each([
    ['state 형식', { state: 'st1' }],
    ['용도', { purpose: 'admin' }],
    ['웹 기록에 ds 없음(결속 이전 기록)', { ds: undefined }],
    ['id 형식', { id: 'ct123' }],
    ['ds 형식', { ds: 'abc' }],
    ['savedAt 없음', { savedAt: undefined }],
    ['returnPath 가 문자열이 아님', { returnPath: 3 }],
  ])('형식 오류 기록(%s)은 지운다', (_, over) => {
    putStart(sessionStorage, over);
    expect(m.loadPendingIdentity()).toBeNull();
    expect(sessionStorage.getItem(START_KEY)).toBeNull();
  });
  it('앱 기록: id·ds 는 함께 있거나 함께 없다 — 한쪽만 있으면 형식 오류', () => {
    nativeFlag.value = true;
    putApp({ id: ID });
    expect(m.loadPendingIdentity()).toBeNull();
    expect(localStorage.getItem(START_KEY)).toBeNull();
    putApp({ id: ID, ds: DS });
    expect(m.loadPendingIdentity()).toMatchObject({ id: ID, ds: DS });
  });
  it('깨진 값·배열도 지운다', () => {
    sessionStorage.setItem(START_KEY, '{broken');
    expect(m.loadPendingIdentity()).toBeNull();
    expect(sessionStorage.getItem(START_KEY)).toBeNull();
    sessionStorage.setItem(START_KEY, '[]');
    expect(m.loadPendingIdentity()).toBeNull();
    expect(sessionStorage.getItem(START_KEY)).toBeNull();
  });
  it('clearIdentityProof 는 두 저장소의 시작 기록을 모두 지운다', () => {
    nativeFlag.value = true;
    putApp();
    putStart(sessionStorage);
    m.clearIdentityProof();
    expect(localStorage.getItem(START_KEY)).toBeNull();
    expect(sessionStorage.getItem(START_KEY)).toBeNull();
  });
});

describe('증빙 용도 필터(codex #8·flows1)', () => {
  const putProof = (over = {}) => sessionStorage.setItem(PROOF_KEY, JSON.stringify({
    token: 't', name: '가', birthdate: '2000-01-01', phone: '010', purpose: 'signup_identity', savedAt: Date.now(), ...over,
  }));
  it('가입 화면(기본 용도)은 가입 증빙만 받는다', () => {
    putProof();
    expect(m.loadIdentityProof()?.token).toBe('t');
  });
  it.each([['다른 용도', { purpose: 'password_reset' }], ['용도 없음(옛 증빙)', { purpose: undefined }]])(
    '%s 증빙은 지우고 null',
    (_, over) => {
      putProof(over);
      expect(m.loadIdentityProof()).toBeNull();
      expect(sessionStorage.getItem(PROOF_KEY)).toBeNull();
    },
  );
  it('용도를 주면 그 용도의 증빙만', () => {
    putProof({ purpose: 'find_id' });
    expect(m.loadIdentityProof('find_id')?.token).toBe('t');
  });
  it('1시간이 지났거나 깨진 증빙은 지운다', () => {
    putProof({ savedAt: Date.now() - 61 * MIN });
    expect(m.loadIdentityProof()).toBeNull();
    sessionStorage.setItem(PROOF_KEY, '{broken');
    expect(m.loadIdentityProof()).toBeNull();
    expect(sessionStorage.getItem(PROOF_KEY)).toBeNull();
  });
});

describe('parseIdentityReturn — 설계 v2 §3.2 표', () => {
  const RESTART = '본인확인 정보를 확인할 수 없습니다. 본인확인을 다시 시작해주세요.';
  const ok = (over = {}) => `?flow=identity&state=${STATE}&identityVerificationId=${ID}${over.ds ? `&ds=${over.ds}` : ''}`;

  it('flow≠identity → null', () => {
    expect(m.parseIdentityReturn('?flow=other')).toBeNull();
    expect(m.parseIdentityReturn('')).toBeNull();
  });

  describe('resume=1(앱 안 재개 전용)', () => {
    it('웹은 받지 않는다(C3) — 기록이 있어도 다시 시작', () => {
      putStart(sessionStorage);
      expect(m.parseIdentityReturn('?flow=identity&resume=1')).toEqual({
        ok: false, failed: false, state: STATE, purpose: 'find_id', message: RESTART,
      });
    });
    it('앱, 기록에 id·ds → ok(우리 저장소 값만 — 주소의 id·ds·state 는 무시)', () => {
      nativeFlag.value = true;
      putApp({ id: ID, ds: DS });
      expect(m.parseIdentityReturn(`?flow=identity&resume=1&identityVerificationId=${ID2}&ds=${DS2}&state=${STATE2}`)).toEqual({
        ok: true, id: ID, ds: DS, state: STATE, purpose: 'find_id', resume: true,
      });
    });
    it('앱, 기록만 있음(결과를 아직 못 받음) → needResult + 가져오기 안내', () => {
      nativeFlag.value = true;
      putApp();
      expect(m.parseIdentityReturn('?flow=identity&resume=1')).toEqual({
        ok: false, failed: false, needResult: true, state: STATE, purpose: 'find_id', message: m.IDENTITY_NEED_RESULT_MSG,
      });
    });
    it('앱, 기록 없음 → 다시 시작', () => {
      nativeFlag.value = true;
      expect(m.parseIdentityReturn('?flow=identity&resume=1')).toEqual({
        ok: false, failed: false, state: '', purpose: '', message: RESTART,
      });
    });
  });

  describe('code(실패·취소) — C2: 같은 시도일 때만 failed', () => {
    it('같은 state 의 실패 복귀는 메시지와 함께 failed', () => {
      putStart(sessionStorage);
      expect(m.parseIdentityReturn(`?flow=identity&state=${STATE}&code=FAILURE&message=%EC%B7%A8%EC%86%8C`))
        .toEqual({ ok: false, failed: true, state: STATE, purpose: 'find_id', message: '취소' });
    });
    it('state 가 다르거나 없거나, 기록이 없으면 기록을 끝내지 않는다(위조·옛 링크)', () => {
      putStart(sessionStorage);
      expect(m.parseIdentityReturn(`?flow=identity&code=F&identityVerificationId=${ID}`).failed).toBe(false);
      expect(m.parseIdentityReturn(`?flow=identity&code=F&state=${STATE2}&identityVerificationId=${ID}`).failed).toBe(false);
      sessionStorage.clear();
      expect(m.parseIdentityReturn(`?flow=identity&code=F&state=${STATE}`).failed).toBe(false);
    });
    it('id 가 함께 오면 같은 id 일 때만 — 앱 기록에 아직 id 가 없으면 state 만으로', () => {
      putStart(sessionStorage);
      expect(m.parseIdentityReturn(`?flow=identity&code=F&state=${STATE}&identityVerificationId=${ID}`).failed).toBe(true);
      expect(m.parseIdentityReturn(`?flow=identity&code=F&state=${STATE}&identityVerificationId=${ID2}`).failed).toBe(false);
      nativeFlag.value = true;
      putApp();
      expect(m.parseIdentityReturn(`?flow=identity&code=F&state=${STATE}&identityVerificationId=${ID2}`).failed).toBe(true);
    });
    it('메시지: message → pgMessage → 기본 문구', () => {
      expect(m.parseIdentityReturn('?flow=identity&code=F&pgMessage=PG').message).toBe('PG');
      expect(m.parseIdentityReturn('?flow=identity&code=F').message).toBe('본인확인이 취소되었거나 실패했습니다. 다시 시도해주세요.');
    });
  });

  describe('성공 복귀', () => {
    it('state 불일치·기록 없음 → 다시 시작', () => {
      putStart(sessionStorage);
      expect(m.parseIdentityReturn(`?flow=identity&state=${STATE2}&identityVerificationId=${ID}`)).toEqual({
        ok: false, failed: false, state: STATE2, purpose: 'find_id', message: RESTART,
      });
      sessionStorage.clear();
      expect(m.parseIdentityReturn(ok())).toEqual({ ok: false, failed: false, state: STATE, purpose: '', message: RESTART });
    });
    it('웹: id 가 기록과 같고 기록에 ds 가 있어야 ok — ds 는 기록에서(주소의 ds 는 보지 않는다)', () => {
      putStart(sessionStorage);
      expect(m.parseIdentityReturn(ok({ ds: DS2 }))).toEqual({ ok: true, id: ID, ds: DS, state: STATE, purpose: 'find_id' });
      expect(m.parseIdentityReturn(`?flow=identity&state=${STATE}&identityVerificationId=${ID2}`).ok).toBe(false);
      expect(m.parseIdentityReturn(`?flow=identity&state=${STATE}`).ok).toBe(false);
    });
    it('앱: 기록에 id 가 없으면 주소의 id(형식 검사)와 다리가 붙인 ds 로 ok', () => {
      nativeFlag.value = true;
      putApp();
      expect(m.parseIdentityReturn(ok({ ds: DS }))).toEqual({ ok: true, id: ID, ds: DS, state: STATE, purpose: 'find_id' });
      expect(m.parseIdentityReturn(`?flow=identity&state=${STATE}&identityVerificationId=ct123&ds=${DS}`).ok).toBe(false);
    });
    it('앱: 기록에 id 가 있으면 같아야 하고, 주소에 ds 가 없으면 같은 id 의 기록 ds', () => {
      nativeFlag.value = true;
      putApp({ id: ID, ds: DS });
      expect(m.parseIdentityReturn(ok())).toEqual({ ok: true, id: ID, ds: DS, state: STATE, purpose: 'find_id' });
      expect(m.parseIdentityReturn(ok({ ds: DS2 })).ds).toBe(DS2);   // 주소 ds 가 우선(서버가 맞는지 가린다)
      expect(m.parseIdentityReturn(`?flow=identity&state=${STATE}&identityVerificationId=${ID2}&ds=${DS}`)).toMatchObject({
        ok: false, failed: false, message: RESTART,
      });
    });
    it('앱: ds 가 없거나 형식이 틀리면 needResult(가져오기)', () => {
      nativeFlag.value = true;
      putApp();
      const r = m.parseIdentityReturn(ok({ ds: 'zz' }));
      expect(r).toMatchObject({ ok: false, failed: false, needResult: true, state: STATE, purpose: 'find_id' });
      expect(r.message).toContain('인증 결과 가져오기');
      expect(m.parseIdentityReturn(ok()).needResult).toBe(true);
    });
  });

  it('저장소를 읽기만 한다 — 두 번 불러도 같은 결과, 만료 기록도 지우지 않는다(agy v2)', () => {
    nativeFlag.value = true;
    putApp();
    const before = localStorage.getItem(START_KEY);
    const a = m.parseIdentityReturn(ok({ ds: DS }));
    const b = m.parseIdentityReturn(ok({ ds: DS }));
    expect(b).toEqual(a);
    expect(localStorage.getItem(START_KEY)).toBe(before);
    putApp({ savedAt: Date.now() - 61 * MIN });
    expect(m.parseIdentityReturn(ok({ ds: DS })).ok).toBe(false);
    expect(localStorage.getItem(START_KEY)).not.toBeNull();
  });

  it('stripIdentityParams 는 ds·resume 까지 지우고 우리 쿼리는 남긴다', () => {
    expect(m.stripIdentityParams(`?type=crew&flow=identity&resume=1&state=x&ds=${DS}`)).toBe('?type=crew');
    expect(m.stripIdentityParams(`?ds=${DS}`)).toBe('');
    expect(m.IDENTITY_RETURN_PARAMS).toContain('ds');
  });
});

describe('attachStartDs(앱)', () => {
  beforeEach(() => { nativeFlag.value = true; });
  it('같은 state 의 기록에 id·ds 를 붙인다 → resume 재개가 그 값을 쓴다', () => {
    putApp();
    expect(m.attachStartDs(ID, DS, STATE)).toBe(true);
    expect(rawStart(localStorage)).toMatchObject({ id: ID, ds: DS, state: STATE, purpose: 'find_id', returnPath: '/find-id' });
    expect(m.parseIdentityReturn('?flow=identity&resume=1')).toMatchObject({ ok: true, id: ID, ds: DS, resume: true });
  });
  it('다른 state·형식 오류·기록 없음이면 붙이지 않는다', () => {
    putApp();
    expect(m.attachStartDs(ID, DS, STATE2)).toBe(false);
    expect(m.attachStartDs('ct123', DS, STATE)).toBe(false);
    expect(m.attachStartDs(ID, 'abc', STATE)).toBe(false);
    expect(rawStart(localStorage).id).toBeUndefined();
    localStorage.clear();
    expect(m.attachStartDs(ID, DS, STATE)).toBe(false);
  });
  it('이미 붙은 기록은 바꾸지 않는다(먼저 받은 값을 지킨다) — 같은 id 면 true', () => {
    putApp({ id: ID, ds: DS });
    expect(m.attachStartDs(ID, DS2, STATE)).toBe(true);
    expect(m.attachStartDs(ID2, DS2, STATE)).toBe(false);
    expect(rawStart(localStorage)).toMatchObject({ id: ID, ds: DS });
  });
});

describe('confirmIdentity — 본문 ds, 같은 id·용도는 서버에 한 번만', () => {
  it('본문은 { identityVerificationId, purpose, ds } — ds 1회', async () => {
    const { calls } = stubFetch(() => res(200, verifiedBody));
    await m.confirmIdentity(ID, 'find_id', DS);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/verify-identity');
    expect(calls[0].body).toEqual({ identityVerificationId: ID, purpose: 'find_id', ds: DS });
  });
  it('동시에 여러 번 불러도 요청은 1번, 같은 증빙', async () => {
    const { fn } = stubFetch(() => res(200, verifiedBody));
    const [a, b] = await Promise.all([
      m.confirmIdentity(ID, m.IDENTITY_PURPOSE_PASSWORD_RESET, DS),
      m.confirmIdentity(ID, m.IDENTITY_PURPOSE_PASSWORD_RESET, DS),
    ]);
    const c = await m.confirmIdentity(ID, m.IDENTITY_PURPOSE_PASSWORD_RESET, DS);   // 성공 뒤 다시 불러도 같은 결과
    expect(fn).toHaveBeenCalledTimes(1);
    expect(a.token).toBe('tok');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
  it('실패하면 다시 물을 수 있다(아직 인증 전 → 나중에 성공)', async () => {
    const { fn } = stubFetch((body, n) => (n === 1
      ? res(400, { ok: false, code: 'IDENTITY_NOT_VERIFIED', error: '아직' })
      : res(200, verifiedBody)));
    await expect(m.confirmIdentity(ID, 'find_id', DS)).rejects.toMatchObject({ code: 'IDENTITY_NOT_VERIFIED', status: 400, final: false });
    const proof = await m.confirmIdentity(ID, 'find_id', DS);
    expect(proof.token).toBe('tok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('성공: 증빙에 용도를 넣어 저장하고, 같은 id 의 시작 기록을 지운다', async () => {
    nativeFlag.value = true;
    putApp({ id: ID, ds: DS });
    stubFetch(() => res(200, verifiedBody));
    const proof = await m.confirmIdentity(ID, 'find_id', DS);
    expect(proof).toMatchObject({ token: 'tok', purpose: 'find_id' });
    expect(JSON.parse(sessionStorage.getItem(PROOF_KEY))).toMatchObject({ token: 'tok', purpose: 'find_id' });
    expect(localStorage.getItem(START_KEY)).toBeNull();
  });
  it('C5: 늦게 끝난 앞 시도(A)의 성공은 새 시도(B)의 기록을 지우지 않는다', async () => {
    putStart(sessionStorage, { id: ID2, ds: DS2, state: STATE2 });   // B 진행 중
    stubFetch(() => res(200, verifiedBody));
    await m.confirmIdentity(ID, 'find_id', DS);                       // A 의 확인이 이제 끝남
    expect(rawStart(sessionStorage)).toMatchObject({ id: ID2, state: STATE2 });
  });
  it('R3: 최종 거절은 같은 id·같은 ds 일 때만 기록을 지운다', async () => {
    stubFetch(() => res(403, { ok: false, code: 'IDENTITY_BINDING_INVALID', error: '본인확인 요청 정보가 맞지 않습니다.' }));
    putStart(sessionStorage);
    await expect(m.confirmIdentity(ID, 'find_id', DS2)).rejects.toMatchObject({ code: 'IDENTITY_BINDING_INVALID', status: 403, final: true });
    expect(sessionStorage.getItem(START_KEY)).not.toBeNull();          // 다른 ds(위조)의 거절 — 진짜 기록 유지
    await expect(m.confirmIdentity(ID2, 'find_id', DS)).rejects.toMatchObject({ final: true });
    expect(sessionStorage.getItem(START_KEY)).not.toBeNull();          // 다른 id
    await expect(m.confirmIdentity(ID, 'find_id', DS)).rejects.toMatchObject({ final: true });
    expect(sessionStorage.getItem(START_KEY)).toBeNull();              // 같은 id·ds
  });
  it.each([
    'IDENTITY_ALREADY_USED', 'IDENTITY_ALREADY_REGISTERED', 'PHONE_ALREADY_CLAIMED', 'IDENTITY_BLOCKED', 'UNDER_14',
    'IDENTITY_STALE', 'IDENTITY_BINDING_INVALID', 'IDENTITY_BINDING_REQUIRED', 'IDENTITY_PURPOSE_MISMATCH',
    'IDENTITY_CHANNEL_INVALID', 'PHONE_UNAVAILABLE', 'BAD_REQUEST', 'BAD_PURPOSE',
  ])('R3 최종 코드 %s → final, 기록 삭제', async (code) => {
    putStart(sessionStorage);
    stubFetch(() => res(400, { ok: false, code, error: 'x' }));
    await expect(m.confirmIdentity(ID, 'find_id', DS)).rejects.toMatchObject({ code, final: true });
    expect(sessionStorage.getItem(START_KEY)).toBeNull();
  });
  it.each([
    ['IDENTITY_NOT_VERIFIED', 400], ['IDENTITY_NOT_FOUND', 400], ['RATE_LIMITED', 429], ['PROVIDER_ERROR', 502],
    ['PROVIDER_TIMEOUT', 504], ['SERVER_ERROR', 500], ['', 500],
  ])('재시도 코드 %s(%i) → final 아님, 기록 유지', async (code, status) => {
    putStart(sessionStorage);
    stubFetch(() => res(status, code ? { ok: false, code, error: 'x' } : null));
    await expect(m.confirmIdentity(ID, 'find_id', DS)).rejects.toMatchObject({ code, status, final: false });
    expect(sessionStorage.getItem(START_KEY)).not.toBeNull();
  });
  it('네트워크 오류 → NETWORK_ERROR(final 아님), 기록 유지', async () => {
    putStart(sessionStorage);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(m.confirmIdentity(ID, 'find_id', DS)).rejects.toMatchObject({ code: 'NETWORK_ERROR', final: false });
    expect(sessionStorage.getItem(START_KEY)).not.toBeNull();
  });
});

describe('서버 등록 registerIdentityStart', () => {
  it('본문 { action:start, purpose, dsHash } — ds 원문은 보내지 않는다, dsHash = sha256(ds)', async () => {
    const { calls } = stubFetch(startOk(ID));
    expect(await m.registerIdentityStart({ purpose: 'find_id', ds: DS })).toBe(ID);
    expect(calls[0].body).toEqual({ action: 'start', purpose: 'find_id', dsHash: sha256(DS) });
    expect(JSON.stringify(calls[0].body)).not.toContain(DS);
  });
  it.each([
    ['429', () => res(429, { ok: false, code: 'RATE_LIMITED', error: '많음' }), 'RATE_LIMITED', 429],
    ['503', () => res(503, { ok: false, code: 'IDENTITY_DISABLED', error: '준비 중' }), 'IDENTITY_DISABLED', 503],
    ['본문 없는 500', () => res(500, null), 'IDENTITY_START_FAILED', 500],
    ['id 형식 오류', () => res(200, { ok: true, identityVerificationId: 'ct123' }), 'IDENTITY_START_FAILED', 200],
  ])('실패(%s) → Error(code, status)', async (_, route, code, status) => {
    stubFetch(route);
    await expect(m.registerIdentityStart({ purpose: 'find_id', ds: DS })).rejects.toMatchObject({ code, status });
  });
  it('네트워크 오류 → NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(m.registerIdentityStart({ purpose: 'find_id', ds: DS })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('웹 시작 — PC 미리 등록·모바일 REDIRECTION', () => {
  const pcResponse = (id) => async () => ({ transactionType: 'IDENTITY_VERIFICATION', identityVerificationId: id, identityVerificationTxId: 'tx' });

  it('PC: 미리 등록 → 클릭 → SDK(서버 id, ds 없는 redirectUrl) → { id, ds }, 시작 기록 유지', async () => {
    const { calls } = stubFetch(startOk(ID));
    sdk.request = vi.fn(pcResponse(ID));
    m.prepareWebIdentity('find_id');
    await flush();
    expect(calls).toHaveLength(1);                           // 화면을 열 때 등록
    const r = await m.startIdentityVerification({ returnPath: '/find-id?x=1', purpose: 'find_id' });
    expect(calls).toHaveLength(1);                           // 클릭 뒤 왕복 없음(미리 등록분 인수)
    expect(r.id).toBe(ID);
    expect(r.ds).toMatch(/^[0-9a-f]{64}$/);
    expect(calls[0].body.dsHash).toBe(sha256(r.ds));
    expect(sdk.request).toHaveBeenCalledTimes(1);
    const req = sdk.request.mock.calls[0][0];
    expect(req).toMatchObject({ storeId: 'store-test', channelKey: 'channel-key-test', identityVerificationId: ID });
    expect(req.windowType).toBeUndefined();
    const u = new URL(req.redirectUrl);
    expect(u.pathname).toBe('/find-id');
    expect(u.searchParams.get('x')).toBe('1');
    expect(u.searchParams.get('flow')).toBe('identity');
    expect(u.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/);
    expect(req.redirectUrl).not.toContain(r.ds);
    expect(u.searchParams.has('ds')).toBe(false);
    expect(rawStart(sessionStorage)).toMatchObject({
      id: ID, ds: r.ds, state: u.searchParams.get('state'), purpose: 'find_id', returnPath: '/find-id?x=1',
    });
    await flush();
    expect(calls).toHaveLength(1);                           // 성공한 창 뒤에는 다음 것을 미리 등록하지 않는다
  });
  it('PC: 미리 등록이 없으면 클릭 때 등록(SDK import 와 함께)', async () => {
    const { calls } = stubFetch(startOk(ID));
    sdk.request = vi.fn(pcResponse(ID));
    const r = await m.startIdentityVerification({ returnPath: '/find-id', purpose: 'find_id' });
    expect(calls).toHaveLength(1);
    expect(r.id).toBe(ID);
  });
  it('PC: 미리 등록분이 30분 넘었으면 버리고 새로 등록한다(codex v2 #4)', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { calls } = stubFetch(startOk(ID, ID2));
    sdk.request = vi.fn(pcResponse(ID2));
    m.prepareWebIdentity('find_id');
    await flush();
    now += 31 * MIN;
    const r = await m.startIdentityVerification({ returnPath: '/find-id', purpose: 'find_id' });
    expect(calls).toHaveLength(2);
    expect(r.id).toBe(ID2);
    expect(sdk.request.mock.calls[0][0].identityVerificationId).toBe(ID2);
  });
  it('PC: 미리 등록이 실패했으면 클릭 때 새로 등록한다', async () => {
    const { calls } = stubFetch((body, n) => (n === 1 ? res(503, { ok: false, code: 'IDENTITY_DISABLED' }) : res(200, { ok: true, identityVerificationId: ID })));
    sdk.request = vi.fn(pcResponse(ID));
    m.prepareWebIdentity('find_id');
    await flush();
    const r = await m.startIdentityVerification({ returnPath: '/find-id', purpose: 'find_id' });
    expect(calls).toHaveLength(2);
    expect(r.id).toBe(ID);
  });
  it('PC: 미리 등록은 용도마다 한 번(30분 안 다시 불러도 요청 없음)', async () => {
    const { calls } = stubFetch(startOk(ID, ID2));
    m.prepareWebIdentity('find_id');
    m.prepareWebIdentity('find_id');
    await flush();
    expect(calls).toHaveLength(1);
  });
  it('PC: 창을 닫음(응답 code) → 기록 정리·오류, 다음 것을 미리 등록', async () => {
    const { calls } = stubFetch(startOk(ID, ID2));
    sdk.request = vi.fn(async () => ({ code: 'IDENTITY_VERIFICATION_CANCELED', message: '사용자가 취소', identityVerificationId: ID }));
    await expect(m.startIdentityVerification({ returnPath: '/find-id', purpose: 'find_id' }))
      .rejects.toMatchObject({ code: 'IDENTITY_VERIFICATION_CANCELED', message: '사용자가 취소' });
    expect(sessionStorage.getItem(START_KEY)).toBeNull();
    await flush();
    expect(calls).toHaveLength(2);                           // 다시 누를 때 쓸 등록
    sdk.request = vi.fn(pcResponse(ID2));
    const r = await m.startIdentityVerification({ returnPath: '/find-id', purpose: 'find_id' });
    expect(r.id).toBe(ID2);
    expect(calls).toHaveLength(2);
  });
  it('모바일: 미리 등록 안 함, 클릭 때 등록 → 기록에 ds → REDIRECTION(null)', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(UA_ANDROID);
    const { calls } = stubFetch(startOk(ID));
    m.prepareWebIdentity('find_id');
    await flush();
    expect(calls).toHaveLength(0);
    const r = await m.startIdentityVerification({ returnPath: '/find-id', purpose: 'find_id' });
    expect(r).toBeNull();
    expect(calls).toHaveLength(1);
    const rec = rawStart(sessionStorage);
    expect(rec).toMatchObject({ id: ID, purpose: 'find_id', returnPath: '/find-id' });
    expect(calls[0].body.dsHash).toBe(sha256(rec.ds));
    const req = sdk.request.mock.calls[0][0];
    expect(req.windowType).toEqual({ mobile: 'REDIRECTION' });
    expect(new URL(req.redirectUrl).searchParams.get('state')).toBe(rec.state);
    expect(req.redirectUrl).not.toContain(rec.ds);
    // 돌아오면 이 기록으로 ok(ds 는 기록에서)
    expect(m.parseIdentityReturn(`?flow=identity&state=${rec.state}&identityVerificationId=${ID}`))
      .toEqual({ ok: true, id: ID, ds: rec.ds, state: rec.state, purpose: 'find_id' });
  });
  it.each([
    ['429', () => res(429, { ok: false, code: 'RATE_LIMITED', error: '많음' }), 'RATE_LIMITED'],
    ['503', () => res(503, { ok: false, code: 'IDENTITY_DISABLED', error: '준비 중' }), 'IDENTITY_DISABLED'],
    ['네트워크', () => { throw new TypeError('Failed to fetch'); }, 'NETWORK_ERROR'],
  ])('등록 실패(%s): SDK 0회, 기록 0건', async (_, route, code) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(UA_ANDROID);
    putStart(sessionStorage);                                  // 앞 시도의 기록도 새 시작에서 정리된다
    stubFetch(route);
    await expect(m.startIdentityVerification({ returnPath: '/find-id', purpose: 'find_id' })).rejects.toMatchObject({ code });
    expect(sdk.request).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(START_KEY)).toBeNull();
  });
  it('모바일: 기록을 저장할 수 없으면 PASS 를 열지 않는다(STORAGE_UNAVAILABLE)', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(UA_ANDROID);
    stubFetch(startOk(ID));
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function blocked(k, v) {
      if (k === START_KEY) throw new DOMException('blocked', 'SecurityError');
      return setItem.call(this, k, v);
    });
    await expect(m.startIdentityVerification({ returnPath: '/find-id', purpose: 'find_id' })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(sdk.request).not.toHaveBeenCalled();
  });
});

describe('앱 시작 — 시작 기록에 state 만, /app-identity?v=2(id 없음)', () => {
  it('기록 { state, purpose, returnPath, savedAt } 저장 → 크롬 탭 주소로 이동 → null(등록·SDK 0회)', async () => {
    nativeFlag.value = true;
    const go = vi.spyOn(m.identityNav, 'go').mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await m.startIdentityVerification({ returnPath: `/signup?type=crew&flow=identity&state=${STATE2}`, purpose: 'signup_identity' });
    expect(r).toBeNull();
    const rec = rawStart(localStorage);
    expect(Object.keys(rec).sort()).toEqual(['purpose', 'returnPath', 'savedAt', 'state']);
    expect(rec).toMatchObject({ purpose: 'signup_identity', returnPath: '/signup?type=crew' });
    expect(go).toHaveBeenCalledTimes(1);
    const u = new URL(go.mock.calls[0][0]);
    expect(u.origin + u.pathname).toBe('https://www.connecttrip.co.kr/app-identity');
    expect(Object.fromEntries(u.searchParams)).toEqual({ v: '2', state: rec.state, purpose: 'signup_identity', to: '/signup', q: 'type=crew' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sdk.request).not.toHaveBeenCalled();
  });
  it('앱 기록을 저장할 수 없으면 크롬 탭을 열지 않는다', async () => {
    nativeFlag.value = true;
    const go = vi.spyOn(m.identityNav, 'go').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    await expect(m.startIdentityVerification({ returnPath: '/find-id', purpose: 'find_id' })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(go).not.toHaveBeenCalled();
  });
});

describe('앱 전용 본인확인 화면(/app-identity) 주소', () => {
  it('appIdentityUrl — v=2·state·purpose·to·q, id 없음. 가져오기는 resume=1', () => {
    const u = new URL(m.appIdentityUrl({ state: STATE, purpose: 'signup_identity', returnPath: '/signup?type=crew&a=b?c' }));
    expect(u.origin + u.pathname).toBe('https://www.connecttrip.co.kr/app-identity');
    expect(Object.fromEntries(u.searchParams)).toEqual({ v: '2', state: STATE, purpose: 'signup_identity', to: '/signup', q: 'type=crew&a=b?c' });
    expect(m.parseAppIdentityParams(u.search)).toEqual({ state: STATE, purpose: 'signup_identity', to: '/signup', q: 'type=crew&a=b?c', resume: false });
    const r = new URL(m.appIdentityUrl({ state: STATE, purpose: 'find_id', returnPath: '/find-id', resume: true }));
    expect(r.searchParams.get('resume')).toBe('1');
    expect(r.searchParams.has('q')).toBe(false);
    expect(m.parseAppIdentityParams(r.search)).toEqual({ state: STATE, purpose: 'find_id', to: '/find-id', q: '', resume: true });
  });
  it('v=2 잘못된 값은 거부(state 형식, 용도, 복귀 경로, 다른 버전)', () => {
    const ok = new URLSearchParams({ v: '2', state: STATE, purpose: 'find_id', to: '/find-id' });
    expect(m.parseAppIdentityParams(`?${ok}`)).not.toBeNull();
    for (const [k, v] of [['state', 'zz'], ['purpose', 'admin'], ['to', '/admin'], ['to', 'https://evil.example'], ['v', '3']]) {
      const sp = new URLSearchParams(ok);
      sp.set(k, v);
      expect(m.parseAppIdentityParams(`?${sp}`), `${k}=${v}`).toBeNull();
    }
  });
  it('v 없는 옛 계약(1.3.4 이하: id·state 형식 OK, 허용 경로) → legacy, 그 밖은 null', () => {
    const old = new URLSearchParams({ id: ID, state: STATE, purpose: 'find_id', to: '/find-id', q: 'a=1' });
    expect(m.parseAppIdentityParams(`?${old}`)).toEqual({ legacy: true, state: STATE, to: '/find-id', q: 'a=1' });
    for (const [k, v] of [['id', 'ct123'], ['state', 'zz'], ['to', '/admin']]) {
      const sp = new URLSearchParams(old);
      sp.set(k, v);
      expect(m.parseAppIdentityParams(`?${sp}`), `${k}=${v}`).toBeNull();
    }
    expect(m.parseAppIdentityParams('')).toBeNull();
  });
  it('IDENTITY_PURPOSE_FIND_ID 상수(agy P3)', () => {
    expect(m.IDENTITY_PURPOSE_FIND_ID).toBe('find_id');
  });
});

describe('크롬 탭 — prepareAppIdentity·findAppIdResult(ctAppIdResults)', () => {
  const stored = () => JSON.parse(localStorage.getItem(RESULTS_KEY) || 'null');
  const entry = (over = {}) => ({ ds: DS, state: STATE, purpose: 'find_id', savedAt: Date.now() - MIN, ...over });

  it('새 등록: ds 생성 → start(sha256) → 보관 { ds, state, purpose, savedAt } 만(to·q 같은 값 없음)', async () => {
    const { calls } = stubFetch(startOk(ID));
    const t = await m.prepareAppIdentity({ state: STATE, purpose: 'find_id' });
    expect(t.id).toBe(ID);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ action: 'start', purpose: 'find_id', dsHash: sha256(t.ds) });
    const s = stored();
    expect(Object.keys(s)).toEqual([ID]);
    expect(Object.keys(s[ID]).sort()).toEqual(['ds', 'purpose', 'savedAt', 'state']);
    expect(s[ID]).toMatchObject({ ds: t.ds, state: STATE, purpose: 'find_id' });
  });
  it('새로 고침: 같은 state·용도의 30분 안 보관분을 다시 쓴다(등록 0회) — 여럿이면 가장 최근 것', async () => {
    localStorage.setItem(RESULTS_KEY, JSON.stringify({
      [ID]: entry({ savedAt: Date.now() - 20 * MIN }),
      [ID2]: entry({ ds: DS2, savedAt: Date.now() - 5 * MIN }),
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await m.prepareAppIdentity({ state: STATE, purpose: 'find_id' })).toEqual({ id: ID2, ds: DS2 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  // 2026-10-02 codex 코드 검토 지적 1: 같은 state 로는 id 를 바꾸지 않는다. 30분이 지난 같은 시도의 보관분이 있으면 새로 등록하지
  // 않고 IDENTITY_START_STALE — 새 id 로 PASS 를 마쳐도 앱 기록에 먼저 붙은 id 와 달라 정상 결과가 거절되기 때문이다.
  it.each([
    ['31분', 31, ID],
    ['61분 — 만료됐지만 아직 정리되지 않은 것도 센다(앱 기록은 그보다 먼저 만료)', 61, null],
  ])('같은 시도(state·용도)의 보관분이 30분을 넘었으면(%s) 등록 0회 + IDENTITY_START_STALE, 보관함은 그대로', async (_, ageMin, fetchable) => {
    localStorage.setItem(RESULTS_KEY, JSON.stringify({
      [ID]: entry({ savedAt: Date.now() - ageMin * MIN }),
      ctaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: entry({ state: STATE2 }),
      ctbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: entry({ purpose: 'password_reset' }),
    }));
    const before = localStorage.getItem(RESULTS_KEY);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const err = await m.prepareAppIdentity({ state: STATE, purpose: 'find_id' }).catch((e) => e);
    expect(err).toMatchObject({ code: 'IDENTITY_START_STALE', message: m.IDENTITY_START_STALE_MSG, final: false });
    expect(m.IDENTITY_START_STALE_MSG).toBe('본인확인 시간이 지났어요. 커넥트립 앱으로 돌아가 본인확인을 다시 시작해 주세요.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(RESULTS_KEY)).toBe(before);                              // 정리·추가 없음
    // 1시간 안이면 '인증 결과 가져오기'는 그 보관분을 그대로 찾는다
    expect(m.findAppIdResult(STATE, 'find_id')?.id ?? null).toBe(fetchable);
  });
  it('다른 시도(state·용도)의 보관분만 있으면 새로 등록한다 — 남의 보관분은 지우지 않는다', async () => {
    localStorage.setItem(RESULTS_KEY, JSON.stringify({
      ctaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: entry({ state: STATE2 }),
      ctbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: entry({ purpose: 'password_reset' }),
    }));
    const { calls } = stubFetch(startOk(ID2));
    const t = await m.prepareAppIdentity({ state: STATE, purpose: 'find_id' });
    expect(t.id).toBe(ID2);
    expect(calls).toHaveLength(1);
    expect(Object.keys(stored()).sort()).toEqual([ID2, 'ctaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'ctbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'].sort());
    expect(m.findAppIdResult(STATE, 'find_id')).toMatchObject({ id: ID2 });            // 가져오기: 1시간 안 최신
  });
  it('같은 탭 안에서 겹친 준비는 하나로 합친다(요청 1번)', async () => {
    const { calls } = stubFetch(startOk(ID, ID2));
    const [a, b] = await Promise.all([
      m.prepareAppIdentity({ state: STATE, purpose: 'find_id' }),
      m.prepareAppIdentity({ state: STATE, purpose: 'find_id' }),
    ]);
    expect(calls).toHaveLength(1);
    expect(b).toEqual(a);
  });
  it('저장소를 못 쓰면 등록 전에 STORAGE_UNAVAILABLE(서버 행·속도 제한을 쓰지 않는다)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(m.prepareAppIdentity({ state: STATE, purpose: 'find_id' })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('등록 실패는 그 사유로, 보관하지 않는다', async () => {
    stubFetch(() => res(429, { ok: false, code: 'RATE_LIMITED', error: '많음' }));
    await expect(m.prepareAppIdentity({ state: STATE, purpose: 'find_id' })).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(Object.keys(stored() || {})).toHaveLength(0);
  });
  it('보관은 최대 5건·1시간 — 만료분과 초과분(오래된 것부터)만 정리', async () => {
    const old = {};
    for (let i = 0; i < 5; i += 1) old[`ct${String(i).repeat(32)}`] = entry({ state: STATE2, savedAt: Date.now() - (10 + i) * MIN });
    old.ctcccccccccccccccccccccccccccccccc = entry({ state: STATE2, savedAt: Date.now() - 61 * MIN });
    localStorage.setItem(RESULTS_KEY, JSON.stringify(old));
    stubFetch(startOk(ID));
    await m.prepareAppIdentity({ state: STATE, purpose: 'find_id' });
    const keys = Object.keys(stored());
    expect(keys).toHaveLength(5);
    expect(keys).toContain(ID);
    expect(keys).not.toContain('ctcccccccccccccccccccccccccccccccc');                       // 만료
    expect(keys).not.toContain(`ct${'4'.repeat(32)}`);                                       // 가장 오래된 초과분
    m.findAppIdResult(STATE2, 'find_id');
    expect(Object.keys(stored())).toHaveLength(5);                                          // 읽었다고 지우지 않는다
  });
  it('findAppIdResult: state·용도·형식·기간이 맞는 것 중 최신, 저장소 오류면 null', () => {
    localStorage.setItem(RESULTS_KEY, JSON.stringify({
      [ID]: entry({ savedAt: Date.now() - 50 * MIN }),
      [ID2]: entry({ ds: 'bad' }),
      ct123: entry(),
    }));
    expect(m.findAppIdResult(STATE, 'find_id')).toMatchObject({ id: ID, ds: DS });
    expect(m.findAppIdResult(STATE, 'find_id', 30 * MIN)).toBeNull();
    expect(m.findAppIdResult(STATE, 'password_reset')).toBeNull();
    expect(m.findAppIdResult('zz', 'find_id')).toBeNull();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(m.findAppIdResult(STATE, 'find_id')).toBeNull();
  });
});

describe('크롬 탭 — launchIdentityForApp·appBridgeUrl', () => {
  it('SDK: 서버 id, redirectUrl = 다리?to&q&flow&state(ds 없음), forceRedirect', async () => {
    await m.launchIdentityForApp({ id: ID, state: STATE, to: '/signup', q: `type=crew&flow=x&ds=${DS}` });
    const req = sdk.request.mock.calls[0][0];
    expect(req).toMatchObject({ identityVerificationId: ID, forceRedirect: true, windowType: { mobile: 'REDIRECTION' } });
    const u = new URL(req.redirectUrl);
    expect(u.origin + u.pathname).toBe('https://www.connecttrip.co.kr/app-return.html');
    expect(Object.fromEntries(u.searchParams)).toEqual({ to: '/signup', type: 'crew', flow: 'identity', state: STATE });
  });
  it('SDK 오류 응답은 그 코드로 던진다', async () => {
    sdk.request = vi.fn(async () => ({ code: 'IDENTITY_VERIFICATION_FAILED', message: '이미 완료' }));
    await expect(m.launchIdentityForApp({ id: ID, state: STATE, to: '/find-id', q: '' })).rejects.toMatchObject({ code: 'IDENTITY_VERIFICATION_FAILED' });
  });
  it('본인확인이 꺼져 있으면(포트원 키 없음) 시작·미리 등록·크롬 준비 모두 요청 없이 IDENTITY_DISABLED', async () => {
    vi.stubEnv('VITE_PORTONE_STORE_ID', '');
    try {
      vi.resetModules();
      const off = await import('./identity');
      expect(off.IDENTITY_ENABLED).toBe(false);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await expect(off.startIdentityVerification({ returnPath: '/find-id', purpose: 'find_id' })).rejects.toMatchObject({ code: 'IDENTITY_DISABLED' });
      off.prepareWebIdentity('find_id');
      await expect(off.prepareAppIdentity({ state: STATE, purpose: 'find_id' })).rejects.toMatchObject({ code: 'IDENTITY_DISABLED' });
      await expect(off.launchIdentityForApp({ id: ID, state: STATE, to: '/find-id', q: '' })).rejects.toMatchObject({ code: 'IDENTITY_DISABLED' });
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(sdk.request).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv('VITE_PORTONE_STORE_ID', 'store-test');
    }
  });
  it('SDK 청크를 못 받으면(배포 직후 옛 청크 등) 한국어 안내로 IDENTITY_SDK_ERROR, 시작 기록 없음', async () => {
    const realFactory = () => ({ requestIdentityVerification: (...a) => sdk.request(...a) });
    vi.doMock('@portone/browser-sdk/v2', () => { throw new Error('Failed to fetch dynamically imported module'); });
    try {
      vi.resetModules();
      const broken = await import('./identity');
      stubFetch(startOk(ID));
      const err = await broken.startIdentityVerification({ returnPath: '/find-id', purpose: 'find_id' }).catch((e) => e);
      expect(err).toMatchObject({ code: 'IDENTITY_SDK_ERROR' });
      expect(err.message).toContain('화면을 새로 고친 뒤');
      expect(sessionStorage.getItem(START_KEY)).toBeNull();
      await expect(broken.launchIdentityForApp({ id: ID, state: STATE, to: '/find-id', q: '' })).rejects.toMatchObject({ code: 'IDENTITY_SDK_ERROR' });
    } finally {
      vi.doMock('@portone/browser-sdk/v2', realFactory);   // 다음 테스트는 다시 기록용 가짜 SDK
    }
  });
  it('appBridgeUrl: flow·state·identityVerificationId·code·message — resume·ds 는 싣지 않는다', () => {
    const ok = new URL(m.appBridgeUrl({ to: '/signup', q: `type=crew&resume=1&ds=${DS}`, state: STATE, id: ID }));
    expect(ok.origin + ok.pathname).toBe('https://www.connecttrip.co.kr/app-return.html');
    expect(Object.fromEntries(ok.searchParams)).toEqual({ to: '/signup', type: 'crew', flow: 'identity', state: STATE, identityVerificationId: ID });
    const fail = new URL(m.appBridgeUrl({ to: '/find-id', state: STATE, code: 'APP_UPDATE_REQUIRED', message: '업데이트' }));
    expect(Object.fromEntries(fail.searchParams)).toEqual({ to: '/find-id', flow: 'identity', state: STATE, code: 'APP_UPDATE_REQUIRED', message: '업데이트' });
  });
});

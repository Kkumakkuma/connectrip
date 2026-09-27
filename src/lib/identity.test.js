// @vitest-environment jsdom
// 본인확인 복귀 처리(2026-09-27 PASS 복귀 실패 수정): 앱 저장소 분기·resume=1·진행 중 본인확인·중복 확인 방지.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativeFlag = { value: false };
vi.mock('./native', () => ({ isNativeApp: () => nativeFlag.value }));

const {
  parseIdentityReturn, loadPendingIdentity, clearIdentityProof, confirmIdentity, stripIdentityParams,
  IDENTITY_PURPOSE_PASSWORD_RESET, appIdentityUrl, parseAppIdentityParams,
} = await import('./identity');

const START_KEY = 'pendingIdentityStart';
const putStart = (store, over = {}) => store.setItem(START_KEY, JSON.stringify({
  id: 'ct11112222333344445555666677778888', state: 'st1', purpose: 'find_id', returnPath: '/find-id', savedAt: Date.now(), ...over,
}));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  nativeFlag.value = false;
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('시작 기록 저장소', () => {
  it('웹은 sessionStorage, 앱은 localStorage 의 기록만 본다', () => {
    putStart(sessionStorage);
    expect(loadPendingIdentity()?.id).toBe('ct11112222333344445555666677778888');
    nativeFlag.value = true;
    expect(loadPendingIdentity()).toBeNull();          // 앱은 세션 기록을 보지 않는다
    putStart(localStorage, { id: 'ctAPP' });
    expect(loadPendingIdentity()).toMatchObject({ id: 'ctAPP', purpose: 'find_id', returnPath: '/find-id' });
  });
  it('1시간이 지난 기록은 없는 것으로', () => {
    nativeFlag.value = true;
    putStart(localStorage, { savedAt: Date.now() - 61 * 60 * 1000 });
    expect(loadPendingIdentity()).toBeNull();
  });
  it('clearIdentityProof 는 두 저장소의 시작 기록을 모두 지운다', () => {
    nativeFlag.value = true;
    putStart(localStorage);
    putStart(sessionStorage);
    clearIdentityProof();
    expect(localStorage.getItem(START_KEY)).toBeNull();
    expect(sessionStorage.getItem(START_KEY)).toBeNull();
  });
});

describe('parseIdentityReturn', () => {
  it('복귀 쿼리의 id·state 가 시작 기록과 같을 때만 ok', () => {
    putStart(sessionStorage);
    expect(parseIdentityReturn('?flow=identity&state=st1&identityVerificationId=ct11112222333344445555666677778888'))
      .toEqual({ ok: true, id: 'ct11112222333344445555666677778888' });
    expect(parseIdentityReturn('?flow=identity&state=WRONG&identityVerificationId=ct11112222333344445555666677778888').ok).toBe(false);
    expect(parseIdentityReturn('?flow=other')).toBeNull();
  });
  it('resume=1 은 우리 저장소의 id 로(외부 입력 id 는 무시)', () => {
    nativeFlag.value = true;
    putStart(localStorage, { id: 'ctMINE' });
    expect(parseIdentityReturn('?flow=identity&resume=1&identityVerificationId=ctOTHER')).toEqual({ ok: true, id: 'ctMINE', resume: true });
    localStorage.clear();
    expect(parseIdentityReturn('?flow=identity&resume=1').ok).toBe(false);
  });
  it('실패 복귀(code)는 메시지와 함께 ok:false', () => {
    putStart(sessionStorage);
    const r = parseIdentityReturn('?flow=identity&code=FAILURE&message=%EC%B7%A8%EC%86%8C');
    expect(r).toEqual({ ok: false, failed: true, message: '취소' });
  });
  it('실패 복귀의 failed 는 지금 진행 중인 시도일 때만(다른 시도의 옛 링크는 기록을 끝내지 않는다)', () => {
    putStart(sessionStorage);
    expect(parseIdentityReturn('?flow=identity&code=F&identityVerificationId=ct11112222333344445555666677778888').failed).toBe(true);
    expect(parseIdentityReturn('?flow=identity&code=F&identityVerificationId=ctOLDOLDOLD').failed).toBe(false);
    expect(parseIdentityReturn('?flow=identity&state=WRONG&identityVerificationId=ct11112222333344445555666677778888').failed).toBe(false);
  });
  it('stripIdentityParams 는 resume 까지 지우고 우리 쿼리는 남긴다', () => {
    expect(stripIdentityParams('?type=crew&flow=identity&resume=1&state=x')).toBe('?type=crew');
  });
});

describe('confirmIdentity — 같은 id·용도는 서버에 한 번만', () => {
  const okBody = { ok: true, verifyToken: 'tok', customer: { name: '가', birthdate: '2000-01-01', phone: '01000000000' } };
  it('동시에 여러 번 불러도 요청은 1번, 같은 증빙', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => okBody }));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([
      confirmIdentity('ctDEDUPE1', IDENTITY_PURPOSE_PASSWORD_RESET),
      confirmIdentity('ctDEDUPE1', IDENTITY_PURPOSE_PASSWORD_RESET),
    ]);
    const c = await confirmIdentity('ctDEDUPE1', IDENTITY_PURPOSE_PASSWORD_RESET);   // 성공 뒤 다시 불러도 같은 결과
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.token).toBe('tok');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
  it('실패하면 다시 물을 수 있다(아직 인증 전 → 나중에 성공)', async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n += 1;
      if (n === 1) return { ok: false, status: 400, json: async () => ({ ok: false, code: 'IDENTITY_NOT_VERIFIED', error: '아직' }) };
      return { ok: true, status: 200, json: async () => okBody };
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(confirmIdentity('ctRETRY1', 'find_id')).rejects.toMatchObject({ code: 'IDENTITY_NOT_VERIFIED' });
    const proof = await confirmIdentity('ctRETRY1', 'find_id');
    expect(proof.token).toBe('tok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('성공하면 시작 기록을 지운다(앱)', async () => {
    nativeFlag.value = true;
    putStart(localStorage, { id: 'ctCLEAR1' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => okBody })));
    await confirmIdentity('ctCLEAR1', 'find_id');
    expect(localStorage.getItem(START_KEY)).toBeNull();
  });
});

describe('앱 전용 본인확인 화면(/app-identity) 주소', () => {
  const id = 'ct0123456789abcdef0123456789abcdef';
  const state = '0123456789abcdef0123456789abcdef';
  it('앱 → 사이트 /app-identity(크롬 탭) — 경로와 원래 쿼리를 함께', () => {
    const url = appIdentityUrl({ id, state, purpose: 'signup_identity', returnPath: '/signup?type=crew' });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://www.connecttrip.co.kr/app-identity');
    expect(parseAppIdentityParams(u.search)).toEqual({ id, state, purpose: 'signup_identity', to: '/signup', q: 'type=crew' });
  });
  it('잘못된 값은 거부(id·state 형식, 용도, 복귀 경로)', () => {
    const ok = new URLSearchParams({ id, state, purpose: 'find_id', to: '/find-id' });
    expect(parseAppIdentityParams(`?${ok}`)).not.toBeNull();
    for (const [k, v] of [['id', 'ct123'], ['state', 'zz'], ['purpose', 'admin'], ['to', '/admin'], ['to', 'https://evil.example']]) {
      const sp = new URLSearchParams(ok);
      sp.set(k, v);
      expect(parseAppIdentityParams(`?${sp}`)).toBeNull();
    }
  });
});

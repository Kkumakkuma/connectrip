// @vitest-environment jsdom
// 앱 전용 본인확인 창 /app-identity(크롬 탭) — 2026-10-02 결속 설계 v2 §3.3 표의 모든 모드와 §7.
// 모드마다 서버 등록(fetch start)·SDK 호출 횟수와 '커넥트립 앱으로 돌아가기' 단추 주소(다리 페이지)를 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const native = vi.hoisted(() => ({ value: false }));
const sdk = vi.hoisted(() => ({ request: null }));
vi.mock('../lib/native', () => ({ isNativeApp: () => native.value }));
vi.mock('@portone/browser-sdk/v2', () => ({ requestIdentityVerification: (...a) => sdk.request(...a) }));
vi.stubEnv('VITE_PORTONE_STORE_ID', 'store-test');
vi.stubEnv('VITE_PORTONE_CHANNEL_KEY', 'channel-key-test');

const RESULTS_KEY = 'ctAppIdResults';
const ID = 'ct0123456789abcdef0123456789abcdef';
const ID2 = 'ctfedcba9876543210fedcba9876543210';
const STATE = '0123456789abcdef0123456789abcdef';
const DS = '89abcdef'.repeat(8);
const MIN = 60 * 1000;
const BRIDGE = 'https://www.connecttrip.co.kr/app-return.html';
const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  // 데스크톱 모드 아이패드와 맥 사파리는 UA 가 같다 — 터치 지점 수로만 갈린다
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  // 안드로이드 태블릿 크롬의 '데스크톱 사이트' 모드 — Android 문구가 빠진다
  tabletDesktop: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};
const UPDATE_REQUIRED = '이 앱 버전에서는 본인확인을 진행할 수 없어요. 커넥트립 앱을 최신 버전으로 업데이트해 주세요. 업데이트 전에는 커넥트립 웹사이트에서 진행할 수 있어요.';

const v2 = (over = {}) => `?${new URLSearchParams({ v: '2', state: STATE, purpose: 'find_id', to: '/find-id', ...over })}`;
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const entry = (over = {}) => ({ ds: DS, state: STATE, purpose: 'find_id', savedAt: Date.now() - 5 * MIN, ...over });

let React;
let act;
let createRoot;
let MemoryRouter;
let AppIdentity;
let lib;
let root;
let div;
let log;       // 서버 등록·SDK 호출 순서
let calls;     // fetch 본문
beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  native.value = false;
  log = [];
  calls = [];
  sdk.request = vi.fn(async () => { log.push('sdk'); return undefined; });   // REDIRECTION — 페이지가 KCP 로 이동한 것과 같다
  stubFetch(() => res(200, { ok: true, identityVerificationId: ID }));
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(UA.android);
  vi.resetModules();
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
  ({ MemoryRouter } = await import('react-router-dom'));
  ({ default: AppIdentity } = await import('./AppIdentity'));
  lib = await import('../lib/identity');
  div = document.createElement('div');
  document.body.appendChild(div);
  root = createRoot(div);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  div.remove();
  delete navigator.maxTouchPoints;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(route) {
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init?.body || '{}');
    calls.push(body);
    log.push(body.action || 'confirm');
    return route(body, calls.length);
  }));
}
// 화면을 그린다. until 을 주면 등록(sha256·fetch)·SDK 사슬이 그 조건을 채울 때까지 act 안에서 기다린다.
async function render(search, { strict = false, until } = {}) {
  const tree = React.createElement(MemoryRouter, { initialEntries: [`/app-identity${search}`] }, React.createElement(AppIdentity));
  await act(async () => { root.render(strict ? React.createElement(React.StrictMode, null, tree) : tree); });
  // Node 의 setImmediate 로 돈다(테스트는 Node 에서 돈다 — 브라우저 전역 목록에 없어 globalThis 로 부른다). 윈도에서 setTimeout(1) 은
  // 약 15ms 로 반올림돼 느리다. 상한을 둬 조건이 끝내 안 맞아도 멈춘다.
  for (let i = 0; i < 3000 && until && !until(); i += 1) await act(async () => { await new Promise((r) => globalThis.setImmediate(r)); });
  await flush();
}
async function flush() {
  for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const sdkCalled = () => sdk.request.mock.calls.length > 0;
// '등록·SDK 0회' 검사용 — 사슬이 돌았다면 끝났을 만큼 기다린다. 크롬 보관함은 등록 전에 동기로 한 번 써 보므로(저장소 확인)
// 보관함이 비어 있으면 준비(prepareAppIdentity) 자체가 시작되지 않은 것이다.
async function quiet() {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  await flush();
}
const text = () => div.textContent;
const link = (label) => [...div.querySelectorAll('a')].find((a) => a.textContent.includes(label));
const backHref = () => link('커넥트립 앱으로 돌아가기')?.getAttribute('href');
const paramsOf = (href) => {
  const u = new URL(href);
  expect(u.origin + u.pathname).toBe(BRIDGE);
  return Object.fromEntries(u.searchParams);
};
const setTouch = (n) => Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: n });

describe('기본 — 등록 → PASS 자동 시작', () => {
  it('서버 등록(start) → SDK 순서, SDK 는 서버 id·ds 없는 다리 redirectUrl·forceRedirect, 크롬 보관함에 ds', async () => {
    await render(v2({ q: 'type=crew' }), { until: sdkCalled });
    expect(log).toEqual(['start', 'sdk']);
    expect(calls[0]).toMatchObject({ action: 'start', purpose: 'find_id', dsHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const req = sdk.request.mock.calls[0][0];
    expect(req).toMatchObject({ identityVerificationId: ID, forceRedirect: true, windowType: { mobile: 'REDIRECTION' } });
    expect(paramsOf(req.redirectUrl)).toEqual({ to: '/find-id', type: 'crew', flow: 'identity', state: STATE });
    const stored = JSON.parse(localStorage.getItem(RESULTS_KEY));
    expect(Object.keys(stored)).toEqual([ID]);
    expect(stored[ID]).toMatchObject({ state: STATE, purpose: 'find_id', ds: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(req.redirectUrl).not.toContain(stored[ID].ds);
    expect(text()).toContain('본인확인 창을 여는 중이에요');
    expect(text()).toContain('커넥트립 앱에서 직접 시작한 본인확인이 아니라면 이 창을 닫아 주세요');
    expect(backHref()).toBeUndefined();
  });

  it('주소에 id 가 있어도 쓰지 않는다 — 서버가 발급한 id 로만 연다(T1)', async () => {
    await render(v2({ id: ID2 }), { until: sdkCalled });
    expect(sdk.request.mock.calls[0][0].identityVerificationId).toBe(ID);
  });

  it('새로 고침: 같은 시도의 30분 안 보관분을 다시 쓴다(등록 0회)', async () => {
    localStorage.setItem(RESULTS_KEY, JSON.stringify({ [ID2]: entry() }));
    await render(v2(), { until: sdkCalled });
    await quiet();
    expect(calls).toHaveLength(0);
    expect(log).toEqual(['sdk']);
    expect(sdk.request.mock.calls[0][0].identityVerificationId).toBe(ID2);
  });

  it('StrictMode 이중 실행에도 등록·SDK 는 한 번', async () => {
    await render(v2(), { strict: true, until: sdkCalled });
    await quiet();
    expect(log).toEqual(['start', 'sdk']);
  });
});

describe('등록 실패·저장소 실패 — 오류 화면 + 단추 code=<사유>(SDK 0회)', () => {
  it.each([
    ['429', () => res(429, { ok: false, code: 'RATE_LIMITED', error: '본인확인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }), 'RATE_LIMITED'],
    ['503', () => res(503, { ok: false, code: 'IDENTITY_DISABLED', error: '본인확인 서비스 준비 중입니다. 잠시 후 다시 시도해주세요.' }), 'IDENTITY_DISABLED'],
    ['네트워크', () => { throw new TypeError('Failed to fetch'); }, 'NETWORK_ERROR'],
  ])('%s', async (_, route, code) => {
    stubFetch(route);
    await render(v2(), { until: () => !!backHref() });
    expect(sdk.request).not.toHaveBeenCalled();
    expect(text()).toContain('본인확인을 시작하지 못했어요');
    const p = paramsOf(backHref());
    expect(p).toMatchObject({ to: '/find-id', flow: 'identity', state: STATE, code });
    expect(p.message).toBeTruthy();
    expect(text()).toContain(p.message.split('.')[0]);
    expect(p.identityVerificationId).toBeUndefined();
    expect(p.resume).toBeUndefined();
  });

  it('브라우저 저장소를 쓸 수 없으면 등록도 SDK 도 하지 않는다(STORAGE_UNAVAILABLE)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    await render(v2(), { until: () => !!backHref() });
    expect(calls).toHaveLength(0);
    expect(sdk.request).not.toHaveBeenCalled();
    expect(text()).toContain('브라우저 저장소를 쓸 수 없어요');
    expect(paramsOf(backHref())).toMatchObject({ state: STATE, code: 'STORAGE_UNAVAILABLE' });
  });
});

describe('SDK 시작 오류·stale — 단추는 이 id 로 다리(다리가 ds 를 붙여 앱이 확인한다, C6)', () => {
  it('SDK 시작 오류(이미 끝난 id 재사용 등) → 안내 + 다리(id, 사유 없음)', async () => {
    sdk.request = vi.fn(async () => ({ code: 'IDENTITY_VERIFICATION_FAILED', message: '이미 완료된 본인인증입니다.' }));
    await render(v2(), { until: () => !!backHref() });
    expect(text()).toContain('본인확인 창을 열지 못했어요');
    expect(text()).toContain('이미 인증을 마쳤다면 앱으로 돌아가 결과를 확인해 주세요');
    expect(paramsOf(backHref())).toEqual({ to: '/find-id', flow: 'identity', state: STATE, identityVerificationId: ID });
  });

  it('12초가 지나도 창이 안 보이면 stale 단추(id 포함)', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    await render(v2(), { until: sdkCalled });
    expect(backHref()).toBeUndefined();
    const stale = timers.mock.calls.find((c) => c[1] === 12000);
    expect(stale).toBeTruthy();
    await act(async () => { stale[0](); });
    expect(text()).toContain('본인확인 창이 보이지 않나요?');
    expect(paramsOf(backHref())).toEqual({ to: '/find-id', flow: 'identity', state: STATE, identityVerificationId: ID });
  });

  it('인증 창에서 뒤로(bfcache 복원)도 stale 단추', async () => {
    await render(v2(), { until: sdkCalled });
    await act(async () => {
      const e = new Event('pageshow');
      Object.defineProperty(e, 'persisted', { value: true });
      window.dispatchEvent(e);
    });
    expect(text()).toContain('본인확인 창이 보이지 않나요?');
    expect(paramsOf(backHref()).identityVerificationId).toBe(ID);
  });
});

describe('결과 가져오기(resume)', () => {
  it('보관분이 있으면 다리로 replace — resume=1 없이 일반 성공 복귀(SDK·등록 0회)', async () => {
    localStorage.setItem(RESULTS_KEY, JSON.stringify({
      [ID]: entry({ savedAt: Date.now() - 50 * MIN }),
      [ID2]: entry({ savedAt: Date.now() - 40 * MIN }),
    }));
    const replace = vi.spyOn(lib.identityNav, 'replace').mockImplementation(() => {});
    await render(v2({ resume: '1', q: 'x=1' }));
    await quiet();
    expect(replace).toHaveBeenCalledTimes(1);
    const p = paramsOf(replace.mock.calls[0][0]);
    expect(p).toEqual({ to: '/find-id', x: '1', flow: 'identity', state: STATE, identityVerificationId: ID2 });   // 1시간 안 최신
    expect(replace.mock.calls[0][0]).not.toContain(DS);
    expect(calls).toHaveLength(0);
    expect(sdk.request).not.toHaveBeenCalled();
    expect(text()).toContain('커넥트립 앱으로 돌아가는 중이에요');
  });

  it('없으면 "결과를 찾지 못했어요" + 단추 code=IDENTITY_RESULT_NOT_FOUND(앱 기록 정리용)', async () => {
    localStorage.setItem(RESULTS_KEY, JSON.stringify({ [ID]: entry({ savedAt: Date.now() - 61 * MIN }) }));
    const replace = vi.spyOn(lib.identityNav, 'replace').mockImplementation(() => {});
    await render(v2({ resume: '1' }));
    await quiet();
    expect(replace).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(sdk.request).not.toHaveBeenCalled();
    expect(text()).toContain('인증 결과를 찾지 못했어요');
    const p = paramsOf(backHref());
    expect(p).toMatchObject({ to: '/find-id', flow: 'identity', state: STATE, code: 'IDENTITY_RESULT_NOT_FOUND' });
    expect(p.identityVerificationId).toBeUndefined();
    expect(p.resume).toBeUndefined();
  });
});

describe('등록·PASS 를 하지 않는 모드', () => {
  it('legacy(1.3.4 이하 — v 없이 앱이 만든 id) → 업데이트 안내 + 웹사이트 링크 + 단추 code=APP_UPDATE_REQUIRED(id·resume 없음)', async () => {
    await render(`?${new URLSearchParams({ id: ID, state: STATE, purpose: 'find_id', to: '/find-id', q: 'a=1' })}`);
    await quiet();
    expect(localStorage.getItem(RESULTS_KEY)).toBeNull();
    expect(calls).toHaveLength(0);
    expect(sdk.request).not.toHaveBeenCalled();
    expect(text()).toContain('이 앱 버전에서는 본인확인을 진행할 수 없어요');
    expect(link('커넥트립 웹사이트').getAttribute('href')).toBe('https://www.connecttrip.co.kr/');
    expect(paramsOf(backHref())).toEqual({
      to: '/find-id', a: '1', flow: 'identity', state: STATE, code: 'APP_UPDATE_REQUIRED', message: UPDATE_REQUIRED,
    });
  });

  it.each([
    ['아이폰', UA.iphone, 0],
    ['아이패드', UA.ipad, 0],
    ['데스크톱 모드 아이패드(맥 UA + 터치)', UA.mac, 5],
  ])('iOS(%s) → 안드로이드 앱 전용 안내만', async (_, ua, touch) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
    setTouch(touch);
    await render(v2());
    await quiet();
    expect(localStorage.getItem(RESULTS_KEY)).toBeNull();
    expect(calls).toHaveLength(0);
    expect(sdk.request).not.toHaveBeenCalled();
    expect(text()).toContain('커넥트립 안드로이드 앱 전용 화면이에요');
    expect(backHref()).toBeUndefined();
  });

  it.each([
    ['윈도 PC', UA.windows, 0],
    ['안드로이드 태블릿 데스크톱 모드', UA.tabletDesktop, 5],
    ['터치 없는 맥', UA.mac, 0],
  ])('데스크톱 UA(%s)는 막지 않는다 — 안드로이드 UA 를 요구하지 않음', async (_, ua, touch) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
    setTouch(touch);
    await render(v2(), { until: sdkCalled });
    expect(log).toEqual(['start', 'sdk']);
  });

  it('앱 WebView 안(크롬 탭 실행 실패) → 안내 + 이전 화면으로 돌아가기(등록·SDK 0회)', async () => {
    native.value = true;
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    await render(v2());
    await quiet();
    expect(localStorage.getItem(RESULTS_KEY)).toBeNull();
    expect(calls).toHaveLength(0);
    expect(sdk.request).not.toHaveBeenCalled();
    expect(text()).toContain('브라우저를 열 수 없어 본인확인을 진행할 수 없어요');
    const btn = [...div.querySelectorAll('button')].find((b) => b.textContent.includes('이전 화면으로 돌아가기'));
    await act(async () => { btn.click(); });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['빈 주소', ''],
    ['state 형식 오류', v2({ state: 'zz' })],
    ['허용 밖 경로', v2({ to: '/admin' })],
    ['다른 버전', v2({ v: '3' })],
  ])('잘못된 요청(%s) → BAD_REQUEST + 단추 = 다리(식별값 없음)', async (_, search) => {
    await render(search);
    await quiet();
    expect(localStorage.getItem(RESULTS_KEY)).toBeNull();
    expect(calls).toHaveLength(0);
    expect(sdk.request).not.toHaveBeenCalled();
    expect(text()).toContain('본인확인 요청이 올바르지 않습니다');
    expect(backHref()).toBe(BRIDGE);
  });
});

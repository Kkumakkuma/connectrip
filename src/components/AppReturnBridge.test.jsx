// @vitest-environment jsdom
// 앱 복귀 딥링크(2026-09-27 PASS 복귀 수정·교차검토 반영): 콜드 스타트 복구, 딥링크 우선, 같은 링크 재클릭, StrictMode.
// 2026-10-02 결속(설계 v2 §3.3·§7): 처리 기록(seen) 키는 ds 값을 ds=1 로 바꾼 정규화 키 하나 — ds 가 달라도 5초 안 1회,
// 세션 저장소에 ds 값을 남기지 않는다. C6 의 Bridge 부분(허용 밖 launch url 이면 resumePending)은 반려 — 아래 '다른 주소로
// 켜진 앱' 테스트가 9/27 결정('딥링크로 켜졌으면 그 주소가 답')을 고정한다.
// 2026-10-02 프로세스 종료 뒤 재시작(에뮬레이터 QA 2/2 재현, 436c8e8·앱 1.3.5): 태스크는 남고 프로세스만 종료된 앱을 다리 딥링크가
// 다시 켜면 원래 런치 인텐트는 주소가 없고(getLaunchUrl 빈 값) 딥링크는 새 인텐트로 와 appUrlOpen 으로만 온다. 아래 '프로세스 종료 뒤 재시작 복귀' 묶음이
// ① 네이티브 답 순서대로면 딥링크가 resume 보다 먼저 처리되는지 ② 최악 순서(resume 먼저)라도 뒤늦게 뜬 화면(lazy)이 같은 경로
// 복귀를 confirm 1회로 처리하는지 ③ 떠 있던 화면이 들은 복귀를 화면을 다시 열 때 또 처리하지 않는지를 고정한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Capacitor 8 흉내(node_modules 원본 확인): 듣는 쪽이 없을 때 온 appUrlOpen 은 붙잡아 뒀다가(AppPlugin.handleOnNewIntent →
// notifyListeners retainUntilConsumed) 첫 리스너가 붙는 그 호출을 처리하며 건넨다(Plugin.addEventListener). 플러그인 호출은
// 한 줄로 차례대로 처리되고 답도 그 순서로 온다(Bridge.callPluginMethod → taskHandler) — native 에 답 순서를 쌓아 두고
// nativeReplies 가 차례로 보낸다. 앞쪽 테스트들은 cap.launch.resolve·cap.listeners 를 직접 부른다(쌓인 순서는 쓰지 않는다).
const cap = vi.hoisted(() => ({ launch: null, listeners: {}, retained: {}, native: [] }));
vi.mock('@capacitor/app', () => ({
  App: {
    getLaunchUrl: () => {
      cap.native.push({ op: 'getLaunchUrl' });
      return cap.launch.promise;
    },
    addListener: (ev, cb) => {
      cap.listeners[ev] = cb;
      const held = cap.retained[ev];
      if (held) {
        delete cap.retained[ev];
        cap.native.push({ op: ev, deliver: () => held.forEach((data) => cb(data)) });
      }
      return Promise.resolve({ remove: () => { if (cap.listeners[ev] === cb) delete cap.listeners[ev]; } });
    },
  },
}));
vi.mock('../lib/native', () => ({ isNativeApp: () => true }));
// '프로세스 종료 뒤 재시작 복귀' 묶음은 실제 아이디 찾기 화면(FindLoginId → IdentityVerifyStep)을 띄운다 — 본인확인 키가 있어야 카드가 열린다
vi.stubEnv('VITE_PORTONE_STORE_ID', 'store-test');
vi.stubEnv('VITE_PORTONE_CHANNEL_KEY', 'channel-key-test');

const ID = 'ct0123456789abcdef0123456789abcdef';
const STATE = '0123456789abcdef0123456789abcdef';
const DEEP = `connecttrip://app-return/find-id?flow=identity&state=${STATE}&identityVerificationId=${ID}`;
const DS1 = '89abcdef'.repeat(8);
const DS2 = '01234567'.repeat(8);
// 다리 페이지가 크롬 저장소의 ds 를 붙여 보낸 딥링크(설계 v2 §0-4)
const deepDs = (ds) => `${DEEP}&ds=${ds}`;

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
// 앱 시작 기록(2026-10-02 형식): 결과를 받기 전에는 state 만 — id·ds 는 결과 딥링크로 받아 붙는다
const putPending = (over = {}) => localStorage.setItem('pendingIdentityStart', JSON.stringify({
  state: STATE, purpose: 'find_id', returnPath: '/find-id', savedAt: Date.now(), ...over,
}));

let ctx;
// screen: 주면 screenPath(기본 /find-id)에 실제 앱(App.jsx)처럼 lazy 화면 + Suspense 를 둔다 — screen.promise 가 풀릴 때(청크 도착)
// 화면이 뜬다
async function mount({ strict = false, screen = null, screenPath = '/find-id' } = {}) {
  vi.resetModules();   // launchChecked 는 모듈 변수 — 앱 프로세스를 새로 띄운 것처럼 매번 새로 읽는다
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { BrowserRouter, Routes, Route, useNavigate } = await import('react-router-dom');
  const { default: AppReturnBridge } = await import('./AppReturnBridge');
  const probe = {};
  const Probe = () => {
    const nav = useNavigate();
    React.useEffect(() => { probe.navigate = nav; }, [nav]);
    return null;
  };
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const kids = [React.createElement(AppReturnBridge), React.createElement(Probe)];
  if (screen) {
    const Screen = React.lazy(() => screen.promise);
    kids.push(React.createElement(React.Suspense, { fallback: null },
      React.createElement(Routes, null,
        React.createElement(Route, { path: screenPath, element: React.createElement(Screen) }),
        React.createElement(Route, { path: '*', element: null }))));
  }
  const tree = React.createElement(BrowserRouter, null, ...kids);
  await React.act(async () => { root.render(strict ? React.createElement(React.StrictMode, null, tree) : tree); });
  ctx = { React, root, probe, div };
  return ctx;
}
async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await ctx.React.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}
// 비동기 사슬(청크·확인·조회)이 끝날 때까지 — 조건이 맞거나 횟수가 다할 때까지 act 안에서 기다린다(Node setImmediate)
async function until(cond, tries = 400) {
  for (let i = 0; i < tries && !cond(); i += 1) {
    await ctx.React.act(async () => { await new Promise((r) => globalThis.setImmediate(r)); });
  }
}
// 네이티브 답을 호출 순서대로 하나씩 보낸다(답 사이마다 화면이 반응할 틈을 준다). launch: getLaunchUrl 의 답
async function nativeReplies(launch) {
  for (const reply of cap.native.splice(0)) {
    await ctx.React.act(async () => {
      if (reply.op === 'getLaunchUrl') cap.launch.resolve(launch);
      else reply.deliver();
    });
    await flush();
  }
}
const here = () => window.location.pathname + window.location.search;

// 서버 흉내 — 본인확인 확인(verify-identity)은 성공, 아이디 조회(find-login-id)는 cttest
function stubFetch() {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init?.body || '{}') });
    const body = String(url).endsWith('/api/find-login-id')
      ? { ok: true, login_id: 'cttest', user_type: 'traveler', created_at: '2026-09-05T00:00:00Z' }
      : { ok: true, verifyToken: 'tok', customer: { name: '가', birthdate: '2000-01-01', phone: '01000000000' } };
    return { ok: true, status: 200, json: async () => body };
  }));
  return calls;
}
const confirms = (calls) => calls.filter((c) => c.url.endsWith('/api/verify-identity'));
const lookups = (calls) => calls.filter((c) => c.url.endsWith('/api/find-login-id'));
const screenText = () => ctx.div.textContent;
// 화면 청크 도착 — mount 가 모듈을 새로 읽은 뒤라 같은 React·같은 appReturn 모듈을 쓴다
async function arrive(chunk, load = () => import('../pages/FindLoginId')) {
  const page = await load();
  await ctx.React.act(async () => { chunk.resolve(page); });
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  cap.launch = deferred();
  cap.listeners = {};
  cap.retained = {};
  cap.native = [];
});
afterEach(async () => {
  if (ctx) {
    await ctx.React.act(async () => { ctx.root.unmount(); });
    ctx.div.remove();
  }
  ctx = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AppReturnBridge', () => {
  it('콜드 스타트(아이콘으로 켬) + 10분 안의 본인확인 → 그 화면으로 resume=1', async () => {
    putPending();
    await mount();
    cap.launch.resolve(undefined);
    await flush();
    expect(here()).toBe('/find-id?flow=identity&resume=1');
  });

  it('결과를 이미 받은 기록(id·ds)도 같은 resume=1 로 — 화면이 저장해 둔 값으로 확인한다', async () => {
    putPending({ id: ID, ds: DS1 });
    await mount();
    cap.launch.resolve(undefined);
    await flush();
    expect(here()).toBe('/find-id?flow=identity&resume=1');   // 주소에 id·ds 를 싣지 않는다
  });

  it('StrictMode 이중 마운트에서도 복구한다(개발 모드)', async () => {
    putPending();
    await mount({ strict: true });
    cap.launch.resolve(undefined);
    await flush();
    expect(here()).toBe('/find-id?flow=identity&resume=1');
  });

  it('10분이 지난 기록·다른 경로면 복구하지 않는다', async () => {
    putPending({ savedAt: Date.now() - 11 * 60 * 1000 });
    await mount();
    cap.launch.resolve(undefined);
    await flush();
    expect(here()).toBe('/');
  });

  it('딥링크로 켜지면 그 주소로 — appUrlOpen 이 먼저 와도 resume 으로 덮지 않는다', async () => {
    putPending();
    await mount();
    await flush();
    await ctx.React.act(async () => { cap.listeners.appUrlOpen({ url: DEEP }); });   // 리스너가 먼저
    cap.launch.resolve({ url: DEEP });
    await flush();
    expect(here()).toBe(`/find-id?flow=identity&state=${STATE}&identityVerificationId=${ID}`);
  });

  it('다른 주소로 켜진 앱(허용 밖 링크)은 본인확인 화면으로 끌고 가지 않는다', async () => {
    putPending();
    await mount();
    cap.launch.resolve({ url: 'connecttrip://app-return/admin' });
    await flush();
    expect(here()).toBe('/');
  });

  it('같은 딥링크: 5초 안 이중 전달은 한 번, 그 뒤 다시 누르면 다시 알린다', async () => {
    window.history.replaceState(null, '', '/find-id');
    await mount();
    cap.launch.resolve(undefined);
    await flush();
    const seen = [];
    const onRet = (e) => seen.push(e.detail);
    window.addEventListener('ct-app-return', onRet);
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    cap.listeners.appUrlOpen({ url: DEEP });
    cap.listeners.appUrlOpen({ url: DEEP });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ path: '/find-id', search: `?flow=identity&state=${STATE}&identityVerificationId=${ID}` });
    now += 6000;
    cap.listeners.appUrlOpen({ url: DEEP });
    expect(seen).toHaveLength(2);
    window.removeEventListener('ct-app-return', onRet);
  });

  it('seen 정규화: ds 만 다른 같은 복귀가 5초 안에 두 번 와도 한 번, 그 뒤 다시 누르면 다시 알린다', async () => {
    window.history.replaceState(null, '', '/find-id');
    await mount();
    cap.launch.resolve(undefined);
    await flush();
    const seen = [];
    const onRet = (e) => seen.push(e.detail);
    window.addEventListener('ct-app-return', onRet);
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    cap.listeners.appUrlOpen({ url: deepDs(DS1) });
    cap.listeners.appUrlOpen({ url: deepDs(DS2) });
    expect(seen).toHaveLength(1);
    // 화면에는 받은 주소 그대로(ds 포함) 넘긴다 — 정규화는 처리 기록 키에만
    expect(seen[0]).toEqual({ path: '/find-id', search: `?flow=identity&state=${STATE}&identityVerificationId=${ID}&ds=${DS1}` });
    now += 6000;
    cap.listeners.appUrlOpen({ url: deepDs(DS2) });
    expect(seen).toHaveLength(2);
    expect(seen[1].search).toContain(`ds=${DS2}`);
    window.removeEventListener('ct-app-return', onRet);
  });

  it('처리 기록(세션 저장소)에는 ds 값이 남지 않는다 — ds=1 로 바꿔 둔 키 하나', async () => {
    window.history.replaceState(null, '', '/find-id');
    await mount();
    cap.launch.resolve(undefined);
    await flush();
    await ctx.React.act(async () => { cap.listeners.appUrlOpen({ url: deepDs(DS1) }); });
    const raw = sessionStorage.getItem('ctAppReturnSeen');
    expect(raw).not.toContain(DS1);
    expect(Object.keys(JSON.parse(raw))).toEqual([`${DEEP}&ds=1`]);
  });

  it('처음 주소(getLaunchUrl)에 ds 가 붙어 있어도 새로 고친 뒤 다시 처리하지 않는다(조회도 같은 정규화 키)', async () => {
    sessionStorage.setItem('ctAppReturnSeen', JSON.stringify({ [`${DEEP}&ds=1`]: Date.now() - 60000 }));
    sessionStorage.setItem('ctAppBooted', '1');
    await mount();
    cap.launch.resolve({ url: deepDs(DS1) });
    await flush();
    expect(here()).toBe('/');
  });

  it('처음 주소(getLaunchUrl)는 새로 고쳐도 다시 처리하지 않는다', async () => {
    sessionStorage.setItem('ctAppReturnSeen', JSON.stringify({ [DEEP]: Date.now() - 60000 }));
    sessionStorage.setItem('ctAppBooted', '1');
    await mount();
    cap.launch.resolve({ url: DEEP });
    await flush();
    expect(here()).toBe('/');
  });

  it('복구는 한 번만 — 첫 화면으로 돌아와도 다시 끌고 가지 않는다', async () => {
    putPending();
    await mount();
    cap.launch.resolve(undefined);
    await flush();
    expect(here()).toBe('/find-id?flow=identity&resume=1');
    await ctx.React.act(async () => { ctx.probe.navigate('/'); });
    await flush();
    expect(here()).toBe('/');
  });

  it('허용 밖 주소는 무시', async () => {
    await mount();
    cap.launch.resolve(undefined);
    await flush();
    await ctx.React.act(async () => { cap.listeners.appUrlOpen({ url: 'connecttrip://app-return/admin?x=1' }); });
    await ctx.React.act(async () => { cap.listeners.appUrlOpen({ url: 'https://evil.example/app-return.html?to=/find-id' }); });
    expect(here()).toBe('/');
  });
});

// ── 2026-10-02 프로세스 종료 뒤 재시작 복귀(에뮬레이터 QA 2/2 재현) ──────────────────────────────────────
// 아이디 찾기 → PASS(크롬 탭) 중 앱 프로세스만 종료(am kill — 메모리 부족 종료와 같음, 태스크 유지) → 다리 '앱으로 돌아가기'.
// events: wm_new_intent → am_proc_start → wm_restart_activity — 딥링크는 원래 런치 인텐트가 아니라 새 인텐트(onNewIntent)로 온다.
describe('프로세스 종료 뒤 재시작 복귀', () => {
  it('네이티브 답 순서: 붙잡혀 있던 딥링크가 getLaunchUrl(빈 값)의 답보다 먼저 처리돼 resume 으로 새지 않는다 → confirm 1회', async () => {
    putPending();
    cap.retained.appUrlOpen = [{ url: deepDs(DS1) }];   // 새 인텐트로 온 딥링크 — 아직 듣는 쪽이 없어 네이티브가 붙잡고 있다
    const calls = stubFetch();
    const chunk = deferred();
    await mount({ screen: chunk });
    await nativeReplies(undefined);                       // 원래 런치 인텐트(앱 아이콘)는 주소가 없다
    expect(here()).toBe(`/find-id?flow=identity&state=${STATE}&identityVerificationId=${ID}&ds=${DS1}`);
    await arrive(chunk);
    await until(() => lookups(calls).length > 0);
    expect(confirms(calls)).toHaveLength(1);
    expect(confirms(calls)[0].body).toEqual({ identityVerificationId: ID, purpose: 'find_id', ds: DS1 });
    expect(lookups(calls)).toHaveLength(1);
    await until(() => screenText().includes('cttest'));
    expect(screenText()).toContain('cttest');
    expect(here()).toBe('/find-id');                      // 화면이 복귀 쿼리를 지웠다(resume=1 을 거치지 않았다)
    expect(localStorage.getItem('pendingIdentityStart')).toBeNull();
  });

  it('허용 밖 딥링크로 다시 켜져도(getLaunchUrl 빈 값) 본인확인 화면으로 끌고 가지 않는다 — 9/27 \'딥링크가 답\' 과 같은 원칙', async () => {
    putPending();
    cap.retained.appUrlOpen = [{ url: 'connecttrip://app-return/admin' }];
    await mount();
    await nativeReplies(undefined);
    expect(here()).toBe('/');
  });

  it('최악 순서(resume 이 먼저 그 화면으로 옮김) — 화면(lazy)이 뜨기 전에 온 같은 경로 딥링크도 화면이 뜨면 confirm 1회로 처리', async () => {
    putPending();
    const calls = stubFetch();
    const chunk = deferred();
    await mount({ screen: chunk });
    cap.launch.resolve(undefined);
    await flush();
    expect(here()).toBe('/find-id?flow=identity&resume=1');
    // 같은 경로라 화면을 다시 띄우지 않고 알리는데, 화면 청크가 아직이라 듣는 쪽이 없다
    await ctx.React.act(async () => { cap.listeners.appUrlOpen({ url: deepDs(DS1) }); });
    await flush();
    expect(confirms(calls)).toHaveLength(0);
    await arrive(chunk);                                  // 이제 화면이 뜬다
    await until(() => lookups(calls).length > 0);
    expect(confirms(calls)).toHaveLength(1);              // resume=1 주소 처리와 겹쳐도 한 번(handledRef·확인 캐시)
    expect(confirms(calls)[0].body).toEqual({ identityVerificationId: ID, purpose: 'find_id', ds: DS1 });
    expect(lookups(calls)).toHaveLength(1);
    await until(() => screenText().includes('cttest'));
    expect(screenText()).toContain('cttest');
    expect(screenText()).not.toContain('인증 결과 가져오기');
    expect(localStorage.getItem('pendingIdentityStart')).toBeNull();
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(DS1);   // 맡겨 둔 복귀(ds)는 저장소에 남지 않는다
  });

  it('비밀번호 찾기(카드가 본인확인 단계에서만 뜨는 화면)도 최악 순서에서 — 보관해 둔 아이디로 그 단계를 연 뒤 confirm 1회 → 새 비밀번호 단계', async () => {
    const deepFp = `connecttrip://app-return/forgot-password?flow=identity&state=${STATE}&identityVerificationId=${ID}&ds=${DS1}`;
    putPending({ purpose: 'password_reset', returnPath: '/forgot-password' });
    localStorage.setItem('pendingResetLoginId', JSON.stringify({ loginId: 'cttest', savedAt: Date.now() }));
    const calls = stubFetch();
    const chunk = deferred();
    await mount({ screen: chunk, screenPath: '/forgot-password' });
    cap.launch.resolve(undefined);
    await flush();
    expect(here()).toBe('/forgot-password?flow=identity&resume=1');
    await ctx.React.act(async () => { cap.listeners.appUrlOpen({ url: deepFp }); });   // 같은 경로 — 아직 화면 없음
    await flush();
    expect(confirms(calls)).toHaveLength(0);
    await arrive(chunk, () => import('../pages/ForgotPassword'));
    const newPassword = () => ctx.div.querySelector('input[autocomplete="new-password"]');
    await until(() => !!newPassword());
    expect(confirms(calls)).toHaveLength(1);
    expect(confirms(calls)[0].body).toEqual({ identityVerificationId: ID, purpose: 'password_reset', ds: DS1 });
    expect(newPassword()).toBeTruthy();
    expect(here()).toBe('/forgot-password');
    expect(localStorage.getItem('pendingIdentityStart')).toBeNull();
  });

  it('떠 있는 화면이 바로 들은 같은 경로 복귀는 다시 처리되지 않는다 — 화면을 나갔다 다시 열어도 confirm·조회 1회, 오류 없음', async () => {
    putPending();
    sessionStorage.setItem('ctAppBooted', '1');            // 콜드 스타트 아님(resume 없음)
    window.history.replaceState(null, '', '/find-id');
    const calls = stubFetch();
    const chunk = deferred();
    await mount({ screen: chunk });
    cap.launch.resolve(undefined);
    await arrive(chunk);
    await ctx.React.act(async () => { cap.listeners.appUrlOpen({ url: deepDs(DS1) }); });
    await until(() => lookups(calls).length > 0);
    expect(confirms(calls)).toHaveLength(1);
    await until(() => screenText().includes('cttest'));
    await ctx.React.act(async () => { ctx.probe.navigate('/'); });
    await flush();
    await ctx.React.act(async () => { ctx.probe.navigate('/find-id'); });
    await flush();
    expect(screenText()).toContain('PASS로 본인확인');      // 새로 뜬 카드
    expect(confirms(calls)).toHaveLength(1);
    expect(lookups(calls)).toHaveLength(1);
    expect(screenText()).not.toContain('본인확인 정보를 확인할 수 없습니다');
    expect(screenText()).not.toContain('⚠️');
  });
});

// 같은 화면 복귀 보관함 규칙(appReturn.js — 이 파일은 jsdom 이라 이벤트까지 본다)
describe('복귀 보관함(notifyAppReturn·takeHeldAppReturn)', () => {
  let ar;
  beforeEach(async () => {
    vi.resetModules();
    ar = await import('../lib/appReturn');
  });
  const isId = (s) => new URLSearchParams(s).get('flow') === 'identity';

  it('알리면서 맡겨 두고, 같은 경로·받는 종류만 한 번 꺼낸다(다른 경로·다른 종류는 그대로 둔다)', () => {
    const seen = [];
    const on = (e) => seen.push(e.detail);
    window.addEventListener('ct-app-return', on);
    ar.notifyAppReturn('/find-id', '?flow=identity&n=1');
    window.removeEventListener('ct-app-return', on);
    expect(seen).toEqual([{ path: '/find-id', search: '?flow=identity&n=1' }]);
    expect(ar.takeHeldAppReturn('/forgot-password', isId)).toBeNull();
    expect(ar.takeHeldAppReturn('/find-id', () => false)).toBeNull();
    expect(ar.takeHeldAppReturn('/find-id', isId)).toEqual({ path: '/find-id', search: '?flow=identity&n=1' });
    expect(ar.takeHeldAppReturn('/find-id', isId)).toBeNull();
  });

  it('마지막 알림만 남고, 1분이 지난 것은 버린다', () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    ar.notifyAppReturn('/find-id', '?flow=identity&n=1');
    ar.notifyAppReturn('/find-id', '?flow=identity&n=2');
    expect(ar.takeHeldAppReturn('/find-id')).toEqual({ path: '/find-id', search: '?flow=identity&n=2' });
    ar.notifyAppReturn('/find-id', '?flow=identity&n=3');
    now += 60 * 1000;
    expect(ar.takeHeldAppReturn('/find-id')).toBeNull();
    now -= 60 * 1000;
    expect(ar.takeHeldAppReturn('/find-id')).toBeNull();   // 버린 것은 시계를 되돌려도 없다
  });
});

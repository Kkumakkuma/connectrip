// @vitest-environment jsdom
// 앱 복귀 딥링크(2026-09-27 PASS 복귀 수정·교차검토 반영): 콜드 스타트 복구, 딥링크 우선, 같은 링크 재클릭, StrictMode.
// 2026-10-02 결속(설계 v2 §3.3·§7): 처리 기록(seen) 키는 ds 값을 ds=1 로 바꾼 정규화 키 하나 — ds 가 달라도 5초 안 1회,
// 세션 저장소에 ds 값을 남기지 않는다. C6 의 Bridge 부분(허용 밖 launch url 이면 resumePending)은 반려 — 아래 '다른 주소로
// 켜진 앱' 테스트가 9/27 결정('딥링크로 켜졌으면 그 주소가 답')을 고정한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cap = vi.hoisted(() => ({ launch: null, listeners: {} }));
vi.mock('@capacitor/app', () => ({
  App: {
    getLaunchUrl: () => cap.launch.promise,
    addListener: (ev, cb) => {
      cap.listeners[ev] = cb;
      return Promise.resolve({ remove: () => { if (cap.listeners[ev] === cb) delete cap.listeners[ev]; } });
    },
  },
}));
vi.mock('../lib/native', () => ({ isNativeApp: () => true }));

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
async function mount({ strict = false } = {}) {
  vi.resetModules();   // launchChecked 는 모듈 변수 — 앱 프로세스를 새로 띄운 것처럼 매번 새로 읽는다
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { BrowserRouter, useNavigate } = await import('react-router-dom');
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
  const tree = React.createElement(BrowserRouter, null, React.createElement(AppReturnBridge), React.createElement(Probe));
  await React.act(async () => { root.render(strict ? React.createElement(React.StrictMode, null, tree) : tree); });
  ctx = { React, root, probe };
  return ctx;
}
async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await ctx.React.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}
const here = () => window.location.pathname + window.location.search;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  cap.launch = deferred();
  cap.listeners = {};
});
afterEach(async () => {
  if (ctx) await ctx.React.act(async () => { ctx.root.unmount(); });
  ctx = null;
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

// @vitest-environment jsdom
// GA 정제(2026-10-02 PASS 결속 설계 v2 §3.4 C1): 본인확인 주소에서는 gtag 를 넣지 않고(init 지연),
// 보내는 주소는 모두 정제한다. 평소 화면의 ?q=·?to= 는 남긴다(flows6).
// 본인확인 화면(/app-identity)으로 처음 열린 문서는 끝까지 넣지 않는다(P3 검토 should-fix).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const nativeFlag = vi.hoisted(() => ({ value: false }));
vi.mock('./native', () => ({ isNativeApp: () => nativeFlag.value }));

const { sanitizeUrl, isSensitiveLocation } = await import('./analytics');

const ORIGIN = window.location.origin; // jsdom 기본 주소의 출처
const GTM = 'script[src^="https://www.googletagmanager.com/gtag/js"]';
const scripts = () => document.querySelectorAll(GTM).length;
const calls = () => (window.dataLayer || []).map((args) => Array.from(args));
const cmd = (name) => calls().filter((c) => c[0] === name);
const go = (url) => window.history.replaceState(null, '', url);
const setReferrer = (value) => Object.defineProperty(document, 'referrer', { value, configurable: true });

// injected 는 모듈 변수 — 페이지를 새로 연 것처럼 매번 새로 읽는다
async function load() {
  vi.resetModules();
  return import('./analytics');
}

const AID = 'ct0123456789abcdef0123456789abcdef';
const DS = 'a'.repeat(64);

beforeEach(() => {
  nativeFlag.value = false;
  go('/');
});
afterEach(() => {
  document.querySelectorAll(GTM).forEach((s) => s.remove());
  delete window.dataLayer;
  delete window.gtag;
  delete document.referrer; // setReferrer 로 덮은 값을 지워 원래 값('')으로
  document.title = '';
});

describe('sanitizeUrl', () => {
  it.each([
    // 본인확인 복귀(flow=identity) — 복귀 키에 더해 id·purpose·to·q·v 까지 지운다
    ['/find-id?flow=identity&state=s&q=y', '/find-id'],
    [`/forgot-password?flow=identity&state=s&identityVerificationId=${AID}&identityVerificationTxId=t1&transactionType=IDENTITY_VERIFICATION`, '/forgot-password'],
    ['/signup/complete?flow=identity&state=s&code=FAILURE&message=%EC%B7%A8%EC%86%8C&pgCode=P1&pgMessage=m', '/signup/complete'],
    [`/find-id?flow=identity&resume=1&ds=${DS}&id=${AID}&purpose=find_id&to=%2Ffind-id&v=2`, '/find-id'],
    // 본인확인과 무관한 쿼리는 원래 인코딩 그대로 남긴다
    ['/signup?next=%2Fplanner%2Ft%2F1&flow=identity&state=s', '/signup?next=%2Fplanner%2Ft%2F1'],
    // /app-identity — 새 계약(v=2)·옛 계약(id·state, 1.3.4 이하) 모두
    ['/app-identity?v=2&state=s&purpose=find_id&to=%2Ffind-id&q=a%3D1&resume=1', '/app-identity'],
    [`/app-identity?id=${AID}&state=s&purpose=find_id&to=%2Ffind-id`, '/app-identity'],
    // 다리 페이지(/app-return.html)도 본인확인 범위 — to·q 는 앱 경로·쿼리라 결제 복귀(flow=charge)여도 지운다
    ['https://www.connecttrip.co.kr/app-return.html?to=%2Fmypage&q=tab%3Dpoints&flow=charge&paymentId=p1', 'https://www.connecttrip.co.kr/app-return.html'],
    // 평소 화면 — 게시판 검색 ?q=·쪽지 ?to= 는 보존(flows6), 지울 게 없으면 문자열 그대로
    ['/search?q=abc', '/search?q=abc'],
    ['/messages?to=u1&name=%EC%A7%80%EB%AF%BC', '/messages?to=u1&name=%EC%A7%80%EB%AF%BC'],
    ['/companion?region=europe&q=a+b%20c', '/companion?region=europe&q=a+b%20c'],
    // 늘 지우는 키는 평소 화면에서도 지운다(q 는 남김)
    [`/board?q=abc&code=1&state=x&ds=${DS}&page=2`, '/board?q=abc&page=2'],
    // 절대 주소·해시는 받은 형태 그대로
    ['https://www.connecttrip.co.kr/find-id?flow=identity&state=s&q=y#top', 'https://www.connecttrip.co.kr/find-id#top'],
    ['https://www.connecttrip.co.kr/App-Identity/?to=%2Ffind-id&q=x', 'https://www.connecttrip.co.kr/App-Identity/'],
    ['https://www.connecttrip.co.kr/search?q=abc#top', 'https://www.connecttrip.co.kr/search?q=abc#top'],
    ['/mypage?state=s#crew-renewal', '/mypage#crew-renewal'],
    // 같은 꼴의 다른 복귀 값: 결제 복귀·Supabase 인증 토큰 해시
    ['/mypage?flow=charge&paymentId=p1&txId=t1&paymentToken=k1&code=c&tab=points', '/mypage?tab=points'],
    ['/#access_token=a&refresh_token=b&type=recovery', '/'],
    ['https://www.connecttrip.co.kr/?x=1#access_token=a', 'https://www.connecttrip.co.kr/?x=1'],
    // 인코딩된 키도 화면 코드(URLSearchParams)와 같은 규칙으로 읽는다(%66low = flow)
    ['/x?%66low=identity&st%61te=s&q=1&keep=1', '/x?keep=1'],
    ['', ''],
  ])('%s → %s', (input, want) => {
    expect(sanitizeUrl(input)).toBe(want);
  });

  it('늘 지우는 키 ⊇ identity.js IDENTITY_RETURN_PARAMS + ds, payments/portone.js RETURN_PARAMS', () => {
    const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
    const listIn = (file, name) => {
      const m = read(file).match(new RegExp(`\\b${name}\\s*=\\s*\\[([^\\]]*)\\]`));
      return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
    };
    const identityKeys = listIn('./identity.js', 'IDENTITY_RETURN_PARAMS');
    const paymentKeys = listIn('./payments/portone.js', 'RETURN_PARAMS');
    // 목록을 못 읽으면(형식이 바뀌면) 대조가 헛돌지 않게 먼저 실패시킨다
    expect(identityKeys).toContain('identityVerificationId');
    expect(paymentKeys).toContain('paymentId');
    for (const k of [...identityKeys, 'ds', ...paymentKeys]) {
      expect(sanitizeUrl(`/board?${k}=1&page=2`), k).toBe('/board?page=2');
    }
    // analytics.js 가 import 없이 따로 둔 값들
    expect(read('./identity.js')).toMatch(/IDENTITY_FLOW = 'identity';/);
    expect(read('./identity.js')).toMatch(/APP_IDENTITY_PATH = '\/app-identity';/);
    expect(read('./appReturn.js')).toMatch(/APP_RETURN_PAGE = '\/app-return\.html';/);
  });
});

describe('isSensitiveLocation', () => {
  it('본인확인 화면·다리 페이지·복귀 쿼리(flow=identity·ds)·인증 토큰 해시만 민감', () => {
    const yes = [
      '/app-identity?v=2&state=s&purpose=find_id&to=%2Ffind-id', '/App-Identity/', '/app-return.html?to=%2Ffind-id',
      '/find-id?flow=identity&state=s', `/signup?ds=${DS}`, '/#access_token=a&refresh_token=b',
    ];
    const no = ['/', '/search?q=abc', '/messages?to=u1', '/mypage#crew-renewal', '/mypage?flow=charge&paymentId=p1', '/app-identity-guide'];
    for (const u of yes) { go(u); expect(isSensitiveLocation(), u).toBe(true); }
    for (const u of no) { go(u); expect(isSensitiveLocation(), u).toBe(false); }
  });

  it('라우터 location·주소 문자열도 받는다', () => {
    expect(isSensitiveLocation({ pathname: '/find-id', search: '?flow=identity&state=s' })).toBe(true);
    expect(isSensitiveLocation({ pathname: '/search', search: '?q=abc' })).toBe(false);
    expect(isSensitiveLocation('https://www.connecttrip.co.kr/app-identity?v=2')).toBe(true);
    expect(isSensitiveLocation('/board?q=x')).toBe(false);
  });
});

describe('initAnalytics', () => {
  it('민감한 주소에서는 아무것도 넣지 않는다(script·dataLayer·gtag 변화 0)', async () => {
    for (const u of [
      '/app-identity?v=2&state=s&purpose=find_id&to=%2Ffind-id',
      `/find-id?flow=identity&state=s&identityVerificationId=${AID}`,
      `/signup?ds=${DS}`,
      '/#access_token=a&refresh_token=b',
    ]) {
      go(u);
      const { initAnalytics } = await load();
      initAnalytics();
      expect(scripts(), u).toBe(0);
      expect(window.dataLayer, u).toBeUndefined();
      expect(window.gtag, u).toBeUndefined();
    }
  });

  it('깨끗한 주소에서 넣는다 — 주소·리퍼러는 처음부터 정제값, 두 번 불러도 한 번만', async () => {
    go('/search?q=abc&code=1');
    setReferrer('https://www.connecttrip.co.kr/app-identity?v=2&state=s&purpose=find_id&to=%2Ffind-id&q=x');
    const { initAnalytics } = await load();
    initAnalytics();
    initAnalytics();
    expect(scripts()).toBe(1);
    const all = calls();
    expect(all.map((c) => c[0])).toEqual(['js', 'set', 'config']);
    expect(all[1][1]).toEqual({
      page_location: `${ORIGIN}/search?q=abc`,
      page_referrer: 'https://www.connecttrip.co.kr/app-identity',
    });
    // config 에는 주소를 넣지 않는다 — config 값이 set 보다 우선이라 이후 trackPageView 의 set 을 막는다
    expect(all[2][2]).toEqual({ send_page_view: false });
  });

  it('리퍼러가 비면 page_referrer 를 넣지 않는다', async () => {
    go('/board');
    const { initAnalytics } = await load();
    initAnalytics();
    expect(cmd('set')).toEqual([['set', { page_location: `${ORIGIN}/board` }]]);
  });

  it('앱(isNativeApp)에서는 GA 를 쓰지 않는다', async () => {
    nativeFlag.value = true;
    go('/board');
    const { initAnalytics, trackPageView } = await load();
    initAnalytics();
    expect(trackPageView('/board')).toBe(false);
    expect(scripts()).toBe(0);
    expect(window.dataLayer).toBeUndefined();
  });
});

// 모듈을 처음 읽을 때의 주소 = 문서의 첫 진입. load() 가 모듈을 새로 읽으므로 그 전의 go() 가 첫 진입이 된다.
describe('문서의 첫 진입이 /app-identity', () => {
  it('그 문서에서는 깨끗한 주소로 옮겨 가도 끝까지 넣지 않는다 — 새로 연 문서는 그대로 넣는다', async () => {
    go('/app-identity?v=2&state=s&purpose=find_id&to=%2Ffind-id&q=x');
    const { initAnalytics, trackPageView } = await load();
    initAnalytics(); // main.jsx 첫 호출
    go('/'); // 상단 메뉴 같은 SPA 링크로 나감 — 주소는 깨끗하다
    initAnalytics();
    expect(trackPageView('/')).toBe(false);
    go('/board?q=x');
    expect(trackPageView('/board?q=x')).toBe(false);
    expect(scripts()).toBe(0);
    expect(window.dataLayer).toBeUndefined();
    expect(window.gtag).toBeUndefined();

    const fresh = await load(); // 첫 진입이 깨끗한 주소(/board?q=x)인 새 문서
    expect(fresh.trackPageView('/board?q=x')).toBe(true);
    expect(scripts()).toBe(1);
  });

  it('대소문자·끝 슬래시가 달라도 같은 화면으로 막고, 이름만 비슷한 다른 화면은 막지 않는다', async () => {
    go('/App-Identity/?v=2');
    let m = await load();
    go('/');
    expect(m.trackPageView('/')).toBe(false);
    expect(scripts()).toBe(0);

    go('/app-identity-guide');
    m = await load();
    expect(m.trackPageView('/app-identity-guide')).toBe(true);
    expect(scripts()).toBe(1);
  });
});

describe('trackPageView', () => {
  it('/app-identity·복귀 주소에서는 0건(gtag 도 넣지 않음)', async () => {
    const { trackPageView } = await load();
    for (const u of ['/app-identity?v=2&state=s&purpose=find_id&to=%2Ffind-id&q=x', '/find-id?flow=identity&state=s']) {
      go(u);
      expect(trackPageView(u), u).toBe(false);
    }
    expect(scripts()).toBe(0);
    expect(window.dataLayer).toBeUndefined();
  });

  it('미뤘던 init 을 깨끗한 주소에서 넣고, 정제값으로 보낸 뒤 전역 page_location 도 바꾼다', async () => {
    go(`/find-id?flow=identity&state=s&identityVerificationId=${AID}`);
    const { initAnalytics, trackPageView } = await load();
    initAnalytics(); // main.jsx 첫 호출 — 미뤄진다
    expect(scripts()).toBe(0);
    go('/find-id'); // 화면이 복귀 쿼리를 지웠다
    document.title = '아이디 찾기 | 커넥트립';
    expect(trackPageView('/find-id')).toBe(true);
    expect(scripts()).toBe(1);
    expect(calls()).toEqual([
      ['js', expect.any(Date)],
      ['set', { page_location: `${ORIGIN}/find-id` }],
      ['config', expect.any(String), { send_page_view: false }],
      ['event', 'page_view', { page_path: '/find-id', page_location: `${ORIGIN}/find-id`, page_title: '아이디 찾기 | 커넥트립' }],
      ['set', { page_location: `${ORIGIN}/find-id` }],
    ]);
  });

  it('일반 화면: page_path·page_location 모두 정제(평소 ?q= 는 남김)', async () => {
    go('/search?q=abc&code=1&state=x');
    const { trackPageView } = await load();
    expect(trackPageView('/search?q=abc&code=1&state=x')).toBe(true);
    expect(cmd('event')).toEqual([['event', 'page_view', {
      page_path: '/search?q=abc', page_location: `${ORIGIN}/search?q=abc`, page_title: '',
    }]]);
    expect(cmd('set').at(-1)).toEqual(['set', { page_location: `${ORIGIN}/search?q=abc` }]);
  });
});

describe('AnalyticsTracker', () => {
  let view = null;
  afterEach(async () => {
    if (view) {
      await view.React.act(async () => { view.root.unmount(); });
      view.div.remove();
    }
    view = null;
  });

  // main.jsx 와 같은 순서: 렌더 전에 initAnalytics() → 라우터 안의 AnalyticsTracker
  async function mount() {
    vi.resetModules();
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { BrowserRouter, useNavigate } = await import('react-router-dom');
    const { initAnalytics } = await import('./analytics');
    const { default: AnalyticsTracker } = await import('../components/AnalyticsTracker');
    initAnalytics();
    const probe = {};
    const Probe = () => {
      const nav = useNavigate();
      React.useEffect(() => { probe.navigate = nav; }, [nav]);
      return null;
    };
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await React.act(async () => {
      root.render(React.createElement(BrowserRouter, null, React.createElement(AnalyticsTracker), React.createElement(Probe)));
    });
    view = { React, root, div };
    return async (to) => { await React.act(async () => { probe.navigate(to, { replace: true }); }); };
  }

  it('복귀 주소에서는 아무것도 안 하다가, 주소가 정리되면 정제 경로로 한 번 보낸다', async () => {
    go(`/find-id?flow=identity&state=s&identityVerificationId=${AID}`);
    const navigate = await mount();
    expect(scripts()).toBe(0);
    expect(window.dataLayer).toBeUndefined();

    await navigate('/find-id'); // 화면이 복귀 쿼리를 지움 → 이제 넣고 보낸다
    await navigate('/find-id?code=1'); // 정제하면 같은 경로 → 중복 아님
    await navigate('/app-identity?v=2&state=s&purpose=find_id&to=%2Ffind-id&q=x'); // 아무것도 안 함
    await navigate('/search?q=abc');
    await navigate('/search?q=abc&state=x'); // 정제하면 같은 경로
    await navigate('/messages?to=u1');

    expect(scripts()).toBe(1);
    expect(cmd('event').map((c) => c[2].page_path)).toEqual(['/find-id', '/search?q=abc', '/messages?to=u1']);
    // 어느 명령에도 본인확인 값·화면 주소가 실리지 않았다
    expect(JSON.stringify(calls())).not.toMatch(/identity|state=|app-identity|ct0123/);
  });

  it('본인확인 복귀 주소를 거쳐 같은 화면으로 돌아오면 새 방문으로 한 번 더 센다', async () => {
    go('/find-id');
    const navigate = await mount();
    await navigate(`/find-id?flow=identity&state=s&identityVerificationId=${AID}`); // 보내지 않고 '마지막 경로'를 비운다
    await navigate('/find-id');
    expect(cmd('event').map((c) => c[2].page_path)).toEqual(['/find-id', '/find-id']);
  });

  it('#access_token 착지는 0건 — 해시를 지운 뒤(AuthProvider) 다음 화면 전환 때 1회', async () => {
    go('/#access_token=a&refresh_token=b&type=recovery');
    const navigate = await mount();
    expect(scripts()).toBe(0);
    expect(window.dataLayer).toBeUndefined();
    // AuthProvider 처럼 history.replaceState 로 해시만 지운다 — 라우터는 모르므로 화면 전환이 아니다
    window.history.replaceState(null, '', '/');
    expect(scripts()).toBe(0);
    await navigate('/board');
    expect(scripts()).toBe(1);
    expect(cmd('event').map((c) => c[2].page_path)).toEqual(['/board']);
    expect(JSON.stringify(calls())).not.toMatch(/access_token|refresh_token|recovery/);
  });

  it('#access_token 해시를 지운 뒤 같은 경로로 전환(/?state=x → 정제하면 /)해도 그때 1건 — 착지 때 못 보낸 경로는 비어 있다', async () => {
    go('/#access_token=a&refresh_token=b&type=recovery');
    const navigate = await mount();
    expect(scripts()).toBe(0);
    window.history.replaceState(null, '', '/'); // AuthProvider 가 해시만 지움
    await navigate('/?state=x'); // 정제하면 '/' — 착지 때 보내지 못했으므로 같은 경로여도 중복이 아니다
    expect(scripts()).toBe(1);
    expect(cmd('event').map((c) => c[2].page_path)).toEqual(['/']);
    expect(cmd('event')[0][2].page_location).toBe(`${ORIGIN}/`);
    expect(JSON.stringify(calls())).not.toMatch(/access_token|refresh_token|recovery|state=/);
  });

  it('본인확인 화면으로 열린 문서: 메뉴로 나갔다가 뒤로 돌아와도 끝까지 0건', async () => {
    const entry = '/app-identity?v=2&state=s&purpose=find_id&to=%2Ffind-id&q=x';
    go(entry);
    const navigate = await mount();
    await navigate('/');
    await navigate('/board?q=x');
    await navigate(entry); // 뒤로 가기로 본인확인 주소가 다시 온다
    await navigate('/');
    expect(scripts()).toBe(0);
    expect(window.dataLayer).toBeUndefined();
    expect(window.gtag).toBeUndefined();
  });
});

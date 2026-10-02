// @vitest-environment node
// 앱 복귀 다리 페이지 public/app-return.html (2026-10-02 PASS 결속 설계 v2 §3.3·§7).
// 페이지의 인라인 스크립트를 jsdom 으로 그대로 실행한다 — 주소(url)·UA(userAgent)·크롬 저장소(beforeParse 로 심음)를 바꿔 가며
// ds 를 intent 쿼리에만·같은 state 일 때만 붙이는지, 커스텀 스킴 링크가 없는지, iOS 안내, no-referrer 를 본다.
// 자동 이동(location.href = intent://…)은 jsdom 이 '미구현(navigation)' 경고만 내므로 가상 콘솔로 받는다(테스트는 깨지지 않는다).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parse as parseScript } from 'espree';
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import { appReturnTarget, externalReturnUrl } from './appReturn';
import { appBridgeUrl } from './identity';

const HTML = readFileSync(new URL('../../public/app-return.html', import.meta.url), 'utf8');
const BRIDGE = 'https://www.connecttrip.co.kr/app-return.html';
const KEY = 'ctAppIdResults';
const ID = 'ct0123456789abcdef0123456789abcdef';
const STATE = '0123456789abcdef0123456789abcdef';
const DS = '89abcdef'.repeat(8);   // 64 hex — 이번 시도(mine) 항목의 ds
const HOUR = 60 * 60 * 1000;
const HOME_ENC = encodeURIComponent('https://www.connecttrip.co.kr/');
const EXTRAS = { scheme: 'connecttrip', package: 'com.connecttrip.app', 'S.browser_fallback_url': HOME_ENC };

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  ipod: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  // 데스크톱 모드 아이패드와 맥 사파리는 UA 가 같다 — 터치 지점 수(maxTouchPoints)로만 갈린다
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  // 안드로이드 태블릿 크롬의 '데스크톱 사이트' 모드 — 안드로이드 문구가 빠진다
  tabletDesktop: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};

// 로고 이미지 같은 하위 자원은 받지 않는다(테스트에서 네트워크 0)
class NoFetch extends ResourceLoader {
  fetch() { return null; }
}

// 자동 이동 목적지 기록: location·location.href 는 표준대로 재정의할 수 없어(unforgeable) 가짜 location 을 끼울 수 없다.
// jsdom(26.1.0 고정)의 href 설정자는 호출 때마다 whatwg-url 의 parseURL 로 주소를 해석한 뒤 곧바로 이동(미구현 경고)으로 가므로,
// 페이지를 여는 동안만 parseURL 을 감싸 '이동 경고 바로 앞에 해석된 주소'를 그 이동의 목적지로 본다.
// jsdom 이 불러 쓰는 것과 같은 모듈(같은 require 캐시)을 jsdom 위치에서 찾는다.
const whatwgUrl = createRequire(createRequire(import.meta.url).resolve('jsdom'))('whatwg-url');
const isNavigation = (e) => e.type === 'not implemented' && /navigation/.test(e.message);

// 다리 주소는 실제 생성기(appReturn.js externalReturnUrl — 크롬 탭의 redirectUrl·앱으로 돌아가는 단추가 쓰는 것)로 만든다.
const bridgeUrl = (params, to = '/find-id') => externalReturnUrl(to, params, { native: true });
// 생성기가 만들지 않는 주소(허용 밖 경로 등)는 손으로
const rawBridge = (params) => `${BRIDGE}?${new URLSearchParams(params)}`;
// 포트원 성공 복귀: 우리가 붙인 flow·state + 포트원이 붙이는 identityVerificationId·identityVerificationTxId·transactionType
const successUrl = (over = {}) => bridgeUrl({
  flow: 'identity', state: STATE, identityVerificationId: ID,
  identityVerificationTxId: 'tx-1', transactionType: 'IDENTITY_VERIFICATION', ...over,
});
// 크롬 탭(prepareAppIdentity)이 남기는 보관 항목 모양 — 설계 §3.1 { ds, state, purpose, savedAt(Date.now() ms) }.
// ds 는 부를 때마다 다른 값(dsOf) — 모든 항목이 같은 ds 면 '다른 시도의 ds 를 붙이는' 잘못된 구현을 못 잡는다(codex 지적).
// 이번 시도(주소의 identityVerificationId 가 가리키는 항목)는 mine() — ds 가 알려진 상수 DS 라 주소·문서에 새지 않는지도 본다.
const idOf = (i) => `ct${String(i).padStart(32, '0')}`;
const dsOf = (i) => `${'fade'.repeat(14)}${i.toString(16).padStart(8, '0')}`;   // 64 hex, 끝 8자리에 i
let dsSeq = 0;
const entry = (over = {}) => {
  dsSeq += 1;
  return { ds: dsOf(dsSeq), state: STATE, purpose: 'find_id', savedAt: Date.now() - 60 * 1000, ...over };
};
const mine = (over = {}) => entry({ ds: DS, ...over });
// 붙은 ds 가 '주소의 identityVerificationId(id) 항목의 ds' 와 정확히 같은지 — 보관함의 ds 가 전부 다르다는 전제도 같이 확인한다
function expectDsOf(b, results, id) {
  const all = Object.values(results).map((r) => r.ds);
  expect(new Set(all).size).toBe(all.length);
  expect(b.intent.query.getAll('ds')).toEqual([results[id].ds]);
}

// intent://app-return<경로>?<쿼리>#Intent;k=v;…;end → { path, query, extras } (형식이 다르면 null)
function parseIntent(href) {
  const m = /^intent:\/\/app-return(\/[^?#]*)(?:\?([^#]*))?#Intent;(.*);end$/.exec(href || '');
  if (!m) return null;
  const extras = {};
  for (const kv of m[3].split(';')) {
    const i = kv.indexOf('=');
    extras[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return { path: m[1], query: new URLSearchParams(m[2] || ''), extras };
}
// 안드로이드가 이 intent 로 앱을 열 때 넘기는 주소(data) = <scheme>:// + 'intent://' 뒤 '#' 앞부분
const deepLinkOf = (href) => `${parseIntent(href).extras.scheme}://${href.slice('intent://'.length, href.indexOf('#'))}`;
// 문서 안 모든 요소의 속성값(href·src·content …)
const attrValues = (doc) => [...doc.querySelectorAll('*')].flatMap((node) => [...node.attributes].map((a) => a.value));

const opened = [];
afterEach(() => { opened.splice(0).forEach((w) => w.close()); });

/**
 * 다리 페이지를 jsdom 으로 연다(인라인 스크립트 실행).
 *  ua·touch: navigator.userAgent·maxTouchPoints(touch 를 안 주면 jsdom 기본 = 없음)
 *  results: 크롬 저장소 'ctAppIdResults' 에 미리 심을 값(객체면 JSON, 문자열이면 그대로)
 *  clock: 페이지의 Date.now() 고정값(경계 시험용)
 *  before(window): 파싱 직전에 더 손볼 것(저장소 예외 흉내 등)
 */
function openBridge(url, { ua = UA.android, touch, results, clock, before } = {}) {
  const navigationTargets = [];
  const otherErrors = [];
  let lastParsed = null;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    if (isNavigation(e)) navigationTargets.push(lastParsed);
    else otherErrors.push(e.message);
  });
  const calls = { get: 0, set: 0, remove: 0 };
  let realGetItem = null;
  let restoreClock = null;
  const realParseURL = whatwgUrl.parseURL;
  whatwgUrl.parseURL = function recordParseURL(input, options) {
    lastParsed = typeof input === 'string' ? input : null;
    return realParseURL.call(this, input, options);
  };
  let dom;
  try {
    dom = new JSDOM(HTML, {
      url,
      runScripts: 'dangerously',
      resources: new NoFetch({ userAgent: ua }),
      virtualConsole,
      beforeParse(w) {
        if (touch !== undefined) Object.defineProperty(w.navigator, 'maxTouchPoints', { configurable: true, value: touch });
        if (clock !== undefined) {
          const D = w.Date;
          const realNow = D.now;
          D.now = () => clock;
          restoreClock = () => { D.now = realNow; };
        }
        if (results !== undefined) w.localStorage.setItem(KEY, typeof results === 'string' ? results : JSON.stringify(results));
        // 페이지가 저장소를 건드린 횟수(심은 뒤부터 센다)
        const proto = w.Storage.prototype;
        const { getItem, setItem, removeItem } = proto;
        realGetItem = getItem;
        proto.getItem = function countedGetItem(k) { calls.get += 1; return getItem.call(this, k); };
        proto.setItem = function countedSetItem(k, v) { calls.set += 1; return setItem.call(this, k, v); };
        proto.removeItem = function countedRemoveItem(k) { calls.remove += 1; return removeItem.call(this, k); };
        if (before) before(w);
      },
    });
  } finally {
    whatwgUrl.parseURL = realParseURL;   // 스크립트는 생성 중에 동기로 끝난다 — 다른 시험에 새지 않게 바로 되돌린다
    if (restoreClock) restoreClock();
  }
  const { window } = dom;
  opened.push(window);
  const doc = window.document;
  const go = doc.getElementById('go');
  const href = go.getAttribute('href');
  const raw = () => realGetItem.call(window.localStorage, KEY);   // 세지 않고 읽는다
  return {
    window, doc, go, href, calls, raw, otherErrors, navigationTargets,
    intent: parseIntent(href),
    navigations: navigationTargets.length,
    shown: (id) => window.getComputedStyle(doc.getElementById(id)).display !== 'none',
    text: (id) => doc.getElementById(id).textContent,
    stored: () => JSON.parse(raw() || 'null'),
  };
}

describe('정적 문서', () => {
  it('no-referrer 메타가 head 에 하나 — 로고·홈 링크 요청에 이 주소(번호·state)가 Referer 로 실리지 않게', () => {
    const { doc } = openBridge(successUrl());
    const metas = doc.querySelectorAll('meta[name="referrer"]');
    expect(metas).toHaveLength(1);
    expect(metas[0].parentElement).toBe(doc.head);
    expect(metas[0].getAttribute('content')).toBe('no-referrer');
  });

  it("원문 어디에도 'connecttrip://' 가 없다", () => {
    expect(HTML).not.toMatch(/connecttrip:\/\//i);
  });

  it('인라인 스크립트 하나, ES5 문법 — 번들·변환 없이 옛 브라우저에서도 그대로 돈다', () => {
    expect(HTML.match(/<script\b/gi)).toHaveLength(1);
    const script = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];
    expect(() => parseScript(script, { ecmaVersion: 5 })).not.toThrow();
    // 검사가 실제로 ES2015 문법을 거르는지(대조군)
    expect(() => parseScript('var f = () => 1;', { ecmaVersion: 5 })).toThrow();
    expect(() => parseScript('const a = 1;', { ecmaVersion: 5 })).toThrow();
  });
});

describe('ds 첨부 — 본인확인 성공 복귀이고 크롬 저장소의 state 가 같을 때만', () => {
  it('같은 state: intent 쿼리에만 붙인다(화면 주소는 그대로, 문서에는 단추 주소 한 곳뿐)', () => {
    const url = successUrl();
    const b = openBridge(url, { results: { [ID]: mine() } });
    expect(b.otherErrors).toEqual([]);
    expect(b.intent.path).toBe('/find-id');
    expect(b.intent.query.getAll('ds')).toEqual([DS]);
    // 나머지 복귀 쿼리는 그대로 넘기고 to 는 경로가 된다
    expect(b.intent.query.get('to')).toBeNull();
    expect(b.intent.query.get('flow')).toBe('identity');
    expect(b.intent.query.get('state')).toBe(STATE);
    expect(b.intent.query.get('identityVerificationId')).toBe(ID);
    expect(b.intent.query.get('identityVerificationTxId')).toBe('tx-1');
    expect(b.intent.query.get('transactionType')).toBe('IDENTITY_VERIFICATION');
    expect(url).not.toContain(DS);
    expect(b.window.location.href).toBe(url);
    expect(b.doc.documentElement.outerHTML.split(DS)).toHaveLength(2);
    expect(b.navigationTargets).toEqual([b.href]);   // 안드로이드 자동 이동도 같은 주소
  });

  it('다른 state 면 붙이지 않는다(단추는 그대로)', () => {
    const b = openBridge(successUrl(), { results: { [ID]: mine({ state: 'f'.repeat(32) }) } });
    expect(b.otherErrors).toEqual([]);
    expect(b.intent.query.get('ds')).toBeNull();
    expect(b.intent.query.get('identityVerificationId')).toBe(ID);
    expect(b.navigationTargets).toEqual([b.href]);
  });

  it('1시간이 지난 항목이면 붙이지 않는다(그 항목은 정리된다)', () => {
    const b = openBridge(successUrl(), { results: { [ID]: mine({ savedAt: Date.now() - HOUR - 1000 }) } });
    expect(b.otherErrors).toEqual([]);
    expect(b.intent.query.get('ds')).toBeNull();
    expect(b.stored()).toEqual({});
  });

  it('1시간 경계: 1시간이 다 차면 만료 — 저장 시각이 앞서 있어도(기기 시계 보정) 쓴다', () => {
    const NOW = Date.UTC(2026, 0, 1, 3, 0, 0);
    const dsAt = (savedAt) => openBridge(successUrl(), { clock: NOW, results: { [ID]: mine({ savedAt }) } }).intent.query.get('ds');
    expect(dsAt(NOW - HOUR + 1)).toBe(DS);
    expect(dsAt(NOW - HOUR)).toBeNull();
    expect(dsAt(NOW + 5 * 60 * 1000)).toBe(DS);
  });

  it('실패 복귀(code)면 저장소를 보지 않고 붙이지 않는다 — code·message 는 앱이 기록을 정리하도록 그대로 넘긴다', () => {
    const b = openBridge(successUrl({ code: 'IDENTITY_VERIFICATION_FAILED', message: '취소' }), { results: { [ID]: mine() } });
    expect(b.otherErrors).toEqual([]);
    expect(b.intent.query.get('ds')).toBeNull();
    expect(b.intent.query.get('code')).toBe('IDENTITY_VERIFICATION_FAILED');
    expect(b.intent.query.get('message')).toBe('취소');
    expect(b.calls.get).toBe(0);
    expect(b.shown('fail')).toBe(true);
    expect(b.navigationTargets).toEqual([b.href]);
  });

  it('identityVerificationId 키로 찾는다 — id 키는 보지 않는다', () => {
    const OTHER = `ct${'e'.repeat(32)}`;
    const results = { [ID]: mine(), [OTHER]: entry() };   // id 키가 가리키는 항목도 있다(다른 ds) — 그쪽을 붙이면 잡힌다
    const byIdKey = openBridge(bridgeUrl({ flow: 'identity', state: STATE, id: ID }), { results });
    expect(byIdKey.intent.query.get('ds')).toBeNull();
    expect(byIdKey.calls.get).toBe(0);
    const both = openBridge(bridgeUrl({ flow: 'identity', state: STATE, id: OTHER, identityVerificationId: ID }), { results });
    expectDsOf(both, results, ID);
    expect(both.intent.query.get('ds')).toBe(DS);
  });

  it('state 가 같은 항목이 둘(옛 id 40분 전·새 id 5분 전)이면 주소의 id 항목 것 — 가장 최근 것이 아니다', () => {
    const now = Date.now();
    const OLD = idOf(1);
    const NEW = idOf(2);
    const results = { [OLD]: entry({ savedAt: now - 40 * 60 * 1000 }), [NEW]: entry({ savedAt: now - 5 * 60 * 1000 }) };
    const b = openBridge(successUrl({ identityVerificationId: OLD }), { results });
    expect(b.otherErrors).toEqual([]);
    expectDsOf(b, results, OLD);
    expect(b.intent.query.get('ds')).not.toBe(results[NEW].ds);
    expect(b.calls.set).toBe(0);   // 둘 다 1시간 안·5건 이하 — 정리할 것이 없다
    // 새 id 로 오면 새 항목 것
    expectDsOf(openBridge(successUrl({ identityVerificationId: NEW }), { results }), results, NEW);
  });

  it('형식이 틀린 id·state·저장 항목(ds·savedAt)은 쓰지 않는다', () => {
    const cases = [
      [successUrl({ identityVerificationId: ID.toUpperCase() }), { [ID.toUpperCase()]: entry() }],
      [successUrl({ state: STATE.slice(1) }), { [ID]: mine({ state: STATE.slice(1) }) }],
      [successUrl(), { [ID]: mine({ ds: DS.toUpperCase() }) }],
      [successUrl(), { [ID]: mine({ ds: DS.slice(1) }) }],
      [successUrl(), { [ID]: mine({ ds: 123 }) }],
      [successUrl(), { [ID]: 'ds' }],
      // savedAt 은 Number() 로 읽는다(identity.js freshResult 와 같은 규칙) — 유한한 숫자가 안 되면 형식 오류, null 은 0(1970)이라 만료
      [successUrl(), { [ID]: mine({ savedAt: 'abc' }) }],
      [successUrl(), { [ID]: mine({ savedAt: 'Infinity' }) }],
      [successUrl(), { [ID]: mine({ savedAt: [Date.now(), Date.now()] }) }],
      [successUrl(), { [ID]: mine({ savedAt: {} }) }],
      [successUrl(), { [ID]: mine({ savedAt: undefined }) }],
      [successUrl(), { [ID]: mine({ savedAt: null }) }],
    ];
    for (const [url, results] of cases) {
      const b = openBridge(url, { results });
      expect(b.otherErrors).toEqual([]);
      expect(b.intent.query.get('ds')).toBeNull();
      expect(b.navigationTargets).toEqual([b.href]);
    }
  });

  it('savedAt 이 숫자로 바뀌는 값(숫자 문자열·원소 하나 배열)은 identity.js freshResult() 와 같이 받아들인다', () => {
    const t = Date.now() - 60 * 1000;
    for (const savedAt of [String(t), [t]]) {
      const b = openBridge(successUrl(), { results: { [ID]: mine({ savedAt }) } });
      expect(b.otherErrors).toEqual([]);
      expect(b.intent.query.getAll('ds')).toEqual([DS]);
      expect(b.calls.set).toBe(0);   // 형식이 맞는 항목이라 정리 저장도 없다
    }
    // 숫자 문자열이라도 1시간이 지났으면 만료 — 정리된다
    const old = openBridge(successUrl(), { results: { [ID]: mine({ savedAt: String(Date.now() - HOUR - 1000) }) } });
    expect(old.intent.query.get('ds')).toBeNull();
    expect(old.stored()).toEqual({});
  });

  it('주소로 들어온 ds 는 넘기지 않는다(여러 개여도) — 앱으로 가는 ds 는 크롬 저장소에서 찾은 것뿐', () => {
    const injected = 'f'.repeat(64);
    const none = openBridge(`${successUrl()}&ds=${injected}&ds=${'e'.repeat(64)}`);
    expect(none.intent.query.get('ds')).toBeNull();
    expect(none.href).not.toContain(injected);
    const fromStore = openBridge(`${successUrl()}&ds=${injected}&ds=${'e'.repeat(64)}`, { results: { [ID]: mine() } });
    expect(fromStore.intent.query.getAll('ds')).toEqual([DS]);
    const pay = openBridge(bridgeUrl({ flow: 'charge', paymentId: 'pay-1', ds: injected }, '/mypage'));
    expect(pay.intent.query.get('ds')).toBeNull();
    expect(pay.intent.query.get('paymentId')).toBe('pay-1');
  });

  it('본인확인이 아니면(결제 복귀) 저장소를 보지 않는다', () => {
    const b = openBridge(bridgeUrl({ flow: 'charge', paymentId: 'pay-1', state: STATE, identityVerificationId: ID }, '/mypage'),
      { results: { [ID]: mine() } });
    expect(b.otherErrors).toEqual([]);
    expect(b.calls.get).toBe(0);
    expect(b.intent.path).toBe('/mypage');
    expect(b.intent.query.get('ds')).toBeNull();
    expect(b.navigationTargets).toEqual([b.href]);
  });

  it('to 가 허용 밖이면 붙이지 않는다 — 앱이 그 주소를 버린다(경로 없이 앱만 연다, 자동 이동 없음)', () => {
    const b = openBridge(rawBridge({ to: '/admin', flow: 'identity', state: STATE, identityVerificationId: ID }),
      { results: { [ID]: mine() } });
    expect(b.otherErrors).toEqual([]);
    expect(b.intent.path).toBe('/');
    expect(b.intent.query.get('ds')).toBeNull();
    expect(b.calls.get).toBe(0);
    expect(b.navigations).toBe(0);
    expect(appReturnTarget(deepLinkOf(b.href))).toBeNull();
  });
});

describe('크롬 저장소 정리 — 만료분·5건 초과분만', () => {
  it('읽은 항목은 지우지 않는다 — 다시 열어도(단추 재시도·새로 고침) 같은 ds, 지울 것이 없으면 쓰지 않는다', () => {
    const first = openBridge(successUrl(), { results: { [ID]: mine() } });
    expect(first.intent.query.get('ds')).toBe(DS);
    expect(first.calls.set).toBe(0);
    expect(first.calls.remove).toBe(0);
    const left = first.stored();
    expect(left).toEqual({ [ID]: expect.objectContaining({ ds: DS, state: STATE }) });
    const again = openBridge(successUrl(), { results: left });
    expect(again.intent.query.get('ds')).toBe(DS);
  });

  it('1시간 지난 것·형식이 틀린 것·5건을 넘는 오래된 것만 지운다', () => {
    const now = Date.now();
    const results = {};
    for (let i = 0; i < 7; i += 1) results[idOf(i)] = entry({ savedAt: now - (i + 1) * 60 * 1000 });   // 1~7분 전
    results[ID] = mine({ savedAt: now - 3.5 * 60 * 1000 });                                          // 읽을 항목(최근 4번째)
    results[`ct${'a'.repeat(32)}`] = entry({ savedAt: now - HOUR - 1000 });                          // 만료
    results[`ct${'b'.repeat(32)}`] = { ...entry(), savedAt: undefined };                              // savedAt 없음(JSON 에서 빠진다)
    const b = openBridge(successUrl(), { results });
    expect(b.otherErrors).toEqual([]);
    expect(b.intent.query.get('ds')).toBe(DS);
    expectDsOf(b, results, ID);   // 항목이 아홉인데 주소의 id 항목 것만
    expect(b.calls.set).toBe(1);
    const left = b.stored();
    expect(Object.keys(left).sort()).toEqual([idOf(0), idOf(1), idOf(2), idOf(3), ID].sort());
    expect(left[ID]).toEqual(results[ID]);
  });

  it('읽은 항목이라도 5건을 넘는 가장 오래된 쪽이면 규칙대로 정리된다 — 이번 단추에는 붙는다', () => {
    const now = Date.now();
    const results = { [ID]: mine({ savedAt: now - 30 * 60 * 1000 }) };   // 6건 중 가장 오래됨(30분 전)
    for (let i = 0; i < 5; i += 1) results[idOf(i)] = entry({ savedAt: now - (i + 1) * 60 * 1000 });
    const b = openBridge(successUrl(), { results });
    expect(b.intent.query.get('ds')).toBe(DS);
    expectDsOf(b, results, ID);   // 정리될 항목이라도 이번 단추에는 그 항목의 ds — 남는 항목 것이 아니다
    const left = b.stored();
    expect(Object.keys(left).sort()).toEqual([0, 1, 2, 3, 4].map(idOf).sort());
    // 다시 열면(재조회) 이제 없다 — 크롬 탭이 저장할 때 적용하는 5건 규칙과 같다
    expect(openBridge(successUrl(), { results: left }).intent.query.get('ds')).toBeNull();
  });
});

describe('저장소를 쓸 수 없어도 단추·자동 이동은 그대로', () => {
  const blocked = (w) => new w.DOMException('저장소 차단', 'SecurityError');
  const expectButtonWorks = (b) => {
    expect(b.otherErrors).toEqual([]);
    expect(b.intent).not.toBeNull();
    expect(b.intent.path).toBe('/find-id');
    expect(b.intent.query.get('identityVerificationId')).toBe(ID);
    expect(b.intent.query.get('ds')).toBeNull();
    expect(b.shown('go')).toBe(true);
    expect(b.navigationTargets).toEqual([b.href]);
  };

  it('getItem 이 예외를 던질 때', () => {
    expectButtonWorks(openBridge(successUrl(), {
      results: { [ID]: mine() },
      before: (w) => { w.Storage.prototype.getItem = () => { throw blocked(w); }; },
    }));
  });

  it('localStorage 접근 자체가 막혔을 때(SecurityError)', () => {
    expectButtonWorks(openBridge(successUrl(), {
      results: { [ID]: mine() },
      before: (w) => { Object.defineProperty(w, 'localStorage', { configurable: true, get() { throw blocked(w); } }); },
    }));
  });

  it('저장값이 깨졌거나 모양이 다를 때 — 덮어쓰지 않는다', () => {
    for (const results of ['{깨짐', '[]', '"문자열"', 'null']) {
      const b = openBridge(successUrl(), { results });
      expectButtonWorks(b);
      expect(b.calls.set).toBe(0);
      expect(b.raw()).toBe(results);
    }
  });

  it('정리 저장(setItem)이 실패해도 찾은 ds 는 붙인다', () => {
    const results = { [ID]: mine(), [`ct${'a'.repeat(32)}`]: entry({ savedAt: Date.now() - 2 * HOUR }) };
    const b = openBridge(successUrl(), {
      results,
      before: (w) => { w.Storage.prototype.setItem = () => { throw new w.DOMException('가득 참', 'QuotaExceededError'); }; },
    });
    expect(b.otherErrors).toEqual([]);
    expectDsOf(b, results, ID);
    expect(b.intent.query.get('ds')).toBe(DS);
    expect(b.navigationTargets).toEqual([b.href]);
  });
});

describe('단추·자동 이동 — intent:// 하나만', () => {
  // 안내 문구(lead·hint)가 실제로 보인다 — iOS 에서만 숨긴다(hidden 이 아니고, 계산된 display 도 none 이 아니다)
  const expectGuideShown = (b) => {
    for (const id of ['lead', 'hint']) {
      expect(b.doc.getElementById(id).hidden).toBe(false);
      expect(b.shown(id)).toBe(true);
    }
  };

  it('안드로이드: 패키지 고정 intent 단추 + 같은 주소로 자동 이동 1회', () => {
    const b = openBridge(successUrl());
    expect(b.otherErrors).toEqual([]);
    expect(b.href.startsWith('intent://app-return/find-id?')).toBe(true);
    expect(b.href.endsWith(`#Intent;scheme=connecttrip;package=com.connecttrip.app;S.browser_fallback_url=${HOME_ENC};end`)).toBe(true);
    expect(b.intent.extras).toEqual(EXTRAS);
    expect(b.shown('go')).toBe(true);
    expectGuideShown(b);
    expect(b.navigationTargets).toEqual([b.href]);
  });

  it('PC·데스크톱 모드 태블릿·맥(터치 0~1)도 intent 단추 — 자동 이동은 안드로이드 UA 일 때만', () => {
    for (const [ua, touch] of [[UA.windows, 0], [UA.tabletDesktop, 10], [UA.mac, 0], [UA.mac, 1], [UA.mac, undefined]]) {
      const b = openBridge(successUrl(), { ua, touch, results: { [ID]: mine() } });
      expect(b.otherErrors).toEqual([]);
      expect(b.intent?.path).toBe('/find-id');
      expect(b.intent.extras).toEqual(EXTRAS);
      expect(b.intent.query.get('ds')).toBe(DS);
      expect(b.shown('go')).toBe(true);
      expectGuideShown(b);
      expect(b.text('title')).toBe('커넥트립 앱으로 돌아가 주세요');
      expect(b.navigations).toBe(0);
    }
  });

  it('iOS(아이폰·아이패드·아이팟·데스크톱 모드 아이패드): 단추를 숨기고 안드로이드 앱 전용 안내만 — 저장소도 보지 않는다', () => {
    for (const [ua, touch] of [[UA.iphone, 5], [UA.ipad, 5], [UA.ipod, undefined], [UA.mac, 5]]) {
      for (const url of [successUrl(), successUrl({ code: 'IDENTITY_VERIFICATION_FAILED' })]) {
        const b = openBridge(url, { ua, touch, results: { [ID]: mine() } });
        expect(b.otherErrors).toEqual([]);
        expect(b.go.hidden).toBe(true);
        expect(b.shown('go')).toBe(false);   // .btn 의 display:block 에 지지 않는다
        expect(b.href).toBe('#');
        expect(b.text('title')).toBe('커넥트립 안드로이드 앱 전용 화면이에요');
        for (const id of ['lead', 'fail', 'hint']) expect(b.shown(id)).toBe(false);
        expect(attrValues(b.doc).filter((v) => /^intent:/i.test(v))).toEqual([]);
        expect(b.doc.documentElement.outerHTML).not.toContain(DS);
        expect(b.navigations).toBe(0);
        expect(b.calls.get).toBe(0);
        expect(b.doc.querySelector('a.home').getAttribute('href')).toBe('https://www.connecttrip.co.kr/');
      }
    }
  });

  it('to 가 없으면 경로 없이 앱만 연다 — 자동 이동 없음', () => {
    const b = openBridge(BRIDGE);
    expect(b.otherErrors).toEqual([]);
    expect(b.href).toBe(`intent://app-return/#Intent;scheme=connecttrip;package=com.connecttrip.app;S.browser_fallback_url=${HOME_ENC};end`);
    expect(b.navigations).toBe(0);
  });

  it('쿼리 값의 특수문자(#·;·&·=·%·공백·한글)는 인코딩돼 intent 구조를 바꾸지 못한다 — 앱 안 주소에서 같은 값', () => {
    const tricky = '가 나#Intent;scheme=evil;package=com.evil.app;end&x=1;%41=';
    const url = bridgeUrl({ type: 'crew', memo: tricky, flow: 'identity', state: STATE, identityVerificationId: ID }, '/signup');
    const b = openBridge(url, { results: { [ID]: mine() } });
    expect(b.otherErrors).toEqual([]);
    expect(b.href.split('#')).toHaveLength(2);   // '#' 은 intent 구분자 하나뿐
    expect(b.intent.extras).toEqual(EXTRAS);
    const sp = new URLSearchParams(appReturnTarget(deepLinkOf(b.href)).split('?')[1]);
    expect(sp.get('memo')).toBe(tricky);
    expect(sp.get('type')).toBe('crew');
    expect(sp.get('ds')).toBe(DS);
  });

  it("어느 경우에도 문서에 'connecttrip://' 링크가 없다", () => {
    const urls = [
      successUrl(),
      successUrl({ code: 'IDENTITY_VERIFICATION_FAILED', message: '취소' }),
      bridgeUrl({ flow: 'charge', paymentId: 'pay-1' }, '/mypage'),
      rawBridge({ to: '/admin', flow: 'identity', state: STATE, identityVerificationId: ID }),
      rawBridge({ to: 'connecttrip://app-return/find-id', flow: 'identity' }),
      rawBridge({ to: '/find-id', flow: 'identity', code: 'X', message: 'connecttrip://app-return/admin' }),
      BRIDGE,
    ];
    const devices = [[UA.android], [UA.iphone, 5], [UA.mac, 5], [UA.mac, 0], [UA.windows], [UA.tabletDesktop, 10]];
    for (const url of urls) {
      for (const [ua, touch] of devices) {
        const b = openBridge(url, { ua, touch, results: { [ID]: mine() } });
        expect(b.otherErrors).toEqual([]);
        expect(b.doc.documentElement.outerHTML).not.toMatch(/connecttrip:\/\//i);
        expect(attrValues(b.doc).filter((v) => /^\s*connecttrip:/i.test(v))).toEqual([]);
        expect(b.href === '#' || b.href.startsWith('intent://app-return/')).toBe(true);
        expect(b.navigationTargets.every((t) => t === b.href)).toBe(true);
      }
    }
  });
});

describe('문구', () => {
  it('리드·보조 문구(설계 §3.3) — 실패 문구·경로 없는 안내는 그대로', () => {
    const ok = openBridge(successUrl());
    expect(ok.text('lead')).toBe('이 화면을 닫지 말고 아래 단추를 눌러 주세요');
    expect(ok.text('hint')).toBe('단추가 동작하지 않으면 커넥트립 앱에서 「인증 결과 가져오기」를 눌러 주세요');
    expect(ok.text('go')).toBe('커넥트립 앱으로 돌아가기');
    expect(ok.shown('fail')).toBe(false);
    const failed = openBridge(successUrl({ code: 'IDENTITY_VERIFICATION_FAILED' }));
    expect(failed.shown('fail')).toBe(true);
    expect(failed.doc.getElementById('fail').innerHTML).toBe('본인확인이 완료되지 않았어요.<br>앱으로 돌아가 다시 시도해 주세요.');
    expect(failed.text('lead')).toBe('이 화면을 닫지 말고 아래 단추를 눌러 주세요');
    expect(openBridge(BRIDGE).text('lead')).toBe('커넥트립 앱으로 돌아가 이어서 진행해 주세요.');
  });
});

describe('가져오기 왕복의 다리 구간(설계 §3.2·§7, codex v2 #1)', () => {
  it('resume 없는 다리 주소 + 크롬 보관분 → ds 가 붙은 딥링크 → 앱 안 주소(resume 없음 = 일반 성공 복귀)', () => {
    // 앱 '인증 결과 가져오기' → 크롬 탭이 보관분을 찾아 다리로 보낸다. 주소는 손으로 만들지 않고 실제 생성기(identity.js appBridgeUrl)로:
    // to·q·flow·state·identityVerificationId — q 의 복귀 파라미터(resume·ds)는 떼고, ds 는 싣지 않는다(설계 v2 §0-4, codex v2 #1)
    const url = appBridgeUrl({ to: '/signup', q: `?type=crew&resume=1&ds=${'f'.repeat(64)}`, state: STATE, id: ID });
    expect(url).toBe(bridgeUrl({ type: 'crew', flow: 'identity', state: STATE, identityVerificationId: ID }, '/signup'));
    const b = openBridge(url, { results: { [ID]: mine({ purpose: 'signup_identity' }) } });
    expect(b.otherErrors).toEqual([]);
    expect(b.navigationTargets).toEqual([b.href]);
    const target = appReturnTarget(deepLinkOf(b.href));
    expect(target).toBe(`/signup?type=crew&flow=identity&state=${STATE}&identityVerificationId=${ID}&ds=${DS}`);
    expect(new URLSearchParams(target.split('?')[1]).has('resume')).toBe(false);
  });

  it('포트원 성공 복귀도 같은 모양 — 앱 안 주소에 ds', () => {
    const b = openBridge(successUrl(), { results: { [ID]: mine() } });
    expect(appReturnTarget(deepLinkOf(b.href))).toBe(`/find-id?flow=identity&state=${STATE}&identityVerificationId=${ID}`
      + `&identityVerificationTxId=tx-1&transactionType=IDENTITY_VERIFICATION&ds=${DS}`);
  });
});

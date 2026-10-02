// GA4 로더.
//
// 기본값 = 실측정 ID G-9Y4692NWJP (GA 속성 ConnectTrip, 2026-07-26 발급).
// 측정 ID 는 페이지 소스에 노출되는 공개 식별자라 커밋해도 된다(비밀키 아님).
// 빌드 환경변수 VITE_GA_ID 를 넣으면 그 값이 우선한다(속성 교체용).
//
// 안드로이드 앱(Capacitor)에서는 로드하지 않는다 — 웹뷰의 origin 이 웹과 달라
// 같은 속성에 섞이면 웹 지표가 오염된다.
//
// 본인확인 값은 GA 로 보내지 않는다(2026-10-02 PASS 결속 설계 v2 §3.4 C1 — codex #3·completeness2·flows6).
//  - 주소가 민감하면(isSensitiveLocation) gtag 를 아예 넣지 않고 미룬다. 화면이 복귀 쿼리를 지워 주소가
//    깨끗해지면 AnalyticsTracker → trackPageView 가 그때 넣는다. 그래서 gtag 는 오염된 주소를 보지 못한다.
//  - 본인확인 화면(/app-identity)으로 처음 열린 문서는 미루는 게 아니라 끝까지 넣지 않는다(OPENED_AT_IDENTITY).
//  - 보내는 주소(page_location·page_path·page_referrer)는 모두 sanitizeUrl 로 정제한다.
//  - GA 관리 화면의 '향상된 측정 → 브라우저 기록 기반 페이지 변경'은 코드로 못 끈다(설계 §6 확인 사항).
import { isNativeApp } from './native';

const GA_ID = import.meta.env.VITE_GA_ID || 'G-9Y4692NWJP';

// 늘 지우는 키 = 본인확인 복귀 키. identity.js IDENTITY_RETURN_PARAMS + ds 와 같게 유지한다(analytics.test.js 가 대조).
// identity.js 를 import 하지 않는 이유: 이 파일은 main.jsx 가 첫 렌더 전에 부르므로, 본인확인 모듈을
// 메인 번들 초기 경로에 끌어들이지 않으려고.
const IDENTITY_RETURN_KEYS = [
  'flow', 'state', 'identityVerificationId', 'identityVerificationTxId', 'transactionType',
  'code', 'message', 'pgCode', 'pgMessage', 'resume', 'ds',
];
// 같은 꼴의 다른 복귀 값도 늘 지운다 — GA 에 남길 이유가 없고 새면 안 되는 값들이다.
//  - 결제 복귀: payments/portone.js RETURN_PARAMS 중 위에 없는 것(테스트가 대조)
//  - Supabase 인증 복귀의 비밀값(OAuth·비밀번호 재설정 링크)
const OTHER_RETURN_KEYS = [
  'paymentId', 'txId', 'paymentToken',
  'access_token', 'refresh_token', 'provider_token', 'provider_refresh_token', 'token_hash',
];
// 본인확인 화면(/app-identity)·다리 페이지(/app-return.html)이거나 본인확인 복귀 주소(flow=identity)일 때만 더 지우는 키.
// 평소의 게시판 검색 ?q= 와 쪽지 ?to= 는 지표로 쓰므로 남긴다(flows6).
const IDENTITY_SCOPE_KEYS = ['id', 'purpose', 'to', 'q', 'v'];

const DROP_ALWAYS = new Set([...IDENTITY_RETURN_KEYS, ...OTHER_RETURN_KEYS]);
const DROP_IN_IDENTITY = new Set([...DROP_ALWAYS, ...IDENTITY_SCOPE_KEYS]);

// identity.js IDENTITY_FLOW·APP_IDENTITY_PATH, appReturn.js APP_RETURN_PAGE 와 같은 값(같은 이유로 import 하지 않음).
const IDENTITY_FLOW = 'identity';
const APP_IDENTITY_PATH = '/app-identity';
const APP_RETURN_PAGE = '/app-return.html';

// 상대 경로를 해석할 때만 쓰는 임시 기준 주소(결과에는 나오지 않는다).
const PARSE_BASE = 'https://parse.invalid';

let injected = false;

export const isAnalyticsEnabled = () => Boolean(GA_ID) && !isNativeApp();

// 라우터처럼 비교한다 — 대소문자·끝 슬래시·%인코딩이 달라도 같은 화면이 열리기 때문(/App-Identity/ 도 본인확인 화면).
function normalizePath(pathname) {
  let p = String(pathname || '');
  try { p = decodeURIComponent(p); } catch { /* 잘못된 % 는 그대로 비교 */ }
  return p.toLowerCase().replace(/\/+$/, '') || '/';
}

// 이 문서가 본인확인 화면(/app-identity)으로 처음 열렸는가 — 모듈을 처음 읽을 때(main.jsx 가 첫 렌더 전에 import) 한 번 정한다.
// 그렇다면 그 문서가 살아 있는 동안 gtag 를 넣지 않는다(2026-10-02 P3 검토 should-fix, 설계 v2 §3.4 C1).
// 그 화면에서 SPA 링크(상단 메뉴 등)로 나가면 주소가 깨끗해져 gtag 가 들어가는데, 뒤로 가기로 돌아오면 같은 문서에
// 본인확인 주소(state·to·q)가 다시 온다 — 그때 GA 의 '브라우저 기록 기반 페이지 변경'(코드로 못 끔)이 그 주소를 보낸다.
const OPENED_AT_IDENTITY = typeof window !== 'undefined' && normalizePath(window.location?.pathname) === APP_IDENTITY_PATH;

const hasIdentityFlow = (query) => new URLSearchParams(query || '').getAll('flow').includes(IDENTITY_FLOW);

// 본인확인 범위 = flow=identity 쿼리이거나 본인확인 화면·다리 페이지 경로. 다리 페이지 주소의 to·q 는 앱 경로·쿼리를
// 그대로 실어 나르므로(appReturn.js·identity.js) 결제 복귀(flow=charge)여도 지운다 — 리퍼러로 들어올 때를 대비한다.
function isIdentityScope(base, query) {
  if (hasIdentityFlow(query)) return true;
  let pathname = base;
  try { pathname = new URL(base || '/', PARSE_BASE).pathname; } catch { /* 해석이 안 되면 경로로 보고 그대로 */ }
  const path = normalizePath(pathname);
  return path === APP_IDENTITY_PATH || path === APP_RETURN_PAGE;
}

// 주소에서 본인확인 값을 지운다. 절대 주소든 '/경로?쿼리#해시' 든 받은 형태 그대로 돌려준다.
// 지울 것이 없으면 받은 문자열을 그대로 돌려주고, 지울 때도 남는 쿼리는 원래 인코딩 그대로 둔다
// (URLSearchParams 로 다시 쓰면 %20 이 + 로 바뀌는 등 평소 주소의 지표가 달라진다).
export function sanitizeUrl(urlOrPath) {
  const raw = urlOrPath == null ? '' : String(urlOrPath);
  const hashAt = raw.indexOf('#');
  const beforeHash = hashAt < 0 ? raw : raw.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : raw.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  const base = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt < 0 ? '' : beforeHash.slice(queryAt + 1);

  const drop = isIdentityScope(base, query) ? DROP_IN_IDENTITY : DROP_ALWAYS;
  let removed = false;
  const kept = [];
  for (const piece of query.split('&')) {
    if (!piece) continue;
    // 키는 화면 코드(URLSearchParams.get)와 같은 규칙으로 풀어서 비교한다 — %66low=identity 도 flow 다.
    const [key] = new URLSearchParams(piece).keys();
    if (drop.has(key)) removed = true;
    else kept.push(piece);
  }
  // a=b 꼴 해시는 앵커가 아니라 값 묶음이다(Supabase 인증 복귀의 #access_token=…&refresh_token=…) — 통째로 뺀다.
  // #crew-renewal 같은 앵커는 그대로 둔다.
  const keepHash = !hash.includes('=');
  if (!removed && keepHash) return raw;
  return base + (kept.length ? `?${kept.join('&')}` : '') + (keepHash ? hash : '');
}

// 지금 주소가 GA 를 쓰면 안 되는 주소인가. 이 주소에서는 gtag 를 넣지도, 페이지뷰를 보내지도 않는다.
//  - /app-identity(크롬 탭 본인확인 화면)·/app-return.html(앱으로 돌아가는 다리 페이지)
//  - 쿼리에 flow=identity(본인확인 복귀)나 ds(결속 값)가 있는 주소
//  - 해시에 Supabase 인증 토큰(#access_token=…)이 실린 주소 — AuthProvider 가 곧바로 해시를 지우고
//    그동안 화면도 그리지 않으므로 지운 뒤에 넣는다.
// loc 은 window.location·라우터 location({pathname, search, hash})·주소 문자열 모두 받는다.
export function isSensitiveLocation(loc = globalThis.location) {
  if (!loc) return false;
  let parts = loc;
  if (typeof loc === 'string') {
    try { parts = new URL(loc, PARSE_BASE); } catch { return true; } // 해석이 안 되면 보내지 않는 쪽으로
  }
  const { pathname = '', search = '', hash = '' } = parts;
  const path = normalizePath(pathname);
  if (path === APP_IDENTITY_PATH || path === APP_RETURN_PAGE) return true;
  const sp = new URLSearchParams(search || '');
  if (sp.getAll('flow').includes(IDENTITY_FLOW) || sp.has('ds')) return true;
  const hp = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  return hp.has('access_token') || hp.has('refresh_token');
}

export function initAnalytics() {
  if (injected || !isAnalyticsEnabled()) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  // 본인확인 화면으로 처음 열린 문서는 깨끗한 주소로 옮겨 가도 끝까지 넣지 않는다(OPENED_AT_IDENTITY).
  if (OPENED_AT_IDENTITY) return;
  // 민감한 주소면 아무것도 넣지 않고 미룬다. 깨끗한 주소가 되면 trackPageView 가 다시 부른다.
  if (isSensitiveLocation(window.location)) return;
  injected = true;

  window.dataLayer = window.dataLayer || [];
  // gtag 는 arguments 객체를 그대로 넣어야 GA 가 인식한다(배열로 바꾸면 안 됨).
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag('js', new Date());
  // 주소·리퍼러는 처음부터 정제값만 준다. config 가 아니라 전역(set)으로, config 보다 앞에 둔다.
  // gtag 는 event > config > set 순으로 값이 우선이라(https://developers.google.com/tag-platform/gtagjs/reference),
  // config 에 넣으면 trackPageView 의 set 이 먹지 않아 화면을 옮겨도 자동 이벤트(향상된 측정)가 첫 화면 주소에 묶인다.
  const page = { page_location: sanitizeUrl(window.location.href) };
  if (document.referrer) page.page_referrer = sanitizeUrl(document.referrer);
  gtag('set', page);
  // SPA 라우팅은 자동 page_view 가 첫 진입만 잡으므로 끄고 trackPageView 로 직접 보낸다.
  gtag('config', GA_ID, { send_page_view: false });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(script);
}

// 화면 전환 페이지뷰. 돌려주는 값 = 실제로 보냈는가(AnalyticsTracker 는 보낸 경로만 '마지막 경로'로 기억한다).
export function trackPageView(path) {
  if (!isAnalyticsEnabled() || OPENED_AT_IDENTITY) return false;
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (isSensitiveLocation(window.location)) return false;
  if (!injected) initAnalytics(); // 첫 주소가 민감해서 미뤘던 경우 — 지금은 깨끗하므로 여기서 넣는다
  if (typeof window.gtag !== 'function') return false;
  const pageLocation = sanitizeUrl(window.location.href);
  window.gtag('event', 'page_view', {
    page_path: sanitizeUrl(path ?? (window.location.pathname + window.location.search)),
    page_location: pageLocation,
    page_title: document.title,
  });
  // 이후 자동 이벤트(향상된 측정: 스크롤·이탈 클릭 등)도 지금 화면의 정제값을 쓰게 전역 값을 바꾼다.
  window.gtag('set', { page_location: pageLocation });
  return true;
}

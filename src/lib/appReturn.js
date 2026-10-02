// 앱(Capacitor) 밖에서 끝나는 외부 인증·결제의 복귀 주소(2026-09-27 PASS 복귀 실패 수정).
//
// 앱 WebView 의 주소는 https://localhost 다. 외부 흐름(PASS 앱 → 크롬 등)이 그 주소로 돌아오면 앱 밖에서는
// 열 수 없다(ERR_CONNECTION_REFUSED — 9/27 테스터 실기기 제보). 그래서 앱이면 복귀 주소를 사이트의 다리 페이지
// (public/app-return.html)로 보내고, 그 페이지가 앱을 다시 연다: connecttrip://app-return<경로>?<쿼리>.
// 흐름이 앱 WebView 안에서 끝나면 IntentUrlPlugin 이 다리 주소를 가로채 앱 안 경로로 바로 연다.
// 경로 허용 목록은 다리 페이지(public/app-return.html)·IntentUrlPlugin.java 와 같아야 한다(appReturn.test.js 가 대조).
import { SITE_ORIGIN } from './api';
import { isNativeApp } from './native';

export const APP_RETURN_SCHEME = 'connecttrip';
export const APP_RETURN_HOST = 'app-return';
export const APP_RETURN_PAGE = '/app-return.html';
// 다리·딥링크로 돌아올 수 있는 앱 경로. 본인확인(아이디 찾기·비밀번호 재설정·가입) + 결제(마이페이지·포인트).
export const APP_RETURN_PATH_RE = /^\/(find-id|forgot-password|signup(\/[a-z-]+)?|mypage|points)$/;

export const isAppReturnPath = (p) => typeof p === 'string' && APP_RETURN_PATH_RE.test(p);

// 외부 서비스(포트원 등)에 넘길 복귀 주소. 웹은 지금처럼 자기 주소, 앱이면 다리 페이지.
//   path: '/find-id' 같은 앱 경로, params: URLSearchParams | 객체 | 문자열(우리 쿼리)
// 앱인데 허용 목록 밖 경로(예: 결제 시험 /__paytest)면 다리 주소를 만들지 않는다 — 다리 페이지가 그 to 를 버려 그 화면으로
// 못 돌아온다. 그때는 공개 사이트 주소(SITE_ORIGIN + 경로 + 쿼리)를 준다(2026-10-02 C8, codex #11). window.location.origin 은
// 앱에서 https://localhost 라 쓰면 안 된다. 허용 목록(이 파일·app-return.html·IntentUrlPlugin.java)은 늘리지 않는다.
export function externalReturnUrl(path, params, { native = isNativeApp(), origin } = {}) {
  const sp = new URLSearchParams(params || '');
  const q = sp.toString();
  if (!native) {
    const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
    return `${base}${path}${q ? `?${q}` : ''}`;
  }
  // '/' 로 시작하는 경로만 이어 붙인다 — 그래야 호스트가 SITE_ORIGIN 에서 바뀌지 않는다('@evil.example'·'.evil.example' 같은
  // 값이면 다른 사이트 주소가 된다). 그 밖의 값은 예전처럼 다리 주소로 둔다(다리 페이지가 버린다).
  if (!isAppReturnPath(path) && typeof path === 'string' && path.startsWith('/')) {
    return `${SITE_ORIGIN}${path}${q ? `?${q}` : ''}`;
  }
  const out = new URLSearchParams();
  out.set('to', path);
  for (const [k, v] of sp) out.append(k, v);
  return `${SITE_ORIGIN}${APP_RETURN_PAGE}?${out.toString()}`;
}

// 복귀 주소 → 앱 안 주소('/경로?쿼리'). 허용 밖이면 null.
//   connecttrip://app-return/find-id?flow=identity&…            (다리 페이지 단추·딥링크)
//   https://www.connecttrip.co.kr/app-return.html?to=/find-id&… (흐름이 앱 WebView 안에서 끝난 경우)
export function appReturnTarget(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return null; }
  const sp = new URLSearchParams(u.search);
  let path;
  if (u.protocol === `${APP_RETURN_SCHEME}:`) {
    if (u.hostname !== APP_RETURN_HOST) return null;
    path = u.pathname;
  } else if (u.protocol === 'https:' && /^(www\.)?connecttrip\.co\.kr$/i.test(u.hostname) && u.pathname === APP_RETURN_PAGE) {
    path = sp.get('to') || '';
    sp.delete('to');
  } else {
    return null;
  }
  if (!isAppReturnPath(path)) return null;
  const q = sp.toString();
  return q ? `${path}?${q}` : path;
}

// ── 지금 화면으로 온 복귀 알림 + 보관함(2026-10-02, 앱 프로세스 종료 뒤 재시작 복귀 유실 수정) ─────────────────────
// AppReturnBridge 는 딥링크 경로가 지금 화면과 같으면 화면을 다시 띄우지 않고 이 이벤트로 알린다(화면들의 복귀 처리는 처음
// 한 번만 돈다). 그런데 그 경로의 화면(lazy 청크)이 아직 뜨기 전이면 듣는 쪽이 없어 알림이 사라졌다 — 에뮬레이터 QA 2/2 재현:
// PASS(크롬 탭) 중 앱 프로세스만 종료 → 다리 '앱으로 돌아가기' → 콜드 스타트 복구(resume)가 /find-id 로 옮겨 놓은 사이 딥링크가
// 도착 → 뒤늦게 뜬 화면은 resume=1 만 보고 '인증 결과 가져오기'를 안내했다.
// 그래서 마지막 알림을 잠깐(1분) 맡겨 두고, 그 경로의 화면이 뒤늦게 뜨면 한 번 꺼내 처리한다. 이벤트를 들은 쪽도 꺼내 비운다
// (화면을 다시 열 때 같은 복귀를 또 처리하지 않게). 딥링크 쿼리에 결속 비밀값(ds)이 있으므로 저장소에 두지 않고 모듈 변수에만
// 둔다(WebView 를 새로 고치면 사라진다).
export const APP_RETURN_EVENT = 'ct-app-return';
const HELD_RETURN_MS = 60 * 1000;
let heldReturn = null;   // { path, search, at }

// path: 앱 안 경로('/find-id'), search: '?…'(없으면 '')
export function notifyAppReturn(path, search = '') {
  heldReturn = { path, search, at: Date.now() };
  window.dispatchEvent(new CustomEvent(APP_RETURN_EVENT, { detail: { path, search } }));
}

// 맡겨 둔 알림을 꺼낸다 — 같은 경로이고 accept(search) 가 받는 것만 꺼내며, 꺼내면 비운다(한 번만). 다른 경로·다른 종류는
// 그대로 두고, 1분이 지난 것은 버린다. → { path, search } | null
export function takeHeldAppReturn(path, accept = () => true) {
  const r = heldReturn;
  if (!r) return null;
  if (!(Date.now() - r.at < HELD_RETURN_MS)) {
    heldReturn = null;
    return null;
  }
  if (r.path !== path || !accept(r.search)) return null;
  heldReturn = null;
  return { path: r.path, search: r.search };
}

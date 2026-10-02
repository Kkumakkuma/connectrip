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

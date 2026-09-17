// API 베이스 — 웹은 동일 출처(빈 문자열 = 상대경로, 기존과 동일).
// 안드로이드 앱 빌드(vite build --mode app)에서만 .env.app 의
// VITE_API_BASE=https://www.connecttrip.co.kr 이 주입된다.
// 앱 WebView 오리진은 https://localhost 라 상대경로 fetch 가 전부 실패하기 때문(api/_cors.js 참고).
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
export const apiUrl = (path) => `${API_BASE}${path}`;

// 사람에게 건네는 주소(공유·복사·외부 브라우저로 여는 링크).
// 앱 WebView 의 오리진은 https://localhost 라 window.location.href 를 그대로 공유하면
// 받는 사람이 열 수 없는 주소가 나간다(2026-09-17 앱 점검).
export const SITE_ORIGIN = API_BASE || 'https://www.connecttrip.co.kr';
export const publicUrl = (pathOrUrl) => {
  const v = String(pathOrUrl || '');
  if (/^https?:\/\//i.test(v)) {
    // 앱에서 만들어진 localhost 주소는 공개 도메인으로 바꾼다
    return v.replace(/^https?:\/\/localhost(?::\d+)?/i, SITE_ORIGIN);
  }
  return `${SITE_ORIGIN}${v.startsWith('/') ? v : `/${v}`}`;
};

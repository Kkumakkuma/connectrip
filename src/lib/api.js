// API 베이스 — 웹은 동일 출처(빈 문자열 = 상대경로, 기존과 동일).
// 안드로이드 앱 빌드(vite build --mode app)에서만 .env.app 의
// VITE_API_BASE=https://www.connecttrip.co.kr 이 주입된다.
// 앱 WebView 오리진은 https://localhost 라 상대경로 fetch 가 전부 실패하기 때문(api/_cors.js 참고).
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
export const apiUrl = (path) => `${API_BASE}${path}`;

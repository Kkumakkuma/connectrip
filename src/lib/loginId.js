// 아이디(login_id) 규칙 — 클라이언트 사본. 서버 사본은 api/_login_id.js (같은 규칙, 바이트 동일하게 유지).
// DB 의 normalize_login_id / login_id_reserved (src/lib/loginid_20260905.sql) 와 같은 규칙이다.
//
// Supabase Auth 는 아이디를 모르므로 Auth email 은 합성 주소 <login_id>@id.connecttrip.co.kr 를 쓴다.
// 이 주소는 수신 불가·표시 금지 — 사용자에게는 아이디만 보인다. 실제 연락 이메일은 profiles.email.

export const LOGIN_ID_RE = /^[a-z0-9_]{4,20}$/;
export const SYNTH_DOMAIN = 'id.connecttrip.co.kr';

export const RESERVED_LOGIN_IDS = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help', 'staff', 'operator', 'manager', 'master',
  'connecttrip', 'connectrip', 'crew', 'official', 'notice', 'null', 'undefined', 'none', 'anonymous', 'guest',
  'login', 'logout', 'signup', 'signin', 'register', 'api', 'auth', 'user', 'users', 'me', 'profile', 'settings',
  'terms', 'privacy', 'policy', 'contact', 'info', 'mail', 'email', 'postmaster', 'webmaster', 'noreply', 'no_reply',
  'test', 'tester', 'payment', 'points', 'planner', 'board', 'dm',
]);

/** 소문자·공백 제거. 형식이 맞으면 아이디, 아니면 ''. */
export function normalizeLoginId(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return LOGIN_ID_RE.test(v) ? v : '';
}

export function isReservedLoginId(loginId) {
  return RESERVED_LOGIN_IDS.has(loginId);
}

/** Auth 용 합성 주소. */
export function synthEmail(loginId) {
  return `${loginId}@${SYNTH_DOMAIN}`;
}

export function isSyntheticEmail(email) {
  return String(email || '').trim().toLowerCase().endsWith(`@${SYNTH_DOMAIN}`);
}

/** 비밀번호 최소 규칙: 8자 이상, 영문·숫자 각 1자 이상. */
export function passwordWeak(pw) {
  const s = String(pw || '');
  return s.length < 8 || s.length > 72 || !/[a-zA-Z]/.test(s) || !/[0-9]/.test(s);
}

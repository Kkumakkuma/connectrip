// 로그인 유지 정책 (2026-09-20, 쿠마님 지시 텔레그램 10061)
//
// "어제 로그인했더라도 자동으로 로그아웃이 안 된다" — supabase-js 기본값은 localStorage 영구 세션 + 토큰 자동
// 갱신이라 한 번 로그인하면 영영 풀리지 않았다. 쿠마님이 준 두 갈래(몇 시간 자리를 비우면 로그아웃 / 로그인할 때
// 유지 여부를 고르게) 를 합쳐서:
//   - 로그인 폼의 '로그인 상태 유지' 체크박스 → 켜면 지금처럼 계속 유지(ct_keep_login = '1').
//   - 끄면(기본) 마지막 활동으로부터 IDLE_LIMIT_MS 가 지나면 로그아웃. 브라우저를 닫아 둔 시간도 활동이 없는
//     시간이므로, 닫았다가 몇 시간 뒤 열면 풀린다. (브라우저 종료 자체는 감지할 수 없다 — sessionStorage 로 하면
//     탭마다 따로라서 새 탭에서 열자마자 비로그인이 되는 게 더 큰 문제였다.)
//   - 앱(Capacitor)에서는 적용하지 않는다 — 앱은 로그인이 유지되는 게 관행이다. 적용 여부는 AuthContext 가 정한다.
//
// 값은 전부 localStorage. 사생활 모드 등 접근이 막히면 정책을 적용하지 않는다(로그아웃시키지 않음 — 안전한 쪽).

export const KEEP_KEY = 'ct_keep_login';
export const LAST_ACTIVE_KEY = 'ct_last_active';

// 비활동 한도. 쿠마님이 "몇 시간씩" 이라고만 했으므로 2시간을 기본으로 두고, 이 숫자 하나로 조절한다.
export const IDLE_LIMIT_MS = 2 * 60 * 60 * 1000;

// 활동 시각 기록 간격 — 스크롤·클릭마다 쓰면 낭비라 이 간격 안에서는 한 번만 쓴다.
export const TOUCH_THROTTLE_MS = 30 * 1000;

const read = (key) => {
  try { return window.localStorage.getItem(key); } catch { return null; }
};
const write = (key, value) => {
  try { window.localStorage.setItem(key, value); return true; } catch { return false; }
};
const remove = (key) => {
  try { window.localStorage.removeItem(key); } catch { /* 무시 */ }
};

export const isKeepLogin = () => read(KEEP_KEY) === '1';

// 로그인 직전에 호출한다. 이전 로그인의 값이 남아 이번 선택을 덮지 않게 매번 다시 쓴다.
export const setKeepLogin = (keep) => {
  if (keep) write(KEEP_KEY, '1'); else remove(KEEP_KEY);
};

export const getLastActive = () => {
  const v = Number(read(LAST_ACTIVE_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
};

export const touchActivity = (now = Date.now()) => write(LAST_ACTIVE_KEY, String(now));

// 지금 로그아웃해야 하는가. 유지 선택이면 절대 아니오. 기록이 없으면(정책 도입 전 로그인·저장 실패) 아니오 —
// 대신 호출부가 지금 시각을 기록해 그때부터 센다. 시계가 거꾸로 간 경우(now < last)도 아니오.
export const isIdleExpired = (now = Date.now(), limit = IDLE_LIMIT_MS) => {
  if (isKeepLogin()) return false;
  const last = getLastActive();
  if (last === null) return false;
  return now - last > limit;
};

// 로그아웃 때 둘 다 지운다. 다음 로그인이 이전 사람의 선택·시각을 물려받지 않게.
export const clearSessionPolicy = () => {
  remove(KEEP_KEY);
  remove(LAST_ACTIVE_KEY);
};

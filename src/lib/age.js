// 만 나이 / 만 14세 미만 판정 공용 헬퍼.
// 서버(legal_20260711.sql)의 `birthdate > CURRENT_DATE - INTERVAL '14 years'` 판정과 동일하게 맞춘다.

// 생년월일(YYYY-MM-DD)이 만 14세 미만이면 true.
// 형식이 잘못됐거나 비어있으면 false(별도 필수검증에서 걸러진다).
export function isUnder14(dateStr) {
  if (!dateStr) return false;
  const bd = new Date(dateStr + 'T00:00:00');
  if (isNaN(bd.getTime())) return false;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setFullYear(cutoff.getFullYear() - 14);
  // 생일이 (오늘 - 14년)보다 이후 = 아직 만 14세가 되지 않음
  return bd.getTime() > cutoff.getTime();
}

// 유효한 생년월일 형식인지(달력에서 고른 값이라 보통 통과)
export function isValidBirthdate(dateStr) {
  if (!dateStr) return false;
  const bd = new Date(dateStr + 'T00:00:00');
  if (isNaN(bd.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return bd.getTime() <= today.getTime() && bd.getFullYear() >= 1900;
}

// 오늘 날짜(YYYY-MM-DD) — date input 의 max 로 사용
export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

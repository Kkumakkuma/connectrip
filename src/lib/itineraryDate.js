// 여행 일정 화면의 날짜 표기.
//
// 다루는 값은 전부 'YYYY-MM-DD'(Postgres date) 문자열이고 시각·시차 개념이 없다.
// ⚠ new Date('2026-10-03') 을 쓰면 안 된다 — 그 형식은 UTC 로 해석돼 UTC- 지역(미주)
//   사용자에게 하루 밀린 날짜·요일이 나온다. 숫자로 쪼개 로컬 Date 를 만든다.

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const pad2 = (n) => String(n).padStart(2, '0');

export function parseDateParts(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

// 2026.10.01
export function formatDate(value) {
  const p = parseDateParts(value);
  return p ? `${p.y}.${pad2(p.m)}.${pad2(p.d)}` : '';
}

// 10.01
export function formatMonthDay(value) {
  const p = parseDateParts(value);
  return p ? `${pad2(p.m)}.${pad2(p.d)}` : '';
}

// 2026.10.01 ~ 10.04 (해가 넘어가면 뒤쪽도 연도까지)
export function formatRange(start, end) {
  const s = parseDateParts(start);
  if (!s) return '';
  const e = parseDateParts(end);
  if (!e) return formatDate(start);
  if (s.y === e.y && s.m === e.m && s.d === e.d) return formatDate(start);
  const tail = s.y === e.y ? formatMonthDay(end) : formatDate(end);
  return `${formatDate(start)} ~ ${tail}`;
}

export function weekdayKo(value) {
  const p = parseDateParts(value);
  if (!p) return '';
  return WEEKDAYS[new Date(p.y, p.m - 1, p.d).getDay()];
}

// 'HH:MM:SS' → '10:30' (Postgres time 은 초까지 온다)
export function formatTime(value) {
  const m = /^(\d{2}):(\d{2})/.exec(String(value || ''));
  return m ? `${m[1]}:${m[2]}` : '';
}

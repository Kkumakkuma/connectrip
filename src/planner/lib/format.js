// 플래너 표시용 형식 변환. 순수 함수만 둔다.
//
// ⚠ 날짜 문자열은 절대 new Date(문자열) 로 파싱하지 않는다. 'YYYY-MM-DD' 는 UTC 자정으로
//   읽혀서 UTC- 지역 사용자에게 하루 밀린다(설계 §6 과 같은 이유). 숫자를 직접 넘긴다.

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

// 'YYYY-MM-DD' → { y, m, d } | null
export function parseDateParts(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

// 'YYYY-MM-DD' → '2026.10.01'
export function formatDate(value) {
  const p = parseDateParts(value);
  if (!p) return '';
  return `${p.y}.${String(p.m).padStart(2, '0')}.${String(p.d).padStart(2, '0')}`;
}

// 'YYYY-MM-DD' → '10월 1일 (목)'
export function formatDateWithWeekday(value) {
  const p = parseDateParts(value);
  if (!p) return '';
  const weekday = new Date(p.y, p.m - 1, p.d).getDay();
  return `${p.m}월 ${p.d}일 (${WEEKDAY_KO[weekday]})`;
}

// '2026.10.01 ~ 2026.10.05'. 끝 날짜가 없으면 시작 날짜만.
export function formatDateRange(start, end) {
  const a = formatDate(start);
  const b = formatDate(end);
  if (!a) return '';
  if (!b || a === b) return a;
  return `${a} ~ ${b}`;
}

// 하루 단위 차이. 두 날짜 모두 유효할 때만 숫자를 돌려준다.
export function daysBetween(start, end) {
  const a = parseDateParts(start);
  const b = parseDateParts(end);
  if (!a || !b) return null;
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86400000);
}

// '4박 5일'. 당일치기는 '하루'.
export function formatTripLength(start, end) {
  const diff = daysBetween(start, end);
  if (diff === null || diff < 0) return '';
  if (diff === 0) return '하루';
  return `${diff}박 ${diff + 1}일`;
}

// 여행 시작일 + n일 → 'YYYY-MM-DD'
export function addDays(value, n) {
  const p = parseDateParts(value);
  if (!p) return '';
  const dt = new Date(p.y, p.m - 1, p.d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// 오늘(현지 기준) 'YYYY-MM-DD'
export function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// 금액 표시. 통화 코드가 이상하면 숫자 + 코드로 떨어뜨린다(Intl 이 던지지 않게).
export function formatMoney(amount, currency = 'KRW') {
  if (!Number.isFinite(Number(amount))) return '';
  const value = Number(amount);
  try {
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString('ko-KR')} ${currency}`;
  }
}

// timestamptz 문자열 비교. PostgREST 는 오프셋이 붙은 ISO 문자열을 주므로 문자열끼리 비교하면
// 오프셋이 다를 때 순서가 뒤집힌다. 반드시 파싱해서 비교한다.
export function isAfter(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return ta > tb;
}

// 여러 timestamptz 중 가장 늦은 값. 하나도 없으면 null.
export function latestTimestamp(values) {
  let best = null;
  let bestMs = -Infinity;
  (values || []).forEach((v) => {
    const ms = Date.parse(v);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = v;
    }
  });
  return best;
}

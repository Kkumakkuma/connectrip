// 여행지 시각 ↔ 절대 시각(UTC) 변환. 순수 함수만 둔다.
//
// 왜 필요한가 (쿠마님 지시 2026-09-04)
//   티켓에 적힌 시각은 언제나 **현지 시각**이다. 도쿄 21:40 출발 기차표는 서울에서 보든
//   도쿄에서 보든 21:40 이다. 그런데 "출발 1시간 전에 알려 줘" 같은 알림은 절대 시각으로
//   계산해야 맞는다. 현지 시각만 저장해 두면 알림이 시차만큼 통째로 어긋난다.
//   그래서 화면에는 적힌 그대로 보여 주고, 알림용 절대 시각을 따로 계산해 둔다.
//
// 타임존 데이터베이스를 번들에 싣지 않는다. 브라우저·Node 에 이미 들어 있는
// Intl.DateTimeFormat 의 timeZone 지원을 쓴다(IANA 이름 그대로).
//
// 서머타임 경계 두 가지를 다룬다.
//   · 없는 시각(봄에 시계를 앞당길 때 02:30 이 존재하지 않음) → 전환 뒤 실제 존재하는 시각으로 민다.
//   · 겹치는 시각(가을에 01:30 이 두 번) → 앞쪽(첫 번째)을 고른다. 달력 앱들의 관례와 같다.

const DTF_CACHE = new Map();

function formatter(timeZone) {
  let f = DTF_CACHE.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    DTF_CACHE.set(timeZone, f);
  }
  return f;
}

/** IANA 타임존 이름이 이 환경에서 실제로 쓸 수 있는 값인지. */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    DTF_CACHE.delete(timeZone);
    return false;
  }
}

/** 어떤 순간(ms)을 그 타임존의 벽시계로 읽어 UTC 기준 ms 로 되돌린다. 오프셋 계산용 중간값. */
function wallClockMs(instantMs, timeZone) {
  const parts = formatter(timeZone).formatToParts(new Date(instantMs));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  // en-US 24시간 형식은 자정을 24 로 내는 구현이 있다(ICU 차이). 0 으로 맞춘다.
  const hour = get('hour') === 24 ? 0 : get('hour');
  return Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
}

/** 그 순간에 이 타임존이 UTC 로부터 몇 ms 앞서 있는지. 서울이면 +9시간. */
export function offsetMsAt(instantMs, timeZone) {
  return wallClockMs(instantMs, timeZone) - instantMs;
}

/**
 * 현지 벽시계 시각 → 절대 시각(Date).
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {string} timeStr 'HH:MM' (없으면 00:00)
 * @param {string} timeZone IANA 이름. 없거나 이상하면 null 을 돌려준다 —
 *                          "모르면 추측하지 않는다"가 이 함수의 원칙이다.
 * @returns {Date|null}
 */
export function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!d) return null;
  if (!isValidTimeZone(timeZone)) return null;

  const t = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || '00:00').trim());
  const hour = t ? Number(t[1]) : 0;
  const minute = t ? Number(t[2]) : 0;
  if (hour > 23 || minute > 59) return null;

  const wanted = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), hour, minute, 0, 0);

  // 1차: 그 시각쯤의 오프셋으로 빼 본다.
  let guess = wanted - offsetMsAt(wanted, timeZone);
  // 2차: 빼고 나서 오프셋이 달라졌다면(전환 구간) 새 오프셋으로 다시 계산한다.
  const second = wanted - offsetMsAt(guess, timeZone);
  if (second !== guess) {
    // 겹치는 시각이면 두 후보 중 앞선 쪽을 고른다.
    guess = Math.min(guess, second);
  }

  // 없는 시각(봄 전환)이면 되돌려 읽었을 때 원하던 벽시계가 안 나온다.
  // 그때는 전환 뒤 첫 유효 시각으로 민다 — 알림이 사라지는 것보다 낫다.
  if (wallClockMs(guess, timeZone) !== wanted) {
    const shifted = wanted - offsetMsAt(guess, timeZone);
    return new Date(Math.max(guess, shifted));
  }
  return new Date(guess);
}

/** 절대 시각 → 그 타임존의 'YYYY-MM-DD HH:MM'. 화면 표시용. */
export function formatInZone(instant, timeZone) {
  const ms = instant instanceof Date ? instant.getTime() : Number(instant);
  if (!Number.isFinite(ms) || !isValidTimeZone(timeZone)) return '';
  const w = new Date(wallClockMs(ms, timeZone));
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-${p(w.getUTCDate())} ` +
    `${p(w.getUTCHours())}:${p(w.getUTCMinutes())}`
  );
}

/** 두 타임존의 시차를 사람이 읽는 문장으로. 같은 시간대면 빈 문자열. */
export function timeZoneGapText(instant, tripZone, viewerZone) {
  const ms = instant instanceof Date ? instant.getTime() : Number(instant);
  if (!Number.isFinite(ms) || !isValidTimeZone(tripZone) || !isValidTimeZone(viewerZone)) return '';
  const gapMin = Math.round((offsetMsAt(ms, tripZone) - offsetMsAt(ms, viewerZone)) / 60000);
  if (gapMin === 0) return '';
  const abs = Math.abs(gapMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const size = m ? `${h}시간 ${m}분` : `${h}시간`;
  return gapMin > 0 ? `현지가 ${size} 빠릅니다` : `현지가 ${size} 느립니다`;
}

// 나라 이름 → 대표 타임존. 여행을 만들 때 타임존을 고르지 않은 사람이 대부분이라,
// 나라만 적어 놨을 때 알림 계산에 쓸 기본값을 준다.
// 나라 전체가 한 시간대인 곳만 넣는다 — 미국·러시아처럼 여러 시간대인 나라는
// 추측하면 틀리므로 넣지 않고, 그런 여행은 사용자가 타임존을 직접 고르게 한다.
const COUNTRY_ZONES = {
  대한민국: 'Asia/Seoul',
  한국: 'Asia/Seoul',
  일본: 'Asia/Tokyo',
  대만: 'Asia/Taipei',
  홍콩: 'Asia/Hong_Kong',
  마카오: 'Asia/Macau',
  싱가포르: 'Asia/Singapore',
  태국: 'Asia/Bangkok',
  베트남: 'Asia/Ho_Chi_Minh',
  필리핀: 'Asia/Manila',
  말레이시아: 'Asia/Kuala_Lumpur',
  캄보디아: 'Asia/Phnom_Penh',
  라오스: 'Asia/Vientiane',
  네팔: 'Asia/Kathmandu',
  베트남하노이: 'Asia/Ho_Chi_Minh',
  중국: 'Asia/Shanghai',
  영국: 'Europe/London',
  프랑스: 'Europe/Paris',
  독일: 'Europe/Berlin',
  이탈리아: 'Europe/Rome',
  스페인: 'Europe/Madrid',
  포르투갈: 'Europe/Lisbon',
  네덜란드: 'Europe/Amsterdam',
  스위스: 'Europe/Zurich',
  오스트리아: 'Europe/Vienna',
  체코: 'Europe/Prague',
  헝가리: 'Europe/Budapest',
  폴란드: 'Europe/Warsaw',
  그리스: 'Europe/Athens',
  튀르키예: 'Europe/Istanbul',
  터키: 'Europe/Istanbul',
  아랍에미리트: 'Asia/Dubai',
  인도: 'Asia/Kolkata',
  인도네시아: 'Asia/Jakarta',
  호주: 'Australia/Sydney',
  뉴질랜드: 'Pacific/Auckland',
  괌: 'Pacific/Guam',
  사이판: 'Pacific/Saipan',
  하와이: 'Pacific/Honolulu',
};

export function zoneForCountry(country) {
  const key = String(country || '').replace(/\s+/g, '');
  const zone = COUNTRY_ZONES[key];
  return zone && isValidTimeZone(zone) ? zone : null;
}

/**
 * 알림 계산에 쓸 타임존을 정한다. 우선순위: 여행에 저장된 타임존 → 나라 이름 → null.
 * null 이면 절대 시각을 만들지 않는다(틀린 알림보다 알림 없는 편이 낫다).
 */
export function resolveTripZone(trip) {
  if (isValidTimeZone(trip?.timezone)) return trip.timezone;
  return zoneForCountry(trip?.country);
}

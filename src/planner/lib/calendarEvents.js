// 플래너 원본 데이터(여행·날짜·장소·티켓) → 캘린더 일정 목록. 순수 함수만 둔다(vitest 대상).
// 같은 일정 하나가 .ics 파일(lib/ics)과 "구글 캘린더에 추가" 링크 양쪽에 쓰인다.
//
// 시각 규칙 (2026-09-27, 운영 DB 실측 근거)
//   · 장소 planned_time 은 `time without time zone` = 그 장소의 벽시계 시각이다.
//     장소 좌표로 찾은 타임존(tz-lookup)으로 절대 시각을 만든다. 좌표가 없으면 여행 타임존.
//   · 티켓 event_date/event_time 은 "티켓에 적힌 현지 시각"이다. 티켓 화면이 "여행지 기준으로 저장합니다"
//     라고 안내하고 알림용 event_at 도 여행 타임존으로 계산하므로 같은 기준(여행 타임존)을 쓴다.
//     항공권만 예외 — 적힌 시각은 출발 공항 시각이라, 출발 공항을 알아내면(lib/airportZones) 그 타임존을 쓴다.
//   · 타임존을 끝내 모르면 부동 시각(현지 시각 그대로)으로 둔다. 추측으로 절대 시각을 만들지 않는다.
//   · planner_trips.timezone 은 2026-09-27 운영 6건 전부 NULL 이라 호출부가 resolveTripZoneAsync 로 구해 넘긴다.
//
// 개인정보: 비공개 메모(note_public=false)는 넣지 않는다(내보내기 화면의 약속과 같다).
// 탑승권 바코드 원문·예약번호·승객 이름은 어떤 칸에도 넣지 않는다 — 출발/도착 공항 코드만 읽는다.

import { isValidTimeZone, zonedTimeToUtc } from './timezone';
import { parseBcbp } from './ticketDate';
import { zoneForAirport } from './airportZones';
import { KIND_LABEL } from './ticketFile';
import { utcStamp } from './ics';

export const PUBLIC_ORIGIN = 'https://www.connecttrip.co.kr';
const UID_DOMAIN = 'connecttrip.co.kr';
const DEFAULT_STAY_MIN = 60;
const GOOGLE_DETAILS_MAX = 500; // 구글 링크 메모 상한(글자). 한글 1자 = %XX 3개 = 9바이트라 아래 주소 예산으로 한 번 더 줄인다.
// 구글 링크 전체 주소 예산(글자). 긴 주소를 받아 주는 한도는 확인하지 못해 보수적으로 잡는다(교차검토 agy 지적).
// 넘치면 메모만 줄인다 — 제목·날짜·장소와 커넥트립 링크는 그대로 둔다. 전체 메모는 .ics 에 온전히 들어간다.
export const GOOGLE_URL_BUDGET = 2000;

function pad(n) {
  return String(n).padStart(2, '0');
}

// 'YYYY-MM-DD' 가 실제 있는 날짜면 {y,m,d}
function dateParts(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').slice(0, 10));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

// 'HH:MM' · 'HH:MM:SS' → 자정부터 분. 이상하면 null
function clockMinutes(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!(h >= 0 && h <= 23) || !(min >= 0 && min <= 59)) return null;
  return h * 60 + min;
}

// 벽시계 산술은 UTC 로 한다(실행 기기의 서머타임이 끼어들지 않게). 결과 문자열에는 Z 를 붙이지 않는다.
function floatingValue(parts, minutes) {
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d, 0, minutes, 0, 0));
  return (
    `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}` +
    `T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00`
  );
}

// 정렬 키 'YYYY-MM-DDTHH:MM'. 시각은 0 을 채워 '9:00' 이 '10:00' 뒤로 가지 않게 한다(교차검토 agy 지적).
function sortKeyOf(dateStr, clock) {
  const parts = dateParts(dateStr);
  const minutes = clockMinutes(clock);
  const day = parts ? `${parts.y}-${pad(parts.m)}-${pad(parts.d)}` : '9999-99-99';
  const hhmm = minutes === null ? '00:00' : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  return `${day}T${hhmm}`;
}

function dateValue(parts, addDays = 0) {
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + addDays));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

/**
 * 시각 범위. duration 이 null 이면 끝을 두지 않는다(티켓 = 출발·입장 "순간").
 * zone 을 알면 절대 시각(utc), 모르면 부동 시각(floating), 시각이 없으면 종일(date).
 */
export function timeRange(dateStr, clock, durationMin, zone) {
  const parts = dateParts(dateStr);
  if (!parts) return null;
  const minutes = clockMinutes(clock);
  if (minutes === null) {
    return { start: { type: 'date', value: dateValue(parts) }, end: { type: 'date', value: dateValue(parts, 1) } };
  }
  const hasEnd = Number.isFinite(durationMin) && durationMin > 0;
  if (zone && isValidTimeZone(zone)) {
    const hhmm = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    const startAt = zonedTimeToUtc(`${parts.y}-${pad(parts.m)}-${pad(parts.d)}`, hhmm, zone);
    if (startAt) {
      const ms = startAt.getTime();
      return {
        start: { type: 'utc', value: utcStamp(ms) },
        end: hasEnd ? { type: 'utc', value: utcStamp(ms + durationMin * 60000) } : null,
      };
    }
  }
  return {
    start: { type: 'floating', value: floatingValue(parts, minutes) },
    end: hasEnd ? { type: 'floating', value: floatingValue(parts, minutes + durationMin) } : null,
  };
}

// UID 에 들어갈 조각. uuid 는 그대로 통과하고, 그 밖의 문자는 지운다.
function uidPart(value) {
  return String(value ?? '').replace(/[^A-Za-z0-9-]/g, '') || 'x';
}

export function eventUid(tripId, kind, itemId) {
  return `${uidPart(tripId)}-${kind}-${uidPart(itemId)}@${UID_DOMAIN}`;
}

function stampOf(iso) {
  const ms = Date.parse(String(iso || ''));
  return Number.isFinite(ms) ? utcStamp(ms) : null;
}

function validGeo(lat, lng) {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a === 0 && b === 0) return null; // 좌표 미입력 핀
  if (a < -90 || a > 90 || b < -180 || b > 180) return null;
  return { lat: a, lng: b };
}

function tripLink(origin, tripId, suffix = '') {
  const base = String(origin || PUBLIC_ORIGIN).replace(/\/+$/, '');
  return `${base}/planner/t/${encodeURIComponent(String(tripId || ''))}${suffix}`;
}

function money(cost, currency) {
  const n = Number(cost);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `예상 비용 ${Math.round(n).toLocaleString('ko-KR')} ${currency || 'KRW'}`;
}

/** 장소 하나 → 일정. 날짜가 없으면(보관함) null. */
export function placeEvent(place, date, { tripId, tripZone = null, placeZone = null, currency = 'KRW', origin = PUBLIC_ORIGIN } = {}) {
  if (!place?.id) return null;
  // 좌표 없는 핀(0,0)의 "장소 타임존"은 믿지 않는다 — tz-lookup 이 바다 한가운데(Etc/GMT)를 돌려준다.
  const geo = validGeo(place.lat, place.lng);
  const zone = geo && isValidTimeZone(placeZone) ? placeZone : isValidTimeZone(tripZone) ? tripZone : null;
  const stay = Number(place.stay_min);
  const range = timeRange(date, place.planned_time, Number.isFinite(stay) && stay > 0 ? stay : DEFAULT_STAY_MIN, zone);
  if (!range) return null;

  const notes = [];
  const cost = money(place.cost, currency);
  if (cost) notes.push(cost);
  if (place.note_public && String(place.note || '').trim()) notes.push(String(place.note).trim());

  return {
    uid: eventUid(tripId, 'p', place.id),
    kind: 'place',
    summary: String(place.name || '').trim() || '장소',
    location: String(place.address || '').trim() || null,
    notes,
    link: tripLink(origin, tripId),
    geo,
    start: range.start,
    end: range.end,
    zone: range.start.type === 'utc' ? zone : null,
    lastModified: stampOf(place.updated_at),
    sortKey: sortKeyOf(date, place.planned_time),
  };
}

const ROUTE_RE = /(?:^|[^A-Z])([A-Z]{3})\s*(?:→|->|>|~|-|–|—)\s*([A-Z]{3})(?![A-Z])/;

/** 항공권 출발·도착 공항 코드. 탑승권 바코드가 먼저, 없으면 제목('KE81 ICN→NRT'). 모르면 null. */
export function flightRoute(ticket) {
  const bcbp = ticket?.barcode_text ? parseBcbp(ticket.barcode_text, null) : null;
  if (bcbp?.from && bcbp?.to) return { from: bcbp.from, to: bcbp.to };
  const m = ROUTE_RE.exec(String(ticket?.title || '').toUpperCase());
  return m ? { from: m[1], to: m[2] } : null;
}

/** 티켓 시각을 읽을 타임존. 항공권은 출발 공항(표에 있을 때), 그 밖은 여행 타임존. */
export function ticketZone(ticket, tripZone) {
  if (ticket?.kind === 'flight') {
    const route = flightRoute(ticket);
    const airportZone = route ? zoneForAirport(route.from) : null;
    if (airportZone && isValidTimeZone(airportZone)) return airportZone;
  }
  return isValidTimeZone(tripZone) ? tripZone : null;
}

export function ticketSummary(ticket) {
  const label = KIND_LABEL[ticket?.kind] || '';
  const title = String(ticket?.title || '').trim();
  if (label && title) return `${label} · ${title}`;
  return title || label || '티켓';
}

/** 티켓 하나 → 일정. 날짜 미확인 티켓은 null. 끝 시각은 저장돼 있지 않아 두지 않는다. */
export function ticketEvent(ticket, { tripId, tripZone = null, place = null, origin = PUBLIC_ORIGIN } = {}) {
  if (!ticket?.id || !ticket.event_date) return null;
  const zone = ticketZone(ticket, tripZone);
  const range = timeRange(ticket.event_date, ticket.event_time, null, zone);
  if (!range) return null;

  const notes = [];
  let location = null;
  if (ticket.kind === 'flight') {
    const route = flightRoute(ticket);
    if (route) {
      notes.push(`출발 ${route.from} → 도착 ${route.to}`);
      location = route.from;
    }
  }
  if (place?.name) {
    notes.push(`장소: ${String(place.name).trim()}`);
    if (!location) location = String(place.address || '').trim() || String(place.name).trim();
  }

  return {
    uid: eventUid(tripId, 't', ticket.id),
    kind: 'ticket',
    summary: ticketSummary(ticket),
    location: location || null,
    notes,
    link: tripLink(origin, tripId, '/tickets'),
    geo: place ? validGeo(place.lat, place.lng) : null,
    start: range.start,
    end: range.end,
    zone: range.start.type === 'utc' ? zone : null,
    lastModified: stampOf(ticket.updated_at),
    sortKey: sortKeyOf(ticket.event_date, ticket.event_time),
  };
}

/** ICS DESCRIPTION·구글 details 본문. 메모 뒤에 커넥트립 여행 링크를 붙인다. */
export function eventDescription(ev, { maxNotes = Infinity } = {}) {
  let body = (ev?.notes || []).filter(Boolean).join('\n');
  // 코드 포인트 단위로 자른다. UTF-16 단위로 자르면 이모지 서로게이트 쌍이 갈라져
  // encodeURIComponent 가 URIError 를 던지고 장소 시트 렌더링이 통째로 죽는다(교차검토 codex 지적).
  const chars = Array.from(body);
  if (chars.length > maxNotes) body = maxNotes >= 1 ? `${chars.slice(0, maxNotes - 1).join('')}…` : '';
  const link = ev?.link ? `커넥트립에서 보기: ${ev.link}` : '';
  return [body, link].filter(Boolean).join('\n\n');
}

/**
 * 여행 전체 → 일정 목록(시간순). 보관함 장소·날짜 미확인 티켓은 빠진다.
 * @param {object} data { trip, days, places, tickets }
 * @param {object} ctx  { tripZone, zoneForPlace(place) → IANA|null, origin }
 */
export function buildCalendarEvents({ trip, days = [], places = [], tickets = [] } = {}, { tripZone = null, zoneForPlace = null, origin = PUBLIC_ORIGIN } = {}) {
  if (!trip?.id) return [];
  const dateOf = new Map((days || []).map((d) => [d?.id, d?.date]));
  const placeById = new Map((places || []).map((p) => [p?.id, p]));
  const currency = trip.currency || 'KRW';
  const events = [];

  (places || []).forEach((p) => {
    if (!p?.day_id || !dateOf.has(p.day_id)) return;
    const zone = typeof zoneForPlace === 'function' ? zoneForPlace(p) : null;
    const ev = placeEvent(p, dateOf.get(p.day_id), { tripId: trip.id, tripZone, placeZone: zone, currency, origin });
    if (ev) events.push({ ...ev, description: eventDescription(ev) });
  });

  (tickets || []).forEach((t) => {
    const ev = ticketEvent(t, { tripId: trip.id, tripZone, place: t?.place_id ? placeById.get(t.place_id) : null, origin });
    if (ev) events.push({ ...ev, description: eventDescription(ev) });
  });

  return events.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.summary.localeCompare(b.summary, 'ko'));
}

/**
 * "구글 캘린더에 추가" 주소. 구글 캘린더 앱이 .ics 를 못 가져오는 기기를 위한 길.
 * dates: 종일 'YYYYMMDD/YYYYMMDD'(끝은 다음 날), 절대 시각 '…Z/…Z', 타임존 모름 '…/…'(구글이 사용자 시간대로 읽는다).
 * 끝이 없는 일정(티켓)은 시작과 같은 값을 넣는다.
 */
export function googleCalendarUrl(ev) {
  if (!ev?.start?.value) return null;
  const endValue = ev.end?.type === ev.start.type ? ev.end.value : ev.start.value;
  const build = (maxNotes) => {
    const params = [
      ['action', 'TEMPLATE'],
      ['text', ev.summary || '일정'],
      ['dates', `${ev.start.value}/${endValue}`],
      ['details', eventDescription(ev, { maxNotes })],
    ];
    if (ev.location) params.push(['location', ev.location]);
    const query = params
      .filter(([, v]) => v !== '' && v != null)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    return `https://calendar.google.com/calendar/render?${query}`;
  };
  const full = build(GOOGLE_DETAILS_MAX);
  if (full.length <= GOOGLE_URL_BUDGET) return full;
  // 예산 안에 드는 가장 긴 메모 길이를 이분 탐색으로 찾는다. 메모를 다 빼도 넘치면(제목·주소가 아주 긴 경우) 그대로 돌려준다.
  let lo = 0;
  let hi = GOOGLE_DETAILS_MAX;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (build(mid).length <= GOOGLE_URL_BUDGET) lo = mid;
    else hi = mid - 1;
  }
  return build(lo);
}

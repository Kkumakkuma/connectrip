// 캘린더 일정(lib/calendarEvents 가 만든 정규화된 일정) → iCalendar 파일(RFC 5545). 순수 함수만 둔다.
//
// 시각 표기 세 가지 (2026-09-27 개편 — 예전에는 전부 부동 시각이었다)
//   utc      DTSTART:20261001T013000Z   여행지 타임존을 알면 이걸 쓴다. 절대 시각이라 어느 앱·어느 나라에서 봐도 같은 순간이다.
//   floating DTSTART:20261001T103000    타임존을 모를 때만. "보는 쪽 현지 시각"으로 해석된다.
//   date     DTSTART;VALUE=DATE:20261001 시각이 없는 일정(종일).
//
//   예전 방식(전부 부동 시각)을 버린 이유: 구글 캘린더는 부동 시각을 가져올 때 **캘린더 설정 시간대**로
//   고정한다. 서울 캘린더에 파리 10:30 을 넣으면 서울 10:30 으로 박혀 파리에 가면 03:30 으로 보인다.
//   TZID 를 쓰면 VTIMEZONE 블록을 같이 넣어야 규격에 맞는데(RFC 5545 3.2.19), 타임존 규칙 데이터를
//   번들에 실어야 한다. UTC 는 VTIMEZONE 없이 규격을 지키고, 오프셋은 lib/timezone 이 Intl 로 계산한다.
//
// 지키는 것: CRLF 줄바꿈, 75옥텟 줄 접기(UTF-8 바이트 기준, 글자 중간을 자르지 않음), TEXT 이스케이프,
// UID·DTSTAMP 필수, VEVENT 가 하나도 없으면 파일을 만들지 않는다(RFC 5545 3.6: 구성요소 1개 이상).

const CRLF = '\r\n';
const ENCODER = new TextEncoder(); // 줄 접기마다 새로 만들지 않는다

// 텍스트 값 이스케이프. 역슬래시가 먼저다 — 뒤에 하면 우리가 넣은 이스케이프를 또 이스케이프한다.
export function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// 75옥텟 폴딩. 옥텟 기준이라 한글(UTF-8 3바이트)·이모지(4바이트)에서도 규격을 넘지 않는다.
// for...of 는 코드 포인트 단위로 돌기 때문에 멀티바이트 글자·서로게이트 쌍이 줄 사이에서 쪼개지지 않는다.
// 이어지는 줄은 공백 한 칸으로 시작한다(그 한 칸도 75옥텟에 들어간다).
export function foldLine(line) {
  const enc = ENCODER;
  if (enc.encode(line).length <= 75) return line;

  const out = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    if (curBytes + size > limit) {
      out.push(cur);
      cur = ch;
      curBytes = size;
      limit = 74;
    } else {
      cur += ch;
      curBytes += size;
    }
  }
  if (cur) out.push(cur);
  return out.map((part, i) => (i === 0 ? part : ` ${part}`)).join(CRLF);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** 절대 시각(ms) → 'YYYYMMDDTHHMMSSZ' */
export function utcStamp(ms) {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// 시각 하나를 속성 줄로. type 이 이상하면 null(그 일정은 통째로 건너뛴다).
function timeProp(name, t) {
  if (!t || typeof t.value !== 'string') return null;
  if (t.type === 'date' && /^\d{8}$/.test(t.value)) return `${name};VALUE=DATE:${t.value}`;
  if (t.type === 'utc' && /^\d{8}T\d{6}Z$/.test(t.value)) return `${name}:${t.value}`;
  if (t.type === 'floating' && /^\d{8}T\d{6}$/.test(t.value)) return `${name}:${t.value}`;
  return null;
}

function eventLines(ev, stamp) {
  const start = timeProp('DTSTART', ev?.start);
  if (!start || !ev?.uid) return null;
  const end = ev.end ? timeProp('DTEND', ev.end) : null;
  // DTEND 는 DTSTART 와 같은 형식이어야 한다(RFC 5545 3.8.2.2). 섞이면 버린다 — 끝을 모르는 일정이 된다.
  const endOk = end && ev.end.type === ev.start.type;

  const lines = ['BEGIN:VEVENT', `UID:${ev.uid}`, `DTSTAMP:${stamp}`];
  if (ev.lastModified && /^\d{8}T\d{6}Z$/.test(ev.lastModified)) lines.push(`LAST-MODIFIED:${ev.lastModified}`);
  lines.push(start);
  if (endOk) lines.push(end);
  lines.push(`SUMMARY:${escapeText(ev.summary || '일정')}`);
  if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
  const lat = Number(ev.geo?.lat);
  const lng = Number(ev.geo?.lng);
  if (ev.geo && Number.isFinite(lat) && Number.isFinite(lng)) {
    lines.push(`GEO:${Number(lat.toFixed(6))};${Number(lng.toFixed(6))}`);
  }
  lines.push('END:VEVENT');
  return lines;
}

/**
 * 일정 목록 → .ics 문자열. 넣을 일정이 하나도 없으면 null.
 * @param {Array} events lib/calendarEvents 의 buildCalendarEvents 결과
 * @param {object} opts
 * @param {string} opts.calName X-WR-CALNAME (여행 이름)
 * @param {string} opts.stamp   DTSTAMP('YYYYMMDDTHHMMSSZ'). 테스트에서 고정하려고 주입받는다.
 */
export function buildIcs(events, { calName = '', stamp = null } = {}) {
  const now = stamp && /^\d{8}T\d{6}Z$/.test(stamp) ? stamp : utcStamp(Date.now());
  const body = [];
  (Array.isArray(events) ? events : []).forEach((ev) => {
    const lines = eventLines(ev, now);
    if (lines) body.push(...lines);
  });
  if (body.length === 0) return null;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ConnectTrip//Planner//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calName || '여행 일정')}`,
    ...body,
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// 파일 이름 본문. 글자·숫자·공백·-_() 만 남긴다.
//   앱의 공유 플러그인은 MimeTypeMap.getFileExtensionFromUrl 로 MIME 을 정하는데, 이 함수는 파일 이름에
//   !~'& 같은 문자가 있으면 확장자를 못 읽어 text/calendar 대신 */* 로 공유한다(캘린더 앱이 목록에서 밀린다).
export function safeFileBase(title) {
  const cleaned = String(title || '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s\-_()]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-_.\s]+/, '');
  return cleaned.slice(0, 60).trim() || '여행일정';
}

/** 캘린더 파일 이름: '여행이름_커넥트립.ics' */
export function calendarFileName(title) {
  return `${safeFileBase(title)}_커넥트립.ics`;
}

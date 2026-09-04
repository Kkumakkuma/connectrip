// 스냅샷(설계 §3) → ICS 달력 파일. 순수 함수만 둔다.
//
// npm 의 `ics` 패키지를 쓰지 않는 이유 (설계 §7.2 codex-23 의 지적을 다른 방식으로 해결)
//   ics@3.x 는 기본 출력이 "실행 기기의 로컬 시각 → UTC" 변환이다. 서울에서 도쿄 여행 일정을
//   내보내면 10:30 이 09:30 으로 어긋난다. 인자로 UTC 배열을 만들어 넘기려면 여행지 타임존의
//   오프셋을 우리가 알아야 하는데, 그러려면 IANA 타임존 데이터가 필요하다.
//
//   그래서 **부동 시각(floating time)** 으로 쓴다. DTSTART:20261001T103000 처럼 Z 도 TZID 도
//   붙이지 않으면, 달력 앱은 그 시각을 "보는 기기의 현지 시각"으로 해석한다. 여행자는 현지에서
//   일정을 보므로 이게 실제로 원하는 동작이다(10:30 에 간다 = 현지 10:30). 변환이 아예 없으니
//   어긋날 여지도 없다. TZID 를 쓰면 VTIMEZONE 블록을 함께 넣어야 규격에 맞고, 그러려면
//   타임존 데이터베이스를 번들에 실어야 한다 — 얻는 것에 비해 비싸다.
//
// RFC 5545 에서 지키는 것: CRLF 줄바꿈, 75옥텟 폴딩, 텍스트 이스케이프, UID·DTSTAMP 필수.

const CRLF = '\r\n';
const DEFAULT_STAY_MIN = 60;

// 텍스트 값 이스케이프. 역슬래시가 먼저다 — 뒤에 하면 우리가 넣은 이스케이프를 또 이스케이프한다.
export function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// 75옥텟 폴딩. 옥텟 기준이라 한글(UTF-8 3바이트)에서도 규격을 넘지 않는다.
// 이어지는 줄은 공백 한 칸으로 시작한다.
export function foldLine(line) {
  const enc = new TextEncoder();
  const bytes = enc.encode(line);
  if (bytes.length <= 75) return line;

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
      limit = 74; // 이어지는 줄은 앞에 공백 한 칸이 붙는다
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

// 'YYYY-MM-DD' → '20261001'
function dateValue(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

// 'HH:MM' 또는 'HH:MM:SS' → { h, m }
function clockParts(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!(h >= 0 && h <= 23) || !(min >= 0 && min <= 59)) return null;
  return { h, m: min };
}

// 부동 시각 문자열. 하루를 넘기면 날짜를 넘겨 준다(체류가 자정을 넘는 경우).
//
// 달력 산술은 UTC 로 한다. new Date(y, m, d, ...) 와 getHours() 는 실행 환경의 로컬
// 타임존을 타서, 서머타임 전환일에는 존재하지 않는 시각이 조용히 밀린다(codex 지적).
// 출력 문자열에는 Z 를 붙이지 않으므로 결과는 여전히 부동 시각이다 — 산술만 중립으로 한다.
function floatingStamp(dateStr, minutesFromMidnight) {
  const base = dateValue(dateStr);
  if (!base) return null;
  const y = Number(base.slice(0, 4));
  const mo = Number(base.slice(4, 6));
  const d = Number(base.slice(6, 8));
  const dt = new Date(Date.UTC(y, mo - 1, d, 0, minutesFromMidnight, 0, 0));
  return (
    `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}` +
    `T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00`
  );
}

// 다음 날 'YYYYMMDD' (종일 이벤트의 DTEND 는 배타적이라 하루를 더해야 한다)
function nextDateValue(dateStr) {
  const base = dateValue(dateStr);
  if (!base) return null;
  const dt = new Date(Date.UTC(Number(base.slice(0, 4)), Number(base.slice(4, 6)) - 1, Number(base.slice(6, 8)) + 1));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function describe(place, currency) {
  const bits = [];
  if (place?.address) bits.push(place.address);
  const cost = Number(place?.cost);
  if (Number.isFinite(cost) && cost > 0) bits.push(`예상 비용 ${cost.toLocaleString('ko-KR')} ${currency}`);
  if (place?.note) bits.push(place.note);
  return bits.join('\n');
}

/**
 * 스냅샷을 ICS 문자열로 만든다.
 * @param {object} snapshot 설계 §3 스냅샷
 * @param {object} opts
 * @param {string} opts.uidSeed  UID 를 안정적으로 만들기 위한 씨앗(보통 여행 id)
 * @param {string} opts.stamp    DTSTAMP 값('YYYYMMDDTHHMMSSZ'). 테스트에서 고정하려고 주입받는다.
 */
export function buildIcs(snapshot, { uidSeed = 'trip', stamp = null } = {}) {
  const currency = snapshot?.currency || 'KRW';
  const now =
    stamp ||
    (() => {
      const d = new Date();
      return (
        `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
        `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
      );
    })();

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ConnectTrip//Planner//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(snapshot?.title || '여행 일정')}`,
  ];

  asArray(snapshot?.days).forEach((day, dayIdx) => {
    const date = day?.date;
    if (!dateValue(date)) return;
    asArray(day.places).forEach((place, placeIdx) => {
      const uid = `${uidSeed}-${dayIdx}-${place?.order ?? placeIdx}@connecttrip.co.kr`;
      const clock = clockParts(place?.planned_time);
      const ev = ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${now}`];

      if (clock) {
        const startMin = clock.h * 60 + clock.m;
        const stay = Number(place?.stay_min);
        const dur = Number.isFinite(stay) && stay > 0 ? stay : DEFAULT_STAY_MIN;
        ev.push(`DTSTART:${floatingStamp(date, startMin)}`);
        ev.push(`DTEND:${floatingStamp(date, startMin + dur)}`);
      } else {
        // 시각이 없는 핀은 그 날짜의 종일 일정으로 둔다. DTEND 는 배타적이라 다음 날을 쓴다.
        ev.push(`DTSTART;VALUE=DATE:${dateValue(date)}`);
        ev.push(`DTEND;VALUE=DATE:${nextDateValue(date)}`);
      }

      ev.push(`SUMMARY:${escapeText(place?.name || '장소')}`);
      if (place?.address) ev.push(`LOCATION:${escapeText(place.address)}`);
      const desc = describe(place, currency);
      if (desc) ev.push(`DESCRIPTION:${escapeText(desc)}`);
      const lat = Number(place?.lat);
      const lng = Number(place?.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
        ev.push(`GEO:${lat};${lng}`);
      }
      ev.push('END:VEVENT');
      lines.push(...ev);
    });
  });

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// 파일 이름. 확장자를 뺀 본문만 만들고 호출부가 붙인다.
export function safeFileBase(title) {
  const cleaned = String(title || '여행일정')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 60) || '여행일정';
}

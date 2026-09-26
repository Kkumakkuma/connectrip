// 여행 → 캘린더 파일(.ics) 만들기 + 저장/공유. 일정판 더보기와 내보내기 화면이 같이 쓴다.
// 순수 계산은 lib/calendarEvents · lib/ics 에 있고, 여기서는 타임존을 비동기로 구하고 파일을 건넨다.
import { SITE_ORIGIN } from '../../lib/api';
import { listTickets } from '../api';
import { buildCalendarEvents } from './calendarEvents';
import { buildIcs, calendarFileName } from './ics';
import { saveTextFile } from './fileSave';
import { resolveTripZoneAsync, zoneForCoords } from './timezone';

/**
 * 장소마다 좌표로 타임존을 구한다(tz-lookup, 오프라인 데이터). 같은 좌표는 한 번만 찾는다.
 * 날짜에 배정된 장소만 본다 — 보관함 장소는 캘린더에 들어가지 않는다.
 */
async function placeZones(places) {
  const byKey = new Map();
  const out = new Map();
  for (const p of places || []) {
    if (!p?.day_id) continue;
    const key = `${p.lat},${p.lng}`;
    if (!byKey.has(key)) byKey.set(key, await zoneForCoords(p.lat, p.lng).catch(() => null));
    out.set(p.id, byKey.get(key));
  }
  return out;
}

/**
 * @param {object} data { trip, days, places, tickets? } — tickets 를 안 주면 서버에서 읽는다.
 * @returns {{ text: string|null, count: number, fileName: string, ticketsFailed: boolean }}
 */
export async function prepareTripCalendar({ trip, days = [], places = [], tickets } = {}) {
  if (!trip?.id) return { text: null, count: 0, fileName: calendarFileName(''), ticketsFailed: false };
  let ticketRows = tickets;
  let ticketsFailed = false;
  if (!Array.isArray(ticketRows)) {
    try {
      ticketRows = await listTickets(trip.id);
    } catch {
      // 티켓을 못 읽어도 장소 일정은 내보낸다. 빠졌다는 건 화면이 알린다.
      ticketRows = [];
      ticketsFailed = true;
    }
  }
  const [tripZone, zones] = await Promise.all([
    resolveTripZoneAsync(trip, places).catch(() => null),
    placeZones(places),
  ]);
  const events = buildCalendarEvents(
    { trip, days, places, tickets: ticketRows },
    { tripZone, zoneForPlace: (p) => zones.get(p.id) || null, origin: SITE_ORIGIN },
  );
  return {
    text: buildIcs(events, { calName: trip?.title || '' }),
    count: events.length,
    fileName: calendarFileName(trip?.title),
    ticketsFailed,
  };
}

/** 만든 파일을 건넨다. 'downloaded' | 'shared' | 'cancelled' */
export function saveTripCalendar({ text, fileName }) {
  return saveTextFile({ fileName, text, mime: 'text/calendar', dialogTitle: '캘린더 앱 선택' });
}

import { describe, it, expect } from 'vitest';
import {
  GOOGLE_URL_BUDGET,
  buildCalendarEvents,
  eventDescription,
  eventUid,
  flightRoute,
  googleCalendarUrl,
  placeEvent,
  ticketEvent,
  ticketSummary,
  ticketZone,
  timeRange,
} from './calendarEvents';
import { buildIcs } from './ics';
import { airportCount, zoneForAirport } from './airportZones';

const TRIP_ID = '11111111-2222-3333-4444-555555555555';

function data(overrides = {}) {
  return {
    trip: { id: TRIP_ID, title: '파리 5일', currency: 'EUR', start_date: '2026-10-01', end_date: '2026-10-05' },
    days: [
      { id: 'd1', day_index: 0, date: '2026-10-01' },
      { id: 'd2', day_index: 1, date: '2026-10-02' },
    ],
    places: [
      {
        id: 'p-louvre',
        day_id: 'd1',
        sort_order: 0,
        name: '루브르 박물관',
        address: 'Rue de Rivoli, 75001 Paris',
        lat: 48.8606,
        lng: 2.3376,
        planned_time: '10:30:00',
        stay_min: 120,
        cost: 22,
        note: '비밀 메모',
        note_public: false,
        updated_at: '2026-09-20T01:02:03Z',
      },
      {
        id: 'p-eiffel',
        day_id: 'd1',
        sort_order: 1,
        name: '에펠탑',
        address: '',
        lat: 48.8584,
        lng: 2.2945,
        planned_time: null,
        stay_min: null,
        cost: null,
        note: '해 질 녘',
        note_public: true,
      },
      { id: 'p-spare', day_id: null, name: '보관함 장소', lat: 48.85, lng: 2.35 },
    ],
    tickets: [],
    ...overrides,
  };
}

const PARIS = { tripZone: 'Europe/Paris', zoneForPlace: () => 'Europe/Paris' };

describe('timeRange', () => {
  it('시각이 없으면 종일(끝은 다음 날, 배타적)', () => {
    expect(timeRange('2026-12-31', null, 60, 'Asia/Tokyo')).toEqual({
      start: { type: 'date', value: '20261231' },
      end: { type: 'date', value: '20270101' },
    });
  });

  it('타임존을 알면 UTC 절대 시각 — 도쿄 10:30 = 01:30Z', () => {
    expect(timeRange('2026-10-01', '10:30', 90, 'Asia/Tokyo')).toEqual({
      start: { type: 'utc', value: '20261001T013000Z' },
      end: { type: 'utc', value: '20261001T030000Z' },
    });
  });

  it('서머타임: 파리 여름(+2)과 겨울(+1)', () => {
    expect(timeRange('2026-07-01', '10:00', 60, 'Europe/Paris').start.value).toBe('20260701T080000Z');
    expect(timeRange('2026-12-01', '10:00', 60, 'Europe/Paris').start.value).toBe('20261201T090000Z');
  });

  it('서머타임 시작 밤의 없는 시각(파리 3/29 02:30)은 전환 뒤로 민다', () => {
    // 02:30 은 존재하지 않는다 → 03:30 CEST = 01:30Z
    expect(timeRange('2026-03-29', '02:30', 60, 'Europe/Paris').start.value).toBe('20260329T013000Z');
  });

  it('체류가 서머타임 끝(10/25)을 넘어도 끝 = 시작 + 체류(절대 시간)', () => {
    const r = timeRange('2026-10-25', '01:00', 180, 'Europe/Paris');
    expect(r.start.value).toBe('20261024T230000Z');
    expect(r.end.value).toBe('20261025T020000Z');
  });

  it('타임존을 모르면 부동 시각, 자정을 넘기면 날짜도 넘어간다', () => {
    expect(timeRange('2026-10-01', '23:30', 90, null)).toEqual({
      start: { type: 'floating', value: '20261001T233000' },
      end: { type: 'floating', value: '20261002T010000' },
    });
  });

  it('끝 없음(duration null) → end null', () => {
    expect(timeRange('2026-10-01', '09:00', null, 'Asia/Seoul')).toEqual({
      start: { type: 'utc', value: '20261001T000000Z' },
      end: null,
    });
  });

  it('없는 날짜·이상한 시각', () => {
    expect(timeRange('2026-02-30', '10:00', 60, 'Asia/Seoul')).toBeNull();
    expect(timeRange('2026-10-01', '25:00', 60, 'Asia/Seoul').start.type).toBe('date');
  });
});

describe('placeEvent / buildCalendarEvents', () => {
  it('날짜에 배정된 장소만, 보관함은 빠진다', () => {
    const events = buildCalendarEvents(data(), PARIS);
    expect(events.map((e) => e.summary)).toEqual(['에펠탑', '루브르 박물관']); // 종일(00:00) 이 먼저
    expect(events.find((e) => e.summary === '보관함 장소')).toBeUndefined();
  });

  it('시각 있는 장소: 장소 타임존 기준 UTC, 체류 시간만큼 끝', () => {
    const louvre = buildCalendarEvents(data(), PARIS).find((e) => e.summary === '루브르 박물관');
    expect(louvre.start).toEqual({ type: 'utc', value: '20261001T083000Z' }); // 10:30 CEST
    expect(louvre.end).toEqual({ type: 'utc', value: '20261001T103000Z' });
    expect(louvre.location).toBe('Rue de Rivoli, 75001 Paris');
    expect(louvre.geo).toEqual({ lat: 48.8606, lng: 2.3376 });
    expect(louvre.lastModified).toBe('20260920T010203Z');
  });

  it('장소 좌표 타임존이 여행 타임존보다 먼저다(다른 나라를 거치는 여행)', () => {
    const d = data();
    const events = buildCalendarEvents(d, {
      tripZone: 'Europe/Paris',
      zoneForPlace: (p) => (p.id === 'p-louvre' ? 'Europe/London' : null),
    });
    expect(events.find((e) => e.summary === '루브르 박물관').start.value).toBe('20261001T093000Z'); // 10:30 BST
  });

  it('비공개 메모는 빠지고 공개 메모·예상 비용·여행 링크는 들어간다', () => {
    const events = buildCalendarEvents(data(), PARIS);
    const louvre = events.find((e) => e.summary === '루브르 박물관');
    const eiffel = events.find((e) => e.summary === '에펠탑');
    expect(louvre.description).not.toContain('비밀');
    expect(louvre.description).toContain('예상 비용 22 EUR');
    expect(eiffel.description).toContain('해 질 녘');
    expect(eiffel.description).toContain(`커넥트립에서 보기: https://www.connecttrip.co.kr/planner/t/${TRIP_ID}`);
    expect(eiffel.location).toBeNull(); // 주소가 없으면 LOCATION 을 넣지 않는다
  });

  it('링크는 넘겨준 공개 주소를 쓰고 앱 오리진(localhost)을 쓰지 않는다', () => {
    const events = buildCalendarEvents(data(), { ...PARIS, origin: 'https://www.connecttrip.co.kr/' });
    events.forEach((e) => {
      expect(e.link.startsWith('https://www.connecttrip.co.kr/planner/t/')).toBe(true);
      expect(e.link).not.toContain('localhost');
    });
  });

  it('UID 는 여행 id + 항목 id — 순서를 바꾸거나 내용을 고쳐도 그대로다', () => {
    const a = buildCalendarEvents(data(), PARIS).map((e) => e.uid).sort();
    const d = data();
    d.places = [...d.places].reverse().map((p) => ({ ...p, sort_order: 9, name: `${p.name} 수정`, planned_time: '15:00' }));
    const b = buildCalendarEvents(d, PARIS).map((e) => e.uid).sort();
    expect(b).toEqual(a);
    expect(a).toContain(`${TRIP_ID}-p-p-louvre@connecttrip.co.kr`);
    expect(new Set(a).size).toBe(a.length);
  });

  it('eventUid 는 이상한 문자를 지운다', () => {
    expect(eventUid('a b/c', 'p', 'x@y')).toBe('abc-p-xy@connecttrip.co.kr');
  });

  it('빈 여행 → 일정 0, .ics 는 null', () => {
    const empty = data({ places: [], tickets: [] });
    expect(buildCalendarEvents(empty, PARIS)).toEqual([]);
    expect(buildIcs(buildCalendarEvents(empty, PARIS))).toBeNull();
    const spareOnly = data({ places: [{ id: 'p', day_id: null, name: 'x', lat: 1, lng: 1 }] });
    expect(buildIcs(buildCalendarEvents(spareOnly, PARIS))).toBeNull();
    expect(buildCalendarEvents({}, PARIS)).toEqual([]);
  });

  it('타임존을 전혀 모르면 부동 시각으로 내보낸다', () => {
    const louvre = buildCalendarEvents(data(), { tripZone: null, zoneForPlace: () => null }).find(
      (e) => e.summary === '루브르 박물관',
    );
    expect(louvre.start).toEqual({ type: 'floating', value: '20261001T103000' });
  });

  it('좌표 없는 핀(0,0)은 장소 타임존을 무시하고 여행 타임존을 쓴다', () => {
    const ev = placeEvent(
      { id: 'z', name: '좌표 없음', lat: 0, lng: 0, planned_time: '20:00' },
      '2026-10-26',
      { tripId: TRIP_ID, tripZone: 'Europe/Paris', placeZone: 'Etc/GMT' },
    );
    expect(ev.start.value).toBe('20261026T190000Z'); // 파리 겨울 시간 +1
    expect(ev.geo).toBeNull();
  });

  it('시각이 한 자리(9:00)여도 10:00 보다 앞에 온다', () => {
    const d = data({
      places: [
        { id: 'a', day_id: 'd1', name: '열 시', lat: 48.86, lng: 2.33, planned_time: '10:00' },
        { id: 'b', day_id: 'd1', name: '아홉 시', lat: 48.86, lng: 2.33, planned_time: '9:00' },
      ],
      tickets: [{ id: 't', kind: 'train', title: '여덟 시 기차', event_date: '2026-10-01', event_time: '8:05' }],
    });
    expect(buildCalendarEvents(d, PARIS).map((e) => e.summary)).toEqual(['기차 · 여덟 시 기차', '아홉 시', '열 시']);
  });

  it('체류 시간이 없거나 0 이면 60분', () => {
    const d = data();
    d.places[0].stay_min = 0;
    const louvre = placeEvent(d.places[0], '2026-10-01', { tripId: TRIP_ID, placeZone: 'Europe/Paris' });
    expect(louvre.end.value).toBe('20261001T093000Z');
  });
});

describe('항공권·티켓', () => {
  const places = data().places;

  it('flightRoute: 제목 "KE81 ICN→CDG"', () => {
    expect(flightRoute({ title: 'KE81 ICN→CDG' })).toEqual({ from: 'ICN', to: 'CDG' });
    expect(flightRoute({ title: 'oz 501 icn-cdg' })).toEqual({ from: 'ICN', to: 'CDG' });
    expect(flightRoute({ title: '파리행' })).toBeNull();
  });

  it('flightRoute: 탑승권 바코드(BCBP)가 제목보다 먼저, 승객 이름·예약번호는 쓰지 않는다', () => {
    const bcbp = 'M1HONG/GILDONG        EABC123 ICNCDGKE 0901 274Y012A0001 100';
    const t = { kind: 'flight', title: 'KE901 GMP→HND', barcode_text: bcbp };
    expect(flightRoute(t)).toEqual({ from: 'ICN', to: 'CDG' });
    const ev = ticketEvent({ ...t, id: 't1', event_date: '2026-10-01', event_time: '13:10' }, { tripId: TRIP_ID, tripZone: 'Europe/Paris' });
    const all = JSON.stringify(ev);
    expect(all).not.toContain('HONG');
    expect(all).not.toContain('ABC123');
  });

  it('인천 출발 파리행: 적힌 13:10 은 서울 시각 → 04:10Z (여행 타임존 파리로 읽으면 11:10Z 로 틀린다)', () => {
    const ev = ticketEvent(
      { id: 't1', kind: 'flight', title: 'KE901 ICN→CDG', event_date: '2026-10-01', event_time: '13:10:00' },
      { tripId: TRIP_ID, tripZone: 'Europe/Paris' },
    );
    expect(ev.start).toEqual({ type: 'utc', value: '20261001T041000Z' });
    expect(ev.end).toBeNull(); // 도착 시각은 저장돼 있지 않다
    expect(ev.summary).toBe('항공권 · KE901 ICN→CDG');
    expect(ev.location).toBe('ICN');
    expect(ev.notes).toContain('출발 ICN → 도착 CDG');
    expect(ev.link).toBe(`https://www.connecttrip.co.kr/planner/t/${TRIP_ID}/tickets`);
  });

  it('파리 출발 귀국편: 파리 시각(+2) → 10/05 12:20 = 10:20Z', () => {
    const ev = ticketEvent(
      { id: 't2', kind: 'flight', title: 'KE902 CDG→ICN', event_date: '2026-10-05', event_time: '12:20' },
      { tripId: TRIP_ID, tripZone: 'Asia/Seoul' },
    );
    expect(ev.start.value).toBe('20261005T102000Z');
  });

  it('표에 없는 공항·공항을 모르는 항공권은 여행 타임존', () => {
    expect(ticketZone({ kind: 'flight', title: 'XX1 AAA→BBB' }, 'Europe/Paris')).toBe('Europe/Paris');
    expect(ticketZone({ kind: 'flight', title: '항공권' }, 'Europe/Paris')).toBe('Europe/Paris');
    expect(ticketZone({ kind: 'flight', title: 'KE1 ICN→CDG' }, null)).toBe('Asia/Seoul');
    expect(ticketZone({ kind: 'train', title: 'ICN→CDG' }, 'Europe/Paris')).toBe('Europe/Paris');
    expect(ticketZone({ kind: 'hotel' }, null)).toBeNull();
  });

  it('숙소 티켓: 시각 없으면 종일, 장소가 붙어 있으면 그 장소가 LOCATION·GEO', () => {
    const ev = ticketEvent(
      { id: 't3', kind: 'hotel', title: '호텔 루브르', event_date: '2026-10-01', event_time: null, place_id: 'p-louvre' },
      { tripId: TRIP_ID, tripZone: 'Europe/Paris', place: places[0] },
    );
    expect(ev.start).toEqual({ type: 'date', value: '20261001' });
    expect(ev.end).toEqual({ type: 'date', value: '20261002' });
    expect(ev.location).toBe('Rue de Rivoli, 75001 Paris');
    expect(ev.geo).toEqual({ lat: 48.8606, lng: 2.3376 });
    expect(ev.summary).toBe('숙소 · 호텔 루브르');
  });

  it('날짜 미확인 티켓은 빠진다', () => {
    expect(ticketEvent({ id: 't4', kind: 'ticket', event_date: null }, { tripId: TRIP_ID })).toBeNull();
  });

  it('ticketSummary 기본값', () => {
    expect(ticketSummary({})).toBe('티켓');
    expect(ticketSummary({ kind: 'train' })).toBe('기차');
    expect(ticketSummary({ title: '뮤지컬' })).toBe('뮤지컬');
  });

  it('buildCalendarEvents 에 티켓이 섞여 시간순으로 들어가고 UID 가 장소와 겹치지 않는다', () => {
    const d = data({
      tickets: [
        { id: 'p-louvre', kind: 'flight', title: 'KE901 ICN→CDG', event_date: '2026-10-01', event_time: '13:10' },
        { id: 'tt', kind: 'ticket', title: '오르세', event_date: null },
      ],
    });
    const events = buildCalendarEvents(d, PARIS);
    expect(events).toHaveLength(3);
    const uids = events.map((e) => e.uid);
    expect(new Set(uids).size).toBe(3);
    expect(uids).toContain(`${TRIP_ID}-t-p-louvre@connecttrip.co.kr`);
  });
});

describe('eventDescription', () => {
  it('maxNotes 0 이면 메모 없이 링크만', () => {
    expect(eventDescription({ notes: ['메모'], link: 'https://x' }, { maxNotes: 0 })).toBe('커넥트립에서 보기: https://x');
  });

  it('메모를 자르고 링크는 남긴다', () => {
    const text = eventDescription({ notes: ['가'.repeat(600)], link: 'https://www.connecttrip.co.kr/planner/t/x' }, { maxNotes: 500 });
    expect(text.startsWith('가'.repeat(499) + '…')).toBe(true);
    expect(text.endsWith('커넥트립에서 보기: https://www.connecttrip.co.kr/planner/t/x')).toBe(true);
  });
});

describe('googleCalendarUrl', () => {
  function params(url) {
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://calendar.google.com/calendar/render');
    return u.searchParams;
  }

  it('시각 있는 장소: dates 는 Z 시각 두 개', () => {
    const ev = buildCalendarEvents(data(), PARIS).find((e) => e.summary === '루브르 박물관');
    const p = params(googleCalendarUrl(ev));
    expect(p.get('action')).toBe('TEMPLATE');
    expect(p.get('text')).toBe('루브르 박물관');
    expect(p.get('dates')).toBe('20261001T083000Z/20261001T103000Z');
    expect(p.get('location')).toBe('Rue de Rivoli, 75001 Paris');
    expect(p.get('details')).toContain(`/planner/t/${TRIP_ID}`);
  });

  it('종일: YYYYMMDD/다음날, 주소 없으면 location 없음', () => {
    const ev = buildCalendarEvents(data(), PARIS).find((e) => e.summary === '에펠탑');
    const p = params(googleCalendarUrl(ev));
    expect(p.get('dates')).toBe('20261001/20261002');
    expect(p.has('location')).toBe(false);
  });

  it('끝 없는 티켓: 시작 값을 두 번', () => {
    const ev = ticketEvent(
      { id: 't1', kind: 'flight', title: 'KE901 ICN→CDG', event_date: '2026-10-01', event_time: '13:10' },
      { tripId: TRIP_ID, tripZone: 'Europe/Paris' },
    );
    expect(params(googleCalendarUrl(ev)).get('dates')).toBe('20261001T041000Z/20261001T041000Z');
  });

  it('특수문자·한글은 인코딩되고 공백은 %20', () => {
    const ev = placeEvent(
      { id: 'x', name: '스시 & 라멘 #1 ?', lat: 35.6, lng: 139.7, planned_time: '12:00', note: '줄 서기\n오래 걸림', note_public: true },
      '2026-10-01',
      { tripId: TRIP_ID, placeZone: 'Asia/Tokyo' },
    );
    const url = googleCalendarUrl(ev);
    expect(url).not.toMatch(/[ #]/);
    expect(url).toContain('%20');
    expect(params(url).get('text')).toBe('스시 & 라멘 #1 ?');
    expect(params(url).get('details')).toContain('줄 서기\n오래 걸림');
  });

  it('긴 한글 메모는 주소 예산 안으로 메모만 줄이고 커넥트립 링크는 남긴다', () => {
    const ev = placeEvent(
      { id: 'x', name: 'A', lat: 1, lng: 1, planned_time: '10:00', note: '가'.repeat(2000), note_public: true },
      '2026-10-01',
      { tripId: TRIP_ID, placeZone: 'Asia/Seoul' },
    );
    const url = googleCalendarUrl(ev);
    expect(url.length).toBeLessThanOrEqual(GOOGLE_URL_BUDGET);
    const details = new URL(url).searchParams.get('details');
    expect(details).toContain('가…');
    expect(details.endsWith(`/planner/t/${TRIP_ID}`)).toBe(true);
    expect(new URL(url).searchParams.get('dates')).toBe('20261001T010000Z/20261001T020000Z');
  });

  it('짧은 메모는 줄이지 않는다', () => {
    const ev = placeEvent(
      { id: 'x', name: 'A', lat: 1, lng: 1, note: '짧은 메모', note_public: true },
      '2026-10-01',
      { tripId: TRIP_ID },
    );
    expect(new URL(googleCalendarUrl(ev)).searchParams.get('details').startsWith('짧은 메모\n\n')).toBe(true);
  });

  it('자르는 자리에 이모지가 걸려도 URIError 없이 만든다', () => {
    for (let n = 495; n <= 500; n += 1) {
      const ev = placeEvent(
        { id: 'x', name: 'A', lat: 1, lng: 1, note: 'a'.repeat(n) + '😀'.repeat(10) + 'tail', note_public: true },
        '2026-10-01',
        { tripId: TRIP_ID },
      );
      expect(() => googleCalendarUrl(ev)).not.toThrow();
      const d = new URL(googleCalendarUrl(ev)).searchParams.get('details');
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(d)).toBe(false); // 짝 잃은 높은 서로게이트 없음
    }
    // 주소 예산에 걸려 이분 탐색으로 줄일 때도
    const big = placeEvent(
      { id: 'y', name: 'B', lat: 1, lng: 1, note: '😀가'.repeat(400), note_public: true },
      '2026-10-01',
      { tripId: TRIP_ID },
    );
    expect(() => googleCalendarUrl(big)).not.toThrow();
    expect(googleCalendarUrl(big).length).toBeLessThanOrEqual(GOOGLE_URL_BUDGET);
  });

  it('일정이 없으면 null', () => {
    expect(googleCalendarUrl(null)).toBeNull();
  });
});

describe('airportZones', () => {
  it('한국 공항은 서울, 대소문자 무시, 모르면 null', () => {
    ['ICN', 'gmp', 'PUS', 'CJU'].forEach((c) => expect(zoneForAirport(c)).toBe('Asia/Seoul'));
    expect(zoneForAirport('DPS')).toBe('Asia/Makassar');
    expect(zoneForAirport('ZZZ')).toBeNull();
    expect(zoneForAirport('IC')).toBeNull();
  });

  it('표의 모든 타임존이 이 환경에서 유효하고 공항 코드가 겹치지 않는다', async () => {
    const { isValidTimeZone } = await import('./timezone');
    const { AIRPORT_ZONES } = await import('./airportZones');
    const all = Object.values(AIRPORT_ZONES).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(airportCount()).toBe(all.length);
    Object.keys(AIRPORT_ZONES).forEach((zone) => expect(isValidTimeZone(zone)).toBe(true));
    all.forEach((code) => expect(code).toMatch(/^[A-Z]{3}$/));
  });
});

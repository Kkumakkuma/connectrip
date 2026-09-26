import { describe, it, expect } from 'vitest';
import { buildIcs, calendarFileName, escapeText, foldLine, safeFileBase, utcStamp } from './ics';
import { buildLocalSnapshot } from './snapshot';

const STAMP = '20260904T000000Z';
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

function unfold(text) {
  return text.replace(/\r\n /g, '');
}

function ev(overrides = {}) {
  return {
    uid: 'trip-1-p-place-1@connecttrip.co.kr',
    summary: '센소지',
    location: '도쿄도 다이토구',
    description: '메모\n\n커넥트립에서 보기: https://www.connecttrip.co.kr/planner/t/trip-1',
    geo: { lat: 35.7148, lng: 139.7967 },
    start: { type: 'utc', value: '20261001T013000Z' },
    end: { type: 'utc', value: '20261001T030000Z' },
    ...overrides,
  };
}

describe('escapeText', () => {
  it('역슬래시를 먼저 이스케이프한다', () => {
    expect(escapeText('a\\b')).toBe('a\\\\b');
    expect(escapeText('\\;')).toBe('\\\\\\;');
  });

  it('세미콜론·쉼표·줄바꿈(LF·CRLF·CR)을 규격대로 바꾼다', () => {
    expect(escapeText('a;b,c\nd\r\ne\rf')).toBe('a\\;b\\,c\\nd\\ne\\nf');
  });

  it('콜론·따옴표는 TEXT 에서 이스케이프하지 않는다', () => {
    expect(escapeText('10:30 "집합"')).toBe('10:30 "집합"');
  });
});

describe('foldLine', () => {
  it('75옥텟 이하는 그대로 둔다', () => {
    const line = 'SUMMARY:' + 'a'.repeat(67);
    expect(enc.encode(line).length).toBe(75);
    expect(foldLine(line)).toBe(line);
  });

  it('76옥텟이면 접는다', () => {
    const line = 'SUMMARY:' + 'a'.repeat(68);
    const parts = foldLine(line).split('\r\n');
    expect(parts).toHaveLength(2);
    expect(enc.encode(parts[0]).length).toBe(75);
    expect(parts[1]).toBe(' a');
  });

  it('한글 긴 문자열: 모든 줄이 75옥텟 이하, 이어지는 줄은 공백으로 시작, 각 줄이 온전한 UTF-8', () => {
    // 앞에 ASCII 를 섞어 3바이트 글자가 경계에 걸치게 만든다(0·1·2바이트 밀림 세 경우).
    for (const prefix of ['DESCRIPTION:', 'DESCRIPTION:x', 'DESCRIPTION:xy']) {
      const line = prefix + '가나다라마바사'.repeat(30);
      const parts = foldLine(line).split('\r\n');
      expect(parts.length).toBeGreaterThan(1);
      parts.forEach((part, i) => {
        const bytes = enc.encode(part);
        expect(bytes.length).toBeLessThanOrEqual(75);
        // 글자 중간을 자르면 fatal 디코더가 예외를 던진다
        expect(dec.decode(bytes)).toBe(part);
        if (i > 0) expect(part.startsWith(' ')).toBe(true);
      });
      expect(unfold(foldLine(line))).toBe(line);
    }
  });

  it('이모지(4바이트·서로게이트 쌍)도 쪼개지 않는다', () => {
    const line = 'SUMMARY:' + '🍣스시✈️'.repeat(20);
    const parts = foldLine(line).split('\r\n');
    parts.forEach((part) => {
      expect(enc.encode(part).length).toBeLessThanOrEqual(75);
      expect(dec.decode(enc.encode(part))).toBe(part);
      expect(/[\uD800-\uDBFF]$/.test(part)).toBe(false); // 높은 서로게이트로 끝나면 쌍이 갈라진 것
    });
    expect(unfold(foldLine(line))).toBe(line);
  });
});

describe('utcStamp', () => {
  it('ms → YYYYMMDDTHHMMSSZ', () => {
    expect(utcStamp(Date.UTC(2026, 9, 1, 1, 30, 5))).toBe('20261001T013005Z');
  });
});

describe('buildIcs', () => {
  it('필수 머리말과 CRLF, VCALENDAR 감싸기', () => {
    const ics = buildIcs([ev()], { calName: '도쿄 3박 4일', stamp: STAMP });
    expect(
      ics.startsWith(
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ConnectTrip//Planner//KO\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n',
      ),
    ).toBe(true);
    expect(ics).toContain('X-WR-CALNAME:도쿄 3박 4일\r\n');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    // 맨몸 LF·CR 이 없어야 한다
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('절대 시각 일정: DTSTART/DTEND 가 Z 로 끝나고 UID·DTSTAMP·GEO 가 들어간다', () => {
    const ics = unfold(buildIcs([ev()], { stamp: STAMP }));
    expect(ics).toContain('UID:trip-1-p-place-1@connecttrip.co.kr\r\n');
    expect(ics).toContain(`DTSTAMP:${STAMP}\r\n`);
    expect(ics).toContain('DTSTART:20261001T013000Z\r\n');
    expect(ics).toContain('DTEND:20261001T030000Z\r\n');
    expect(ics).toContain('LOCATION:도쿄도 다이토구\r\n');
    expect(ics).toContain('GEO:35.7148;139.7967\r\n');
    expect(ics).toContain(
      'DESCRIPTION:메모\\n\\n커넥트립에서 보기: https://www.connecttrip.co.kr/planner/t/trip-1\r\n',
    );
    expect(ics).not.toContain('TZID');
  });

  it('종일 일정은 VALUE=DATE, 부동 시각은 Z 없이', () => {
    const ics = buildIcs(
      [
        ev({ uid: 'a@x', start: { type: 'date', value: '20261001' }, end: { type: 'date', value: '20261002' } }),
        ev({
          uid: 'b@x',
          start: { type: 'floating', value: '20261001T103000' },
          end: { type: 'floating', value: '20261001T113000' },
        }),
      ],
      { stamp: STAMP },
    );
    expect(ics).toContain('DTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261002\r\n');
    expect(ics).toContain('DTSTART:20261001T103000\r\nDTEND:20261001T113000\r\n');
  });

  it('끝이 없는 일정(티켓)은 DTEND 를 넣지 않는다', () => {
    const ics = buildIcs([ev({ end: null })], { stamp: STAMP });
    expect(ics).toContain('DTSTART:20261001T013000Z\r\n');
    expect(ics).not.toContain('DTEND');
  });

  it('DTSTART·DTEND 형식이 섞이면 DTEND 를 버린다', () => {
    const ics = buildIcs([ev({ end: { type: 'floating', value: '20261001T120000' } })], { stamp: STAMP });
    expect(ics).not.toContain('DTEND');
  });

  it('형식이 잘못된 시각·UID 없는 일정은 건너뛴다', () => {
    expect(buildIcs([ev({ start: { type: 'utc', value: '2026-10-01' } })], { stamp: STAMP })).toBeNull();
    expect(buildIcs([ev({ uid: '' })], { stamp: STAMP })).toBeNull();
  });

  it('일정이 하나도 없으면 null (빈 VCALENDAR 는 규격 위반)', () => {
    expect(buildIcs([], { stamp: STAMP })).toBeNull();
    expect(buildIcs(null)).toBeNull();
  });

  it('제목·장소의 특수문자를 이스케이프한다', () => {
    const ics = unfold(buildIcs([ev({ summary: '스카이트리; 전망대, 야경\\', location: 'A,B;C' })], { stamp: STAMP }));
    expect(ics).toContain('SUMMARY:스카이트리\\; 전망대\\, 야경\\\\\r\n');
    expect(ics).toContain('LOCATION:A\\,B\\;C\r\n');
  });

  it('모든 물리 줄이 75옥텟 이하', () => {
    const ics = buildIcs([ev({ summary: '아주 긴 한글 제목 '.repeat(20), description: '메모 '.repeat(300) })], {
      stamp: STAMP,
    });
    ics.split('\r\n').forEach((line) => expect(enc.encode(line).length).toBeLessThanOrEqual(75));
  });
});

describe('safeFileBase / calendarFileName', () => {
  it('파일명에 못 쓰거나 공유 MIME 판정을 깨는 문자를 지운다', () => {
    expect(safeFileBase('도쿄/오사카: 3박?')).toBe('도쿄 오사카 3박');
    expect(safeFileBase("파리 & 런던!~'")).toBe('파리 런던');
  });

  it('빈 값이면 기본 이름을 쓴다', () => {
    expect(safeFileBase('')).toBe('여행일정');
    expect(safeFileBase(null)).toBe('여행일정');
    expect(safeFileBase('...')).toBe('여행일정');
  });

  it('여행이름_커넥트립.ics', () => {
    expect(calendarFileName('도쿄 3박 4일')).toBe('도쿄 3박 4일_커넥트립.ics');
    expect(calendarFileName('')).toBe('여행일정_커넥트립.ics');
  });
});

describe('buildLocalSnapshot', () => {
  const trip = {
    id: 'trip-1',
    title: '오사카',
    start_date: '2026-11-01',
    end_date: '2026-11-03',
    currency: 'JPY',
    country: '일본',
    timezone: 'Asia/Tokyo',
  };

  it('비공개 메모는 담지 않는다', () => {
    const snap = buildLocalSnapshot({
      trip,
      days: [{ id: 'd1', day_index: 0, date: '2026-11-01', legs: null }],
      places: [
        { id: 'p1', day_id: 'd1', sort_order: 0, name: 'A', note: '비밀', note_public: false },
        { id: 'p2', day_id: 'd1', sort_order: 1, name: 'B', note: '공개', note_public: true },
      ],
    });
    expect(snap.days[0].places[0].note).toBe('');
    expect(snap.days[0].places[1].note).toBe('공개');
  });

  it('보관함 핀을 unassigned 로 나누고 합계를 센다', () => {
    const snap = buildLocalSnapshot({
      trip,
      days: [{ id: 'd1', day_index: 0, date: '2026-11-01', legs: null }],
      places: [
        { id: 'p1', day_id: 'd1', sort_order: 0, name: 'A', cost: 1000 },
        { id: 'p2', day_id: null, sort_order: 0, name: 'C', cost: 500 },
      ],
    });
    expect(snap.unassigned).toHaveLength(1);
    expect(snap.summary.places_count).toBe(2);
    expect(snap.summary.cost_total).toBe(1500);
  });

  it('정렬값이 같으면 생성 시각으로 순서를 고정한다', () => {
    const snap = buildLocalSnapshot({
      trip,
      days: [{ id: 'd1', day_index: 0, date: '2026-11-01', legs: null }],
      places: [
        { id: 'p2', day_id: 'd1', sort_order: 0, name: '나중', created_at: '2026-09-02T00:00:00Z' },
        { id: 'p1', day_id: 'd1', sort_order: 0, name: '먼저', created_at: '2026-09-01T00:00:00Z' },
      ],
    });
    expect(snap.days[0].places.map((p) => p.name)).toEqual(['먼저', '나중']);
  });

  it('여행이 없으면 null', () => {
    expect(buildLocalSnapshot({})).toBeNull();
  });
});

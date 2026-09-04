import { describe, it, expect } from 'vitest';
import { buildIcs, escapeText, foldLine, safeFileBase } from './ics';
import { buildLocalSnapshot } from './snapshot';

const STAMP = '20260904T000000Z';

function tripSnapshot(overrides = {}) {
  return {
    v: 1,
    title: '도쿄 3박 4일',
    start_date: '2026-10-01',
    end_date: '2026-10-04',
    currency: 'JPY',
    country: '일본',
    timezone: 'Asia/Tokyo',
    days: [
      {
        index: 0,
        date: '2026-10-01',
        places: [
          {
            order: 0,
            name: '센소지',
            address: '도쿄도 다이토구',
            lat: 35.7148,
            lng: 139.7967,
            planned_time: '10:30',
            stay_min: 90,
            cost: 0,
            note: '',
          },
          {
            order: 1,
            name: '스카이트리; 전망대',
            address: '',
            lat: 0,
            lng: 0,
            planned_time: null,
            stay_min: null,
            cost: 2100,
            note: '줄 길면 패스\n야경이 낫다',
          },
        ],
        legs: null,
      },
    ],
    unassigned: [],
    summary: { days_count: 1, places_count: 2, cost_total: 2100 },
    ...overrides,
  };
}

describe('escapeText', () => {
  it('역슬래시를 먼저 이스케이프한다', () => {
    expect(escapeText('a\\b')).toBe('a\\\\b');
  });

  it('세미콜론·쉼표·줄바꿈을 규격대로 바꾼다', () => {
    expect(escapeText('a;b,c\nd')).toBe('a\\;b\\,c\\nd');
  });
});

describe('foldLine', () => {
  it('75옥텟 이하는 그대로 둔다', () => {
    const line = 'SUMMARY:' + 'a'.repeat(60);
    expect(foldLine(line)).toBe(line);
  });

  it('한글이 섞여도 각 줄이 75옥텟을 넘지 않는다', () => {
    const line = 'DESCRIPTION:' + '가'.repeat(100);
    const folded = foldLine(line);
    const enc = new TextEncoder();
    folded.split('\r\n').forEach((part) => {
      expect(enc.encode(part).length).toBeLessThanOrEqual(75);
    });
    // 이어지는 줄은 공백으로 시작해야 한다
    folded
      .split('\r\n')
      .slice(1)
      .forEach((part) => expect(part.startsWith(' ')).toBe(true));
  });

  it('폴딩을 풀면 원문과 같다', () => {
    const line = 'DESCRIPTION:' + '나'.repeat(120);
    const unfolded = foldLine(line).split('\r\n').map((p, i) => (i === 0 ? p : p.slice(1))).join('');
    expect(unfolded).toBe(line);
  });
});

describe('buildIcs', () => {
  it('시각이 있는 핀은 부동 시각으로 적는다 — 타임존 변환을 하지 않는다', () => {
    const ics = buildIcs(tripSnapshot(), { uidSeed: 't1', stamp: STAMP });
    // 여행지 시각 10:30 이 그대로 나와야 한다. Z 도 TZID 도 붙지 않는다.
    expect(ics).toContain('DTSTART:20261001T103000');
    expect(ics).toContain('DTEND:20261001T120000'); // 90분 체류
    expect(ics).not.toContain('DTSTART;TZID=');
    expect(ics).not.toMatch(/DTSTART:\d{8}T\d{6}Z/);
  });

  it('시차 있는 여행에서도 적어 둔 시각이 흔들리지 않는다', () => {
    // 같은 스냅샷을 타임존만 바꿔 두 번 만들어도 시각 표기는 같아야 한다.
    const seoul = buildIcs(tripSnapshot({ timezone: 'Asia/Seoul' }), { uidSeed: 't1', stamp: STAMP });
    const nyc = buildIcs(tripSnapshot({ timezone: 'America/New_York' }), { uidSeed: 't1', stamp: STAMP });
    expect(seoul).toBe(nyc);
  });

  it('시각이 없는 핀은 종일 일정이 되고 DTEND 는 다음 날이다', () => {
    const ics = buildIcs(tripSnapshot(), { uidSeed: 't1', stamp: STAMP });
    expect(ics).toContain('DTSTART;VALUE=DATE:20261001');
    expect(ics).toContain('DTEND;VALUE=DATE:20261002');
  });

  it('제목·메모의 특수문자를 이스케이프한다', () => {
    const ics = buildIcs(tripSnapshot(), { uidSeed: 't1', stamp: STAMP });
    expect(ics).toContain('SUMMARY:스카이트리\\; 전망대');
    expect(ics).toContain('\\n야경이 낫다');
  });

  it('핀 수만큼 VEVENT 를 만들고 UID 가 겹치지 않는다', () => {
    const ics = buildIcs(tripSnapshot(), { uidSeed: 't1', stamp: STAMP });
    const uids = ics.match(/^UID:.*$/gm) || [];
    expect(uids).toHaveLength(2);
    expect(new Set(uids).size).toBe(2);
  });

  it('좌표가 0,0 이면 GEO 를 넣지 않는다', () => {
    const ics = buildIcs(tripSnapshot(), { uidSeed: 't1', stamp: STAMP });
    expect((ics.match(/^GEO:/gm) || [])).toHaveLength(1);
  });

  it('모든 줄이 CRLF 로 끝나고 VCALENDAR 로 감싼다', () => {
    const ics = buildIcs(tripSnapshot(), { uidSeed: 't1', stamp: STAMP });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n').filter((l) => l.includes('\n'))).toHaveLength(0);
  });

  it('날짜가 없는 날은 통째로 건너뛴다', () => {
    const snap = tripSnapshot({ days: [{ index: 0, date: null, places: [{ order: 0, name: 'x' }] }] });
    expect(buildIcs(snap, { stamp: STAMP })).not.toContain('BEGIN:VEVENT');
  });
});

describe('safeFileBase', () => {
  it('파일명에 못 쓰는 문자를 지운다', () => {
    expect(safeFileBase('도쿄/오사카: 3박?')).toBe('도쿄 오사카 3박');
  });

  it('빈 값이면 기본 이름을 쓴다', () => {
    expect(safeFileBase('')).toBe('여행일정');
    expect(safeFileBase(null)).toBe('여행일정');
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

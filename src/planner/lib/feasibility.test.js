import { describe, it, expect } from 'vitest';
import {
  checkDay,
  weekdayOf,
  parseClock,
  formatClock,
  intervalsFor,
  WARNING_CODES,
  CLOSE_REASONS,
  FEASIBILITY_DEFAULTS,
} from './feasibility';

// 설계 §6 이 요구한 최소 8케이스 + 경계 보강.
// 전역 함수를 쓰지 않고 vitest 를 명시 import 한다 — eslint 전역이 browser 로 잡혀 있어
// describe/it 을 전역으로 두면 no-undef 가 난다.

const hours = (days, extra = {}) => ({ v: 1, src: 'google', days, unknown: false, ...extra });

// 시각만 지정한 핀 한 개짜리 하루를 만든다.
const onePlace = (plannedTime, openingHours, stayMin = 30) => [
  { id: 'p1', name: '테스트 장소', planned_time: plannedTime, stay_min: stayMin, opening_hours: openingHours },
];

const codesOf = (result) => result.warnings.map((w) => w.code);
const find = (result, code) => result.warnings.find((w) => w.code === code);

describe('시각·요일 유틸', () => {
  it('HH:MM 과 HH:MM:SS 를 모두 분으로 읽는다', () => {
    expect(parseClock('10:30')).toBe(630);
    expect(parseClock('10:30:00')).toBe(630);
    expect(parseClock('24:00')).toBe(1440);
    expect(parseClock('')).toBeNull();
    expect(parseClock('25:99')).toBeNull();
  });

  it('자정을 넘긴 분은 다음 날 시각으로 접어서 표시한다', () => {
    expect(formatClock(1410)).toBe('23:30');
    expect(formatClock(1560)).toBe('02:00');
  });

  // ⑤ 실행 타임존이 UTC- 여도 요일이 밀리지 않는다.
  //    검증: TZ=America/New_York npx vitest run — new Date('2026-10-03') 를 썼다면 여기서 금요일이 된다.
  it('⑤ 2026-10-03 은 어느 타임존에서 실행해도 토요일이다', () => {
    expect(weekdayOf('2026-10-03')).toBe(6);
    expect(weekdayOf('2026-01-01')).toBe(4);
    expect(weekdayOf('2026-02-31')).toBeNull();
  });

  it('요일 키가 없으면 판단 근거가 없는 것으로 본다', () => {
    expect(intervalsFor(hours({ 1: [{ from: 540, to: 1080 }] }), 6).known).toBe(false);
    expect(intervalsFor(hours({ 6: [] }), 6)).toEqual({ known: true, intervals: [] });
  });
});

describe('영업시간 기반 경고', () => {
  // ① 자정 넘김 18:00~02:00 에 23:30 도착
  it('① 자정을 넘겨 영업하는 곳에 23:30 도착은 경고하지 않는다', () => {
    const result = checkDay({
      date: '2026-10-03',
      places: onePlace('23:30', hours({ 6: [{ from: 1080, to: 1560 }] })),
    });
    expect(codesOf(result)).not.toContain(WARNING_CODES.ARRIVE_AFTER_CLOSE);
  });

  // ② 24시간 영업에는 마지막 입장 버퍼를 적용하지 않는다
  it('② 24시간 영업에 03:00 도착은 경고하지 않는다', () => {
    const result = checkDay({
      date: '2026-10-03',
      places: onePlace('03:00', hours({ 6: [{ from: 0, to: 1440 }] })),
    });
    expect(codesOf(result)).not.toContain(WARNING_CODES.ARRIVE_AFTER_CLOSE);
  });

  // ③ 휴게시간 11–14 / 17–21 사이인 15:00 도착
  it("③ 휴게시간에 걸린 도착은 reason 'break' 로 표시한다", () => {
    const result = checkDay({
      date: '2026-10-03',
      places: onePlace('15:00', hours({ 6: [{ from: 660, to: 840 }, { from: 1020, to: 1260 }] })),
    });
    const warning = find(result, WARNING_CODES.ARRIVE_AFTER_CLOSE);
    expect(warning).toBeTruthy();
    expect(warning.reason).toBe(CLOSE_REASONS.BREAK);
    // 배지를 눌렀을 때 보여줄 근거가 함께 담긴다
    expect(warning.detail.intervals).toEqual([
      { from: '11:00', to: '14:00' },
      { from: '17:00', to: '21:00' },
    ]);
    expect(warning.detail.assumptions.bufferMin).toBe(FEASIBILITY_DEFAULTS.LAST_ENTRY_BUFFER_MIN);
  });

  // ④ 21:00 폐점 · 버퍼 30분 경계
  it('④ 폐점 30분 전 경계에서 20:29 는 통과하고 20:31 은 경고한다', () => {
    const open = hours({ 6: [{ from: 540, to: 1260 }] });
    const pass = checkDay({ date: '2026-10-03', places: onePlace('20:29', open) });
    const fail = checkDay({ date: '2026-10-03', places: onePlace('20:31', open) });
    expect(codesOf(pass)).not.toContain(WARNING_CODES.ARRIVE_AFTER_CLOSE);
    const warning = find(fail, WARNING_CODES.ARRIVE_AFTER_CLOSE);
    expect(warning).toBeTruthy();
    expect(warning.reason).toBe(CLOSE_REASONS.CLOSED);
  });

  // ⑥ 파싱하지 못한 영업시간(OSM 원문 등)은 아무 경고도 만들지 않는다
  it('⑥ unknown:true 인 영업시간은 검사에서 제외한다', () => {
    const result = checkDay({
      date: '2026-10-03',
      places: onePlace('05:00', { v: 1, src: 'osm', days: {}, unknown: true, raw: 'Mo-Su 11:00-21:00' }),
    });
    expect(result.warnings).toHaveLength(0);
  });

  it('그 요일 구간이 비어 있으면 CLOSED_DAY 를 낸다', () => {
    const result = checkDay({
      date: '2026-10-03',
      places: onePlace('13:00', hours({ 5: [{ from: 540, to: 1080 }], 6: [] })),
    });
    expect(codesOf(result)).toContain(WARNING_CODES.CLOSED_DAY);
  });

  it('전날 자정을 넘긴 영업 꼬리는 오늘 새벽 도착으로 인정한다', () => {
    const result = checkDay({
      date: '2026-10-03',
      // 금요일 18:00~다음날 02:00, 토요일은 휴무
      places: onePlace('01:00', hours({ 5: [{ from: 1080, to: 1560 }], 6: [] })),
    });
    expect(codesOf(result)).not.toContain(WARNING_CODES.ARRIVE_AFTER_CLOSE);
  });
});

describe('하루 활동 시간', () => {
  // ⑦ 가정값 변경이 반영된다
  it('⑦ DAY_START/DAY_END 를 06:00~24:00 으로 바꾸면 판정이 달라진다', () => {
    const places = [
      { id: 'a', name: 'A', planned_time: null, stay_min: 480, opening_hours: null },
      { id: 'b', name: 'B', planned_time: null, stay_min: 480, opening_hours: null },
    ];
    // 기본값(08:00~23:00): 08:00 + 8h + 8h = 다음날 00:00 → 초과
    const base = checkDay({ date: '2026-10-03', places });
    expect(codesOf(base)).toContain(WARNING_CODES.OVER_DAY);

    // 06:00~24:00: 06:00 + 16h = 22:00 → 여유 있음
    const widened = checkDay({
      date: '2026-10-03',
      places,
      options: { DAY_START: '06:00', DAY_END: '24:00' },
    });
    expect(codesOf(widened)).not.toContain(WARNING_CODES.OVER_DAY);
    expect(widened.assumptions.dayStart).toBe('06:00');
  });

  // ⑧ 영업시간이 하나도 없는 과밀 일정
  it('⑧ 영업시간 정보가 없으면 OVER_DAY 만 남는다', () => {
    const places = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      name: `장소 ${i}`,
      planned_time: null,
      stay_min: 180,
      opening_hours: null,
    }));
    const result = checkDay({ date: '2026-10-03', places });
    expect(codesOf(result)).toEqual([WARNING_CODES.OVER_DAY]);
  });

  it('이동시간이 누적에 반영된다', () => {
    const places = [
      { id: 'a', name: 'A', planned_time: '09:00', stay_min: 60, opening_hours: null },
      { id: 'b', name: 'B', planned_time: null, stay_min: 60, opening_hours: null },
    ];
    const legs = [{ duration_s: 1800 }];
    const result = checkDay({ date: '2026-10-03', places, legs });
    // 09:00 +60분 체류 → 10:00 출발 +30분 이동 → 10:30 도착
    expect(formatClock(result.timeline.rows[1].arrival)).toBe('10:30');
    expect(result.timeline.endMin).toBe(11 * 60 + 30);
  });
});

describe('시각 순서', () => {
  it('앞 핀보다 이른 시각이 뒤에 오면 TIME_ORDER 를 낸다', () => {
    const result = checkDay({
      date: '2026-10-03',
      places: [
        { id: 'a', name: 'A', planned_time: '14:00', stay_min: 30, opening_hours: null },
        { id: 'b', name: 'B', planned_time: '11:00', stay_min: 30, opening_hours: null },
      ],
    });
    const warning = find(result, WARNING_CODES.TIME_ORDER);
    expect(warning).toBeTruthy();
    expect(warning.placeId).toBe('b');
  });

  it('시각을 적지 않은 핀은 순서 검사 대상이 아니다', () => {
    const result = checkDay({
      date: '2026-10-03',
      places: [
        { id: 'a', name: 'A', planned_time: '14:00', stay_min: 30, opening_hours: null },
        { id: 'b', name: 'B', planned_time: null, stay_min: 30, opening_hours: null },
      ],
    });
    expect(codesOf(result)).not.toContain(WARNING_CODES.TIME_ORDER);
  });

  it('핀이 없으면 아무 경고도 만들지 않는다', () => {
    expect(checkDay({ date: '2026-10-03', places: [] }).warnings).toHaveLength(0);
  });
});

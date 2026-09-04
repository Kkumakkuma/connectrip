// 동선 현실성 검사 (설계 §6). 순수 함수만 둔다 — 네트워크·DOM·현재 시각에 접근하지 않는다.
//
// 시간 기준
//   모든 시각은 목적지 현지 벽시계다. planned_time 은 시간대 없는 time, 날짜는 date,
//   영업시간도 현지 기준이라 타임존 변환을 하지 않는다.
//   ⚠ 요일은 문자열을 직접 쪼개 계산한다. new Date('2026-10-03').getDay() 는 UTC 로 파싱돼
//     UTC- 지역(예: America/New_York) 사용자에게 하루 밀린다.
//
// 판정 원칙
//   · 데이터가 없으면 경고를 만들지 않는다(영업시간이 없거나 unknown 이면 그 두 경고는 생략).
//   · 어느 경고도 "확정"이 아니다. 화면 문구는 단정하지 않고, 근거(사용한 구간·출처·가정값)를
//     warning.detail 에 담아 그대로 보여줄 수 있게 한다.

// 가정값은 전부 한곳에 모은다. 화면(일정판 헤더 칩)에 그대로 노출하는 값이라 하드코딩 금지.
export const FEASIBILITY_DEFAULTS = Object.freeze({
  DAY_START: '08:00',
  DAY_END: '23:00',
  LAST_ENTRY_BUFFER_MIN: 30,
});

export const WARNING_CODES = Object.freeze({
  TIME_ORDER: 'TIME_ORDER',
  CLOSED_DAY: 'CLOSED_DAY',
  ARRIVE_AFTER_CLOSE: 'ARRIVE_AFTER_CLOSE',
  OVER_DAY: 'OVER_DAY',
});

// ARRIVE_AFTER_CLOSE 의 세부 사유.
//   closed      = 폐점했거나 마지막 입장 시각을 넘겼다
//   break       = 구간과 구간 사이(휴게시간)에 걸렸다
//   before_open = 아직 열기 전이다 (설계 §6 의 두 사유로는 표현되지 않는 경우를 따로 구분한다)
export const CLOSE_REASONS = Object.freeze({
  CLOSED: 'closed',
  BREAK: 'break',
  BEFORE_OPEN: 'before_open',
});

const MINUTES_PER_DAY = 1440;

// ---------------------------------------------------------------------------
// 시각·요일 유틸
// ---------------------------------------------------------------------------

// 'YYYY-MM-DD' → 0(일)~6(토). 형식이 아니면 null.
// Date 를 UTC 로 파싱시키지 않으려고 숫자를 직접 넘긴다.
export function weekdayOf(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const local = new Date(y, mo - 1, d);
  // 2026-02-31 같은 값은 Date 가 조용히 이월시킨다 → 원래 값과 다르면 잘못된 날짜로 본다.
  if (local.getFullYear() !== y || local.getMonth() !== mo - 1 || local.getDate() !== d) return null;
  return local.getDay();
}

// 'HH:MM' 또는 'HH:MM:SS' → 자정 기준 분. 아니면 null.
export function parseClock(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return h * 60 + min;
}

// 분 → 'HH:MM'. 자정을 넘긴 값(1440 이상)은 다음 날 시각으로 접어서 표시한다.
export function formatClock(minutes) {
  if (!Number.isFinite(minutes)) return '';
  const wrapped = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// 정규화 영업시간 (설계 §6 형식 v1)
//   { v:1, src:'google'|'osm', days:{ '0':Interval[] … '6':Interval[] }, unknown:boolean, raw?:any }
//   Interval = { from, to }  // 자정 기준 분, 자정 넘김은 to > 1440
// ---------------------------------------------------------------------------

function sanitizeIntervals(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((it) => ({ from: Number(it?.from), to: Number(it?.to) }))
    .filter((it) => Number.isFinite(it.from) && Number.isFinite(it.to) && it.to > it.from)
    .sort((a, b) => a.from - b.from);
}

// 그 요일의 영업 구간을 꺼낸다.
//   known=false 면 판단할 근거가 없다는 뜻이라 영업시간 기반 경고를 아예 만들지 않는다.
export function intervalsFor(openingHours, weekday) {
  if (!openingHours || typeof openingHours !== 'object') return { known: false, intervals: [] };
  if (openingHours.unknown === true) return { known: false, intervals: [] };
  const days = openingHours.days;
  if (!days || typeof days !== 'object') return { known: false, intervals: [] };
  const key = String(weekday);
  if (!Object.prototype.hasOwnProperty.call(days, key)) return { known: false, intervals: [] };
  return { known: true, intervals: sanitizeIntervals(days[key]) };
}

// 24시간 영업 구간에는 마지막 입장 버퍼를 적용하지 않는다.
function isAllDay(interval) {
  return interval.from <= 0 && interval.to >= MINUTES_PER_DAY;
}

// 전날 구간 중 자정을 넘긴 꼬리를 오늘 좌표(음수 시작)로 옮긴다.
// 예: 전날 18:00~02:00 = {1080,1560} → 오늘 {-360,120} → 오늘 01:00 도착이 이 구간 안에 들어간다.
function previousDayTails(openingHours, weekday) {
  const prev = intervalsFor(openingHours, (weekday + 6) % 7);
  if (!prev.known) return [];
  return prev.intervals
    .filter((it) => it.to > MINUTES_PER_DAY)
    .map((it) => ({ from: it.from - MINUTES_PER_DAY, to: it.to - MINUTES_PER_DAY }));
}

// 도착 분이 영업 구간 안에 드는지 판정한다.
//   { ok, reason, interval } — ok=true 면 reason·interval 은 근거로만 쓴다.
export function classifyArrival(arrivalMin, intervals, tails, bufferMin) {
  const all = [...tails, ...intervals].sort((a, b) => a.from - b.from);
  if (all.length === 0) return { ok: false, reason: CLOSE_REASONS.CLOSED, interval: null };

  // 1) 버퍼까지 감안해 실제로 들어갈 수 있는 구간이 있는가
  for (const interval of all) {
    const lastEntry = isAllDay(interval) ? interval.to : interval.to - bufferMin;
    if (arrivalMin >= interval.from && arrivalMin <= lastEntry) {
      return { ok: true, reason: null, interval };
    }
  }

  // 2) 왜 못 들어가는지 — 버퍼가 아니라 원래 구간을 기준으로 판정해야 사유가 정확해진다.
  const inside = all.find((it) => arrivalMin >= it.from && arrivalMin <= it.to);
  if (inside) return { ok: false, reason: CLOSE_REASONS.CLOSED, interval: inside };

  const first = all[0];
  const last = all[all.length - 1];
  if (arrivalMin < first.from) {
    return { ok: false, reason: CLOSE_REASONS.BEFORE_OPEN, interval: first };
  }
  if (arrivalMin > last.to) {
    return { ok: false, reason: CLOSE_REASONS.CLOSED, interval: last };
  }
  return { ok: false, reason: CLOSE_REASONS.BREAK, interval: null };
}

// ---------------------------------------------------------------------------
// 하루 검사
// ---------------------------------------------------------------------------

function resolveOptions(options) {
  const merged = { ...FEASIBILITY_DEFAULTS, ...(options || {}) };
  const start = parseClock(merged.DAY_START);
  const end = parseClock(merged.DAY_END);
  const buffer = Number(merged.LAST_ENTRY_BUFFER_MIN);
  return {
    dayStartMin: start === null ? parseClock(FEASIBILITY_DEFAULTS.DAY_START) : start,
    dayEndMin: end === null ? parseClock(FEASIBILITY_DEFAULTS.DAY_END) : end,
    bufferMin: Number.isFinite(buffer) && buffer >= 0 ? buffer : FEASIBILITY_DEFAULTS.LAST_ENTRY_BUFFER_MIN,
    dayStartText: merged.DAY_START,
    dayEndText: merged.DAY_END,
  };
}

function legMinutes(legs, index) {
  const leg = Array.isArray(legs) ? legs[index] : null;
  if (!leg || !Number.isFinite(leg.duration_s)) return 0;
  return leg.duration_s / 60;
}

// 하루치 일정의 도착·출발 시각을 순서대로 계산한다.
//   첫 핀의 시각(없으면 DAY_START)에서 출발해 체류 + 이동을 누적한다.
//   명시된 시각이 누적 시각보다 이르면 그 핀은 계획대로 도착한 것으로 보고(사용자가 적은 값 우선),
//   다음 계산은 두 값 중 늦은 쪽에서 이어간다 — 시각을 되돌리면 누적이 무의미해진다.
export function buildTimeline(places, legs, options) {
  const { dayStartMin } = resolveOptions(options);
  const list = Array.isArray(places) ? places : [];
  const firstPlanned = list.length > 0 ? parseClock(list[0].planned_time) : null;

  let clock = firstPlanned === null ? dayStartMin : firstPlanned;
  const rows = [];

  list.forEach((place, i) => {
    const planned = parseClock(place.planned_time);
    const arrival = planned === null ? clock : planned;
    const stay = Number.isFinite(Number(place.stay_min)) ? Number(place.stay_min) : 0;
    const departure = Math.max(clock, arrival) + stay;
    rows.push({ index: i, id: place.id, arrival, departure, planned, stay });
    clock = departure + legMinutes(legs, i);
  });

  return { rows, endMin: clock };
}

// 하루치 경고 목록.
//   places = [{ id, name, planned_time, stay_min, opening_hours }]  (opening_hours 는 정규화 형식)
//   legs   = [{ duration_s }]  places[i] → places[i+1] 이동. 없으면 이동시간 0으로 본다.
//   반환 { warnings, timeline, assumptions }
export function checkDay({ date, places, legs, options } = {}) {
  const opts = resolveOptions(options);
  const list = Array.isArray(places) ? places : [];
  const weekday = weekdayOf(date);
  const timeline = buildTimeline(list, legs, options);
  const warnings = [];

  const assumptions = {
    dayStart: opts.dayStartText,
    dayEnd: opts.dayEndText,
    bufferMin: opts.bufferMin,
    holidaysApplied: false,
  };

  // 1) TIME_ORDER — 적어 둔 시각이 목록 순서와 어긋난다. 영업시간이 필요 없어 항상 검사한다.
  let prevPlanned = null;
  list.forEach((place, i) => {
    const planned = parseClock(place.planned_time);
    if (planned === null) return;
    if (prevPlanned !== null && planned < prevPlanned) {
      warnings.push({
        code: WARNING_CODES.TIME_ORDER,
        index: i,
        placeId: place.id ?? null,
        reason: null,
        detail: {
          plannedAt: formatClock(planned),
          previousAt: formatClock(prevPlanned),
          assumptions,
        },
      });
    }
    prevPlanned = Math.max(prevPlanned ?? planned, planned);
  });

  // 2) 영업시간 기반 검사. 요일을 못 읽으면(날짜 형식 이상) 통째로 생략한다.
  if (weekday !== null) {
    list.forEach((place, i) => {
      const today = intervalsFor(place.opening_hours, weekday);
      if (!today.known) return;

      const tails = previousDayTails(place.opening_hours, weekday);

      if (today.intervals.length === 0 && tails.length === 0) {
        warnings.push({
          code: WARNING_CODES.CLOSED_DAY,
          index: i,
          placeId: place.id ?? null,
          reason: null,
          detail: {
            weekday,
            source: place.opening_hours?.src || null,
            intervals: [],
            assumptions,
          },
        });
        return;
      }

      const row = timeline.rows[i];
      if (!row || !Number.isFinite(row.arrival)) return;

      const verdict = classifyArrival(row.arrival, today.intervals, tails, opts.bufferMin);
      if (verdict.ok) return;

      warnings.push({
        code: WARNING_CODES.ARRIVE_AFTER_CLOSE,
        index: i,
        placeId: place.id ?? null,
        reason: verdict.reason,
        detail: {
          arrivalAt: formatClock(row.arrival),
          weekday,
          source: place.opening_hours?.src || null,
          intervals: today.intervals.map((it) => ({
            from: formatClock(it.from),
            to: formatClock(it.to),
          })),
          assumptions,
        },
      });
    });
  }

  // 3) OVER_DAY — 영업시간과 무관하게 하루 활동 시간을 넘긴다. 가정값을 함께 보여줘야 한다.
  if (list.length > 0 && timeline.endMin > opts.dayEndMin) {
    warnings.push({
      code: WARNING_CODES.OVER_DAY,
      index: list.length - 1,
      placeId: null,
      reason: null,
      detail: {
        endsAt: formatClock(timeline.endMin),
        overMin: Math.round(timeline.endMin - opts.dayEndMin),
        assumptions,
      },
    });
  }

  return { warnings, timeline, assumptions };
}

// 화면에서 핀별로 배지를 그릴 때 쓰는 색인. OVER_DAY 처럼 핀이 없는 경고는 제외한다.
export function warningsByPlace(warnings) {
  const map = new Map();
  (warnings || []).forEach((w) => {
    if (!w.placeId) return;
    const list = map.get(w.placeId) || [];
    list.push(w);
    map.set(w.placeId, list);
  });
  return map;
}

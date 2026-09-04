// 하루 활동 시간 가정값(DAY_START / DAY_END)의 여행별 보관.
//
// 설계 §6: 1차는 localStorage 에만 둔다(스키마 변경 없음). 값은 동선 검사에만 쓰이고
// 서버로 나가지 않으므로 기기마다 다를 수 있다 — 화면 칩에 항상 현재 값을 적어 그 사실을 감춘다.

import { FEASIBILITY_DEFAULTS, parseClock } from './feasibility';

const KEY = 'ct_planner_day_window_v1';

function readAll() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(value) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // 저장이 막힌 환경에서는 기본 가정값으로 계속 쓴다.
  }
}

function valid(start, end) {
  const s = parseClock(start);
  const e = parseClock(end);
  return s !== null && e !== null && e > s;
}

// 저장된 값이 없거나 형식이 깨졌으면 기본 가정값을 돌려준다.
export function readDayWindow(tripId) {
  const saved = readAll()[tripId];
  if (saved && valid(saved.DAY_START, saved.DAY_END)) {
    return { DAY_START: saved.DAY_START, DAY_END: saved.DAY_END };
  }
  return { DAY_START: FEASIBILITY_DEFAULTS.DAY_START, DAY_END: FEASIBILITY_DEFAULTS.DAY_END };
}

// 잘못된 값은 저장하지 않고 false 를 돌려준다(호출부가 안내를 띄운다).
export function writeDayWindow(tripId, { DAY_START, DAY_END }) {
  if (!tripId || !valid(DAY_START, DAY_END)) return false;
  const all = readAll();
  all[tripId] = { DAY_START, DAY_END };
  writeAll(all);
  return true;
}

export function isDefaultDayWindow({ DAY_START, DAY_END }) {
  return (
    DAY_START === FEASIBILITY_DEFAULTS.DAY_START && DAY_END === FEASIBILITY_DEFAULTS.DAY_END
  );
}

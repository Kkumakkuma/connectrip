// 구글 Routes API(v2 computeRoutes) 응답의 대중교통 구간을 화면용 요약으로 줄인다. 순수 함수(테스트 대상).
//
// 사용자 요청(2026-09-06): "실시간 시각까지는 아니어도 경로 정도는" — 노선·정류장·환승만 남기고 시각은 버린다.
// 요약 형태(planner_days.legs items[].steps, planner_route_cache.steps):
//   { t: 'WALK', s: 초 }                                   연속 도보는 하나로 합친다
//   { t: 'TRANSIT', v: 차량 종류(구글 enum 그대로, 표시 계층에서 한글로), line: 노선명, from, to: 정류장명, stops: 정류장 수(출발 제외·도착 포함, 없으면 null), s: 초 }
//   { t: 'MORE' }                                          MAX_STEPS 를 넘어 생략된 단계가 있음
// 문자열은 잘라 두고(MAX_TEXT, 잘리면 …) 개수도 제한한다(MAX_STEPS, 걷기 병합 후) — jsonb 가 무한정 커지지 않게.

export const MAX_STEPS = 12;
export const MAX_TEXT = 80;   // 긴 해외 역명이 식별 가능하게(codex 9/6). 화면은 줄바꿈으로 처리

const clip = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s;
};

const seconds = (v) => {
  const n = Number(String(v ?? '').replace(/s$/, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

/**
 * @param {object} route  routes[0] — legs[].steps[] 에 travelMode / staticDuration / transitDetails 가 있어야 한다
 * @returns {Array|null}  요약 배열. 대중교통 단계가 하나도 없으면 null(도보만인 경로는 요약을 남기지 않는다)
 */
export function summarizeTransitSteps(route) {
  const legs = Array.isArray(route?.legs) ? route.legs : [];
  const out = [];
  let hasTransit = false;
  const pushWalk = (s) => {
    if (s <= 0) return;
    const last = out[out.length - 1];
    if (last && last.t === 'WALK') last.s += s;
    else out.push({ t: 'WALK', s });
  };
  for (const leg of legs) {
    for (const step of Array.isArray(leg?.steps) ? leg.steps : []) {
      const dur = seconds(step?.staticDuration ?? step?.duration);
      const td = step?.transitDetails;
      if (step?.travelMode === 'TRANSIT' && td) {
        hasTransit = true;
        const line = td.transitLine || {};
        const stops = td.stopDetails || {};
        out.push({
          t: 'TRANSIT',
          v: typeof line?.vehicle?.type === 'string' ? line.vehicle.type : 'OTHER',
          line: clip(line.nameShort || line.name || ''),
          from: clip(stops?.departureStop?.name),
          to: clip(stops?.arrivalStop?.name),
          stops: Number.isInteger(td.stopCount) && td.stopCount >= 0 ? td.stopCount : null,
          s: dur,
        });
      } else {
        pushWalk(dur);   // WALK 와 그 밖의 비대중교통 단계(예: 환승 통로)는 도보로 합친다
      }
    }
  }
  if (!hasTransit) return null;
  if (out.length > MAX_STEPS) {
    // 조용히 자르면 도착까지 완성된 경로처럼 보인다(codex 9/6) → 생략 표시를 남긴다
    return [...out.slice(0, MAX_STEPS), { t: 'MORE' }];
  }
  return out;
}

// TRANSIT 모드 요청에만 붙이는 필드마스크(Compute Routes Essentials SKU 그대로 — 대중교통·상세 필드는 상위 SKU 조건이 아니다, 2026-09-06 구글 문서 확인).
export const TRANSIT_FIELD_MASK = [
  'routes.duration',
  'routes.distanceMeters',
  'routes.legs.steps.travelMode',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.transitDetails.stopCount',
  'routes.legs.steps.transitDetails.transitLine.name',
  'routes.legs.steps.transitDetails.transitLine.nameShort',
  'routes.legs.steps.transitDetails.transitLine.vehicle.type',
  'routes.legs.steps.transitDetails.stopDetails.departureStop.name',
  'routes.legs.steps.transitDetails.stopDetails.arrivalStop.name',
].join(',');

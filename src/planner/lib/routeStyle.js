import { TRAVEL_ASSUMPTIONS } from './travelTime';

// 지도 경로 색 (2026-09-20, 쿠마님 10067: "도보나 교통으로 나오는 거 색을 구분해서 알아볼 수 있게").
// 두 지도 제공자(google/osm)·범례·핀 목록 구간 줄이 전부 이 표를 읽는다. 순수 함수(vitest).
//   WALK    초록 짧은 점선 — 걷는 구간
//   TRANSIT 파랑 실선     — 대중교통
//   DRIVE   주황 긴 점선  — 차량 (실선끼리는 색각 이상에서 안 갈려 형태도 다르게, agy 검토)
// 선은 흰 외곽선(halo) 위에 얹는다 — 공원(초록)·강(파랑) 타일 위에서 묻히지 않게.
// 모드를 모르는 구간(옛 저장분·좌표 없는 핀을 건너뛴 구간)은 예전 모양(파랑 짧은 점선) 그대로.
export const ROUTE_MODE_STYLE = Object.freeze({
  WALK: Object.freeze({ color: '#059669', dash: 'short', label: TRAVEL_ASSUMPTIONS.WALK.label }),
  TRANSIT: Object.freeze({ color: '#1A56DB', dash: null, label: TRAVEL_ASSUMPTIONS.TRANSIT.label }),
  DRIVE: Object.freeze({ color: '#D97706', dash: 'long', label: TRAVEL_ASSUMPTIONS.DRIVE.label }),
});
export const ROUTE_DEFAULT_STYLE = Object.freeze({ color: '#1A56DB', dash: 'short', label: '이동' });
export const ROUTE_HALO = '#FFFFFF';

export const routeStyleFor = (mode) => ROUTE_MODE_STYLE[mode] || ROUTE_DEFAULT_STYLE;

// SVG/Leaflet 용 dashArray (선 굵기 3~4 기준). null 이면 실선.
export const dashArrayFor = (dash) => (dash === 'short' ? '6 6' : dash === 'long' ? '12 8' : null);

/**
 * 핀 배열(원래 순서, 좌표 없는 핀 포함)과 legs(핀 i→i+1)를 받아 그릴 구간 목록을 만든다.
 * 좌표가 없는 핀은 건너뛰고 앞뒤 좌표 있는 핀을 잇는다(기존 동작). 건너뛴 구간은 도보·대중교통이 섞였을 수 있어
 * 모드를 단정하지 않고 기본 스타일로 둔다(agy 검토). key 는 핀 id 기반 — 순서를 끌어 바꿔도 다른 구간이 같은 key 를 안 갖는다.
 * 반환: [{ key, a:{lat,lng}, b:{lat,lng}, mode, style }]
 */
export function routeSegments(pins, legs) {
  const list = Array.isArray(pins) ? pins : [];
  const items = Array.isArray(legs) ? legs : [];
  const ok = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
  const out = [];
  let prev = -1;
  for (let i = 0; i < list.length; i += 1) {
    if (!ok(list[i])) continue;
    if (prev >= 0) {
      const mode = i - prev === 1 ? items[prev]?.mode || null : null;
      out.push({
        key: `${list[prev].id ?? prev}-${list[i].id ?? i}`,
        a: { lat: list[prev].lat, lng: list[prev].lng },
        b: { lat: list[i].lat, lng: list[i].lng },
        mode,
        style: routeStyleFor(mode),
      });
    }
    prev = i;
  }
  return out;
}

/** 범례에 보여 줄 항목 — 실제로 그려진 구간의 모드만, 표 순서대로. 모드를 모르는 구간만 있으면 빈 배열(범례 없음). */
export function legendEntries(segments) {
  const present = new Set((segments || []).map((s) => s.mode).filter(Boolean));
  return Object.entries(ROUTE_MODE_STYLE)
    .filter(([mode]) => present.has(mode))
    .map(([mode, style]) => ({ mode, ...style }));
}

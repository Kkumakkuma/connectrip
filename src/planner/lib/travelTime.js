// 이동시간 추정 (설계 §4 routes 폴백).
//
// 경로 API(구글 Routes)가 아직 붙지 않았으므로 두 지점의 직선거리(하버사인)에 보정계수를 곱해
// 이동 거리를 어림하고, 수단별 평균 속도로 시간을 나눈다. 실제 도로·환승·신호를 계산하지 않으므로
// 결과에는 반드시 source:'estimate' 가 붙고 화면에도 "예상"으로만 표시한다.
//
// 순수 함수만 둔다(네트워크·DOM 접근 없음). 계산 규칙을 바꿀 일이 생기면 아래 상수만 고친다.

// WGS84 평균 반지름(m).
export const EARTH_RADIUS_M = 6371008.8;

// 수단별 가정값. speedKmh = 평균 이동 속도, detour = 직선거리 → 실제 경로 보정계수.
// 도보·차량은 설계 §4 의 ×1.3, 대중교통은 노선이 직선에 가깝다고 보고 보정 없이 평균 속도만 쓴다.
export const TRAVEL_ASSUMPTIONS = Object.freeze({
  WALK: { speedKmh: 4.5, detour: 1.3, label: '도보' },
  DRIVE: { speedKmh: 28, detour: 1.3, label: '차량' },
  TRANSIT: { speedKmh: 20, detour: 1.0, label: '대중교통' },
});

// 직선거리가 이 값 이하면 도보, 넘으면 대중교통으로 본다.
export const WALK_MAX_M = 1200;

const toRad = (deg) => (deg * Math.PI) / 180;

// 좌표 한 값을 숫자로 읽는다. Number(null)·Number('')·Number(false) 가 전부 0 이라
// Number.isFinite 만으로는 "값 없음"이 적도·본초자오선 좌표로 둔갑한다 — 먼저 걸러낸다.
function coordNumber(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readPoint(point) {
  if (!point || typeof point !== 'object') return null;
  const lat = coordNumber(point.lat);
  const lng = coordNumber(point.lng);
  return lat === null || lng === null ? null : { lat, lng };
}

// 두 좌표 사이의 대권 거리(m). 좌표가 없으면 null.
export function haversineMeters(from, to) {
  const a1 = readPoint(from);
  const b1 = readPoint(to);
  if (!a1 || !b1) return null;
  const lat1 = toRad(a1.lat);
  const lat2 = toRad(b1.lat);
  const dLat = lat2 - lat1;
  const dLng = toRad(b1.lng - a1.lng);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

// 거리만 보고 이동 수단을 고른다. 사용자가 수단을 고르는 UI 가 생기면 그 값이 우선한다.
export function pickMode(straightMeters) {
  if (!Number.isFinite(straightMeters)) return 'WALK';
  return straightMeters <= WALK_MAX_M ? 'WALK' : 'TRANSIT';
}

// 한 구간 추정. 좌표가 없으면 null 을 돌려주고, 호출부는 이동시간 칩을 그리지 않는다.
//   반환 { mode, distance_m, duration_s, source:'estimate' }
export function estimateLeg(from, to, mode) {
  const straight = haversineMeters(from, to);
  if (straight === null) return null;

  const key = mode && TRAVEL_ASSUMPTIONS[mode] ? mode : pickMode(straight);
  const { speedKmh, detour } = TRAVEL_ASSUMPTIONS[key];
  const distance = straight * detour;
  const seconds = (distance / (speedKmh * 1000)) * 3600;

  return {
    mode: key,
    distance_m: Math.round(distance),
    duration_s: Math.round(seconds),
    source: 'estimate',
  };
}

// 핀 배열의 연속 구간을 한 번에 추정한다. 결과 길이는 places.length - 1,
// 좌표가 없는 구간 자리에는 null 이 들어간다(인덱스가 핀 순서와 어긋나지 않게 한다).
export function estimateLegs(places, mode) {
  const list = Array.isArray(places) ? places : [];
  if (list.length < 2) return [];
  const legs = [];
  for (let i = 0; i < list.length - 1; i += 1) {
    legs.push(estimateLeg(list[i], list[i + 1], mode));
  }
  return legs;
}

// 구간 합계(초). null 구간은 0으로 센다.
export function totalDurationSeconds(legs) {
  return (Array.isArray(legs) ? legs : []).reduce(
    (sum, leg) => sum + (leg && Number.isFinite(leg.duration_s) ? leg.duration_s : 0),
    0
  );
}

// 초 → "12분" / "1시간 5분". 1분 미만은 "1분 미만".
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return '1분 미만';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

// 미터 → "900m" / "1.4km".
export function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) return '';
  if (meters < 1000) return `${Math.round(meters / 10) * 10}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

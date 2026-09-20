// 구글 인코딩 폴리라인 → [{lat,lng}] (Encoded Polyline Algorithm Format, 정밀도 1e-5). 의존성 없이 순수 함수(vitest).
// 지도 경로를 핀 사이 직선이 아니라 실제 길로 그리기 위한 것(2026-09-20 쿠마님). 잘못된 문자·중간에서 잘림·범위 밖 좌표면
// 빈 배열(직선으로 폴백). 앞부분만 돌려주면 길을 따라가다 목적지로 튀는 꺾은선이 그려진다(agy 검토) — 통째로 버린다.
const MAX_POINTS = 5000;

export function decodePolyline(encoded, maxPoints = MAX_POINTS) {
  if (typeof encoded !== 'string' || !encoded) return [];
  const out = [];
  const len = encoded.length;
  let index = 0;
  let lat = 0;
  let lng = 0;
  const readValue = () => {
    let result = 0;
    let shift = 0;
    let b;
    do {
      if (index >= len || shift > 30) return null;
      b = encoded.charCodeAt(index) - 63;
      index += 1;
      if (b < 0 || b > 63) return null;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < len && out.length < maxPoints) {
    const dLat = readValue();
    if (dLat === null) return [];
    const dLng = readValue();
    if (dLng === null) return [];
    lat += dLat;
    lng += dLng;
    const p = { lat: lat / 1e5, lng: lng / 1e5 };
    if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return [];
    out.push(p);
  }
  return out;
}

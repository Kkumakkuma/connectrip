import { useMemo } from 'react';
import { dayColor } from '../lib/itineraryColors';

// 여행 일정 스냅샷의 핀 좌표만으로 그리는 인라인 SVG 미니맵.
//
// 지도 타일도, 지도 API 키도 쓰지 않는다. 목록에 카드가 20장 깔려도 외부 요청은 0건이고,
// 구글/OSM 어느 쪽 장소 데이터를 담은 일정이든 표시 조건이 같다(좌표만 쓰므로 제공자 약관 무관).
// 실제 지형 대신 "핀이 어떻게 흩어져 있고 어떤 순서로 이어지는지"만 보여준다.
//
// days = 스냅샷의 days 배열 [{ index, date, places: [{ order, lat, lng }] }].

const VIEW_W = 100;
const VIEW_H = 62;
const PAD = 8;
// 최소 표시 범위(도). 핀이 한 점에 몰려도 확대가 무한정 커지지 않게 한다(약 100m).
const MIN_SPAN = 1e-3;

// 스냅샷은 서버가 조립하지만, 화면은 값이 깨져 있어도 죽지 않아야 한다.
// 좌표가 아닌 값은 조용히 버리고 남은 것만 그린다.
function toGroups(days) {
  if (!Array.isArray(days)) return [];
  const groups = [];
  days.forEach((day, i) => {
    const places = Array.isArray(day?.places) ? day.places : [];
    const pts = places
      .slice()
      .sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0))
      .map((p) => ({ lat: Number(p?.lat), lng: Number(p?.lng) }))
      .filter(
        (p) =>
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lng) &&
          Math.abs(p.lat) <= 90 &&
          Math.abs(p.lng) <= 180
      );
    if (pts.length > 0) groups.push({ index: Number.isFinite(Number(day?.index)) ? Number(day.index) : i, pts });
  });
  return groups;
}

function buildShapes(days) {
  const groups = toGroups(days);
  const all = groups.flatMap((g) => g.pts);
  if (all.length === 0) return { shapes: [], count: 0 };

  // 위도가 높아질수록 경도 1도의 실제 폭이 좁아진다. 평균 위도의 코사인으로 x 를 눌러
  // 짧은 구간에서도 동서/남북 비율이 실제와 비슷하게 보이도록 한다.
  const meanLat = all.reduce((sum, p) => sum + p.lat, 0) / all.length;
  const kx = Math.max(Math.cos((meanLat * Math.PI) / 180), 0.05);
  const raw = groups.map((g) => ({
    index: g.index,
    pts: g.pts.map((p) => ({ x: p.lng * kx, y: -p.lat })),
  }));

  const xs = raw.flatMap((g) => g.pts.map((p) => p.x));
  const ys = raw.flatMap((g) => g.pts.map((p) => p.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // 핀이 한 곳에 몰려 있으면 폭이 0 이 된다 → 0 으로 나누지 않도록 하한(약 100m)을 둔다.
  const spanX = Math.max(maxX - minX, MIN_SPAN);
  const spanY = Math.max(maxY - minY, MIN_SPAN);
  const scale = Math.min((VIEW_W - PAD * 2) / spanX, (VIEW_H - PAD * 2) / spanY);
  // 가운데 정렬은 '핀들의 중심'을 기준으로 한다. 하한을 씌운 폭을 기준으로 잡으면
  // 핀이 하나뿐일 때 그 점이 상자 한쪽 구석으로 밀린다(실측).
  const offX = VIEW_W / 2 - ((minX + maxX) / 2) * scale;
  const offY = VIEW_H / 2 - ((minY + maxY) / 2) * scale;

  const round = (n) => Math.round(n * 100) / 100;
  const shapes = raw.map((g) => ({
    index: g.index,
    color: dayColor(g.index),
    pts: g.pts.map((p) => ({ x: round(p.x * scale + offX), y: round(p.y * scale + offY) })),
  }));
  return { shapes, count: all.length };
}

const ItineraryMiniMap = ({ days, className = '', dense = false, title }) => {
  const { shapes, count } = useMemo(() => buildShapes(days), [days]);

  if (count === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-xs text-gray-400 ${className}`}
      >
        위치 정보가 없는 일정입니다
      </div>
    );
  }

  const dotR = dense ? 1.4 : 1.9;
  const strokeW = dense ? 1 : 1.4;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label={title || `장소 ${count}곳의 위치를 표시한 지도 미리보기`}
    >
      {shapes.map((g) => (
        <g key={g.index}>
          {g.pts.length > 1 && (
            <polyline
              points={g.pts.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={g.color}
              strokeWidth={strokeW}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.55"
            />
          )}
          {g.pts.map((p, i) => (
            <circle key={`${g.index}-${i}`} cx={p.x} cy={p.y} r={dotR} fill={g.color} />
          ))}
        </g>
      ))}
    </svg>
  );
};

export default ItineraryMiniMap;

import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// 오픈스트리트맵 지도 (설계 §4). providers/index.js 의 공통 인터페이스를 그대로 구현한다.
//
// 저작권 표기는 OSM 이용 약관상 필수라 attributionControl 을 끄지 않는다.
// 타일은 OSM 공식 타일 서버를 쓰고, 이 지도 위에는 OSM 계열 데이터만 올린다
// (구글 장소 데이터를 여기에 얹는 것은 구글 약관 3.2.4 위반이다).
//
// 기본 마커 아이콘은 쓰지 않는다 — leaflet 의 마커 이미지는 CSS 상대경로로 불러서 번들러마다
// 경로가 깨지고, 일정판에는 어차피 "몇 번째 핀"이라는 순번 표시가 필요하다. divIcon 으로 직접 그린다.

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '지도 데이터 &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">OpenStreetMap</a> 기여자';

// 핀이 하나도 없을 때의 초기 시야(서울 시청). 위치 권한은 쓰지 않는다(1차 범위 밖).
const FALLBACK_LAT = 37.5663;
const FALLBACK_LNG = 126.9779;
const DEFAULT_ZOOM = 13;
const MAX_FIT_ZOOM = 16;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function pinIcon(label, selected) {
  // label 은 순번(숫자)만 넣는다. 사용자 입력 문자열을 html 로 꽂지 않는다.
  const text = String(label ?? '').replace(/[^0-9]/g, '') || '·';
  return L.divIcon({
    className: 'ct-pin-icon',
    html: `<span class="ct-pin-dot${selected ? ' is-selected' : ''}">${text}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export default function MapView({
  center,
  pins = [],
  route = false,
  onLongPress,
  onPinClick,
  className = '',
}) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  // 좌표 구성이 바뀔 때만 시야를 다시 맞춘다 — 핀을 고르기만 해도 지도가 튀면 쓰기 어렵다.
  const lastFitRef = useRef('');
  // 콜백은 ref 로 받는다. deps 에 직접 넣으면 부모가 인라인 함수를 넘길 때마다 지도가 다시 만들어진다.
  const longPressRef = useRef(onLongPress);
  const pinClickRef = useRef(onPinClick);
  useEffect(() => {
    longPressRef.current = onLongPress;
    pinClickRef.current = onPinClick;
  });

  const valid = useMemo(
    () => (pins || []).filter((p) => isNum(p.lat) && isNum(p.lng)),
    [pins]
  );

  // 지도 생성은 마운트당 1회.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;

    const map = L.map(box, {
      zoomControl: true,
      attributionControl: true,
      // 데스크톱에서 페이지 스크롤이 지도에 먹히지 않게 한다. 확대·축소는 +/- 버튼으로 한다.
      scrollWheelZoom: false,
    });
    map.setView([FALLBACK_LAT, FALLBACK_LNG], DEFAULT_ZOOM);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = group;

    // 길게 누르기 = leaflet 의 contextmenu(모바일 롱탭·마우스 우클릭이 모두 여기로 온다).
    map.on('contextmenu', (event) => {
      longPressRef.current?.({ lat: event.latlng.lat, lng: event.latlng.lng });
    });

    // 날짜 탭 전환·시트 열림으로 컨테이너 크기가 바뀌면 타일이 어긋난다.
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => map.invalidateSize({ animate: false }))
        : null;
    observer?.observe(box);

    return () => {
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      lastFitRef.current = '';
    };
  }, []);

  // 핀·경로 다시 그리기 + 필요할 때만 시야 맞추기.
  useEffect(() => {
    const map = mapRef.current;
    const group = layerRef.current;
    if (!map || !group) return;

    group.clearLayers();

    valid.forEach((pin, i) => {
      const marker = L.marker([pin.lat, pin.lng], {
        icon: pinIcon(pin.label ?? i + 1, pin.selected),
        keyboard: true,
        title: pin.name || undefined,
        alt: pin.name || `${i + 1}번째 장소`,
      });
      marker.on('click', () => pinClickRef.current?.(pin.id));
      marker.addTo(group);
    });

    if (route && valid.length >= 2) {
      L.polyline(
        valid.map((p) => [p.lat, p.lng]),
        { color: '#1A56DB', weight: 3, opacity: 0.65, dashArray: '6 6' }
      ).addTo(group);
    }

    const fitKey = valid.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');
    if (fitKey === lastFitRef.current) return;
    lastFitRef.current = fitKey;

    if (valid.length === 1) {
      map.setView([valid[0].lat, valid[0].lng], Math.max(map.getZoom(), DEFAULT_ZOOM));
    } else if (valid.length > 1) {
      map.fitBounds(L.latLngBounds(valid.map((p) => [p.lat, p.lng])), {
        padding: [40, 40],
        maxZoom: MAX_FIT_ZOOM,
      });
    } else if (center && isNum(center.lat) && isNum(center.lng)) {
      map.setView([center.lat, center.lng], DEFAULT_ZOOM);
    }
  }, [valid, route, center]);

  return (
    // isolate 로 스태킹 컨텍스트를 만든다 — leaflet 내부 pane 의 z-index(400~700)가
    // 바텀시트(z-70)·토스트(z-80) 위로 올라오지 않게 가둔다.
    <div
      ref={boxRef}
      className={`isolate ${className}`}
      role="application"
      aria-label="여행 일정 지도"
    />
  );
}

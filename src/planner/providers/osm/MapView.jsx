import { useEffect, useMemo, useRef } from 'react';
import { ROUTE_HALO, dashArrayFor, routeSegments } from '../../lib/routeStyle';
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
const FOCUS_ZOOM = 15; // "내 위치" 로 옮길 때 최소 확대 — 동네가 보이는 정도

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

// 내 위치(파란 점). 숫자 없이 작게 — 순번 핀과 헷갈리지 않게.
function meIcon() {
  return L.divIcon({
    className: 'ct-me-icon',
    html: '<span class="ct-me-dot"></span>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export default function MapView({
  center,
  pins = [],
  me = null,
  focus = null,
  route = false,
  legs = null,      // [{mode:'WALK'|'TRANSIT'|'DRIVE', ...}] — 핀 i→i+1. 없으면 예전처럼 한 색.
  onLongPress,
  onPinClick,
  className = '',
}) {
  const boxRef = useRef(null);
  const segments = useMemo(() => (route ? routeSegments(pins, legs) : []), [route, pins, legs]);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const meLayerRef = useRef(null); // 내 위치 점은 핀 레이어와 따로 둔다(핀을 다시 그릴 때 같이 지워지지 않게)
  const lastFocusRef = useRef(0);
  const focusRetryRef = useRef(null); // 애니메이션 중이라 버려진 setView 를 moveend 뒤 한 번 더 적용하는 리스너
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
    const meGroup = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = group;
    meLayerRef.current = meGroup;

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
      meLayerRef.current = null;
      lastFitRef.current = '';
      lastFocusRef.current = 0;
      focusRetryRef.current = null;
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

    // 구간마다 이동수단 색(routeStyle): 도보 초록 짧은 점선, 대중교통 파랑 실선, 차량 주황 긴 점선(2026-09-20 쿠마님).
    // 흰 외곽선(halo)을 먼저 깔아 공원·강 타일 위에서도 보이게 한다(agy 검토).
    segments.forEach((s) => {
      const line = [[s.a.lat, s.a.lng], [s.b.lat, s.b.lng]];
      const dashArray = dashArrayFor(s.style.dash);
      L.polyline(line, { color: ROUTE_HALO, weight: s.style.dash ? 6 : 7, opacity: 0.9, dashArray }).addTo(group);
      L.polyline(line, { color: s.style.color, weight: s.style.dash ? 3 : 4, opacity: 0.9, dashArray }).addTo(group);
    });

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
  }, [valid, route, segments, center]);

  // 내 위치 점. 그리기만 하고 시야는 옮기지 않는다.
  useEffect(() => {
    const group = meLayerRef.current;
    if (!group) return;
    group.clearLayers();
    if (me && isNum(me.lat) && isNum(me.lng)) {
      L.marker([me.lat, me.lng], { icon: meIcon(), interactive: false, keyboard: false, alt: '내 위치' }).addTo(group);
    }
  }, [me]);

  // "내 위치" 버튼 — focus.n 이 바뀔 때마다 그 좌표로 옮긴다(2026-09-18). 핀 범위 맞춤보다 사용자가 누른 이동이 이긴다.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || !isNum(focus.lat) || !isNum(focus.lng)) return;
    if (focus.n === lastFocusRef.current) return;
    lastFocusRef.current = focus.n;
    if (focusRetryRef.current) {
      map.off('moveend', focusRetryRef.current);
      focusRetryRef.current = null;
    }
    const target = L.latLng(focus.lat, focus.lng);
    const apply = () => map.setView(target, Math.max(map.getZoom(), FOCUS_ZOOM));
    apply();
    // leaflet 은 줌 애니메이션 중이면 setView 를 조용히 버린다(_tryAnimatedZoom 이 true 만 돌려줌 — codex 지적).
    // 적용이 안 됐으면(중심이 아직 멀면) 진행 중인 이동이 끝난 뒤 한 번 더 적용한다. 리스너는 다음 focus·언마운트에서 정리.
    if (map.getCenter().distanceTo(target) > 5) {
      const retry = () => {
        focusRetryRef.current = null;
        apply();
      };
      focusRetryRef.current = retry;
      map.once('moveend', retry);
    }
  }, [focus]);

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

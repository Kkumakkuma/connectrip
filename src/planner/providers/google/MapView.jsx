import { useEffect, useMemo, useRef, useState } from 'react';
import { APIProvider, AdvancedMarker, Map as GoogleMap, Polyline, useMap } from '@vis.gl/react-google-maps';
import { supabase } from '../../../lib/supabase';
import MapNotice from '../MapNotice';

// 구글 지도 (설계 §4, 2026-09-05 구현 — 교차검토 v2 반영). providers/index.js 의 공통 인터페이스를 그대로 구현한다.
//
// 이 모듈은 loadMapView() 가 제공자가 'google' 일 때만 동적으로 불러온다. 그래서 @vis.gl/react-google-maps 를
// 정적으로 import 해도 OSM 사용자는 내려받지 않는다(빌드 청크 분리 실측).
//
// 지키는 것
//   · 지도 로드 예산: <Map> 을 그리기 전에 planner_map_load_slot() 로 오늘 슬롯(사용자 60·전역 300)을 예약한다.
//     승인 전에는 지도 트리를 아예 그리지 않는다 — Map 객체가 만들어지는 순간이 과금 단위다(codex 지적).
//     재마운트는 새 Map = 새 과금이므로 승인도 다시 받는다(전역 캐시 없음).
//   · 실패는 전부 안내문: 키 없음·슬롯 거부·RPC 오류·스크립트 로드 실패·키 거부(gm_authFailure). OSM 으로 내려가지 않는다
//     (구글 장소가 이미 있는 상태에서 OSM 지도를 그리면 약관 3.2.4 위반).
//   · clickableIcons=false: 구글 POI 를 눌러 뜨는 구글 정보창을 막는다. 우리 핀 흐름과 섞이지 않게.
//   · gestureHandling=cooperative: 데스크톱에서 페이지 스크롤이 지도에 먹히지 않는다(OSM 의 scrollWheelZoom off 와 같은 목적).
//   · 핀은 AdvancedMarker + 기존 .ct-pin-dot 순번 원. 순번 숫자만 넣고 사용자 문자열은 html 로 꽂지 않는다.
//   · 길게 누르기: DOM 포인터 이벤트(600ms, 이동 10px 이내) + OverlayView 투영으로 좌표를 얻는다. 데스크톱 우클릭·
//     안드로이드 크롬 롱탭이 내는 contextmenu 도 받되, 1초 안에 이미 발화했으면 무시한다(이중 발화 방지).
//   · 구글 로고·약관 링크는 지도 내장 표기 그대로 둔다(CSS 로 가리지 않는다).

const BROWSER_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY || '').trim();
const MAP_ID_ENV = String(import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || '').trim();
// AdvancedMarker 는 Map ID 가 필수다. env 가 비면 구글 공개 데모 ID 로 그리되 콘솔에 알린다(운영은 실제 Map ID 권장).
const MAP_ID = MAP_ID_ENV || 'DEMO_MAP_ID';
if (!MAP_ID_ENV && typeof console !== 'undefined') {
  console.warn('[planner] VITE_GOOGLE_MAPS_MAP_ID 가 없어 DEMO_MAP_ID 로 지도를 그립니다.');
}

const FALLBACK_CENTER = { lat: 37.5663, lng: 126.9779 }; // 서울 시청. 위치 권한은 쓰지 않는다(1차 범위 밖).
const DEFAULT_ZOOM = 13;
const MAX_FIT_ZOOM = 16;
const FIT_PADDING = 40;
const LONG_PRESS_MS = 600;
const MOVE_TOLERANCE_PX = 10;
const DEDUPE_MS = 1000;
// OSM 과 같은 점선 경로. 본선은 투명하게 두고 icons 로 점선을 찍는다(구글 Polyline 의 표준 점선 기법).
const ROUTE_STYLE = {
  strokeColor: '#1A56DB',
  strokeOpacity: 0,
  strokeWeight: 3,
  icons: [
    {
      icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.65, strokeWeight: 3, scale: 3 },
      offset: '0',
      repeat: '14px',
    },
  ],
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const gmaps = () => (typeof window !== 'undefined' ? window.google?.maps : undefined);

// 좌표 구성이 바뀔 때만 시야를 다시 맞춘다 — 핀을 고르기만 해도 지도가 튀면 쓰기 어렵다(OSM 과 같은 규칙).
function FitBounds({ pins, center }) {
  const map = useMap();
  const lastFitRef = useRef('');
  const clampRef = useRef(null);

  useEffect(
    () => () => {
      clampRef.current?.remove();
      clampRef.current = null;
    },
    []
  );

  useEffect(() => {
    const gm = gmaps();
    if (!map || !gm) return;
    // 핀이 없을 때는 center 가 키가 된다 — 핀 없는 날짜끼리 오갈 때 중심 이동이 씹히지 않게(agy 권고).
    const fitKey = pins.length
      ? pins.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|')
      : `c:${center && isNum(center.lat) ? center.lat.toFixed(5) : ''},${center && isNum(center.lng) ? center.lng.toFixed(5) : ''}`;
    if (fitKey === lastFitRef.current) return;
    lastFitRef.current = fitKey;
    clampRef.current?.remove();
    clampRef.current = null;

    if (pins.length === 1) {
      map.setCenter({ lat: pins[0].lat, lng: pins[0].lng });
      map.setZoom(Math.max(map.getZoom() ?? DEFAULT_ZOOM, DEFAULT_ZOOM));
    } else if (pins.length > 1) {
      const bounds = new gm.LatLngBounds();
      pins.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
      // fitBounds 직후에는 zoom 이 아직 안 바뀌어 있다. idle 한 번 뒤에 상한을 건다(codex 권고).
      clampRef.current = gm.event.addListenerOnce(map, 'idle', () => {
        clampRef.current = null;
        if ((map.getZoom() ?? 0) > MAX_FIT_ZOOM) map.setZoom(MAX_FIT_ZOOM);
      });
      map.fitBounds(bounds, FIT_PADDING);
    } else if (center && isNum(center.lat) && isNum(center.lng)) {
      map.setCenter({ lat: center.lat, lng: center.lng });
      map.setZoom(DEFAULT_ZOOM);
    }
  }, [map, pins, center]);

  return null;
}

// 길게 누르기. 포인터 이벤트로 시작·이동·종료를 보고, 600ms 를 넘기면 그 자리 좌표를 넘긴다.
function LongPressLayer({ longPressRef, lastFireRef }) {
  const map = useMap();

  useEffect(() => {
    const gm = gmaps();
    if (!map || !gm) return undefined;
    const div = map.getDiv();
    if (!div) return undefined;

    // 화면 픽셀 → 좌표 변환은 OverlayView 의 투영으로만 할 수 있다. 아무것도 그리지 않는 오버레이를 하나 둔다.
    const overlay = new gm.OverlayView();
    overlay.onAdd = () => {};
    overlay.draw = () => {};
    overlay.onRemove = () => {};
    overlay.setMap(map);

    let timer = null;
    let start = null;
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      start = null;
    };
    const onDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return; // 우클릭은 contextmenu 가 맡는다
      // 확대 버튼·구글 표기 링크·핀 위에서 누르고 있는 건 "빈 곳 길게 누르기"가 아니다(codex 권고).
      if (e.target?.closest?.('button, a, gmp-advanced-marker, .gm-style-cc')) return;
      cancel();
      start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => {
        timer = null;
        const at = start;
        start = null;
        if (!at) return;
        if (Date.now() - lastFireRef.current < DEDUPE_MS) return; // contextmenu 가 먼저 처리했다
        const proj = overlay.getProjection();
        if (!proj) return;
        const rect = div.getBoundingClientRect();
        const latLng = proj.fromContainerPixelToLatLng(new gm.Point(at.x - rect.left, at.y - rect.top));
        if (!latLng) return;
        lastFireRef.current = Date.now();
        longPressRef.current?.({ lat: latLng.lat(), lng: latLng.lng() });
      }, LONG_PRESS_MS);
    };
    const onMove = (e) => {
      if (!start) return;
      if (Math.abs(e.clientX - start.x) > MOVE_TOLERANCE_PX || Math.abs(e.clientY - start.y) > MOVE_TOLERANCE_PX) cancel();
    };

    div.addEventListener('pointerdown', onDown);
    div.addEventListener('pointermove', onMove);
    div.addEventListener('pointerup', cancel);
    div.addEventListener('pointercancel', cancel);
    div.addEventListener('pointerleave', cancel);
    const drag = map.addListener('dragstart', cancel);

    return () => {
      cancel();
      div.removeEventListener('pointerdown', onDown);
      div.removeEventListener('pointermove', onMove);
      div.removeEventListener('pointerup', cancel);
      div.removeEventListener('pointercancel', cancel);
      div.removeEventListener('pointerleave', cancel);
      drag?.remove?.();
      overlay.setMap(null);
    };
  }, [map, longPressRef, lastFireRef]);

  return null;
}

export default function MapView({
  center,
  pins = [],
  route = false,
  onLongPress,
  onPinClick,
  className = '',
}) {
  // 콜백은 ref 로 받는다. 부모가 인라인 함수를 넘겨도 지도가 다시 만들어지지 않게(OSM 과 같다).
  const longPressRef = useRef(onLongPress);
  const pinClickRef = useRef(onPinClick);
  useEffect(() => {
    longPressRef.current = onLongPress;
    pinClickRef.current = onPinClick;
  });
  const lastFireRef = useRef(0);

  const valid = useMemo(
    () => (pins || []).filter((p) => isNum(p.lat) && isNum(p.lng)),
    [pins]
  );

  // 'pending' → 슬롯 RPC 결과에 따라 'ok' | 'denied' | 'error'. 키가 없으면 처음부터 'nokey'.
  const [slot, setSlot] = useState(BROWSER_KEY ? 'pending' : 'nokey');
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!BROWSER_KEY) return undefined;
    let alive = true;
    supabase
      .rpc('planner_map_load_slot')
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          console.error('지도 슬롯을 확인하지 못했습니다:', error);
          setSlot('error');
        } else {
          setSlot(data === true ? 'ok' : 'denied');
        }
      })
      .catch((err) => {
        console.error('지도 슬롯을 확인하지 못했습니다:', err);
        if (alive) setSlot('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  // 키 거부·리퍼러 불일치·결제 문제는 스크립트가 전역 콜백으로만 알려 준다. 기존 값은 보존하고 되돌린다.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const prev = window.gm_authFailure;
    const installed = () => {
      setLoadError(true);
      if (typeof prev === 'function') prev();
    };
    window.gm_authFailure = installed;
    return () => {
      // 다른 인스턴스가 그 사이 갈아끼웠으면 건드리지 않는다(codex 권고).
      if (window.gm_authFailure === installed) window.gm_authFailure = prev;
    };
  }, []);

  const handleContextmenu = (event) => {
    event?.domEvent?.preventDefault?.();
    const at = event?.detail?.latLng;
    if (!at) return;
    // vis.gl 은 detail.latLng 를 리터럴({lat,lng})로 준다(1.9 d.ts 실측). 혹시 LatLng 객체가 와도 받게 둘 다 처리한다.
    const lat = typeof at.lat === 'function' ? at.lat() : at.lat;
    const lng = typeof at.lng === 'function' ? at.lng() : at.lng;
    if (!isNum(lat) || !isNum(lng)) return;
    if (Date.now() - lastFireRef.current < DEDUPE_MS) return;
    lastFireRef.current = Date.now();
    longPressRef.current?.({ lat, lng });
  };

  if (slot === 'nokey' || slot === 'error' || loadError) {
    return (
      <MapNotice
        className={className}
        message="지도를 불러올 수 없습니다."
        sub="아래 목록으로는 그대로 편집할 수 있습니다."
      />
    );
  }
  if (slot === 'pending') {
    return <MapNotice className={className} message="지도를 불러오는 중입니다." />;
  }
  if (slot === 'denied') {
    return (
      <MapNotice
        className={className}
        message="오늘 지도 표시 한도에 도달했습니다."
        sub="아래 목록으로는 그대로 편집할 수 있습니다."
      />
    );
  }

  const initialCenter = center && isNum(center.lat) && isNum(center.lng) ? center : FALLBACK_CENTER;

  return (
    // isolate: 구글 지도 내부 요소의 z-index 가 바텀시트(z-70)·토스트(z-80) 위로 올라오지 않게 가둔다.
    <div className={`isolate ${className}`} role="application" aria-label="여행 일정 지도">
      <APIProvider
        apiKey={BROWSER_KEY}
        language="ko"
        region="KR"
        onError={(err) => {
          console.error('구글 지도를 불러오지 못했습니다:', err);
          setLoadError(true);
        }}
      >
        <GoogleMap
          mapId={MAP_ID}
          defaultCenter={initialCenter}
          defaultZoom={DEFAULT_ZOOM}
          style={{ width: '100%', height: '100%' }}
          gestureHandling="cooperative"
          zoomControl
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={false}
          clickableIcons={false}
          onContextmenu={handleContextmenu}
        >
          {valid.map((pin, i) => {
            const text = String(pin.label ?? i + 1).replace(/[^0-9]/g, '') || '·';
            return (
              <AdvancedMarker
                key={pin.id ?? i}
                position={{ lat: pin.lat, lng: pin.lng }}
                // 원형 핀은 좌표가 한가운데 오게 한다(anchorPoint 는 1.9 에서 deprecated → anchorLeft/Top).
                anchorLeft="-50%"
                anchorTop="-50%"
                title={pin.name || `${i + 1}번째 장소`}
                zIndex={pin.selected ? 2 : 1}
                onClick={() => pinClickRef.current?.(pin.id)}
              >
                <span className={`ct-pin-dot${pin.selected ? ' is-selected' : ''}`}>{text}</span>
              </AdvancedMarker>
            );
          })}
          {route && valid.length >= 2 && (
            <Polyline path={valid.map((p) => ({ lat: p.lat, lng: p.lng }))} {...ROUTE_STYLE} />
          )}
          <FitBounds pins={valid} center={center} />
          <LongPressLayer longPressRef={longPressRef} lastFireRef={lastFireRef} />
        </GoogleMap>
      </APIProvider>
    </div>
  );
}

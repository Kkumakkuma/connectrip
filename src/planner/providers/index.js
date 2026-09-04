// 지도·장소 제공자 어댑터 (설계 §4).
//
// 제공자 선택의 단일 출처는 env 가 아니라 DB 단일행 planner_settings.google_maps_enabled 이고,
// 프런트는 planner_google_enabled() RPC 로 그 값을 읽는다 (agy-7).
// env 로 갈라 두면 지도 제공자와 장소 데이터 제공자가 서로 다른 값을 볼 수 있고,
// 그 상태는 구글 약관 3.2.4("No Use With Non-Google Maps") 위반이 된다.
//
// ⚠ RPC 가 실패하면 OSM 으로 강등하지 않는다. 구글 장소 데이터가 이미 저장된 상태에서 지도만
//   OSM 으로 내려가면 같은 위반이 되기 때문이다. 판정을 못 하면 "지도를 불러올 수 없습니다"
//   목록 모드로 떨어뜨린다(SQL 3-a 절 주석과 같은 결론).
//
// 지도 컴포넌트 공통 인터페이스 — 어느 제공자를 쓰든 이 props 만 받는다.
//   center      { lat, lng }            초기 중심. 핀이 있으면 핀 범위가 우선한다.
//   pins        [{ id, lat, lng, label, selected }]
//   route       boolean                 핀을 순서대로 잇는 선을 그릴지
//   onLongPress ({ lat, lng }) => void  빈 곳을 길게 눌러 핀을 만들 때
//   onPinClick  (id) => void
//   className   string                  높이는 부모가 정한다

import { supabase } from '../../lib/supabase';

export const MAP_PROVIDERS = Object.freeze({ GOOGLE: 'google', OSM: 'osm' });

// 지도를 못 그릴 때 화면이 목록 모드로 떨어질 수 있도록 중심 좌표 기본값만 둔다(서울 시청).
// '내 위치'는 1차 범위 밖이라 위치 권한을 쓰지 않는다.
export const DEFAULT_CENTER = Object.freeze({ lat: 37.5663, lng: 126.9779 });

let providerPromise = null;

// 한 세션에서 한 번만 묻는다. 값이 바뀌는 시점(구글 키 도입)에는 어차피 재배포가 따라온다.
export function getMapProvider() {
  if (!providerPromise) {
    providerPromise = supabase
      .rpc('planner_google_enabled')
      .then(({ data, error }) => {
        if (error) throw error;
        return data === true ? MAP_PROVIDERS.GOOGLE : MAP_PROVIDERS.OSM;
      })
      .catch((err) => {
        providerPromise = null; // 다음 진입에서 다시 시도할 수 있게 캐시를 비운다
        throw err;
      });
  }
  return providerPromise;
}

// 테스트·로그아웃 등 상태가 바뀔 때 캐시를 버린다.
export function resetMapProvider() {
  providerPromise = null;
}

// 제공자별 지도 모듈을 지연 로드한다. leaflet 은 여기서 처음 모듈 그래프에 들어오므로
// 일정판에 들어오기 전에는 내려받지 않는다.
export async function loadMapView(provider) {
  if (provider === MAP_PROVIDERS.GOOGLE) {
    const mod = await import('./google/MapView.jsx');
    return mod.default;
  }
  const mod = await import('./osm/MapView.jsx');
  return mod.default;
}

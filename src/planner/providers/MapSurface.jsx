import { useEffect, useState } from 'react';
import { MAP_PROVIDERS, getMapProvider, loadMapView } from './index';
import MapNotice from './MapNotice';

// 지도 자리. 제공자를 DB 에서 확인한 뒤 해당 지도 모듈을 지연 로드한다.
// 화면 쪽은 제공자가 무엇인지 알 필요가 없고 이 컴포넌트만 쓴다.
//
// 지도를 못 그리는 상황(제공자 판정 실패·모듈 로드 실패)에서도 일정판 전체가 멈추지 않도록
// 여기서 자리만 대체하고 예외를 위로 올리지 않는다 — 핀 목록만으로 모든 조작이 되어야 한다(설계 D5).
//
// 역방향 가드(2026-09-05 교차검토 agy): 제공자가 osm 으로 판정됐는데 구글 출처 핀(pins[].provider === 'google')이
// 하나라도 있으면 Leaflet 위에 구글 데이터를 올리는 셈이라 약관 3.2.4 위반이다. 플래그 롤백·판정 오류 등 어떤
// 이유로든 그 상태가 되면 지도를 그리지 않고 목록 모드로 떨어뜨린다.

// hasGoogleData: 화면에 그리는 날짜 밖(다른 날짜·보관함)에도 구글 출처 핀이 있으면 true 로 넘긴다(codex 지적 — 현재 날짜
// 핀만 보면 다른 날짜로 넘길 때 OSM 지도 위에 구글 핀이 올라가는 순간이 생긴다).
// provenance: 핀 출처를 아직 모르면 'loading', 알아냈으면 'ready', 못 알아냈으면 'error'(agy 지적 — 카탈로그가 오기 전엔
// 출처가 전부 null 이라 가드가 비어 있다). OSM 판정일 때만 의미가 있다: 'loading' 이면 지도를 잠시 보류하고, 'error' 면
// 확인이 안 되므로 그리지 않는다. 구글 지도 위에는 OSM 출처 핀이 올라가도 되니 구글 판정에는 적용하지 않는다.
// 두 prop 모두 지도 모듈에는 넘기지 않는다.
export default function MapSurface({ className = '', hasGoogleData = false, provenance = 'ready', ...mapProps }) {
  const [state, setState] = useState({ status: 'loading', View: null, provider: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const provider = await getMapProvider();
        const View = await loadMapView(provider);
        if (alive) setState({ status: 'ready', View, provider });
      } catch (err) {
        console.error('지도를 불러오지 못했습니다:', err);
        if (alive) setState({ status: 'error', View: null, provider: null });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const googlePinOnOsm =
    state.status === 'ready' &&
    state.provider === MAP_PROVIDERS.OSM &&
    (hasGoogleData || (mapProps.pins || []).some((p) => p?.provider === 'google'));

  useEffect(() => {
    if (googlePinOnOsm) {
      console.warn('[planner] 구글 출처 핀이 있는데 제공자가 OSM 으로 판정돼 지도를 그리지 않습니다.');
    }
  }, [googlePinOnOsm]);

  const osmWaiting = state.status === 'ready' && state.provider === MAP_PROVIDERS.OSM && provenance === 'loading';
  const osmUnverified = state.status === 'ready' && state.provider === MAP_PROVIDERS.OSM && provenance === 'error';

  if (state.status === 'loading' || osmWaiting) {
    return <MapNotice className={className} message="지도를 불러오는 중입니다." />;
  }

  if (state.status === 'error' || !state.View || googlePinOnOsm || osmUnverified) {
    return (
      <MapNotice
        className={className}
        message="지도를 불러올 수 없습니다."
        sub="아래 목록으로는 그대로 편집할 수 있습니다."
      />
    );
  }

  const { View } = state;
  return <View className={className} {...mapProps} />;
}

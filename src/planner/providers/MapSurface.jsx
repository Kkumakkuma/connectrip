import { useEffect, useState } from 'react';
import { MapPinned } from 'lucide-react';
import { getMapProvider, loadMapView } from './index';

// 지도 자리. 제공자를 DB 에서 확인한 뒤 해당 지도 모듈을 지연 로드한다.
// 화면 쪽은 제공자가 무엇인지 알 필요가 없고 이 컴포넌트만 쓴다.
//
// 지도를 못 그리는 상황(제공자 판정 실패·모듈 로드 실패)에서도 일정판 전체가 멈추지 않도록
// 여기서 자리만 대체하고 예외를 위로 올리지 않는다 — 핀 목록만으로 모든 조작이 되어야 한다(설계 D5).

function Notice({ className, message, sub }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-md border border-hairline bg-surface-soft px-6 text-center ${className}`}
    >
      <MapPinned size={22} className="text-muted-soft" aria-hidden="true" />
      <p className="text-sm text-muted">{message}</p>
      {sub && <p className="text-xs text-muted-soft">{sub}</p>}
    </div>
  );
}

export default function MapSurface({ className = '', ...mapProps }) {
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

  if (state.status === 'loading') {
    return <Notice className={className} message="지도를 불러오는 중입니다." />;
  }

  if (state.status === 'error' || !state.View) {
    return (
      <Notice
        className={className}
        message="지도를 불러올 수 없습니다."
        sub="아래 목록으로는 그대로 편집할 수 있습니다."
      />
    );
  }

  const { View } = state;
  return <View className={className} {...mapProps} />;
}

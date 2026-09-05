import { MapPinned } from 'lucide-react';

// 지도를 못 그릴 때 그 자리에 두는 안내. MapSurface(제공자 판정 실패)와 google/MapView(키·한도·로드 실패)가 같이 쓴다.
// 지도가 없어도 핀 목록만으로 모든 조작이 되어야 한다는 규칙(설계 D5)에 따라 항상 목록 안내를 덧붙일 수 있게 sub 를 받는다.
export default function MapNotice({ className = '', message, sub }) {
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

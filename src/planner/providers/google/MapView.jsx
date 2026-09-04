import { MapPinned } from 'lucide-react';

// 구글 지도 자리 (설계 §4).
//
// 지금은 구글 결제 계정이 보류라 planner_settings.google_maps_enabled 가 false 이고,
// 이 모듈은 로드되지 않는다. providers/index.js 가 인터페이스만 맞춰 두고 실제 구현은 비워 둔다.
//
// 키가 생겼을 때 여기서 할 일
//   1) `@vis.gl/react-google-maps` 를 설치하고 이 파일에서 동적으로 부른다
//      (정적 import 로 올리면 OSM 만 쓰는 지금도 번들에 딸려 들어간다).
//   2) props 는 providers/index.js 에 적힌 공통 인터페이스 그대로 받는다
//      — center / pins / route / onLongPress / onPinClick / className.
//      onLongPress 는 google.maps 의 'contextmenu' 이벤트에 붙인다.
//   3) 목록 표시에 "Google" 출처 표기를 넣는다(구글 약관).
//   4) 이 지도 위에는 구글에서 받은 장소만 올린다 — OSM 데이터를 섞지 않는다(약관 3.2.4).
//
// 그 전까지는 화면이 조용히 비지 않도록 이유를 적은 자리를 그린다. 지도가 없어도
// 핀 목록만으로 모든 조작이 되어야 한다는 규칙(설계 D5)은 이 상태에서도 그대로 지켜진다.
export default function MapView({ className = '' }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-md border border-hairline bg-surface-soft px-6 text-center ${className}`}
    >
      <MapPinned size={22} className="text-muted-soft" aria-hidden="true" />
      <p className="text-sm text-muted">지도를 불러올 수 없습니다.</p>
      <p className="text-xs text-muted-soft">아래 목록으로는 그대로 편집할 수 있습니다.</p>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { isNativeApp } from '../lib/native';

// 앱(안드로이드) 오프닝 모션 — 브랜드 딥틸 화면 위로 로고가 떨어져 흔들리고,
// 워드마크가 떠오른 뒤 전체가 페이드아웃한다(콜드 스타트 1회, 웹에서는 렌더 안 함).
// 장식 레이어라 pointer-events 없음 — 뜨는 동안에도 화면 조작을 막지 않는다.
export default function AppSplash() {
  const [gone, setGone] = useState(() => !isNativeApp());

  useEffect(() => {
    if (gone) return undefined;
    const t = setTimeout(() => setGone(true), 2600); // fade-out(2.05s+0.45s) 끝난 뒤 unmount
    return () => clearTimeout(t);
  }, [gone]);

  if (gone) return null;
  return (
    <div className="app-splash" aria-hidden="true">
      <div className="app-splash-drop">
        <img src="/brand/logo-mark-white.png" alt="" className="app-splash-logo" />
      </div>
      <p className="app-splash-word">커넥<span className="app-splash-word-accent">트립</span></p>
    </div>
  );
}

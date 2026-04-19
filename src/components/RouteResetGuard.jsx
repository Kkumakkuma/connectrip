import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// 모든 경로 변경 시 스크롤을 맨 위로 올리고,
// 동일 경로 재진입(같은 path, 다른 key)도 감지해 일관된 네비 UX 제공.
export default function RouteResetGuard() {
  const location = useLocation();

  useEffect(() => {
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    } catch {
      window.scrollTo(0, 0);
    }
  }, [location.key]);

  return null;
}

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from '../lib/analytics';

// SPA 라우팅 페이지뷰 전송. VITE_GA_ID 가 없으면 trackPageView 가 즉시 반환하므로 무동작.
export default function AnalyticsTracker() {
  const location = useLocation();
  const lastPathRef = useRef(null);

  useEffect(() => {
    const path = location.pathname + location.search;
    if (lastPathRef.current === path) return; // 같은 경로 재렌더 시 중복 전송 방지
    lastPathRef.current = path;
    trackPageView(path);
  }, [location.pathname, location.search]);

  return null;
}

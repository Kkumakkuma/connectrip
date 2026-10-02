import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { isSensitiveLocation, sanitizeUrl, trackPageView } from '../lib/analytics';

// SPA 라우팅 페이지뷰 전송. 앱(Capacitor)에서는 trackPageView 가 즉시 반환하므로 무동작.
// 본인확인 값은 보내지 않는다(2026-10-02 PASS 결속 설계 v2 §3.4 C1):
//  - 본인확인 화면(/app-identity)·복귀 주소(flow=identity·ds)에서는 보내지 않는다. 화면이 복귀 쿼리를 지워 깨끗한
//    주소가 되면 그때 한 번 보낸다(첫 전송 때 trackPageView 가 gtag 를 넣는다).
//  - 그동안 '마지막 경로'는 비운다(P3 검토) — 본인확인을 다녀와 같은 화면으로 돌아와도 새 방문으로 센다.
//  - 같은 화면 판정과 전송 모두 정제된 경로로 한다(복귀 키만 달라진 주소는 같은 화면).
export default function AnalyticsTracker() {
  const { pathname, search } = useLocation();
  const lastPathRef = useRef(null);

  useEffect(() => {
    if (isSensitiveLocation({ pathname, search })) {
      lastPathRef.current = null;
      return;
    }
    const path = sanitizeUrl(pathname + search);
    if (lastPathRef.current === path) return; // 같은 경로 재렌더 시 중복 전송 방지
    if (trackPageView(path)) lastPathRef.current = path; // 실제로 보낸 경로만 기억(못 보냈으면 다음 전환 때 다시)
  }, [pathname, search]);

  return null;
}

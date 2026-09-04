// /planner 스코프 서비스워커 등록 (설계 §7.1).
//
// 가드 네 겹을 모두 통과할 때만 등록한다.
//   1. 플래너 기능이 켜져 있을 것 — 꺼진 빌드에서 워커만 살아 있으면 안 된다
//   2. 앱(Capacitor 네이티브)이 아닐 것 — 앱은 번들을 직접 싣는다
//   3. 브라우저가 서비스워커를 지원할 것
//   4. 지금 보고 있는 주소가 /planner 아래일 것
//
// ⚠ scope 는 '/planner/' 가 아니라 '/planner' 다. 트레일링 슬래시를 붙이면
//   랜딩 주소 /planner 자신이 스코프 밖으로 빠져 정작 첫 화면이 캐시되지 않는다.
import { PLANNER_ENABLED } from '../lib/featureFlags';

let done = false;

export function registerOfflineSW() {
  if (done) return;
  done = true;

  if (!PLANNER_ENABLED) return;
  if (typeof window === 'undefined') return;
  if (window.Capacitor?.isNativePlatform?.()) return;
  if (!('serviceWorker' in navigator)) return;
  // 접두사만 보면 /plannerfoo 도 통과한다. 경계를 명시한다.
  const path = window.location.pathname;
  if (path !== '/planner' && !path.startsWith('/planner/')) return;

  // 등록 실패는 조용히 넘긴다 — 오프라인 캐시는 있으면 좋은 것이지 없으면 못 쓰는 기능이 아니다.
  navigator.serviceWorker.register('/planner-sw.js', { scope: '/planner' }).catch(() => {});
}

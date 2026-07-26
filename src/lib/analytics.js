// GA4 로더 — 측정 ID 가 있는 빌드에서만 동작한다.
//
// 측정 ID 는 코드에 박지 않고 빌드 환경변수 VITE_GA_ID 로만 받는다.
// (Vercel > Settings > Environment Variables 에 VITE_GA_ID = G-XXXXXXXXXX 추가 후 재배포)
// ID 가 없으면 스크립트를 아예 주입하지 않으므로 지금 배포에는 아무 영향이 없다.
//
// 안드로이드 앱(Capacitor)에서는 로드하지 않는다 — 웹뷰의 origin 이 웹과 달라
// 같은 속성에 섞이면 웹 지표가 오염된다.
import { isNativeApp } from './native';

const GA_ID = import.meta.env.VITE_GA_ID;

let injected = false;

export const isAnalyticsEnabled = () => Boolean(GA_ID) && !isNativeApp();

export function initAnalytics() {
  if (injected || !isAnalyticsEnabled()) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  injected = true;

  window.dataLayer = window.dataLayer || [];
  // gtag 는 arguments 객체를 그대로 넣어야 GA 가 인식한다(배열로 바꾸면 안 됨).
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag('js', new Date());
  // SPA 라우팅은 자동 page_view 가 첫 진입만 잡으므로 끄고 trackPageView 로 직접 보낸다.
  gtag('config', GA_ID, { send_page_view: false });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(script);
}

export function trackPageView(path) {
  if (!isAnalyticsEnabled()) return;
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  });
}

// GA4 로더.
//
// 기본값 = 실측정 ID G-9Y4692NWJP (GA 속성 ConnectTrip, 2026-07-26 발급).
// 측정 ID 는 페이지 소스에 노출되는 공개 식별자라 커밋해도 된다(비밀키 아님).
// 빌드 환경변수 VITE_GA_ID 를 넣으면 그 값이 우선한다(속성 교체용).
//
// 안드로이드 앱(Capacitor)에서는 로드하지 않는다 — 웹뷰의 origin 이 웹과 달라
// 같은 속성에 섞이면 웹 지표가 오염된다.
import { isNativeApp } from './native';

const GA_ID = import.meta.env.VITE_GA_ID || 'G-9Y4692NWJP';

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

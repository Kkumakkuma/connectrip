// 기능 플래그 단일 입력점.
//
// PAYMENTS_ENABLED — 포트원(KG이니시스) 카드결제로 포인트를 충전하는 기능.
//   2026-09-03: PG 정책상 "포인트 충전"은 카드결제 입점이 안 돼 사용자에게서 숨김(쿠마님 지시).
//   코드·DB(ct_payment_orders, ct_charge_points_by_payment)·API(api/payment/*)는 그대로 두고
//   이 플래그로만 가린다. 다시 켤 때: Vercel 에 VITE_PAYMENTS_ENABLED=true(빌드) + PAYMENTS_ENABLED=true(서버)
//   를 넣고 재배포 → routeMeta.js 의 '/points' 주석 해제, public/sitemap.xml 에 /points 복구,
//   public/robots.txt 의 Disallow: /points 와 Disallow: /api/payment/ 제거,
//   capacitor.config.json allowNavigation 에 "*.inicis.com"·"inicis.com" 복구 후 `npm run app:sync`(앱 재빌드),
//   src/pages/Terms.jsx 6조 둘째 문단·7조(결제·환불·청약철회)를 git 이력의 2026-09-02 본으로 복구,
//   MyPage·MarketBoard 의 "1P = 1원" 문구는 필요하면 같은 커밋(24a8355) 이력에서 되살린다.
//   포인트는 그동안 추천 보너스·게시글 좋아요 적립으로만 쌓이고, 매칭신청권(30,000P)은 그 포인트로 구매한다.
//   (플래그가 꺼져 있어도 Points 페이지 청크·products.js 는 번들에 남는다 — 라우트가 NotFound 라 사용자에겐 안 보임, 코드 보존 목적.)
export const PAYMENTS_ENABLED = import.meta.env.VITE_PAYMENTS_ENABLED === 'true';

// PLANNER_ENABLED — 여행 플래너(/planner/*). 웹에서만 켜고 안드로이드 앱 빌드에서는 끈다.
//   앱은 "여행 일정" 게시판과 가져오기만 갖고, 플래너 화면 자체를 싣지 않는다(.env.app 에 false 고정).
//   ⚠ 이 상수는 "라우트를 표시할지"만 결정한다. 코드를 번들에서 빼는 일은 vite.config.js 의
//   '@planner' alias 가 맡는다 — 플래그가 꺼져도 최상위 lazy(() => import('...')) 는 청크를
//   그대로 만들기 때문이다(위 Points 사례가 같은 현상). 그래서 App.jsx 는 lazy 호출식 자체를
//   삼항 안에 넣고(PLANNER_ENABLED ? lazy(...) : null), alias 는 OFF 일 때 빈 스텁을 가리킨다.
//   켤 때: Vercel 에 VITE_PLANNER_ENABLED=true(빌드) + PLANNER_ENABLED=true(서버리스) 를 넣고 재배포.
export const PLANNER_ENABLED = import.meta.env.VITE_PLANNER_ENABLED === 'true';

// 기능 플래그 단일 입력점.
//
// PAYMENTS_ENABLED — 포트원(KG이니시스) 카드결제로 포인트를 충전하는 기능.
//   2026-09-03: PG 정책상 "포인트 충전"은 카드결제 입점이 안 돼 사용자에게서 숨김(쿠마님 지시).
//   코드·DB(ct_payment_orders, ct_charge_points_by_payment)·API(api/payment/*)는 그대로 두고
//   이 플래그로만 가린다. 다시 켤 때: Vercel 에 VITE_PAYMENTS_ENABLED=true(빌드) + PAYMENTS_ENABLED=true(서버)
//   를 넣고 재배포 → routeMeta.js 의 '/points' 주석 해제, public/sitemap.xml 에 /points 복구,
//   public/robots.txt 의 Disallow: /points 제거, capacitor.config.json allowNavigation 에 *.inicis.com 복구.
//   포인트는 그동안 추천 보너스·게시글 좋아요 적립으로만 쌓이고, 매칭신청권(30,000P)은 그 포인트로 구매한다.
export const PAYMENTS_ENABLED = import.meta.env.VITE_PAYMENTS_ENABLED === 'true';

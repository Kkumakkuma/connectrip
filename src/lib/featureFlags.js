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

// ITINERARY_ENABLED — "여행 일정" 게시판(/itinerary). 플래너와 별개 플래그인 이유는
//   앱 빌드가 PLANNER_ENABLED=false 인데도 게시판은 실어야 하기 때문이다(8889 통합안).
//   2026-09-04 쿠마님 지시로 지금은 양쪽 다 꺼 둔다 — 플래너 없이 게시판만 열면 글을 올릴
//   경로가 없어 빈 게시판이 된다. 플래너 완성 시 웹은 둘 다, 앱은 이 플래그만 켠다.
//   켤 때: Vercel 에 VITE_ITINERARY_ENABLED=true, 앱은 .env.app 에 같은 값.
export const ITINERARY_ENABLED = import.meta.env.VITE_ITINERARY_ENABLED === 'true';

// FAMILY_SITES_ENABLED — 푸터 "패밀리 사이트" 3개(TravelDeal·가전딜·DiskRescue) 노출.
//   2026-09-04 쿠마님 지시로 잠시 내린다. 커넥트립을 먼저 정식 오픈하는데, 나머지 사이트가
//   아직 다 구현된 상태가 아니라 지금 링크를 걸면 방문자가 미완성 화면을 보게 된다.
//   나머지 사이트가 완성되면 이 값을 true 로 바꾸면 그대로 돌아온다(링크 목록은 Footer 에 그대로 둔다).
export const FAMILY_SITES_ENABLED = false;

// PROMO_REVIEWS_ENABLED — 상단 메뉴 "여행상품 홍보 및 후기"(/reviews, /reviews/:regionId, Promotions.jsx: 홍보·후기 게시판).
//   2026-09-06 쿠마님 지시: 초창기라 업체가 홍보할 상황이 아니니 일반회원·승무원 모두에게 숨긴다. 회원이 늘어 알려지면 다시 켠다.
//   끄면 네비 메뉴·첫 화면 카드·라우트(주소 직접 입력도 NotFound)·키워드 알림 대상에서 빠진다. 코드·DB(reviews 테이블)는 그대로다.
//   "여행후기 및 Q&A" 메뉴의 여행 후기 탭(TravelQnA, 같은 reviews 테이블의 type=review)은 이 플래그와 무관하게 유지된다.
//   켤 때: 이 값을 true 로 바꾸고 재배포(라우트·메뉴·카드·알림이 한 번에 돌아온다).
export const PROMO_REVIEWS_ENABLED = false;

// REFERRAL_ENABLED — 승무원 추천코드(초대링크 ?ref=, 가입 폼 "추천 승무원 ID / 추천코드" 칸, 마이페이지 "내 추천코드" 카드, 가입 시 3,000P 추천 보너스).
//   2026-09-14 쿠마님 지시: 추천코드 기능은 사이트에서 전부 숨긴다. 나중에 필요하면 다시 켠다.
//   끄면 가입 폼 두 화면(SignupEmail·SignupComplete)의 추천인 칸, ?ref= 자동 입력·제출 시 추천인 해석, 마이페이지 추천코드 카드와
//   get_my_referral_code 조회가 빠진다. 코드·DB(find_crew_referrer / get_my_referral_code / grant_referral_bonus, profiles.referred_by)는 그대로다.
//   켤 때: 이 값을 true 로 바꾸고 재배포.
export const REFERRAL_ENABLED = false;

// COMMENDATION_ENABLED — 칭찬매칭(구 칭송매칭): 마이페이지 "칭찬매칭" 탭(CommendationMatching), 승무원 대시보드의 "신청권 구매"·"나의 매칭신청권 보유량",
//   관리자 "칭찬 인증" 탭·회원 목록의 신청권 지급, 알림 설정의 "칭찬매칭" 토글.
//   2026-09-14 쿠마님 지시: 칭찬 관련 기능은 사이트에서 전부 숨긴다. 나중에 필요하면 다시 켠다.
//   끄면 마이페이지 기본 탭이 "키워드 알림"이 되고 ?tab=commendation 직접 진입도 막힌다. 비행 스케줄 등록·같은 편 게시판은 이 플래그와 무관하게 유지.
//   코드·DB(commendation_matches, purchase_voucher, refund_my_voucher, admin_get_commendation_reviews, profiles.voucher_count)는 그대로다.
//   개인정보처리방침의 칭찬매칭 이용 목적도 이 플래그를 따른다. 가입 화면의 주소 입력(components/AddressInput)은 이 플래그와 무관하게
//   항상 받는다(2026-09-14 쿠마님 지시 — 주소는 없애지 말 것, 방침상 목적 = 경품·답례품 배송).
//   이용약관 "매칭신청권의 취소" 조항은 포인트로 사고 되돌리는 규정이라 COMMENDATION_ENABLED && POINTS_ENABLED 일 때만 보인다(Terms.jsx).
//   켤 때: 이 값을 true 로 바꾸고 재배포(탭·버튼·관리자 탭·알림 토글·약관 조항이 한 번에 돌아온다).
//   ⚠ 약관·방침 문구가 바뀌므로 켜는 배포에서 Terms/Privacy 의 '최종 개정일'과 DB complete_signup_profile_for 의 v_policy_version 을 같은 날짜로 올린다.
export const COMMENDATION_ENABLED = false;

// POINTS_ENABLED — 포인트: 마이페이지 "나의 보유 포인트"(여행자)·"CREW 포인트 대시보드"(좋아요 → 포인트 전환)·"최근 포인트 내역",
//   관리자 회원 목록의 포인트 열·포인트 선물 버튼, 이용약관 "포인트" 조항, 개인정보처리방침·가입 동의문의 "포인트 적립·이용" 목적.
//   2026-09-14 쿠마님 지시: 결제·칭찬매칭·추천코드가 모두 꺼져 포인트를 쓸 곳이 없으니 포인트 현황도 전부 숨긴다.
//   코드·DB(points_balance, available_likes, point_transactions, convert_likes_to_points, admin_grant_points)는 그대로이며 좋아요 적립은 DB 에서 계속 쌓인다.
//   켤 때: 이 값을 true 로 바꾸고 재배포. 포인트는 칭찬매칭(매칭신청권 구매)·추천 보너스와 묶여 있으니 보통 COMMENDATION_ENABLED 와 함께 켠다.
//   ⚠ 약관·방침 문구가 바뀌므로 켜는 배포에서 '최종 개정일'과 v_policy_version 을 함께 올린다.
export const POINTS_ENABLED = false;

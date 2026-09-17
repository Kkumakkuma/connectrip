// 첫 화면(홈) 문구의 단일 출처.
//
// 왜 모듈로 뺐나 (2026-09-17):
// 홈은 SPA 껍데기라 크롤러가 받는 HTML 의 <body> 안에 글자가 한 자도 없었다. 구글은 JS 를 실행해
// 화면을 보지만 네이버 Yeti 는 그러지 않아, "커넥트립" 한글 질의에 걸릴 텍스트가 색인에 없었다
// (실측 2026-09-17: 네이버가 우리 홈을 색인은 했으나 제목이 영문 구버전이었고, 한글 질의는
//  "커넥트랩" 오타 교정으로 새어 나갔다).
//
// 그래서 scripts/prerender-seo.mjs 가 홈 dist/index.html 에 <noscript> 본문을 굽는다. 그 문구가
// 화면 문구와 갈라지면 클로킹이 되므로, Hero.jsx·CategoryBoard.jsx 와 프리렌더가 이 파일 하나를
// 같이 읽는다. 문구를 고칠 때는 여기만 고친다.
//
// ⚠ 이 파일은 빌드 스크립트(node)가 그대로 import 한다. import.meta.env·featureFlags 처럼
// 브라우저 전용 값에 의존하면 빌드가 깨진다. 순수 데이터만 둘 것.

// 화면에 실제로 있는 브랜드 표기. Navbar 로고의 대체텍스트가 이 값이고, 크롤러용 본문의 머리말도 같다.
export const SITE_NAME = '커넥트립 ConnectTrip';

// 푸터 문장. 화면에서는 두 줄로 갈리고, 크롤러용 본문에서는 이어 붙인다.
export const BRAND_TAGLINE_LINES = [
    '우리는 여행을 통해 세상을 더 넓게 보고, 새로운 경험을 선물합니다.',
    '당신의 다음 여행을 커넥트립과 함께하세요.',
];

export const HERO_BADGE = '현직 승무원 인증 커뮤니티';

// 화면에서는 <br /> 로 줄이 갈리고, 크롤러용 본문에서는 한 문장으로 이어 붙인다.
export const HERO_TITLE_LINES = ['여행자부터 승무원까지 모두를 연결하는,', '특별한 여행 플랫폼'];

export const HERO_DESCRIPTION =
    '동행 찾기부터 알짜배기 정보, 알뜰한 거래까지 여행에 필요한 것들을 한곳에 모았습니다. 현직 승무원들의 노하우와 함께 나만의 여행을 만들어보세요.';

// 첫 화면 게시판 카드. CategoryBoard.jsx 가 로그인 상태·기능 플래그로 다시 거른다.
//   publicVisible: 로그인하지 않은 방문자에게도 보이는 카드인가. 프리렌더는 이 값이 true 인 것만 굽는다
//   (CREW 전용은 승무원 로그인, 홍보·후기는 PROMO_REVIEWS_ENABLED 가 켜져야 화면에 뜬다).
export const HOME_CATEGORIES = [
    { id: 'companion', name: '여행 동행자 모집', desc: '함께 떠날 마음 맞는 동행자를 찾아보세요.', image: '/boards/companion.webp', path: '/companion', publicVisible: true },
    { id: 'qna', name: '여행후기 및 Q&A', desc: '생생한 여행 후기를 공유하고, 궁금한 건 바로 질문하세요.', image: '/boards/qna.webp', path: '/qna', publicVisible: true },
    { id: 'market', name: '물품거래 및 나눔', desc: '여행 용품을 나누고 필요한 물건을 저렴하게 구하세요.', image: '/boards/market.webp', path: '/market', publicVisible: true },
    { id: 'reviews', name: '여행상품 홍보 및 후기', desc: '생생한 여행 후기와 다양한 여행 상품을 만나보세요.', image: '/boards/reviews.webp', path: '/reviews', publicVisible: false },
    { id: 'recommend', name: '승무원 추천지', desc: '현직 승무원이 전하는 진짜 맛집과 숨은 명소입니다.', image: '/boards/recommend.webp', path: '/recommend', publicVisible: true },
    // 여행 일정 게시판은 첫 화면 카드에 넣지 않는다(2026-09-04 쿠마님). 상단 메뉴 "여행 플래너 → 여행 일정 게시판"으로만.
    { id: 'crew', name: 'CREW 전용', desc: '승무원끼리 정보를 공유하고 특별 할인 혜택을 확인하세요.', image: '/boards/crew.webp', path: '/crew', publicVisible: false },
];

// 로그인하지 않은 방문자에게 보이는 카드인가. CategoryBoard(화면)와 prerender-seo.mjs(크롤러 본문)가
// 같은 판정을 쓰도록 함수로 둔다. reviews 는 기능 플래그가 켜져야 화면에 뜨므로 인자로 받는다
// — featureFlags.js 는 import.meta.env 를 써서 node 빌드 스크립트가 import 할 수 없기 때문이다.
export function isPublicHomeCategory(cat, { promoReviewsEnabled = false } = {}) {
    if (cat.id === 'reviews') return promoReviewsEnabled;
    return cat.publicVisible;
}

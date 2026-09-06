// 라우트별 SEO 문구 단일 출처.
//
// 왜 필요한가:
// SEOHead.jsx 는 title·description·canonical·og:url 을 useEffect 안에서 고쳐 쓴다.
// 즉 브라우저가 JS 를 실행한 뒤에야 값이 바뀐다. 렌더링을 하지 않는 크롤러(네이버 Yeti,
// Bingbot 등)는 vercel.json 의 SPA 리라이트가 돌려준 index.html 을 그대로 읽으므로,
// 사이트맵에 올린 모든 하위 경로가 "홈의 title·description·canonical" 을 선언한 문서로
// 수집된다. 결과적으로 하위 페이지가 홈의 중복으로 판정된다.
// scripts/prerender-seo.mjs 가 빌드 후 이 표를 읽어 경로별 정적 HTML 을 만든다.
//
// 값의 출처:
// 아래 문구는 새로 지은 것이 아니라, 각 화면이 이미 <SEOHead ... /> 에 넘기고 있는 값을
// 그대로 옮긴 것이다. 화면 쪽 문구를 고칠 때는 이 파일도 함께 고쳐야 정적 HTML 과
// 클라이언트가 선언하는 값이 갈라지지 않는다.
//   /                    src/pages/Home.jsx
//   /companion           src/components/CompanionBoard.jsx (2026-09-07 통합 — 대륙별 경로 없음, ?region= 필터)
//   /qna                 src/components/TravelQnA.jsx
//   /market              src/components/MarketBoard.jsx
//   /reviews             src/components/Promotions.jsx
//   /recommend           src/components/Destinations.jsx
//   /itinerary           src/components/ItineraryBoard.jsx
//   /search              src/pages/Search.jsx
//   /signup              src/pages/Signup.jsx (기본 mode = 'signup')

export const BASE_URL = 'https://www.connecttrip.co.kr';

// robots 는 화면이 SEOHead 에 명시적으로 넘긴 경우에만 적는다. 없으면 index.html 기본값
// (index, follow)을 그대로 둔다.
export const ROUTE_META = {
  '/': {
    title: 'ConnectTrip - 여행자부터 승무원까지 모두를 연결하는 여행 플랫폼',
    description:
      '동행 찾기, 여행 Q&A, 물품거래, 승무원 추천까지. 여행자부터 승무원까지 모두를 연결하는 여행 정보 공유 플랫폼.',
  },
  '/companion': {
    title: '여행 동행자 모집 - ConnectTrip',
    description: '함께 여행할 동행자를 찾아보세요. 지역별 여행 동행 모집 게시판.',
  },
  '/qna': {
    title: '여행후기 및 Q&A - ConnectTrip',
    description: '여행 후기를 공유하고, 여행 관련 질문과 답변을 나누세요.',
  },
  '/market': {
    title: '물품거래 및 나눔 - ConnectTrip',
    description: '여행 물품 거래, 나눔, 중고 거래를 ConnectTrip에서 만나보세요.',
  },
  '/reviews': {
    title: '여행 후기 게시판 - ConnectTrip',
    description:
      '여행자와 승무원이 직접 남긴 생생한 여행 후기와 추천 상품 정보. 지역별 여행 경험을 공유하고 확인하세요.',
  },
  '/recommend': {
    title: '여행지 추천 - ConnectTrip',
    description:
      '승무원들이 직접 추천하는 전 세계 여행지. 유럽, 미주, 동남아 등 지역별 숨은 명소와 핫플레이스를 만나보세요.',
  },
  // 여행 일정 게시판은 ITINERARY_ENABLED 가 꺼져 있는 동안 라우트가 없다(2026-09-04).
  // 프리렌더는 사이트맵을 따라가므로 사이트맵에서 빼는 것으로 굽기가 멈추지만,
  // 문구는 다시 열 때 그대로 쓰려고 남겨 둔다. 켤 때: 아래 주석 해제 + 사이트맵 복구.
  // 글 단위 경로(/itinerary/:postId)는 사이트맵에 없어 프리렌더 대상이 아니다.
  // '/itinerary': {
  //   title: '여행 일정 - ConnectTrip',
  //   description:
  //     '여행자들이 직접 짠 날짜별 여행 일정을 살펴보고, 마음에 드는 일정을 내 플래너로 가져오세요.',
  // },
  '/search': {
    title: '검색 결과 - ConnectTrip',
    description: 'ConnectTrip에서 동행, 장터, Q&A, 승무원 게시판을 통합 검색하세요.',
    robots: 'noindex, follow',
  },
  '/signup': {
    title: '회원가입 - ConnectTrip',
    description: 'ConnectTrip 회원가입 — 여행자와 승무원을 잇는 여행 동행 커뮤니티.',
  },
  '/terms': {
    title: '이용약관 - ConnectTrip',
    description: 'ConnectTrip 서비스 이용약관. 회원의 권리와 의무, 서비스 이용 조건을 안내합니다.',
  },
  '/privacy': {
    title: '개인정보처리방침 - ConnectTrip',
    description: 'ConnectTrip 개인정보처리방침. 수집하는 개인정보 항목과 이용 목적, 보관 기간을 안내합니다.',
  },
  // 2026-09-03 결제 기능 숨김(featureFlags.PAYMENTS_ENABLED) — 다시 켤 때 주석 해제
  //   '/points': {
  //     title: '포인트·매칭신청권 안내 - ConnectTrip',
  //     description: 'ConnectTrip 포인트 충전 금액과 매칭신청권 가격, 사용처, 환불 기준 안내.',
  //   },
};

// 사이트맵에 있어도 정적 HTML 을 굽지 않는 경로.
// 로그인·권한이 필요하거나 개인화된 화면이라 크롤러에게 보여 줄 고정 문서가 없다.
// 색인 차단 경로의 단일 출처 (설계 §1.3(d) codex-22).
// robots.txt 와 이 목록이 갈라지면 "막았다고 생각한 경로가 안 막혀 있는" 상태가 조용히 생긴다.
// scripts/check-seo-surfaces.mjs 가 빌드마다 둘을 대조한다.
//
// /planner/s/ (공유 토큰)는 여기 넣지 않는다 — 화면 자체가 noindex, nofollow 로 나가고,
// robots 로 막으면 크롤러가 그 meta 를 읽지도 못한다.
export const ROBOTS_DISALLOW = [
  '/admin',
  '/mypage',
  '/points',
  '/api/payment/',
  '/crew',
  '/planner/t/',
  '/planner/import',
  '/api/planner/',
];

// 사이트맵에 실린 경로 중 정적 HTML 을 굽지 않을 것.
// ⚠ 사이트맵에 없는 경로를 여기 적어도 **아무 일도 하지 않는다** — prerender-seo.mjs 는
//   public/sitemap.xml 의 <loc> 만 순회한다. 색인 차단은 ROBOTS_DISALLOW 로 한다.
// 2026-09-04 현재 비어 있다. 로그인해야 보이는 게시판을 사이트맵에서 통째로 뺐고,
// /mypage·/admin·/crew 는 애초에 사이트맵에 없어 여기 적어 봐야 아무 일도 하지 않았다.
// 나중에 "사이트맵에는 있지만 정적 HTML 은 굽지 않을 경로"가 생기면 그때 채운다.
export const PRERENDER_EXCLUDED_PATHS = [];

// 끝의 슬래시만 다른 경로를 같은 항목으로 취급한다(/companion/ == /companion).
export function normalizeRoutePath(path) {
  if (!path) return '/';
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  const trimmed = withSlash.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export function getRouteMeta(path) {
  return ROUTE_META[normalizeRoutePath(path)] || null;
}

export function isPrerenderExcluded(path) {
  const normalized = normalizeRoutePath(path);
  return PRERENDER_EXCLUDED_PATHS.some(
    (excluded) => normalized === excluded || normalized.startsWith(`${excluded}/`)
  );
}

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
//   /companion           src/components/CompanionBoard.jsx
//   /companion/:regionId src/components/RegionalBoard.jsx (regions 배열 + 문구 템플릿)
//   /qna                 src/components/TravelQnA.jsx
//   /market              src/components/MarketBoard.jsx
//   /reviews             src/components/Promotions.jsx
//   /recommend           src/components/Destinations.jsx
//   /search              src/pages/Search.jsx
//   /signup              src/pages/Signup.jsx (기본 mode = 'signup')

export const BASE_URL = 'https://www.connecttrip.co.kr';

// RegionalBoard.jsx 의 regions 배열과 같은 값(id·name). 순서까지 동일하게 맞춰 둔다.
export const COMPANION_REGIONS = [
  { id: 'europe', name: '유럽' },
  { id: 'americas', name: '미주' },
  { id: 'africa', name: '아프리카' },
  { id: 'southeast-asia', name: '동남아' },
  { id: 'asia', name: '아시아' },
  { id: 'oceania', name: '오세아니아' },
];

// RegionalBoard 는 지역 6개가 한 컴포넌트를 공유하므로 문구도 같은 템플릿으로 만든다.
// 문자열을 6번 손으로 적으면 나중에 한 곳만 고쳐져 갈라진다.
const regionalRouteMeta = Object.fromEntries(
  COMPANION_REGIONS.map(({ id, name }) => [
    `/companion/${id}`,
    {
      title: `${name} 동행자 모집 - ConnectTrip`,
      description: `${name} 지역을 함께 여행할 동행자를 ConnectTrip에서 찾아보세요.`,
    },
  ])
);

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
  ...regionalRouteMeta,
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
  '/search': {
    title: '검색 결과 - ConnectTrip',
    description: 'ConnectTrip에서 동행, 장터, Q&A, 승무원 게시판을 통합 검색하세요.',
    robots: 'noindex, follow',
  },
  '/signup': {
    title: '회원가입 - ConnectTrip',
    description: 'ConnectTrip 회원가입 — 여행자와 승무원을 잇는 여행 동행 커뮤니티.',
  },
};

// 사이트맵에 있어도 정적 HTML 을 굽지 않는 경로.
// 로그인·권한이 필요하거나 개인화된 화면이라 크롤러에게 보여 줄 고정 문서가 없다.
export const PRERENDER_EXCLUDED_PATHS = ['/mypage', '/admin', '/crew'];

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

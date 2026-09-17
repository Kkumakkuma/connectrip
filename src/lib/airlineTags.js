// CREW 자유게시판 항공사 말머리 단일 출처 (2026-09-17, 쿠마님 9886·9888·9890).
//
// 이 말머리는 **글이 다루는 항공사**다. 글쓴이의 소속이 아니다.
// 쿠마님 9890: "자기가 어디 다니는지 알리고 싶지 않을 수 있다. 그 항공사에 궁금한 게 있으면
// 말머리를 선택해서 쓰겠지." — 그래서 작성자 프로필에서 자동으로 채우지 않는다. 직접 고른다.
// 승무원 회원이 아직 적어서, 소속이 자동으로 붙으면 글만 봐도 누가 썼는지 드러난다.
//
// 구조는 6대륙 말머리(src/lib/continents.js)와 같다 — AirlineBar(목록 필터)·AirlineBadge(배지)·
// AirlinePicker(글쓰기 선택)가 이 표 하나만 읽는다. id 는 DB crew_posts.airline_id(text) 값이다.
// 색은 Tailwind 가 조립한 클래스명을 생성하지 못하므로 전부 정적 문자열로 박는다.
//
// 목록에 없는 외항사는 'foreign' 하나로 받는다. 편명 검증에 쓰는 664개 부호 사전
// (src/lib/airlineCodes.js)과는 목적이 달라 따로 둔다 — 말머리를 664개로 늘리면 고를 수가 없다.

export const AIRLINE_TAGS = [
  { id: 'ke', name: '대한항공', code: 'KE', text: 'text-sky-700', bg: 'bg-sky-50', ring: 'ring-sky-200' },
  { id: 'oz', name: '아시아나', code: 'OZ', text: 'text-red-700', bg: 'bg-red-50', ring: 'ring-red-200' },
  { id: '7c', name: '제주항공', code: '7C', text: 'text-orange-700', bg: 'bg-orange-50', ring: 'ring-orange-200' },
  { id: 'lj', name: '진에어', code: 'LJ', text: 'text-lime-700', bg: 'bg-lime-50', ring: 'ring-lime-200' },
  { id: 'tw', name: '트리니티', code: 'TW', text: 'text-rose-700', bg: 'bg-rose-50', ring: 'ring-rose-200' },
  { id: 'bx', name: '에어부산', code: 'BX', text: 'text-cyan-700', bg: 'bg-cyan-50', ring: 'ring-cyan-200' },
  { id: 'rs', name: '에어서울', code: 'RS', text: 'text-violet-700', bg: 'bg-violet-50', ring: 'ring-violet-200' },
  { id: 'ze', name: '이스타항공', code: 'ZE', text: 'text-blue-700', bg: 'bg-blue-50', ring: 'ring-blue-200' },
  { id: 'yp', name: '에어프레미아', code: 'YP', text: 'text-indigo-700', bg: 'bg-indigo-50', ring: 'ring-indigo-200' },
  { id: 'rf', name: '에어로케이', code: 'RF', text: 'text-fuchsia-700', bg: 'bg-fuchsia-50', ring: 'ring-fuchsia-200' },
  { id: 'foreign', name: '외항사', code: '', text: 'text-teal-700', bg: 'bg-teal-50', ring: 'ring-teal-200' },
  { id: 'common', name: '공통', code: '', text: 'text-slate-700', bg: 'bg-slate-100', ring: 'ring-slate-200' },
];

export const AIRLINE_TAG_IDS = AIRLINE_TAGS.map((a) => a.id);

// 모르는 값(NULL·옛 표기)은 undefined — 배지를 그리지 않고 필터 "전체"에는 포함된다.
export const airlineTagOf = (id) => AIRLINE_TAGS.find((a) => a.id === id);

export const isAirlineTagId = (id) => AIRLINE_TAG_IDS.includes(id);

// URL ?airline= 값을 읽는다. 유효하지 않으면 null(전체).
export const airlineFromSearch = (search) => {
  const id = new URLSearchParams(search || '').get('airline');
  return isAirlineTagId(id) ? id : null;
};

// ?airline= 만 바꾼 검색 문자열(다른 파라미터는 유지). null 이면 파라미터를 뺀다.
export const withAirlineParam = (search, id) => {
  const params = new URLSearchParams(search || '');
  if (isAirlineTagId(id)) params.set('airline', id);
  else params.delete('airline');
  const s = params.toString();
  return s ? `?${s}` : '';
};

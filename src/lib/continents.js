// 6대륙 말머리 단일 출처(2026-09-07). 게시판 목록 필터(ContinentBar)·글 앞 배지(ContinentBadge)·
// 글쓰기 선택(ContinentPicker)이 전부 이 표를 읽는다. id 는 DB region_id(text) 값과 같다.
// 색은 대륙마다 다르게 — Tailwind 는 조립한 클래스명을 생성하지 않으므로 전부 정적 문자열이다.
export const CONTINENTS = [
  { id: 'europe', name: '유럽', icon: '🏰', desc: '파리·런던·로마',
    text: 'text-indigo-700', bg: 'bg-indigo-50', ring: 'ring-indigo-200', dot: 'bg-indigo-500', hex: '#4338CA',
    image: 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?q=80&w=800&auto=format&fit=crop' },
  { id: 'americas', name: '미주', icon: '🗽', desc: '뉴욕·LA·캐나다',
    text: 'text-sky-700', bg: 'bg-sky-50', ring: 'ring-sky-200', dot: 'bg-sky-500', hex: '#0369A1',
    image: 'https://images.unsplash.com/photo-1485738422979-f5c462d49f74?q=80&w=800&auto=format&fit=crop' },
  { id: 'africa', name: '아프리카', icon: '🦁', desc: '이집트·남아공·모로코',
    text: 'text-amber-700', bg: 'bg-amber-50', ring: 'ring-amber-200', dot: 'bg-amber-500', hex: '#B45309',
    image: 'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?q=80&w=800&auto=format&fit=crop' },
  { id: 'southeast-asia', name: '동남아', icon: '🏝️', desc: '다낭·방콕·발리',
    text: 'text-emerald-700', bg: 'bg-emerald-50', ring: 'ring-emerald-200', dot: 'bg-emerald-500', hex: '#047857',
    image: 'https://images.unsplash.com/photo-1528127269322-539801943592?q=80&w=800&auto=format&fit=crop' },
  { id: 'asia', name: '아시아', icon: '🐅', desc: '일본·중국·홍콩',
    text: 'text-rose-700', bg: 'bg-rose-50', ring: 'ring-rose-200', dot: 'bg-rose-500', hex: '#BE123C',
    image: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?q=80&w=800&auto=format&fit=crop' },
  { id: 'oceania', name: '오세아니아', icon: '🦘', desc: '호주·뉴질랜드',
    text: 'text-teal-700', bg: 'bg-teal-50', ring: 'ring-teal-200', dot: 'bg-teal-500', hex: '#0F766E',
    image: 'https://images.unsplash.com/photo-1523482580672-f109ba8cb9be?q=80&w=800&auto=format&fit=crop' },
];

export const CONTINENT_IDS = CONTINENTS.map((c) => c.id);

// 모르는 값(NULL·옛 표기)은 undefined — 배지는 표시하지 않고, 필터 "전체"에는 포함된다.
export const continentOf = (id) => CONTINENTS.find((c) => c.id === id);

export const isContinentId = (id) => CONTINENT_IDS.includes(id);

// URL ?region= 값을 읽는다. 유효하지 않으면 null(전체).
export const regionFromSearch = (search) => {
  const id = new URLSearchParams(search || '').get('region');
  return isContinentId(id) ? id : null;
};

// ?region= 만 바꾼 검색 문자열(다른 파라미터는 유지). null 이면 파라미터를 뺀다.
export const withRegionParam = (search, id) => {
  const params = new URLSearchParams(search || '');
  if (id && isContinentId(id)) params.set('region', id); else params.delete('region');
  const s = params.toString();
  return s ? `?${s}` : '';
};

// PostgREST or() 필터에 넣을 검색어 — 구분자(쉼표·괄호)·따옴표·역슬래시·와일드카드(%_)를 지우고 공백을 하나로, 길이 제한.
export const searchTerm = (q) => String(q || '').replace(/[,()"'\\%_]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

// or() 에 넣을 ilike 묶음. 값은 큰따옴표로 감싼다(공백 포함 검색어가 파싱 오류를 내지 않게).
export const ilikeOr = (fields, term) => fields.map((f) => `${f}.ilike."%${term}%"`).join(',');

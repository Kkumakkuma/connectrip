import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { PROMO_REVIEWS_ENABLED } from '../lib/featureFlags';
import { HOME_CATEGORIES as CATEGORIES, isPublicHomeCategory } from '../lib/homeContent';

// 첫 화면 게시판 카드(2026-09-07 에어비앤비 톤): 4:3 이미지 + 제목 + 한 줄, 흰 카드·hairline·hover 그림자.
// 카드 자체가 앵커라 크롤러가 따라가고 키보드로도 들어간다.
// 카드 목록은 src/lib/homeContent.js 가 단일 출처다 — 프리렌더(scripts/prerender-seo.mjs)가
// 크롤러용 홈 본문을 같은 값으로 굽기 때문에 여기서 따로 정의하지 않는다.

// 보이는 카드 수에 맞춘 열 수 — 마지막 줄에 카드 하나만 덩그러니 남는 3+1 배치를 막는다(2026-09-07 쿠마님).
// 폭 구간은 셋이다. 모바일(~640) 2열 고정, 태블릿·노트북(640~1280) 중간 열, 데스크톱(1280~) 한 줄.
//   4장(일반 방문자): 2×2 → 1024부터 4열 한 줄
//   5장(승무원):      2+2+전폭 → 640부터 3+2 → 1280부터 5열 한 줄 (1024 에서 5열은 카드가 175px 로 좁아 설명이 잘렸다)
//   6장:              2×3 → 640부터 3×2
// 카테고리를 더 늘리면 이 표도 같이 늘릴 것. Tailwind JIT 는 문자열이 그대로 있어야 하므로 표로 둔다.
const GRID_COLS = {
    1: 'sm:grid-cols-1',
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-3',
    4: 'lg:grid-cols-4',
    5: 'sm:grid-cols-3 xl:grid-cols-5',
    6: 'sm:grid-cols-3',
    7: 'sm:grid-cols-3 xl:grid-cols-4',
    8: 'sm:grid-cols-3 xl:grid-cols-4',
};

const CategoryBoard = ({ activeCategory, onCategoryChange }) => {
    const { isLoggedIn, isCrew } = useAuth();
    const list = CATEGORIES.filter((cat) => {
        // CREW 전용만 로그인 상태를 본다. 나머지 공개 여부 판정은 프리렌더(크롤러 본문)와 같은 함수를 쓴다.
        if (cat.id === 'crew') return isLoggedIn && isCrew;
        return isPublicHomeCategory(cat, { promoReviewsEnabled: PROMO_REVIEWS_ENABLED });
    });
    const gridCols = GRID_COLS[list.length] || 'sm:grid-cols-3';
    // 모바일은 2열 고정. 홀수면 마지막 카드가 한 줄을 다 쓰게(가로 2:1) 해서 반쪽 줄을 없앤다.
    // 640 이상에서는 위 표가 열 수를 다시 잡으므로 전폭을 원래대로 되돌린다.
    const oddLast = list.length % 2 === 1;

    return (
        <section className="bg-white py-14 sm:py-20">
            <div className="max-w-content mx-auto px-4 sm:px-6">
                <h2 className="text-[24px] sm:text-[28px] font-extrabold text-ink tracking-[-0.02em] mb-6 sm:mb-8">게시판</h2>
                <div className={`grid grid-cols-2 ${gridCols} gap-4 sm:gap-6`}>
                    {list.map((cat, i) => {
                        const spans = oddLast && i === list.length - 1;
                        return (
                        <Link
                            key={cat.id}
                            to={cat.path}
                            onClick={() => { onCategoryChange?.(cat.id); window.scrollTo(0, 0); }}
                            aria-current={activeCategory === cat.id ? 'page' : undefined}
                            className={`group block card-air overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink${spans ? ' col-span-2 sm:col-span-1' : ''}`}
                        >
                            <div className={`${spans ? 'aspect-[2/1] sm:aspect-[4/3]' : 'aspect-[4/3]'} overflow-hidden bg-surface-strong`}>
                                <img
                                    src={cat.image}
                                    alt={cat.name}
                                    loading="lazy"
                                    decoding="async"
                                    onError={(e) => { if (!e.currentTarget.src.endsWith('/icon-512x512.png')) e.currentTarget.src = '/icon-512x512.png'; }}
                                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                                />
                            </div>
                            <div className="p-3.5 sm:p-4">
                                <h3 className="text-[15px] sm:text-[17px] font-bold text-ink tracking-[-0.01em] leading-snug">{cat.name}</h3>
                                {/* 390px 2열(설명 폭 141px)에선 후기·Q&A 문장이 3줄이라 2줄 클램프에 잘렸다(2026-09-07 실측) — 좁은 폭만 3줄 허용 */}
                                <p className="text-[13px] sm:text-[14px] text-muted mt-1 line-clamp-3 sm:line-clamp-2 leading-relaxed">{cat.desc}</p>
                            </div>
                        </Link>
                        );
                    })}
                </div>
            </div>
        </section>
    );
};

export default CategoryBoard;

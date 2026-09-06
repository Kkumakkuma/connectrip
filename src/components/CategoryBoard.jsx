import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { PROMO_REVIEWS_ENABLED } from '../lib/featureFlags';

// 첫 화면 게시판 카드(2026-09-07 에어비앤비 톤): 4:3 이미지 + 제목 + 한 줄, 흰 카드·hairline·hover 그림자.
// 카드 자체가 앵커라 크롤러가 따라가고 키보드로도 들어간다.
const CATEGORIES = [
    { id: 'companion', name: '여행 동행자 모집', desc: '함께 떠날 마음 맞는 동행자를 찾아보세요.', image: 'https://images.unsplash.com/photo-1527631746610-bca00a040d60?q=80&w=800&auto=format&fit=crop', path: '/companion' },
    { id: 'qna', name: '여행후기 및 Q&A', desc: '생생한 여행 후기를 공유하고, 궁금한 건 바로 질문하세요.', image: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?q=80&w=800&auto=format&fit=crop', path: '/qna' },
    { id: 'market', name: '물품거래 및 나눔', desc: '여행 용품을 나누고 필요한 물건을 저렴하게 구하세요.', image: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?q=80&w=800&auto=format&fit=crop', path: '/market' },
    { id: 'reviews', name: '여행상품 홍보 및 후기', desc: '생생한 여행 후기와 다양한 여행 상품을 만나보세요.', image: 'https://images.unsplash.com/photo-1488190211105-8b0e65b80b4e?q=80&w=800&auto=format&fit=crop', path: '/reviews' },
    { id: 'recommend', name: '승무원 추천지', desc: '현직 승무원이 전하는 진짜 맛집과 숨은 명소입니다.', image: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?q=80&w=800&auto=format&fit=crop', path: '/recommend' },
    // 여행 일정 게시판은 첫 화면 카드에 넣지 않는다(2026-09-04 쿠마님). 상단 메뉴 "여행 플래너 → 여행 일정 게시판"으로만.
    { id: 'crew', name: 'CREW 전용', desc: '승무원끼리 정보를 공유하고 특별 할인 혜택을 확인하세요.', image: 'https://images.unsplash.com/photo-1570710891163-6d3b5c47248b?q=80&w=800&auto=format&fit=crop', path: '/crew' },
];

const CategoryBoard = ({ activeCategory, onCategoryChange }) => {
    const { isLoggedIn, isCrew } = useAuth();
    const list = CATEGORIES.filter((cat) => {
        if (cat.id === 'reviews' && !PROMO_REVIEWS_ENABLED) return false;   // 여행상품 홍보 및 후기 — 초창기 숨김(2026-09-06)
        if (cat.id === 'crew') return isLoggedIn && isCrew;
        return true;
    });

    return (
        <section className="bg-white py-14 sm:py-20">
            <div className="max-w-content mx-auto px-4 sm:px-6">
                <h2 className="text-[24px] sm:text-[28px] font-extrabold text-ink tracking-[-0.02em] mb-6 sm:mb-8">게시판</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
                    {list.map((cat) => (
                        <Link
                            key={cat.id}
                            to={cat.path}
                            onClick={() => { onCategoryChange?.(cat.id); window.scrollTo(0, 0); }}
                            aria-current={activeCategory === cat.id ? 'page' : undefined}
                            className="group block card-air overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                        >
                            <div className="aspect-[4/3] overflow-hidden bg-surface-strong">
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
                                <p className="text-[13px] sm:text-[14px] text-muted mt-1 line-clamp-2 leading-relaxed">{cat.desc}</p>
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default CategoryBoard;

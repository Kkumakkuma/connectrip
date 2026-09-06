import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/AuthContext';
import { PROMO_REVIEWS_ENABLED } from '../lib/featureFlags';

// 카드 자체를 앵커(<a href>)로 만든다 — 크롤러가 따라갈 내부 링크가 생기고
// 별도 tabIndex 없이도 키보드 포커스·Enter 이동이 된다.
const MotionLink = motion.create(Link);

const CategoryBoard = ({ activeCategory, onCategoryChange }) => {
    const { isLoggedIn, isCrew } = useAuth();
    const categories = [
        {
            id: 'companion',
            name: '여행 동행자 모집',
            desc: '함께 떠날 마음 맞는 동행자를 찾아보세요.',
            crewComment: '항공사 이메일로 인증한 현직 승무원들이 활동하는 커뮤니티입니다.',
            image: 'https://images.unsplash.com/photo-1527631746610-bca00a040d60?q=80&w=800&auto=format&fit=crop',
            path: '/companion'
        },
        {
            id: 'qna',
            name: '여행후기 및 Q&A',
            desc: '생생한 여행 후기를 공유하고, 궁금한 건 바로 질문하세요.',
            crewComment: '현지 사정에 밝은 승무원들의 답변을 들을 수 있어요.',
            image: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?q=80&w=800&auto=format&fit=crop',
            path: '/qna'
        },
        {
            id: 'market',
            name: '물품거래 및 나눔',
            desc: '여행 용품을 나누고 필요한 물건을 저렴하게 구하세요.',
            crewComment: '상태 좋은 여행 캐리어와 필수 템들이 많이 올라와요.',
            image: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?q=80&w=800&auto=format&fit=crop',
            path: '/market'
        },
        {
            id: 'reviews',
            name: '여행상품 홍보 및 후기',
            desc: '생생한 여행 후기와 다양한 여행 상품을 만나보세요.',
            crewComment: '직접 다녀온 사람들의 찐 후기로 알찬 여행을 계획하세요.',
            image: 'https://images.unsplash.com/photo-1488190211105-8b0e65b80b4e?q=80&w=800&auto=format&fit=crop',
            path: '/reviews'
        },
        {
            id: 'recommend',
            name: '승무원 추천지',
            desc: '현직 승무원이 전하는 진짜 맛집과 숨은 명소입니다.',
            crewComment: '가이드북에는 없는 로컬들만의 아지트를 공개합니다.',
            image: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?q=80&w=800&auto=format&fit=crop',
            path: '/recommend'
        },
        // 여행 일정 게시판은 첫 화면 카드에 넣지 않는다(2026-09-04 쿠마님).
        // 커넥트립 첫 줄에 두면 글 0건짜리 게시판이 그대로 노출된다.
        // 들어가는 길은 상단 메뉴 "여행 플래너 → 여행 일정 게시판" 하나로 통일했다.
        {
            id: 'crew',
            name: 'CREW 전용',
            desc: '승무원끼리 정보를 공유하고 특별 할인 혜택을 확인하세요.',
            crewComment: '익명으로 편하게 레이오버 정보와 고민을 나눠보세요.',
            image: 'https://images.unsplash.com/photo-1570710891163-6d3b5c47248b?q=80&w=800&auto=format&fit=crop',
            path: '/crew'
        },
    ];

    const filteredCategories = categories.filter(cat => {
        if (cat.id === 'reviews' && !PROMO_REVIEWS_ENABLED) return false;   // 여행상품 홍보 및 후기 — 초창기 숨김(2026-09-06)
        if (cat.id === 'crew') {
            return isLoggedIn && isCrew;
        }
        return true;
    });

    // 이동은 Link 가 맡는다. 여기서는 상위 상태 갱신과 스크롤 복귀만 남긴다.
    const handleClick = (cat) => {
        if (onCategoryChange) {
            onCategoryChange(cat.id);
        }
        // Scroll to top when navigating to a new page
        window.scrollTo(0, 0);
    };

    return (
        <section className="section-padding" style={{ background: 'white' }}>
            <div className="container">
                <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
                    <span style={{ color: 'var(--primary-color)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '2px' }}>
                        Board Categories
                    </span>
                    <h2 style={{ fontSize: '2.5rem', marginTop: '0.5rem' }}>메뉴별 게시판 바로가기</h2>
                </div>

                <div
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        justifyContent: 'center',
                        gap: '2rem'
                    }}
                >
                    {filteredCategories.map((cat) => (
                        <MotionLink
                            key={cat.id}
                            to={cat.path}
                            whileHover={{ y: -10 }}
                            onClick={() => handleClick(cat)}
                            style={{
                                flex: '1 1 300px',
                                maxWidth: '380px',
                                cursor: 'pointer',
                                borderRadius: '1.5rem',
                                overflow: 'hidden',
                                background: 'white',
                                boxShadow: activeCategory === cat.id ? '0 10px 30px rgba(59, 130, 246, 0.2)' : '0 4px 20px rgba(0,0,0,0.08)',
                                border: '2px solid var(--primary-color)',
                                transition: 'all 0.3s ease',
                                display: 'flex',
                                flexDirection: 'column',
                                position: 'relative',
                                textDecoration: 'none',
                                color: 'inherit'
                            }}
                        >
                            <div style={{ height: '200px', overflow: 'hidden' }}>
                                <img
                                    src={cat.image}
                                    alt={cat.name}
                                    loading="lazy"
                                    decoding="async"
                                    onError={(e) => { if (!e.currentTarget.src.endsWith('/icon-512x512.png')) e.currentTarget.src = '/icon-512x512.png'; }}
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                            </div>

                            <div style={{ padding: '1.5rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                                <h3 style={{ fontSize: '1.3rem', fontWeight: '800', marginBottom: '0.5rem' }}>{cat.name}</h3>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '1.5rem', lineHeight: '1.6' }}>
                                    {cat.desc}
                                </p>

                                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '1rem', marginTop: 'auto' }}>
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '1.1rem' }}>✈️</span>
                                        <p style={{ fontSize: '0.85rem', fontStyle: 'italic', color: 'var(--text-primary)', fontWeight: '600' }}>
                                            "{cat.crewComment}"
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </MotionLink>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default CategoryBoard;

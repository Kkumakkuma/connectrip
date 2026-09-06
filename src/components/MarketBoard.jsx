import { useState, useEffect, useId } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag, Heart, ArrowLeft, Gift, MapPin, Plus, X, Search, Users } from 'lucide-react';
import MarketFeed from './MarketFeed';
import MarketListingForm from './MarketListingForm';
import Pagination from './Pagination';
import ReportButton from './ReportButton';
import ShareButtons from './ShareButtons';
import CrewBadge from './CrewBadge';
import { useAuth } from '../lib/AuthContext';
import { marketApi } from '../lib/db';
import ImageUpload from './ImageUpload';
import LoginPrompt from './LoginPrompt';
import SEOHead from './SEOHead';
import ListState from './ListState';

const regions = [
    {
        id: 'europe',
        name: '유럽',
        icon: '🏰',
        desc: '귀국 전 급처! 유럽 지역 나눔',
        image: 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?q=80&w=800&auto=format&fit=crop'
    },
    {
        id: 'americas',
        name: '미주',
        icon: '🗽',
        desc: '미주 비행 필수템 무료 나눔',
        image: 'https://images.unsplash.com/photo-1485738422979-f5c462d49f74?q=80&w=800&auto=format&fit=crop'
    },
    {
        id: 'africa',
        name: '아프리카',
        icon: '🦁',
        desc: '아프리카 비행 꿀템 나눔해요',
        image: 'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?q=80&w=800&auto=format&fit=crop'
    },
    {
        id: 'southeast-asia',
        name: '동남아',
        icon: '🏝️',
        desc: '동남아 현지 유심/쿠폰 나눔',
        image: 'https://images.unsplash.com/photo-1528127269322-539801943592?q=80&w=800&auto=format&fit=crop'
    },
    {
        id: 'asia',
        name: '아시아',
        icon: '🐅',
        desc: '가까운 아시아 지역 나눔 게시판',
        image: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?q=80&w=800&auto=format&fit=crop'
    },
    {
        id: 'oceania',
        name: '오세아니아',
        icon: '🦘',
        desc: '호주/뉴질랜드 나눔 & 교환',
        image: 'https://images.unsplash.com/photo-1523482580672-f109ba8cb9be?q=80&w=800&auto=format&fit=crop'
    },
];

// 클릭으로만 열리던 카드에 키보드 조작(Enter/Space)을 붙인다.
// 이 카드들은 라우트 이동이 아니라 화면 안 모드 전환이라 Link 대신 button 역할로 처리한다.
const keyActivate = (fn) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fn();
    }
};

const MarketBoard = () => {
    const { user, profile, isLoggedIn } = useAuth();
    const location = useLocation();
    // mode: 'main' | 'sell' | 'share' | 'buy' | 'groupbuy'
    const [mode, setMode] = useState('main');
    // shareRegion: null | region object
    const [shareRegion, setShareRegion] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({ title: '', country: '', price: '', location: '', content: '', transactionType: 'direct', image_url: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPageBuy, setCurrentPageBuy] = useState(1);
    const [sellingItems, setSellingItems] = useState([]);
    const [sharingItems, setSharingItems] = useState([]);
    const [buyingRequests, setBuyingRequests] = useState([]);
    const [groupbuyItems, setGroupbuyItems] = useState([]);
    const [stats, setStats] = useState({}); // { [id]: { favorites, chats } } — 판매·나눔 목록용
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false); // 등록 버튼 중복 제출 방지
    const itemsPerPage = 8;
    const formId = useId(); // label-input 연결용 접두사 (모달을 다시 열어도 id 충돌 없음)

    // Fetch listings when mode changes
    const fetchListings = async () => {
        if (mode === 'main') { setLoading(false); setError(null); return; }
        try {
            setLoading(true);
            setError(null);
            const typeMap = { sell: 'sell', buy: 'buy', share: 'share', groupbuy: 'groupbuy' };
            // 차단 필터는 여기서 걸지 않는다 — blockedIds 는 마운트 후 비동기로 도착하므로
            // fetch 시점에 한 번 거르면 늦게 온 차단 목록이 반영되지 않는다. 렌더 시점에 건다.
            const data = await marketApi.getAll(typeMap[mode]) || [];
            if (mode === 'sell' || mode === 'share') {
                marketApi.stats(data.map((d) => d.id)).then(setStats).catch(() => setStats({}));
            }
            if (mode === 'sell') setSellingItems(data);
            else if (mode === 'buy') setBuyingRequests(data);
            else if (mode === 'share') setSharingItems(data);
            else if (mode === 'groupbuy') setGroupbuyItems(data);
        } catch (err) {
            console.error('장터 데이터 로딩 실패:', err);
            if (mode === 'sell') setSellingItems([]);
            else if (mode === 'buy') setBuyingRequests([]);
            else if (mode === 'share') setSharingItems([]);
            else if (mode === 'groupbuy') setGroupbuyItems([]);
            setError('목록을 불러오지 못했습니다. 다시 시도해주세요.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchListings();
    }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!isLoggedIn) {
            setShowLoginPrompt(true);
            return;
        }
        // 로그인 검사 같은 조기 return 을 모두 지난 뒤에 플래그를 세운다.
        // 먼저 세우면 조기 return 경로가 finally 를 못 만나 버튼이 영구히 잠긴다.
        if (submitting) return;
        setSubmitting(true);
        try {
            const listing = {
                title: formData.title,
                content: formData.content,
                type: mode === 'share' ? 'share' : mode === 'buy' ? 'buy' : mode === 'groupbuy' ? 'groupbuy' : 'sell',
                author: profile?.name || '익명',
                user_id: user.id,
            };
            if (mode === 'share') {
                listing.country = formData.country;
                listing.region_id = shareRegion?.id || null;
            }
            if (formData.image_url) {
                listing.image_url = formData.image_url;
            }
            const parseOptionalInt = (value) => {
                const digits = String(value || '').replace(/[^0-9]/g, '');
                return digits ? Number(digits) : null;
            };
            if (mode === 'sell') {
                listing.price = parseOptionalInt(formData.price);
                listing.location = formData.location;
                listing.transaction_type = formData.transactionType;
            }
            if (mode === 'buy') {
                listing.budget = parseOptionalInt(formData.price);
                listing.location = formData.location;
            }
            if (mode === 'groupbuy') {
                listing.price = parseOptionalInt(formData.price);
                listing.location = formData.location;
            }
            const newItem = await marketApi.create(listing);
            if (mode === 'sell') setSellingItems(prev => [newItem, ...prev]);
            else if (mode === 'groupbuy') setGroupbuyItems(prev => [newItem, ...prev]);
            else if (mode === 'buy') setBuyingRequests(prev => [newItem, ...prev]);
            else if (mode === 'share') setSharingItems(prev => [newItem, ...prev]);
            setFormData({ title: '', country: '', price: '', location: '', content: '', transactionType: 'direct', image_url: '' });
            setShowModal(false);
        } catch (err) {
            console.error('게시글 등록 실패:', err);
            alert('게시글 등록에 실패했습니다. 다시 시도해주세요.');
        } finally {
            setSubmitting(false);
        }
    };

    const resetView = () => {
        setMode('main');
        setShareRegion(null);
    };

    // Reset to main view whenever the location changes,
    // then apply the nav dropdown ?tab= (sell/buy/share/groupbuy) if present
    useEffect(() => {
        resetView();
        const params = new URLSearchParams(location.search);
        const tab = params.get('tab');
        if (tab && ['sell', 'buy', 'share', 'groupbuy'].includes(tab)) setMode(tab);
        const q = params.get('q');
        if (q) setSearchQuery(q);
    }, [location]);

    // Scroll to top when shareRegion changes
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [shareRegion]);

    // 차단은 쪽지·대화만 막는다(2026-09-06) — 게시글은 숨기지 않는다.
    const visibleBuy = buyingRequests;
    const groupbuyQuery = searchQuery.toLowerCase();
    const visibleGroupbuy = groupbuyItems.filter(i =>
        !groupbuyQuery
        || (i.title || '').toLowerCase().includes(groupbuyQuery)
        || (i.content || '').toLowerCase().includes(groupbuyQuery)
    );

    return (
        <section id="market" className="py-20 bg-gray-50 min-h-[80vh]">
            <SEOHead title="물품거래 및 나눔 - ConnectTrip" description="여행 물품 거래, 나눔, 중고 거래를 ConnectTrip에서 만나보세요." />
            <div className="container mx-auto px-4">
                <AnimatePresence mode="wait">
                    {mode === 'main' && (
                        <motion.div
                            key="main-selection"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            className="max-w-4xl mx-auto"
                        >
                            <div className="text-center mb-8">
                                <span className="text-blue-600 font-bold tracking-widest uppercase mb-2 block animate-fade-in">Marketplace</span>
                                {/* 페이지 최상위 제목이라 h1 — 하위 모드 제목은 h2 로 유지한다 */}
                                <h1 className="text-4xl font-black mb-4">물품거래 및 나눔 게시판</h1>
                                <p className="text-gray-500">필요한 물건을 찾거나, 동료들을 위해 따뜻한 나눔을 실천해보세요.</p>
                            </div>


                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                                {/* 물품팔아요 */}
                                <motion.div
                                    whileHover={{ y: -10 }}
                                    onClick={() => setMode('sell')}
                                    onKeyDown={keyActivate(() => setMode('sell'))}
                                    role="button"
                                    tabIndex={0}
                                    className="bg-white rounded-2xl p-6 shadow-xl cursor-pointer hover:shadow-2xl transition-all border-2 border-blue-400 hover:border-blue-500 group"
                                >
                                    <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center mb-4 text-blue-600 group-hover:scale-110 transition-transform">
                                        <ShoppingBag size={28} />
                                    </div>
                                    <h3 className="text-xl font-bold mb-2">물품팔아요</h3>
                                    <p className="text-gray-500 text-sm mb-3">
                                        여행 용품, 승무원 필수템 등 판매할 물건을 등록하세요.
                                        합리적인 가격으로 거래해보세요!
                                    </p>
                                    <span className="text-blue-600 font-bold flex items-center gap-2">
                                        판매 물품 보기 →
                                    </span>
                                </motion.div>

                                {/* 물품구해요 */}
                                <motion.div
                                    whileHover={{ y: -10 }}
                                    onClick={() => setMode('buy')}
                                    onKeyDown={keyActivate(() => setMode('buy'))}
                                    role="button"
                                    tabIndex={0}
                                    className="bg-white rounded-2xl p-6 shadow-xl cursor-pointer hover:shadow-2xl transition-all border-2 border-green-400 hover:border-green-500 group"
                                >
                                    <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center mb-4 text-green-600 group-hover:scale-110 transition-transform">
                                        <Search size={28} />
                                    </div>
                                    <h3 className="text-xl font-bold mb-2">물품구해요</h3>
                                    <p className="text-gray-500 text-sm mb-3">
                                        필요한 여행 용품이나 물건을 찾고 계신가요?
                                        구매 요청을 올려보세요!
                                    </p>
                                    <span className="text-green-600 font-bold flex items-center gap-2">
                                        구매 요청 보기 →
                                    </span>
                                </motion.div>

                                {/* 무료 나눔 */}
                                <motion.div
                                    whileHover={{ y: -10 }}
                                    onClick={() => setMode('share')}
                                    onKeyDown={keyActivate(() => setMode('share'))}
                                    role="button"
                                    tabIndex={0}
                                    className="bg-white rounded-2xl p-6 shadow-xl cursor-pointer hover:shadow-2xl transition-all border-2 border-pink-400 hover:border-pink-500 group"
                                >
                                    <div className="w-14 h-14 bg-pink-100 rounded-2xl flex items-center justify-center mb-4 text-pink-500 group-hover:scale-110 transition-transform">
                                        <Heart size={28} />
                                    </div>
                                    <h3 className="text-xl font-bold mb-2">무료 나눔</h3>
                                    <p className="text-gray-500 text-sm mb-3">
                                        남은 유심, 교통카드 잔액, 할인 쿠폰 등 작지만 소중한 물건을 나눠보세요.
                                        따뜻한 마음이 모여 더 즐거운 비행이 됩니다.
                                    </p>
                                    <span className="text-pink-500 font-bold flex items-center gap-2">
                                        나눔 참여하기 →
                                    </span>
                                </motion.div>

                                {/* 공동구매 */}
                                <motion.div
                                    whileHover={{ y: -10 }}
                                    onClick={() => setMode('groupbuy')}
                                    onKeyDown={keyActivate(() => setMode('groupbuy'))}
                                    role="button"
                                    tabIndex={0}
                                    className="bg-white rounded-2xl p-6 shadow-xl cursor-pointer hover:shadow-2xl transition-all border-2 border-purple-400 hover:border-purple-500 group"
                                >
                                    <div className="w-14 h-14 bg-purple-100 rounded-2xl flex items-center justify-center mb-4 text-purple-600 group-hover:scale-110 transition-transform">
                                        <Users size={28} />
                                    </div>
                                    <h3 className="text-xl font-bold mb-2">공동구매</h3>
                                    <p className="text-gray-500 text-sm mb-3">
                                        면세품, 현지 특산물 등 함께 사면 더 저렴해질 수 있어요!
                                        공동구매를 모집하거나 참여해보세요.
                                    </p>
                                    <span className="text-purple-600 font-bold flex items-center gap-2">
                                        공동구매 보기 →
                                    </span>
                                </motion.div>
                            </div>
                        </motion.div>
                    )}

                    {mode === 'sell' && (
                        <motion.div key="sell-market" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                            <div className="max-w-3xl mx-auto">
                                <button onClick={resetView} className="flex items-center gap-2 text-gray-600 hover:text-blue-600 font-semibold mb-4 transition-colors">
                                    <ArrowLeft size={20} /> 메인으로 돌아가기
                                </button>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-2.5 bg-blue-100 rounded-xl text-blue-600 flex-shrink-0"><ShoppingBag size={24} /></div>
                                    <h2 className="text-2xl font-bold text-gray-900">물품팔아요</h2>
                                </div>
                                <MarketFeed
                                    type="sell"
                                    items={sellingItems}
                                    stats={stats}
                                    loading={loading}
                                    error={error}
                                    onRetry={fetchListings}
                                    isLoggedIn={isLoggedIn}
                                    onWrite={() => { if (!isLoggedIn) { setShowLoginPrompt(true); return; } setShowModal(true); }}
                                />
                            </div>
                        </motion.div>
                    )}

                    {mode === 'buy' && (
                        <motion.div
                            key="buy-market"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                        >
                            <div className="max-w-6xl mx-auto">
                                <button
                                    onClick={resetView}
                                    className="flex items-center gap-2 text-gray-600 hover:text-green-600 font-semibold mb-8 transition-colors"
                                >
                                    <ArrowLeft size={20} /> 메인으로 돌아가기
                                </button>

                                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 bg-green-100 rounded-xl text-green-600 flex-shrink-0">
                                            <Search size={32} />
                                        </div>
                                        <div>
                                            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">물품구해요</h2>
                                            <p className="text-gray-500 text-sm sm:text-base">필요한 물건을 요청하고 거래하세요.</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (!isLoggedIn) { setShowLoginPrompt(true); return; }
                                            setShowModal(true);
                                        }}
                                        className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors w-full sm:w-auto justify-center flex-shrink-0"
                                    >
                                        <Plus size={20} /> 구매 요청
                                    </button>
                                </div>

                                {loading || error ? (
                                    <ListState loading={loading} error={error} onRetry={fetchListings} color="green" />
                                ) : visibleBuy.length > 0 ? (
                                    <>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                            {visibleBuy
                                                .slice((currentPageBuy - 1) * itemsPerPage, currentPageBuy * itemsPerPage)
                                                .map((item) => (
                                                    <div key={item.id} className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all border border-gray-100 cursor-pointer group">
                                                        <div className="relative aspect-square overflow-hidden bg-gray-100">
                                                            {item.image_url && <img src={item.image_url} alt={item.title} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />}
                                                            <div className="absolute top-3 right-3">
                                                                <ReportButton postId={item.id} boardType="market" reportedUserId={item.user_id} />
                                                            </div>
                                                            <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-lg flex items-center gap-1">
                                                                <MapPin size={10} /> {item.location}
                                                            </div>
                                                            <div className="absolute top-3 left-3 bg-green-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                                                                구해요
                                                            </div>
                                                        </div>
                                                        <div className="p-5">
                                                            <h3 className="font-bold text-gray-900 mb-1 line-clamp-1 group-hover:text-green-600 transition-colors">{item.title}</h3>
                                                            <p className="text-lg font-black text-green-600">{item.budget != null ? Number(item.budget).toLocaleString() + '원' : '예산 미정'}</p>
                                                            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
                                                                <span className="flex items-center gap-1 min-w-0 text-xs text-gray-400">
                                                                    <span className="truncate">{item.author}</span>
                                                                    <CrewBadge profile={item.profiles} />
                                                                </span>
                                                                <ShareButtons title={item.title} description={item.content} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                        </div>

                                        {/* 페이지네이션 */}
                                        <Pagination
                                            currentPage={currentPageBuy}
                                            totalPages={Math.ceil(visibleBuy.length / itemsPerPage)}
                                            onPageChange={setCurrentPageBuy}
                                            color="green"
                                        />

                                        {/* 검색 바 */}
                                        <div className="mt-8">
                                            <div className="relative max-w-2xl mx-auto">
                                                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                                                <input
                                                    type="text"
                                                    value={searchQuery}
                                                    onChange={(e) => setSearchQuery(e.target.value)}
                                                    placeholder="물품명, 위치 등으로 검색하세요..."
                                                    className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-gray-200 focus:border-green-500 focus:ring-2 focus:ring-green-200 outline-none transition-all text-gray-700 font-medium"
                                                />
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="py-20 text-center bg-white rounded-3xl border border-dashed border-gray-200">
                                        <Search size={48} className="mx-auto text-gray-300 mb-4" />
                                        <p className="text-gray-500 text-lg">등록된 구매 요청이 없습니다.</p>
                                        {isLoggedIn && (
                                            <button onClick={() => setShowModal(true)} className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors">
                                                <Plus size={18} /> 구매 요청 등록
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}

                    {mode === 'groupbuy' && (
                        <motion.div key="groupbuy-market" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                            <div className="max-w-6xl mx-auto">
                                <button onClick={resetView} className="flex items-center gap-2 text-gray-600 hover:text-purple-600 font-semibold mb-8 transition-colors">
                                    <ArrowLeft size={20} /> 메인으로 돌아가기
                                </button>
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 bg-purple-100 rounded-xl text-purple-600 flex-shrink-0"><Users size={32} /></div>
                                        <div>
                                            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">공동구매</h2>
                                            <p className="text-gray-500 text-sm sm:text-base">함께 사면 더 저렴해질 수 있어요! 공동구매를 모집하거나 참여하세요.</p>
                                        </div>
                                    </div>
                                    {profile?.role === 'admin' && (
                                        <button
                                            onClick={() => {
                                                if (!isLoggedIn) { setShowLoginPrompt(true); return; }
                                                setShowModal(true);
                                            }}
                                            className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold transition-colors shadow-md flex-shrink-0">
                                            <Plus size={20} /> 공동구매 모집하기
                                        </button>
                                    )}
                                </div>
                                <div className="mb-6">
                                    <div className="relative max-w-2xl">
                                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                                        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="제목, 내용으로 검색..."
                                            className="w-full pl-12 pr-4 py-3 rounded-xl border-2 border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none" />
                                    </div>
                                </div>
                                {loading || error ? (
                                    <ListState loading={loading} error={error} onRetry={fetchListings} color="purple" loadingText="로딩 중..." />
                                ) : visibleGroupbuy.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {visibleGroupbuy.map(item => (
                                            <div key={item.id} className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all border border-gray-100">
                                                {item.image_url && <div className="h-48 overflow-hidden"><img src={item.image_url} alt={item.title} loading="lazy" decoding="async" className="w-full h-full object-cover" /></div>}
                                                <div className="p-5">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-bold rounded-full">공동구매</span>
                                                        {item.price != null && <span className="font-bold text-purple-600">1인 {Number(item.price).toLocaleString()}원</span>}
                                                    </div>
                                                    <h3 className="font-bold text-lg mb-2 line-clamp-1">{item.title}</h3>
                                                    <p className="text-gray-600 text-sm mb-3 line-clamp-2">{item.content}</p>
                                                    {item.location && <p className="text-xs text-purple-500 font-semibold mb-3">모집 인원: {item.location}</p>}
                                                    <div className="flex items-center justify-between text-xs text-gray-400 gap-2">
                                                        <span className="flex items-center gap-1 min-w-0">
                                                            <span className="truncate min-w-0">{item.author}</span>
                                                            <CrewBadge profile={item.profiles} />
                                                        </span>
                                                        <span className="whitespace-nowrap flex-shrink-0">{new Date(item.created_at).toLocaleDateString('ko-KR')}</span>
                                                    </div>
                                                    <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end">
                                                        <ShareButtons title={item.title} description={item.content} />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-gray-200">
                                        <Users size={48} className="mx-auto text-gray-300 mb-4" />
                                        <p className="text-gray-500 text-lg">아직 등록된 공동구매가 없습니다.</p>
                                        <p className="text-gray-400 mt-1">첫 번째 공동구매를 모집해보세요!</p>
                                        {isLoggedIn && (
                                            <button onClick={() => setShowModal(true)} className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 transition-colors">
                                                <Plus size={18} /> 공동구매 모집하기
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}

                    {mode === 'share' && (
                        <motion.div key="share-market" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                            <div className="max-w-3xl mx-auto">
                                <button onClick={resetView} className="flex items-center gap-2 text-gray-600 hover:text-pink-500 font-semibold mb-4 transition-colors">
                                    <ArrowLeft size={20} /> 메인으로 돌아가기
                                </button>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-2.5 bg-pink-100 rounded-xl text-pink-500 flex-shrink-0"><Heart size={24} /></div>
                                    <h2 className="text-2xl font-bold text-gray-900">무료 나눔</h2>
                                </div>
                                <MarketFeed
                                    type="share"
                                    items={sharingItems}
                                    stats={stats}
                                    loading={loading}
                                    error={error}
                                    onRetry={fetchListings}
                                    isLoggedIn={isLoggedIn}
                                    regions={regions}
                                    region={shareRegion?.id || null}
                                    onRegion={(id) => setShareRegion(id ? regions.find((r) => r.id === id) : null)}
                                    onWrite={() => { if (!isLoggedIn) { setShowLoginPrompt(true); return; } setShowModal(true); }}
                                />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* 글 작성 모달 */}
            <AnimatePresence>
                {showModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                        onClick={() => setShowModal(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-white sm:rounded-3xl p-6 sm:p-8 max-w-2xl w-full h-full sm:h-auto max-h-screen sm:max-h-[90vh] overflow-y-auto shadow-2xl"
                        >
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-xl sm:text-2xl font-bold">
                                    {mode === 'sell' ? '물품 등록' : mode === 'buy' ? '구매 요청 등록' : mode === 'groupbuy' ? '공동구매 모집' : '나눔 물품 등록'}
                                </h3>
                                <button
                                    onClick={() => setShowModal(false)}
                                    className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                                    aria-label="닫기"
                                >
                                    <X size={24} aria-hidden="true" />
                                </button>
                            </div>

                            {(mode === 'sell' || mode === 'share') ? (
                                <MarketListingForm
                                    mode={mode}
                                    regions={regions}
                                    defaultRegion={shareRegion?.id || null}
                                    onDone={(item) => {
                                        if (mode === 'sell') setSellingItems((prev) => [item, ...prev]);
                                        else setSharingItems((prev) => [item, ...prev]);
                                        setShowModal(false);
                                    }}
                                    onCancel={() => setShowModal(false)}
                                />
                            ) : (
                            <form onSubmit={handleSubmit} className="space-y-6">
                                <div>
                                    <label htmlFor={`${formId}-title`} className="block text-sm font-bold text-gray-700 mb-2">제목</label>
                                    <input
                                        id={`${formId}-title`}
                                        type="text"
                                        value={formData.title}
                                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                        placeholder="물품명을 입력하세요"
                                        required
                                    />
                                </div>

                                {mode === 'share' && (
                                    <div>
                                        <label htmlFor={`${formId}-country`} className="block text-sm font-bold text-gray-700 mb-2">국가/도시</label>
                                        <input
                                            id={`${formId}-country`}
                                            type="text"
                                            value={formData.country}
                                            onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                            placeholder="예: 다낭, 방콕, 파리 등"
                                            required
                                        />
                                    </div>
                                )}

                                {mode === 'sell' && (
                                    <>
                                        {/* 라디오 묶음은 개별 label 이 input 을 감싸고 있어, 그룹 이름은 group 으로 연결한다 */}
                                        <div role="group" aria-labelledby={`${formId}-transaction-type`}>
                                            <span id={`${formId}-transaction-type`} className="block text-sm font-bold text-gray-700 mb-3">거래 유형</span>
                                            <div className="flex gap-4">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="transactionType"
                                                        value="direct"
                                                        checked={formData.transactionType === 'direct'}
                                                        onChange={(e) => setFormData({ ...formData, transactionType: e.target.value })}
                                                        className="w-4 h-4 text-blue-600 focus:ring-2 focus:ring-blue-200"
                                                    />
                                                    <span className="font-medium text-gray-700">직거래</span>
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="transactionType"
                                                        value="delivery"
                                                        checked={formData.transactionType === 'delivery'}
                                                        onChange={(e) => setFormData({ ...formData, transactionType: e.target.value })}
                                                        className="w-4 h-4 text-blue-600 focus:ring-2 focus:ring-blue-200"
                                                    />
                                                    <span className="font-medium text-gray-700">택배거래</span>
                                                </label>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label htmlFor={`${formId}-sell-price`} className="block text-sm font-bold text-gray-700 mb-2">가격</label>
                                                <input
                                                    id={`${formId}-sell-price`}
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={formData.price}
                                                    onChange={(e) => setFormData({ ...formData, price: e.target.value.replace(/[^0-9]/g, '') })}
                                                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                                    placeholder="예: 50000"
                                                    required
                                                />
                                            </div>
                                            <div>
                                                <label htmlFor={`${formId}-sell-location`} className="block text-sm font-bold text-gray-700 mb-2">{formData.transactionType === 'direct' ? '거래 장소' : '배송비'}</label>
                                                <input
                                                    id={`${formId}-sell-location`}
                                                    type="text"
                                                    value={formData.location}
                                                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                                    placeholder={formData.transactionType === 'direct' ? '예: 인천공항' : '예: 착불 또는 3,000원'}
                                                    required
                                                />
                                            </div>
                                        </div>
                                    </>
                                )}

                                {mode === 'buy' && (
                                    <>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label htmlFor={`${formId}-buy-budget`} className="block text-sm font-bold text-gray-700 mb-2">희망 예산</label>
                                                <input
                                                    id={`${formId}-buy-budget`}
                                                    type="text"
                                                    value={formData.price}
                                                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-green-500 focus:ring-2 focus:ring-green-200 outline-none transition-all"
                                                    placeholder="예: ~30,000원 또는 가격 협의"
                                                    required
                                                />
                                            </div>
                                            <div>
                                                <label htmlFor={`${formId}-buy-location`} className="block text-sm font-bold text-gray-700 mb-2">희망 거래 장소</label>
                                                <input
                                                    id={`${formId}-buy-location`}
                                                    type="text"
                                                    value={formData.location}
                                                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-green-500 focus:ring-2 focus:ring-green-200 outline-none transition-all"
                                                    placeholder="예: 서울 전지역 또는 택배 가능"
                                                    required
                                                />
                                            </div>
                                        </div>
                                    </>
                                )}

                                {mode === 'groupbuy' && (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label htmlFor={`${formId}-groupbuy-price`} className="block text-sm font-bold text-gray-700 mb-2">목표 가격 (1인당)</label>
                                            <input id={`${formId}-groupbuy-price`} type="text" value={formData.price} onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none" placeholder="예: 15,000원" />
                                        </div>
                                        <div>
                                            <label htmlFor={`${formId}-groupbuy-members`} className="block text-sm font-bold text-gray-700 mb-2">모집 인원</label>
                                            <input id={`${formId}-groupbuy-members`} type="text" value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none" placeholder="예: 5명" />
                                        </div>
                                    </div>
                                )}

                                {(mode === 'sell' || mode === 'share' || mode === 'groupbuy') && (
                                    <ImageUpload
                                        bucket="images"
                                        onUpload={(url) => setFormData({ ...formData, image_url: url })}
                                    />
                                )}

                                <div>
                                    <label htmlFor={`${formId}-content`} className="block text-sm font-bold text-gray-700 mb-2">상세 설명</label>
                                    <textarea
                                        id={`${formId}-content`}
                                        value={formData.content}
                                        onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all resize-none"
                                        rows="6"
                                        placeholder="물품 상태, 구매 시기 등을 자세히 작성해주세요"
                                        required
                                    />
                                </div>

                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        onClick={() => setShowModal(false)}
                                        className="flex-1 px-6 py-3 rounded-xl border border-gray-200 font-bold text-gray-700 hover:bg-gray-50 transition-colors"
                                    >
                                        취소
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={submitting}
                                        className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {submitting ? '등록 중...' : '등록하기'}
                                    </button>
                                </div>
                            </form>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
            <LoginPrompt isOpen={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
        </section>
    );
};

export default MarketBoard;

import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag, Heart, ArrowLeft, Gift, MapPin, Plus, X, Search, Users } from 'lucide-react';
import Pagination from './Pagination';
import ReportButton from './ReportButton';
import ShareButtons from './ShareButtons';
import { useAuth } from '../lib/AuthContext';
import { marketApi, marketTransactionApi } from '../lib/db';
import { Coins } from 'lucide-react';
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

const MarketBoard = () => {
    const { user, profile, isLoggedIn, fetchProfile } = useAuth();
    const location = useLocation();
    // mode: 'main' | 'sell' | 'share' | 'buy' | 'groupbuy'
    const [mode, setMode] = useState('main');
    // shareRegion: null | region object
    const [shareRegion, setShareRegion] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({ title: '', country: '', price: '', location: '', content: '', transactionType: 'direct', image_url: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPageSell, setCurrentPageSell] = useState(1);
    const [currentPageBuy, setCurrentPageBuy] = useState(1);
    const [sellingItems, setSellingItems] = useState([]);
    const [sharingItems, setSharingItems] = useState([]);
    const [buyingRequests, setBuyingRequests] = useState([]);
    const [groupbuyItems, setGroupbuyItems] = useState([]);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const itemsPerPage = 8;

    // Fetch listings when mode changes
    const fetchListings = async () => {
        if (mode === 'main') { setLoading(false); setError(null); return; }
        try {
            setLoading(true);
            setError(null);
            const typeMap = { sell: 'sell', buy: 'buy', share: 'share', groupbuy: 'groupbuy' };
            const data = await marketApi.getAll(typeMap[mode]) || [];
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
        }
    };

    // 포인트 전액 결제 모달 상태
    const [paymentModal, setPaymentModal] = useState(null); // 선택된 아이템
    const [paymentLoading, setPaymentLoading] = useState(false);

    const openPaymentModal = (item) => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        if (item.user_id === user.id) { alert('자신의 물품은 구매할 수 없습니다.'); return; }
        const totalPrice = parseInt(String(item.price).replace(/[^0-9]/g, '')) || 0;
        if (totalPrice <= 0) { alert('가격이 설정되지 않은 물품입니다. 판매자에게 직접 문의해주세요.'); return; }
        setPaymentModal(item);
    };

    const handlePayment = async () => {
        if (!paymentModal) return;
        const totalPrice = parseInt(String(paymentModal.price).replace(/[^0-9]/g, '')) || 0;
        const myPoints = profile?.points_balance || 0;

        if (myPoints < totalPrice) {
            alert(`포인트가 부족합니다.\n필요: ${totalPrice.toLocaleString()}P / 보유: ${myPoints.toLocaleString()}P\n\n현금·카드 결제(PG)는 사업자 등록 후 제공될 예정입니다. 현재는 포인트로 전액 결제만 가능합니다.`);
            return;
        }

        if (!window.confirm(`${totalPrice.toLocaleString()}P로 구매하시겠습니까?`)) return;

        setPaymentLoading(true);
        try {
            await marketTransactionApi.purchaseWithPoints(paymentModal.id, totalPrice);
            setSellingItems(prev => prev.filter(i => i.id !== paymentModal.id));
            // 결제 후 포인트 잔액 표시 갱신
            if (user?.id) fetchProfile?.(user.id);
            alert('결제 완료!');
            setPaymentModal(null);
        } catch (err) {
            console.error('결제 실패:', err);
            alert('결제에 실패했습니다.');
        } finally {
            setPaymentLoading(false);
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
                                <h2 className="text-4xl font-black mb-4">물품거래 및 나눔 게시판</h2>
                                <p className="text-gray-500">필요한 물건을 찾거나, 동료들을 위해 따뜻한 나눔을 실천해보세요.</p>
                            </div>


                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                                {/* 물품팔아요 */}
                                <motion.div
                                    whileHover={{ y: -10 }}
                                    onClick={() => setMode('sell')}
                                    className="bg-white rounded-2xl p-6 shadow-xl cursor-pointer hover:shadow-2xl transition-all border border-transparent hover:border-blue-100 group"
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
                                    className="bg-white rounded-2xl p-6 shadow-xl cursor-pointer hover:shadow-2xl transition-all border border-transparent hover:border-green-100 group"
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
                                    className="bg-white rounded-2xl p-6 shadow-xl cursor-pointer hover:shadow-2xl transition-all border border-transparent hover:border-pink-100 group"
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
                                    className="bg-white rounded-2xl p-6 shadow-xl cursor-pointer hover:shadow-2xl transition-all border border-transparent hover:border-purple-100 group"
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
                        <motion.div
                            key="sell-market"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                        >
                            <div className="max-w-6xl mx-auto">
                                <button
                                    onClick={resetView}
                                    className="flex items-center gap-2 text-gray-600 hover:text-blue-600 font-semibold mb-8 transition-colors"
                                >
                                    <ArrowLeft size={20} /> 메인으로 돌아가기
                                </button>

                                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 bg-blue-100 rounded-xl text-blue-600 flex-shrink-0">
                                            <ShoppingBag size={32} />
                                        </div>
                                        <div>
                                            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">물품팔아요</h2>
                                            <p className="text-gray-500 text-sm sm:text-base">여행자·승무원 회원들과 직접 거래해보세요.</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (!isLoggedIn) { setShowLoginPrompt(true); return; }
                                            setShowModal(true);
                                        }}
                                        className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors w-full sm:w-auto justify-center flex-shrink-0"
                                    >
                                        <Plus size={20} /> 글쓰기
                                    </button>
                                </div>

                                {loading || error ? (
                                    <ListState loading={loading} error={error} onRetry={fetchListings} color="blue" />
                                ) : sellingItems.length > 0 ? (
                                    <>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                            {sellingItems
                                                .slice((currentPageSell - 1) * itemsPerPage, currentPageSell * itemsPerPage)
                                                .map((item) => (
                                                    <div key={item.id} className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all border border-gray-100 group flex flex-col">
                                                        <div className="relative aspect-square overflow-hidden bg-gray-100">
                                                            {item.image_url && <img src={item.image_url} alt={item.title} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />}
                                                            <div className="absolute top-3 right-3">
                                                                <ReportButton postId={item.id} boardType="market" reportedUserId={item.user_id} />
                                                            </div>
                                                            <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-lg flex items-center gap-1">
                                                                <MapPin size={10} /> {item.location}
                                                            </div>
                                                        </div>
                                                        <div className="p-5 flex-1 flex flex-col">
                                                            <h3 className="font-bold text-gray-900 mb-1 line-clamp-1 group-hover:text-blue-600 transition-colors">{item.title}</h3>
                                                            <div className="flex items-center gap-2 mb-4">
                                                                <p className="text-lg font-black text-blue-600">{item.price != null ? Number(item.price).toLocaleString() + '원' : '가격 미정'}</p>
                                                                {item.price && parseInt(String(item.price).replace(/[^0-9]/g, '')) > 0 && (
                                                                    <span className="text-xs font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">
                                                                        {parseInt(String(item.price).replace(/[^0-9]/g, '')).toLocaleString()}P
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="mt-auto">
                                                                {item.status === 'sold' ? (
                                                                    <div className="py-2 bg-gray-200 text-gray-500 rounded-xl text-sm font-bold text-center">판매완료</div>
                                                                ) : (item.price == null || item.price <= 0) ? (
                                                                    <div className="py-2 bg-gray-100 text-gray-400 rounded-xl text-sm font-bold text-center cursor-not-allowed">가격 문의</div>
                                                                ) : (
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); openPaymentModal(item); }}
                                                                        className="w-full py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                                                                    >
                                                                        <Coins size={14} />
                                                                        구매하기
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end">
                                                                <ShareButtons title={item.title} description={item.content} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                        </div>

                                        {/* 페이지네이션 */}
                                        <Pagination
                                            currentPage={currentPageSell}
                                            totalPages={Math.ceil(sellingItems.length / itemsPerPage)}
                                            onPageChange={setCurrentPageSell}
                                            color="blue"
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
                                                    className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all text-gray-700 font-medium"
                                                />
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="py-20 text-center bg-white rounded-3xl border border-dashed border-gray-200">
                                        <ShoppingBag size={48} className="mx-auto text-gray-300 mb-4" />
                                        <p className="text-gray-500 text-lg">등록된 판매 물품이 없습니다.</p>
                                        {isLoggedIn && (
                                            <button onClick={() => setShowModal(true)} className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors">
                                                <Plus size={18} /> 판매 물품 등록
                                            </button>
                                        )}
                                    </div>
                                )}
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
                                ) : buyingRequests.length > 0 ? (
                                    <>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                            {buyingRequests
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
                                                            <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end">
                                                                <ShareButtons title={item.title} description={item.content} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                        </div>

                                        {/* 페이지네이션 */}
                                        <Pagination
                                            currentPage={currentPageBuy}
                                            totalPages={Math.ceil(buyingRequests.length / itemsPerPage)}
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
                                        <button onClick={() => { setShowModal(true); }}
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
                                ) : groupbuyItems.filter(i => !searchQuery || (i.title||'').toLowerCase().includes(searchQuery.toLowerCase()) || (i.content||'').toLowerCase().includes(searchQuery.toLowerCase())).length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {groupbuyItems.filter(i => !searchQuery || (i.title||'').toLowerCase().includes(searchQuery.toLowerCase()) || (i.content||'').toLowerCase().includes(searchQuery.toLowerCase())).map(item => (
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
                                                        <span className="truncate min-w-0">{item.author}</span>
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

                    {mode === 'share' && !shareRegion && (
                        <motion.div
                            key="share-region-select"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                        >
                            <div className="max-w-6xl mx-auto">
                                <button
                                    onClick={resetView}
                                    className="flex items-center gap-2 text-gray-600 hover:text-pink-500 font-semibold mb-8 transition-colors"
                                >
                                    <ArrowLeft size={20} /> 메인으로 돌아가기
                                </button>

                                <div className="text-center mb-12">
                                    <div className="inline-flex p-3 bg-pink-100 rounded-xl text-pink-500 mb-4">
                                        <Heart size={32} />
                                    </div>
                                    <h2 className="text-3xl font-bold mb-2">지역별 무료 나눔</h2>
                                    <p className="text-gray-500">어느 지역의 나눔 물품을 찾으시나요?</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    {regions.map((region) => (
                                        <motion.div
                                            key={region.id}
                                            whileHover={{ y: -5, scale: 1.02 }}
                                            onClick={() => setShareRegion(region)}
                                            className="group relative h-[240px] rounded-[2rem] overflow-hidden cursor-pointer shadow-lg hover:shadow-2xl transition-all"
                                        >
                                            <img
                                                src={region.image}
                                                loading="lazy"
                                                decoding="async"
                                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                                                alt={region.name}
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                                            <div className="absolute inset-0 p-8 flex flex-col justify-end text-white">
                                                <div className="mb-2 text-3xl">{region.icon}</div>
                                                <h3 className="text-3xl font-black mb-2">{region.name}</h3>
                                                <p className="text-white/90 text-sm font-medium">{region.desc}</p>
                                                <div className="mt-4 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0">
                                                    <span className="text-xs font-bold bg-white/20 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/30">
                                                        나눔 글 보기 →
                                                    </span>
                                                </div>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {mode === 'share' && shareRegion && (
                        <motion.div
                            key="share-list"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                        >
                            <div className="max-w-6xl mx-auto">
                                <button
                                    onClick={() => setShareRegion(null)}
                                    className="flex items-center gap-2 text-gray-600 hover:text-pink-500 font-semibold mb-8 transition-colors"
                                >
                                    <ArrowLeft size={20} /> 지역 선택으로 돌아가기
                                </button>

                                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
                                    <div className="flex items-center gap-4">
                                        <span className="text-4xl flex-shrink-0">{shareRegion.icon}</span>
                                        <div>
                                            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">{shareRegion.name} 나눔 게시판</h2>
                                            <p className="text-gray-500 text-sm sm:text-base">{shareRegion.name} 지역 비행 정보를 나누세요.</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (!isLoggedIn) { setShowLoginPrompt(true); return; }
                                            setShowModal(true);
                                        }}
                                        className="flex items-center gap-2 px-6 py-3 bg-pink-500 text-white rounded-xl font-bold hover:bg-pink-600 transition-colors w-full sm:w-auto justify-center flex-shrink-0"
                                    >
                                        <Plus size={20} /> 나눔 글쓰기
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    {loading || error ? (
                                        <div className="col-span-full">
                                            <ListState loading={loading} error={error} onRetry={fetchListings} color="pink" />
                                        </div>
                                    ) : sharingItems.filter(item => item.region_id === shareRegion.id).length > 0 ? (
                                        sharingItems
                                            .filter(item => item.region_id === shareRegion.id)
                                            .map((item) => (
                                                <div key={item.id} className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all border border-gray-100">
                                                    <div className="relative h-48 overflow-hidden bg-pink-50">
                                                        {item.image_url
                                                            ? <img src={item.image_url} alt={item.title} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                                                            : <div className="w-full h-full flex items-center justify-center text-pink-200"><Gift size={48} /></div>}
                                                        <div className="absolute top-3 left-3 bg-pink-500 text-white text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
                                                            <Gift size={12} /> 무료나눔
                                                        </div>
                                                        <div className="absolute top-3 right-3">
                                                            <ReportButton postId={item.id} boardType="market_share" reportedUserId={item.user_id} />
                                                        </div>
                                                    </div>
                                                    <div className="p-6">
                                                        <h3 className="font-bold text-xl mb-2">
                                                            <span className="text-pink-600">[{item.country}]</span> {item.title}
                                                        </h3>
                                                        <p className="text-gray-500 text-sm mb-4">{item.content}</p>
                                                        <div className="pt-3 border-t border-gray-100 flex justify-end">
                                                            <ShareButtons title={item.title} description={item.content} />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                    ) : (
                                        <div className="col-span-full py-20 text-center bg-white rounded-3xl border border-dashed border-gray-200">
                                            <Gift size={48} className="mx-auto text-gray-300 mb-4" />
                                            <p className="text-gray-500 text-lg">아직 등록된 나눔이 없어요.</p>
                                            <p className="text-gray-400 mt-1">첫 번째 나눔의 주인공이 되어보세요!</p>
                                            {isLoggedIn && (
                                                <button onClick={() => setShowModal(true)} className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-pink-500 text-white rounded-xl font-bold hover:bg-pink-600 transition-colors">
                                                    <Plus size={18} /> 나눔 등록하기
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* 검색 바 */}
                                <div className="mt-8">
                                    <div className="relative max-w-2xl mx-auto">
                                        <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder="나눔 물품, 국가 등으로 검색하세요..."
                                            className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-gray-200 focus:border-pink-500 focus:ring-2 focus:ring-pink-200 outline-none transition-all text-gray-700 font-medium"
                                        />
                                    </div>
                                </div>
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

                            <form onSubmit={handleSubmit} className="space-y-6">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">제목</label>
                                    <input
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
                                        <label className="block text-sm font-bold text-gray-700 mb-2">국가/도시</label>
                                        <input
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
                                        <div>
                                            <label className="block text-sm font-bold text-gray-700 mb-3">거래 유형</label>
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
                                                <label className="block text-sm font-bold text-gray-700 mb-2">가격</label>
                                                <input
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
                                                <label className="block text-sm font-bold text-gray-700 mb-2">{formData.transactionType === 'direct' ? '거래 장소' : '배송비'}</label>
                                                <input
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
                                                <label className="block text-sm font-bold text-gray-700 mb-2">희망 예산</label>
                                                <input
                                                    type="text"
                                                    value={formData.price}
                                                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-green-500 focus:ring-2 focus:ring-green-200 outline-none transition-all"
                                                    placeholder="예: ~30,000원 또는 가격 협의"
                                                    required
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-bold text-gray-700 mb-2">희망 거래 장소</label>
                                                <input
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
                                            <label className="block text-sm font-bold text-gray-700 mb-2">목표 가격 (1인당)</label>
                                            <input type="text" value={formData.price} onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none" placeholder="예: 15,000원" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-gray-700 mb-2">모집 인원</label>
                                            <input type="text" value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })}
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
                                    <label className="block text-sm font-bold text-gray-700 mb-2">상세 설명</label>
                                    <textarea
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
                                        className="flex-1 btn-primary"
                                    >
                                        등록하기
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
            {/* 포인트 전액 결제 모달 */}
            <AnimatePresence>
                {paymentModal && (() => {
                    const totalPrice = parseInt(String(paymentModal.price).replace(/[^0-9]/g, '')) || 0;
                    const myPoints = profile?.points_balance || 0;
                    const insufficient = myPoints < totalPrice;
                    return (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4"
                            onClick={() => setPaymentModal(null)}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl"
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-xl font-bold text-gray-800">포인트 결제</h3>
                                    <button onClick={() => setPaymentModal(null)} className="text-gray-400 hover:text-gray-600" aria-label="닫기"><X size={24} aria-hidden="true" /></button>
                                </div>

                                <div className="bg-gray-50 rounded-xl p-4 mb-4">
                                    <p className="font-semibold text-gray-800">{paymentModal.title}</p>
                                    <p className="text-2xl font-black text-blue-600 mt-1">{totalPrice.toLocaleString()}원</p>
                                </div>

                                <div className="bg-blue-50 rounded-xl p-4 mb-4 space-y-1">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">결제 포인트</span>
                                        <span className="font-bold text-blue-600">{totalPrice.toLocaleString()}P</span>
                                    </div>
                                    <div className="flex justify-between text-sm pt-1 border-t border-blue-200">
                                        <span className="text-gray-600">내 보유 포인트</span>
                                        <span className={`font-semibold ${insufficient ? 'text-red-500' : 'text-gray-800'}`}>{myPoints.toLocaleString()}P</span>
                                    </div>
                                    <p className="text-xs text-gray-500 pt-1">1P = 1원</p>
                                </div>

                                {insufficient && (
                                    <p className="text-sm text-red-500 mb-4">
                                        포인트가 부족합니다. 현금·카드 결제(PG)는 사업자 등록 후 제공될 예정입니다.
                                    </p>
                                )}

                                <button
                                    onClick={handlePayment}
                                    disabled={paymentLoading || insufficient}
                                    className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold text-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    <Coins size={18} />
                                    {paymentLoading ? '처리 중...' : '포인트로 전액 결제'}
                                </button>
                                <button
                                    onClick={() => setPaymentModal(null)}
                                    className="w-full mt-2 py-3 rounded-xl border border-gray-200 font-bold text-gray-700 hover:bg-gray-50 transition-colors"
                                >
                                    취소
                                </button>
                            </motion.div>
                        </motion.div>
                    );
                })()}
            </AnimatePresence>

            <LoginPrompt isOpen={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
        </section>
    );
};

export default MarketBoard;

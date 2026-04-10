import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag, Heart, ArrowLeft, Gift, MapPin, Plus, X, Search, Loader2, Users } from 'lucide-react';
import Pagination from './Pagination';
import ReportButton from './ReportButton';
import { useAuth } from '../lib/AuthContext';
import { marketApi, marketTransactionApi } from '../lib/db';
import { Coins } from 'lucide-react';
import ImageUpload from './ImageUpload';
import LoginPrompt from './LoginPrompt';
import SEOHead from './SEOHead';

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
    const { user, profile, isLoggedIn } = useAuth();
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
    const [currentPageShare, setCurrentPageShare] = useState(1);
    const [sellingItems, setSellingItems] = useState([]);
    const [sharingItems, setSharingItems] = useState([]);
    const [buyingRequests, setBuyingRequests] = useState([]);
    const [groupbuyItems, setGroupbuyItems] = useState([]);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [loading, setLoading] = useState(true);
    const itemsPerPage = 8;

    // Fetch listings when mode changes
    useEffect(() => {
        if (mode === 'main') { setLoading(false); return; }
        const fetchListings = async () => {
            setLoading(true);
            try {
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
            } finally {
                setLoading(false);
            }
        };
        fetchListings();
    }, [mode]);

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
            if (mode === 'sell') {
                listing.price = formData.price;
                listing.location = formData.location;
                listing.transaction_type = formData.transactionType;
            }
            if (mode === 'buy') {
                listing.budget = formData.price;
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

    // 복합결제 모달 상태
    const [paymentModal, setPaymentModal] = useState(null); // 선택된 아이템
    const [usePoints, setUsePoints] = useState(0);
    const [paymentMethod, setPaymentMethod] = useState('bank'); // 'bank' or 'card'
    const [paymentLoading, setPaymentLoading] = useState(false);

    const openPaymentModal = (item) => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        if (item.user_id === user.id) { alert('자신의 물품은 구매할 수 없습니다.'); return; }
        setPaymentModal(item);
        setUsePoints(0);
    };

    const handlePayment = async () => {
        if (!paymentModal) return;
        const totalPrice = parseInt(String(paymentModal.price).replace(/[^0-9]/g, ''));
        const pointsToUse = Math.min(usePoints, totalPrice, profile?.points_balance || 0);
        const remainingCash = totalPrice - pointsToUse;

        setPaymentLoading(true);
        try {
            if (pointsToUse > 0) {
                await marketTransactionApi.purchaseWithPoints(
                    paymentModal.id, paymentModal.user_id, user.id, pointsToUse
                );
            }
            if (remainingCash > 0) {
                // 계좌이체/카드 결제는 수동 처리 (추후 PG 연동)
                alert(`포인트 ${pointsToUse.toLocaleString()}P 차감 완료!\n\n나머지 ${remainingCash.toLocaleString()}원은 판매자에게 ${paymentMethod === 'bank' ? '계좌이체' : '카드결제'}로 결제해주세요.\n\n(PG 결제 연동 준비 중)`);
            } else {
                alert(`${pointsToUse.toLocaleString()}P로 결제 완료!`);
            }
            setSellingItems(prev => prev.filter(i => i.id !== paymentModal.id));
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

    // Reset to main view whenever the location changes
    // This ensures clicking the nav menu always shows the main selection screen
    useEffect(() => {
        resetView();
    }, [location]);

    // Scroll to top when shareRegion changes
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [shareRegion]);

    return (
        <section id="market" className="py-20 bg-gray-50 min-h-[80vh]">
            <SEOHead title="물품거래 및 나눔 - ConnecTrip" description="여행 물품 거래, 나눔, 중고 거래를 ConnecTrip에서 만나보세요." />
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
                            <div className="text-center mb-16">
                                <span className="text-blue-600 font-bold tracking-widest uppercase mb-2 block animate-fade-in">Marketplace</span>
                                <h2 className="text-4xl font-black mb-4">물품거래 및 나눔 게시판</h2>
                                <p className="text-gray-500">필요한 물건을 찾거나, 동료들을 위해 따뜻한 나눔을 실천해보세요.</p>
                            </div>


                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                {/* 물품팔아요 */}
                                <motion.div
                                    whileHover={{ y: -10 }}
                                    onClick={() => setMode('sell')}
                                    className="bg-white rounded-[2rem] p-10 shadow-xl cursor-pointer hover:shadow-2xl transition-all border border-transparent hover:border-blue-100 group"
                                >
                                    <div className="w-20 h-20 bg-blue-100 rounded-2xl flex items-center justify-center mb-6 text-blue-600 group-hover:scale-110 transition-transform">
                                        <ShoppingBag size={40} />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-3">물품팔아요</h3>
                                    <p className="text-gray-500 mb-6">
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
                                    className="bg-white rounded-[2rem] p-10 shadow-xl cursor-pointer hover:shadow-2xl transition-all border border-transparent hover:border-green-100 group"
                                >
                                    <div className="w-20 h-20 bg-green-100 rounded-2xl flex items-center justify-center mb-6 text-green-600 group-hover:scale-110 transition-transform">
                                        <Search size={40} />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-3">물품구해요</h3>
                                    <p className="text-gray-500 mb-6">
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
                                    className="bg-white rounded-[2rem] p-10 shadow-xl cursor-pointer hover:shadow-2xl transition-all border border-transparent hover:border-pink-100 group"
                                >
                                    <div className="w-20 h-20 bg-pink-100 rounded-2xl flex items-center justify-center mb-6 text-pink-500 group-hover:scale-110 transition-transform">
                                        <Heart size={40} />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-3">무료 나눔</h3>
                                    <p className="text-gray-500 mb-6">
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
                                    className="bg-white rounded-[2rem] p-10 shadow-xl cursor-pointer hover:shadow-2xl transition-all border border-transparent hover:border-purple-100 group"
                                >
                                    <div className="w-20 h-20 bg-purple-100 rounded-2xl flex items-center justify-center mb-6 text-purple-600 group-hover:scale-110 transition-transform">
                                        <Users size={40} />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-3">공동구매</h3>
                                    <p className="text-gray-500 mb-6">
                                        면세품, 현지 특산물 등 함께 사면 더 저렴!
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
                                            <p className="text-gray-500 text-sm sm:text-base">믿을 수 있는 동료들과 안전하게 거래하세요.</p>
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

                                {loading ? (
                                    <div className="py-20 text-center">
                                        <Loader2 size={48} className="mx-auto text-blue-500 animate-spin mb-4" />
                                        <p className="text-gray-500">불러오는 중...</p>
                                    </div>
                                ) : sellingItems.length > 0 ? (
                                    <>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                            {sellingItems
                                                .slice((currentPageSell - 1) * itemsPerPage, currentPageSell * itemsPerPage)
                                                .map((item) => (
                                                    <div key={item.id} className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all border border-gray-100 group flex flex-col">
                                                        <div className="relative aspect-square overflow-hidden bg-gray-100">
                                                            {item.img && <img src={item.img} alt={item.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />}
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
                                                                <p className="text-lg font-black text-blue-600">{item.price}</p>
                                                                {item.price && parseInt(String(item.price).replace(/[^0-9]/g, '')) > 0 && (
                                                                    <span className="text-xs font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">
                                                                        {parseInt(String(item.price).replace(/[^0-9]/g, '')).toLocaleString()}P
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="mt-auto">
                                                                {item.status === 'sold' ? (
                                                                    <div className="py-2 bg-gray-200 text-gray-500 rounded-xl text-sm font-bold text-center">판매완료</div>
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

                                {loading ? (
                                    <div className="py-20 text-center">
                                        <Loader2 size={48} className="mx-auto text-green-500 animate-spin mb-4" />
                                        <p className="text-gray-500">불러오는 중...</p>
                                    </div>
                                ) : buyingRequests.length > 0 ? (
                                    <>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                            {buyingRequests
                                                .slice((currentPageBuy - 1) * itemsPerPage, currentPageBuy * itemsPerPage)
                                                .map((item) => (
                                                    <div key={item.id} className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all border border-gray-100 cursor-pointer group">
                                                        <div className="relative aspect-square overflow-hidden bg-gray-100">
                                                            {item.img && <img src={item.img} alt={item.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />}
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
                                                            <p className="text-lg font-black text-green-600">{item.budget}</p>
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
                                            <p className="text-gray-500 text-sm sm:text-base">함께 사면 더 저렴! 공동구매를 모집하거나 참여하세요.</p>
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
                                {loading ? (
                                    <div className="text-center py-16"><Loader2 size={48} className="mx-auto text-purple-500 animate-spin mb-4" /><p className="text-gray-500">로딩 중...</p></div>
                                ) : groupbuyItems.filter(i => !searchQuery || (i.title||'').toLowerCase().includes(searchQuery.toLowerCase()) || (i.content||'').toLowerCase().includes(searchQuery.toLowerCase())).length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {groupbuyItems.filter(i => !searchQuery || (i.title||'').toLowerCase().includes(searchQuery.toLowerCase()) || (i.content||'').toLowerCase().includes(searchQuery.toLowerCase())).map(item => (
                                            <div key={item.id} className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all border border-gray-100">
                                                {item.image_url && <div className="h-48 overflow-hidden"><img src={item.image_url} alt={item.title} className="w-full h-full object-cover" /></div>}
                                                <div className="p-5">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-bold rounded-full">공동구매</span>
                                                        {item.price && <span className="font-bold text-purple-600">{item.price}</span>}
                                                    </div>
                                                    <h3 className="font-bold text-lg mb-2 line-clamp-1">{item.title}</h3>
                                                    <p className="text-gray-600 text-sm mb-3 line-clamp-2">{item.content}</p>
                                                    <div className="flex items-center justify-between text-xs text-gray-400">
                                                        <span>{item.author}</span>
                                                        <span>{new Date(item.created_at).toLocaleDateString('ko-KR')}</span>
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
                                    {sharingItems.filter(item => item.region_id === shareRegion.id).length > 0 ? (
                                        sharingItems
                                            .filter(item => item.region_id === shareRegion.id)
                                            .map((item) => (
                                                <div key={item.id} className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all border border-gray-100">
                                                    <div className="relative h-48 overflow-hidden">
                                                        <img src={item.img} alt={item.title} className="w-full h-full object-cover" />
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
                                                        <p className="text-gray-500 text-sm mb-4">{item.desc}</p>
                                                        <button className="w-full py-3 bg-gray-50 text-gray-600 rounded-xl font-bold hover:bg-pink-50 hover:text-pink-500 transition-colors">
                                                            채팅으로 문의하기
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                    ) : (
                                        <div className="col-span-full py-20 text-center bg-white rounded-3xl border border-dashed border-gray-200">
                                            <Gift size={48} className="mx-auto text-gray-300 mb-4" />
                                            <p className="text-gray-500 text-lg">아직 등록된 나눔이 없어요.</p>
                                            <p className="text-gray-400 mt-1">첫 번째 나눔의 주인공이 되어보세요!</p>
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
                                >
                                    <X size={24} />
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
                                                    value={formData.price}
                                                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                                    placeholder="예: 50,000원"
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
            {/* 복합결제 모달 */}
            <AnimatePresence>
                {paymentModal && (
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
                                <h3 className="text-xl font-bold text-gray-800">결제하기</h3>
                                <button onClick={() => setPaymentModal(null)} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
                            </div>

                            <div className="bg-gray-50 rounded-xl p-4 mb-4">
                                <p className="font-semibold text-gray-800">{paymentModal.title}</p>
                                <p className="text-2xl font-black text-blue-600 mt-1">{parseInt(String(paymentModal.price).replace(/[^0-9]/g, '')).toLocaleString()}원</p>
                            </div>

                            <div className="space-y-4">
                                {/* 포인트 사용 */}
                                <div>
                                    <label className="text-sm font-semibold text-gray-700 mb-1 block">포인트 사용</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            value={usePoints}
                                            onChange={(e) => {
                                                const v = Math.max(0, Math.min(
                                                    parseInt(e.target.value) || 0,
                                                    parseInt(String(paymentModal.price).replace(/[^0-9]/g, '')),
                                                    profile?.points_balance || 0
                                                ));
                                                setUsePoints(v);
                                            }}
                                            className="flex-1 px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 text-gray-800"
                                            placeholder="0"
                                        />
                                        <button
                                            onClick={() => setUsePoints(Math.min(
                                                parseInt(String(paymentModal.price).replace(/[^0-9]/g, '')),
                                                profile?.points_balance || 0
                                            ))}
                                            className="px-3 py-3 bg-purple-100 text-purple-700 rounded-xl text-sm font-bold whitespace-nowrap"
                                        >
                                            전액사용
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">보유: {(profile?.points_balance || 0).toLocaleString()}P (1P = 1원)</p>
                                </div>

                                {/* 나머지 금액 */}
                                {(() => {
                                    const total = parseInt(String(paymentModal.price).replace(/[^0-9]/g, ''));
                                    const remaining = total - usePoints;
                                    return remaining > 0 ? (
                                        <div>
                                            <label className="text-sm font-semibold text-gray-700 mb-2 block">
                                                나머지 결제: <span className="text-blue-600">{remaining.toLocaleString()}원</span>
                                            </label>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setPaymentMethod('bank')}
                                                    className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${paymentMethod === 'bank' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}
                                                >
                                                    🏦 계좌이체
                                                </button>
                                                <button
                                                    onClick={() => setPaymentMethod('card')}
                                                    className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${paymentMethod === 'card' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}
                                                >
                                                    💳 카드결제
                                                </button>
                                            </div>
                                            <p className="text-xs text-orange-500 mt-2">* 실결제는 PG 연동 후 가능합니다. 현재는 판매자와 직접 거래해주세요.</p>
                                        </div>
                                    ) : null;
                                })()}

                                {/* 결제 요약 */}
                                <div className="bg-blue-50 rounded-xl p-4 space-y-1">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">상품 가격</span>
                                        <span className="font-semibold">{parseInt(String(paymentModal.price).replace(/[^0-9]/g, '')).toLocaleString()}원</span>
                                    </div>
                                    {usePoints > 0 && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-purple-600">포인트 사용</span>
                                            <span className="font-semibold text-purple-600">-{usePoints.toLocaleString()}P</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between text-sm pt-1 border-t border-blue-200">
                                        <span className="font-bold text-gray-800">추가 결제액</span>
                                        <span className="font-black text-blue-600">{(parseInt(String(paymentModal.price).replace(/[^0-9]/g, '')) - usePoints).toLocaleString()}원</span>
                                    </div>
                                </div>

                                <button
                                    onClick={handlePayment}
                                    disabled={paymentLoading}
                                    className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold text-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                                >
                                    {paymentLoading ? '처리 중...' : '결제하기'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <LoginPrompt isOpen={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
        </section>
    );
};

export default MarketBoard;

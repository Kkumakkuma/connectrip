import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, ArrowLeft, TicketPercent, Plus, X, Search, Megaphone, MessageCircle, Trash2, User } from 'lucide-react';
import ShareButtons from './ShareButtons';
import { useAuth } from '../lib/AuthContext';
import { reviewsApi, storageApi } from '../lib/db';
import ImageUpload from './ImageUpload';
import LoginPrompt from './LoginPrompt';

const regions = [
    { id: 'europe', name: '유럽', icon: '🏰', desc: '유럽 감성 숙소와 투어 패키지', image: 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?q=80&w=800&auto=format&fit=crop' },
    { id: 'americas', name: '미주', icon: '🗽', desc: '미주 지역 렌터카 및 액티비티 할인', image: 'https://images.unsplash.com/photo-1485738422979-f5c462d49f74?q=80&w=800&auto=format&fit=crop' },
    { id: 'africa', name: '아프리카', icon: '🦁', desc: '사파리 투어 및 사막 호텔 특가', image: 'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?q=80&w=800&auto=format&fit=crop' },
    { id: 'southeast-asia', name: '동남아', icon: '🏝️', desc: '풀빌라 리조트 초특가 프로모션', image: 'https://images.unsplash.com/photo-1528127269322-539801943592?q=80&w=800&auto=format&fit=crop' },
    { id: 'asia', name: '아시아', icon: '🐅', desc: '일본/중국 온천 여행 및 료칸 예약', image: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?q=80&w=800&auto=format&fit=crop' },
    { id: 'oceania', name: '오세아니아', icon: '🦘', desc: '호주/뉴질랜드 캠핑카 투어 할인', image: 'https://images.unsplash.com/photo-1523482580672-f109ba8cb9be?q=80&w=800&auto=format&fit=crop' },
];

const Promotions = () => {
    const { regionId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { user, profile, isLoggedIn } = useAuth();
    const [mode, setMode] = useState('main');
    const [selectedRegion, setSelectedRegion] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    const [formData, setFormData] = useState({ title: '', rating: '', content: '', image_url: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setMode('main');
        setSelectedRegion(null);
        window.scrollTo(0, 0);
    }, [location.key]);

    const fetchPosts = async (regionId, type) => {
        setLoading(true);
        try {
            const data = await reviewsApi.getAll(regionId, type);
            setPosts(data || []);
        } catch (err) {
            console.error('게시글 로드 실패:', err);
            setPosts([]);
        }
        setLoading(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!user) return;
        try {
            await reviewsApi.create({
                user_id: user.id,
                region_id: selectedRegion.id,
                type: mode,
                title: formData.title,
                description: formData.content,
                rating: parseFloat(formData.rating) || null,
                image_url: formData.image_url || null,
                author_name: profile?.name || '익명',
            });
            setFormData({ title: '', rating: '', content: '', image_url: '' });
            setShowModal(false);
            fetchPosts(selectedRegion.id, mode);
        } catch (err) {
            console.error('게시글 등록 실패:', err);
            alert('게시글 등록에 실패했습니다. 다시 시도해주세요.');
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('정말 삭제하시겠습니까?')) return;
        try {
            await reviewsApi.delete(id);
            setPosts(prev => prev.filter(p => p.id !== id));
        } catch (err) {
            console.error('삭제 실패:', err);
        }
    };

    const handleCategorySelect = (category) => {
        setMode(category);
    };

    const handleRegionSelect = (region) => {
        setSelectedRegion(region);
        fetchPosts(region.id, mode);
    };

    const handleBackToCategories = () => {
        setMode('main');
        setSelectedRegion(null);
        setPosts([]);
    };

    const handleBackToRegions = () => {
        setSelectedRegion(null);
        setPosts([]);
    };

    const handleWriteClick = () => {
        if (!isLoggedIn) {
            setShowLoginPrompt(true);
            return;
        }
        setShowModal(true);
    };

    const filteredPosts = posts.filter(p =>
        p.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <section id="promotions" className="section-padding" style={{ background: '#fff', minHeight: '80vh' }}>
            <div className="container">
                <AnimatePresence mode="wait">
                    {mode === 'main' && (
                        <motion.div key="category-selection" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                            <div className="flex flex-col items-center mb-16 text-center">
                                <span className="text-blue-600 font-bold tracking-widest uppercase mb-2">Promotions & Reviews</span>
                                <h2 className="text-4xl font-black mb-4">여행상품 홍보 및 후기</h2>
                                <p className="text-gray-500">원하는 게시판을 선택해주세요.</p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                                <motion.div whileHover={{ y: -10 }} onClick={() => handleCategorySelect('promotion')} className="bg-white rounded-[2rem] p-10 shadow-xl cursor-pointer hover:shadow-2xl transition-all border border-transparent hover:border-blue-100 group">
                                    <div className="w-20 h-20 bg-blue-100 rounded-2xl flex items-center justify-center mb-6 text-blue-600 group-hover:scale-110 transition-transform">
                                        <Megaphone size={40} />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-3">홍보 게시판</h3>
                                    <p className="text-gray-500 mb-6">여행 상품, 특가 패키지, 할인 정보 등을 홍보하고 확인하세요.</p>
                                    <span className="text-blue-600 font-bold flex items-center gap-2">홍보 보러가기 →</span>
                                </motion.div>
                                <motion.div whileHover={{ y: -10 }} onClick={() => handleCategorySelect('review')} className="bg-white rounded-[2rem] p-10 shadow-xl cursor-pointer hover:shadow-2xl transition-all border border-transparent hover:border-purple-100 group">
                                    <div className="w-20 h-20 bg-purple-100 rounded-2xl flex items-center justify-center mb-6 text-purple-600 group-hover:scale-110 transition-transform">
                                        <MessageCircle size={40} />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-3">후기 게시판</h3>
                                    <p className="text-gray-500 mb-6">실제 여행 후기와 생생한 경험담을 공유하고 확인하세요.</p>
                                    <span className="text-purple-600 font-bold flex items-center gap-2">후기 보러가기 →</span>
                                </motion.div>
                            </div>
                        </motion.div>
                    )}

                    {(mode === 'promotion' || mode === 'review') && !selectedRegion && (
                        <motion.div key="region-selection" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                            <button onClick={handleBackToCategories} className="flex items-center gap-2 text-gray-600 hover:text-blue-600 font-semibold mb-8 transition-colors">
                                <ArrowLeft size={20} /> 게시판 선택으로 돌아가기
                            </button>
                            <div className="flex flex-col items-center mb-12 text-center">
                                <span className={`${mode === 'promotion' ? 'text-blue-600' : 'text-purple-600'} font-bold tracking-widest uppercase mb-2`}>
                                    {mode === 'promotion' ? 'Promotions' : 'Reviews'}
                                </span>
                                <h2 className="text-4xl font-black mb-4">{mode === 'promotion' ? '홍보 게시판' : '후기 게시판'}</h2>
                                <p className="text-gray-500">지역을 선택해주세요.</p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
                                {regions.map((region) => (
                                    <motion.div key={region.id} whileHover={{ y: -5, scale: 1.02 }} onClick={() => handleRegionSelect(region)} className="group relative h-[240px] rounded-[2rem] overflow-hidden cursor-pointer shadow-lg hover:shadow-2xl transition-all">
                                        <img src={region.image} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" alt={region.name} />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                                        <div className="absolute inset-0 p-8 flex flex-col justify-end text-white">
                                            <div className="mb-2 text-3xl">{region.icon}</div>
                                            <h3 className="text-3xl font-black mb-2">{region.name}</h3>
                                            <p className="text-white/90 text-sm font-medium">{region.desc}</p>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        </motion.div>
                    )}

                    {selectedRegion && (
                        <motion.div key="post-list" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                            <div className="mb-8">
                                <button onClick={handleBackToRegions} className="flex items-center gap-2 text-gray-600 hover:text-blue-600 font-semibold mb-6 transition-colors">
                                    <ArrowLeft size={20} /> 지역 선택으로 돌아가기
                                </button>
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-4">
                                        <span className="text-4xl">{selectedRegion.icon}</span>
                                        <div>
                                            <h2 className="text-3xl font-bold text-gray-900">{selectedRegion.name} {mode === 'promotion' ? '홍보' : '후기'}</h2>
                                            <p className="text-gray-500 text-sm mt-1">{selectedRegion.desc}</p>
                                        </div>
                                    </div>
                                    <button onClick={handleWriteClick} className={`flex items-center gap-2 px-6 py-3 ${mode === 'promotion' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'} text-white rounded-xl font-bold transition-colors`}>
                                        <Plus size={20} /> {mode === 'promotion' ? '홍보 등록' : '후기 작성'}
                                    </button>
                                </div>
                            </div>

                            {/* 검색 */}
                            <div className="mb-8">
                                <div className="relative max-w-2xl mx-auto">
                                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                                    <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder={`${mode === 'promotion' ? '상품명' : '후기 제목'}, 지역 등으로 검색하세요...`}
                                        className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all text-gray-700 font-medium" />
                                </div>
                            </div>

                            {loading ? (
                                <div className="text-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto"></div><p className="mt-4 text-gray-500">로딩 중...</p></div>
                            ) : filteredPosts.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    {filteredPosts.map((item) => (
                                        <div key={item.id} className="rounded-3xl overflow-hidden shadow-lg border border-gray-100 hover:scale-[1.02] transition-transform bg-white">
                                            <div className="relative h-48 overflow-hidden bg-gray-100">
                                                {item.image_url ? (
                                                    <img src={item.image_url} alt={item.title} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                        {mode === 'promotion' ? <Megaphone size={48} /> : <MessageCircle size={48} />}
                                                    </div>
                                                )}
                                                {item.rating && (
                                                    <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full flex items-center gap-1 text-sm font-bold">
                                                        <Star size={14} className="text-yellow-400 fill-yellow-400" /> {item.rating}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="p-6">
                                                <h3 className="text-xl font-bold mb-2">{item.title}</h3>
                                                <p className="text-gray-500 text-sm mb-3 line-clamp-3">{item.description}</p>
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2 text-gray-400 text-xs">
                                                        <User size={14} />
                                                        <span>{item.author_name || item.profiles?.name || '익명'}</span>
                                                        <span>·</span>
                                                        <span>{new Date(item.created_at).toLocaleDateString('ko-KR')}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <ShareButtons title={item.title} description={item.description} />
                                                        {user?.id === item.user_id && (
                                                            <button onClick={() => handleDelete(item.id)} className="text-red-400 hover:text-red-600 transition-colors">
                                                                <Trash2 size={16} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-20 bg-gray-50 rounded-3xl border border-dashed border-gray-300">
                                    <TicketPercent size={48} className="mx-auto text-gray-300 mb-4" />
                                    <p className="text-gray-500 text-lg">현재 등록된 {mode === 'promotion' ? '홍보' : '후기'}가 없습니다.</p>
                                    <p className="text-gray-400 text-sm mt-2">첫 번째 게시글을 작성해보세요!</p>
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* 글 작성 모달 */}
            <AnimatePresence>
                {showModal && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
                        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="bg-white rounded-3xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-2xl font-bold">{mode === 'promotion' ? '여행 상품 홍보하기' : '여행 후기 작성하기'}</h3>
                                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X size={24} /></button>
                            </div>
                            <form onSubmit={handleSubmit} className="space-y-6">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">{mode === 'promotion' ? '상품명' : '후기 제목'}</label>
                                    <input type="text" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                        placeholder={mode === 'promotion' ? '예: 다낭 3박 5일 풀빌라 투어' : '예: 다낭 여행 정말 최고였어요!'} required />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">평점 (선택)</label>
                                    <input type="number" step="0.1" min="0" max="5" value={formData.rating} onChange={(e) => setFormData({ ...formData, rating: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all" placeholder="예: 4.9" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">{mode === 'promotion' ? '상품 설명' : '후기 내용'}</label>
                                    <textarea value={formData.content} onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all resize-none" rows="6"
                                        placeholder={mode === 'promotion' ? '상품의 특장점, 포함 내역, 가격 등을 자세히 작성해주세요' : '여행 경험을 자세히 공유해주세요'} required />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">이미지 (선택)</label>
                                    <ImageUpload onUpload={(url) => setFormData({ ...formData, image_url: url })} />
                                    {formData.image_url && <img src={formData.image_url} alt="미리보기" className="mt-2 h-32 rounded-xl object-cover" />}
                                </div>
                                <div className="flex gap-3 pt-4">
                                    <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-6 py-3 rounded-xl border border-gray-200 font-bold text-gray-700 hover:bg-gray-50 transition-colors">취소</button>
                                    <button type="submit" className="flex-1 btn-primary">등록하기</button>
                                </div>
                            </form>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {showLoginPrompt && <LoginPrompt onClose={() => setShowLoginPrompt(false)} />}
        </section>
    );
};
export default Promotions;

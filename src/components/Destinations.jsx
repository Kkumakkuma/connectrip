import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, ArrowLeft, MapPin, Plus, X, Search, User } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { destinationsApi } from '../lib/db';
import ImageUpload from './ImageUpload';
import LoginPrompt from './LoginPrompt';
import ShareButtons from './ShareButtons';

const regions = [
    { id: 'europe', name: '유럽', icon: '🏰', desc: '승무원들이 가장 사랑하는 유럽의 숨은 명소', image: 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?q=80&w=800&auto=format&fit=crop' },
    { id: 'americas', name: '미주', icon: '🗽', desc: '쇼핑부터 힐링까지, 미주 비행 베스트 스팟', image: 'https://images.unsplash.com/photo-1485738422979-f5c462d49f74?q=80&w=800&auto=format&fit=crop' },
    { id: 'africa', name: '아프리카', icon: '🦁', desc: '대자연의 신비, 아프리카의 숨겨진 보석들', image: 'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?q=80&w=800&auto=format&fit=crop' },
    { id: 'southeast-asia', name: '동남아', icon: '🏝️', desc: '가성비와 럭셔리를 한번에, 동남아 휴양지', image: 'https://images.unsplash.com/photo-1528127269322-539801943592?q=80&w=800&auto=format&fit=crop' },
    { id: 'asia', name: '아시아', icon: '🐅', desc: '짧은 비행으로 즐기는 완벽한 미식 여행', image: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?q=80&w=800&auto=format&fit=crop' },
    { id: 'oceania', name: '오세아니아', icon: '🦘', desc: '청정 자연과 도시의 조화, 오세아니아 핫플', image: 'https://images.unsplash.com/photo-1523482580672-f109ba8cb9be?q=80&w=800&auto=format&fit=crop' },
];

const DestinationCard = ({ dest, onToggleLike, isLiked }) => (
    <motion.div
        className="rounded-[1rem] overflow-hidden bg-white shadow-md hover:shadow-xl transition-all"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -10 }}
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
        <div className="h-[220px] overflow-hidden">
            <img
                src={dest.image_url || 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?q=80&w=800&auto=format&fit=crop'}
                alt={dest.name}
                className="w-full h-full object-cover hover:scale-110 transition-transform duration-500"
            />
        </div>
        <div className="p-6 flex-1 flex flex-col">
            <div className="flex justify-between items-center mb-2">
                <h3 className="text-xl font-bold">{dest.name}</h3>
                <button
                    onClick={() => onToggleLike(dest.id)}
                    className="flex items-center gap-1 text-pink-500 font-semibold hover:bg-pink-50 px-2 py-1 rounded-full transition-colors"
                >
                    <Heart size={18} fill={isLiked ? "#ff4b81" : "none"} strokeWidth={isLiked ? 0 : 2.5} />
                    <span>{dest.likes_count || 0}</span>
                </button>
            </div>
            <p className="text-gray-500 text-sm mb-4 leading-relaxed">{dest.description}</p>
            {dest.crew_comment && (
                <div className="bg-gray-50 p-4 rounded-xl mt-auto">
                    <div className="flex items-start gap-2">
                        <span className="text-lg">✈️</span>
                        <p className="text-sm italic text-gray-700 font-medium">"{dest.crew_comment}"</p>
                    </div>
                </div>
            )}
            <div className="flex items-center justify-between text-gray-400 text-xs mt-3">
                <div className="flex items-center gap-2">
                    <User size={12} />
                    <span>{dest.profiles?.name || '익명 승무원'}</span>
                </div>
                <ShareButtons title={`${dest.name} - ConnecTrip 추천 여행지`} description={dest.description} />
            </div>
        </div>
    </motion.div>
);

const Destinations = () => {
    const { regionId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { user, profile, isLoggedIn } = useAuth();
    const selectedRegion = regionId ? regions.find(r => r.id === regionId) : null;
    const [showModal, setShowModal] = useState(false);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    const [formData, setFormData] = useState({ name: '', desc: '', crewComment: '', image_url: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [allDestinations, setAllDestinations] = useState([]);
    const [userLikes, setUserLikes] = useState(() => {
        const saved = localStorage.getItem('userLikes');
        return saved ? JSON.parse(saved) : {};
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        localStorage.setItem('userLikes', JSON.stringify(userLikes));
    }, [userLikes]);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [location.key]);

    useEffect(() => {
        if (selectedRegion) {
            fetchDestinations(selectedRegion.id);
        }
    }, [selectedRegion]);

    const fetchDestinations = async (regionId) => {
        setLoading(true);
        try {
            const data = await destinationsApi.getAll(regionId);
            setAllDestinations(data || []);
        } catch (err) {
            console.error('추천지 로드 실패:', err);
            setAllDestinations([]);
        }
        setLoading(false);
    };

    const handleToggleLike = async (id) => {
        const currentlyLiked = !!userLikes[id];
        setUserLikes(prev => ({ ...prev, [id]: !currentlyLiked }));
        setAllDestinations(prev => prev.map(dest => {
            if (dest.id === id) {
                return { ...dest, likes_count: currentlyLiked ? Math.max(0, (dest.likes_count || 0) - 1) : (dest.likes_count || 0) + 1 };
            }
            return dest;
        }));
        try {
            if (currentlyLiked) {
                await destinationsApi.unlike(id);
            } else {
                await destinationsApi.like(id);
            }
        } catch (err) {
            console.error('좋아요 실패:', err);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!user) return;
        try {
            const newDest = await destinationsApi.create({
                user_id: user.id,
                region_id: selectedRegion.id,
                name: formData.name,
                description: formData.desc,
                crew_comment: formData.crewComment,
                image_url: formData.image_url || null,
            });
            setAllDestinations(prev => [newDest, ...prev]);
            setFormData({ name: '', desc: '', crewComment: '', image_url: '' });
            setShowModal(false);
        } catch (err) {
            console.error('추천지 등록 실패:', err);
            alert('등록에 실패했습니다. 다시 시도해주세요.');
        }
    };

    const handleWriteClick = () => {
        if (!isLoggedIn) {
            setShowLoginPrompt(true);
            return;
        }
        setShowModal(true);
    };

    const filteredDestinations = allDestinations.filter(dest =>
        dest.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        dest.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <section id="destinations" className="section-padding" style={{ background: 'var(--bg-light, #f9fafb)', minHeight: '80vh' }}>
            <div className="container">
                <AnimatePresence mode="wait">
                    {!selectedRegion ? (
                        <motion.div key="region-list" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                            <div className="text-center mb-12">
                                <span className="text-blue-600 font-bold tracking-widest uppercase">Hidden Gems</span>
                                <h2 className="text-4xl font-black mt-2">승무원이 추천하는 지역별 숨은 명소</h2>
                                <p className="text-gray-500 mt-4">어디로 떠나시나요? 지역을 선택하면 베테랑 승무원들의 시크릿 스팟이 펼쳐집니다.</p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
                                {regions.map((region) => (
                                    <motion.div key={region.id} whileHover={{ y: -5, scale: 1.02 }} onClick={() => navigate(`/recommend/${region.id}`)}
                                        className="group relative h-[240px] rounded-[2rem] overflow-hidden cursor-pointer shadow-lg hover:shadow-2xl transition-all">
                                        <img src={region.image} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" alt={region.name} />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                                        <div className="absolute inset-0 p-8 flex flex-col justify-end text-white">
                                            <div className="mb-2 text-3xl">{region.icon}</div>
                                            <h3 className="text-3xl font-black mb-2">{region.name}</h3>
                                            <p className="text-white/90 text-sm font-medium">{region.desc}</p>
                                            <div className="mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <span className="text-xs font-bold bg-white/20 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/30">추천 명소 보기 →</span>
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div key="destination-list" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                            <div className="mb-8">
                                <button onClick={() => navigate('/recommend')} className="flex items-center gap-2 text-gray-600 hover:text-blue-600 font-semibold mb-6 transition-colors">
                                    <ArrowLeft size={20} /> 지역 선택으로 돌아가기
                                </button>
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-4">
                                        <span className="text-4xl">{selectedRegion.icon}</span>
                                        <h2 className="text-3xl font-bold text-gray-900">{selectedRegion.name} 추천 명소</h2>
                                    </div>
                                    <button onClick={handleWriteClick} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors">
                                        <Plus size={20} /> 명소 추천하기
                                    </button>
                                </div>
                                <p className="text-gray-500">{selectedRegion.desc}</p>
                            </div>

                            <div className="mb-8">
                                <div className="relative max-w-2xl mx-auto">
                                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                                    <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="장소명, 설명 등으로 검색하세요..."
                                        className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all text-gray-700 font-medium" />
                                </div>
                            </div>

                            {loading ? (
                                <div className="text-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto"></div><p className="mt-4 text-gray-500">로딩 중...</p></div>
                            ) : filteredDestinations.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    {filteredDestinations.map(dest => (
                                        <DestinationCard key={dest.id} dest={dest} onToggleLike={handleToggleLike} isLiked={!!userLikes[dest.id]} />
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300">
                                    <MapPin size={48} className="mx-auto text-gray-300 mb-4" />
                                    <p className="text-gray-500 text-lg">아직 등록된 추천 명소가 없습니다.</p>
                                    <p className="text-gray-400 text-sm mt-2">첫 번째 명소를 추천해보세요!</p>
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
                                <h3 className="text-2xl font-bold">숨은 명소 추천하기</h3>
                                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X size={24} /></button>
                            </div>
                            <form onSubmit={handleSubmit} className="space-y-6">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">장소명</label>
                                    <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                        placeholder="예: Santorini, Greece" required />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">간단한 설명</label>
                                    <input type="text" value={formData.desc} onChange={(e) => setFormData({ ...formData, desc: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                        placeholder="한 줄로 장소를 소개해주세요" required />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">승무원 꽁팁</label>
                                    <textarea value={formData.crewComment} onChange={(e) => setFormData({ ...formData, crewComment: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all resize-none" rows="4"
                                        placeholder="승무원만 아는 특별한 팁을 공유해주세요!" required />
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
export default Destinations;

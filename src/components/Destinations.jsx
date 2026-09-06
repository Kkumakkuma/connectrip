import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, ArrowLeft, MapPin, Plus, X, Search, User, Lock } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { destinationsApi, postLikeApi } from '../lib/db';
import ImageUpload from './ImageUpload';
import LoginPrompt from './LoginPrompt';
import ShareButtons from './ShareButtons';
import CrewBadge from './CrewBadge';
import AuthorActions from './AuthorActions';
import ReportButton from './ReportButton';
import { crewVerificationStatus } from '../lib/crewVerification';
import ListState from './ListState';
import SEOHead from './SEOHead';

const regions = [
    { id: 'europe', name: '유럽', icon: '🏰', desc: '승무원들이 아끼는 유럽의 숨은 명소', image: 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?q=80&w=800&auto=format&fit=crop' },
    { id: 'americas', name: '미주', icon: '🗽', desc: '쇼핑부터 힐링까지, 미주 비행 베스트 스팟', image: 'https://images.unsplash.com/photo-1485738422979-f5c462d49f74?q=80&w=800&auto=format&fit=crop' },
    { id: 'africa', name: '아프리카', icon: '🦁', desc: '대자연의 신비, 아프리카의 숨겨진 보석들', image: 'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?q=80&w=800&auto=format&fit=crop' },
    { id: 'southeast-asia', name: '동남아', icon: '🏝️', desc: '가성비와 럭셔리를 한번에, 동남아 휴양지', image: 'https://images.unsplash.com/photo-1528127269322-539801943592?q=80&w=800&auto=format&fit=crop' },
    { id: 'asia', name: '아시아', icon: '🐅', desc: '짧은 비행으로 즐기는 미식 여행', image: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?q=80&w=800&auto=format&fit=crop' },
    { id: 'oceania', name: '오세아니아', icon: '🦘', desc: '청정 자연과 도시의 조화, 오세아니아 핫플', image: 'https://images.unsplash.com/photo-1523482580672-f109ba8cb9be?q=80&w=800&auto=format&fit=crop' },
];

const DestinationCard = ({ dest, onToggleLike, isLiked, likeCount, currentUserId }) => (
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
                loading="lazy"
                decoding="async"
                width="800"
                height="220"
                onError={(e) => { if (!e.currentTarget.src.endsWith('/icon-512x512.png')) e.currentTarget.src = '/icon-512x512.png'; }}
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
                    <span>{likeCount}</span>
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
                <div className="flex items-center gap-2 min-w-0">
                    <User size={12} className="flex-shrink-0" />
                    <span className="truncate">{dest.profiles?.name || '익명 승무원'}</span>
                    <CrewBadge profile={dest.profiles} />
                    <AuthorActions userId={dest.user_id} name={dest.profiles?.name || ''} size={12} />
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <ShareButtons title={`${dest.name} - ConnectTrip 추천 여행지`} description={dest.description} />
                    {currentUserId && currentUserId !== dest.user_id && (
                        <ReportButton postId={dest.id} boardType="destination" reportedUserId={dest.user_id} />
                    )}
                </div>
            </div>
        </div>
    </motion.div>
);

// 화면에 보여줄 좋아요 수 = 레거시 카운터 + post_likes 서버 집계.
// destinations.likes_count 에는 시드(scripts/seed-destinations.sql)와 구 increment_likes 로
// 쌓인 값이 이미 있는데 post_likes 에는 대응 행이 없다. 서버 집계만 쓰면 기존 좋아요가
// 전부 0으로 보이므로, 레거시 값을 기준선으로 두고 그 위에 post_likes 집계를 더한다.
const likeCountOf = (dest, likeMap) => (dest.likes_count || 0) + (likeMap[dest.id]?.count || 0);

const Destinations = () => {
    const { regionId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { user, profile, isLoggedIn, isCrew, profileLoading } = useAuth();
    // 승무원 추천지 = 인증 승무원 전용 작성. 일반 회원은 읽기만 가능.
    // 바탕은 DB RLS(destinations INSERT)와 같은 조건: user_type='crew' AND crew_verified.
    // 거기에 만료 판정을 하나 더 건다 — DB 플래그는 매일 새벽 cron 이 내리므로 만료 시각부터
    // 그때까지는 crew_verified 가 아직 true 다. 만료됐다고 안내하면서 글쓰기를 열어 두지 않는다.
    const crewExpired = isLoggedIn && isCrew && crewVerificationStatus(profile).state === 'expired';
    const canWrite = isLoggedIn && isCrew && !!profile?.crew_verified && !crewExpired;
    const selectedRegion = regionId ? regions.find(r => r.id === regionId) : null;
    const [showModal, setShowModal] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    const [formData, setFormData] = useState({ name: '', desc: '', crewComment: '', image_url: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [allDestinations, setAllDestinations] = useState([]);
    // 좋아요 상태는 서버(post_likes) 기준. 예전에는 localStorage['userLikes'] 하나로만
    // 중복을 막아서 ①무한 좋아요 ②한 기기에서 계정을 바꾸면 이전 사용자의 상태를
    // 물려받는 문제가 있었다. 다른 게시판 4곳과 같은 postLikeApi 경로로 통일한다.
    const [likes, setLikes] = useState({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        window.scrollTo(0, 0);
        const q = new URLSearchParams(location.search).get('q');
        if (q) setSearchQuery(q);
    }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

    // user?.id 를 의존성에 넣어, 같은 기기에서 계정이 바뀌면 좋아요 상태를 서버 기준으로 다시 읽는다.
    useEffect(() => {
        if (selectedRegion) {
            fetchDestinations(selectedRegion.id);
        }
    }, [selectedRegion, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const fetchDestinations = async (regionId) => {
        try {
            setLoading(true);
            setError(null);
            const data = await destinationsApi.getAll(regionId) || [];
            let likeMap = {};
            if (data.length) {
                likeMap = await postLikeApi.getForBoard('destinations', data.map(d => d.id), user?.id);
            }
            setLikes(likeMap);
            // db.js getAll 은 likes_count(레거시 컬럼)로만 정렬한다. 신규 좋아요는 post_likes 에
            // 쌓이므로 합산값으로 한 번 더 정렬해야 좋아요순이 유지된다. 정렬은 목록을 받는
            // 시점에만 하고 토글 때는 다시 하지 않는다(누르는 순간 카드가 튀지 않도록).
            setAllDestinations([...data].sort((a, b) => likeCountOf(b, likeMap) - likeCountOf(a, likeMap)));
        } catch (err) {
            console.error('추천지 로드 실패:', err);
            setAllDestinations([]);
            setError('추천 명소를 불러오지 못했습니다. 다시 시도해주세요.');
        } finally {
            setLoading(false);
        }
    };

    const refetch = () => {
        if (selectedRegion) fetchDestinations(selectedRegion.id);
    };

    // toggle_post_like RPC 가 1인 1글 1좋아요(UNIQUE)와 휴대폰 인증·차단 여부를 DB 에서 검사한다.
    // 반환값이 정본이므로 낙관적 업데이트 없이 서버 응답으로 상태를 덮어쓴다(다른 게시판 4곳과 동일).
    const handleToggleLike = async (id) => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        try {
            const { data, error: e } = await postLikeApi.toggle('destinations', id);
            if (e) throw e;
            setLikes(prev => ({ ...prev, [id]: { count: data.likes_count, liked: data.liked } }));
        } catch (err) {
            console.error('좋아요 실패:', err);
            alert(err?.message?.includes('phone') ? '휴대폰 인증 후 좋아요할 수 있어요.' : '좋아요 처리에 실패했습니다.');
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!user) return;
        // 더블클릭하면 같은 글이 두 번 올라간다. 처리 중에는 재진입을 막는다.
        if (submitting) return;
        if (!canWrite) {
            alert('승무원 인증을 마친 회원만 명소를 추천할 수 있습니다.');
            setShowModal(false);
            return;
        }
        setSubmitting(true);
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
        } finally {
            setSubmitting(false);
        }
    };

    const handleWriteClick = () => {
        if (!isLoggedIn) {
            setShowLoginPrompt(true);
            return;
        }
        if (!canWrite) {
            alert('승무원 인증을 마친 회원만 명소를 추천할 수 있습니다.');
            return;
        }
        setShowModal(true);
    };

    const filteredDestinations = allDestinations.filter(dest =>
        dest.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        dest.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <>
        <SEOHead title="여행지 추천 - ConnectTrip" description="승무원들이 직접 추천하는 전 세계 여행지. 유럽, 미주, 동남아 등 지역별 숨은 명소와 핫플레이스를 만나보세요." />
        <section id="destinations" className="section-padding" style={{ background: 'var(--bg-light, #f9fafb)', minHeight: '80vh' }}>
            <div className="container">
                <AnimatePresence mode="wait">
                    {!selectedRegion ? (
                        <motion.div key="region-list" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                            <div className="text-center mb-12">
                                <span className="text-blue-600 font-bold tracking-widest uppercase">Hidden Gems</span>
                                <h1 className="text-4xl font-black mt-2">승무원이 추천하는 지역별 숨은 명소</h1>
                                <p className="text-gray-500 mt-4">어디로 떠나시나요? 지역을 선택하면 베테랑 승무원들의 시크릿 스팟이 펼쳐집니다.</p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
                                {regions.map((region) => (
                                    <motion.div key={region.id} whileHover={{ y: -5, scale: 1.02 }}
                                        className="group relative h-[240px] rounded-[2rem] overflow-hidden shadow-lg hover:shadow-2xl transition-all">
                                        {/* 카드 전체를 덮는 앵커. onClick 만 있으면 크롤러가 따라갈 링크가 없고
                                            키보드·새 탭 열기도 안 된다. 시각적 배치는 그대로 두고 링크만 얹는다. */}
                                        <Link to={`/recommend/${region.id}`} aria-label={`${region.name} 추천 명소 보기`}
                                            className="absolute inset-0 z-10 rounded-[2rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" />
                                        <img src={region.image} loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" alt={region.name} />
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
                                    {canWrite ? (
                                        <button onClick={handleWriteClick} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors">
                                            <Plus size={20} /> 명소 추천하기
                                        </button>
                                    ) : isLoggedIn && profileLoading ? null : (
                                        <div className="flex flex-col items-end gap-1">
                                            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-gray-100 text-gray-500 text-sm font-semibold whitespace-nowrap">
                                                <Lock size={16} aria-hidden="true" /> 인증 승무원만 작성할 수 있습니다
                                            </div>
                                            {crewExpired && (
                                                <Link to="/mypage#crew-renewal" className="text-xs font-semibold text-red-600 hover:underline text-right">
                                                    승무원 인증이 만료되었습니다. 마이페이지에서 갱신하세요
                                                </Link>
                                            )}
                                        </div>
                                    )}
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

                            {loading || error ? (
                                <ListState loading={loading} error={error} onRetry={refetch} color="blue" loadingText="로딩 중..." />
                            ) : filteredDestinations.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    {filteredDestinations.map(dest => (
                                        <DestinationCard key={dest.id} dest={dest} onToggleLike={handleToggleLike} isLiked={!!likes[dest.id]?.liked} likeCount={likeCountOf(dest, likes)} currentUserId={user?.id} />
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300">
                                    <MapPin size={48} className="mx-auto text-gray-300 mb-4" />
                                    <p className="text-gray-500 text-lg">아직 등록된 추천 명소가 없습니다.</p>
                                    <p className="text-gray-400 text-sm mt-2">{canWrite ? '첫 번째 명소를 추천해보세요!' : '인증 승무원이 등록한 명소가 이곳에 표시됩니다.'}</p>
                                    {canWrite && (
                                        <button onClick={handleWriteClick} className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors">
                                            <Plus size={18} /> 명소 추천하기
                                        </button>
                                    )}
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
                                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors" aria-label="닫기"><X size={24} aria-hidden="true" /></button>
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
                                        placeholder="승무원만 아는 팁을 공유해주세요" required />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">이미지 (선택)</label>
                                    <ImageUpload onUpload={(url) => setFormData({ ...formData, image_url: url })} />
                                    {formData.image_url && <img src={formData.image_url} alt="미리보기" loading="lazy" decoding="async" className="mt-2 h-32 rounded-xl object-cover" />}
                                </div>
                                <div className="flex gap-3 pt-4">
                                    <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-6 py-3 rounded-xl border border-gray-200 font-bold text-gray-700 hover:bg-gray-50 transition-colors">취소</button>
                                    <button type="submit" disabled={submitting} className="flex-1 btn-primary disabled:opacity-60">{submitting ? '등록 중…' : '등록하기'}</button>
                                </div>
                            </form>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <LoginPrompt isOpen={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
        </section>
        </>
    );
};
export default Destinations;

import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Lock, Users, Plus, X, MessageSquare, Plane, Search, ArrowLeft, Info, Tag, TrendingUp, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Pagination from './Pagination';
import ReportButton from './ReportButton';
import { useAuth } from '../lib/AuthContext';
import { crewApi } from '../lib/db';
import LoginPrompt from './LoginPrompt';
import SEOHead from './SEOHead';

const CrewOnly = () => {
    const { user, profile, isLoggedIn, isCrew } = useAuth();
    const [mode, setMode] = useState('main'); // 'main' | 'free' | 'layover' | 'deals'
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({ title: '', content: '', category: 'general' });
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPageFree, setCurrentPageFree] = useState(1);
    const [currentPageLayover, setCurrentPageLayover] = useState(1);
    const [currentPageDeals, setCurrentPageDeals] = useState(1);
    const [freePosts, setFreePosts] = useState([]);
    const [layoverPosts, setLayoverPosts] = useState([]);
    const [dealsPosts, setDealsPosts] = useState([]);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [loading, setLoading] = useState(true);
    const itemsPerPage = 4;
    const location = useLocation();

    // URL 변경 시 메인 화면으로 리셋
    useEffect(() => {
        resetView();
    }, [location.key]);

    // Fetch crew posts when mode changes
    useEffect(() => {
        if (mode === 'main' || !isCrew) { setLoading(false); return; }
        const fetchPosts = async () => {
            setLoading(true);
            try {
                const typeMap = { free: 'free', layover: 'layover', deals: 'deals' };
                const data = await crewApi.getAll(typeMap[mode]) || [];
                if (mode === 'free') setFreePosts(data);
                else if (mode === 'layover') setLayoverPosts(data);
                else if (mode === 'deals') setDealsPosts(data);
            } catch (err) {
                console.error('크루 게시글 로딩 실패:', err);
                if (mode === 'free') setFreePosts([]);
                else if (mode === 'layover') setLayoverPosts([]);
                else if (mode === 'deals') setDealsPosts([]);
            } finally {
                setLoading(false);
            }
        };
        fetchPosts();
    }, [mode, isCrew]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!isLoggedIn) {
            setShowLoginPrompt(true);
            return;
        }
        try {
            const postType = mode;
            const newPost = await crewApi.create({
                title: formData.title,
                content: formData.content,
                post_type: postType,
                category: formData.category,
                author: profile?.name || '익명',
                user_id: user.id,
            });
            if (mode === 'free') setFreePosts(prev => [newPost, ...prev]);
            else if (mode === 'layover') setLayoverPosts(prev => [newPost, ...prev]);
            else if (mode === 'deals') setDealsPosts(prev => [newPost, ...prev]);
            setFormData({ title: '', content: '', category: 'schedule' });
            setShowModal(false);
        } catch (err) {
            console.error('게시글 등록 실패:', err);
            alert('게시글 등록에 실패했습니다. 다시 시도해주세요.');
        }
    };

    const resetView = () => {
        setMode('main');
        setSearchQuery('');
    };

    // 일반 사용자 (승무원이 아닐 경우) 접근 차단
    if (!isCrew) {
        return (
            <section id="crew-only" className="py-20 bg-primary-color/5">
                <div className="container text-center">
                    <div className="max-w-3xl mx-auto py-16 px-8 rounded-3xl bg-white shadow-xl border border-red-500/10">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-500 text-white mb-8 shadow-lg">
                            <Lock size={40} />
                        </div>
                        <h2 className="text-3xl font-bold mb-4 text-red-600">접근 권한 없음</h2>
                        <p className="text-gray-600 mb-8 text-lg">
                            이 공간은 승무원(CREW) 계정으로 로그인하신 분들만 입장할 수 있는 전용 커뮤니티입니다. <br />
                            일반 여행자 회원님은 이용하실 수 없습니다.
                        </p>
                        <button
                            onClick={() => window.history.back()}
                            className="px-8 py-3 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-full font-bold transition-colors"
                        >
                            이전 페이지로 돌아가기
                        </button>
                    </div>
                </div>
            </section>
        );
    }

    // 인증된 경우
    return (
        <section id="crew-only" className="py-20 bg-gray-50 min-h-screen">
            <SEOHead title="승무원 전용 - ConnecTrip" description="항공 승무원을 위한 전용 커뮤니티. 스케줄 공유, 할인 정보, 비행 꿀팁." />
            <div className="container">
                <AnimatePresence mode="wait">
                    {mode === 'main' && (
                        <motion.div
                            key="main"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                        >
                            <div className="text-center mb-16">
                                <span className="text-blue-600 font-bold tracking-widest uppercase mb-2 block animate-fade-in">CREW Exclusive</span>
                                <h2 className="text-4xl font-black mb-4">CREW 전용 게시판</h2>
                                <p className="text-gray-500">승무원끼리 정보를 공유하고 특별한 혜택을 누려보세요.</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                                {/* 자유게시판 */}
                                <motion.div whileHover={{ y: -10 }} onClick={() => setMode('free')}
                                    className="bg-white rounded-[2rem] p-10 shadow-xl cursor-pointer hover:shadow-2xl transition-all border border-transparent hover:border-blue-100 group">
                                    <div className="w-20 h-20 bg-blue-100 rounded-2xl flex items-center justify-center mb-6 text-blue-600 group-hover:scale-110 transition-transform">
                                        <MessageSquare size={40} />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-3">자유게시판</h3>
                                    <p className="text-gray-500 mb-6">
                                        승무원끼리 자유롭게 이야기 나누세요. 고민 상담, 일상 공유, 비행 후기 등 무엇이든 OK!
                                    </p>
                                    <span className="text-blue-600 font-bold flex items-center gap-2">자유게시판 →</span>
                                </motion.div>

                                {/* 레이오버 정보 */}
                                <motion.div whileHover={{ y: -10 }} onClick={() => setMode('layover')}
                                    className="bg-white rounded-[2rem] p-10 shadow-xl cursor-pointer hover:shadow-2xl transition-all border border-transparent hover:border-green-100 group">
                                    <div className="w-20 h-20 bg-green-100 rounded-2xl flex items-center justify-center mb-6 text-green-600 group-hover:scale-110 transition-transform">
                                        <Plane size={40} />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-3">레이오버 정보</h3>
                                    <p className="text-gray-500 mb-6">
                                        각 도시 레이오버 맛집, 관광지, 숙소 꿀팁을 공유하세요. 현지 사정에 밝은 동료들의 생생한 정보!
                                    </p>
                                    <span className="text-green-600 font-bold flex items-center gap-2">레이오버 정보 →</span>
                                </motion.div>

                                {/* 할인 혜택 */}
                                <motion.div whileHover={{ y: -10 }} onClick={() => setMode('deals')}
                                    className="bg-white rounded-[2rem] p-10 shadow-xl cursor-pointer hover:shadow-2xl transition-all border border-transparent hover:border-purple-100 group">
                                    <div className="w-20 h-20 bg-purple-100 rounded-2xl flex items-center justify-center mb-6 text-purple-600 group-hover:scale-110 transition-transform">
                                        <Tag size={40} />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-3">할인 혜택</h3>
                                    <p className="text-gray-500 mb-6">
                                        승무원 전용 특별 할인, 프로모션, 이벤트 정보를 확인하세요. 독점 혜택들이 가득!
                                    </p>
                                    <span className="text-purple-600 font-bold flex items-center gap-2">할인 혜택 →</span>
                                </motion.div>
                            </div>
                        </motion.div>
                    )}

                    {['free', 'layover', 'deals'].includes(mode) && (
                        <motion.div key={mode + '-board'} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                            <div className="max-w-6xl mx-auto">
                                <button onClick={resetView} className="flex items-center gap-2 text-gray-600 hover:text-blue-600 font-semibold mb-8 transition-colors">
                                    <ArrowLeft size={20} /> 메인으로 돌아가기
                                </button>
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
                                    <div className="flex items-center gap-4">
                                        <div className={`p-3 rounded-xl flex-shrink-0 ${mode === 'free' ? 'bg-blue-100 text-blue-600' : mode === 'layover' ? 'bg-green-100 text-green-600' : 'bg-purple-100 text-purple-600'}`}>
                                            {mode === 'free' ? <MessageSquare size={32} /> : mode === 'layover' ? <Plane size={32} /> : <Tag size={32} />}
                                        </div>
                                        <div>
                                            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">
                                                {mode === 'free' ? '자유게시판' : mode === 'layover' ? '레이오버 정보' : '할인 혜택'}
                                            </h2>
                                            <p className="text-gray-500 text-sm sm:text-base">
                                                {mode === 'free' ? '자유롭게 이야기 나누세요.' : mode === 'layover' ? '레이오버 맛집, 관광지, 꿀팁을 공유하세요.' : '승무원 전용 할인/프로모션 정보를 확인하세요.'}
                                            </p>
                                        </div>
                                    </div>
                                    <button onClick={() => setShowModal(true)}
                                        className={`flex items-center gap-2 px-6 py-3 text-white rounded-xl font-bold transition-colors w-full sm:w-auto justify-center flex-shrink-0 ${mode === 'free' ? 'bg-blue-600 hover:bg-blue-700' : mode === 'layover' ? 'bg-green-600 hover:bg-green-700' : 'bg-purple-600 hover:bg-purple-700'}`}>
                                        <Plus size={20} /> 글쓰기
                                    </button>
                                </div>

                                {/* 검색 */}
                                <div className="mb-6">
                                    <div className="relative max-w-2xl">
                                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                                        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder="제목, 내용, 작성자 등으로 검색..."
                                            className="w-full pl-12 pr-4 py-3 rounded-xl border-2 border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none" />
                                    </div>
                                </div>

                                {(() => {
                                    const posts = mode === 'free' ? freePosts : mode === 'layover' ? layoverPosts : dealsPosts;
                                    const currentPage = mode === 'free' ? currentPageFree : mode === 'layover' ? currentPageLayover : currentPageDeals;
                                    const setPage = mode === 'free' ? setCurrentPageFree : mode === 'layover' ? setCurrentPageLayover : setCurrentPageDeals;
                                    const filtered = posts.filter(p => !searchQuery || (p.title||'').toLowerCase().includes(searchQuery.toLowerCase()) || (p.content||'').toLowerCase().includes(searchQuery.toLowerCase()));
                                    const paged = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
                                    const EmptyIcon = mode === 'free' ? MessageSquare : mode === 'layover' ? Plane : Tag;

                                    if (loading) return (
                                        <div className="py-20 text-center"><Loader2 size={48} className="mx-auto text-blue-500 animate-spin mb-4" /><p className="text-gray-500">불러오는 중...</p></div>
                                    );
                                    if (paged.length === 0) return (
                                        <div className="py-20 text-center bg-white rounded-3xl border border-dashed border-gray-200">
                                            <EmptyIcon size={48} className="mx-auto text-gray-300 mb-4" />
                                            <p className="text-gray-500 text-lg">아직 등록된 글이 없습니다.</p>
                                            <p className="text-gray-400 mt-1">첫 번째 글을 작성해보세요!</p>
                                        </div>
                                    );
                                    return (
                                        <>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                {paged.map((post) => (
                                                    <div key={post.id} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow relative">
                                                        <div className="absolute top-3 right-3">
                                                            <ReportButton postId={post.id} boardType="crew" reportedUserId={post.user_id} />
                                                        </div>
                                                        <h3 className="text-lg font-bold mb-2 pr-8">{post.title}</h3>
                                                        <p className="text-gray-600 text-sm mb-3 line-clamp-2">{post.content}</p>
                                                        <div className="flex items-center gap-4 text-xs text-gray-400">
                                                            <span>작성자: {post.author}</span>
                                                            <span>{new Date(post.created_at).toLocaleDateString('ko-KR')}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <Pagination currentPage={currentPage} totalPages={Math.ceil(filtered.length / itemsPerPage)} onPageChange={setPage} color="blue" />
                                        </>
                                    );
                                })()}
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
                                    {mode === 'info' ? '정보 공유하기' : '할인 정보 등록'}
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
                                        placeholder="제목을 입력하세요"
                                        required
                                    />
                                </div>

                                {mode === 'layover' && (
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">카테고리</label>
                                        <select
                                            value={formData.category}
                                            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                        >
                                            <option value="restaurant">맛집</option>
                                            <option value="sightseeing">관광지</option>
                                            <option value="hotel">숙소/호텔</option>
                                            <option value="transport">교통</option>
                                            <option value="tips">꿀팁</option>
                                            <option value="other">기타</option>
                                        </select>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">내용</label>
                                    <textarea
                                        value={formData.content}
                                        onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all resize-none"
                                        rows="6"
                                        placeholder="내용을 입력하세요"
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
            <LoginPrompt isOpen={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
        </section>
    );
};

export default CrewOnly;

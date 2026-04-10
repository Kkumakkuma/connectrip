import { useState, useEffect } from 'react';
import { MessageSquare, HelpCircle, Plus, X, Search, Loader2, Star, BookOpen, Trash2, User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Pagination from './Pagination';
import ReportButton from './ReportButton';
import ShareButtons from './ShareButtons';
import { useAuth } from '../lib/AuthContext';
import { qnaApi, reviewsApi } from '../lib/db';
import ImageUpload from './ImageUpload';
import LoginPrompt from './LoginPrompt';
import SEOHead from './SEOHead';

const TravelQnA = () => {
    const { user, profile, isLoggedIn } = useAuth();
    const [mode, setMode] = useState('main'); // 'main' | 'review' | 'qna'
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({ title: '', content: '', rating: '', image_url: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [posts, setPosts] = useState([]);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    const [loading, setLoading] = useState(false);
    const itemsPerPage = 6;

    const fetchQnA = async () => {
        setLoading(true);
        try {
            const data = await qnaApi.getAll();
            setPosts(data || []);
        } catch (err) {
            console.error('Q&A 로딩 실패:', err);
            setPosts([]);
        }
        setLoading(false);
    };

    const fetchReviews = async () => {
        setLoading(true);
        try {
            const data = await reviewsApi.getAll(null, 'review');
            setPosts(data || []);
        } catch (err) {
            console.error('후기 로딩 실패:', err);
            setPosts([]);
        }
        setLoading(false);
    };

    const handleModeSelect = (newMode) => {
        setMode(newMode);
        setCurrentPage(1);
        setSearchQuery('');
        if (newMode === 'qna') fetchQnA();
        if (newMode === 'review') fetchReviews();
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }

        try {
            if (mode === 'qna') {
                const newPost = await qnaApi.create({
                    title: formData.title,
                    content: formData.content,
                    author: profile?.name || '익명',
                    user_id: user.id,
                });
                setPosts(prev => [newPost, ...prev]);
            } else {
                const newReview = await reviewsApi.create({
                    user_id: user.id,
                    type: 'review',
                    title: formData.title,
                    description: formData.content,
                    rating: parseFloat(formData.rating) || null,
                    image_url: formData.image_url || null,
                    author_name: profile?.name || '익명',
                });
                setPosts(prev => [newReview, ...prev]);
            }
            setFormData({ title: '', content: '', rating: '', image_url: '' });
            setShowModal(false);
        } catch (err) {
            console.error('등록 실패:', err);
            alert('등록에 실패했습니다. 다시 시도해주세요.');
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('정말 삭제하시겠습니까?')) return;
        try {
            if (mode === 'qna') await qnaApi.delete(id);
            else await reviewsApi.delete(id);
            setPosts(prev => prev.filter(p => p.id !== id));
        } catch (err) {
            console.error('삭제 실패:', err);
        }
    };

    const handleWriteClick = () => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        setFormData({ title: '', content: '', rating: '', image_url: '' });
        setShowModal(true);
    };

    const filteredPosts = posts.filter(p => {
        const title = p.title || '';
        const content = p.content || p.description || '';
        const q = searchQuery.toLowerCase();
        return title.toLowerCase().includes(q) || content.toLowerCase().includes(q);
    });

    const totalPages = Math.ceil(filteredPosts.length / itemsPerPage);
    const paginatedPosts = filteredPosts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    return (
        <section id="qna" className="py-20 bg-gray-50">
            <SEOHead title="여행후기 및 Q&A - ConnecTrip" description="여행 후기를 공유하고, 여행 관련 질문과 답변을 나누세요." />
            <div className="container">
                <AnimatePresence mode="wait">
                    {/* 메인: 후기 vs Q&A 선택 */}
                    {mode === 'main' && (
                        <motion.div key="main" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                            <div className="flex flex-col items-center mb-16 text-center">
                                <span className="text-blue-600 font-bold tracking-widest uppercase mb-2">Reviews & Q&A</span>
                                <h2 className="text-4xl font-black mb-4">여행후기 및 Q&A</h2>
                                <p className="text-gray-500">후기를 공유하거나, 궁금한 것을 질문해보세요.</p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                                <motion.div whileHover={{ y: -10 }} onClick={() => handleModeSelect('review')}
                                    className="bg-white rounded-[2rem] p-10 shadow-xl cursor-pointer hover:shadow-2xl transition-all border border-transparent hover:border-green-100 group">
                                    <div className="w-20 h-20 bg-green-100 rounded-2xl flex items-center justify-center mb-6 text-green-600 group-hover:scale-110 transition-transform">
                                        <BookOpen size={40} />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-3">여행 후기</h3>
                                    <p className="text-gray-500 mb-6">직접 다녀온 여행의 생생한 경험담을 공유하고 다른 사람의 후기도 확인하세요.</p>
                                    <span className="text-green-600 font-bold flex items-center gap-2">후기 보러가기 →</span>
                                </motion.div>
                                <motion.div whileHover={{ y: -10 }} onClick={() => handleModeSelect('qna')}
                                    className="bg-white rounded-[2rem] p-10 shadow-xl cursor-pointer hover:shadow-2xl transition-all border border-transparent hover:border-blue-100 group">
                                    <div className="w-20 h-20 bg-blue-100 rounded-2xl flex items-center justify-center mb-6 text-blue-600 group-hover:scale-110 transition-transform">
                                        <HelpCircle size={40} />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-3">Q&A 게시판</h3>
                                    <p className="text-gray-500 mb-6">여행에 대한 궁금증을 전문가와 선배 여행자들에게 물어보세요.</p>
                                    <span className="text-blue-600 font-bold flex items-center gap-2">Q&A 보러가기 →</span>
                                </motion.div>
                            </div>
                        </motion.div>
                    )}

                    {/* 후기 / Q&A 게시글 목록 */}
                    {(mode === 'review' || mode === 'qna') && (
                        <motion.div key={mode} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                            <button onClick={() => { setMode('main'); setPosts([]); }}
                                className="flex items-center gap-2 text-gray-600 hover:text-blue-600 font-semibold mb-8 transition-colors">
                                ← 게시판 선택으로 돌아가기
                            </button>

                            <div className="flex flex-col items-center mb-8">
                                <span className={`${mode === 'review' ? 'text-green-600' : 'text-blue-600'} font-bold tracking-widest uppercase mb-2`}>
                                    {mode === 'review' ? 'Travel Reviews' : 'Q&A'}
                                </span>
                                <h2 className="text-3xl font-black mb-2">{mode === 'review' ? '여행 후기' : 'Q&A 게시판'}</h2>
                                <p className="text-gray-500 mb-6">
                                    {mode === 'review' ? '생생한 여행 경험을 공유해주세요.' : '궁금한 것을 질문하고 답변을 받아보세요.'}
                                </p>
                                <button onClick={handleWriteClick}
                                    className={`flex items-center gap-2 px-6 py-3 ${mode === 'review' ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'} text-white rounded-xl font-bold transition-colors`}>
                                    <Plus size={20} /> {mode === 'review' ? '후기 작성하기' : '질문하기'}
                                </button>
                            </div>

                            {/* 검색 */}
                            <div className="mb-8">
                                <div className="relative max-w-2xl mx-auto">
                                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                                    <input type="text" value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                                        placeholder="제목, 내용 등으로 검색하세요..."
                                        className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all text-gray-700 font-medium" />
                                </div>
                            </div>

                            {loading ? (
                                <div className="py-20 text-center">
                                    <Loader2 size={48} className="mx-auto text-blue-500 animate-spin mb-4" />
                                    <p className="text-gray-500 text-lg">로딩 중...</p>
                                </div>
                            ) : paginatedPosts.length > 0 ? (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                        {paginatedPosts.map((post) => (
                                            <div key={post.id} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow relative">
                                                <div className="absolute top-3 right-3 flex items-center gap-1">
                                                    {user?.id === post.user_id && (
                                                        <button onClick={() => handleDelete(post.id)} className="p-1 text-red-400 hover:text-red-600 transition-colors"><Trash2 size={16} /></button>
                                                    )}
                                                    <ReportButton postId={post.id} boardType={mode === 'qna' ? 'qna' : 'review'} reportedUserId={post.user_id} />
                                                </div>

                                                {/* 후기 이미지 */}
                                                {mode === 'review' && post.image_url && (
                                                    <div className="h-40 rounded-xl overflow-hidden mb-4 -mx-2 -mt-2">
                                                        <img src={post.image_url} alt={post.title} className="w-full h-full object-cover" />
                                                    </div>
                                                )}

                                                <div className="flex items-start gap-4">
                                                    <div className={`${mode === 'review' ? 'bg-green-50 text-green-500' : 'bg-blue-50 text-blue-500'} p-3 rounded-full flex-shrink-0`}>
                                                        {mode === 'review' ? <BookOpen size={24} /> : <HelpCircle size={24} />}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <h3 className="text-lg font-bold truncate">{post.title}</h3>
                                                            {mode === 'review' && post.rating && (
                                                                <span className="flex items-center gap-1 text-sm text-yellow-500 font-bold flex-shrink-0">
                                                                    <Star size={14} className="fill-yellow-400" /> {post.rating}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-gray-600 text-sm mb-4 line-clamp-2">{post.content || post.description}</p>
                                                        <div className="flex items-center gap-3 text-xs text-gray-400">
                                                            {mode === 'qna' && (
                                                                <span className="flex items-center gap-1"><MessageSquare size={14} /> 댓글 {post.qna_comments?.length || 0}개</span>
                                                            )}
                                                            <span className="flex items-center gap-1"><User size={12} /> {post.author || post.author_name || post.profiles?.name || '익명'}</span>
                                                            <span>{new Date(post.created_at).toLocaleDateString('ko-KR')}</span>
                                                            <ShareButtons title={post.title} description={post.content || post.description} />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} color={mode === 'review' ? 'green' : 'blue'} />
                                </>
                            ) : (
                                <div className="py-20 text-center bg-white rounded-3xl border border-dashed border-gray-200">
                                    {mode === 'review' ? <BookOpen size={48} className="mx-auto text-gray-300 mb-4" /> : <HelpCircle size={48} className="mx-auto text-gray-300 mb-4" />}
                                    <p className="text-gray-500 text-lg">{mode === 'review' ? '아직 등록된 후기가 없습니다.' : '아직 등록된 질문이 없습니다.'}</p>
                                    <p className="text-gray-400 mt-1">{mode === 'review' ? '첫 번째 후기를 작성해보세요!' : '첫 번째 질문을 작성해보세요!'}</p>
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* 글 작성 모달 */}
            <AnimatePresence>
                {showModal && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
                        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                            onClick={(e) => e.stopPropagation()} className="bg-white sm:rounded-3xl p-6 sm:p-8 max-w-2xl w-full h-full sm:h-auto max-h-screen sm:max-h-[90vh] overflow-y-auto shadow-2xl">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-xl sm:text-2xl font-bold">{mode === 'review' ? '여행 후기 작성' : '새 질문 작성'}</h3>
                                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X size={24} /></button>
                            </div>
                            <form onSubmit={handleSubmit} className="space-y-6">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">제목</label>
                                    <input type="text" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                        placeholder={mode === 'review' ? '예: 도쿄 3박 4일 완벽 후기' : '궁금한 내용을 간단히 요약해주세요'} required />
                                </div>
                                {mode === 'review' && (
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">평점 (선택)</label>
                                        <input type="number" step="0.1" min="0" max="5" value={formData.rating}
                                            onChange={(e) => setFormData({ ...formData, rating: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                            placeholder="예: 4.5" />
                                    </div>
                                )}
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">{mode === 'review' ? '후기 내용' : '질문 내용'}</label>
                                    <textarea value={formData.content} onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all resize-none" rows="8"
                                        placeholder={mode === 'review' ? '여행 경험을 자세히 공유해주세요' : '자세한 질문 내용을 작성해주세요'} required />
                                </div>
                                {mode === 'review' && (
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">이미지 (선택)</label>
                                        <ImageUpload onUpload={(url) => setFormData({ ...formData, image_url: url })} />
                                        {formData.image_url && <img src={formData.image_url} alt="미리보기" className="mt-2 h-32 rounded-xl object-cover" />}
                                    </div>
                                )}
                                <div className="flex gap-3 pt-4">
                                    <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-6 py-3 rounded-xl border border-gray-200 font-bold text-gray-700 hover:bg-gray-50 transition-colors">취소</button>
                                    <button type="submit" className="flex-1 btn-primary">등록하기</button>
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

export default TravelQnA;

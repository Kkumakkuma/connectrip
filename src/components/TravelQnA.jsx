import { useState, useEffect, useRef, useId } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageSquare, HelpCircle, Plus, X, Search, BookOpen, Trash2, User, Heart, Lock, CornerDownRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Pagination from './Pagination';
import ReportButton from './ReportButton';
import ShareButtons from './ShareButtons';
import CrewBadge from './CrewBadge';
import { useAuth } from '../lib/AuthContext';
import { qnaApi, reviewsApi, postLikeApi } from '../lib/db';
import { useBlockedIds, filterBlocked } from '../lib/useBlockedIds';
import { replyTargetLabel } from '../lib/flightBoard';
import ImageUpload from './ImageUpload';
import LoginPrompt from './LoginPrompt';
import SEOHead from './SEOHead';
import ListState from './ListState';

// 후기 지역 — 지역별 후기 목록(/reviews/:regionId, Promotions.jsx)과 같은 id·이름·순서.
// 여기서 region_id 를 넣지 않으면 이 화면에서 쓴 후기가 지역 목록에 잡히지 않는다.
const reviewRegions = [
    { id: 'europe', name: '유럽', icon: '🏰' },
    { id: 'americas', name: '미주', icon: '🗽' },
    { id: 'africa', name: '아프리카', icon: '🦁' },
    { id: 'southeast-asia', name: '동남아', icon: '🏝️' },
    { id: 'asia', name: '아시아', icon: '🐅' },
    { id: 'oceania', name: '오세아니아', icon: '🦘' },
];

// 클릭으로만 열리던 카드에 키보드 조작(Enter/Space)을 붙인다.
// 라우트 이동이 아니라 화면 안 모드 전환이라 Link 대신 button 역할로 처리한다.
const keyActivate = (fn) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fn();
    }
};

const TravelQnA = () => {
    const { user, profile, isLoggedIn } = useAuth();
    const blockedIds = useBlockedIds();
    const [mode, setMode] = useState('main'); // 'main' | 'review' | 'qna'
    const location = useLocation();

    // 네비 드롭다운 ?tab=(review/qna) 반영 + 상위 메뉴 클릭 시 메인 복귀
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const tab = params.get('tab');
        if (tab && ['review', 'qna'].includes(tab)) setMode(tab);
        else setMode('main');
        const q = params.get('q');
        if (q) setSearchQuery(q);
    }, [location]);
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({ title: '', content: '', image_url: '', region_id: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [posts, setPosts] = useState([]);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [expandedId, setExpandedId] = useState(null);
    const [commentText, setCommentText] = useState('');
    const [commentBusy, setCommentBusy] = useState(false);
    const [commentPrivate, setCommentPrivate] = useState(false); // 비밀댓글: 글쓴이·나·답글 대상만 본다(서버 정책)
    const [replyTo, setReplyTo] = useState(null);                  // { id, name } 답글 대상 댓글
    // 댓글은 목록 조회에 딸려오지 않고, 카드를 펼칠 때 그 글 것만 따로 받아온다.
    const [comments, setComments] = useState({}); // { [postId]: 댓글 배열 }
    const [commentsLoading, setCommentsLoading] = useState(false);
    const [likes, setLikes] = useState({});
    const [submitting, setSubmitting] = useState(false); // 등록 버튼 중복 제출 방지
    const itemsPerPage = 6;
    const formId = useId(); // label-input 연결용 접두사
    // 모드를 빠르게 전환하면 두 조회가 겹친다. 늦게 도착한 이전 응답이 새 모드의
    // 목록을 덮어쓰지 않도록 요청 id 로 stale 응답을 버린다(Search.jsx 와 동일 방식).
    const requestIdRef = useRef(0);

    const fetchQnA = async () => {
        const reqId = ++requestIdRef.current;
        try {
            setLoading(true);
            setError(null);
            const data = await qnaApi.getAll();
            if (reqId !== requestIdRef.current) return;
            setPosts(data || []);
            if (data?.length) {
                const m = await postLikeApi.getForBoard('qna_posts', data.map((p) => p.id), user?.id);
                if (reqId !== requestIdRef.current) return;
                setLikes((prev) => ({ ...prev, ...m }));
            }
        } catch (err) {
            if (reqId !== requestIdRef.current) return;
            console.error('Q&A 로딩 실패:', err);
            setPosts([]);
            setError('목록을 불러오지 못했습니다. 다시 시도해주세요.');
        } finally {
            if (reqId === requestIdRef.current) setLoading(false);
        }
    };

    const fetchReviews = async () => {
        const reqId = ++requestIdRef.current;
        try {
            setLoading(true);
            setError(null);
            const data = await reviewsApi.getAll(null, 'review');
            if (reqId !== requestIdRef.current) return;
            setPosts(data || []);
            if (data?.length) {
                const m = await postLikeApi.getForBoard('reviews', data.map((p) => p.id), user?.id);
                if (reqId !== requestIdRef.current) return;
                setLikes((prev) => ({ ...prev, ...m }));
            }
        } catch (err) {
            if (reqId !== requestIdRef.current) return;
            console.error('후기 로딩 실패:', err);
            setPosts([]);
            setError('목록을 불러오지 못했습니다. 다시 시도해주세요.');
        } finally {
            if (reqId === requestIdRef.current) setLoading(false);
        }
    };

    const refetch = () => {
        if (mode === 'qna') fetchQnA();
        else if (mode === 'review') fetchReviews();
    };

    // 모드 진입 시 데이터 로드 — 버튼 클릭 전환뿐 아니라 네비 드롭다운/직접 URL(?tab=) 진입도 커버
    useEffect(() => {
        // 모드가 바뀌면 펼쳐둔 댓글과 그 캐시도 버린다(다른 목록의 잔상 방지).
        setExpandedId(null);
        setComments({});
        if (mode === 'qna') fetchQnA();
        else if (mode === 'review') fetchReviews();
        else { requestIdRef.current += 1; setPosts([]); } // 메인 복귀: 진행 중 조회 무효화
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode]);

    // 카드를 펼칠 때 그 글의 댓글만 조회한다. 한 번 받아온 글은 다시 부르지 않는다.
    const handleToggleComments = async (postId) => {
        setCommentText('');
        setCommentPrivate(false);
        setReplyTo(null);
        if (expandedId === postId) { setExpandedId(null); return; }
        setExpandedId(postId);
        if (comments[postId]) return;
        try {
            setCommentsLoading(true);
            const list = await qnaApi.getComments(postId);
            setComments((prev) => ({ ...prev, [postId]: list || [] }));
        } catch (err) {
            console.error('댓글 조회 실패:', err);
            setComments((prev) => ({ ...prev, [postId]: [] }));
        } finally {
            setCommentsLoading(false);
        }
    };

    const handleToggleLike = async (postId) => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        const board = mode === 'review' ? 'reviews' : 'qna_posts';
        try {
            const { data, error: e } = await postLikeApi.toggle(board, postId);
            if (e) throw e;
            setLikes((prev) => ({ ...prev, [postId]: { count: data.likes_count, liked: data.liked } }));
        } catch (err) {
            console.error('좋아요 실패:', err);
            alert(err?.message?.includes('phone') ? '휴대폰 인증 후 좋아요할 수 있어요.' : '좋아요 처리에 실패했습니다.');
        }
    };

    const handleAddComment = async (postId) => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        const text = commentText.trim();
        if (!text || commentBusy) return;
        try {
            setCommentBusy(true);
            const newComment = await qnaApi.addComment({
                post_id: postId,
                user_id: user.id,
                author_name: profile?.name || '익명',
                content: text,
                is_private: commentPrivate || !!replyTo?.isPrivate,
                parent_id: replyTo?.id || null,
            });
            setComments((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), newComment] }));
            // 목록 카드에 보이는 댓글 수도 같이 올린다(목록은 comment_count 만 들고 있다).
            setPosts((prev) => prev.map((p) => p.id === postId
                ? { ...p, comment_count: (p.comment_count || 0) + 1 }
                : p));
            setCommentText('');
            setCommentPrivate(false);
            setReplyTo(null);
        } catch (err) {
            console.error('댓글 등록 실패:', err);
        } finally {
            setCommentBusy(false);
        }
    };

    const handleModeSelect = (newMode) => {
        setMode(newMode);
        setCurrentPage(1);
        setSearchQuery('');
        // 데이터 로드는 [mode] useEffect가 담당 (중복 fetch 방지)
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        // 조기 return 을 모두 지난 뒤에 플래그를 세운다(먼저 세우면 버튼이 영구히 잠긴다).
        if (submitting) return;
        setSubmitting(true);
        try {
            if (mode === 'qna') {
                const newPost = await qnaApi.create({
                    title: formData.title,
                    content: formData.content,
                    author_name: profile?.name || '익명',
                    user_id: user.id,
                });
                setPosts(prev => [newPost, ...prev]);
            } else {
                const newReview = await reviewsApi.create({
                    user_id: user.id,
                    type: 'review',
                    // region_id 가 있어야 /reviews/:regionId 지역 목록에 함께 노출된다
                    region_id: formData.region_id || null,
                    title: formData.title,
                    description: formData.content,
                    image_url: formData.image_url || null,
                    author_name: profile?.name || '익명',
                });
                setPosts(prev => [newReview, ...prev]);
            }
            setFormData({ title: '', content: '', image_url: '', region_id: '' });
            setShowModal(false);
        } catch (err) {
            console.error('등록 실패:', err);
            alert('등록에 실패했습니다. 다시 시도해주세요.');
        } finally {
            setSubmitting(false);
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
            alert('삭제에 실패했습니다. 다시 시도해주세요.');
        }
    };

    const handleWriteClick = () => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        setFormData({ title: '', content: '', image_url: '', region_id: '' });
        setShowModal(true);
    };

    const filteredPosts = posts.filter(p => {
        const title = p.title || '';
        const content = p.content || p.description || '';
        const q = searchQuery.toLowerCase();
        return title.toLowerCase().includes(q) || content.toLowerCase().includes(q);
    });

    const visiblePosts = filterBlocked(filteredPosts, blockedIds);
    const totalPages = Math.ceil(visiblePosts.length / itemsPerPage);
    const paginatedPosts = visiblePosts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    return (
        <section id="qna" className="py-20 bg-gray-50">
            <SEOHead title="여행후기 및 Q&A - ConnectTrip" description="여행 후기를 공유하고, 여행 관련 질문과 답변을 나누세요." />
            <div className="container">
                <AnimatePresence mode="wait">
                    {/* 메인: 후기 vs Q&A 선택 */}
                    {mode === 'main' && (
                        <motion.div key="main" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                            <div className="flex flex-col items-center mb-16 text-center">
                                <span className="text-blue-600 font-bold tracking-widest uppercase mb-2">Reviews & Q&A</span>
                                {/* 페이지 최상위 제목이라 h1 — 하위 모드 제목은 h2 로 유지한다 */}
                                <h1 className="text-4xl font-black mb-4">여행후기 및 Q&A</h1>
                                <p className="text-gray-500">후기를 공유하거나, 궁금한 것을 질문해보세요.</p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                                <motion.div whileHover={{ y: -10 }} onClick={() => handleModeSelect('review')}
                                    onKeyDown={keyActivate(() => handleModeSelect('review'))} role="button" tabIndex={0}
                                    className="bg-white rounded-[2rem] p-10 shadow-xl cursor-pointer hover:shadow-2xl transition-all border-2 border-green-400 hover:border-green-500 group">
                                    <div className="w-20 h-20 bg-green-100 rounded-2xl flex items-center justify-center mb-6 text-green-600 group-hover:scale-110 transition-transform">
                                        <BookOpen size={40} />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-3">여행 후기</h3>
                                    <p className="text-gray-500 mb-6">직접 다녀온 여행의 생생한 경험담을 공유하고 다른 사람의 후기도 확인하세요.</p>
                                    <span className="text-green-600 font-bold flex items-center gap-2">후기 보러가기 →</span>
                                </motion.div>
                                <motion.div whileHover={{ y: -10 }} onClick={() => handleModeSelect('qna')}
                                    onKeyDown={keyActivate(() => handleModeSelect('qna'))} role="button" tabIndex={0}
                                    className="bg-white rounded-[2rem] p-10 shadow-xl cursor-pointer hover:shadow-2xl transition-all border-2 border-blue-400 hover:border-blue-500 group">
                                    <div className="w-20 h-20 bg-blue-100 rounded-2xl flex items-center justify-center mb-6 text-blue-600 group-hover:scale-110 transition-transform">
                                        <HelpCircle size={40} />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-3">Q&A 게시판</h3>
                                    <p className="text-gray-500 mb-6">여행에 대한 궁금증을 승무원과 선배 여행자들에게 물어보세요.</p>
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

                            {loading || error ? (
                                <ListState loading={loading} error={error} onRetry={refetch} color={mode === 'review' ? 'green' : 'blue'} loadingText="로딩 중..." />
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
                                                        <img src={post.image_url} alt={post.title} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                                                    </div>
                                                )}

                                                <div className="flex items-start gap-4">
                                                    <div className={`${mode === 'review' ? 'bg-green-50 text-green-500' : 'bg-blue-50 text-blue-500'} p-3 rounded-full flex-shrink-0`}>
                                                        {mode === 'review' ? <BookOpen size={24} /> : <HelpCircle size={24} />}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <h3 className="text-lg font-bold truncate">{post.title}</h3>
                                                            <button onClick={() => handleToggleLike(post.id)} className={`flex items-center gap-1 text-sm font-bold flex-shrink-0 transition-colors ${likes[post.id]?.liked ? 'text-pink-500' : 'text-gray-400 hover:text-pink-500'}`}>
                                                                <Heart size={15} fill={likes[post.id]?.liked ? 'currentColor' : 'none'} /> {likes[post.id]?.count || 0}
                                                            </button>
                                                        </div>
                                                        <p className="text-gray-600 text-sm mb-4 line-clamp-2">{post.content || post.description}</p>
                                                        {/* 작성자+배지는 별도 행 — 메타줄(댓글/날짜/공유)에 끼우면 3열 카드에서 이름이 0px 로 붕괴 */}
                                                        <div className="flex items-center gap-1 text-xs text-gray-400 min-w-0 mb-1.5">
                                                            <User size={12} className="flex-shrink-0" />
                                                            <span className="truncate">{post.author_name || post.profiles?.name || '익명'}</span>
                                                            <CrewBadge profile={post.profiles} />
                                                        </div>
                                                        <div className="flex items-center gap-2 text-xs text-gray-400 flex-nowrap overflow-hidden">
                                                            {mode === 'qna' && (
                                                                <button onClick={() => handleToggleComments(post.id)} className="flex items-center gap-1 hover:text-blue-500 transition-colors">
                                                                    {/* 목록은 댓글 본문 없이 개수만 들고 온다 */}
                                                                    <MessageSquare size={14} /> 댓글 {post.comment_count ?? post.qna_comments?.length ?? 0}개
                                                                </button>
                                                            )}
                                                            <span className="flex-1" />
                                                            <span className="whitespace-nowrap flex-shrink-0">{new Date(post.created_at).toLocaleDateString('ko-KR')}</span>
                                                            <ShareButtons title={post.title} description={post.content || post.description} />
                                                        </div>
                                                    </div>
                                                </div>
                                                {mode === 'qna' && expandedId === post.id && (
                                                    <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                                                        {commentsLoading && !comments[post.id] ? (
                                                            <p className="text-sm text-gray-400 text-center py-2">댓글을 불러오는 중...</p>
                                                        ) : (comments[post.id] || []).length > 0 ? (
                                                            [...comments[post.id]].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map((c) => (
                                                                <div key={c.id} className={`rounded-xl p-3 ${c.is_private ? 'bg-amber-50' : 'bg-gray-50'}`}>
                                                                    <div className="flex items-center justify-between mb-1 gap-2">
                                                                        <span className="flex items-center gap-1 min-w-0 text-xs font-bold text-gray-700">
                                                                            <span className="truncate">{c.author_name || '익명'}</span>
                                                                            <CrewBadge profile={c.profiles} />
                                                                            {c.is_private && <Lock size={11} className="text-amber-500 flex-shrink-0" aria-label="비밀댓글" />}
                                                                        </span>
                                                                        <span className="flex items-center gap-2 text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                                                                            {new Date(c.created_at).toLocaleDateString('ko-KR')}
                                                                            {isLoggedIn && (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => { setReplyTo({ id: c.id, name: c.author_name || '익명', isPrivate: !!c.is_private }); if (c.is_private) setCommentPrivate(true); }}
                                                                                    className="font-bold text-blue-500 hover:text-blue-600"
                                                                                >답글</button>
                                                                            )}
                                                                        </span>
                                                                    </div>
                                                                    {replyTargetLabel(c, comments[post.id]) && (
                                                                        <p className="text-[11px] text-gray-400 mb-0.5 flex items-center gap-1">
                                                                            <CornerDownRight size={11} />{replyTargetLabel(c, comments[post.id])}에게
                                                                        </p>
                                                                    )}
                                                                    <p className="text-sm text-gray-600 whitespace-pre-wrap">{c.content}</p>
                                                                </div>
                                                            ))
                                                        ) : (
                                                            <p className="text-sm text-gray-400 text-center py-2">첫 댓글을 남겨보세요.</p>
                                                        )}
                                                        {replyTo && (
                                                            <div className="flex items-center gap-1.5 text-xs text-gray-500">
                                                                <CornerDownRight size={12} />
                                                                <span><strong>{replyTo.name}</strong>에게 답글</span>
                                                                <button type="button" onClick={() => setReplyTo(null)} className="text-gray-400 hover:text-gray-600" aria-label="답글 취소"><X size={12} /></button>
                                                            </div>
                                                        )}
                                                        <div className="flex gap-2">
                                                            <input
                                                                type="text"
                                                                value={expandedId === post.id ? commentText : ''}
                                                                onChange={(e) => setCommentText(e.target.value)}
                                                                onKeyDown={(e) => { if (e.key !== 'Enter' || e.nativeEvent?.isComposing) return; e.preventDefault(); handleAddComment(post.id); }}
                                                                placeholder="댓글을 입력하세요"
                                                                className="flex-1 px-3 py-2 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none text-sm"
                                                            />
                                                            <button
                                                                onClick={() => handleAddComment(post.id)}
                                                                disabled={commentBusy}
                                                                className="px-4 py-2 bg-blue-500 text-white rounded-xl text-sm font-bold hover:bg-blue-600 disabled:opacity-50 transition-colors flex-shrink-0"
                                                            >등록</button>
                                                        </div>
                                                        <label className="flex items-center gap-1.5 text-xs text-gray-500 select-none cursor-pointer">
                                                            <input type="checkbox" checked={commentPrivate || !!replyTo?.isPrivate} disabled={!!replyTo?.isPrivate} onChange={(e) => setCommentPrivate(e.target.checked)} />
                                                            <Lock size={11} className="text-amber-500" />
                                                            비밀댓글
                                                        </label>
                                                    </div>
                                                )}
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
                                    {isLoggedIn && (
                                        <button onClick={handleWriteClick} className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors">
                                            <Plus size={18} /> {mode === 'review' ? '후기 작성하기' : '질문 작성하기'}
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
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
                        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                            onClick={(e) => e.stopPropagation()} className="bg-white sm:rounded-3xl p-6 sm:p-8 max-w-2xl w-full h-full sm:h-auto max-h-screen sm:max-h-[90vh] overflow-y-auto shadow-2xl">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-xl sm:text-2xl font-bold">{mode === 'review' ? '여행 후기 작성' : '새 질문 작성'}</h3>
                                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors" aria-label="닫기"><X size={24} aria-hidden="true" /></button>
                            </div>
                            <form onSubmit={handleSubmit} className="space-y-6">
                                {mode === 'review' && (
                                    <div>
                                        <label htmlFor={`${formId}-region`} className="block text-sm font-bold text-gray-700 mb-2">지역</label>
                                        <select
                                            id={`${formId}-region`}
                                            value={formData.region_id}
                                            onChange={(e) => setFormData({ ...formData, region_id: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all bg-white"
                                            required
                                        >
                                            <option value="" disabled>지역을 선택하세요</option>
                                            {reviewRegions.map((r) => (
                                                <option key={r.id} value={r.id}>{r.icon} {r.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                                <div>
                                    <label htmlFor={`${formId}-title`} className="block text-sm font-bold text-gray-700 mb-2">제목</label>
                                    <input id={`${formId}-title`} type="text" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                        placeholder={mode === 'review' ? '예: 도쿄 3박 4일 완벽 후기' : '궁금한 내용을 간단히 요약해주세요'} required />
                                </div>
                                <div>
                                    <label htmlFor={`${formId}-content`} className="block text-sm font-bold text-gray-700 mb-2">{mode === 'review' ? '후기 내용' : '질문 내용'}</label>
                                    <textarea id={`${formId}-content`} value={formData.content} onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all resize-none" rows="8"
                                        placeholder={mode === 'review' ? '여행 경험을 자세히 공유해주세요' : '자세한 질문 내용을 작성해주세요'} required />
                                </div>
                                {mode === 'review' && (
                                    <div>
                                        {/* ImageUpload 가 자체 label 을 가지고 있어, 바깥 문구는 label 이 아닌 제목으로 둔다 */}
                                        <span className="block text-sm font-bold text-gray-700 mb-2">이미지 (선택)</span>
                                        <ImageUpload onUpload={(url) => setFormData({ ...formData, image_url: url })} />
                                        {formData.image_url && <img src={formData.image_url} alt="미리보기" loading="lazy" decoding="async" className="mt-2 h-32 rounded-xl object-cover" />}
                                    </div>
                                )}
                                <div className="flex gap-3 pt-4">
                                    <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-6 py-3 rounded-xl border border-gray-200 font-bold text-gray-700 hover:bg-gray-50 transition-colors">취소</button>
                                    <button
                                        type="submit"
                                        disabled={submitting}
                                        className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {submitting ? '등록 중...' : '등록하기'}
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

export default TravelQnA;

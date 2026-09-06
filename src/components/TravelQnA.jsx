import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MessageSquare, HelpCircle, Plus, X, BookOpen, Trash2, Heart, Lock, CornerDownRight, ChevronDown } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { qnaApi, reviewsApi, postLikeApi } from '../lib/db';
import { replyTargetLabel } from '../lib/flightBoard';
import { regionFromSearch, continentOf } from '../lib/continents';
import BoardShell from './board/BoardShell';
import BoardTabs from './board/BoardTabs';
import ContinentBar from './board/ContinentBar';
import ContinentBadge from './board/ContinentBadge';
import ContinentPicker from './board/ContinentPicker';
import SearchPill from './board/SearchPill';
import WriteModal from './board/WriteModal';
import Pagination from './Pagination';
import ListState from './ListState';
import ReportButton from './ReportButton';
import ShareButtons from './ShareButtons';
import CrewBadge from './CrewBadge';
import AuthorActions from './AuthorActions';
import ImageUpload from './ImageUpload';
import LoginPrompt from './LoginPrompt';
import SEOHead from './SEOHead';

const TABS = [
    { id: 'review', label: '여행 후기', icon: BookOpen },
    { id: 'qna', label: 'Q&A', icon: HelpCircle },
];
const PAGE_REVIEW = 12;
const PAGE_QNA = 10;
const EMPTY_FORM = { title: '', content: '', image_url: '', region_id: '' };

// 여행후기 및 Q&A(2026-09-07 에어비앤비 톤). 탭: 후기(대륙 말머리 필수, 카드) / Q&A(행 + 댓글).
// ?tab=review|qna, 후기는 ?region= 으로 대륙 필터.
const TravelQnA = () => {
    const { user, profile, isLoggedIn } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get('tab');
    const mode = tabParam === 'qna' ? 'qna' : 'review';
    const region = regionFromSearch(searchParams.toString());
    const q = searchParams.get('q') || '';
    const [qInput, setQInput] = useState(q);
    const [page, setPage] = useState(1);
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [likes, setLikes] = useState({});
    const [showModal, setShowModal] = useState(false);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [pickerError, setPickerError] = useState('');
    // 댓글(Q&A): 카드를 펼칠 때 그 글 것만 받아온다
    const [expandedId, setExpandedId] = useState(null);
    const [comments, setComments] = useState({});
    const [commentsLoading, setCommentsLoading] = useState(false);
    const [commentText, setCommentText] = useState('');
    const [commentBusy, setCommentBusy] = useState(false);
    const [commentPrivate, setCommentPrivate] = useState(false);
    const [replyTo, setReplyTo] = useState(null);
    const formId = useId();
    const reqRef = useRef(0);
    const likeTouchedRef = useRef(new Set());   // 목록 조회 중 사용자가 누른 좋아요는 늦게 온 응답으로 덮지 않는다

    useEffect(() => {
        const t = setTimeout(() => {
            if (qInput.trim() === q) return;
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (qInput.trim()) next.set('q', qInput.trim()); else next.delete('q');
                return next;
            }, { replace: true });
        }, 300);
        return () => clearTimeout(t);
    }, [qInput, q, setSearchParams]);
    // 뒤로가기·외부 링크로 URL 의 q 가 바뀌면 입력값도 맞춘다(입력 중이면 건드리지 않음)
    useEffect(() => { setQInput((cur) => (cur.trim() === q ? cur : q)); }, [q]);

    const setTab = (id) => {
        setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set('tab', id); n.delete('q'); return n; });
        setQInput(''); setPage(1); setExpandedId(null);
    };
    const setRegion = (id) => {
        setSearchParams((prev) => { const n = new URLSearchParams(prev); if (id) n.set('region', id); else n.delete('region'); return n; });
        setPage(1);
    };

    const load = useCallback(async () => {
        const reqId = ++reqRef.current;
        try {
            setLoading(true); setError(null);
            const data = mode === 'qna' ? await qnaApi.getAll() : await reviewsApi.getAll(region, 'review');
            if (reqId !== reqRef.current) return;
            setPosts(data || []);
            if (data?.length) {
                const m = await postLikeApi.getForBoard(mode === 'qna' ? 'qna_posts' : 'reviews', data.map((p) => p.id), user?.id);
                if (reqId !== reqRef.current) return;
                setLikes((prev) => { const next = { ...prev, ...m }; likeTouchedRef.current.forEach((id) => { if (prev[id]) next[id] = prev[id]; }); likeTouchedRef.current.clear(); return next; });
            }
        } catch (err) {
            if (reqId !== reqRef.current) return;
            console.error('목록 로딩 실패:', err);
            setPosts([]);
            setError('목록을 불러오지 못했습니다. 다시 시도해주세요.');
        } finally {
            if (reqId === reqRef.current) setLoading(false);
        }
    }, [mode, region, user?.id]);

    useEffect(() => { setExpandedId(null); setComments({}); load(); }, [load]);
    useEffect(() => { setPage(1); }, [q, region, mode]);

    const toggleComments = async (postId) => {
        setCommentText(''); setCommentPrivate(false); setReplyTo(null);
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

    const toggleLike = async (postId) => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        try {
            const { data, error: e } = await postLikeApi.toggle(mode === 'review' ? 'reviews' : 'qna_posts', postId);
            if (e) throw e;
            likeTouchedRef.current.add(postId);
            setLikes((prev) => ({ ...prev, [postId]: { count: data.likes_count, liked: data.liked } }));
        } catch (err) {
            console.error('좋아요 실패:', err);
            alert(err?.message?.includes('phone') ? '휴대폰 인증 후 좋아요할 수 있어요.' : '좋아요 처리에 실패했습니다.');
        }
    };

    const addComment = async (postId) => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        const text = commentText.trim();
        if (!text || commentBusy) return;
        try {
            setCommentBusy(true);
            const created = await qnaApi.addComment({
                post_id: postId, user_id: user.id, author_name: profile?.name || '익명', content: text,
                is_private: commentPrivate || !!replyTo?.isPrivate, parent_id: replyTo?.id || null,
            });
            setComments((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), created] }));
            setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, comment_count: (p.comment_count || 0) + 1 } : p)));
            setCommentText(''); setCommentPrivate(false); setReplyTo(null);
        } catch (err) {
            console.error('댓글 등록 실패:', err);
        } finally {
            setCommentBusy(false);
        }
    };

    const openWrite = () => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        setPickerError('');
        setForm({ ...EMPTY_FORM, region_id: mode === 'review' ? (region || '') : '' });
        setShowModal(true);
    };

    const submit = async (e) => {
        e.preventDefault();
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        if (submitting || uploading) return;
        if (mode === 'review' && !continentOf(form.region_id)) { setPickerError('말머리를 선택해 주세요.'); return; }
        setSubmitting(true);
        try {
            let created;
            if (mode === 'qna') {
                created = await qnaApi.create({ title: form.title.trim(), content: form.content.trim(), author_name: profile?.name || '익명', user_id: user.id });
            } else {
                created = await reviewsApi.create({
                    user_id: user.id, type: 'review', region_id: form.region_id,
                    title: form.title.trim(), description: form.content.trim(), image_url: form.image_url || null,
                    author_name: profile?.name || '익명',
                });
            }
            if (mode === 'review' && region && region !== created.region_id) { setRegion(created.region_id); }
            else { setPosts((prev) => [created, ...prev]); setPage(1); }
            setShowModal(false);
        } catch (err) {
            console.error('등록 실패:', err);
            alert('등록에 실패했습니다. 다시 시도해주세요.');
        } finally {
            setSubmitting(false);
        }
    };

    const remove = async (id) => {
        if (!window.confirm('이 글을 삭제할까요?')) return;
        try {
            if (mode === 'qna') await qnaApi.delete(id); else await reviewsApi.delete(id);
            setPosts((prev) => prev.filter((p) => p.id !== id));
        } catch (err) {
            console.error('삭제 실패:', err);
            alert('삭제에 실패했습니다. 다시 시도해주세요.');
        }
    };

    const ql = q.toLowerCase();
    const filtered = posts.filter((p) => !ql || (p.title || '').toLowerCase().includes(ql) || (p.content || p.description || '').toLowerCase().includes(ql));
    const perPage = mode === 'review' ? PAGE_REVIEW : PAGE_QNA;
    const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
    const paged = filtered.slice((page - 1) * perPage, page * perPage);
    useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);   // 마지막 글 삭제로 빈 페이지에 고립되지 않게

    const cardActions = (post) => (
        <span className="flex items-center gap-0.5 flex-shrink-0">
            <ShareButtons title={post.title} description={post.content || post.description} />
            {user?.id === post.user_id ? (
                <button type="button" onClick={() => remove(post.id)} aria-label="삭제" className="p-1.5 rounded-full text-muted hover:text-error hover:bg-surface-soft"><Trash2 size={14} /></button>
            ) : (
                <ReportButton postId={post.id} boardType={mode === 'qna' ? 'qna' : 'review'} reportedUserId={post.user_id} />
            )}
        </span>
    );

    return (
        <>
            <SEOHead title="여행후기 및 Q&A - ConnectTrip" description="여행 후기를 공유하고, 여행 관련 질문과 답변을 나누세요." path="/qna" />
            <BoardShell
                id="qna"
                title="여행후기 및 Q&A"
                action={<button type="button" onClick={openWrite} className="btn-air-primary"><Plus size={16} /> {mode === 'review' ? '후기 쓰기' : '질문하기'}</button>}
                tabs={<BoardTabs items={TABS} value={mode} onChange={setTab} />}
                bar={mode === 'review' ? <ContinentBar value={region} onChange={setRegion} /> : null}
                search={<SearchPill value={qInput} onChange={setQInput} placeholder="제목, 내용 검색" className="max-w-md" />}
            >
                {loading || error ? (
                    <ListState loading={loading} error={error} onRetry={load} color="ink" loadingText="불러오는 중..." />
                ) : paged.length === 0 ? (
                    <ListState
                        empty
                        emptyIcon={mode === 'review' ? <BookOpen size={36} className="mx-auto text-muted-soft mb-3" /> : <HelpCircle size={36} className="mx-auto text-muted-soft mb-3" />}
                        emptyTitle={q ? '검색 결과가 없습니다.' : mode === 'review' ? '등록된 후기가 없습니다.' : '등록된 질문이 없습니다.'}
                        emptyDesc={null}
                    />
                ) : mode === 'review' ? (
                    <>
                        <p className="text-[13px] text-muted mb-3">{filtered.length.toLocaleString()}건</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
                            {paged.map((post) => (
                                <article key={post.id} className="card-air overflow-hidden flex flex-col">
                                    {post.image_url && (
                                        <div className="aspect-[4/3] overflow-hidden bg-surface-strong">
                                            <img src={post.image_url} alt={post.title} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                                        </div>
                                    )}
                                    <div className="p-3.5 sm:p-4 flex-1 flex flex-col">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <ContinentBadge regionId={post.region_id} className="mb-1" />
                                                <h3 className="text-[15px] sm:text-[16px] font-bold text-ink tracking-[-0.01em] leading-snug line-clamp-2">{post.title}</h3>
                                            </div>
                                            <button type="button" onClick={() => toggleLike(post.id)} aria-pressed={!!likes[post.id]?.liked} className={`inline-flex items-center gap-1 text-[13px] font-bold flex-shrink-0 ${likes[post.id]?.liked ? 'text-rausch' : 'text-muted hover:text-ink'}`}>
                                                <Heart size={16} fill={likes[post.id]?.liked ? 'currentColor' : 'none'} /> {likes[post.id]?.count || 0}
                                            </button>
                                        </div>
                                        <p className="text-[13px] text-muted mt-1 line-clamp-3 leading-relaxed whitespace-pre-line">{post.description || post.content}</p>
                                        <div className="mt-auto pt-3 flex items-center justify-between gap-2 text-[12px] text-muted">
                                            <span className="flex items-center gap-1 min-w-0">
                                                <span className="truncate">{post.author_name || post.profiles?.name || '익명'}</span>
                                                <CrewBadge profile={post.profiles} />
                                                <AuthorActions userId={post.user_id} name={post.author_name || post.profiles?.name || ''} size={12} />
                                            </span>
                                            <span className="flex items-center gap-1 flex-shrink-0">
                                                <span className="whitespace-nowrap">{new Date(post.created_at).toLocaleDateString('ko-KR')}</span>
                                                {cardActions(post)}
                                            </span>
                                        </div>
                                    </div>
                                </article>
                            ))}
                        </div>
                        {totalPages > 1 && <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} color="ink" />}
                    </>
                ) : (
                    <>
                        <p className="text-[13px] text-muted mb-2">{filtered.length.toLocaleString()}건</p>
                        <ul className="divide-y divide-hairline-soft border-t border-b border-hairline-soft">
                            {paged.map((post) => {
                                const open = expandedId === post.id;
                                const list = comments[post.id] || [];
                                return (
                                    <li key={post.id} className="py-4 sm:py-5">
                                        <button type="button" onClick={() => toggleComments(post.id)} aria-expanded={open} className="w-full text-left group">
                                            <h3 className="text-[16px] sm:text-[17px] font-bold text-ink tracking-[-0.01em] leading-snug group-hover:underline underline-offset-4 decoration-hairline">{post.title}</h3>
                                            <p className={`text-[14px] text-body mt-1 leading-relaxed whitespace-pre-wrap ${open ? '' : 'line-clamp-2'}`}>{post.content}</p>
                                        </button>
                                        <div className="mt-2 flex items-center gap-x-3 gap-y-1 flex-wrap text-[13px] text-muted">
                                            <span className="inline-flex items-center gap-1 min-w-0">
                                                <span className="truncate max-w-[10rem]">{post.author_name || post.profiles?.name || '익명'}</span>
                                                <CrewBadge profile={post.profiles} />
                                                <AuthorActions userId={post.user_id} name={post.author_name || post.profiles?.name || ''} size={12} />
                                            </span>
                                            <span className="whitespace-nowrap">{new Date(post.created_at).toLocaleDateString('ko-KR')}</span>
                                            <span className="ml-auto flex items-center gap-0.5">
                                                <button type="button" onClick={() => toggleLike(post.id)} aria-pressed={!!likes[post.id]?.liked} className={`inline-flex items-center gap-1 px-2 py-1 rounded-full font-bold ${likes[post.id]?.liked ? 'text-rausch' : 'text-muted hover:text-ink'}`}>
                                                    <Heart size={14} fill={likes[post.id]?.liked ? 'currentColor' : 'none'} /> {likes[post.id]?.count || 0}
                                                </button>
                                                <button type="button" onClick={() => toggleComments(post.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded-full font-bold text-muted hover:text-ink">
                                                    <MessageSquare size={14} /> {post.comment_count ?? post.qna_comments?.length ?? 0}
                                                    <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                                                </button>
                                                {cardActions(post)}
                                            </span>
                                        </div>
                                        {open && (
                                            <div className="mt-3 rounded-md bg-surface-soft px-4 py-3 space-y-3">
                                                {commentsLoading && !comments[post.id] ? (
                                                    <p className="text-sm text-muted text-center py-2">댓글을 불러오는 중...</p>
                                                ) : list.length > 0 ? (
                                                    [...list].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map((c) => (
                                                        <div key={c.id} className={`rounded-sm px-3 py-2.5 ${c.is_private ? 'bg-amber-50' : 'bg-white border border-hairline-soft'}`}>
                                                            <div className="flex items-center justify-between mb-1 gap-2">
                                                                <span className="flex items-center gap-1 min-w-0 text-[12px] font-bold text-ink">
                                                                    <span className="truncate">{c.author_name || '익명'}</span>
                                                                    <CrewBadge profile={c.profiles} />
                                                                    {c.is_private && <Lock size={11} className="text-amber-500 flex-shrink-0" aria-label="비밀댓글" />}
                                                                </span>
                                                                <span className="flex items-center gap-2 text-[12px] text-muted whitespace-nowrap flex-shrink-0">
                                                                    {new Date(c.created_at).toLocaleDateString('ko-KR')}
                                                                    {isLoggedIn && (
                                                                        <button type="button" onClick={() => { setReplyTo({ id: c.id, name: c.author_name || '익명', isPrivate: !!c.is_private }); if (c.is_private) setCommentPrivate(true); }} className="font-bold text-ink hover:underline">답글</button>
                                                                    )}
                                                                </span>
                                                            </div>
                                                            {replyTargetLabel(c, list) && (
                                                                <p className="text-[11px] text-muted mb-0.5 flex items-center gap-1"><CornerDownRight size={11} />{replyTargetLabel(c, list)}에게</p>
                                                            )}
                                                            <p className="text-sm text-body whitespace-pre-wrap">{c.content}</p>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <p className="text-sm text-muted text-center py-2">댓글이 없습니다</p>
                                                )}
                                                {replyTo && (
                                                    <div className="flex items-center gap-1.5 text-[12px] text-muted">
                                                        <CornerDownRight size={12} />
                                                        <span><strong className="text-ink">{replyTo.name}</strong>에게 답글</span>
                                                        <button type="button" onClick={() => setReplyTo(null)} className="text-muted hover:text-ink" aria-label="답글 취소"><X size={12} /></button>
                                                    </div>
                                                )}
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        value={expandedId === post.id ? commentText : ''}
                                                        onChange={(e) => setCommentText(e.target.value)}
                                                        onKeyDown={(e) => { if (e.key !== 'Enter' || e.nativeEvent?.isComposing) return; e.preventDefault(); addComment(post.id); }}
                                                        placeholder="댓글"
                                                        className="input-air flex-1 !py-2 text-sm"
                                                    />
                                                    <button type="button" onClick={() => addComment(post.id)} disabled={commentBusy} className="btn-air-secondary !py-2">등록</button>
                                                </div>
                                                <label className="flex items-center gap-1.5 text-[12px] text-muted select-none cursor-pointer">
                                                    <input type="checkbox" checked={commentPrivate || !!replyTo?.isPrivate} disabled={!!replyTo?.isPrivate} onChange={(e) => setCommentPrivate(e.target.checked)} />
                                                    <Lock size={11} className="text-amber-500" />
                                                    비밀댓글
                                                </label>
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                        {totalPages > 1 && <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} color="ink" />}
                    </>
                )}
            </BoardShell>

            <WriteModal
                open={showModal}
                title={mode === 'review' ? '여행 후기 작성' : '질문 작성'}
                onClose={() => setShowModal(false)}
                footer={
                    <>
                        <button type="button" onClick={() => setShowModal(false)} className="btn-air-link">취소</button>
                        <button type="submit" form={`${formId}-form`} disabled={submitting || uploading} className="btn-air-primary">{submitting ? '등록 중...' : uploading ? '사진 올리는 중...' : '등록'}</button>
                    </>
                }
            >
                <form id={`${formId}-form`} onSubmit={submit} className="space-y-5">
                    {mode === 'review' && (
                        <ContinentPicker name={`${formId}-continent`} value={form.region_id} error={pickerError} onChange={(id) => { setPickerError(''); setForm((f) => ({ ...f, region_id: id })); }} />
                    )}
                    <div>
                        <label htmlFor={`${formId}-title`} className="block text-sm font-bold text-ink mb-1.5">제목</label>
                        <input id={`${formId}-title`} type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input-air" maxLength={100} required />
                    </div>
                    <div>
                        <label htmlFor={`${formId}-content`} className="block text-sm font-bold text-ink mb-1.5">{mode === 'review' ? '후기 내용' : '질문 내용'}</label>
                        <textarea id={`${formId}-content`} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="input-air resize-none" rows={8} maxLength={5000} required />
                    </div>
                    {mode === 'review' && (
                        <div>
                            <span className="block text-sm font-bold text-ink mb-1.5">사진 (선택)</span>
                            <ImageUpload onUpload={(url) => setForm((f) => ({ ...f, image_url: url || '' }))} onUploadingChange={setUploading} />
                        </div>
                    )}
                </form>
            </WriteModal>
            <LoginPrompt isOpen={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
        </>
    );
};

export default TravelQnA;

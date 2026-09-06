import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Lock, Plus, MessageSquare, Plane, Tag, Heart, Loader2, Trash2, ChevronDown } from 'lucide-react';
import { crewVerificationStatus } from '../lib/crewVerification';
import { useAuth } from '../lib/AuthContext';
import { crewApi, postLikeApi } from '../lib/db';
import BoardShell from './board/BoardShell';
import BoardTabs from './board/BoardTabs';
import SearchPill from './board/SearchPill';
import WriteModal from './board/WriteModal';
import Pagination from './Pagination';
import ListState from './ListState';
import ReportButton from './ReportButton';
import CrewBadge from './CrewBadge';
import AuthorActions from './AuthorActions';
import LoginPrompt from './LoginPrompt';
import SEOHead from './SEOHead';

const TABS = [
    { id: 'free', label: '자유게시판', icon: MessageSquare },
    { id: 'layover', label: '레이오버 정보', icon: Plane },
    { id: 'deals', label: '할인 혜택', icon: Tag },
];
const CATEGORY_LABEL = { restaurant: '맛집', sightseeing: '관광지', hotel: '숙소/호텔', transport: '교통', tips: '꿀팁', other: '기타', general: '' };
const PAGE = 10;
const EMPTY_FORM = { title: '', content: '', category: 'restaurant' };

const Gate = ({ tone, icon, title, children }) => (
    <section id="crew-only" className="bg-white min-h-screen pt-28 pb-20">
        <div className="max-w-xl mx-auto px-4 text-center">
            <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-5 ${tone}`}>{icon}</div>
            <h1 className="text-[24px] font-extrabold text-ink tracking-[-0.02em] mb-3">{title}</h1>
            {children}
        </div>
    </section>
);

// CREW 전용 게시판(2026-09-07 에어비앤비 톤): 탭 3개(자유/레이오버/할인), 행 목록. 인증 승무원만.
const CrewOnly = () => {
    const { user, profile, isLoggedIn, isCrew, profileLoading, profileError } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get('tab');
    const mode = TABS.some((t) => t.id === tabParam) ? tabParam : 'free';
    const q = searchParams.get('q') || '';
    const [qInput, setQInput] = useState(q);
    const [page, setPage] = useState(1);
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [likes, setLikes] = useState({});
    const [expanded, setExpanded] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [submitting, setSubmitting] = useState(false);
    const formId = useId();
    const reqRef = useRef(0);

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

    const setTab = (id) => {
        setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set('tab', id); n.delete('q'); return n; });
        setQInput(''); setPage(1); setExpanded(null);
    };

    const load = useCallback(async () => {
        if (!isCrew) { setLoading(false); return; }
        const reqId = ++reqRef.current;
        try {
            setLoading(true); setError(null);
            const data = await crewApi.getAll(mode) || [];
            if (reqId !== reqRef.current) return;
            setPosts(data);
            if (data.length) {
                const m = await postLikeApi.getForBoard('crew_posts', data.map((p) => p.id), user?.id);
                if (reqId !== reqRef.current) return;
                setLikes((prev) => ({ ...prev, ...m }));
            }
        } catch (err) {
            if (reqId !== reqRef.current) return;
            console.error('크루 게시글 로딩 실패:', err);
            setPosts([]);
            setError('게시글을 불러오지 못했습니다. 다시 시도해주세요.');
        } finally {
            if (reqId === reqRef.current) setLoading(false);
        }
    }, [mode, isCrew, user?.id]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPage(1); }, [q, mode]);

    const toggleLike = async (postId) => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        try {
            const { data, error: e } = await postLikeApi.toggle('crew_posts', postId);
            if (e) throw e;
            setLikes((prev) => ({ ...prev, [postId]: { count: data.likes_count, liked: data.liked } }));
        } catch (err) {
            console.error('좋아요 실패:', err);
            alert(err?.message?.includes('phone') ? '휴대폰 인증 후 좋아요할 수 있어요.' : '좋아요 처리에 실패했습니다.');
        }
    };

    const submit = async (e) => {
        e.preventDefault();
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        if (submitting) return;
        setSubmitting(true);
        try {
            const created = await crewApi.create({
                title: form.title.trim(), content: form.content.trim(), post_type: mode,
                category: mode === 'layover' ? form.category : 'general',
                author_name: profile?.name || '익명', user_id: user.id,
            });
            setPosts((prev) => [created, ...prev]);
            setPage(1);
            setShowModal(false);
        } catch (err) {
            console.error('게시글 등록 실패:', err);
            alert('게시글 등록에 실패했습니다. 다시 시도해주세요.');
        } finally {
            setSubmitting(false);
        }
    };

    const remove = async (id) => {
        if (!window.confirm('이 글을 삭제할까요?')) return;
        try {
            await crewApi.delete(id);
            setPosts((prev) => prev.filter((p) => p.id !== id));
        } catch (err) {
            console.error('삭제 실패:', err);
            alert('삭제에 실패했습니다.');
        }
    };

    if (isLoggedIn && profileLoading) {
        return (
            <section id="crew-only" className="bg-white min-h-screen pt-28">
                <div className="flex items-center justify-center min-h-[40vh]"><Loader2 className="animate-spin text-ink" size={32} /></div>
            </section>
        );
    }
    if (isLoggedIn && profileError) {
        return (
            <Gate tone="bg-surface-soft text-ink" icon={<Loader2 size={28} />} title="계정 정보를 불러오지 못했습니다">
                <p className="text-muted mb-6">네트워크 상태를 확인한 뒤 다시 시도해주세요.</p>
                <button type="button" onClick={() => window.location.reload()} className="btn-air-secondary">다시 시도</button>
            </Gate>
        );
    }
    if (isCrew && crewVerificationStatus(profile).state === 'expired') {
        return (
            <Gate tone="bg-amber-50 text-amber-600" icon={<Lock size={28} />} title="승무원 인증이 만료되었습니다">
                <p className="text-muted mb-6">승무원 인증은 회사 이메일 인증일로부터 1년간 유효합니다. 마이페이지에서 회사 이메일로 다시 인증하면 바로 이용할 수 있습니다.</p>
                <Link to="/mypage#crew-renewal" className="btn-air-primary">마이페이지에서 갱신하기</Link>
            </Gate>
        );
    }
    if (!isCrew) {
        return (
            <Gate tone="bg-rausch-soft text-rausch" icon={<Lock size={28} />} title="접근 권한 없음">
                <p className="text-muted mb-6">이 공간은 승무원(CREW) 계정으로 로그인하신 분들만 입장할 수 있는 전용 커뮤니티입니다.</p>
                <button type="button" onClick={() => window.history.back()} className="btn-air-secondary">이전 페이지로 돌아가기</button>
            </Gate>
        );
    }

    const ql = q.toLowerCase();
    const filtered = posts.filter((p) => !ql || (p.title || '').toLowerCase().includes(ql) || (p.content || '').toLowerCase().includes(ql));
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
    const paged = filtered.slice((page - 1) * PAGE, page * PAGE);
    const tab = TABS.find((t) => t.id === mode);

    return (
        <>
            <SEOHead title="승무원 전용 - ConnectTrip" description="항공 승무원을 위한 전용 커뮤니티. 스케줄 공유, 할인 정보, 비행 꿀팁." />
            <BoardShell
                id="crew-only"
                title="CREW 전용"
                action={<button type="button" onClick={() => { setForm(EMPTY_FORM); setShowModal(true); }} className="btn-air-primary"><Plus size={16} /> 글쓰기</button>}
                tabs={<BoardTabs items={TABS} value={mode} onChange={setTab} />}
                search={<SearchPill value={qInput} onChange={setQInput} placeholder="제목, 내용 검색" className="max-w-md" />}
            >
                {loading || error ? (
                    <ListState loading={loading} error={error} onRetry={load} color="ink" />
                ) : paged.length === 0 ? (
                    <ListState empty emptyIcon={tab ? <tab.icon size={36} className="mx-auto text-muted-soft mb-3" /> : null} emptyTitle={q ? '검색 결과가 없습니다.' : '등록된 글이 없습니다.'} emptyDesc={null} />
                ) : (
                    <>
                        <p className="text-[13px] text-muted mb-2">{filtered.length.toLocaleString()}건</p>
                        <ul className="divide-y divide-hairline-soft border-t border-b border-hairline-soft">
                            {paged.map((post) => {
                                const open = expanded === post.id;
                                const cat = mode === 'layover' ? CATEGORY_LABEL[post.category] : '';
                                return (
                                    <li key={post.id} className="py-4 sm:py-5">
                                        <button type="button" onClick={() => setExpanded(open ? null : post.id)} aria-expanded={open} className="w-full text-left group">
                                            <div className="flex items-center gap-2 mb-1">
                                                {cat && <span className="inline-flex items-center rounded-full bg-surface-soft text-ink text-[11px] font-bold px-2 py-0.5">{cat}</span>}
                                            </div>
                                            <h3 className="text-[16px] sm:text-[17px] font-bold text-ink tracking-[-0.01em] leading-snug group-hover:underline underline-offset-4 decoration-hairline">{post.title}</h3>
                                            <p className={`text-[14px] text-body mt-1 leading-relaxed whitespace-pre-wrap ${open ? '' : 'line-clamp-2'}`}>{post.content}</p>
                                        </button>
                                        <div className="mt-2 flex items-center gap-x-3 gap-y-1 flex-wrap text-[13px] text-muted">
                                            <span className="inline-flex items-center gap-1 min-w-0">
                                                <span className="truncate max-w-[10rem]">{post.author_name}</span>
                                                <CrewBadge profile={post.profiles} />
                                                <AuthorActions userId={post.user_id} name={post.author_name || ''} size={12} />
                                            </span>
                                            <span className="whitespace-nowrap">{new Date(post.created_at).toLocaleDateString('ko-KR')}</span>
                                            <span className="ml-auto flex items-center gap-0.5">
                                                <button type="button" onClick={() => toggleLike(post.id)} aria-pressed={!!likes[post.id]?.liked} className={`inline-flex items-center gap-1 px-2 py-1 rounded-full font-bold ${likes[post.id]?.liked ? 'text-rausch' : 'text-muted hover:text-ink'}`}>
                                                    <Heart size={14} fill={likes[post.id]?.liked ? 'currentColor' : 'none'} /> {likes[post.id]?.count || 0}
                                                </button>
                                                {user?.id === post.user_id ? (
                                                    <button type="button" onClick={() => remove(post.id)} aria-label="삭제" className="p-1.5 rounded-full text-muted hover:text-error hover:bg-surface-soft"><Trash2 size={14} /></button>
                                                ) : (
                                                    <ReportButton postId={post.id} boardType="crew" reportedUserId={post.user_id} />
                                                )}
                                                <button type="button" onClick={() => setExpanded(open ? null : post.id)} aria-label={open ? '접기' : '펼치기'} className="p-1.5 rounded-full text-muted hover:bg-surface-soft">
                                                    <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                                                </button>
                                            </span>
                                        </div>
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
                title={mode === 'layover' ? '레이오버 정보 작성' : mode === 'deals' ? '할인 정보 등록' : '글쓰기'}
                onClose={() => setShowModal(false)}
                footer={
                    <>
                        <button type="button" onClick={() => setShowModal(false)} className="btn-air-link">취소</button>
                        <button type="submit" form={`${formId}-form`} disabled={submitting} className="btn-air-primary">{submitting ? '등록 중...' : '등록'}</button>
                    </>
                }
            >
                <form id={`${formId}-form`} onSubmit={submit} className="space-y-5">
                    <div>
                        <label htmlFor={`${formId}-title`} className="block text-sm font-bold text-ink mb-1.5">제목</label>
                        <input id={`${formId}-title`} type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input-air" maxLength={100} required />
                    </div>
                    {mode === 'layover' && (
                        <div>
                            <label htmlFor={`${formId}-category`} className="block text-sm font-bold text-ink mb-1.5">카테고리</label>
                            <select id={`${formId}-category`} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input-air">
                                {['restaurant', 'sightseeing', 'hotel', 'transport', 'tips', 'other'].map((k) => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
                            </select>
                        </div>
                    )}
                    <div>
                        <label htmlFor={`${formId}-content`} className="block text-sm font-bold text-ink mb-1.5">내용</label>
                        <textarea id={`${formId}-content`} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="input-air resize-none" rows={7} maxLength={5000} required />
                    </div>
                </form>
            </WriteModal>
            <LoginPrompt isOpen={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
        </>
    );
};

export default CrewOnly;

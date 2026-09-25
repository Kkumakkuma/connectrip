import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Heart, Users } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { postLikeApi } from '../lib/db';
import { BOARDS, COMPANION_STATUS, postPath } from '../lib/boards';
import { continentOf } from '../lib/continents';
import Comments from '../components/board/Comments';
import { displayAuthor } from '../lib/authorName';
import ContinentBadge from '../components/board/ContinentBadge';
import ContinentPicker from '../components/board/ContinentPicker';
import AirlineBadge from '../components/board/AirlineBadge';
import AirlinePicker from '../components/board/AirlinePicker';
import { airlineTagOf } from '../lib/airlineTags';
import { canSetPrivate, visibilityPatch } from '../lib/postVisibility';
import VisibilityPicker from '../components/board/VisibilityPicker';
import PrivateBadge from '../components/board/PrivateBadge';
import WriteModal from '../components/board/WriteModal';
import ListState from '../components/ListState';
import ImageUpload from '../components/ImageUpload';
import CrewBadge from '../components/CrewBadge';
import AuthorActions from '../components/AuthorActions';
import ReportButton from '../components/ReportButton';
import ShareButtons from '../components/ShareButtons';
import LoginPrompt from '../components/LoginPrompt';
import SEOHead from '../components/SEOHead';

// CREW 레이오버 글의 분류(CrewOnly.jsx 의 CATEGORY_LABEL 과 같은 값)
const CREW_CATEGORY = { restaurant: '맛집', sightseeing: '관광지', hotel: '숙소/호텔', transport: '교통', tips: '꿀팁', other: '기타' };
const TITLE_LABEL = { destination: '장소명' };
const BODY_LABEL = { destination: '간단한 설명', review: '후기 내용', qna: '질문 내용' };
const BODY_MAX = { destination: 200, companion: 3000 };
const EMPTY_FORM = { title: '', content: '', extra: '', country: '', date: '', members: '', image_url: '', region_id: '', airline_id: '', category: 'restaurant', is_private: false };
// qna_posts 를 board 컬럼으로 나눠 쓰는 두 게시판 — 주소의 게시판과 글의 board 가 다를 수 있다
const QNA_BOARDS = ['qna', 'free'];

// 모든 게시판 공용 상세 페이지(/post/:board/:id, 2026-09-14).
// 게시판별 차이는 src/lib/boards.js 의 BOARDS[board] 설정만 보고 처리한다.
const PostDetail = () => {
    const { board, id } = useParams();
    const navigate = useNavigate();
    const { user, isCrew, isLoggedIn, profileLoading } = useAuth();
    const config = BOARDS[board];

    const [post, setPost] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [notFound, setNotFound] = useState(false);
    const [like, setLike] = useState({ count: 0, liked: false });
    const [likeBusy, setLikeBusy] = useState(false);
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [pickerError, setPickerError] = useState('');
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    const formId = useId();
    const reqRef = useRef(0);   // 라우트가 바뀐 뒤 도착한 이전 조회 응답은 버린다
    // 수정·상태변경·삭제·좋아요는 요청을 보낸 그 글에 아직 머물러 있을 때만 화면에 반영한다
    // (응답이 늦게 와서 다른 글 화면을 덮어쓰는 것을 막는다).
    const routeKey = `${board}/${id}`;
    const routeRef = useRef(routeKey);
    useEffect(() => { routeRef.current = routeKey; }, [routeKey]);

    const load = useCallback(async () => {
        const reqId = ++reqRef.current;
        // 없는 게시판 키(잘못된 주소)면 이전 글이 화면에 남지 않게 비운다
        if (!config) { setPost(null); setLoading(false); setNotFound(true); return; }
        if (config.crewOnly && !isCrew) { setLoading(false); return; }
        try {
            setLoading(true); setError(null); setNotFound(false);
            const data = await config.api.getById(id);
            if (reqId !== reqRef.current) return;
            if (!data) { setPost(null); setNotFound(true); return; }
            setPost(data);
            const m = await postLikeApi.getForBoard(config.likeTable, [id], user?.id);
            if (reqId !== reqRef.current) return;
            setLike(m[id] || { count: 0, liked: false });
        } catch (err) {
            if (reqId !== reqRef.current) return;
            console.error('글 조회 실패:', err);
            setPost(null);
            // PGRST116 = single() 이 0행 — 삭제됐거나 없는 글
            if (err?.code === 'PGRST116') setNotFound(true);
            else setError('글을 불러오지 못했습니다.');
        } finally {
            if (reqId === reqRef.current) setLoading(false);
        }
    }, [config, id, isCrew, user?.id]);

    useEffect(() => { setEditing(false); load(); }, [load]);

    // Q&A 와 자유게시판은 같은 테이블(qna_posts)이라 주소의 게시판과 글의 board 가 어긋날 수 있다.
    // 어긋나면 라벨·목록 경로가 계속 틀리므로 글이 속한 게시판 주소로 바꿔 준다.
    useEffect(() => {
        if (!config || !post || !QNA_BOARDS.includes(config.key)) return;
        if (post.board && post.board !== config.key && BOARDS[post.board]) {
            navigate(postPath(post.board, id), { replace: true });
        }
    }, [config, post, id, navigate]);

    const toggleLike = async () => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        if (likeBusy) return;
        const from = routeKey;
        setLikeBusy(true);
        try {
            const { data, error: e } = await postLikeApi.toggle(config.likeTable, id);
            if (e) throw e;
            if (from !== routeRef.current) return;
            setLike({ count: data.likes_count, liked: data.liked });
        } catch (err) {
            console.error('좋아요 실패:', err);
            alert(err?.message?.includes('phone') ? '휴대폰 인증 후 좋아요할 수 있어요.' : '좋아요 처리에 실패했습니다.');
        } finally {
            setLikeBusy(false);
        }
    };

    const setStatus = async (status) => {
        if (busy) return;
        const from = routeKey;
        setBusy(true);
        try {
            const updated = await config.api.update(id, { status });
            if (from !== routeRef.current) return;
            setPost(updated);
        } catch (err) {
            console.error('상태 변경 실패:', err);
            alert('상태를 바꾸지 못했습니다.');
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!window.confirm('이 글을 삭제할까요?')) return;
        const from = routeKey;
        try {
            await config.api.delete(id);
            if (from !== routeRef.current) return;
            navigate(config.listPath);
        } catch (err) {
            console.error('삭제 실패:', err);
            alert('삭제에 실패했습니다.');
        }
    };

    const openEdit = () => {
        if (!config || !post) return;
        setPickerError('');
        setForm({
            ...EMPTY_FORM,
            title: post[config.titleField] || '',
            content: post[config.bodyField] || '',
            extra: config.extraField ? (post[config.extraField] || '') : '',
            country: post.country || '',
            date: post.travel_date || '',
            members: post.members_needed ? String(post.members_needed) : '',
            image_url: config.imageField ? (post[config.imageField] || '') : '',
            region_id: post.region_id || '',
            airline_id: post.airline_id || '',
            category: post.category && CREW_CATEGORY[post.category] ? post.category : 'restaurant',
            is_private: !!post.is_private,
        });
        setEditing(true);
    };

    const submitEdit = async (e) => {
        e.preventDefault();
        if (submitting || uploading) return;
        if (config.hasRegion && !continentOf(form.region_id)) { setPickerError('말머리를 선택해 주세요.'); return; }
        const usesAirline = config.hasAirline && p?.post_type === config.airlinePostType;
        const patch = {
            [config.titleField]: form.title.trim(),
            [config.bodyField]: form.content.trim(),
        };
        if (config.hasRegion) patch.region_id = form.region_id;
        if (usesAirline) patch.airline_id = airlineTagOf(form.airline_id) ? form.airline_id : null;
        if (config.extraField) patch[config.extraField] = form.extra.trim();
        if (config.imageField) patch[config.imageField] = form.image_url || null;
        if (config.key === 'companion') {
            patch.country = form.country.trim();
            patch.travel_date = form.date;
            patch.members_needed = form.members.trim();
        }
        if (config.key === 'crew' && post?.post_type === 'layover') patch.category = form.category;
        if (canSetPrivate(config, post)) Object.assign(patch, visibilityPatch(post.is_private, form.is_private));
        const from = routeKey;
        setSubmitting(true);
        try {
            const updated = await config.api.update(id, patch);
            if (from !== routeRef.current) return;
            setPost(updated);
            setEditing(false);
        } catch (err) {
            console.error('수정 실패:', err);
            alert('수정에 실패했습니다.');
        } finally {
            setSubmitting(false);
        }
    };

    const gate = !!config && config.crewOnly && !isCrew;
    const waiting = loading || (gate && profileLoading);
    // config 가 없는 주소로 옮겨간 첫 렌더에는 이전 글이 state 에 남아 있다 — 그때 글을 그리지 않는다
    const p = config ? post : null;
    // 추천지(destinations)는 작성자 컬럼이 없어 조인한 닉네임을 쓴다. 실명(profiles.name)으로 대체하지 않는다.
    const authorName = displayAuthor(p?.author_name, p?.profiles?.nickname);
    const isOwner = !!user && !!p && p.user_id === user.id;
    const title = p ? p[config.titleField] : '';
    const body = p ? p[config.bodyField] : '';
    const image = p && config.imageField ? p[config.imageField] : null;

    return (
        <section className="bg-white text-ink min-h-screen pt-24 sm:pt-28 pb-20">
            <SEOHead
                title={p ? `${title} - ${config.label} - 커넥트립 ConnectTrip` : 'ConnectTrip'}
                description={body ? String(body).slice(0, 120) : undefined}
                robots={p?.is_private ? 'noindex, nofollow' : undefined}
            />
            <div className="max-w-3xl mx-auto px-4 sm:px-6">
                <Link to={config ? config.listPath : '/'} className="btn-air-link inline-flex items-center gap-1">
                    <ArrowLeft size={14} aria-hidden="true" /> 목록으로
                </Link>

                {gate ? (
                    profileLoading
                        ? <ListState loading color="ink" loadingText="불러오는 중..." />
                        : <p className="mt-8 text-[15px] text-body">승무원 회원만 볼 수 있습니다</p>
                ) : waiting || error ? (
                    <ListState loading={waiting} error={error} onRetry={load} color="ink" loadingText="불러오는 중..." />
                ) : notFound || !p ? (
                    <ListState empty emptyTitle="글이 없습니다" emptyDesc={null} />
                ) : (
                    <>
                        <header className="mt-4">
                            <div className="flex items-center gap-1.5 flex-wrap mb-2">
                                {config.hasRegion && <ContinentBadge regionId={p.region_id} />}
                                {config.hasVisibility && <PrivateBadge isPrivate={p.is_private} />}
                                {config.hasAirline && p.post_type === config.airlinePostType && <AirlineBadge airlineId={p.airline_id} />}
                                {config.hasStatus && (
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${p.status === 'closed' ? 'bg-surface-strong text-muted' : 'bg-rausch-soft text-rausch'}`}>
                                        {COMPANION_STATUS[p.status] || COMPANION_STATUS.open}
                                    </span>
                                )}
                                {config.key === 'crew' && CREW_CATEGORY[p.category] && (
                                    <span className="inline-flex items-center rounded-full bg-surface-soft px-2 py-0.5 text-[11px] font-bold text-muted whitespace-nowrap">
                                        {CREW_CATEGORY[p.category]}
                                    </span>
                                )}
                            </div>
                            <h1 className="text-[22px] sm:text-[26px] font-bold text-ink tracking-[-0.01em] leading-snug break-keep">{title}</h1>
                            <div className="mt-2 flex items-center gap-x-3 gap-y-1 flex-wrap text-[13px] text-muted">
                                <span className="inline-flex items-center gap-1 min-w-0">
                                    <span className="truncate max-w-[12rem]">{authorName}</span>
                                    <CrewBadge profile={p.profiles} />
                                    <AuthorActions userId={p.user_id} name={authorName} size={13} />
                                </span>
                                <span className="whitespace-nowrap">{new Date(p.created_at).toLocaleDateString('ko-KR')}</span>
                                {config.key === 'companion' && (
                                    <>
                                        <span className="inline-flex items-center gap-1 whitespace-nowrap"><Calendar size={13} aria-hidden="true" />{p.travel_date || '미정'}</span>
                                        <span className="inline-flex items-center gap-1 whitespace-nowrap"><Users size={13} aria-hidden="true" />{p.members_needed}명</span>
                                        {p.country && <span className="truncate max-w-[12rem]">{p.country}</span>}
                                    </>
                                )}
                            </div>
                        </header>

                        {image && (
                            <img src={image} alt={title} className="w-full rounded-md max-h-[70vh] object-contain bg-surface-soft mt-5" />
                        )}

                        <div className="mt-5">
                            <p className="text-[15px] sm:text-[16px] text-body leading-[1.8] whitespace-pre-wrap break-keep">{body}</p>
                            {config.extraField && p[config.extraField] && (
                                <div className="mt-5 rounded-md bg-surface-soft px-4 py-3.5">
                                    <p className="text-[13px] font-bold text-ink mb-1">{config.extraLabel}</p>
                                    <p className="text-[15px] text-body leading-[1.8] whitespace-pre-wrap break-keep">{p[config.extraField]}</p>
                                </div>
                            )}
                        </div>

                        <div className="mt-6 pt-4 border-t border-hairline flex items-center gap-1 flex-wrap">
                            <button
                                type="button"
                                onClick={toggleLike}
                                disabled={likeBusy}
                                aria-pressed={!!like.liked}
                                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[14px] font-bold disabled:opacity-50 ${like.liked ? 'text-rausch' : 'text-muted hover:text-ink'}`}
                            >
                                <Heart size={16} fill={like.liked ? 'currentColor' : 'none'} /> {like.count || 0}
                            </button>
                            {/* 나만 보기 글은 남이 열 수 없는 링크라 공유를 감춘다 */}
                            {!p.is_private && <ShareButtons title={title} description={body} />}
                            {!isOwner && <ReportButton postId={p.id} boardType={config.reportType} reportedUserId={p.user_id} />}
                            {isOwner && (
                                <span className="ml-auto flex items-center gap-1 flex-wrap">
                                    {config.hasStatus && (
                                        <button type="button" onClick={() => setStatus(p.status === 'closed' ? 'open' : 'closed')} disabled={busy} className="btn-air-secondary !py-2 disabled:opacity-50">
                                            {p.status === 'closed' ? '다시 모집중으로' : '모집완료로 변경'}
                                        </button>
                                    )}
                                    <button type="button" onClick={openEdit} className="btn-air-secondary !py-2">수정</button>
                                    <button type="button" onClick={remove} className="btn-air-secondary !py-2">삭제</button>
                                </span>
                            )}
                        </div>

                        {config.comments && <Comments api={config.comments} postId={p.id} postOwnerId={p.user_id} board={config.key} />}
                    </>
                )}
            </div>

            {p && (
                <WriteModal
                    open={editing}
                    title="수정"
                    onClose={() => setEditing(false)}
                    footer={
                        <>
                            <button type="button" onClick={() => setEditing(false)} className="btn-air-secondary">취소</button>
                            <button type="submit" form={`${formId}-form`} disabled={submitting || uploading} className="btn-air-primary">
                                {submitting ? '저장 중...' : uploading ? '사진 올리는 중...' : '저장'}
                            </button>
                        </>
                    }
                >
                    <form id={`${formId}-form`} onSubmit={submitEdit} className="space-y-5">
                        {config.hasAirline && p?.post_type === config.airlinePostType && (
                            <AirlinePicker
                                value={form.airline_id}
                                onChange={(id) => { setPickerError(''); setForm((f) => ({ ...f, airline_id: id })); }}
                                error={pickerError}
                            />
                        )}
                        {config.hasRegion && (
                            <ContinentPicker
                                name={`${formId}-continent`}
                                value={form.region_id}
                                error={pickerError}
                                onChange={(rid) => { setPickerError(''); setForm((f) => ({ ...f, region_id: rid })); }}
                            />
                        )}
                        <div>
                            <label htmlFor={`${formId}-title`} className="block text-sm font-bold text-ink mb-1.5">{TITLE_LABEL[config.key] || '제목'}</label>
                            <input id={`${formId}-title`} type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input-air" maxLength={100} required />
                        </div>
                        {config.key === 'companion' && (
                            <>
                                <div>
                                    <label htmlFor={`${formId}-country`} className="block text-sm font-bold text-ink mb-1.5">국가/도시</label>
                                    <input id={`${formId}-country`} type="text" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="input-air" maxLength={40} required />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label htmlFor={`${formId}-date`} className="block text-sm font-bold text-ink mb-1.5">여행 일정</label>
                                        <input id={`${formId}-date`} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input-air" required />
                                    </div>
                                    <div>
                                        <label htmlFor={`${formId}-members`} className="block text-sm font-bold text-ink mb-1.5">모집 인원</label>
                                        <input id={`${formId}-members`} type="text" inputMode="numeric" value={form.members} onChange={(e) => setForm({ ...form, members: e.target.value })} className="input-air" maxLength={10} required />
                                    </div>
                                </div>
                            </>
                        )}
                        {config.key === 'crew' && p.post_type === 'layover' && (
                            <div>
                                <label htmlFor={`${formId}-category`} className="block text-sm font-bold text-ink mb-1.5">분류</label>
                                <select id={`${formId}-category`} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input-air">
                                    {Object.keys(CREW_CATEGORY).map((k) => <option key={k} value={k}>{CREW_CATEGORY[k]}</option>)}
                                </select>
                            </div>
                        )}
                        <div>
                            <label htmlFor={`${formId}-content`} className="block text-sm font-bold text-ink mb-1.5">{BODY_LABEL[config.key] || '내용'}</label>
                            {config.key === 'destination' ? (
                                <input id={`${formId}-content`} type="text" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="input-air" maxLength={BODY_MAX.destination} required />
                            ) : (
                                <textarea id={`${formId}-content`} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="input-air resize-none" rows={8} maxLength={BODY_MAX[config.key] || 5000} required />
                            )}
                        </div>
                        {config.extraField && (
                            <div>
                                <label htmlFor={`${formId}-extra`} className="block text-sm font-bold text-ink mb-1.5">{config.extraLabel}</label>
                                <textarea id={`${formId}-extra`} value={form.extra} onChange={(e) => setForm({ ...form, extra: e.target.value })} className="input-air resize-none" rows={4} maxLength={1000} required />
                            </div>
                        )}
                        {config.imageField && (
                            <div>
                                <span className="block text-sm font-bold text-ink mb-1.5">사진</span>
                                {form.image_url && <img src={form.image_url} alt="" className="w-full max-h-48 object-contain rounded-sm bg-surface-soft mb-2" />}
                                <ImageUpload label={null} onUpload={(url) => { if (url !== undefined) setForm((f) => ({ ...f, image_url: url || '' })); }} onUploadingChange={setUploading} />
                            </div>
                        )}
                        {canSetPrivate(config, p) && (
                            <VisibilityPicker name={`${formId}-visibility`} value={form.is_private} onChange={(v) => setForm((f) => ({ ...f, is_private: v }))} />
                        )}
                    </form>
                </WriteModal>
            )}
            <LoginPrompt isOpen={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
        </section>
    );
};

export default PostDetail;

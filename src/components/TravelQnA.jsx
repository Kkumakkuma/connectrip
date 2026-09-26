import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MessageSquare, HelpCircle, Plus, BookOpen, Heart } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useNicknameGate } from '../lib/useNicknameGate';
import { displayAuthor } from '../lib/authorName';
import NicknameRequiredModal from './NicknameRequiredModal';
import { qnaApi, reviewsApi, postLikeApi } from '../lib/db';
import { postPath } from '../lib/boards';
import { regionFromSearch, continentOf } from '../lib/continents';
import { useDraftActions, usePostDrafts } from '../lib/usePostDrafts';
import { DRAFT_SPECS } from '../lib/draftForms';
import { DraftCloseDialog, DraftLoadBar, DraftSaveButton } from './board/DraftControls';
import BoardShell from './board/BoardShell';
import BoardTabs from './board/BoardTabs';
import ContinentBar from './board/ContinentBar';
import ContinentBadge from './board/ContinentBadge';
import ContinentPicker from './board/ContinentPicker';
import VisibilityPicker from './board/VisibilityPicker';
import PrivateBadge from './board/PrivateBadge';
import SearchPill from './board/SearchPill';
import WriteModal from './board/WriteModal';
import Pagination from './Pagination';
import ListState from './ListState';
import CrewBadge from './CrewBadge';
import MultiImageField from './board/MultiImageField';
import ResolvedImg from './board/ResolvedImg';
import CharCount from './board/CharCount';
import { IMAGES_MAX, TITLE_MAX, bodyMaxOf, imagesPatch } from '../lib/postLimits';
import LoginPrompt from './LoginPrompt';
import SEOHead from './SEOHead';

const TABS = [
    { id: 'review', label: '여행 후기', icon: 'review' },
    { id: 'qna', label: 'Q&A', icon: 'qna' },
    { id: 'free', label: '자유게시판', icon: 'free' },
];
const PAGE_REVIEW = 12;
const PAGE_QNA = 10;
const EMPTY_FORM = { title: '', content: '', image_urls: [], region_id: '', is_private: false };
const WRITE_LABEL = { review: '후기 쓰기', qna: '질문하기', free: '글쓰기' };
const MODAL_TITLE = { review: '여행 후기 작성', qna: '질문 작성', free: '자유게시판 글쓰기' };
const CONTENT_LABEL = { review: '후기 내용', qna: '질문 내용', free: '내용' };
const EMPTY_TITLE = { review: '등록된 후기가 없습니다.', qna: '등록된 질문이 없습니다.', free: '등록된 글이 없습니다.' };
const TAB_ICON = { review: BookOpen, qna: HelpCircle, free: MessageSquare };

// 여행후기 및 Q&A(2026-09-07 에어비앤비 톤). 탭: 후기(대륙 말머리 필수) / Q&A / 자유게시판.
// 목록은 한 줄 행이고 누르면 /post/:board/:id 상세로 들어간다(2026-09-14 게시판 정비).
// ?tab=review|qna|free, 후기는 ?region= 으로 대륙 필터.
const TravelQnA = () => {
    const { user, profile, isLoggedIn } = useAuth();
    const { requireNickname, nicknameModal } = useNicknameGate();
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get('tab');
    const mode = tabParam === 'qna' || tabParam === 'free' ? tabParam : 'review';
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
    const formId = useId();
    // 임시저장(2026-09-25): 탭(후기·Q&A·자유)마다 따로. "임시저장" 버튼으로 서버에 저장, 글쓰기 창 위 "불러오기"로 고른다.
    const drafts = usePostDrafts({ board: `qna:${mode}`, open: showModal, userId: user?.id });
    const { saveDraft, loadDraft, removeDraft, requestClose, closeDialog } = useDraftActions({ drafts, spec: DRAFT_SPECS.qna, form, setForm, blocked: uploading || submitting });
    const reqRef = useRef(0);
    const modeRef = useRef(mode);               // 등록 응답이 늦게 와도 그 사이 바뀐 탭에 남의 글을 끼워넣지 않는다
    useEffect(() => { modeRef.current = mode; }, [mode]);

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
        setQInput(''); setPage(1);
        setPosts([]); setLoading(true);         // 새 탭 링크가 이전 탭 목록에 붙는 순간을 없앤다
    };
    const setRegion = (id) => {
        setSearchParams((prev) => { const n = new URLSearchParams(prev); if (id) n.set('region', id); else n.delete('region'); return n; });
        setPage(1);
    };

    const load = useCallback(async () => {
        const reqId = ++reqRef.current;
        try {
            setLoading(true); setError(null);
            const data = mode === 'review' ? await reviewsApi.getAll(region, 'review', q) : await qnaApi.getAll(mode, q);
            if (reqId !== reqRef.current) return;
            setPosts(data || []);
            if (data?.length) {
                const m = await postLikeApi.getForBoard(mode === 'review' ? 'reviews' : 'qna_posts', data.map((p) => p.id), user?.id);
                if (reqId !== reqRef.current) return;
                setLikes(m);                    // 병합하면 좋아요가 0이 된 글에 예전 숫자가 남는다(키가 안 옴)
            }
        } catch (err) {
            if (reqId !== reqRef.current) return;
            console.error('목록 로딩 실패:', err);
            setPosts([]);
            setError('목록을 불러오지 못했습니다. 다시 시도해주세요.');
        } finally {
            if (reqId === reqRef.current) setLoading(false);
        }
    }, [mode, region, user?.id, q]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPage(1); }, [q, region, mode]);

    const openWrite = () => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        setPickerError('');
        setForm({ ...EMPTY_FORM, region_id: mode === 'review' ? (region || '') : '' });
        setShowModal(true);
    };

    const submit = async (e) => {
        e?.preventDefault?.();
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        if (submitting || uploading || drafts.busy) return;
        if (mode === 'review' && !continentOf(form.region_id)) { setPickerError('말머리를 선택해 주세요.'); return; }
        if (!requireNickname(() => submit())) return;
        const draftTicket = drafts.ticket();   // 불러온 임시저장 글 — 등록되면 그 버전만 지운다
        setSubmitting(true);
        try {
            let created;
            if (mode === 'review') {
                created = await reviewsApi.create({
                    user_id: user.id, type: 'review', region_id: form.region_id,
                    title: form.title.trim(), description: form.content.trim(), ...imagesPatch(form.image_urls),
                    is_private: !!form.is_private,            // 나만 보기(2026-09-25) — RLS 로 작성자에게만 보인다
                    author_name: profile?.nickname || null,   // 서버 트리거가 profiles.nickname 으로 덮어쓴다
                });
            } else {
                created = await qnaApi.create({
                    title: form.title.trim(), content: form.content.trim(), board: mode,
                    author_name: profile?.nickname || null, user_id: user.id,
                });
            }
            drafts.consume(draftTicket);
            // 등록하는 사이 탭이 바뀌었으면 목록에 끼워넣지 않는다(그 탭 글이 아니다)
            if (modeRef.current === mode) {
                if (mode === 'review' && region && region !== created.region_id) setRegion(created.region_id);
                else { setPosts((prev) => [created, ...prev]); setPage(1); }
            }
            setShowModal(false);
        } catch (err) {
            console.error('등록 실패:', err);
            alert('등록에 실패했습니다. 다시 시도해주세요.');
        } finally {
            setSubmitting(false);
        }
    };

    // 검색은 서버가 한다(2026-09-17) — 목록을 받아 거르면 LIST_FETCH_LIMIT 밖의 글이 조용히 빠진다
    const filtered = posts;
    const perPage = mode === 'review' ? PAGE_REVIEW : PAGE_QNA;
    const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
    const paged = filtered.slice((page - 1) * perPage, page * perPage);
    useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);   // 마지막 글 삭제로 빈 페이지에 고립되지 않게
    const EmptyIcon = TAB_ICON[mode];

    return (
        <>
            <SEOHead title="여행후기 및 Q&A - 커넥트립 ConnectTrip" description="여행 후기를 공유하고, 여행 관련 질문과 답변을 나누세요." path="/qna" />
            <BoardShell
                id="qna"
                title="여행후기 및 Q&A"
                action={<button type="button" onClick={openWrite} className="btn-air-primary"><Plus size={16} /> {WRITE_LABEL[mode]}</button>}
                tabs={<BoardTabs items={TABS} value={mode} onChange={setTab} />}
                bar={mode === 'review' ? <ContinentBar value={region} onChange={setRegion} /> : null}
                search={<SearchPill value={qInput} onChange={setQInput} placeholder="제목, 내용 검색" className="max-w-md" />}
            >
                {loading || error ? (
                    <ListState loading={loading} error={error} onRetry={load} color="ink" loadingText="불러오는 중..." />
                ) : paged.length === 0 ? (
                    <ListState
                        empty
                        emptyIcon={<EmptyIcon size={36} className="mx-auto text-muted-soft mb-3" />}
                        emptyTitle={q ? '검색 결과가 없습니다.' : EMPTY_TITLE[mode]}
                        emptyDesc={null}
                    />
                ) : (
                    <>
                        <p className="text-[13px] text-muted mb-2">{filtered.length.toLocaleString()}건</p>
                        <ul className="divide-y divide-hairline-soft border-t border-b border-hairline-soft">
                            {paged.map((post) => (
                                <li key={post.id}>
                                    <Link to={postPath(mode, post.id)} className="flex items-start gap-3 py-4 sm:py-5 group">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 min-w-0">
                                                {mode === 'review' && <ContinentBadge regionId={post.region_id} className="flex-shrink-0" />}
                                                {mode === 'review' && <PrivateBadge isPrivate={post.is_private} className="flex-shrink-0" />}
                                                <h3 className="min-w-0 flex-1 truncate text-[16px] font-bold text-ink tracking-[-0.01em] group-hover:underline underline-offset-4 decoration-hairline">
                                                    {post.title}
                                                </h3>
                                            </div>
                                            <div className="mt-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap text-[13px] text-muted">
                                                <span className="inline-flex items-center gap-1 min-w-0">
                                                    <span className="truncate max-w-[10rem]">{displayAuthor(post.author_name, post.profiles?.nickname)}</span>
                                                    <CrewBadge profile={post.profiles} />
                                                </span>
                                                <span className="ml-auto inline-flex items-center gap-3 whitespace-nowrap">
                                                    <span>{new Date(post.created_at).toLocaleDateString('ko-KR')}</span>
                                                    <span className="inline-flex items-center gap-1"><Heart size={13} aria-hidden="true" />{likes[post.id]?.count || 0}</span>
                                                    <span className="inline-flex items-center gap-1"><MessageSquare size={13} aria-hidden="true" />{post.comment_count ?? 0}</span>
                                                </span>
                                            </div>
                                        </div>
                                        {mode === 'review' && post.image_url && (
                                            <ResolvedImg src={post.image_url} alt="" loading="lazy" decoding="async" className="w-12 h-12 rounded-sm object-cover bg-surface-strong flex-shrink-0" />
                                        )}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                        {totalPages > 1 && <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} color="ink" />}
                    </>
                )}
            </BoardShell>

            <WriteModal
                open={showModal}
                title={MODAL_TITLE[mode]}
                onClose={() => requestClose(() => setShowModal(false))}
                footer={
                    <>
                        <button type="button" onClick={() => requestClose(() => setShowModal(false))} className="btn-air-secondary">취소</button>
                        <span className="flex items-center gap-2">
                            <DraftSaveButton drafts={drafts} onSave={saveDraft} disabled={submitting || uploading} />
                            <button type="submit" form={`${formId}-form`} disabled={submitting || uploading || drafts.busy} className="btn-air-primary">{submitting ? '등록 중...' : uploading ? '사진 올리는 중...' : '등록'}</button>
                        </span>
                    </>
                }
            >
                <form id={`${formId}-form`} onSubmit={submit} className="space-y-5">
                    <DraftLoadBar drafts={drafts} onLoad={loadDraft} onRemove={removeDraft} disabled={submitting || uploading} />
                    {mode === 'review' && (
                        <ContinentPicker name={`${formId}-continent`} value={form.region_id} error={pickerError} onChange={(id) => { setPickerError(''); setForm((f) => ({ ...f, region_id: id })); }} />
                    )}
                    <div>
                        <label htmlFor={`${formId}-title`} className="block text-sm font-bold text-ink mb-1.5">제목</label>
                        <input id={`${formId}-title`} type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input-air" maxLength={TITLE_MAX} required />
                    </div>
                    <div>
                        <label htmlFor={`${formId}-content`} className="block text-sm font-bold text-ink mb-1.5">{CONTENT_LABEL[mode]}</label>
                        <textarea id={`${formId}-content`} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="input-air resize-y" rows={10} maxLength={bodyMaxOf(mode)} aria-describedby={`${formId}-content-count`} required />
                        <CharCount id={`${formId}-content-count`} value={form.content} max={bodyMaxOf(mode)} />
                    </div>
                    {mode === 'review' && (
                        <MultiImageField
                            images={form.image_urls}
                            onChange={(next) => setForm((f) => ({ ...f, image_urls: typeof next === 'function' ? next(f.image_urls) : next }))}
                            max={IMAGES_MAX}
                            onUploadingChange={setUploading}
                            bucket="post-images"
                        />
                    )}
                    {mode === 'review' && (
                        <VisibilityPicker name={`${formId}-visibility`} value={form.is_private} onChange={(v) => setForm((f) => ({ ...f, is_private: v }))} />
                    )}
                </form>
            </WriteModal>
            <DraftCloseDialog {...closeDialog} />
            <LoginPrompt isOpen={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
            <NicknameRequiredModal {...nicknameModal} />
        </>
    );
};

export default TravelQnA;

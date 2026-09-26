import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Heart, Plus, Lock, MapPin, MessageSquare } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useNicknameGate } from '../lib/useNicknameGate';
import { displayAuthor } from '../lib/authorName';
import NicknameRequiredModal from './NicknameRequiredModal';
import { destinationsApi, postLikeApi } from '../lib/db';
import { postPath } from '../lib/boards';
import { regionFromSearch, continentOf } from '../lib/continents';
import { crewVerificationStatus } from '../lib/crewVerification';
import { useDraftActions, usePostDrafts } from '../lib/usePostDrafts';
import { DRAFT_SPECS } from '../lib/draftForms';
import { DraftCloseDialog, DraftLoadBar, DraftSaveButton } from './board/DraftControls';
import BoardShell from './board/BoardShell';
import ContinentBar from './board/ContinentBar';
import ContinentBadge from './board/ContinentBadge';
import ContinentPicker from './board/ContinentPicker';
import SearchPill from './board/SearchPill';
import WriteModal from './board/WriteModal';
import Pagination from './Pagination';
import ListState from './ListState';
import MultiImageField from './board/MultiImageField';
import CharCount from './board/CharCount';
import { IMAGES_MAX, TIP_MAX, TITLE_MAX, bodyMaxOf, imagesPatch } from '../lib/postLimits';
import LoginPrompt from './LoginPrompt';
import CrewBadge from './CrewBadge';
import SEOHead from './SEOHead';

const PAGE = 24;
const EMPTY_FORM = { region_id: '', name: '', desc: '', crewComment: '', image_urls: [] };
// 외부(unsplash) 주소를 쓰면 앱에서 못 받아 로고로 떨어진다(2026-09-17 앱 점검)
const FALLBACK_IMG = '/boards/recommend.webp';

// 화면에 보여줄 좋아요 수 = 레거시 카운터 + post_likes 서버 집계.
// 좋아요는 post_likes(toggle_post_like RPC)만 센다 — 상세 페이지와 같은 숫자. 옛 destinations.likes_count 는 더하지 않는다(codex 지적).
const likeCountOf = (dest, likeMap) => likeMap[dest.id]?.count || 0;

// 목록은 꿀팁 앞 200자(crew_comment_preview)만 받는다(2026-09-26 — 꿀팁 서식 문서·긴 본문은 상세에서만).
// 방금 올린 글(create 응답)은 전체 칸이 있어 preview 도 함께 온다.
const tipPreviewOf = (dest) => dest.crew_comment_preview ?? dest.crew_comment ?? '';

const DestinationCard = ({ dest, likeCount }) => (
    <Link to={postPath('destination', dest.id)} className="card-air overflow-hidden flex flex-col group">
        <div className="aspect-[4/3] overflow-hidden bg-surface-strong">
            <img
                src={dest.image_url || FALLBACK_IMG}
                alt={dest.name}
                loading="lazy"
                decoding="async"
                onError={(e) => { if (!e.currentTarget.src.endsWith('/icon-512x512.png')) e.currentTarget.src = '/icon-512x512.png'; }}
                className="w-full h-full object-cover"
            />
        </div>
        <div className="p-3.5 sm:p-4 flex-1 flex flex-col">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <ContinentBadge regionId={dest.region_id} className="mb-1" />
                    <h3 className="text-[15px] sm:text-[16px] font-bold text-ink tracking-[-0.01em] leading-snug line-clamp-2 group-hover:underline underline-offset-4 decoration-hairline">{dest.name}</h3>
                </div>
                <span className="inline-flex items-center gap-1 text-[13px] font-bold text-muted flex-shrink-0">
                    <Heart size={16} aria-hidden="true" /> {likeCount}
                    <MessageSquare size={15} aria-hidden="true" className="ml-2" /> {dest.comment_count ?? 0}
                </span>
            </div>
            <p className="text-[13px] text-muted mt-1 line-clamp-2 leading-relaxed">{dest.description}</p>
            {tipPreviewOf(dest) && (
                <p className="mt-2 text-[13px] text-body bg-surface-soft rounded-sm px-3 py-2 line-clamp-3">✈️ {tipPreviewOf(dest)}</p>
            )}
            <div className="mt-auto pt-3 flex items-center gap-1 min-w-0 text-[12px] text-muted">
                <span className="truncate">{displayAuthor(dest.profiles?.nickname)}</span>
                <CrewBadge profile={dest.profiles} />
            </div>
        </div>
    </Link>
);

// 승무원 추천지 — 통합 게시판(2026-09-07). 대륙은 말머리(필터 + 글쓰기 필수). 작성은 인증 승무원만.
const Destinations = () => {
    const { user, profile, isLoggedIn, isCrew, profileLoading } = useAuth();
    const { requireNickname, nicknameModal } = useNicknameGate();
    const [searchParams, setSearchParams] = useSearchParams();
    const region = regionFromSearch(searchParams.toString());
    const q = searchParams.get('q') || '';
    const [qInput, setQInput] = useState(q);
    const [page, setPage] = useState(1);
    const [items, setItems] = useState([]);
    const [count, setCount] = useState(0);
    const [likes, setLikes] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [pickerError, setPickerError] = useState('');
    const formId = useId();
    // 임시저장(2026-09-25): "임시저장" 버튼으로 서버에 저장, 글쓰기 창 위 "불러오기"로 고른다
    const drafts = usePostDrafts({ board: 'destination', open: showModal, userId: user?.id });
    const { saveDraft, loadDraft, removeDraft, requestClose, closeDialog } = useDraftActions({ drafts, spec: DRAFT_SPECS.destination, form, setForm, blocked: uploading || submitting });
    const reqRef = useRef(0);

    const crewExpired = isLoggedIn && isCrew && crewVerificationStatus(profile).state === 'expired';
    const canWrite = isLoggedIn && isCrew && !!profile?.crew_verified && !crewExpired;

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

    const setRegion = (id) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (id) next.set('region', id); else next.delete('region');
            return next;
        });
        setPage(1);
    };

    const load = useCallback(async () => {
        const reqId = ++reqRef.current;
        try {
            setLoading(true); setError(null);
            const { data, count: total } = await destinationsApi.getAll({ regionId: region, q, page, limit: PAGE });
            if (reqId !== reqRef.current) return;
            let likeMap = {};
            if (data.length) likeMap = await postLikeApi.getForBoard('destinations', data.map((d) => d.id), user?.id);
            if (reqId !== reqRef.current) return;
            setLikes(likeMap);                  // 병합하면 좋아요가 0이 된 글에 예전 숫자가 남는다(키가 안 옴)
            setItems([...data].sort((a, b) => likeCountOf(b, likeMap) - likeCountOf(a, likeMap)));
            setCount(total);
        } catch (err) {
            if (reqId !== reqRef.current) return;
            console.error('추천지 로드 실패:', err);
            setItems([]); setCount(0);
            setError('추천 명소를 불러오지 못했습니다. 다시 시도해주세요.');
        } finally {
            if (reqId === reqRef.current) setLoading(false);
        }
    }, [region, q, page, user?.id]);

    const keyRef = useRef('');
    useEffect(() => {
        const key = `${region || ''}|${q}`;
        if (keyRef.current !== key) {
            keyRef.current = key;
            if (page !== 1) { setPage(1); return; }
        }
        load();
    }, [load, region, q, page]);

    const openWrite = () => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        if (!canWrite) { alert('승무원 인증을 마친 회원만 명소를 추천할 수 있습니다.'); return; }
        setPickerError('');
        setForm({ ...EMPTY_FORM, region_id: region || '' });
        setShowModal(true);
    };

    const submit = async (e) => {
        e?.preventDefault?.();
        if (!user || submitting || uploading || drafts.busy) return;
        if (!canWrite) { alert('승무원 인증을 마친 회원만 명소를 추천할 수 있습니다.'); setShowModal(false); return; }
        if (!continentOf(form.region_id)) { setPickerError('말머리를 선택해 주세요.'); return; }
        if (!requireNickname(() => submit())) return;
        const draftTicket = drafts.ticket();   // 불러온 임시저장 글 — 등록되면 그 버전만 지운다
        setSubmitting(true);
        try {
            const created = await destinationsApi.create({
                user_id: user.id,
                region_id: form.region_id,
                name: form.name.trim(),
                description: form.desc.trim(),
                crew_comment: form.crewComment.trim(),
                ...imagesPatch(form.image_urls),
            });
            drafts.consume(draftTicket);
            if ((!region || region === created.region_id) && !q && page === 1) {
                setItems((prev) => [created, ...prev]);
                setCount((c) => c + 1);
            } else {
                setPage(1); setQInput('');
                setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('q'); n.set('region', created.region_id); return n; });
            }
            setShowModal(false);
        } catch (err) {
            console.error('추천지 등록 실패:', err);
            alert('등록에 실패했습니다. 다시 시도해주세요.');
        } finally {
            setSubmitting(false);
        }
    };

    const totalPages = Math.max(1, Math.ceil(count / PAGE));
    const regionName = continentOf(region)?.name;

    const action = canWrite ? (
        <button type="button" onClick={openWrite} className="btn-air-primary"><Plus size={16} /> 명소 추천</button>
    ) : isLoggedIn && profileLoading ? null : (
        <div className="flex flex-col items-end gap-1">
            <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-surface-soft text-muted text-[13px] font-semibold whitespace-nowrap"><Lock size={14} aria-hidden="true" /> 인증 승무원만 작성</span>
            {crewExpired && <Link to="/mypage#crew-renewal" className="text-[12px] font-semibold text-error hover:underline">승무원 인증 갱신</Link>}
        </div>
    );

    return (
        <>
            <SEOHead
                title={`${regionName ? `${regionName} ` : ''}여행지 추천 - 커넥트립 ConnectTrip`}
                description="승무원들이 직접 추천하는 전 세계 여행지. 유럽, 미주, 동남아 등 지역별 숨은 명소와 핫플레이스를 만나보세요."
                path="/recommend"
            />
            <BoardShell
                id="destinations"
                title="승무원 추천지"
                action={action}
                bar={<ContinentBar value={region} onChange={setRegion} />}
                search={<SearchPill value={qInput} onChange={setQInput} placeholder="장소명, 설명 검색" className="max-w-md" />}
            >
                {loading || error ? (
                    <ListState loading={loading} error={error} onRetry={load} color="ink" loadingText="불러오는 중..." />
                ) : items.length === 0 ? (
                    <ListState empty emptyIcon={<MapPin size={36} className="mx-auto text-muted-soft mb-3" />} emptyTitle={q ? '검색 결과가 없습니다.' : '등록된 추천 명소가 없습니다.'} emptyDesc={null} />
                ) : (
                    <>
                        <p className="text-[13px] text-muted mb-3">{count.toLocaleString()}곳</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
                            {items.map((dest) => (
                                <DestinationCard key={dest.id} dest={dest} likeCount={likeCountOf(dest, likes)} />
                            ))}
                        </div>
                        {totalPages > 1 && <Pagination currentPage={page} totalPages={totalPages} onPageChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }} color="ink" />}
                    </>
                )}
            </BoardShell>

            <WriteModal
                open={showModal}
                title="숨은 명소 추천"
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
                    <ContinentPicker name={`${formId}-continent`} value={form.region_id} error={pickerError} onChange={(id) => { setPickerError(''); setForm((f) => ({ ...f, region_id: id })); }} />
                    <div>
                        <label htmlFor={`${formId}-name`} className="block text-sm font-bold text-ink mb-1.5">장소명</label>
                        <input id={`${formId}-name`} type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-air" maxLength={TITLE_MAX} required />
                    </div>
                    <div>
                        <label htmlFor={`${formId}-desc`} className="block text-sm font-bold text-ink mb-1.5">간단한 설명</label>
                        <input id={`${formId}-desc`} type="text" value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} className="input-air" maxLength={bodyMaxOf('destination')} required />
                    </div>
                    <div>
                        <label htmlFor={`${formId}-tip`} className="block text-sm font-bold text-ink mb-1.5">승무원 꿀팁</label>
                        <textarea id={`${formId}-tip`} value={form.crewComment} onChange={(e) => setForm({ ...form, crewComment: e.target.value })} className="input-air resize-y" rows={8} maxLength={TIP_MAX} aria-describedby={`${formId}-tip-count`} required />
                        <CharCount id={`${formId}-tip-count`} value={form.crewComment} max={TIP_MAX} />
                    </div>
                    <MultiImageField
                        images={form.image_urls}
                        onChange={(next) => setForm((f) => ({ ...f, image_urls: typeof next === 'function' ? next(f.image_urls) : next }))}
                        max={IMAGES_MAX}
                        onUploadingChange={setUploading}
                    />
                </form>
            </WriteModal>
            <DraftCloseDialog {...closeDialog} />
            <LoginPrompt isOpen={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
            <NicknameRequiredModal {...nicknameModal} />
        </>
    );
};

export default Destinations;

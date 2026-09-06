import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Heart, Plus, Lock, MapPin } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { destinationsApi, postLikeApi } from '../lib/db';
import { regionFromSearch, continentOf } from '../lib/continents';
import { crewVerificationStatus } from '../lib/crewVerification';
import BoardShell from './board/BoardShell';
import ContinentBar from './board/ContinentBar';
import ContinentBadge from './board/ContinentBadge';
import ContinentPicker from './board/ContinentPicker';
import SearchPill from './board/SearchPill';
import WriteModal from './board/WriteModal';
import Pagination from './Pagination';
import ListState from './ListState';
import ImageUpload from './ImageUpload';
import LoginPrompt from './LoginPrompt';
import ShareButtons from './ShareButtons';
import CrewBadge from './CrewBadge';
import AuthorActions from './AuthorActions';
import ReportButton from './ReportButton';
import SEOHead from './SEOHead';

const PAGE = 24;
const EMPTY_FORM = { region_id: '', name: '', desc: '', crewComment: '', image_url: '' };
const FALLBACK_IMG = 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?q=80&w=800&auto=format&fit=crop';

// 화면에 보여줄 좋아요 수 = 레거시 카운터 + post_likes 서버 집계.
const likeCountOf = (dest, likeMap) => (dest.likes_count || 0) + (likeMap[dest.id]?.count || 0);

const DestinationCard = ({ dest, liked, likeCount, onToggleLike, currentUserId }) => (
    <article className="card-air overflow-hidden flex flex-col">
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
                    <h3 className="text-[15px] sm:text-[16px] font-bold text-ink tracking-[-0.01em] leading-snug line-clamp-2">{dest.name}</h3>
                </div>
                <button type="button" onClick={() => onToggleLike(dest.id)} aria-pressed={liked} className={`inline-flex items-center gap-1 text-[13px] font-bold flex-shrink-0 ${liked ? 'text-rausch' : 'text-muted hover:text-ink'}`}>
                    <Heart size={16} fill={liked ? 'currentColor' : 'none'} /> {likeCount}
                </button>
            </div>
            <p className="text-[13px] text-muted mt-1 line-clamp-2 leading-relaxed">{dest.description}</p>
            {dest.crew_comment && (
                <p className="mt-2 text-[13px] text-body bg-surface-soft rounded-sm px-3 py-2 line-clamp-3">✈️ {dest.crew_comment}</p>
            )}
            <div className="mt-auto pt-3 flex items-center justify-between gap-2 text-[12px] text-muted">
                <span className="flex items-center gap-1 min-w-0">
                    <span className="truncate">{dest.profiles?.name || '익명 승무원'}</span>
                    <CrewBadge profile={dest.profiles} />
                    <AuthorActions userId={dest.user_id} name={dest.profiles?.name || ''} size={12} />
                </span>
                <span className="flex items-center gap-0.5 flex-shrink-0">
                    <ShareButtons title={`${dest.name} - ConnectTrip 추천 여행지`} description={dest.description} />
                    {currentUserId && currentUserId !== dest.user_id && (
                        <ReportButton postId={dest.id} boardType="destination" reportedUserId={dest.user_id} />
                    )}
                </span>
            </div>
        </div>
    </article>
);

// 승무원 추천지 — 통합 게시판(2026-09-07). 대륙은 말머리(필터 + 글쓰기 필수). 작성은 인증 승무원만.
const Destinations = () => {
    const { user, profile, isLoggedIn, isCrew, profileLoading } = useAuth();
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
    const formId = useId();
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
            setLikes(likeMap);
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

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPage(1); }, [region, q]);

    const toggleLike = async (id) => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        try {
            const { data, error: e } = await postLikeApi.toggle('destinations', id);
            if (e) throw e;
            setLikes((prev) => ({ ...prev, [id]: { count: data.likes_count, liked: data.liked } }));
        } catch (err) {
            console.error('좋아요 실패:', err);
            alert(err?.message?.includes('phone') ? '휴대폰 인증 후 좋아요할 수 있어요.' : '좋아요 처리에 실패했습니다.');
        }
    };

    const openWrite = () => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        if (!canWrite) { alert('승무원 인증을 마친 회원만 명소를 추천할 수 있습니다.'); return; }
        setForm({ ...EMPTY_FORM, region_id: region || '' });
        setShowModal(true);
    };

    const submit = async (e) => {
        e.preventDefault();
        if (!user || submitting || uploading) return;
        if (!canWrite) { alert('승무원 인증을 마친 회원만 명소를 추천할 수 있습니다.'); setShowModal(false); return; }
        if (!continentOf(form.region_id)) { alert('말머리를 선택해 주세요.'); return; }
        setSubmitting(true);
        try {
            const created = await destinationsApi.create({
                user_id: user.id,
                region_id: form.region_id,
                name: form.name.trim(),
                description: form.desc.trim(),
                crew_comment: form.crewComment.trim(),
                image_url: form.image_url || null,
            });
            if ((!region || region === created.region_id) && !q && page === 1) {
                setItems((prev) => [created, ...prev]);
                setCount((c) => c + 1);
            } else {
                setRegion(created.region_id); setQInput('');
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
                title={`${regionName ? `${regionName} ` : ''}여행지 추천 - ConnectTrip`}
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
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
                            {items.map((dest) => (
                                <DestinationCard key={dest.id} dest={dest} liked={!!likes[dest.id]?.liked} likeCount={likeCountOf(dest, likes)} onToggleLike={toggleLike} currentUserId={user?.id} />
                            ))}
                        </div>
                        {totalPages > 1 && <Pagination currentPage={page} totalPages={totalPages} onPageChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }} color="ink" />}
                    </>
                )}
            </BoardShell>

            <WriteModal
                open={showModal}
                title="숨은 명소 추천"
                onClose={() => setShowModal(false)}
                footer={
                    <>
                        <button type="button" onClick={() => setShowModal(false)} className="btn-air-link">취소</button>
                        <button type="submit" form={`${formId}-form`} disabled={submitting || uploading} className="btn-air-primary">{submitting ? '등록 중...' : uploading ? '사진 올리는 중...' : '등록'}</button>
                    </>
                }
            >
                <form id={`${formId}-form`} onSubmit={submit} className="space-y-5">
                    <ContinentPicker name={`${formId}-continent`} value={form.region_id} onChange={(id) => setForm({ ...form, region_id: id })} />
                    <div>
                        <label htmlFor={`${formId}-name`} className="block text-sm font-bold text-ink mb-1.5">장소명</label>
                        <input id={`${formId}-name`} type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-air" maxLength={80} required />
                    </div>
                    <div>
                        <label htmlFor={`${formId}-desc`} className="block text-sm font-bold text-ink mb-1.5">간단한 설명</label>
                        <input id={`${formId}-desc`} type="text" value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} className="input-air" maxLength={200} required />
                    </div>
                    <div>
                        <label htmlFor={`${formId}-tip`} className="block text-sm font-bold text-ink mb-1.5">승무원 꿀팁</label>
                        <textarea id={`${formId}-tip`} value={form.crewComment} onChange={(e) => setForm({ ...form, crewComment: e.target.value })} className="input-air resize-none" rows={4} maxLength={1000} required />
                    </div>
                    <div>
                        <span className="block text-sm font-bold text-ink mb-1.5">사진 (선택)</span>
                        <ImageUpload onUpload={(url) => { if (url !== undefined) setForm((f) => ({ ...f, image_url: url })); }} onUploadingChange={setUploading} />
                    </div>
                </form>
            </WriteModal>
            <LoginPrompt isOpen={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
        </>
    );
};

export default Destinations;

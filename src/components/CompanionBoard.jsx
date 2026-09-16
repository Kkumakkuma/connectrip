import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Users, Calendar, Heart, Plus, MessageSquare } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useNicknameGate } from '../lib/useNicknameGate';
import { BANNED_MESSAGE, isBannedError, useBannedGuard } from '../lib/banned';
import { displayAuthor } from '../lib/authorName';
import NicknameRequiredModal from './NicknameRequiredModal';
import { companionApi, postLikeApi } from '../lib/db';
import { postPath, COMPANION_STATUS } from '../lib/boards';
import { regionFromSearch, continentOf } from '../lib/continents';
import BoardShell from './board/BoardShell';
import ContinentBar from './board/ContinentBar';
import ContinentBadge from './board/ContinentBadge';
import ContinentPicker from './board/ContinentPicker';
import SearchPill from './board/SearchPill';
import WriteModal from './board/WriteModal';
import Pagination from './Pagination';
import ListState from './ListState';
import CrewBadge from './CrewBadge';
import LoginPrompt from './LoginPrompt';
import SEOHead from './SEOHead';

const PAGE = 20;
const EMPTY_FORM = { region_id: '', title: '', country: '', date: '', members: '', content: '' };
const STATUS_CLASS = { open: 'bg-rausch-soft text-rausch', closed: 'bg-surface-soft text-muted' };

// 여행 동행자 모집 — 통합 게시판(2026-09-07). 대륙은 말머리(ContinentBar 필터, 글쓰기 시 ContinentPicker 필수).
// 목록은 한 줄 행이고 누르면 /post/companion/:id 상세로 들어간다(2026-09-14 게시판 정비).
// 목록·필터·검색·페이지는 전부 서버(companionApi.getAll)가 처리하고, ?region= / ?q= 와 동기한다.
const CompanionBoard = () => {
    const { user, profile, isLoggedIn } = useAuth();
    const { requireNickname, nicknameModal } = useNicknameGate();
    const { stillBanned, syncAfterBannedError } = useBannedGuard();
    const [searchParams, setSearchParams] = useSearchParams();
    const region = regionFromSearch(searchParams.toString());
    const q = searchParams.get('q') || '';
    const [qInput, setQInput] = useState(q);
    const [page, setPage] = useState(1);
    const [posts, setPosts] = useState([]);
    const [count, setCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [likes, setLikes] = useState({});
    const [showModal, setShowModal] = useState(false);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [submitting, setSubmitting] = useState(false);
    const [pickerError, setPickerError] = useState('');
    const formId = useId();
    const reqRef = useRef(0);

    // 검색어 입력 → 300ms 뒤 URL ?q= 반영(공유·뒤로가기 보존)
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
            const { data, count: total } = await companionApi.getAll({ regionId: region, q, page, limit: PAGE });
            if (reqId !== reqRef.current) return;
            setPosts(data); setCount(total);
            if (data.length) {
                const m = await postLikeApi.getForBoard('companion_posts', data.map((p) => p.id), user?.id);
                if (reqId !== reqRef.current) return;
                setLikes(m);                    // 병합하면 좋아요가 0이 된 글에 예전 숫자가 남는다(키가 안 옴)
            }
        } catch (err) {
            if (reqId !== reqRef.current) return;
            console.error('동행 목록 실패:', err);
            setPosts([]); setCount(0);
            setError('게시글을 불러오지 못했습니다. 다시 시도해주세요.');
        } finally {
            if (reqId === reqRef.current) setLoading(false);
        }
    }, [region, q, page, user?.id]);

    // 대륙·검색어가 바뀌면 먼저 1페이지로 돌린 뒤에 조회한다(이전 페이지 번호로 헛조회 방지)
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
        setPickerError('');
        setForm({ ...EMPTY_FORM, region_id: region || '' });
        setShowModal(true);
    };

    const submit = async (e) => {
        e?.preventDefault?.();
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        if (submitting) return;
        if (!continentOf(form.region_id)) { setPickerError('말머리를 선택해 주세요.'); return; }
        // 이용 제한 계정은 동행 모집 글을 올릴 수 없다(서버 트리거도 같은 이유로 막는다).
        if (await stillBanned()) { alert(BANNED_MESSAGE); return; }
        if (!requireNickname(() => submit())) return;
        setSubmitting(true);
        try {
            const created = await companionApi.create({
                region_id: form.region_id,
                title: form.title.trim(),
                country: form.country.trim(),
                travel_date: form.date,
                members_needed: form.members.trim(),
                content: form.content.trim(),
                status: 'open',
                author_name: profile?.nickname || null,   // 서버 트리거가 profiles.nickname 으로 덮어쓴다
                user_id: user.id,
            });
            if ((!region || region === created.region_id) && !q && page === 1) {
                setPosts((prev) => [created, ...prev].slice(0, PAGE));
                setCount((c) => c + 1);
            } else {
                setPage(1); setQInput('');
                setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('q'); n.set('region', created.region_id); return n; });
            }
            setShowModal(false);
        } catch (err) {
            console.error('동행 글 등록 실패:', err);
            if (isBannedError(err)) { syncAfterBannedError(); alert(BANNED_MESSAGE); }
            else alert('게시글 등록에 실패했습니다. 다시 시도해주세요.');
        } finally {
            setSubmitting(false);
        }
    };

    const totalPages = Math.max(1, Math.ceil(count / PAGE));
    const regionName = continentOf(region)?.name;

    return (
        <>
            <SEOHead
                title={`${regionName ? `${regionName} ` : ''}여행 동행자 모집 - 커넥트립 ConnectTrip`}
                description="함께 여행할 동행자를 찾아보세요. 지역별 여행 동행 모집 게시판."
                path="/companion"
            />
            <BoardShell
                id="companion"
                title="여행 동행자 모집"
                action={<button type="button" onClick={openWrite} className="btn-air-primary"><Plus size={16} /> 글쓰기</button>}
                bar={<ContinentBar value={region} onChange={setRegion} />}
                search={<SearchPill value={qInput} onChange={setQInput} placeholder="제목, 국가/도시, 내용 검색" className="max-w-md" />}
            >
                {loading || error ? (
                    <ListState loading={loading} error={error} onRetry={load} color="ink" loadingText="불러오는 중..." />
                ) : posts.length === 0 ? (
                    <ListState empty emptyTitle={q ? '검색 결과가 없습니다.' : '등록된 모집글이 없습니다.'} emptyDesc={null} />
                ) : (
                    <>
                        <p className="text-[13px] text-muted mb-2">{count.toLocaleString()}건</p>
                        <ul className="divide-y divide-hairline-soft border-t border-b border-hairline-soft">
                            {posts.map((post) => {
                                const status = post.status === 'closed' ? 'closed' : 'open';
                                return (
                                    <li key={post.id}>
                                        <Link to={postPath('companion', post.id)} className="block py-4 sm:py-5 group">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <ContinentBadge regionId={post.region_id} className="flex-shrink-0" />
                                                <span className={`inline-flex items-center rounded-full text-[11px] font-bold px-2 py-0.5 whitespace-nowrap flex-shrink-0 ${STATUS_CLASS[status]}`}>
                                                    {COMPANION_STATUS[status]}
                                                </span>
                                                <h3 className="min-w-0 flex-1 truncate text-[16px] font-bold text-ink tracking-[-0.01em] group-hover:underline underline-offset-4 decoration-hairline">
                                                    {post.title}
                                                </h3>
                                            </div>
                                            <div className="mt-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap text-[13px] text-muted">
                                                <span className="inline-flex items-center gap-1 min-w-0">
                                                    <span className="truncate max-w-[10rem]">{displayAuthor(post.author_name)}</span>
                                                    <CrewBadge profile={post.profiles} />
                                                </span>
                                                {post.country && <span className="truncate max-w-[10rem]">{post.country}</span>}
                                                <span className="inline-flex items-center gap-1 whitespace-nowrap"><Calendar size={13} aria-hidden="true" />{post.travel_date || '미정'}</span>
                                                <span className="inline-flex items-center gap-1 whitespace-nowrap"><Users size={13} aria-hidden="true" />{post.members_needed}명</span>
                                                <span className="ml-auto inline-flex items-center gap-3 whitespace-nowrap">
                                                    <span>{new Date(post.created_at).toLocaleDateString('ko-KR')}</span>
                                                    <span className="inline-flex items-center gap-1"><Heart size={13} aria-hidden="true" />{likes[post.id]?.count || 0}</span>
                                                    <span className="inline-flex items-center gap-1"><MessageSquare size={13} aria-hidden="true" />{post.comment_count ?? 0}</span>
                                                </span>
                                            </div>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                        {totalPages > 1 && <Pagination currentPage={page} totalPages={totalPages} onPageChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }} color="ink" />}
                    </>
                )}
            </BoardShell>

            <WriteModal
                open={showModal}
                title="동행자 모집글 작성"
                onClose={() => setShowModal(false)}
                footer={
                    <>
                        <button type="button" onClick={() => setShowModal(false)} className="btn-air-link">취소</button>
                        <button type="submit" form={`${formId}-form`} disabled={submitting} className="btn-air-primary">{submitting ? '등록 중...' : '등록'}</button>
                    </>
                }
            >
                <form id={`${formId}-form`} onSubmit={submit} className="space-y-5">
                    <ContinentPicker name={`${formId}-continent`} value={form.region_id} error={pickerError} onChange={(id) => { setPickerError(''); setForm((f) => ({ ...f, region_id: id })); }} />
                    <div>
                        <label htmlFor={`${formId}-title`} className="block text-sm font-bold text-ink mb-1.5">제목</label>
                        <input id={`${formId}-title`} type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input-air" maxLength={80} required />
                    </div>
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
                    <div>
                        <label htmlFor={`${formId}-content`} className="block text-sm font-bold text-ink mb-1.5">내용</label>
                        <textarea id={`${formId}-content`} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="input-air resize-none" rows={6} maxLength={3000} required />
                    </div>
                </form>
            </WriteModal>
            <LoginPrompt isOpen={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
            <NicknameRequiredModal {...nicknameModal} />
        </>
    );
};

export default CompanionBoard;

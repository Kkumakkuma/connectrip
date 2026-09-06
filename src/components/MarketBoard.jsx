import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShoppingBag, Heart, Gift, MapPin, Plus, Search, Users } from 'lucide-react';
import MarketFeed from './MarketFeed';
import MarketListingForm from './MarketListingForm';
import Pagination from './Pagination';
import ReportButton from './ReportButton';
import ShareButtons from './ShareButtons';
import CrewBadge from './CrewBadge';
import { useAuth } from '../lib/AuthContext';
import { marketApi } from '../lib/db';
import { regionFromSearch } from '../lib/continents';
import BoardShell from './board/BoardShell';
import BoardTabs from './board/BoardTabs';
import SearchPill from './board/SearchPill';
import WriteModal from './board/WriteModal';
import ImageUpload from './ImageUpload';
import LoginPrompt from './LoginPrompt';
import SEOHead from './SEOHead';
import ListState from './ListState';

const TABS = [
    { id: 'sell', label: '물품팔아요', icon: ShoppingBag },
    { id: 'buy', label: '물품구해요', icon: Search },
    { id: 'share', label: '무료 나눔', icon: Gift },
    { id: 'groupbuy', label: '공동구매', icon: Users },
];
const PAGE = 12;
const EMPTY_FORM = { title: '', price: '', location: '', content: '', image_url: '' };

// 물품거래 및 나눔(2026-09-07 에어비앤비 톤). 탭 4개: 판매·나눔은 당근식 MarketFeed(나눔은 대륙 말머리 필터),
// 구해요·공동구매는 카드 그리드. ?tab= / ?region= / ?q= 동기.
const MarketBoard = () => {
    const { user, profile, isLoggedIn } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get('tab');
    const mode = TABS.some((t) => t.id === tabParam) ? tabParam : 'sell';
    const region = regionFromSearch(searchParams.toString());
    const q = searchParams.get('q') || '';
    const [qInput, setQInput] = useState(q);
    const [page, setPage] = useState(1);
    const [items, setItems] = useState([]);
    const [stats, setStats] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [uploading, setUploading] = useState(false);
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
    // 뒤로가기·외부 링크로 URL 의 q 가 바뀌면 입력값도 맞춘다(입력 중이면 건드리지 않음)
    useEffect(() => { setQInput((cur) => (cur.trim() === q ? cur : q)); }, [q]);

    const setTab = (id) => {
        setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set('tab', id); n.delete('q'); n.delete('region'); return n; });
        setQInput(''); setPage(1);
    };
    const setRegion = (id) => {
        setSearchParams((prev) => { const n = new URLSearchParams(prev); if (id) n.set('region', id); else n.delete('region'); return n; });
    };

    const load = useCallback(async () => {
        const reqId = ++reqRef.current;
        try {
            setLoading(true); setError(null);
            const data = await marketApi.getAll(mode) || [];
            if (reqId !== reqRef.current) return;
            setItems(data);
            if (mode === 'sell' || mode === 'share') {
                marketApi.stats(data.map((d) => d.id)).then((s) => { if (reqId === reqRef.current) setStats(s); }).catch(() => setStats({}));
            }
        } catch (err) {
            if (reqId !== reqRef.current) return;
            console.error('장터 데이터 로딩 실패:', err);
            setItems([]);
            setError('목록을 불러오지 못했습니다. 다시 시도해주세요.');
        } finally {
            if (reqId === reqRef.current) setLoading(false);
        }
    }, [mode]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPage(1); }, [q, mode]);

    const openWrite = () => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        setForm(EMPTY_FORM);
        setShowModal(true);
    };

    // 구해요·공동구매 등록(판매·나눔은 MarketListingForm)
    const submit = async (e) => {
        e.preventDefault();
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        if (submitting || uploading) return;
        setSubmitting(true);
        try {
            const digits = String(form.price || '').replace(/[^0-9]/g, '');
            const listing = {
                title: form.title.trim(), content: form.content.trim(), type: mode,
                author: profile?.nickname || profile?.name || '익명', user_id: user.id,
                location: form.location.trim() || null,
                image_url: form.image_url || null,
            };
            if (mode === 'buy') listing.budget = digits ? Number(digits) : null;
            if (mode === 'groupbuy') listing.price = digits ? Number(digits) : null;
            const created = await marketApi.create(listing);
            setItems((prev) => [created, ...prev]);
            setPage(1);
            setShowModal(false);
        } catch (err) {
            console.error('게시글 등록 실패:', err);
            alert('게시글 등록에 실패했습니다. 다시 시도해주세요.');
        } finally {
            setSubmitting(false);
        }
    };

    const ql = q.toLowerCase();
    const filtered = items.filter((i) => !ql || (i.title || '').toLowerCase().includes(ql) || (i.content || '').toLowerCase().includes(ql));
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
    const paged = filtered.slice((page - 1) * PAGE, page * PAGE);
    useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
    const canWrite = mode !== 'groupbuy' || profile?.role === 'admin';
    const isFeed = mode === 'sell' || mode === 'share';

    return (
        <>
            <SEOHead title="물품거래 및 나눔 - ConnectTrip" description="여행 물품 거래, 나눔, 중고 거래를 ConnectTrip에서 만나보세요." path="/market" />
            <BoardShell
                id="market"
                title="물품거래 및 나눔"
                action={canWrite ? <button type="button" onClick={openWrite} className="btn-air-primary"><Plus size={16} /> 글쓰기</button> : null}
                tabs={<BoardTabs items={TABS} value={mode} onChange={setTab} />}
                search={isFeed ? null : <SearchPill value={qInput} onChange={setQInput} placeholder="제목, 내용 검색" className="max-w-md" />}
            >
                {isFeed ? (
                    <MarketFeed
                        type={mode}
                        initialQuery={q}
                        items={items}
                        stats={stats}
                        loading={loading}
                        error={error}
                        onRetry={load}
                        isLoggedIn={isLoggedIn}
                        region={mode === 'share' ? region : null}
                        onRegion={setRegion}
                        onWrite={openWrite}
                    />
                ) : loading || error ? (
                    <ListState loading={loading} error={error} onRetry={load} color="ink" />
                ) : paged.length === 0 ? (
                    <ListState empty emptyIcon={mode === 'buy' ? <Search size={36} className="mx-auto text-muted-soft mb-3" /> : <Users size={36} className="mx-auto text-muted-soft mb-3" />} emptyTitle={q ? '검색 결과가 없습니다.' : mode === 'buy' ? '등록된 구매 요청이 없습니다.' : '등록된 공동구매가 없습니다.'} emptyDesc={null} />
                ) : (
                    <>
                        <p className="text-[13px] text-muted mb-3">{filtered.length.toLocaleString()}건</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
                            {paged.map((item) => (
                                <article key={item.id} className="card-air overflow-hidden flex flex-col">
                                    <div className="aspect-[4/3] bg-surface-strong overflow-hidden flex items-center justify-center text-muted-soft">
                                        {item.image_url ? <img src={item.image_url} alt={item.title} loading="lazy" decoding="async" className="w-full h-full object-cover" /> : (mode === 'buy' ? <Search size={28} /> : <Users size={28} />)}
                                    </div>
                                    <div className="p-3.5 sm:p-4 flex-1 flex flex-col">
                                        <span className="inline-flex w-fit items-center rounded-full bg-surface-soft text-ink text-[11px] font-bold px-2 py-0.5 mb-1">{mode === 'buy' ? '구해요' : '공동구매'}</span>
                                        <h3 className="text-[15px] sm:text-[16px] font-bold text-ink tracking-[-0.01em] leading-snug line-clamp-2">{item.title}</h3>
                                        <p className="text-[15px] font-extrabold text-ink mt-1">
                                            {mode === 'buy'
                                                ? (item.budget != null ? `${Number(item.budget).toLocaleString()}원` : '예산 미정')
                                                : (item.price != null ? `1인 ${Number(item.price).toLocaleString()}원` : '가격 미정')}
                                        </p>
                                        {item.location && <p className="text-[12px] text-muted mt-0.5 inline-flex items-center gap-1"><MapPin size={11} aria-hidden="true" />{mode === 'groupbuy' ? `모집 ${item.location}` : item.location}</p>}
                                        <p className="text-[13px] text-muted mt-1 line-clamp-2">{item.content}</p>
                                        <div className="mt-auto pt-3 flex items-center justify-between gap-2 text-[12px] text-muted">
                                            <span className="flex items-center gap-1 min-w-0">
                                                <span className="truncate">{item.author}</span>
                                                <CrewBadge profile={item.profiles} />
                                            </span>
                                            <span className="flex items-center gap-0.5 flex-shrink-0">
                                                <ShareButtons title={item.title} description={item.content} />
                                                {user?.id !== item.user_id && <ReportButton postId={item.id} boardType="market" reportedUserId={item.user_id} />}
                                            </span>
                                        </div>
                                    </div>
                                </article>
                            ))}
                        </div>
                        {totalPages > 1 && <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} color="ink" />}
                    </>
                )}
            </BoardShell>

            <WriteModal
                open={showModal}
                title={mode === 'sell' ? '물품 등록' : mode === 'buy' ? '구매 요청 등록' : mode === 'groupbuy' ? '공동구매 모집' : '나눔 물품 등록'}
                onClose={() => setShowModal(false)}
                footer={isFeed ? null : (
                    <>
                        <button type="button" onClick={() => setShowModal(false)} className="btn-air-link">취소</button>
                        <button type="submit" form={`${formId}-form`} disabled={submitting || uploading} className="btn-air-primary">{submitting ? '등록 중...' : uploading ? '사진 올리는 중...' : '등록'}</button>
                    </>
                )}
            >
                {isFeed ? (
                    <MarketListingForm
                        mode={mode}
                        defaultRegion={region}
                        onDone={(item) => { setItems((prev) => [item, ...prev]); setShowModal(false); }}
                        onCancel={() => setShowModal(false)}
                    />
                ) : (
                    <form id={`${formId}-form`} onSubmit={submit} className="space-y-5">
                        <div>
                            <label htmlFor={`${formId}-title`} className="block text-sm font-bold text-ink mb-1.5">제목</label>
                            <input id={`${formId}-title`} type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input-air" maxLength={80} required />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label htmlFor={`${formId}-price`} className="block text-sm font-bold text-ink mb-1.5">{mode === 'buy' ? '희망 예산' : '1인 가격'}</label>
                                <input id={`${formId}-price`} type="text" inputMode="numeric" maxLength={9} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^0-9]/g, '').slice(0, 9) })} className="input-air" />
                            </div>
                            <div>
                                <label htmlFor={`${formId}-location`} className="block text-sm font-bold text-ink mb-1.5">{mode === 'buy' ? '희망 거래 장소' : '모집 인원'}</label>
                                <input id={`${formId}-location`} type="text" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="input-air" maxLength={60} required />
                            </div>
                        </div>
                        {mode === 'groupbuy' && (
                            <div>
                                <span className="block text-sm font-bold text-ink mb-1.5">사진 (선택)</span>
                                <ImageUpload bucket="images" onUpload={(url) => setForm((f) => ({ ...f, image_url: url || '' }))} onUploadingChange={setUploading} />
                            </div>
                        )}
                        <div>
                            <label htmlFor={`${formId}-content`} className="block text-sm font-bold text-ink mb-1.5">상세 설명</label>
                            <textarea id={`${formId}-content`} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="input-air resize-none" rows={6} maxLength={3000} required />
                        </div>
                    </form>
                )}
            </WriteModal>
            <LoginPrompt isOpen={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
        </>
    );
};

export default MarketBoard;

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Heart, MessageCircle, Eye, MapPin, ChevronLeft, ChevronRight, Coins, X } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { marketApi, marketTransactionApi, chatApi } from '../lib/db';
import { timeAgo, priceLabel, statusLabel, chatErrorMessage } from '../lib/chat';
import CrewBadge from '../components/CrewBadge';
import ReportButton from '../components/ReportButton';
import ShareButtons from '../components/ShareButtons';
import AuthorActions from '../components/AuthorActions';
import MarketListingForm from '../components/MarketListingForm';
import SEOHead from '../components/SEOHead';

const REGIONS = [
    { id: 'europe', name: '유럽', icon: '🏰' }, { id: 'americas', name: '미주', icon: '🗽' }, { id: 'africa', name: '아프리카', icon: '🦁' },
    { id: 'southeast-asia', name: '동남아', icon: '🏝️' }, { id: 'asia', name: '아시아', icon: '🐅' }, { id: 'oceania', name: '오세아니아', icon: '🦘' },
];

// 매물 상세(당근식). 판매자: 상태 변경·끌어올리기·수정·삭제. 구매자: 찜·채팅하기·(가격 있으면) 포인트 결제.
const MarketDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user, profile, isLoggedIn, fetchProfile } = useAuth();
    const [item, setItem] = useState(null);
    const [stats, setStats] = useState({ favorites: 0, chats: 0, mine_fav: false });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [idx, setIdx] = useState(0);
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState(false);
    const [paying, setPaying] = useState(false);

    const isOwner = !!user && item?.user_id === user.id;
    const isShare = item?.type === 'share';
    const images = item ? (item.image_urls?.length ? item.image_urls : item.image_url ? [item.image_url] : []) : [];

    const load = useCallback(async () => {
        try {
            setLoading(true); setError(null);
            const data = await marketApi.getById(id);
            if (!data) { setError('삭제되었거나 없는 글입니다.'); return; }
            setItem(data);
            const st = await marketApi.stats([id]).catch(() => ({}));
            setStats(st[id] || { favorites: 0, chats: 0, mine_fav: false });
        } catch (err) {
            console.error('매물 로드 실패:', err);
            setError('불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { load(); }, [load]);

    // 조회수: 이 브라우저 세션에서 글당 1번만
    useEffect(() => {
        if (!item || !isLoggedIn) return;
        try {
            const key = `mv:${item.id}`;
            if (sessionStorage.getItem(key)) return;
            sessionStorage.setItem(key, '1');
            marketApi.bumpView(item.id).catch(() => {});
        } catch { /* 저장소 없음 */ }
    }, [item, isLoggedIn]);

    const toggleFav = async () => {
        if (!isLoggedIn || busy) return;
        setBusy(true);
        try {
            const on = !stats.mine_fav;
            await marketApi.setFavorite(id, on);
            setStats((s) => ({ ...s, mine_fav: on, favorites: Math.max(0, (s.favorites || 0) + (on ? 1 : -1)) }));
        } catch (err) {
            console.error('찜 실패:', err);
        } finally {
            setBusy(false);
        }
    };

    const openChat = async () => {
        if (!isLoggedIn || busy || !item) return;
        setBusy(true);
        try {
            const roomId = await chatApi.open(item.user_id, item.id);
            navigate(`/chat/${roomId}`);
        } catch (err) {
            console.error('채팅 열기 실패:', err);
            alert(chatErrorMessage(err, '대화방을 열지 못했습니다.'));
        } finally {
            setBusy(false);
        }
    };

    const setStatus = async (status) => {
        if (busy) return;
        setBusy(true);
        try {
            await marketApi.setStatus(id, status);
            setItem((it) => ({ ...it, status }));
        } catch (err) {
            console.error('상태 변경 실패:', err);
            alert('상태를 바꾸지 못했습니다.');
        } finally {
            setBusy(false);
        }
    };

    const bump = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await marketApi.bump(id);
            setItem((it) => ({ ...it, refreshed_at: new Date().toISOString() }));
            alert('끌어올렸습니다.');
        } catch (err) {
            alert(chatErrorMessage(err, '끌어올리지 못했습니다.'));
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!window.confirm('이 글을 삭제할까요?')) return;
        try {
            await marketApi.delete(id);
            navigate(`/market?tab=${isShare ? 'share' : 'sell'}`);
        } catch (err) {
            console.error('삭제 실패:', err);
            alert('삭제에 실패했습니다.');
        }
    };

    const pay = async () => {
        const total = Number(item?.price) || 0;
        const myPoints = profile?.points_balance || 0;
        if (total <= 0) return;
        if (myPoints < total) { alert(`포인트가 부족합니다. 필요 ${total.toLocaleString()}P / 보유 ${myPoints.toLocaleString()}P`); return; }
        if (!window.confirm(`${total.toLocaleString()}P로 결제할까요?`)) return;
        setPaying(true);
        try {
            await marketTransactionApi.purchaseWithPoints(id, total);
            if (user?.id) fetchProfile?.(user.id);
            alert('결제 완료');
            await load();
        } catch (err) {
            console.error('결제 실패:', err);
            alert('결제에 실패했습니다.');
        } finally {
            setPaying(false);
        }
    };

    if (loading) return <section className="py-24 text-center text-sm text-gray-400">불러오는 중...</section>;
    if (error || !item) return <section className="py-24 text-center text-sm text-gray-500">{error || '없는 글입니다.'}</section>;

    const seller = item.profiles || {};
    const sellerName = seller.nickname || seller.name || item.author || '익명';

    return (
        <section className="pt-20 pb-24 bg-gray-50 min-h-screen">
            <SEOHead title={`${item.title} - ConnectTrip 장터`} description={item.content || ''} />
            <div className="container mx-auto px-0 sm:px-4 max-w-3xl">
                <div className="bg-white sm:rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="relative bg-gray-100 aspect-square sm:aspect-[4/3]">
                        {images.length > 0 ? (
                            <img src={images[idx] || images[0]} alt={item.title} className={`w-full h-full object-cover ${item.status === 'sold' ? 'opacity-50' : ''}`} />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-300 text-sm">사진 없음</div>
                        )}
                        <button type="button" onClick={() => navigate(-1)} className="absolute top-3 left-3 p-2 rounded-full bg-black/40 text-white" aria-label="뒤로"><ArrowLeft size={18} /></button>
                        <div className="absolute top-3 right-3 flex items-center gap-1">
                            <ShareButtons title={item.title} description={item.content} />
                            {!isOwner && <ReportButton postId={item.id} boardType={isShare ? 'market_share' : 'market'} reportedUserId={item.user_id} />}
                        </div>
                        {images.length > 1 && (
                            <>
                                <button type="button" onClick={() => setIdx((i) => (i - 1 + images.length) % images.length)} className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 text-white" aria-label="이전 사진"><ChevronLeft size={18} /></button>
                                <button type="button" onClick={() => setIdx((i) => (i + 1) % images.length)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 text-white" aria-label="다음 사진"><ChevronRight size={18} /></button>
                                <span className="absolute bottom-3 right-3 px-2 py-0.5 rounded-full bg-black/50 text-white text-[11px]">{idx + 1}/{images.length}</span>
                            </>
                        )}
                        {item.status !== 'active' && (
                            <span className={`absolute bottom-3 left-3 px-2 py-1 rounded text-xs font-bold text-white ${item.status === 'sold' ? 'bg-gray-700' : 'bg-green-600'}`}>{statusLabel(item)}</span>
                        )}
                    </div>

                    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
                        <span className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden text-gray-500 font-bold">
                            {seller.avatar_url ? <img src={seller.avatar_url} alt="" className="w-full h-full object-cover" /> : sellerName.charAt(0)}
                        </span>
                        <span className="min-w-0 flex-1 flex items-center gap-1.5">
                            <span className="text-sm font-bold text-gray-900 truncate">{sellerName}</span>
                            <CrewBadge profile={seller} />
                            {!isOwner && <AuthorActions userId={item.user_id} name={sellerName} />}
                        </span>
                        {isOwner && (
                            <select value={item.status} onChange={(e) => setStatus(e.target.value)} disabled={busy} className="text-xs font-bold border border-gray-200 rounded-lg px-2 py-1.5 bg-white" aria-label="상태">
                                <option value="active">{isShare ? '나눔중' : '판매중'}</option>
                                <option value="reserved">예약중</option>
                                <option value="sold">{isShare ? '나눔완료' : '거래완료'}</option>
                            </select>
                        )}
                    </div>

                    <div className="px-4 py-4">
                        <h1 className="text-lg font-extrabold text-gray-900">{isShare && item.country ? `[${item.country}] ` : ''}{item.title}</h1>
                        <p className="text-[11px] text-gray-400 mt-1 flex items-center gap-1 flex-wrap">
                            {isShare && item.region_id && <span>{REGIONS.find((r) => r.id === item.region_id)?.name || item.region_id} ·</span>}
                            {!isShare && item.transaction_type && <span>{item.transaction_type === 'delivery' ? '택배거래' : '직거래'} ·</span>}
                            {item.location && <span className="flex items-center gap-0.5"><MapPin size={10} />{item.location} ·</span>}
                            <span>{timeAgo(item.created_at)}</span>
                        </p>
                        <p className={`text-xl font-black mt-2 ${isShare ? 'text-pink-600' : 'text-gray-900'}`}>{priceLabel(item)}</p>
                        <p className="text-sm text-gray-800 whitespace-pre-wrap break-words mt-4">{item.content}</p>
                        <p className="text-[11px] text-gray-400 mt-4 flex items-center gap-3">
                            <span className="flex items-center gap-1"><Heart size={12} />{stats.favorites || 0}</span>
                            <span className="flex items-center gap-1"><MessageCircle size={12} />{stats.chats || 0}</span>
                            <span className="flex items-center gap-1"><Eye size={12} />{item.view_count || 0}</span>
                        </p>
                    </div>
                </div>
            </div>

            <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200">
                <div className="container mx-auto px-4 max-w-3xl py-2.5 flex items-center gap-3">
                    {isOwner ? (
                        <>
                            <button type="button" onClick={bump} disabled={busy || item.status === 'sold'} className="px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-700 disabled:opacity-50">끌어올리기</button>
                            <button type="button" onClick={() => setEditing(true)} className="px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-700">수정</button>
                            <button type="button" onClick={remove} className="px-3 py-2.5 rounded-xl border border-red-200 text-sm font-bold text-red-600">삭제</button>
                            <Link to={`/market?tab=${isShare ? 'share' : 'sell'}`} className="ml-auto text-xs font-bold text-gray-400">목록</Link>
                        </>
                    ) : (
                        <>
                            <button type="button" onClick={toggleFav} disabled={!isLoggedIn || busy} aria-pressed={!!stats.mine_fav} aria-label="찜" className={`p-2.5 rounded-xl border ${stats.mine_fav ? 'border-red-200 text-red-500 bg-red-50' : 'border-gray-200 text-gray-500'}`}>
                                <Heart size={20} fill={stats.mine_fav ? 'currentColor' : 'none'} />
                            </button>
                            <span className={`text-base font-extrabold ${isShare ? 'text-pink-600' : 'text-gray-900'}`}>{priceLabel(item)}</span>
                            <span className="ml-auto flex items-center gap-2">
                                {!isShare && Number(item.price) > 0 && item.status === 'active' && (
                                    <button type="button" onClick={pay} disabled={paying || !isLoggedIn} className="flex items-center gap-1 px-3 py-2.5 rounded-xl border border-blue-200 text-blue-700 text-sm font-bold bg-blue-50 disabled:opacity-50">
                                        <Coins size={14} /> {paying ? '결제 중...' : '포인트 결제'}
                                    </button>
                                )}
                                <button type="button" onClick={openChat} disabled={busy || !isLoggedIn || item.status === 'sold'} className={`flex items-center gap-1 px-4 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-50 ${isShare ? 'bg-pink-500' : 'bg-blue-600'}`}>
                                    <MessageCircle size={16} /> 채팅하기
                                </button>
                            </span>
                        </>
                    )}
                </div>
            </div>

            {editing && (
                <div className="fixed inset-0 bg-black/50 z-[110] flex items-center justify-center p-4" onClick={() => setEditing(false)}>
                    <div role="dialog" aria-modal="true" aria-label="수정" onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-base font-extrabold text-gray-900">수정</h3>
                            <button type="button" onClick={() => setEditing(false)} className="p-1.5 hover:bg-gray-100 rounded-full" aria-label="닫기"><X size={16} /></button>
                        </div>
                        <MarketListingForm
                            mode={item.type}
                            regions={REGIONS}
                            initial={item}
                            onDone={(updated) => { setItem(updated); setIdx(0); setEditing(false); }}
                            onCancel={() => setEditing(false)}
                        />
                    </div>
                </div>
            )}
        </section>
    );
};

export default MarketDetail;

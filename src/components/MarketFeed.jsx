import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, MessageCircle, Plus, MapPin } from 'lucide-react';
import { timeAgo, priceLabel, statusLabel } from '../lib/chat';
import ListState from './ListState';
import SearchPill from './board/SearchPill';
import ContinentBar from './board/ContinentBar';
import ContinentBadge from './board/ContinentBadge';

// 당근식 목록(2026-09-07 에어비앤비 톤): 썸네일 · 제목 · 거래장소 · 시간 · 가격(또는 나눔) · 찜/대화 수. 상태 배지.
// type: 'sell' | 'share'. share 는 대륙 말머리(ContinentBar, ?region=)로 거른다.
const MarketFeed = ({
    type, items, stats = {}, loading, error, onRetry, onWrite, isLoggedIn, initialQuery = '',
    region = null, onRegion,
}) => {
    const [query, setQuery] = useState(initialQuery || '');
    const [onlyActive, setOnlyActive] = useState(true);
    const isShare = type === 'share';

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (items || []).filter((it) => {
            if (onlyActive && it.status === 'sold') return false;
            if (isShare && region && it.region_id !== region) return false;
            if (!q) return true;
            return [it.title, it.location, it.content, it.country].some((v) => (v || '').toLowerCase().includes(q));
        });
    }, [items, query, onlyActive, isShare, region]);

    return (
        <div>
            {isShare && <ContinentBar value={region} onChange={(id) => onRegion?.(id)} />}
            <div className="flex items-center gap-2 mb-4">
                <SearchPill value={query} onChange={setQuery} placeholder="제목, 장소, 내용 검색" className="flex-1 max-w-md" />
                <button
                    type="button"
                    onClick={() => setOnlyActive((v) => !v)}
                    aria-pressed={onlyActive}
                    className={`h-11 px-3.5 rounded-full text-[13px] font-bold border whitespace-nowrap transition-colors ${onlyActive ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-hairline hover:border-ink'}`}
                >
                    {isShare ? '나눔중만' : '판매중만'}
                </button>
            </div>

            {loading || error ? (
                <ListState loading={loading} error={error} onRetry={onRetry} color="ink" />
            ) : visible.length === 0 ? (
                <ListState empty emptyTitle={isShare ? '나눔 글이 없습니다' : '판매 글이 없습니다'} emptyDesc={null} />
            ) : (
                <>
                    <p className="text-[13px] text-muted mb-2">{visible.length.toLocaleString()}건</p>
                    <ul className="divide-y divide-hairline-soft border-t border-b border-hairline-soft">
                        {visible.map((it) => {
                            const st = stats[it.id] || {};
                            const thumb = it.image_urls?.[0] || it.image_url;
                            const done = it.status === 'sold';
                            return (
                                <li key={it.id}>
                                    <Link to={`/market/${it.id}`} className="flex gap-3.5 py-3.5 hover:bg-surface-soft -mx-2 px-2 rounded-md transition-colors">
                                        <span className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-md overflow-hidden bg-surface-strong flex-shrink-0">
                                            {thumb ? (
                                                <img src={thumb} alt="" loading="lazy" decoding="async" className={`w-full h-full object-cover ${done ? 'opacity-40' : ''}`} />
                                            ) : (
                                                <span className="w-full h-full flex items-center justify-center text-muted-soft text-[11px]">사진 없음</span>
                                            )}
                                            {it.status !== 'active' && (
                                                <span className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${done ? 'bg-ink' : 'bg-success'}`}>
                                                    {statusLabel(it)}
                                                </span>
                                            )}
                                        </span>
                                        <span className="min-w-0 flex-1 flex flex-col">
                                            <span className="flex items-center gap-1.5 flex-wrap">
                                                {isShare && <ContinentBadge regionId={it.region_id} />}
                                                {isShare && it.country && <span className="text-[12px] font-bold text-muted">{it.country}</span>}
                                            </span>
                                            <span className="text-[15px] font-bold text-ink tracking-[-0.01em] leading-snug line-clamp-2 mt-0.5">{it.title}</span>
                                            <span className="text-[12px] text-muted mt-0.5 flex items-center gap-1 min-w-0">
                                                {it.location && <><MapPin size={11} className="flex-shrink-0" aria-hidden="true" /><span className="truncate">{it.location}</span><span>·</span></>}
                                                <span className="whitespace-nowrap">{timeAgo(it.refreshed_at || it.created_at)}</span>
                                            </span>
                                            <span className={`text-[15px] font-extrabold mt-1 ${isShare ? 'text-rausch' : 'text-ink'}`}>{priceLabel(it)}</span>
                                            <span className="mt-auto flex items-center justify-end gap-3 text-[12px] text-muted">
                                                {st.chats > 0 && <span className="flex items-center gap-0.5"><MessageCircle size={12} />{st.chats}</span>}
                                                {st.favorites > 0 && <span className="flex items-center gap-0.5"><Heart size={12} />{st.favorites}</span>}
                                            </span>
                                        </span>
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}

            {isLoggedIn && (
                <button
                    type="button"
                    onClick={onWrite}
                    className="sm:hidden fixed bottom-6 right-5 z-40 flex items-center gap-1 px-4 py-3 rounded-full text-sm font-bold text-white shadow-lg bg-rausch hover:bg-rausch-dark"
                    aria-label="글쓰기"
                >
                    <Plus size={18} /> 글쓰기
                </button>
            )}
        </div>
    );
};

export default MarketFeed;

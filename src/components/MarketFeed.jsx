import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, MessageCircle, Plus, Search, MapPin } from 'lucide-react';
import { timeAgo, priceLabel, statusLabel } from '../lib/chat';
import ListState from './ListState';

// 당근식 목록: 썸네일 · 제목 · 거래장소 · 시간 · 가격(또는 나눔) · 찜/대화 수. 상태(예약중/거래완료) 배지.
// type: 'sell' | 'share'. share 는 지역 칩으로 거른다.
// Tailwind 는 템플릿 문자열로 조립한 클래스명을 생성하지 않는다 → 정적 문자열 표.
const THEME = {
    blue: { focus: 'focus:border-blue-500', on: 'bg-blue-600 text-white border-blue-600', btn: 'bg-blue-600 hover:bg-blue-700' },
    pink: { focus: 'focus:border-pink-500', on: 'bg-pink-500 text-white border-pink-500', btn: 'bg-pink-500 hover:bg-pink-600' },
};

const MarketFeed = ({
    type, items, stats = {}, loading, error, onRetry, onWrite, isLoggedIn,
    regions = [], region = null, onRegion,
}) => {
    const [query, setQuery] = useState('');
    const [onlyActive, setOnlyActive] = useState(true);
    const isShare = type === 'share';
    const color = isShare ? 'pink' : 'blue';
    const t = THEME[color] || THEME.blue;

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
        <div className="max-w-3xl mx-auto">
            <div className="flex items-center gap-2 mb-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="검색"
                        className={`w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 ${t.focus} outline-none text-sm bg-white`}
                    />
                </div>
                <button
                    type="button"
                    onClick={() => setOnlyActive((v) => !v)}
                    aria-pressed={onlyActive}
                    className={`px-3 py-2.5 rounded-xl text-xs font-bold border whitespace-nowrap ${onlyActive ? t.on : 'bg-white text-gray-600 border-gray-200'}`}
                >
                    {isShare ? '나눔중만' : '판매중만'}
                </button>
                <button
                    type="button"
                    onClick={onWrite}
                    className={`hidden sm:flex items-center gap-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white ${t.btn}`}
                >
                    <Plus size={16} /> 글쓰기
                </button>
            </div>

            {isShare && regions.length > 0 && (
                <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
                    <button type="button" onClick={() => onRegion?.(null)} className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border ${!region ? 'bg-pink-500 text-white border-pink-500' : 'bg-white text-gray-600 border-gray-200'}`}>전체</button>
                    {regions.map((r) => (
                        <button key={r.id} type="button" onClick={() => onRegion?.(r.id)} className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border ${region === r.id ? 'bg-pink-500 text-white border-pink-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                            {r.icon} {r.name}
                        </button>
                    ))}
                </div>
            )}

            {loading || error ? (
                <ListState loading={loading} error={error} onRetry={onRetry} color={color} />
            ) : visible.length === 0 ? (
                <div className="py-16 text-center bg-white rounded-2xl border border-dashed border-gray-200 text-gray-400 text-sm">
                    {isShare ? '나눔 글이 없습니다' : '판매 글이 없습니다'}
                </div>
            ) : (
                <ul className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100">
                    {visible.map((it) => {
                        const st = stats[it.id] || {};
                        const thumb = it.image_urls?.[0] || it.image_url;
                        const done = it.status === 'sold';
                        return (
                            <li key={it.id}>
                                <Link to={`/market/${it.id}`} className="flex gap-3 p-3 hover:bg-gray-50">
                                    <span className="relative w-24 h-24 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                                        {thumb ? (
                                            <img src={thumb} alt="" loading="lazy" decoding="async" className={`w-full h-full object-cover ${done ? 'opacity-40' : ''}`} />
                                        ) : (
                                            <span className="w-full h-full flex items-center justify-center text-gray-300 text-xs">사진 없음</span>
                                        )}
                                        {it.status !== 'active' && (
                                            <span className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${done ? 'bg-gray-700' : 'bg-green-600'}`}>
                                                {statusLabel(it)}
                                            </span>
                                        )}
                                    </span>
                                    <span className="min-w-0 flex-1 flex flex-col">
                                        <span className="text-sm font-semibold text-gray-900 line-clamp-2">{isShare && it.country ? `[${it.country}] ` : ''}{it.title}</span>
                                        <span className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1 min-w-0">
                                            {it.location && <><MapPin size={10} className="flex-shrink-0" /><span className="truncate">{it.location}</span><span>·</span></>}
                                            <span className="whitespace-nowrap">{timeAgo(it.refreshed_at || it.created_at)}</span>
                                        </span>
                                        <span className={`text-base font-extrabold mt-1 ${isShare ? 'text-pink-600' : 'text-gray-900'}`}>{priceLabel(it)}</span>
                                        <span className="mt-auto flex items-center justify-end gap-3 text-[11px] text-gray-400">
                                            {st.chats > 0 && <span className="flex items-center gap-0.5"><MessageCircle size={12} />{st.chats}</span>}
                                            {st.favorites > 0 && <span className="flex items-center gap-0.5"><Heart size={12} />{st.favorites}</span>}
                                        </span>
                                    </span>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}

            {isLoggedIn && (
                <button
                    type="button"
                    onClick={onWrite}
                    className={`sm:hidden fixed bottom-6 right-5 z-40 flex items-center gap-1 px-4 py-3 rounded-full text-sm font-bold text-white shadow-lg ${t.btn}`}
                    aria-label="글쓰기"
                >
                    <Plus size={18} /> 글쓰기
                </button>
            )}
        </div>
    );
};

export default MarketFeed;

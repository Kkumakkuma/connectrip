import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { chatApi } from '../lib/db';
import { timeAgo, priceLabel } from '../lib/chat';
import CrewBadge from '../components/CrewBadge';
import SEOHead from '../components/SEOHead';

const POLL_MS = 10000;

// 대화방 목록(네이버 카페 채팅식). 10초 폴링, 화면이 안 보이면 멈춘다.
const ChatList = () => {
    const navigate = useNavigate();
    const [rooms, setRooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const timer = useRef(null);
    const busyRef = useRef(false);
    const aliveRef = useRef(true);

    const load = useCallback(async (silent = false) => {
        if (busyRef.current) return;   // 이전 요청이 끝나기 전엔 다시 묻지 않는다(응답 역전 방지)
        busyRef.current = true;
        try {
            if (!silent) { setLoading(true); setError(null); }
            const data = await chatApi.rooms();
            if (aliveRef.current) setRooms(data);
        } catch (err) {
            console.error('대화방 목록 실패:', err);
            if (!silent && aliveRef.current) setError('대화방을 불러오지 못했습니다.');
        } finally {
            busyRef.current = false;
            if (!silent && aliveRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        aliveRef.current = true;
        load();
        const tick = () => { if (!document.hidden) load(true); };
        timer.current = setInterval(tick, POLL_MS);
        const onVis = () => { if (!document.hidden) load(true); };
        document.addEventListener('visibilitychange', onVis);
        return () => { aliveRef.current = false; clearInterval(timer.current); document.removeEventListener('visibilitychange', onVis); };
    }, [load]);

    return (
        <section className="py-20 bg-gray-50 min-h-[80vh]">
            <SEOHead title="대화 - ConnectTrip" description="회원 간 1:1 대화" />
            <div className="container mx-auto px-4 max-w-3xl">
                <div className="flex items-center gap-2 mb-4">
                    <span className="px-3 py-1.5 rounded-lg text-sm font-bold bg-blue-600 text-white">대화</span>
                    <Link to="/messages" className="px-3 py-1.5 rounded-lg text-sm font-bold text-gray-500 hover:bg-gray-100">쪽지</Link>
                </div>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
                    {loading ? (
                        <p className="py-16 text-center text-sm text-gray-400">불러오는 중...</p>
                    ) : error ? (
                        <div className="py-16 text-center">
                            <p className="text-sm text-gray-500 mb-3">{error}</p>
                            <button type="button" onClick={() => load()} className="px-4 py-2 rounded-lg bg-gray-100 text-sm font-bold text-gray-600">다시 시도</button>
                        </div>
                    ) : rooms.length === 0 ? (
                        <div className="py-16 text-center text-gray-400">
                            <MessageCircle size={40} className="mx-auto mb-3 opacity-40" />
                            <p className="text-sm">대화가 없습니다</p>
                        </div>
                    ) : (
                        <ul>
                            {rooms.map((r) => (
                                <li key={r.id} className="border-b border-gray-100 last:border-b-0">
                                    <button type="button" onClick={() => navigate(`/chat/${r.id}`)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
                                        <span className="w-11 h-11 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0 text-gray-500 font-bold">
                                            {r.other_avatar ? <img src={r.other_avatar} alt="" className="w-full h-full object-cover" /> : (r.other_name || '?').charAt(0)}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-center gap-1.5">
                                                <span className={`text-sm truncate ${r.unread > 0 ? 'font-extrabold text-gray-900' : 'font-semibold text-gray-700'}`}>{r.other_name}</span>
                                                {r.other_crew && <CrewBadge profile={{ user_type: 'crew', crew_verified: true }} />}
                                                {r.blocked && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-bold">차단됨</span>}
                                                <span className="ml-auto text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0">{timeAgo(r.last_message_at)}</span>
                                            </span>
                                            {r.kind === 'listing' && (
                                                <span className="block text-[11px] text-blue-600 truncate">
                                                    {r.listing_title ? `${r.listing_title} · ${priceLabel({ type: r.listing_type, price: r.listing_price })}` : '삭제된 매물'}
                                                </span>
                                            )}
                                            <span className="flex items-center gap-2">
                                                <span className={`text-xs truncate ${r.unread > 0 ? 'text-gray-800 font-semibold' : 'text-gray-500'}`}>{r.last_message || ''}</span>
                                                {r.unread > 0 && (
                                                    <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                                                        {r.unread > 99 ? '99+' : r.unread}
                                                    </span>
                                                )}
                                            </span>
                                        </span>
                                        {r.listing_image && (
                                            <img src={r.listing_image} alt="" className="w-11 h-11 rounded-lg object-cover flex-shrink-0" />
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </section>
    );
};

export default ChatList;

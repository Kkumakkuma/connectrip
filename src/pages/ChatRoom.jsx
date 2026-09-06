import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Send, Ban, MoreVertical } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { chatApi, userBlockApi } from '../lib/db';
import { messageTime, groupByDay, priceLabel, statusLabel, chatErrorMessage, pollDelay } from '../lib/chat';
import CrewBadge from '../components/CrewBadge';
import ReportButton from '../components/ReportButton';
import SEOHead from '../components/SEOHead';

const BASE_POLL_MS = 3000;
const PAGE = 300;
// 증분 조회 커서를 이만큼 되감아 조회한다. created_at 은 트랜잭션 시작 시각이라 늦게 커밋된 메시지가
// 커서보다 오래된 시각을 가질 수 있다(id 로 중복 제거).
const OVERLAP_MS = 15000;
const INFO_REFRESH_EVERY = 10;   // 폴링 10회(약 30초)마다 차단 상태 등 방 정보 갱신

const overlapSince = (at) => (at ? new Date(new Date(at).getTime() - OVERLAP_MS).toISOString() : null);
const byTime = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// 대화 화면. 3초 폴링(화면이 안 보이면 정지, 1분 이상 손 안 대면 늦춤). 열 때와 새 메시지가 오면 읽음 처리.
// 방을 바꾸면 세대(seq)가 올라가 이전 방의 늦은 응답은 버린다.
const ChatRoom = () => {
    const { roomId } = useParams();
    const { user } = useAuth();
    const navigate = useNavigate();
    const [info, setInfo] = useState(null);
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [hasOlder, setHasOlder] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const listRef = useRef(null);
    const seqRef = useRef(0);          // 방 세대
    const lastAtRef = useRef(null);    // 받은 메시지 중 가장 늦은 created_at
    const firstAtRef = useRef(null);   // 가장 이른 created_at(이전 대화 조회용)
    const idsRef = useRef(new Set());
    const lastActiveRef = useRef(Date.now());
    const timerRef = useRef(null);
    const pollCountRef = useRef(0);

    const scrollBottom = () => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; };
    const alive = (seq) => seq === seqRef.current;

    // 새 행 병합: 이 방의 행만, id 중복 제거, 시각순 정렬. 새로 붙은 행 배열을 돌려준다.
    const merge = useCallback((rows) => {
        const fresh = rows.filter((m) => m.room_id === roomId && !idsRef.current.has(m.id));
        if (fresh.length === 0) return fresh;
        fresh.forEach((m) => idsRef.current.add(m.id));
        setMessages((prev) => [...prev, ...fresh].sort(byTime));
        const sorted = [...fresh].sort(byTime);
        const last = sorted[sorted.length - 1].created_at;
        const first = sorted[0].created_at;
        if (!lastAtRef.current || last > lastAtRef.current) lastAtRef.current = last;
        if (!firstAtRef.current || first < firstAtRef.current) firstAtRef.current = first;
        return fresh;
    }, [roomId]);

    const loadInfo = useCallback(async (seq) => {
        const data = await chatApi.roomInfo(roomId);
        if (!alive(seq)) return null;
        if (!data) throw new Error('NOT_FOUND');
        setInfo(data);
        return data;
    }, [roomId]);

    // 읽음 처리: 화면에 실제로 붙은 마지막 메시지 시각까지만
    const markRead = useCallback((seq) => {
        if (!alive(seq) || document.hidden) return;
        chatApi.markRead(roomId, lastAtRef.current).catch(() => {});
    }, [roomId]);

    const poll = useCallback(async () => {
        const seq = seqRef.current;
        try {
            const rows = await chatApi.messages(roomId, { sinceAt: overlapSince(lastAtRef.current) });
            if (!alive(seq)) return;
            const fresh = merge(rows);
            if (fresh.length > 0) {
                if (fresh.some((m) => m.sender_id !== user?.id)) markRead(seq);
                setTimeout(scrollBottom, 30);
            }
            pollCountRef.current += 1;
            if (pollCountRef.current % INFO_REFRESH_EVERY === 0) loadInfo(seq).catch(() => {});
        } catch (err) {
            console.error('대화 폴링 실패:', err);
        }
    }, [roomId, merge, user?.id, markRead, loadInfo]);

    useEffect(() => {
        const seq = ++seqRef.current;
        idsRef.current = new Set(); lastAtRef.current = null; firstAtRef.current = null; pollCountRef.current = 0;
        setMessages([]); setInfo(null); setText(''); setMenuOpen(false); setHasOlder(false);
        (async () => {
            try {
                setLoading(true); setError(null);
                await loadInfo(seq);
                if (!alive(seq)) return;
                const rows = await chatApi.messages(roomId, { limit: PAGE });
                if (!alive(seq)) return;
                merge(rows);
                setHasOlder(rows.length >= PAGE);
                markRead(seq);
                setTimeout(scrollBottom, 30);
            } catch (err) {
                console.error('대화방 로드 실패:', err);
                if (alive(seq)) setError(chatErrorMessage(err, '대화방을 불러오지 못했습니다.'));
            } finally {
                if (alive(seq)) setLoading(false);
            }
        })();
        return () => { seqRef.current += 1; };
    }, [roomId, loadInfo, merge, markRead]);

    // 폴링: 화면이 보일 때만, 유휴 시간에 따라 늦춤. 화면 복귀 시 방 정보(차단 상태)도 다시 읽는다.
    useEffect(() => {
        if (loading || error) return undefined;
        let stopped = false;
        const schedule = () => {
            const delay = pollDelay(BASE_POLL_MS, Date.now() - lastActiveRef.current);
            timerRef.current = setTimeout(async () => {
                if (stopped) return;
                if (!document.hidden) await poll();
                if (!stopped) schedule();
            }, delay);
        };
        schedule();
        const onVis = () => {
            if (document.hidden) return;
            lastActiveRef.current = Date.now();
            loadInfo(seqRef.current).catch(() => {});
            poll();
        };
        const onActive = () => { lastActiveRef.current = Date.now(); };
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('keydown', onActive);
        window.addEventListener('pointerdown', onActive);
        return () => {
            stopped = true;
            clearTimeout(timerRef.current);
            document.removeEventListener('visibilitychange', onVis);
            window.removeEventListener('keydown', onActive);
            window.removeEventListener('pointerdown', onActive);
        };
    }, [loading, error, poll, loadInfo]);

    // 이전 대화(가장 이른 메시지보다 앞) 300건 더 읽기. 스크롤 위치는 유지.
    const loadOlder = async () => {
        if (loadingOlder || !firstAtRef.current) return;
        const seq = seqRef.current;
        setLoadingOlder(true);
        const el = listRef.current;
        const beforeH = el ? el.scrollHeight : 0;
        try {
            const rows = await chatApi.messages(roomId, { beforeAt: firstAtRef.current, limit: PAGE });
            if (!alive(seq)) return;
            merge(rows);
            setHasOlder(rows.length >= PAGE);
            setTimeout(() => { if (el) el.scrollTop += el.scrollHeight - beforeH; }, 30);
        } catch (err) {
            console.error('이전 대화 로드 실패:', err);
        } finally {
            if (alive(seq)) setLoadingOlder(false);
        }
    };

    const send = async () => {
        const raw = text;
        const body = raw.trim();
        if (!body || sending || info?.blocked) return;
        const seq = seqRef.current;
        setSending(true);
        try {
            await chatApi.send(roomId, body);
            if (!alive(seq)) return;
            // 보내는 동안 이어서 쓴 글은 지우지 않는다
            setText((t) => (t === raw ? '' : t));
            await poll();
        } catch (err) {
            console.error('전송 실패:', err);
            if (String(err?.message || '').includes('BLOCKED')) loadInfo(seq).catch(() => {});
            if (alive(seq)) alert(chatErrorMessage(err, '메시지를 보내지 못했습니다.'));
        } finally {
            if (alive(seq)) setSending(false);
        }
    };

    const toggleBlock = async () => {
        if (!info?.other_id) return;
        const on = !info.blocked_by_me;
        if (!window.confirm(on ? '이 회원을 차단할까요? 쪽지와 대화를 주고받을 수 없게 됩니다.' : '차단을 해제할까요?')) return;
        const seq = seqRef.current;
        try {
            if (on) await userBlockApi.block(info.other_id); else await userBlockApi.unblock(info.other_id);
            await loadInfo(seq);
        } catch (err) {
            console.error('차단 변경 실패:', err);
            alert('처리하지 못했습니다.');
        } finally {
            setMenuOpen(false);
        }
    };

    const onKeyDown = (e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent?.isComposing) return;
        e.preventDefault();
        send();
    };

    const groups = groupByDay(messages);

    return (
        <section className="pt-20 bg-gray-50 min-h-screen">
            <SEOHead title="대화 - ConnectTrip" description="회원 간 1:1 대화" />
            <div className="container mx-auto px-0 sm:px-4 max-w-3xl">
                <div className="bg-white sm:rounded-2xl shadow-sm border border-gray-100 flex flex-col" style={{ height: 'calc(100vh - 6rem)' }}>
                    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
                        <button type="button" onClick={() => navigate('/chat')} className="p-1.5 rounded-full hover:bg-gray-100" aria-label="목록으로"><ArrowLeft size={18} /></button>
                        <span className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden text-gray-500 font-bold text-sm">
                            {info?.other_avatar ? <img src={info.other_avatar} alt="" className="w-full h-full object-cover" /> : (info?.other_name || '?').charAt(0)}
                        </span>
                        <span className="min-w-0 flex-1 flex items-center gap-1.5">
                            <span className="text-sm font-extrabold text-gray-900 truncate">{info?.other_name || ''}</span>
                            {info?.other_crew && <CrewBadge profile={{ user_type: 'crew', crew_verified: true }} />}
                            {info?.blocked && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-bold">차단됨</span>}
                        </span>
                        {info?.other_id && (
                            <span className="relative">
                                <button type="button" onClick={() => setMenuOpen((v) => !v)} className="p-1.5 rounded-full hover:bg-gray-100" aria-label="메뉴" aria-expanded={menuOpen}><MoreVertical size={18} /></button>
                                {menuOpen && (
                                    <span className="absolute right-0 top-full mt-1 z-30 w-36 bg-white border border-gray-200 rounded-xl shadow-lg py-1 text-xs">
                                        <button type="button" onClick={toggleBlock} className="w-full flex items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50">
                                            <Ban size={13} /> {info.blocked_by_me ? '차단 해제' : '차단'}
                                        </button>
                                        <span className="flex items-center gap-2 px-3 py-1.5 text-gray-700">
                                            <ReportButton postId={roomId} boardType="chat" reportedUserId={info.other_id} /> 신고
                                        </span>
                                    </span>
                                )}
                            </span>
                        )}
                    </div>

                    {info?.kind === 'listing' && (
                        <Link to={info.listing_id ? `/market/${info.listing_id}` : '#'} className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 bg-gray-50 hover:bg-gray-100">
                            {info.listing_image ? <img src={info.listing_image} alt="" className="w-10 h-10 rounded-lg object-cover" /> : <span className="w-10 h-10 rounded-lg bg-gray-200" />}
                            <span className="min-w-0">
                                <span className="block text-xs font-bold text-gray-800 truncate">{info.listing_title || '삭제된 매물'}</span>
                                {info.listing_title && (
                                    <span className="block text-[11px] text-gray-500">
                                        {statusLabel({ type: info.listing_type, status: info.listing_status })} · {priceLabel({ type: info.listing_type, price: info.listing_price })}
                                    </span>
                                )}
                            </span>
                        </Link>
                    )}

                    <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                        {loading ? (
                            <p className="py-10 text-center text-xs text-gray-400">불러오는 중...</p>
                        ) : error ? (
                            <p className="py-10 text-center text-xs text-gray-500">{error}</p>
                        ) : groups.length === 0 ? (
                            <p className="py-10 text-center text-xs text-gray-400">메시지가 없습니다</p>
                        ) : (
                            <>
                                {hasOlder && (
                                    <p className="text-center">
                                        <button type="button" onClick={loadOlder} disabled={loadingOlder} className="px-3 py-1 rounded-full text-[11px] font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 disabled:opacity-50">
                                            {loadingOlder ? '불러오는 중...' : '이전 대화 보기'}
                                        </button>
                                    </p>
                                )}
                                {groups.map((g) => (
                                    <div key={g.day}>
                                        <p className="text-center text-[11px] text-gray-400 my-2">{g.day}</p>
                                        {g.items.map((m) => {
                                            const mine = m.sender_id === user?.id;
                                            return (
                                                <div key={m.id} className={`flex items-end gap-1.5 mb-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
                                                    {mine && <span className="text-[10px] text-gray-400">{messageTime(m.created_at)}</span>}
                                                    <span className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${mine ? 'bg-blue-600 text-white rounded-br-md' : 'bg-gray-100 text-gray-800 rounded-bl-md'}`}>{m.content}</span>
                                                    {!mine && <span className="text-[10px] text-gray-400">{messageTime(m.created_at)}</span>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </>
                        )}
                    </div>

                    <div className="border-t border-gray-100 p-2">
                        {info?.blocked ? (
                            <p className="py-2 text-center text-xs text-gray-400">차단됨</p>
                        ) : (
                            <div className="flex items-end gap-2">
                                <textarea
                                    value={text}
                                    onChange={(e) => setText(e.target.value)}
                                    onKeyDown={onKeyDown}
                                    rows={1}
                                    maxLength={2000}
                                    disabled={loading || !!error}
                                    className="flex-1 px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-blue-400 outline-none resize-none max-h-32"
                                />
                                <button type="button" onClick={send} disabled={sending || !text.trim() || loading || !!error} className="p-2.5 rounded-xl bg-blue-600 text-white disabled:opacity-50" aria-label="보내기">
                                    <Send size={16} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ChatRoom;

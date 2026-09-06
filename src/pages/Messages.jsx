import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Mail, Send, Trash2, X, MessageCircle, Ban } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { messageApi, userBlockApi } from '../lib/db';
import { timeAgo, chatErrorMessage } from '../lib/chat';
import CrewBadge from '../components/CrewBadge';
import SEOHead from '../components/SEOHead';

// 쪽지함(네이버 카페식): 받은 쪽지 / 보낸 쪽지, 열어 보기, 답장, 삭제(내 함에서만), 차단.
// ?to=<userId>&name=<표시명> 으로 들어오면 쪽지 쓰기 창을 바로 연다.
const Messages = () => {
    const { user } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [box, setBox] = useState('in');
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [openId, setOpenId] = useState(null);
    const [compose, setCompose] = useState(null);   // { toId, toName }
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    const [blockedIds, setBlockedIds] = useState(() => new Set());

    const load = useCallback(async (kind) => {
        try {
            setLoading(true);
            setError(null);
            setRows(await messageApi.box(kind));
        } catch (err) {
            console.error('쪽지함 로드 실패:', err);
            setError('쪽지를 불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(box); }, [box, load]);
    useEffect(() => {
        userBlockApi.getMyBlockedIds().then((ids) => setBlockedIds(new Set(ids))).catch(() => {});
    }, []);

    // 글쓴이 버튼에서 넘어온 경우
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const to = params.get('to');
        if (to && to !== user?.id) setCompose({ toId: to, toName: params.get('name') || '' });
    }, [location.search, user?.id]);

    const openRow = async (row) => {
        setOpenId((cur) => (cur === row.id ? null : row.id));
        if (box === 'in' && !row.read_at) {
            try {
                await messageApi.markRead(row.id);
                setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, read_at: new Date().toISOString() } : r)));
            } catch { /* 표시만 */ }
        }
    };

    const remove = async (row) => {
        if (!window.confirm('이 쪽지를 삭제할까요?')) return;
        try {
            await messageApi.remove(row.id);
            setRows((prev) => prev.filter((r) => r.id !== row.id));
            if (openId === row.id) setOpenId(null);
        } catch (err) {
            console.error('쪽지 삭제 실패:', err);
            alert('삭제에 실패했습니다.');
        }
    };

    const toggleBlock = async (row) => {
        const isBlocked = blockedIds.has(row.other_id);
        if (!window.confirm(isBlocked ? '차단을 해제할까요?' : '이 회원을 차단할까요? 쪽지와 대화를 주고받을 수 없게 됩니다.')) return;
        try {
            if (isBlocked) await userBlockApi.unblock(row.other_id); else await userBlockApi.block(row.other_id);
            setBlockedIds((prev) => { const n = new Set(prev); if (isBlocked) n.delete(row.other_id); else n.add(row.other_id); return n; });
        } catch (err) {
            console.error('차단 변경 실패:', err);
            alert('처리하지 못했습니다.');
        }
    };

    const send = async () => {
        const body = text.trim();
        if (!compose || !body || sending) return;
        setSending(true);
        try {
            await messageApi.send(compose.toId, body);
            setText('');
            setCompose(null);
            if (location.search) navigate('/messages', { replace: true });
            if (box === 'out') load('out'); else setBox('out');
        } catch (err) {
            console.error('쪽지 발송 실패:', err);
            alert(chatErrorMessage(err, '쪽지를 보내지 못했습니다.'));
        } finally {
            setSending(false);
        }
    };

    return (
        <section className="py-20 bg-gray-50 min-h-[80vh]">
            <SEOHead title="쪽지 - ConnectTrip" description="회원 간 쪽지" />
            <div className="container mx-auto px-4 max-w-3xl">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Link to="/chat" className="px-3 py-1.5 rounded-lg text-sm font-bold text-gray-500 hover:bg-gray-100">대화</Link>
                        <span className="px-3 py-1.5 rounded-lg text-sm font-bold bg-blue-600 text-white">쪽지</span>
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
                    <div className="flex border-b border-gray-100">
                        {[['in', '받은 쪽지'], ['out', '보낸 쪽지']].map(([k, label]) => (
                            <button
                                key={k}
                                type="button"
                                onClick={() => { setBox(k); setOpenId(null); }}
                                className={`flex-1 py-3 text-sm font-bold ${box === k ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    {loading ? (
                        <p className="py-16 text-center text-sm text-gray-400">불러오는 중...</p>
                    ) : error ? (
                        <div className="py-16 text-center">
                            <p className="text-sm text-gray-500 mb-3">{error}</p>
                            <button type="button" onClick={() => load(box)} className="px-4 py-2 rounded-lg bg-gray-100 text-sm font-bold text-gray-600">다시 시도</button>
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="py-16 text-center text-gray-400">
                            <Mail size={40} className="mx-auto mb-3 opacity-40" />
                            <p className="text-sm">{box === 'in' ? '받은 쪽지가 없습니다' : '보낸 쪽지가 없습니다'}</p>
                        </div>
                    ) : (
                        <ul>
                            {rows.map((row) => {
                                const unread = box === 'in' && !row.read_at;
                                const isOpen = openId === row.id;
                                return (
                                    <li key={row.id} className="border-b border-gray-100 last:border-b-0">
                                        <button type="button" onClick={() => openRow(row)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
                                            <span className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0 text-gray-500 font-bold">
                                                {row.other_avatar ? <img src={row.other_avatar} alt="" className="w-full h-full object-cover" /> : (row.other_name || '?').charAt(0)}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center gap-1.5">
                                                    <span className={`text-sm truncate ${unread ? 'font-extrabold text-gray-900' : 'font-semibold text-gray-700'}`}>{row.other_name}</span>
                                                    {row.other_crew && <CrewBadge profile={{ user_type: 'crew', crew_verified: true }} />}
                                                    {unread && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" aria-label="안 읽음" />}
                                                    {box === 'out' && <span className="text-[11px] text-gray-400">{row.read_at ? '읽음' : '안 읽음'}</span>}
                                                </span>
                                                {!isOpen && <span className="block text-xs text-gray-500 truncate">{row.content}</span>}
                                            </span>
                                            <span className="text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0">{timeAgo(row.created_at)}</span>
                                        </button>
                                        {isOpen && (
                                            <div className="px-4 pb-4">
                                                <p className="text-sm text-gray-800 whitespace-pre-wrap break-words bg-gray-50 rounded-xl p-3">{row.content}</p>
                                                <div className="flex items-center gap-2 mt-2 text-xs">
                                                    {row.other_id && (
                                                        <button type="button" onClick={() => { setCompose({ toId: row.other_id, toName: row.other_name }); setText(''); }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white font-bold">
                                                            <Send size={12} /> 답장
                                                        </button>
                                                    )}
                                                    <button type="button" onClick={() => remove(row)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 font-bold">
                                                        <Trash2 size={12} /> 삭제
                                                    </button>
                                                    {row.other_id && (
                                                        <button type="button" onClick={() => toggleBlock(row)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 font-bold ml-auto">
                                                            <Ban size={12} /> {blockedIds.has(row.other_id) ? '차단 해제' : '차단'}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>

            {compose && (
                <div className="fixed inset-0 bg-black/50 z-[110] flex items-center justify-center p-4" onClick={() => setCompose(null)}>
                    <div role="dialog" aria-modal="true" aria-label="쪽지 쓰기" onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-md p-5">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-base font-extrabold text-gray-900 flex items-center gap-2"><MessageCircle size={16} className="text-blue-600" />쪽지 쓰기</h3>
                            <button type="button" onClick={() => setCompose(null)} className="p-1.5 hover:bg-gray-100 rounded-full" aria-label="닫기"><X size={16} /></button>
                        </div>
                        <p className="text-sm text-gray-600 mb-2">받는 사람: <strong className="text-gray-900">{compose.toName || '회원'}</strong></p>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            rows={5}
                            maxLength={1000}
                            className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none resize-none"
                        />
                        <div className="flex items-center justify-between mt-2">
                            <span className="text-[11px] text-gray-400">{text.length}/1000</span>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setCompose(null)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-bold text-gray-700">취소</button>
                                <button type="button" onClick={send} disabled={sending || !text.trim()} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold disabled:opacity-50">
                                    {sending ? '보내는 중...' : '보내기'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
};

export default Messages;

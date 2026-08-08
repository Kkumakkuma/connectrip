import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Send, Trash2, Loader2, Lock } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { flightBoardApi } from '../lib/db';
import { useBlockedIds, filterBlocked } from '../lib/useBlockedIds';
import ReportButton from './ReportButton';

// 같은 편·같은 날 스케줄을 공개 등록한 사람들만 쓰는 미니 게시판.
// 비행 21일 전부터 열리고 비행 다음날부터는 읽기 전용(글은 남는다).
// 입장 자격·작성 기간·연락처 차단은 전부 서버가 판정한다. 여기 표시는 보조일 뿐이다.
const DAY = 24 * 60 * 60 * 1000;

const dayDiffFromToday = (dateStr) => {
    const [y, m, d] = String(dateStr || '').split('-').map(Number);
    if (!y || !m || !d) return null;
    const target = Date.UTC(y, m - 1, d);
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - today) / DAY);
};

const CONTACT_ERRORS = {
    CONTACT_BLOCKED_PHONE: '휴대폰 번호는 게시판에 쓸 수 없어요. 쪽지로 주고받아 주세요.',
    CONTACT_BLOCKED_MESSENGER: '개인 메신저 아이디는 쓸 수 없어요. 오픈채팅 링크는 올릴 수 있어요.',
    CONTACT_BLOCKED_ACCOUNT: '계좌번호는 쓸 수 없어요. 미리 입금을 요구하는 사기를 막기 위한 것입니다.',
    CONTACT_BLOCKED_EMAIL: '이메일 주소는 게시판에 쓸 수 없어요. 쪽지로 주고받아 주세요.',
    CONTACT_BLOCKED_HOTEL: '체류 호텔·객실 정보는 안전을 위해 쓸 수 없어요.',
};

const toMessage = (err, fallback) => {
    const raw = err?.message || '';
    const hit = Object.keys(CONTACT_ERRORS).find((k) => raw.includes(k));
    return hit ? CONTACT_ERRORS[hit] : fallback;
};

const FlightBoard = ({ flight, memberType, onSendMessage }) => {
    const { user, profile } = useAuth();
    const blockedIds = useBlockedIds();

    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [content, setContent] = useState('');
    const [posting, setPosting] = useState(false);
    const [openComments, setOpenComments] = useState(null);
    const [commentText, setCommentText] = useState('');

    const diff = dayDiffFromToday(flight.flight_date);
    const notYet = diff !== null && diff > 21;   // 아직 열리기 전
    const writable = diff !== null && diff <= 21 && diff >= 0;

    const fetchPosts = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            setPosts(await flightBoardApi.getPosts(flight.flight_number, flight.flight_date, memberType));
        } catch (err) {
            console.error('게시판 로드 실패:', err);
            setError('글을 불러오지 못했습니다. 다시 시도해주세요.');
        } finally {
            setLoading(false);
        }
    }, [flight.flight_number, flight.flight_date, memberType]);

    useEffect(() => { if (!notYet) fetchPosts(); else setLoading(false); }, [fetchPosts, notYet]);

    const handlePost = async () => {
        const body = content.trim();
        if (!body || posting) return;
        setPosting(true);
        try {
            await flightBoardApi.createPost({
                flight_number: flight.flight_number,
                flight_date: flight.flight_date,
                member_type: memberType,
                user_id: user.id,
                author_name: profile?.nickname || profile?.name || '익명',
                content: body,
            });
            setContent('');
            await fetchPosts();
        } catch (err) {
            console.error('글 등록 실패:', err);
            alert(toMessage(err, '글을 올리지 못했습니다. 다시 시도해주세요.'));
        } finally {
            setPosting(false);
        }
    };

    const handleComment = async (postId) => {
        const body = commentText.trim();
        if (!body) return;
        try {
            await flightBoardApi.createComment({
                post_id: postId,
                user_id: user.id,
                author_name: profile?.nickname || profile?.name || '익명',
                content: body,
            });
            setCommentText('');
            await fetchPosts();
        } catch (err) {
            console.error('댓글 등록 실패:', err);
            alert(toMessage(err, '댓글을 남기지 못했습니다.'));
        }
    };

    const handleDelete = async (postId) => {
        if (!window.confirm('이 글을 삭제할까요?')) return;
        try {
            await flightBoardApi.deletePost(postId);
            await fetchPosts();
        } catch (err) {
            console.error('삭제 실패:', err);
            alert('삭제에 실패했습니다.');
        }
    };

    if (notYet) {
        return (
            <div className="mt-4 p-4 bg-gray-50 rounded-xl text-center">
                <Lock size={18} className="mx-auto text-gray-300 mb-1.5" />
                <p className="text-xs text-gray-500">출발 3주 전부터 같은 편 게시판이 열립니다.</p>
            </div>
        );
    }

    const visible = filterBlocked(posts, blockedIds);

    return (
        <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <MessageSquare size={15} className="text-blue-500" />
                    <span className="text-sm font-bold text-gray-700">
                        {memberType === 'crew' ? '같은 듀티 게시판' : '같은 편 게시판'}
                    </span>
                </div>
                {!writable && (
                    <span className="text-[11px] font-semibold text-gray-400">비행이 지나 읽기 전용</span>
                )}
            </div>

            {writable && (
                <div className="mb-3">
                    <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        rows={2}
                        maxLength={1000}
                        placeholder={memberType === 'crew'
                            ? '레이오버 일정이나 같이 다닐 분을 찾아보세요'
                            : '공항 이동, 일정 공유 등 자유롭게 남겨보세요'}
                        className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none resize-none transition-all"
                    />
                    <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[11px] text-gray-400">오픈채팅 링크는 OK · 전화번호·계좌는 쪽지로</span>
                        <button
                            onClick={handlePost}
                            disabled={posting || !content.trim()}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                            {posting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                            올리기
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <p className="py-6 text-center text-xs text-gray-400">불러오는 중...</p>
            ) : error ? (
                <div className="py-6 text-center">
                    <p className="text-xs text-gray-500 mb-2">{error}</p>
                    <button onClick={fetchPosts} className="px-3 py-1.5 rounded-lg bg-gray-100 text-xs font-bold text-gray-600">다시 시도</button>
                </div>
            ) : visible.length === 0 ? (
                <p className="py-6 text-center text-xs text-gray-400">
                    아직 글이 없습니다.{writable && ' 첫 글을 남겨보세요.'}
                </p>
            ) : (
                <div className="space-y-2">
                    {visible.map((post) => (
                        <div key={post.id} className="p-3 bg-gray-50 rounded-xl">
                            <div className="flex items-start justify-between gap-2 mb-1">
                                <span className="text-xs font-bold text-gray-700 truncate">{post.author_name || '익명'}</span>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <span className="text-[11px] text-gray-400">
                                        {new Date(post.created_at).toLocaleDateString('ko-KR')}
                                    </span>
                                    {post.user_id === user?.id ? (
                                        <button onClick={() => handleDelete(post.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                                            <Trash2 size={13} />
                                        </button>
                                    ) : (
                                        <ReportButton postId={post.id} boardType="flight_board" reportedUserId={post.user_id} />
                                    )}
                                </div>
                            </div>
                            <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{post.content}</p>

                            <div className="flex items-center gap-3 mt-2">
                                <button
                                    onClick={() => { setOpenComments(openComments === post.id ? null : post.id); setCommentText(''); }}
                                    className="text-[11px] font-bold text-gray-400 hover:text-blue-500 transition-colors"
                                >
                                    댓글 {post.flight_post_comments?.length || 0}
                                </button>
                                {post.user_id !== user?.id && onSendMessage && (
                                    <button
                                        onClick={() => onSendMessage(post.user_id, post.author_name)}
                                        className="text-[11px] font-bold text-blue-500 hover:text-blue-600 transition-colors"
                                    >
                                        쪽지 보내기
                                    </button>
                                )}
                            </div>

                            {openComments === post.id && (
                                <div className="mt-2 pt-2 border-t border-gray-200 space-y-1.5">
                                    {filterBlocked(post.flight_post_comments || [], blockedIds)
                                        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
                                        .map((c) => (
                                            <div key={c.id} className="text-xs">
                                                <span className="font-bold text-gray-600">{c.author_name || '익명'}</span>
                                                <span className="text-gray-700 ml-1.5 break-words">{c.content}</span>
                                            </div>
                                        ))}
                                    {writable && (
                                        <div className="flex gap-1.5 pt-1">
                                            <input
                                                value={commentText}
                                                onChange={(e) => setCommentText(e.target.value)}
                                                onKeyDown={(e) => { if (e.key === 'Enter') handleComment(post.id); }}
                                                maxLength={500}
                                                placeholder="댓글 남기기"
                                                className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 focus:border-blue-400 outline-none"
                                            />
                                            <button
                                                onClick={() => handleComment(post.id)}
                                                className="px-2.5 py-1.5 rounded-lg bg-gray-800 text-white text-xs font-bold"
                                            >
                                                등록
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default FlightBoard;

import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Send, Trash2, Loader2, Lock, Flag, EyeOff, CornerDownRight, X } from 'lucide-react';
import { flightBoardApi } from '../lib/db';
import { REPORT_REASONS } from '../lib/reportReasons';
import { kstDateString, boardStatus, boardTitle, boardErrorMessage } from '../lib/flightBoard';

// 같은 편·같은 날 스케줄을 등록한 사람들이 익명 번호("익명 승객 3")로만 쓰는 미니 게시판.
// 비행 21일 전부터 열리고 비행 다음날부터는 읽기 전용(글은 남는다).
// 입장 자격·작성 기간·익명 번호·비밀댓글 가시성·차단은 전부 서버 RPC 가 판정한다. 여기 표시는 보조일 뿐이다.
// 서버 응답에는 작성자 id·실명이 없다(alias·mine 플래그만). 비밀댓글은 볼 수 있는 것만 내려온다.

const EMPTY = { eligible: false, writable: false, member_type: null, my_alias: null, posts: [] };

// 다른 사람 글·댓글에만 붙는 신고·숨기기
const OtherActions = ({ target, onReport, onMute }) => (
    <>
        <button type="button" onClick={() => onReport(target)} className="text-gray-300 hover:text-red-500 transition-colors" title="신고" aria-label="신고">
            <Flag size={12} />
        </button>
        <button type="button" onClick={() => onMute(target)} className="text-gray-300 hover:text-gray-600 transition-colors" title="이 사람 글 숨기기" aria-label="이 사람 글 숨기기">
            <EyeOff size={12} />
        </button>
    </>
);

// Enter 제출: 한글 조합 중(isComposing)에는 넘기지 않는다
const submitOnEnter = (fn) => (e) => {
    if (e.key !== 'Enter' || e.nativeEvent?.isComposing) return;
    e.preventDefault();
    fn();
};

const FlightBoard = ({ flight }) => {
    const [data, setData] = useState(EMPTY);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [content, setContent] = useState('');
    const [posting, setPosting] = useState(false);
    const [openComments, setOpenComments] = useState(null);
    const [commentText, setCommentText] = useState('');
    const [commentPrivate, setCommentPrivate] = useState(false);
    const [replyTo, setReplyTo] = useState(null);          // { id, alias }
    const [commentBusy, setCommentBusy] = useState(false);
    const [report, setReport] = useState(null);            // { postId, commentId }
    const [reportReason, setReportReason] = useState('');
    const [reportNote, setReportNote] = useState('');
    const [reportBusy, setReportBusy] = useState(false);

    const status = boardStatus(flight.flight_date, kstDateString());
    const locked = status === 'locked';
    const memberType = data.member_type || flight.user_type || 'passenger';
    const writable = data.eligible && data.writable;

    const fetchBoard = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            setData((await flightBoardApi.list(flight.flight_number, flight.flight_date)) || EMPTY);
        } catch (err) {
            console.error('게시판 로드 실패:', err);
            setError('글을 불러오지 못했습니다. 다시 시도해 주세요.');
        } finally {
            setLoading(false);
        }
    }, [flight.flight_number, flight.flight_date]);

    useEffect(() => { if (!locked) fetchBoard(); else setLoading(false); }, [fetchBoard, locked]);

    const resetCommentForm = () => { setCommentText(''); setCommentPrivate(false); setReplyTo(null); };

    const handlePost = async () => {
        const body = content.trim();
        if (!body || posting) return;
        setPosting(true);
        try {
            await flightBoardApi.createPost(flight.flight_number, flight.flight_date, body);
            setContent('');
            await fetchBoard();
        } catch (err) {
            console.error('글 등록 실패:', err);
            alert(boardErrorMessage(err, '글을 올리지 못했습니다. 다시 시도해 주세요.'));
        } finally {
            setPosting(false);
        }
    };

    const handleComment = async (postId) => {
        const body = commentText.trim();
        if (!body || commentBusy) return;
        setCommentBusy(true);
        try {
            await flightBoardApi.createComment(postId, body, { isPrivate: commentPrivate, parentId: replyTo?.id || null });
            resetCommentForm();
            await fetchBoard();
        } catch (err) {
            console.error('댓글 등록 실패:', err);
            alert(boardErrorMessage(err, '댓글을 남기지 못했습니다.'));
        } finally {
            setCommentBusy(false);
        }
    };

    const handleDeletePost = async (postId) => {
        if (!window.confirm('이 글을 삭제할까요?')) return;
        try {
            await flightBoardApi.deletePost(postId);
            await fetchBoard();
        } catch (err) {
            console.error('삭제 실패:', err);
            alert('삭제에 실패했습니다.');
        }
    };

    const handleDeleteComment = async (commentId) => {
        if (!window.confirm('이 댓글을 삭제할까요?')) return;
        try {
            await flightBoardApi.deleteComment(commentId);
            await fetchBoard();
        } catch (err) {
            console.error('댓글 삭제 실패:', err);
            alert('삭제에 실패했습니다.');
        }
    };

    const handleMute = async (target) => {
        if (!window.confirm('이 사람의 같은 편 게시판 글과 댓글을 앞으로 보지 않습니다. 되돌릴 수 없습니다. 계속할까요?')) return;
        try {
            await flightBoardApi.mute(target);
            await fetchBoard();
        } catch (err) {
            console.error('숨기기 실패:', err);
            alert(boardErrorMessage(err, '숨기기에 실패했습니다.'));
        }
    };

    const openReport = (target) => { setReport(target); setReportReason(''); setReportNote(''); };

    const submitReport = async (e) => {
        e.preventDefault();
        if (!report || !reportReason || reportBusy) return;
        setReportBusy(true);
        try {
            await flightBoardApi.report({ ...report, reason: reportReason + (reportNote.trim() ? ` - ${reportNote.trim()}` : '') });
            setReport(null);
            alert('신고가 접수되었습니다. 관리자가 검토 후 조치합니다.');
        } catch (err) {
            console.error('신고 실패:', err);
            alert(boardErrorMessage(err, '신고 접수에 실패했습니다. 다시 시도해 주세요.'));
        } finally {
            setReportBusy(false);
        }
    };

    if (locked) {
        return (
            <div className="mt-4 p-4 bg-gray-50 rounded-xl text-center">
                <Lock size={18} className="mx-auto text-gray-300 mb-1.5" />
                <p className="text-xs text-gray-500">출발 3주 전부터 {boardTitle(memberType)}이 열립니다.</p>
            </div>
        );
    }

    return (
        <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <MessageSquare size={15} className="text-blue-500" />
                    <span className="text-sm font-bold text-gray-700">{boardTitle(memberType)}</span>
                </div>
                {data.eligible && !data.writable && (
                    <span className="text-[11px] font-semibold text-gray-400">비행이 지나 읽기 전용</span>
                )}
            </div>
            {data.eligible && (
                <p className="text-[11px] text-gray-500 mb-3">
                    이름은 보이지 않습니다. 내 이름: <strong className="text-gray-700">{data.my_alias || '첫 글을 쓰면 번호가 정해집니다'}</strong>
                </p>
            )}

            {writable && (
                <div className="mb-3">
                    <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        rows={2}
                        maxLength={1000}
                        placeholder={memberType === 'crew'
                            ? '레이오버 일정이나 같이 다닐 분을 찾아보세요'
                            : '택시 같이 탈 분, 공항 이동, 궁금한 점을 자유롭게 남겨 보세요'}
                        className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none resize-none transition-all"
                    />
                    <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[11px] text-gray-400">{content.length}/1000</span>
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
                    <button onClick={fetchBoard} className="px-3 py-1.5 rounded-lg bg-gray-100 text-xs font-bold text-gray-600">다시 시도</button>
                </div>
            ) : !data.eligible ? (
                <p className="py-6 text-center text-xs text-gray-400">이 편의 게시판에 들어갈 수 없습니다. 스케줄 등록과 생년월일을 확인해 주세요.</p>
            ) : data.posts.length === 0 ? (
                <p className="py-6 text-center text-xs text-gray-400">
                    아직 글이 없습니다.{writable && ' 첫 글을 남겨 보세요.'}
                </p>
            ) : (
                <div className="space-y-2">
                    {data.posts.map((post) => (
                        <div key={post.id} className="p-3 bg-gray-50 rounded-xl">
                            <div className="flex items-start justify-between gap-2 mb-1">
                                <span className="flex items-center gap-1.5 min-w-0 text-xs font-bold text-gray-700">
                                    <span className="truncate">{post.alias || '익명'}</span>
                                    {post.mine && <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 text-[10px] font-bold">나</span>}
                                </span>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className="text-[11px] text-gray-400">
                                        {new Date(post.created_at).toLocaleDateString('ko-KR')}
                                    </span>
                                    {post.deletable && (
                                        <button type="button" onClick={() => handleDeletePost(post.id)} className="text-gray-300 hover:text-red-500 transition-colors" title="삭제" aria-label="삭제">
                                            <Trash2 size={13} />
                                        </button>
                                    )}
                                    {!post.mine && <OtherActions target={{ postId: post.id, commentId: null }} onReport={openReport} onMute={handleMute} />}
                                </div>
                            </div>
                            <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{post.content}</p>

                            <div className="flex items-center gap-3 mt-2">
                                <button
                                    onClick={() => { setOpenComments(openComments === post.id ? null : post.id); resetCommentForm(); }}
                                    className="text-[11px] font-bold text-gray-400 hover:text-blue-500 transition-colors"
                                >
                                    댓글 {post.comments?.length || 0}
                                </button>
                            </div>

                            {openComments === post.id && (
                                <div className="mt-2 pt-2 border-t border-gray-200 space-y-1.5">
                                    {(post.comments || []).map((c) => (
                                        <div key={c.id} className={`text-xs rounded-lg px-2 py-1.5 ${c.is_private ? 'bg-amber-50' : ''}`}>
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="flex items-center gap-1 min-w-0">
                                                    <span className="font-bold text-gray-600 truncate">{c.alias || '익명'}</span>
                                                    {c.mine && <span className="px-1 rounded bg-blue-100 text-blue-600 text-[10px] font-bold">나</span>}
                                                    {c.is_private && <Lock size={11} className="text-amber-500 flex-shrink-0" aria-label="비밀댓글" />}
                                                </span>
                                                <span className="flex items-center gap-2 flex-shrink-0 text-[11px] text-gray-400">
                                                    {new Date(c.created_at).toLocaleDateString('ko-KR')}
                                                    {writable && (
                                                        <button
                                                            type="button"
                                                            onClick={() => { setReplyTo({ id: c.id, alias: c.alias || '익명', isPrivate: !!c.is_private }); if (c.is_private) setCommentPrivate(true); }}
                                                            className="font-bold text-blue-500 hover:text-blue-600"
                                                        >
                                                            답글
                                                        </button>
                                                    )}
                                                    {c.deletable && (
                                                        <button type="button" onClick={() => handleDeleteComment(c.id)} className="text-gray-300 hover:text-red-500 transition-colors" title="삭제" aria-label="댓글 삭제">
                                                            <Trash2 size={12} />
                                                        </button>
                                                    )}
                                                    {!c.mine && <OtherActions target={{ postId: post.id, commentId: c.id }} onReport={openReport} onMute={handleMute} />}
                                                </span>
                                            </div>
                                            {c.parent_alias && (
                                                <p className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5">
                                                    <CornerDownRight size={11} />{c.parent_alias}에게
                                                </p>
                                            )}
                                            <p className="text-gray-700 break-words whitespace-pre-wrap mt-0.5">{c.content}</p>
                                        </div>
                                    ))}
                                    {writable && (
                                        <div className="pt-1 space-y-1.5">
                                            {replyTo && (
                                                <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                                                    <CornerDownRight size={11} />
                                                    <span><strong>{replyTo.alias}</strong>에게 답글</span>
                                                    <button type="button" onClick={() => setReplyTo(null)} className="text-gray-400 hover:text-gray-600" aria-label="답글 취소">
                                                        <X size={11} />
                                                    </button>
                                                </div>
                                            )}
                                            <div className="flex gap-1.5">
                                                <input
                                                    value={commentText}
                                                    onChange={(e) => setCommentText(e.target.value)}
                                                    onKeyDown={submitOnEnter(() => handleComment(post.id))}
                                                    maxLength={500}
                                                    placeholder="댓글 남기기"
                                                    className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 focus:border-blue-400 outline-none"
                                                />
                                                <button
                                                    onClick={() => handleComment(post.id)}
                                                    disabled={commentBusy || !commentText.trim()}
                                                    className="px-2.5 py-1.5 rounded-lg bg-gray-800 text-white text-xs font-bold disabled:opacity-50"
                                                >
                                                    등록
                                                </button>
                                            </div>
                                            <label className="flex items-center gap-1.5 text-[11px] text-gray-500 select-none cursor-pointer">
                                                <input type="checkbox" checked={commentPrivate || !!replyTo?.isPrivate} disabled={!!replyTo?.isPrivate} onChange={(e) => setCommentPrivate(e.target.checked)} />
                                                <Lock size={11} className="text-amber-500" />
                                                {replyTo?.isPrivate ? '비밀댓글에 다는 답글은 비밀댓글로 남습니다' : '비밀댓글 (글쓴이와 나, 답글 대상만 볼 수 있습니다)'}
                                            </label>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {report && (
                <div className="fixed inset-0 bg-black/50 z-[110] flex items-center justify-center p-4" onClick={() => setReport(null)}>
                    <form onSubmit={submitReport} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2"><Flag size={16} className="text-red-500" />신고</h3>
                            <button type="button" onClick={() => setReport(null)} className="p-1.5 hover:bg-gray-100 rounded-full" aria-label="닫기"><X size={16} /></button>
                        </div>
                        <p className="text-xs text-gray-500">신고 내용은 관리자만 봅니다. 상대에게 신고자가 알려지지 않습니다.</p>
                        <select
                            value={reportReason}
                            onChange={(e) => setReportReason(e.target.value)}
                            required
                            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-red-400 outline-none text-sm text-gray-700"
                        >
                            <option value="">사유를 선택해 주세요</option>
                            {REPORT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <textarea
                            value={reportNote}
                            onChange={(e) => setReportNote(e.target.value)}
                            rows={3}
                            maxLength={300}
                            placeholder="추가 설명 (선택)"
                            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-red-400 outline-none text-sm resize-none"
                        />
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setReport(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-700">취소</button>
                            <button type="submit" disabled={reportBusy || !reportReason} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold disabled:opacity-50">
                                {reportBusy ? '접수 중...' : '신고하기'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

export default FlightBoard;

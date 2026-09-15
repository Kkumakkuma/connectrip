import { useCallback, useEffect, useRef, useState } from 'react';
import { CornerDownRight, Lock, Trash2, X } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import { useNicknameGate } from '../../lib/useNicknameGate';
import { displayAuthor } from '../../lib/authorName';
import NicknameRequiredModal from '../NicknameRequiredModal';
import { replyTargetLabel } from '../../lib/flightBoard';
import CrewBadge from '../CrewBadge';
import LoginPrompt from '../LoginPrompt';

// 상세 페이지 댓글 섹션(후기·Q&A·자유게시판 공용, 2026-09-14).
// api 는 boards.js 의 config.comments — getComments/addComment/deleteComment 만 쓴다.
// 답글·비밀댓글 규칙은 목록에서 쓰던 것과 같다(답글이 비밀댓글이면 따라서 비밀).
// 비밀댓글 가시성·삭제 권한은 서버(RLS)가 판정한다 — 여기서는 본인 댓글에만 삭제 버튼을 그린다.
const Comments = ({ api, postId, postOwnerId = null }) => {
    const { user, profile, isLoggedIn } = useAuth();
    const { requireNickname, nicknameModal } = useNicknameGate();
    const [list, setList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [isPrivate, setIsPrivate] = useState(false);
    const [replyTo, setReplyTo] = useState(null);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    const reqRef = useRef(0);   // postId 가 바뀐 뒤 도착한 이전 응답은 버린다

    const load = useCallback(async () => {
        const reqId = ++reqRef.current;
        try {
            setLoading(true); setError(null);
            const data = await api.getComments(postId);
            if (reqId !== reqRef.current) return;
            setList(data || []);
            return data || [];
        } catch (err) {
            if (reqId !== reqRef.current) return;
            console.error('댓글 조회 실패:', err);
            setList([]);
            setError('댓글을 불러오지 못했습니다.');
        } finally {
            if (reqId === reqRef.current) setLoading(false);
        }
    }, [api, postId]);

    useEffect(() => {
        setText(''); setIsPrivate(false); setReplyTo(null);
        load();
    }, [load]);

    const add = async () => {
        if (!isLoggedIn) { setShowLoginPrompt(true); return; }
        const content = text.trim();
        // 목록을 받는 중에는 등록하지 않는다 — 늦게 도착한 조회 응답이 방금 등록한 댓글을 지운다
        if (!content || busy || loading) return;
        if (!requireNickname(() => add())) return;
        try {
            setBusy(true);
            const created = await api.addComment({
                post_id: postId,
                user_id: user.id,
                author_name: profile?.nickname || null,   // 서버 트리거가 profiles.nickname 으로 덮어쓴다
                content,
                is_private: isPrivate || !!replyTo?.isPrivate,
                parent_id: replyTo?.id || null,
            });
            setList((prev) => [...prev, created]);
            setText(''); setIsPrivate(false); setReplyTo(null);
        } catch (err) {
            console.error('댓글 등록 실패:', err);
            alert('댓글 등록에 실패했습니다.');
        } finally {
            setBusy(false);
        }
    };

    const remove = async (commentId) => {
        if (!window.confirm('이 댓글을 삭제할까요?')) return;
        try {
            await api.deleteComment(commentId);
            if (replyTo?.id === commentId) setReplyTo(null);
            // 달린 답글의 처리가 게시판마다 다르다(qna_comments 는 parent_id SET NULL,
            // review_comments 등은 CASCADE) — 화면에서 지레짐작하지 않고 서버 상태를 다시 받는다.
            const rows = await load();
            // 같이 지워진 답글이 답글 대상으로 남아 있으면 해제 (codex 지적, 2026-09-15)
            if (Array.isArray(rows) && replyTo && !rows.some((c) => c.id === replyTo.id)) setReplyTo(null);
        } catch (err) {
            console.error('댓글 삭제 실패:', err);
            alert('댓글 삭제에 실패했습니다.');
        }
    };

    const sorted = [...list].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    return (
        <section className="mt-8">
            <h2 className="text-[15px] font-bold text-ink mb-3">댓글 {list.length}</h2>
            <div className="rounded-md bg-surface-soft px-4 py-3 space-y-3">
                {loading ? (
                    <p className="text-sm text-muted text-center py-2">댓글을 불러오는 중...</p>
                ) : error ? (
                    <p className="text-sm text-error text-center py-2">{error}</p>
                ) : sorted.length > 0 ? (
                    sorted.map((c) => {
                        const target = replyTargetLabel(c, sorted);
                        return (
                            <div key={c.id} className={`rounded-sm px-3 py-2.5 ${c.is_private ? 'bg-amber-50' : 'bg-white border border-hairline-soft'}`}>
                                <div className="flex items-center justify-between mb-1 gap-2">
                                    <span className="flex items-center gap-1 min-w-0 text-[12px] font-bold text-ink">
                                        <span className="truncate">{displayAuthor(c.author_name)}</span>
                                        <CrewBadge profile={c.profiles} />
                                        {postOwnerId && c.user_id === postOwnerId && (
                                            <span className="flex-shrink-0 rounded-full bg-surface-strong px-1.5 py-0.5 text-[10px] font-bold text-muted leading-none">글쓴이</span>
                                        )}
                                        {c.is_private && <Lock size={11} className="text-amber-500 flex-shrink-0" aria-label="비밀댓글" />}
                                    </span>
                                    <span className="flex items-center gap-2 text-[12px] text-muted whitespace-nowrap flex-shrink-0">
                                        {new Date(c.created_at).toLocaleDateString('ko-KR')}
                                        {isLoggedIn && (
                                            <button
                                                type="button"
                                                onClick={() => { setReplyTo({ id: c.id, name: displayAuthor(c.author_name), isPrivate: !!c.is_private }); if (c.is_private) setIsPrivate(true); }}
                                                className="font-bold text-ink hover:underline"
                                            >
                                                답글
                                            </button>
                                        )}
                                        {user?.id === c.user_id && (
                                            <button
                                                type="button"
                                                onClick={() => remove(c.id)}
                                                aria-label="댓글 삭제"
                                                className="p-1 rounded-full text-muted hover:text-error hover:bg-surface-soft"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        )}
                                    </span>
                                </div>
                                {target && (
                                    <p className="text-[11px] text-muted mb-0.5 flex items-center gap-1"><CornerDownRight size={11} />{target}에게</p>
                                )}
                                <p className="text-sm text-body whitespace-pre-wrap break-keep">{c.content}</p>
                            </div>
                        );
                    })
                ) : (
                    <p className="text-sm text-muted text-center py-2">댓글이 없습니다</p>
                )}

                {replyTo && (
                    <div className="flex items-center gap-1.5 text-[12px] text-muted">
                        <CornerDownRight size={12} />
                        <span><strong className="text-ink">{replyTo.name}</strong>에게 답글</span>
                        <button type="button" onClick={() => setReplyTo(null)} className="text-muted hover:text-ink" aria-label="답글 취소"><X size={12} /></button>
                    </div>
                )}
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => { if (e.key !== 'Enter' || e.nativeEvent?.isComposing) return; e.preventDefault(); add(); }}
                        placeholder="댓글"
                        aria-label="댓글 입력"
                        maxLength={2000}
                        disabled={loading}
                        className="input-air flex-1 min-w-0 !py-2 text-sm"
                    />
                    <button type="button" onClick={add} disabled={busy || loading} className="btn-air-secondary !py-2">등록</button>
                </div>
                <label className="flex items-center gap-1.5 text-[12px] text-muted select-none cursor-pointer">
                    <input type="checkbox" checked={isPrivate || !!replyTo?.isPrivate} disabled={!!replyTo?.isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                    <Lock size={11} className="text-amber-500" />
                    비밀댓글
                </label>
            </div>
            <LoginPrompt isOpen={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
            <NicknameRequiredModal {...nicknameModal} />
        </section>
    );
};

export default Comments;

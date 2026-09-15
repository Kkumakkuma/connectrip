import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { checkNicknameTaken } from '../lib/nicknameApi';
import { normalizeNickname, nicknameProblem, messageFor, codeFromError, NICKNAME_MAX } from '../lib/profileEdit';

// 닉네임 없는 회원이 글·댓글을 쓰려 할 때 띄우는 창(2026-09-15). 게시판 작성자는 닉네임으로만 표시된다.
// 규칙·중복 확인·저장은 마이페이지 회원 정보 카드(ProfileCard)와 같은 함수를 쓴다.
// 부모 form 안에서 렌더돼도 submit 이 부모로 번지지 않도록 <form> 을 쓰지 않고 Enter 를 직접 처리한다.
const NicknameRequiredModal = ({ open, onClose, onSaved }) => {
    const { user, updateProfile } = useAuth();
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef(null);
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; });

    useEffect(() => {
        if (!open) return undefined;
        setValue(''); setError(''); setBusy(false);
        // 글쓰기 시트(WriteModal)도 document 에서 Esc 를 듣는다 — 캡처 단계에서 먼저 받아 이 창만 닫는다.
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            onCloseRef.current?.();
        };
        window.addEventListener('keydown', onKey, true);
        const t = setTimeout(() => inputRef.current?.focus(), 30);
        return () => { clearTimeout(t); window.removeEventListener('keydown', onKey, true); };
    }, [open]);

    if (!open) return null;

    const save = async () => {
        if (busy) return;
        const n = normalizeNickname(value);
        const problem = nicknameProblem(n);
        if (problem) { setError(problem); return; }
        if (!user) { setError('로그인이 필요합니다.'); return; }
        setBusy(true); setError('');
        try {
            if (await checkNicknameTaken(n)) { setError(messageFor('NICKNAME_TAKEN')); return; }
            const after = await updateProfile({ nickname: n });
            if (!after || after.nickname !== n) { setError('저장이 반영되지 않았습니다. 새로고침한 뒤 다시 시도해주세요.'); return; }
            onSaved?.(n);
        } catch (err) {
            const code = codeFromError(err);
            if (err?.code === '23514') setError('사용할 수 없는 닉네임입니다. 다른 닉네임을 입력해주세요.');
            else setError(messageFor(code, '닉네임을 저장하지 못했습니다.'));
        } finally {
            setBusy(false);
        }
    };

    return createPortal(
        <div
            className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center px-4"
            onClick={(e) => { e.stopPropagation(); if (!busy) onCloseRef.current?.(); }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="nickname-required-title"
                onClick={(e) => e.stopPropagation()}
                className="relative bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6"
            >
                <button type="button" onClick={() => onCloseRef.current?.()} disabled={busy} aria-label="닫기"
                    className="absolute right-3 top-3 p-2 rounded-full hover:bg-surface-soft text-ink">
                    <X size={18} />
                </button>
                <h2 id="nickname-required-title" className="text-[17px] font-bold text-ink pr-8 break-keep">닉네임을 먼저 정해 주세요</h2>
                <p className="mt-1.5 text-[14px] text-body break-keep">게시판에는 닉네임으로 표시됩니다.</p>
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => { setValue(e.target.value); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); save(); } }}
                    maxLength={NICKNAME_MAX}
                    aria-label="닉네임"
                    placeholder="닉네임"
                    autoComplete="off"
                    disabled={busy}
                    className="mt-4 w-full rounded-lg border border-hairline px-3.5 py-3 text-[15px] text-ink outline-none focus:border-ink"
                />
                {error && <p role="alert" className="mt-2 text-[13px] text-red-600 break-keep">{error}</p>}
                <button type="button" onClick={save} disabled={busy}
                    className="btn-air-primary mt-4 w-full inline-flex items-center justify-center gap-1.5 disabled:opacity-60">
                    {busy && <Loader2 size={16} className="animate-spin" />} 저장
                </button>
            </div>
        </div>,
        document.body
    );
};

export default NicknameRequiredModal;

import { useEffect, useRef, useState } from 'react';

// 글쓰기 임시저장 표시(2026-09-25). 동작은 src/lib/useDraft.js.

const hhmm = (ms) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const when = (ms) => {
    const d = new Date(ms);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay ? hhmm(ms) : `${d.getMonth() + 1}월 ${d.getDate()}일 ${hhmm(ms)}`;
};

// 폼 맨 위: 저장본을 불러왔을 때만 보인다. "새로 쓰기" = 저장본을 지우고 빈 폼으로.
// discardDisabled: 사진을 올리는 중에는 누를 수 없다(업로드가 끝나며 사진이 비운 폼에 다시 붙는다, codex 9/25).
export const DraftNotice = ({ restoredAt, onDiscard, discardDisabled = false }) => {
    if (!restoredAt) return null;
    return (
        <div role="status" className="flex items-center justify-between gap-3 rounded-md bg-surface-soft px-3.5 py-2.5">
            <p className="text-[13px] text-body">임시저장한 글을 불러왔어요 <span className="text-muted whitespace-nowrap">({when(restoredAt)})</span></p>
            <button type="button" onClick={onDiscard} disabled={discardDisabled} className="btn-air-link !text-[13px] whitespace-nowrap flex-shrink-0 disabled:opacity-50">새로 쓰기</button>
        </div>
    );
};

// 하단 버튼 줄: "임시저장" + 마지막 저장 시각(자동 저장 포함).
// 좁은 화면(640px 미만)은 한 줄에 다 안 들어갈 수 있어 시각을 숨기고, 누른 직후 버튼 글자가 잠깐 "저장됨"으로 바뀐다.
// compact: 같은 편 게시판처럼 작은 입력칸용(시각 없이 작은 글자 버튼).
export const DraftSaveButton = ({ savedAt, onSave, disabled = false, compact = false }) => {
    const [flash, setFlash] = useState(false);
    const t = useRef(null);
    useEffect(() => () => clearTimeout(t.current), []);
    const click = () => {
        const ok = onSave?.();
        if (!ok) return;
        setFlash(true);
        clearTimeout(t.current);
        t.current = setTimeout(() => setFlash(false), 1500);
    };
    if (compact) {
        return (
            <button type="button" onClick={click} disabled={disabled} className="px-2 py-1.5 text-xs font-bold text-gray-500 hover:text-gray-800 whitespace-nowrap disabled:opacity-50" aria-live="polite">
                {flash ? '저장됨' : '임시저장'}
            </button>
        );
    }
    return (
        <span className="inline-flex items-center gap-2">
            <span className="hidden sm:inline text-[12px] text-muted whitespace-nowrap" aria-live="polite">{savedAt ? `${hhmm(savedAt)} 저장됨` : ''}</span>
            <button type="button" onClick={click} disabled={disabled} className="btn-air-secondary !py-2 whitespace-nowrap disabled:opacity-50" aria-live="polite">
                {flash ? '저장됨' : '임시저장'}
            </button>
        </span>
    );
};

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';

// 글쓰기 임시저장 v2 화면(2026-09-25). 동작은 src/lib/usePostDrafts.js.

const hhmm = (ms) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const when = (iso) => {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return '';
    const d = new Date(ms);
    return d.toDateString() === new Date().toDateString() ? hhmm(ms) : `${d.getMonth() + 1}월 ${d.getDate()}일 ${hhmm(ms)}`;
};

// 폼 맨 위: 이 게시판에 임시저장한 글이 있을 때만 "임시저장한 글 N개 · 불러오기". 누르면 목록.
export const DraftLoadBar = ({ drafts, onLoad, onRemove, disabled = false, compact = false }) => {
    if (!drafts.enabled) return null;
    if (drafts.status === 'error') {
        return (
            <div className={`flex items-center justify-between gap-3 rounded-md bg-surface-soft ${compact ? 'px-3 py-2' : 'px-3.5 py-2.5'}`}>
                <p className="text-[13px] text-body">임시저장 목록을 불러오지 못했어요</p>
                <button type="button" onClick={drafts.refresh} className="btn-air-secondary btn-air-sm">다시 시도</button>
            </div>
        );
    }
    if (drafts.status !== 'ready' || drafts.items.length === 0) return null;
    const open = drafts.showList;
    return (
        <div className="rounded-md bg-surface-soft">
            <div className={`flex items-center justify-between gap-3 ${compact ? 'px-3 py-2' : 'px-3.5 py-2.5'}`}>
                <p className="text-[13px] text-body">임시저장한 글 {drafts.items.length}개</p>
                <button
                    type="button"
                    onClick={() => drafts.setShowList((v) => !v)}
                    disabled={disabled}
                    aria-expanded={open}
                    className="btn-air-secondary btn-air-sm"
                >
                    {open ? '닫기' : '불러오기'}
                </button>
            </div>
            {open && (
                <ul className="border-t border-hairline-soft divide-y divide-hairline-soft max-h-64 overflow-y-auto">
                    {drafts.items.map((item) => (
                        <li key={item.id} className="flex items-center gap-2 px-3.5 py-2">
                            <button
                                type="button"
                                onClick={() => onLoad(item)}
                                disabled={disabled || drafts.busy}
                                className="min-w-0 flex-1 text-left disabled:opacity-50 group"
                            >
                                <span className="block truncate text-[14px] font-bold text-ink group-hover:underline underline-offset-4">{item.title || '제목 없음'}</span>
                                <span className="block text-[12px] text-muted">
                                    {when(item.updated_at)}
                                    {drafts.current?.id === item.id && <span className="ml-1.5 font-bold text-ink">· 지금 쓰는 글</span>}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => onRemove(item)}
                                disabled={disabled || drafts.busy}
                                aria-label={`임시저장 글 삭제: ${item.title || '제목 없음'}`}
                                className="p-2 rounded-full text-muted hover:text-ink hover:bg-white flex-shrink-0 disabled:opacity-50"
                            >
                                <Trash2 size={15} aria-hidden="true" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

// 하단: "임시저장" 버튼. 서버 저장이 확인된 뒤에만 잠깐 "저장됨", 넓은 화면은 마지막 저장 시각도.
export const DraftSaveButton = ({ drafts, onSave, disabled = false, compact = false }) => {
    const [flash, setFlash] = useState(false);
    const t = useRef(null);
    useEffect(() => () => clearTimeout(t.current), []);
    if (!drafts.enabled) return null;
    const click = async () => {
        const res = await onSave();
        if (!res) return;
        setFlash(true);
        clearTimeout(t.current);
        t.current = setTimeout(() => setFlash(false), 1500);
    };
    const label = flash ? '저장됨' : drafts.busy ? '저장 중...' : '임시저장';
    if (compact) {
        return (
            <button type="button" onClick={click} disabled={disabled || drafts.busy} className="btn-air-secondary btn-air-sm" aria-live="polite">
                {label}
            </button>
        );
    }
    return (
        <span className="inline-flex items-center gap-2">
            <span className="hidden sm:inline text-[12px] text-muted whitespace-nowrap">{drafts.savedAt ? `${hhmm(drafts.savedAt)} 저장됨` : ''}</span>
            <button type="button" onClick={click} disabled={disabled || drafts.busy} className="btn-air-secondary" aria-live="polite">
                {label}
            </button>
        </span>
    );
};

// 창을 닫으려 할 때 임시저장 안 한 내용이 있으면 묻는다(2026-09-25 쿠마님 지시 "임시저장 하시겠습니까 하고 물어보던가").
// [임시저장] = 저장하고 닫기, [저장 안 함] = 그냥 닫기, [취소]·Esc·바깥 = 계속 쓰기.
// 글쓰기 시트(z-70)·같은 편 게시판 팝업(z-110) 위에 뜨도록 z-130. role=dialog aria-modal 이라 WriteModal 의 포커스 가둠이 비켜 준다.
export const DraftCloseDialog = ({ open, saving, onSave, onDiscard, onCancel }) => {
    const saveRef = useRef(null);
    const cancelRef = useRef(onCancel);
    useEffect(() => { cancelRef.current = onCancel; });
    useEffect(() => {
        if (!open) return undefined;
        const prev = document.activeElement;
        const t = setTimeout(() => saveRef.current?.focus(), 0);
        // 캡처 단계에서 Esc 를 먼저 받아 글쓰기 시트의 Esc(=닫기 요청)로 번지지 않게 한다
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); cancelRef.current?.(); } };
        window.addEventListener('keydown', onKey, true);
        return () => {
            clearTimeout(t);
            window.removeEventListener('keydown', onKey, true);
            if (prev && typeof prev.focus === 'function') prev.focus();
        };
    }, [open]);
    if (!open) return null;
    return createPortal(
        <div className="fixed inset-0 z-[130] bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="draft-close-title"
                onClick={(e) => e.stopPropagation()}
                className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-5"
            >
                <p id="draft-close-title" className="text-[16px] font-bold text-ink">임시저장하시겠습니까?</p>
                <div className="mt-5 flex items-center justify-end gap-2 flex-wrap">
                    <button type="button" onClick={onCancel} className="btn-air-secondary">취소</button>
                    <button type="button" onClick={onDiscard} disabled={saving} className="btn-air-secondary">저장 안 함</button>
                    <button ref={saveRef} type="button" onClick={onSave} disabled={saving} className="btn-air-primary">{saving ? '저장 중...' : '임시저장'}</button>
                </div>
            </div>
        </div>,
        document.body
    );
};

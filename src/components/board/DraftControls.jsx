import { useEffect, useRef, useState } from 'react';
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
                <button type="button" onClick={drafts.refresh} className="btn-air-link !text-[13px] whitespace-nowrap">다시 시도</button>
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
                    className="btn-air-link !text-[13px] whitespace-nowrap disabled:opacity-50"
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
            <button type="button" onClick={click} disabled={disabled || drafts.busy} className="px-2 py-1.5 text-xs font-bold text-gray-500 hover:text-gray-800 whitespace-nowrap disabled:opacity-50" aria-live="polite">
                {label}
            </button>
        );
    }
    return (
        <span className="inline-flex items-center gap-2">
            <span className="hidden sm:inline text-[12px] text-muted whitespace-nowrap">{drafts.savedAt ? `${hhmm(drafts.savedAt)} 저장됨` : ''}</span>
            <button type="button" onClick={click} disabled={disabled || drafts.busy} className="btn-air-secondary !py-2 whitespace-nowrap disabled:opacity-50" aria-live="polite">
                {label}
            </button>
        </span>
    );
};

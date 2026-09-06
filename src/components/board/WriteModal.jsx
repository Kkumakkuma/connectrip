import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// 글쓰기 시트(에어비앤비식): 상단 좌측 닫기·중앙 제목·hairline, 본문 스크롤, 하단 footer(취소/등록).
// body 에 포탈로 붙여 framer-motion transform 안에서도 화면 전체를 덮는다. Esc 로 닫히고, 열릴 때 첫 입력에 포커스,
// Tab 은 시트 안에서만 돈다. onClose 는 ref 로 들고 있어 부모가 인라인 함수를 넘겨도 effect 가 매번 다시 돌지 않는다.
const WriteModal = ({ open, title, onClose, children, footer }) => {
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; });
    const boxRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const prevActive = document.activeElement;
        const onKey = (e) => {
            if (e.key === 'Escape') { onCloseRef.current?.(); return; }
            if (e.key !== 'Tab' || !boxRef.current) return;
            const nodes = [...boxRef.current.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n.classList.contains('sr-only'));
            if (nodes.length === 0) return;
            const first = nodes[0]; const last = nodes[nodes.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const t = setTimeout(() => {
            const firstField = boxRef.current?.querySelector('input:not([type=radio]):not([type=hidden]), textarea, select, input[type=radio]');
            (firstField || boxRef.current)?.focus?.();
        }, 30);
        return () => {
            clearTimeout(t);
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
            if (prevActive && typeof prevActive.focus === 'function') prevActive.focus();
        };
    }, [open]);

    if (!open) return null;
    return createPortal(
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center" onClick={() => onCloseRef.current?.()}>
            <div
                ref={boxRef}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
                className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[88vh] outline-none"
            >
                <div className="relative flex items-center justify-center h-14 border-b border-hairline flex-shrink-0">
                    <button type="button" onClick={() => onCloseRef.current?.()} aria-label="닫기" className="absolute left-3 p-2 rounded-full hover:bg-surface-soft text-ink">
                        <X size={18} />
                    </button>
                    <h2 className="text-[16px] font-bold text-ink">{title}</h2>
                </div>
                <div className="overflow-y-auto px-5 sm:px-6 py-5 flex-1">{children}</div>
                {footer && (
                    <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-3.5 border-t border-hairline flex-shrink-0">{footer}</div>
                )}
            </div>
        </div>,
        document.body
    );
};

export default WriteModal;

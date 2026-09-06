import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// 글쓰기 시트(에어비앤비식): 상단 좌측 닫기·중앙 제목·hairline, 본문 스크롤, 하단 footer(취소/등록).
// body 에 포탈로 붙여 framer-motion transform 안에서도 화면 전체를 덮는다. Esc 로 닫힌다.
const WriteModal = ({ open, title, onClose, children, footer }) => {
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }, [open, onClose]);

    if (!open) return null;
    return createPortal(
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                onClick={(e) => e.stopPropagation()}
                className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[88vh]"
            >
                <div className="relative flex items-center justify-center h-14 border-b border-hairline flex-shrink-0">
                    <button type="button" onClick={onClose} aria-label="닫기" className="absolute left-3 p-2 rounded-full hover:bg-surface-soft text-ink">
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

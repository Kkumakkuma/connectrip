import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// 글쓰기 시트(에어비앤비식): 상단 좌측 닫기·중앙 제목·hairline, 본문 스크롤, 하단 footer(취소/등록).
// body 에 포탈로 붙여 framer-motion transform 안에서도 화면 전체를 덮는다. Esc 로 닫히고, 열릴 때 첫 입력에 포커스,
// Tab 은 시트 안에서만 돈다. onClose 는 ref 로 들고 있어 부모가 인라인 함수를 넘겨도 effect 가 매번 다시 돌지 않는다.
// keepMounted: 닫혀도 내용을 언마운트하지 않고 숨기기만 한다(2026-09-16 codex 검토) — 마이페이지 회원 정보 팝업에서
// 닫았다 다시 열면 입력 중이던 값·인증번호 발송 상태·저장 진행 표시가 사라지던 문제. 게시판 글쓰기 시트는 기본값(언마운트) 그대로.
const WriteModal = ({ open, title, onClose, children, footer, keepMounted = false }) => {
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; });
    const boxRef = useRef(null);
    const closeBtnRef = useRef(null);

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
            // 입력칸이 없는 내용(회원 정보 조회 화면 등)은 컨테이너 대신 닫기 버튼에 — 컨테이너에 포커스가 있으면 Tab 트랩이 첫/끝 판정을 못 한다.
            (firstField || closeBtnRef.current || boxRef.current)?.focus?.();
        }, 30);
        return () => {
            clearTimeout(t);
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
            if (prevActive && typeof prevActive.focus === 'function') prevActive.focus();
        };
    }, [open]);

    if (!open && !keepMounted) return null;
    return createPortal(
        <div
            className={open ? 'fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center' : 'hidden'}
            aria-hidden={open ? undefined : true}
            onClick={() => onCloseRef.current?.()}
        >
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
                    <button ref={closeBtnRef} type="button" onClick={() => onCloseRef.current?.()} aria-label="닫기" className="absolute left-3 p-2 rounded-full hover:bg-surface-soft text-ink">
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

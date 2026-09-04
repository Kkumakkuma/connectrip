import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// 플래너 공용 바텀시트 (설계 §8 · §1.1 핀 상세, codex-26 D5: focus trap + Esc 필수).
//
// portal 을 쓰지 않고 .ct-planner 서브트리 안에 그대로 렌더한다 —
// document.body 로 옮기면 planner.css 의 스코프(:where(.ct-planner))를 벗어나 버튼 테두리 복구가
// 적용되지 않는다. position:fixed 라 DOM 위치와 무관하게 화면 전체를 덮는다.
// (조상에 transform/filter 를 걸면 fixed 의 기준이 바뀌므로 레이아웃에 그런 속성을 쓰지 않는다.)
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// 선택자만으로는 "실제로 포커스가 가는 요소"를 못 가린다 — hidden·inert·aria-hidden·
// display:none 인 것까지 걸려 첫 포커스나 Tab 순환이 엉뚱한 데서 멈춘다.
// 화면에 실제로 그려진 것만 남긴다(getClientRects 는 position:fixed 요소도 정확히 잡는다).
function focusableIn(panel) {
  return Array.from(panel?.querySelectorAll(FOCUSABLE) || []).filter(
    (el) =>
      !el.hasAttribute('hidden') &&
      !el.closest('[inert]') &&
      !el.closest('[aria-hidden="true"]') &&
      (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0)
  );
}

export default function Sheet({ open, onClose, title, children, footer, labelledBy }) {
  const panelRef = useRef(null);
  // onClose 를 ref 로 받는다. deps 에 직접 넣으면 부모가 인라인 화살표 함수를 넘길 때마다
  // 효과가 재실행돼 시트가 열려 있는 내내 첫 요소로 포커스가 되돌아간다.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    if (!open) return undefined;
    const panel = panelRef.current;
    const restoreTo = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const items = () => focusableIn(panel);
    (items()[0] || panel)?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const list = items();
      if (list.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      const index = list.indexOf(document.activeElement);
      if (event.shiftKey) {
        if (index <= 0) {
          event.preventDefault();
          list[list.length - 1].focus();
        }
      } else if (index === -1 || index === list.length - 1) {
        event.preventDefault();
        list[0].focus();
      }
    };

    // capture 단계에서 잡아 시트 밖 핸들러보다 먼저 처리한다.
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      // 시트를 닫는 동작이 트리거 자체를 없앤 경우(목록에서 삭제 등) 떨어져 나간 노드에
      // focus() 를 부르면 포커스가 body 로 유실된다. 아직 문서에 붙어 있을 때만 되돌린다.
      if (restoreTo && restoreTo.isConnected && typeof restoreTo.focus === 'function') {
        restoreTo.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]">
      <div
        className="absolute inset-0 bg-ink/40"
        onClick={() => closeRef.current?.()}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : title}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="ct-sheet-panel absolute inset-x-0 bottom-0 max-h-[86dvh] overflow-y-auto rounded-t-[14px] bg-canvas shadow-card focus:outline-none sm:mx-auto sm:w-[520px]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={() => closeRef.current?.()}
            aria-label="닫기"
            className="-mr-1 rounded-sm p-1 text-muted transition-colors hover:bg-surface-soft hover:text-ink"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="px-5 py-4 text-sm text-body">{children}</div>
        {footer && (
          <div className="border-t border-hairline px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

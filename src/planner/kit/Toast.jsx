import { useEffect, useRef } from 'react';
import { Check, Info, TriangleAlert, X } from 'lucide-react';

// 플래너 공용 토스트. 커넥트립 전역 토스트(App.jsx)와 별개로 플래너 안에서만 쓴다.
// 화면 아래쪽 액션바를 가리지 않도록 safe-area 만큼 띄운다.
const TONES = {
  info: { cls: 'bg-ink text-canvas', Icon: Info },
  success: { cls: 'bg-success text-on-primary', Icon: Check },
  error: { cls: 'bg-error text-on-primary', Icon: TriangleAlert },
};

export function Toast({ tone = 'info', message, onClose, duration = 4000 }) {
  const { cls, Icon } = TONES[tone] || TONES.info;
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    if (!duration) return undefined;
    const id = setTimeout(() => closeRef.current?.(), duration);
    return () => clearTimeout(id);
  }, [duration, message]);

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-2 rounded-sm px-4 py-3 text-sm shadow-card ${cls}`}
    >
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span className="flex-1">{message}</span>
      {onClose && (
        <button
          type="button"
          onClick={() => closeRef.current?.()}
          aria-label="알림 닫기"
          className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// items = [{ id, tone, message }]
export function ToastStack({ items = [], onDismiss }) {
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex flex-col items-center gap-2 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      {items.map((item) => (
        <div key={item.id} className="w-full max-w-sm">
          <Toast
            tone={item.tone}
            message={item.message}
            onClose={onDismiss ? () => onDismiss(item.id) : undefined}
          />
        </div>
      ))}
    </div>
  );
}

export default Toast;

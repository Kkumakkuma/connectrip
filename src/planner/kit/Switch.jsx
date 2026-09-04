import { useId } from 'react';

// 플래너 공용 켜기/끄기. 시각적으로는 스위치지만 접근성 트리에는 role="switch" 버튼으로 노출한다.
// 라벨 전체가 누를 수 있는 영역이라 손가락으로도 정확히 눌린다.
export default function Switch({ label, description, checked = false, onChange, disabled = false }) {
  const id = useId();
  const descId = description ? `${id}-desc` : undefined;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
        </label>
        {description && (
          <p id={descId} className="mt-0.5 text-xs text-muted">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={descId}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={[
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-surface-strong',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            'absolute top-0.5 h-5 w-5 rounded-full bg-canvas shadow-card transition-all',
            checked ? 'left-[22px]' : 'left-0.5',
          ].join(' ')}
        />
      </button>
    </div>
  );
}

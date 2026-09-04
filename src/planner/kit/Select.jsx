import { useId } from 'react';
import { ChevronDown } from 'lucide-react';

// 플래너 공용 선택 입력. Input 과 같은 라벨·도움말·오류 규칙을 따른다.
//   options = [{ value, label }]
export default function Select({
  label,
  hint,
  error,
  id,
  options = [],
  className = '',
  ...rest
}) {
  const autoId = useId();
  const selectId = id || autoId;
  const helpId = `${selectId}-help`;
  const message = error || hint;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={selectId} className="mb-1.5 block text-sm font-medium text-ink">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? helpId : undefined}
          className={[
            'h-11 w-full appearance-none rounded-sm border bg-canvas px-3 pr-9 text-sm text-ink',
            'focus:outline-none',
            error ? 'border-error focus:border-error' : 'border-hairline focus:border-ink',
            className,
          ].filter(Boolean).join(' ')}
          {...rest}
        >
          {options.map((opt) => (
            <option key={String(opt.value)} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
        />
      </div>
      {message && (
        <p id={helpId} className={`mt-1.5 text-xs ${error ? 'text-error' : 'text-muted'}`}>
          {message}
        </p>
      )}
    </div>
  );
}

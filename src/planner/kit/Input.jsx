import { useId } from 'react';

// 플래너 공용 입력 (설계 §8: rounded-sm border-hairline focus:border-ink).
// error 가 있으면 aria-describedby 로 읽히도록 연결한다.
export default function Input({
  label,
  hint,
  error,
  id,
  className = '',
  ...rest
}) {
  const autoId = useId();
  const inputId = id || autoId;
  const helpId = `${inputId}-help`;
  const message = error || hint;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink">
          {label}
        </label>
      )}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? helpId : undefined}
        className={[
          'h-11 w-full rounded-sm border bg-canvas px-3 text-sm text-ink',
          'placeholder:text-muted-soft focus:outline-none',
          error ? 'border-error focus:border-error' : 'border-hairline focus:border-ink',
          className,
        ].filter(Boolean).join(' ')}
        {...rest}
      />
      {message && (
        <p id={helpId} className={`mt-1.5 text-xs ${error ? 'text-error' : 'text-muted'}`}>
          {message}
        </p>
      )}
    </div>
  );
}

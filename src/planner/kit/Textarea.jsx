import { useId, useRef } from 'react';
import { applyToInput, suggestHangul } from '../../lib/hangulFix';
import HangulFixHint from './HangulFixHint';

// 플래너 공용 여러 줄 입력. Input 과 같은 라벨·도움말·오류 규칙을 따른다.
export default function Textarea({ label, hint, error, id, rows = 4, className = '', hangulFix = false, ...rest }) {
  const autoId = useId();
  const fieldId = id || autoId;
  const helpId = `${fieldId}-help`;
  const message = error || hint;
  const hangul = hangulFix && typeof rest.value === 'string' ? suggestHangul(rest.value) : null;
  const ref = useRef(null);

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={fieldId} className="mb-1.5 block text-sm font-medium text-ink">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? helpId : undefined}
        className={[
          'w-full rounded-sm border bg-canvas px-3 py-2.5 text-sm leading-relaxed text-ink',
          'placeholder:text-muted-soft focus:outline-none',
          error ? 'border-error focus:border-error' : 'border-hairline focus:border-ink',
          className,
        ].filter(Boolean).join(' ')}
        {...rest}
      />
      {hangul && <HangulFixHint fixed={hangul} controls={fieldId} onApply={() => applyToInput(ref.current, hangul)} />}
      {message && (
        <p id={helpId} className={`mt-1.5 text-xs ${error ? 'text-error' : 'text-muted'}`}>
          {message}
        </p>
      )}
    </div>
  );
}

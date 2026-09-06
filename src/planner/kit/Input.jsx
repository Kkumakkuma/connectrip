import { useId, useRef } from 'react';
import { applyToInput, suggestHangul } from '../../lib/hangulFix';
import HangulFixHint from './HangulFixHint';

// 플래너 공용 입력 (설계 §8: rounded-sm border-hairline focus:border-ink).
// error 가 있으면 aria-describedby 로 읽히도록 연결한다.
export default function Input({
  label,
  hint,
  error,
  id,
  className = '',
  hangulFix = false,
  ...rest
}) {
  const autoId = useId();
  const inputId = id || autoId;
  const helpId = `${inputId}-help`;
  const message = error || hint;
  // 한/영을 잊고 영문 자판으로 친 한글("elwhdrhksrhkdwl")이면 한 번 눌러 한글로 바꾸는 길을 둔다.
  // 입력 모드 자체는 윈도우가 쥐고 있어 페이지가 바꿀 수 없다(2026-09-06 실측). 조건은 src/lib/hangulFix.js 참고.
  const hangul = hangulFix && typeof rest.value === 'string' ? suggestHangul(rest.value) : null;
  const ref = useRef(null);

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink">
          {label}
        </label>
      )}
      <input
        ref={ref}
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
      {hangul && <HangulFixHint fixed={hangul} controls={inputId} onApply={() => applyToInput(ref.current, hangul)} />}
      {message && (
        <p id={helpId} className={`mt-1.5 text-xs ${error ? 'text-error' : 'text-muted'}`}>
          {message}
        </p>
      )}
    </div>
  );
}

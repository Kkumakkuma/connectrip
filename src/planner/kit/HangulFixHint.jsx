// 영문 자판으로 친 한글을 한 번 눌러 되살리는 힌트. Input/Textarea 가 함께 쓴다.
// 스크린 리더에 변환 제안이 생겼음을 알리고(aria-live), 어느 칸을 바꾸는지 연결한다(aria-controls).
export default function HangulFixHint({ fixed, onApply, controls, className = '' }) {
  if (!fixed) return null;
  return (
    <div role="status" aria-live="polite" className={`mt-1.5 ${className}`}>
      <button
        type="button"
        aria-controls={controls}
        onMouseDown={(e) => e.preventDefault()}   // 마우스로 눌러도 입력칸 포커스를 뺏지 않는다(키보드는 applyToInput 이 되돌린다)
        onClick={onApply}
        className="inline-flex min-h-[32px] max-w-full items-center gap-1 rounded-sm bg-surface-soft px-2.5 py-1.5 text-xs text-ink"
      >
        <span className="text-muted">한글로 바꾸기</span>
        <span className="truncate font-semibold">{fixed}</span>
      </button>
    </div>
  );
}

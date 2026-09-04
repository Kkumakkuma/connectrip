import { Loader2 } from 'lucide-react';

// 플래너 공용 버튼 (설계 §8).
//   primary   = 채운 액센트. 화면당 1개를 원칙으로 한다.
//   secondary = 헤어라인 테두리. 테두리가 보이려면 planner.css 의 border 복구가 필요하다.
//   ghost     = 배경 없음. 아이콘 버튼·목록 안 보조 동작용.
//   danger    = 삭제 계열.
const VARIANTS = {
  primary: 'bg-primary text-on-primary hover:bg-primary-active disabled:bg-primary-disabled',
  secondary: 'bg-canvas text-ink border border-hairline hover:bg-surface-soft disabled:text-muted-soft',
  ghost: 'bg-transparent text-body hover:bg-surface-soft disabled:text-muted-soft',
  danger: 'bg-error text-on-primary hover:bg-error-hover disabled:bg-muted-soft',
};

const SIZES = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  const tone = VARIANTS[variant] || VARIANTS.primary;
  const box = SIZES[size] || SIZES.md;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-sm font-medium',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        'disabled:cursor-not-allowed',
        box,
        tone,
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {loading && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

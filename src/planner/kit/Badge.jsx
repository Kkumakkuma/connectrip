// 플래너 공용 배지 (설계 §8: rounded-full text-xs font-semibold).
const TONES = {
  neutral: 'bg-surface-strong text-body',
  primary: 'bg-primary text-on-primary',
  outline: 'border border-hairline text-body',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  error: 'bg-error/10 text-error',
};

export default function Badge({ tone = 'neutral', className = '', children, ...rest }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        TONES[tone] || TONES.neutral,
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </span>
  );
}

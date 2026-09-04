// 플래너 공용 빈 상태 (설계 §8: 한 줄 "…이 없습니다.").
// 설명을 여러 줄 늘리지 않는다 — 빈 화면에서 가장 필요한 건 다음 동작 하나다.
export default function EmptyState({ icon: Icon, message, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 px-6 py-14 text-center ${className}`}>
      {Icon && (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-soft text-muted">
          <Icon size={22} aria-hidden="true" />
        </span>
      )}
      <p className="text-sm text-muted">{message}</p>
      {action}
    </div>
  );
}

// 지도 경로 범례 — 도보(초록 짧은 점선)·대중교통(파랑 실선)·차량(주황 긴 점선).
// 지도 "안"이 아니라 지도 바로 아래 줄에 일반 흐름으로 둔다(2026-09-20 운영 실측): 지도 안 왼쪽 아래는 구글 로고 자리이고
// 플래너 하단 액션바가 지도 아래쪽을 덮어 절대배치 범례가 가려졌다. 밖에 두면 어떤 제공자·컨트롤과도 안 겹친다.
// 실제로 그려진 모드만 보여 준다(routeStyle.legendEntries). 항목이 없으면 아무것도 그리지 않는다.
export default function RouteLegend({ entries = [], className = '' }) {
  if (!entries.length) return null;
  return (
    <div
      className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-semibold text-muted ${className}`}
      role="img"
      aria-label={`경로 범례: ${entries.map((e) => e.label).join(', ')}`}
    >
      {entries.map((e) => (
        <span key={e.mode} className="inline-flex items-center gap-1.5" aria-hidden="true">
          <svg width="24" height="6" viewBox="0 0 24 6">
            <line x1="1" y1="3" x2="23" y2="3" stroke={e.color} strokeWidth="3" strokeLinecap="round" strokeDasharray={e.dash === 'short' ? '3 4' : e.dash === 'long' ? '8 4' : undefined} />
          </svg>
          {e.label}
        </span>
      ))}
    </div>
  );
}

// 지도 경로 범례 — 도보(초록 짧은 점선)·대중교통(파랑 실선)·차량(주황 긴 점선). 두 지도 제공자가 같이 쓴다.
// 실제로 그려진 모드만 보여 준다(routeStyle.legendEntries).
// 위치는 왼쪽 아래인데 구글 로고(왼쪽 아래 약 26px, 가리면 약관 위반 — agy 검토) 위로 띄운다.
export default function RouteLegend({ entries = [] }) {
  if (!entries.length) return null;
  return (
    <div
      className="pointer-events-none absolute bottom-9 left-2 z-[400] flex items-center gap-2 rounded-full border border-hairline bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-ink shadow-sm"
      role="img"
      aria-label={`경로 범례: ${entries.map((e) => e.label).join(', ')}`}
    >
      {entries.map((e) => (
        <span key={e.mode} className="inline-flex items-center gap-1" aria-hidden="true">
          <svg width="22" height="6" viewBox="0 0 22 6">
            <line x1="1" y1="3" x2="21" y2="3" stroke={e.color} strokeWidth="3" strokeLinecap="round" strokeDasharray={e.dash === 'short' ? '3 4' : e.dash === 'long' ? '8 4' : undefined} />
          </svg>
          {e.label}
        </span>
      ))}
    </div>
  );
}

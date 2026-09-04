import { Archive } from 'lucide-react';
import { formatDateWithWeekday } from '../../lib/format';

// 일정판 날짜 탭. N일차 + 보관함.
//
// role="tab" 대신 눌리는 버튼 목록 + aria-current 로 만든다 — 진짜 탭 위젯은 좌우 방향키
// 이동까지 구현해야 규격에 맞는데, 여기서는 가로 스크롤 목록이 더 정확한 표현이다.
export const UNASSIGNED_ID = 'unassigned';

function Tab({ active, count, primary, secondary, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={[
        'flex shrink-0 flex-col items-start gap-0.5 rounded-sm px-3 py-2 text-left transition-colors',
        active ? 'bg-primary text-on-primary' : 'bg-surface-soft text-body hover:bg-surface-strong',
      ].join(' ')}
    >
      <span className="flex items-center gap-1 text-sm font-semibold">
        {Icon && <Icon size={14} aria-hidden="true" />}
        {primary}
        <span className={active ? 'text-on-primary/80' : 'text-muted'}>{count}</span>
      </span>
      {secondary && (
        <span className={`text-xs ${active ? 'text-on-primary/80' : 'text-muted'}`}>{secondary}</span>
      )}
    </button>
  );
}

export default function DayTabs({ days = [], counts, unassignedCount = 0, activeId, onSelect }) {
  return (
    <div className="-mx-4 mb-4 overflow-x-auto px-4">
      <div className="flex gap-2 pb-1">
        {days.map((day) => (
          <Tab
            key={day.id}
            active={activeId === day.id}
            primary={`${day.day_index + 1}일차`}
            secondary={formatDateWithWeekday(day.date)}
            count={counts?.get(day.id) || 0}
            onClick={() => onSelect(day.id)}
          />
        ))}
        <Tab
          active={activeId === UNASSIGNED_ID}
          primary="보관함"
          icon={Archive}
          count={unassignedCount}
          onClick={() => onSelect(UNASSIGNED_ID)}
        />
      </div>
    </div>
  );
}

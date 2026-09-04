import { CalendarRange, Route, Wallet } from 'lucide-react';
import Badge from '../../kit/Badge';
import Button from '../../kit/Button';
import { formatDateRange, formatMoney, formatTripLength } from '../../lib/format';
import { formatDuration } from '../../lib/travelTime';

// 일정판 헤더. 제목·기간·예산 합·이동시간 합·가정값 칩·게시 상태를 한자리에 둔다(설계 §1.1).
//
// 가정값 칩은 항상 보인다. OVER_DAY 경고가 영업시간과 무관하게 뜨기 때문에, 무엇을 기준으로
// 판단했는지가 화면에 늘 적혀 있어야 한다(설계 §6).
export default function TripHeader({
  trip,
  budgetTotal = 0,
  travelSeconds = 0,
  dayWindow,
  sync,
  busy = false,
  onEditDates,
  onEditAssumptions,
  onRefreshPost,
}) {
  if (!trip) return null;

  return (
    <header className="mb-4">
      <h1 className="text-xl">{trip.title}</h1>

      <button
        type="button"
        onClick={onEditDates}
        className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <CalendarRange size={14} aria-hidden="true" />
        {formatDateRange(trip.start_date, trip.end_date)}
        <span aria-hidden="true">·</span>
        {formatTripLength(trip.start_date, trip.end_date)}
      </button>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {budgetTotal > 0 && (
          <Badge tone="outline">
            <Wallet size={11} aria-hidden="true" />
            예상 비용 {formatMoney(budgetTotal, trip.currency)}
          </Badge>
        )}
        {travelSeconds > 0 && (
          <Badge tone="outline">
            <Route size={11} aria-hidden="true" />
            이동 예상 {formatDuration(travelSeconds)}
          </Badge>
        )}
        <button type="button" onClick={onEditAssumptions}>
          <Badge tone="neutral">
            하루 {dayWindow.DAY_START}–{dayWindow.DAY_END} 기준 · 공휴일 미반영
          </Badge>
        </button>
        {sync?.published && <Badge tone="outline">게시됨</Badge>}
      </div>

      {sync?.stale && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-hairline px-3 py-2.5">
          <p className="text-sm text-warning">고친 내용이 게시글에 아직 반영되지 않았습니다.</p>
          <Button variant="secondary" size="sm" loading={busy} onClick={onRefreshPost}>
            게시글 갱신
          </Button>
        </div>
      )}
    </header>
  );
}

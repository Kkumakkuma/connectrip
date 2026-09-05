import { useMemo } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { ChevronDown, ChevronUp, Clock, GripVertical, MoveRight, TriangleAlert } from 'lucide-react';
import Badge from '../../kit/Badge';
import { formatMoney } from '../../lib/format';
import { formatClock } from '../../lib/feasibility';
import {
  TRAVEL_ASSUMPTIONS,
  estimateLegs,
  formatDistance,
  formatDuration,
} from '../../lib/travelTime';
import { warningLabel } from './warningText';

// 핀 목록. 드래그 정렬(framer-motion Reorder)과 키보드용 위/아래 버튼을 함께 제공한다 —
// 드래그만 두면 키보드·보조기술 사용자가 순서를 못 바꾼다(설계 §8, codex-26 D5).
//
// 화면에 보이는 순서는 이 컴포넌트가 들고 있다가 드래그가 끝나는 순간 한 번만 서버에 올린다.
// 이동시간 칩도 화면 순서로 다시 계산해, 끌고 있는 동안 값이 어긋나 보이지 않게 한다.

function timeText(value) {
  if (typeof value !== 'string') return '';
  return value.slice(0, 5);
}

function PlaceRow({
  place,
  index,
  total,
  incomingLeg,
  arrivalMin,
  warnings,
  currency,
  onOpen,
  onMove,
  onCommit,
  onOpenWarning,
}) {
  const controls = useDragControls();
  const planned = timeText(place.planned_time);

  return (
    <Reorder.Item
      as="li"
      value={place.id}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onCommit}
      className="list-none"
    >
      {index > 0 && (
        <div className="flex items-center gap-1.5 py-1.5 pl-4 text-xs text-muted">
          <MoveRight size={12} aria-hidden="true" />
          <span className="sr-only">앞 장소에서 이동: </span>
          {incomingLeg ? (
            <span>
              {/* 서버가 실제 경로(google/cache)로 준 값은 "예상"을 떼고, 추정치만 "예상"으로 표시한다. */}
              {TRAVEL_ASSUMPTIONS[incomingLeg.mode]?.label || '이동'}
              {!incomingLeg.source || incomingLeg.source === 'estimate' ? ' 예상' : ''}{' '}
              {formatDuration(incomingLeg.duration_s)} · 약 {formatDistance(incomingLeg.distance_m)}
            </span>
          ) : (
            <span>위치 정보가 없어 이동시간을 계산할 수 없습니다.</span>
          )}
        </div>
      )}

      <div className="rounded-md border border-hairline bg-canvas">
        <div className="flex items-start gap-2 p-3">
          <button
            type="button"
            aria-label={`${place.name} 순서 바꾸기`}
            onPointerDown={(event) => controls.start(event)}
            className="mt-0.5 shrink-0 cursor-grab touch-none rounded-sm p-1 text-muted-soft transition-colors hover:bg-surface-soft hover:text-muted active:cursor-grabbing"
          >
            <GripVertical size={16} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => onOpen(place.id)}
            className="min-w-0 flex-1 text-left"
          >
            <span className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-on-primary">
                {index + 1}
              </span>
              <span className="min-w-0 truncate text-sm font-medium text-ink">{place.name}</span>
            </span>

            {place.address && (
              <span className="mt-1 block pl-8 text-xs text-muted">{place.address}</span>
            )}

            <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-8 text-xs text-muted">
              {planned ? (
                <span className="inline-flex items-center gap-1 font-medium text-body">
                  <Clock size={12} aria-hidden="true" />
                  {planned}
                </span>
              ) : (
                arrivalMin !== null && (
                  <span className="inline-flex items-center gap-1">
                    <Clock size={12} aria-hidden="true" />
                    {formatClock(arrivalMin)} 도착 예상
                  </span>
                )
              )}
              {Number.isFinite(place.stay_min) && place.stay_min > 0 && (
                <span>{place.stay_min}분 머무름</span>
              )}
              {Number.isFinite(place.cost) && place.cost > 0 && (
                <span>{formatMoney(place.cost, currency)}</span>
              )}
              {place.visited_at && <span className="text-success">다녀옴</span>}
            </span>
          </button>

          <div className="flex shrink-0 flex-col">
            <button
              type="button"
              aria-label={`${place.name} 위로 옮기기`}
              disabled={index === 0}
              onClick={() => onMove(index, -1)}
              className="rounded-sm p-1 text-muted transition-colors hover:bg-surface-soft hover:text-ink disabled:cursor-not-allowed disabled:text-muted-soft/50"
            >
              <ChevronUp size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`${place.name} 아래로 옮기기`}
              disabled={index === total - 1}
              onClick={() => onMove(index, 1)}
              className="rounded-sm p-1 text-muted transition-colors hover:bg-surface-soft hover:text-ink disabled:cursor-not-allowed disabled:text-muted-soft/50"
            >
              <ChevronDown size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* 경고 배지는 행 버튼 바깥에 둔다 — 버튼 안에 버튼을 넣으면 잘못된 마크업이라
            브라우저마다 클릭·포커스가 다르게 동작한다. */}
        {warnings.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 pb-3 pl-[3.25rem]">
            {warnings.map((w) => (
              <button
                key={`${w.code}-${w.reason || ''}`}
                type="button"
                onClick={() => onOpenWarning(w)}
              >
                <Badge tone="warning">
                  <TriangleAlert size={11} aria-hidden="true" />
                  {warningLabel(w)}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </div>
    </Reorder.Item>
  );
}

// 순서는 부모(TripBoard)가 들고 있는다. 여기서 사본을 두면 목록이 갱신될 때마다 되돌리는
// 효과가 필요해지고, 그게 곧 effect 안 setState 다. Reorder 의 values 로는 핀 객체가 아니라
// id 문자열을 넘긴다 — 객체는 갱신마다 참조가 바뀌어 드래그 도중 항목이 뒤엉킨다.
export default function PlaceList({
  places = [],
  legs: legsProp = null,
  timeline = [],
  warningsByPlaceId,
  currency = 'KRW',
  onPreviewOrder,
  onCommitOrder,
  onOpenPlace,
  onOpenWarning,
}) {
  const ids = useMemo(() => places.map((p) => p.id), [places]);
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  // 구간 값은 보드가 준다(DB 에 저장된 구글/캐시 경로가 있으면 그것, 아니면 추정치). 9/6 운영 실측: 여기서 추정치를 따로
  // 다시 계산하는 바람에 서버가 구글 경로를 저장해도 "예상" 표기가 안 떨어졌다. 길이가 안 맞으면(핀 수 변화 중) 추정치.
  const legs = useMemo(
    () => (Array.isArray(legsProp) && legsProp.length === Math.max(0, places.length - 1) ? legsProp : estimateLegs(places)),
    [legsProp, places],
  );

  // 키보드·보조기술용 대안. 드래그와 같은 결과를 만든다(설계 §8).
  const move = (index, delta) => {
    const next = [...ids];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onPreviewOrder(next);
    onCommitOrder(next);
  };

  return (
    <Reorder.Group as="ul" axis="y" values={ids} onReorder={onPreviewOrder} className="space-y-1">
      {ids.map((id, index) => {
        const place = byId.get(id);
        if (!place) return null;
        return (
          <PlaceRow
            key={id}
            place={place}
            index={index}
            total={ids.length}
            incomingLeg={index > 0 ? legs[index - 1] : null}
            arrivalMin={timeline[index]?.arrival ?? null}
            warnings={warningsByPlaceId?.get(id) || []}
            currency={currency}
            onOpen={onOpenPlace}
            onMove={move}
            onCommit={() => onCommitOrder(ids)}
            onOpenWarning={onOpenWarning}
          />
        );
      })}
    </Reorder.Group>
  );
}

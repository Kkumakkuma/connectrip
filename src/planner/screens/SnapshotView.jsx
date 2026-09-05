import { Archive, Clock, MapPin, Wallet } from 'lucide-react';
import Badge from '../kit/Badge';
import Card from '../kit/Card';
import EmptyState from '../kit/EmptyState';
import { formatDate, formatDateRange, formatDateWithWeekday, formatMoney, formatTripLength } from '../lib/format';
import { formatDistance, formatDuration } from '../lib/travelTime';
import SourceAttribution from '../providers/SourceAttribution';

// 스냅샷(설계 §3) 하나를 읽기 전용으로 그린다.
// 공유 보기와 내보내기 미리보기가 같은 그림을 써야 해서 화면이 아니라 컴포넌트로 뺐다.
//
// 스냅샷은 서버 RPC 가 조립한 것만 들어온다. 그래도 필드는 전부 방어적으로 읽는다 —
// 스냅샷 버전이 올라가거나(v2) 오래된 게시글에서 온 값이면 모양이 다를 수 있다.

const MODE_LABEL = { WALK: '도보', DRIVE: '차량', TRANSIT: '대중교통' };

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// legs 는 핀 구성 지문(fp)을 갖고 있다. 지문이 현재 핀 구성과 어긋나면 저장된 이동시간을
// 그대로 보여 주면 안 된다(설계 §3 codex-10). 공유 스냅샷은 서버가 같은 시점에 만든 것이라
// 보통 일치하지만, 게시글처럼 과거에 굳은 스냅샷은 어긋날 수 있다.
function legsFor(day) {
  const legs = day?.legs;
  if (!legs || typeof legs !== 'object') return { items: [], stale: false };
  const items = asArray(legs.items);
  const places = asArray(day.places);
  // items 는 핀 사이 구간이라 핀 수보다 하나 적다. 개수가 안 맞으면 신뢰하지 않는다.
  const stale = items.length > 0 && items.length !== Math.max(places.length - 1, 0);
  return { items, stale };
}

function PlaceRow({ place, leg, legStale, currency }) {
  const cost = Number(place?.cost);
  const stay = Number(place?.stay_min);
  return (
    <li className="border-t border-hairline first:border-t-0">
      <div className="flex gap-3 py-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-muted"
        >
          {(Number(place?.order) || 0) + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{place?.name || '이름 없는 장소'}</p>
          {place?.address && <p className="mt-0.5 truncate text-xs text-muted">{place.address}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {place?.planned_time && (
              <span className="inline-flex items-center gap-1">
                <Clock size={12} aria-hidden="true" />
                {String(place.planned_time).slice(0, 5)}
              </span>
            )}
            {Number.isFinite(stay) && stay > 0 && <span>체류 {stay}분</span>}
            {Number.isFinite(cost) && cost > 0 && (
              <span className="inline-flex items-center gap-1">
                <Wallet size={12} aria-hidden="true" />
                {formatMoney(cost, currency)}
              </span>
            )}
          </div>
          {place?.note && <p className="mt-2 whitespace-pre-wrap text-xs text-ink">{place.note}</p>}
        </div>
      </div>
      {leg && (
        <p className="pb-3 pl-9 text-xs text-muted">
          {legStale
            ? '이동시간 재계산 필요'
            : `${MODE_LABEL[leg.mode] || '이동'} ${formatDuration(leg.duration_s)}${
                Number(leg.distance_m) > 0 ? ` · ${formatDistance(leg.distance_m)}` : ''
              }${leg.source === 'estimate' ? ' (예상)' : ''}`}
        </p>
      )}
    </li>
  );
}

function DayCard({ day, currency }) {
  const places = asArray(day?.places);
  const { items, stale } = legsFor(day);
  return (
    <Card className="p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {(Number(day?.index) || 0) + 1}일차
          {day?.date ? ` · ${formatDateWithWeekday(day.date)}` : ''}
        </h3>
        <span className="text-xs text-muted">{places.length}곳</span>
      </div>
      {places.length === 0 ? (
        <p className="py-3 text-xs text-muted">이 날에는 담긴 장소가 없습니다.</p>
      ) : (
        <ul>
          {places.map((place, i) => (
            <PlaceRow
              key={`${day?.index}-${place?.order ?? i}-${place?.name || i}`}
              place={place}
              currency={currency}
              leg={items.find((it) => Number(it?.from) === i)}
              legStale={stale}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function SnapshotView({ snapshot, headerExtra = null }) {
  const days = asArray(snapshot?.days);
  const unassigned = asArray(snapshot?.unassigned);
  // 출처 표기(구글 로고·ODbL). 지도가 없는 화면이라 구글 장소가 하나라도 있으면 로고가 정책상 필수다.
  const providers = [...days.flatMap((d) => asArray(d?.places)), ...unassigned].map((p) => p?.provider);
  const currency = snapshot?.currency || 'KRW';
  const summary = snapshot?.summary || {};
  const costTotal = Number(summary.cost_total);

  return (
    <section>
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {snapshot?.country && <Badge tone="outline">{snapshot.country}</Badge>}
          {snapshot?.author_name && <Badge tone="neutral">{snapshot.author_name}</Badge>}
        </div>
        <h1 className="mt-2 text-xl">{snapshot?.title || '여행 일정'}</h1>
        <p className="mt-1 text-sm text-muted">
          {formatDateRange(snapshot?.start_date, snapshot?.end_date)}
          {formatTripLength(snapshot?.start_date, snapshot?.end_date)
            ? ` · ${formatTripLength(snapshot.start_date, snapshot.end_date)}`
            : ''}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <MapPin size={12} aria-hidden="true" />
            장소 {Number(summary.places_count) || 0}곳
          </span>
          {Number.isFinite(costTotal) && costTotal > 0 && (
            <span className="inline-flex items-center gap-1">
              <Wallet size={12} aria-hidden="true" />
              예산 합 {formatMoney(costTotal, currency)}
            </span>
          )}
          {snapshot?.timezone && <span>기준 시간대 {snapshot.timezone}</span>}
        </div>
        {headerExtra}
      </header>

      {days.length === 0 ? (
        <Card>
          <EmptyState icon={MapPin} message="담긴 일정이 없습니다." />
        </Card>
      ) : (
        <div className="space-y-3">
          {days.map((day, i) => (
            <DayCard key={day?.date || `day-${i}`} day={day} currency={currency} />
          ))}
        </div>
      )}

      {unassigned.length > 0 && (
        <div className="mt-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Archive size={14} aria-hidden="true" />
            보관함
          </h2>
          <Card className="p-4">
            <ul>
              {unassigned.map((place, i) => (
                <PlaceRow key={`u-${place?.name || i}`} place={{ ...place, order: i }} currency={currency} />
              ))}
            </ul>
          </Card>
        </div>
      )}

      <SourceAttribution providers={providers} className="mt-4" />

      <p className="mt-6 text-xs text-muted">
        {snapshot?.start_date ? `${formatDate(snapshot.start_date)} 기준 일정입니다. ` : ''}
        장소 정보는 만든 사람이 담은 시점의 값이며, 영업시간·요금은 방문 전에 다시 확인해 주세요.
      </p>
    </section>
  );
}

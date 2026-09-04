import { useState } from 'react';
import {
  Compass,
  Copy,
  Download,
  Link2,
  Megaphone,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import Button from '../../kit/Button';
import Input from '../../kit/Input';
import Sheet from '../../kit/Sheet';
import { FEASIBILITY_DEFAULTS, parseClock } from '../../lib/feasibility';
import { daysBetween } from '../../lib/format';
import { warningBasis, warningSentence } from './warningText';

// 일정판에서 쓰는 작은 바텀시트 모음. 각각 한 가지 일만 한다.

const MAX_SPAN_DAYS = 60;

// ---------------------------------------------------------------------------
// 장소 직접 추가 — 지도를 길게 눌러 열거나, 지도가 없을 때 버튼으로 연다.
// ---------------------------------------------------------------------------
// ⚠ 이 시트들은 부모가 열릴 때만 렌더한다(TripBoard 의 `{sheet === 'add' && …}`).
//    닫혔다 열릴 때마다 새로 마운트되므로 초기값을 useState 에서 한 번 잡으면 되고,
//    prop 이 바뀔 때 effect 안에서 setState 로 폼을 되돌리는 패턴을 쓰지 않는다.
export function AddPlaceSheet({ open, initial, targetLabel, saving, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState(() =>
    Number.isFinite(initial?.lat) ? initial.lat.toFixed(6) : ''
  );
  const [lng, setLng] = useState(() =>
    Number.isFinite(initial?.lng) ? initial.lng.toFixed(6) : ''
  );
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (trimmed.length < 1) {
      setError('장소 이름을 넣어 주세요.');
      return;
    }
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      setError('위도는 -90에서 90 사이 숫자입니다.');
      return;
    }
    if (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      setError('경도는 -180에서 180 사이 숫자입니다.');
      return;
    }
    onSubmit({
      name: trimmed.slice(0, 200),
      address: address.trim() ? address.trim().slice(0, 300) : null,
      lat: latNum,
      lng: lngNum,
    });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="장소 추가"
      footer={(
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button variant="primary" className="flex-1" onClick={handleSubmit} loading={saving}>
            담기
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        {targetLabel && <p className="text-sm text-muted">{targetLabel}에 담습니다.</p>}
        <Input
          label="이름"
          value={name}
          maxLength={200}
          placeholder="예: 센소지"
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="주소 (선택)"
          value={address}
          maxLength={300}
          onChange={(e) => setAddress(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="위도"
            inputMode="decimal"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
          />
          <Input
            label="경도"
            inputMode="decimal"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted">
          지도를 길게 누르면 그 지점의 좌표가 채워집니다. 좌표를 직접 고쳐도 됩니다.
        </p>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// 기간 변경 — 줄어드는 날짜에 핀이 남아 있으면 api.setDates 가 한 번 되묻는다.
// ---------------------------------------------------------------------------
export function DatesSheet({ open, startDate, endDate, saving, onClose, onSubmit }) {
  const [start, setStart] = useState(startDate || '');
  const [end, setEnd] = useState(endDate || '');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const span = daysBetween(start, end);
    if (span === null) {
      setError('시작일과 종료일을 모두 골라 주세요.');
      return;
    }
    if (span < 0) {
      setError('종료일이 시작일보다 빠릅니다.');
      return;
    }
    if (span > MAX_SPAN_DAYS) {
      setError(`기간은 최대 ${MAX_SPAN_DAYS + 1}일까지 만들 수 있습니다.`);
      return;
    }
    onSubmit(start, end);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="여행 기간"
      footer={(
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button variant="primary" className="flex-1" onClick={handleSubmit} loading={saving}>
            저장
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="시작일" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <Input
            label="종료일"
            type="date"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted">
          기간을 줄이면 사라지는 날짜에 담아 둔 장소는 보관함으로 옮겨집니다.
        </p>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// 하루 활동 시간 가정값 — 동선 검사에만 쓰이고 이 기기에만 저장된다.
// ---------------------------------------------------------------------------
export function AssumptionsSheet({ open, value, onClose, onSubmit }) {
  const [dayStart, setDayStart] = useState(value?.DAY_START || FEASIBILITY_DEFAULTS.DAY_START);
  const [dayEnd, setDayEnd] = useState(value?.DAY_END || FEASIBILITY_DEFAULTS.DAY_END);
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const s = parseClock(dayStart);
    const e = parseClock(dayEnd);
    if (s === null || e === null || e <= s) {
      setError('끝나는 시각이 시작 시각보다 늦어야 합니다.');
      return;
    }
    onSubmit({ DAY_START: dayStart, DAY_END: dayEnd });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="하루 기준 시간"
      footer={(
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => {
              setDayStart(FEASIBILITY_DEFAULTS.DAY_START);
              setDayEnd(FEASIBILITY_DEFAULTS.DAY_END);
              setError('');
            }}
          >
            기본값으로
          </Button>
          <Button variant="primary" className="flex-1" onClick={handleSubmit}>
            저장
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          하루 일정이 이 시간을 넘기는지 판단할 때 쓰는 기준입니다. 공휴일과 임시 휴업은 반영하지
          않습니다.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="하루 시작"
            type="time"
            value={dayStart}
            onChange={(e) => setDayStart(e.target.value)}
          />
          <Input
            label="하루 종료"
            type="time"
            value={dayEnd}
            onChange={(e) => setDayEnd(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted">이 값은 지금 쓰는 기기에만 저장됩니다.</p>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// 경고 근거 — 무엇을 보고 그렇게 판단했는지 그대로 보여준다.
// ---------------------------------------------------------------------------
export function WarningSheet({ open, warning, placeName, onClose }) {
  if (!warning) return null;
  const basis = warningBasis(warning);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="이렇게 판단했습니다"
      footer={(
        <Button variant="secondary" className="w-full" onClick={onClose}>
          닫기
        </Button>
      )}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <div>
            {placeName && <p className="text-sm font-medium text-ink">{placeName}</p>}
            <p className="text-sm text-body">{warningSentence(warning)}</p>
          </div>
        </div>
        <dl className="divide-y divide-hairline-soft rounded-sm border border-hairline">
          {basis.map((row) => (
            <div key={row.term} className="flex gap-3 px-3 py-2 text-sm">
              <dt className="w-28 shrink-0 text-muted">{row.term}</dt>
              <dd className="min-w-0 flex-1 text-body">{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted">
          추정한 값이라 실제와 다를 수 있습니다. 영업시간은 저장해 둔 정보를 기준으로 봅니다.
        </p>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// 더보기 — 공유·게시판·내보내기
// ---------------------------------------------------------------------------
function MenuRow({ icon: Icon, label, description, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-start gap-3 rounded-sm px-3 py-3 text-left transition-colors hover:bg-surface-soft disabled:cursor-not-allowed disabled:text-muted-soft"
    >
      {Icon && <Icon size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />}
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
    </button>
  );
}

export function MoreSheet({
  open,
  busy,
  published,
  stale,
  shareUrl,
  destName,
  onClose,
  onShare,
  onCopyShare,
  onPublish,
  onUnpublish,
  onExport,
  onChooseDest,
}) {
  return (
    <Sheet open={open} onClose={onClose} title="더보기">
      <div className="-mx-2">
        {/* 일정판이 비어 있을 때만이 아니라 여기서도 목적지를 바꿀 수 있어야 한다 —
            도시를 잘못 골랐는데 장소를 이미 담았으면 고칠 길이 없어진다. */}
        <MenuRow
          icon={Compass}
          label={destName ? `목적지 · ${destName}` : '목적지 정하기'}
          description={
            destName
              ? '바꾸면 추천 장소도 그 도시 것으로 바뀝니다.'
              : '정하면 그 도시의 대표 명소를 바로 담을 수 있습니다.'
          }
          disabled={busy}
          onClick={onChooseDest}
        />

        <MenuRow
          icon={Link2}
          label={shareUrl ? '공유 링크 새로 만들기' : '공유 링크 만들기'}
          description="링크를 아는 사람만 볼 수 있습니다. 티켓과 비공개 메모는 빠집니다."
          disabled={busy}
          onClick={onShare}
        />
        {shareUrl && (
          <div className="mx-2 mb-2 rounded-sm border border-hairline p-3">
            <p className="mb-2 break-all text-xs text-body">{shareUrl}</p>
            <Button variant="secondary" size="sm" onClick={() => onCopyShare(shareUrl)}>
              <Copy size={14} aria-hidden="true" />
              링크 복사
            </Button>
            <p className="mt-2 text-xs text-muted">
              새로 만들면 이전 링크는 그 자리에서 쓸 수 없게 됩니다.
            </p>
          </div>
        )}

        <MenuRow
          icon={published ? RefreshCw : Megaphone}
          label={published ? '게시글 갱신' : '게시판에 올리기'}
          description={
            published
              ? stale
                ? '고친 내용을 게시글에 반영합니다.'
                : '게시글이 최신 상태입니다.'
              : '여행 일정 게시판에 올립니다.'
          }
          disabled={busy}
          onClick={onPublish}
        />
        {published && (
          <MenuRow
            icon={Megaphone}
            label="게시 내리기"
            description="게시판에서 글을 내립니다. 일정은 그대로 남습니다."
            disabled={busy}
            onClick={onUnpublish}
          />
        )}

        <MenuRow
          icon={Download}
          label="내보내기"
          description="파일로 저장하거나 인쇄합니다."
          disabled={busy}
          onClick={onExport}
        />
      </div>
    </Sheet>
  );
}

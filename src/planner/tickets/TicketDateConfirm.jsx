import { useState } from 'react';
import Button from '../kit/Button';
import Input from '../kit/Input';
import Select from '../kit/Select';
import Sheet from '../kit/Sheet';
import { formatDateWithWeekday } from '../lib/format';
import { timeZoneGapText, zonedTimeToUtc } from '../lib/timezone';

// 업로드 직후 반드시 한 번 거치는 확인 시트 (설계 §5.1).
//
// 판독이 성공했든 실패했든 사람이 확인한다. 자동 확정은 하지 않는다 —
// 왕복 항공권·호텔 확인서처럼 기간 안에 날짜가 둘 있는 티켓에서 기계가 고른 값은
// 자주 틀리고, 틀린 날짜는 알림을 통째로 어긋나게 만든다.
//
// 시각은 "티켓에 적힌 현지 시각" 그대로 받는다. 화면 어디서도 변환하지 않는다.
// 알림용 절대 시각(event_at)은 저장할 때 여행 타임존으로 계산한다.

const KINDS = [
  { value: '', label: '분류 없음' },
  { value: 'flight', label: '항공권' },
  { value: 'train', label: '기차' },
  { value: 'bus', label: '버스' },
  { value: 'ticket', label: '입장권·공연' },
  { value: 'hotel', label: '숙소' },
  { value: 'other', label: '기타' },
];

export default function TicketDateConfirm({
  open,
  detection,          // { candidates, best, ambiguous } — pickTicketDate 결과
  bcbp,               // parseBcbp 결과 또는 null
  tripZone,           // 여행지 IANA 타임존 (없으면 null)
  viewerZone,         // 보는 사람의 타임존
  saving,
  onClose,
  onSubmit,
}) {
  const candidates = detection?.candidates || [];
  const [date, setDate] = useState(() => (detection?.ambiguous ? '' : detection?.best?.date || ''));
  const [time, setTime] = useState('');
  const [title, setTitle] = useState(() => (bcbp?.flight ? `${bcbp.flight} ${bcbp.from}→${bcbp.to}` : ''));
  const [kind, setKind] = useState(() => (bcbp ? 'flight' : ''));
  const [error, setError] = useState('');

  const eventAt = date && tripZone ? zonedTimeToUtc(date, time || '00:00', tripZone) : null;
  const gap = eventAt ? timeZoneGapText(eventAt, tripZone, viewerZone) : '';

  const submit = () => {
    if (!date) {
      setError('날짜를 골라 주세요.');
      return;
    }
    onSubmit({
      title: title.trim() || null,
      kind: kind || null,
      event_date: date,
      event_time: time || null,
      // 타임존을 모르면 절대 시각을 만들지 않는다. 틀린 알림보다 알림 없음이 낫다.
      event_at: eventAt ? eventAt.toISOString() : null,
    });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="이 날짜가 맞나요?"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            나중에
          </Button>
          <Button variant="primary" onClick={submit} loading={saving} className="flex-1">
            저장
          </Button>
        </div>
      }
    >
      {bcbp && (
        <p className="mb-3 rounded-sm bg-surface-soft px-3 py-2 text-xs text-body">
          탑승권에서 읽었습니다. {bcbp.flight} · {bcbp.from} → {bcbp.to}
        </p>
      )}

      {candidates.length > 0 ? (
        <fieldset className="mb-4">
          <legend className="mb-2 text-sm font-semibold text-ink">티켓에서 찾은 날짜</legend>
          <div className="space-y-2">
            {candidates.slice(0, 4).map((c) => (
              <label
                key={c.date}
                className="flex cursor-pointer items-start gap-2 rounded-sm border border-hairline p-2.5"
              >
                <input
                  type="radio"
                  name="ticket-date"
                  className="mt-1"
                  checked={date === c.date}
                  onChange={() => setDate(c.date)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{formatDateWithWeekday(c.date)}</span>
                  {/* 왜 이 날짜인지 근거를 원문 그대로 보여 준다 — 사람이 판단할 재료다. */}
                  {c.evidence && <span className="mt-0.5 block truncate text-xs text-muted">…{c.evidence}…</span>}
                </span>
              </label>
            ))}
          </div>
          {detection?.ambiguous && (
            <p className="mt-2 text-xs text-warning">
              날짜 표기가 뒤집힐 수 있어 자동으로 고르지 않았습니다. 티켓을 보고 골라 주세요.
            </p>
          )}
        </fieldset>
      ) : (
        <p className="mb-4 text-sm text-muted">티켓에서 날짜를 찾지 못했습니다. 직접 넣어 주세요.</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Input
          label="날짜"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Input
          label="시각 (선택)"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </div>

      <Input
        label="이름 (선택)"
        className="mt-3"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="예: 신칸센 노조미 21호"
      />

      <Select
        label="분류 (선택)"
        className="mt-3"
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        options={KINDS}
      />

      <p className="mt-3 text-xs text-muted">
        적힌 그대로 넣어 주세요. 현지 시각으로 저장하고, 알림은 시차를 계산해서 보냅니다.
        {tripZone ? '' : ' 담은 장소가 없어 현지 시간대를 몰라 알림 계산은 하지 않습니다.'}
      </p>
      {gap && <p className="mt-1 text-xs text-muted">{gap}</p>}
      {error && <p className="mt-2 text-xs text-warning">{error}</p>}
    </Sheet>
  );
}

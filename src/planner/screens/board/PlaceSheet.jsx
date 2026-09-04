import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import Button from '../../kit/Button';
import Input from '../../kit/Input';
import Select from '../../kit/Select';
import Sheet from '../../kit/Sheet';
import Switch from '../../kit/Switch';
import Textarea from '../../kit/Textarea';
import { UNASSIGNED_ID } from './DayTabs';

// 핀 상세. 설계 §1.1 대로 페이지가 아니라 바텀시트로 연다.
// 후기(평점·추천 메뉴)는 장소 카탈로그에 연결된 핀에서만 쓸 수 있어 이번 범위에 넣지 않았다
// — 카탈로그 행은 장소 검색·링크로 담기에서 생기고, 그 두 경로가 아직 서버리스 함수를 기다린다.

const MAX_NOTE = 2000;
const MAX_STAY = 1440;

function timeValue(value) {
  return typeof value === 'string' ? value.slice(0, 5) : '';
}

function numberValue(value) {
  return Number.isFinite(value) ? String(value) : '';
}

export default function PlaceSheet({
  open,
  place,
  days = [],
  currency = 'KRW',
  saving = false,
  onClose,
  onSave,
  onDelete,
}) {
  // 폼 초기값은 마운트할 때 한 번만 잡는다.
  // 부모(TripBoard)가 `{sheet === 'place' && selectedPlace && <PlaceSheet …/>}` 로 열 때만
  // 렌더하므로 다른 핀을 열면 새로 마운트되고, 저장 뒤 목록이 갱신돼도 입력값이 되돌아가지 않는다.
  const [name, setName] = useState(place?.name || '');
  const [plannedTime, setPlannedTime] = useState(timeValue(place?.planned_time));
  const [stayMin, setStayMin] = useState(numberValue(place?.stay_min));
  const [cost, setCost] = useState(numberValue(place?.cost));
  const [note, setNote] = useState(place?.note || '');
  const [notePublic, setNotePublic] = useState(Boolean(place?.note_public));
  const [visited, setVisited] = useState(Boolean(place?.visited_at));
  const [dayId, setDayId] = useState(place?.day_id || UNASSIGNED_ID);
  const [error, setError] = useState('');

  if (!place) return null;

  const dayOptions = [
    { value: UNASSIGNED_ID, label: '보관함' },
    ...days.map((d) => ({ value: d.id, label: `${d.day_index + 1}일차` })),
  ];

  const handleSave = () => {
    const trimmed = name.trim();
    if (trimmed.length < 1) {
      setError('장소 이름을 넣어 주세요.');
      return;
    }
    if (trimmed.length > 200) {
      setError('장소 이름은 200자까지 넣을 수 있습니다.');
      return;
    }
    const stay = stayMin === '' ? null : Number(stayMin);
    if (stay !== null && (!Number.isFinite(stay) || stay < 0 || stay > MAX_STAY)) {
      setError(`머무는 시간은 0분에서 ${MAX_STAY}분 사이로 넣어 주세요.`);
      return;
    }
    const money = cost === '' ? null : Number(cost);
    if (money !== null && (!Number.isFinite(money) || money < 0)) {
      setError('예상 비용은 0 이상으로 넣어 주세요.');
      return;
    }

    onSave({
      patch: {
        name: trimmed,
        planned_time: plannedTime || null,
        stay_min: stay,
        cost: money === null ? null : Math.round(money),
        note: note.trim() ? note.trim().slice(0, MAX_NOTE) : null,
        note_public: notePublic,
        visited_at: visited ? place.visited_at || new Date().toISOString() : null,
      },
      dayId: dayId === UNASSIGNED_ID ? null : dayId,
    });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="장소 정보"
      footer={(
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>
            닫기
          </Button>
          <Button variant="primary" className="flex-1" onClick={handleSave} loading={saving}>
            저장
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <Input label="이름" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />

        {place.address && (
          <div>
            <p className="mb-1 text-sm font-medium text-ink">주소</p>
            <p className="text-sm text-muted">{place.address}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="도착 시각"
            type="time"
            value={plannedTime}
            onChange={(e) => setPlannedTime(e.target.value)}
          />
          <Input
            label="머무는 시간(분)"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_STAY}
            value={stayMin}
            onChange={(e) => setStayMin(e.target.value)}
          />
        </div>

        <Input
          label={`예상 비용 (${currency})`}
          type="number"
          inputMode="numeric"
          min={0}
          value={cost}
          onChange={(e) => setCost(e.target.value)}
        />

        <Select
          label="날짜"
          value={dayId}
          options={dayOptions}
          onChange={(e) => setDayId(e.target.value)}
        />

        <Textarea
          label="메모"
          rows={3}
          value={note}
          maxLength={MAX_NOTE}
          placeholder="예: 예약 번호, 가는 길"
          onChange={(e) => setNote(e.target.value)}
        />

        <Switch
          label="공유할 때 메모 포함"
          description="끄면 공유 링크와 게시글에서 이 메모가 빠집니다."
          checked={notePublic}
          onChange={setNotePublic}
        />

        <Switch label="방문 완료" checked={visited} onChange={setVisited} />

        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}

        <div className="border-t border-hairline pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-error hover:bg-error/10"
            disabled={saving}
            onClick={() => {
              if (window.confirm(`'${place.name}'을(를) 목록에서 지울까요?`)) onDelete();
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
            이 장소 지우기
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

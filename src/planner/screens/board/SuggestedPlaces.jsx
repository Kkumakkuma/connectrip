import { useEffect, useState } from 'react';
import { Check, Compass, MapPin, Plus } from 'lucide-react';
import Button from '../../kit/Button';
import Card from '../../kit/Card';
import { loadAttractions } from '../../lib/destinations';
import { josa } from '../../../lib/korean';

// 빈 일정판에 그 도시의 대표 명소를 깔아 준다.
//
// 처음 온 사람은 "센소지"라는 이름 자체를 모른다. 검색창만 주면 뭘 칠지 몰라서 멈춘다.
// 눌러서 담기만 하면 되게 하면 타이핑 없이 첫 일정이 생긴다.
// (Apple HIG · Google Material · IBM Carbon · NN/g 가 공통으로 요구하는 "빈 화면에 다음 행동
//  경로를 주라"에 해당한다. Material·Carbon 은 미리 채워 주는 방식도 대안으로 권하되
//  '사용자가 지울 수 있어야 한다'는 조건을 다는데, 여기서는 자동으로 꽂지 않고 눌러야 들어간다.)
//
// 데이터는 미리 만들어 둔 파일이다(scripts/build_planner_data.py). 이 화면은 네트워크
// 응답을 기다리지 않는다 — 실시간 조회는 도쿄 10.2초가 나와서 버렸다(2026-09-04 실측).

export default function SuggestedPlaces({
  destId,
  destName,
  addedKeys,      // 이미 담은 provider_place_id 집합
  saving,
  onPick,
  onChooseDest,
}) {
  // 읽어 온 목적지를 값과 함께 들고 있는다. 효과 안에서 곧바로 setState 하면 렌더가 연쇄되고
  // (react-hooks/set-state-in-effect), 목적지를 바꾼 직후 옛 도시의 명소가 잠깐 보인다.
  // 어느 목적지의 결과인지 함께 저장해 두고 화면에서는 파생값으로 판단한다.
  const [loaded, setLoaded] = useState({ id: null, rows: [] });
  const [busyKey, setBusyKey] = useState('');
  const rows = loaded.id === destId ? loaded.rows : null; // null = 아직 안 읽음

  useEffect(() => {
    if (!destId) return undefined;
    let alive = true;
    loadAttractions(destId).then((list) => {
      if (alive) setLoaded({ id: destId, rows: list });
    });
    return () => {
      alive = false;
    };
  }, [destId]);

  // 목적지가 없으면 정하라고 권한다. 담아 둔 장소 좌표로 도시를 추측하지 않는다 —
  // 인천공항을 먼저 담아 둔 해외여행에 영종도 명소가 뜨는 사고가 난다(교차검토 지적).
  if (!destId) {
    return (
      <Card className="p-5 text-center">
        <Compass size={22} className="mx-auto mb-2 text-muted" aria-hidden="true" />
        <p className="text-sm text-body">어디로 가는지 정하면 대표 명소를 바로 담을 수 있습니다.</p>
        <div className="mt-3">
          <Button variant="primary" size="sm" onClick={onChooseDest}>
            목적지 정하기
          </Button>
        </div>
      </Card>
    );
  }

  if (rows === null) {
    return (
      <Card className="p-5">
        <p className="text-center text-sm text-muted">추천 장소를 불러오는 중입니다.</p>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="p-5 text-center">
        <MapPin size={22} className="mx-auto mb-2 text-muted" aria-hidden="true" />
        {/* 추천 목록은 나라별 주요 도시에만 둔다(2026-09-04 쿠마님 방침).
            "준비 중"이라고 하면 곧 생길 것처럼 읽히므로 그렇게 쓰지 않는다. */}
        <p className="break-keep text-sm text-body">
          {destName ? `${destName}${josa(destName, '은', '는')} ` : '이 도시는 '}추천 목록이 없습니다.
        </p>
        <p className="mt-1 break-keep text-xs text-muted">
          아래 장소 검색이나 링크로 담기로 직접 담아 주세요.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">
          {destName ? `${destName}에서 많이 가는 곳` : '많이 가는 곳'}
        </h2>
        <button
          type="button"
          onClick={onChooseDest}
          className="shrink-0 text-xs text-muted underline transition-colors hover:text-ink"
        >
          목적지 바꾸기
        </button>
      </div>

      <ul className="grid grid-cols-2 gap-2">
        {rows.map((item) => {
          const key = item.provider_place_id;
          const added = addedKeys?.has(key);
          return (
            <li key={key}>
              <button
                type="button"
                disabled={saving || added}
                onClick={() => {
                  setBusyKey(key);
                  onPick(item);
                }}
                className={[
                  'flex h-full w-full items-start gap-2 rounded-sm border p-3 text-left transition-colors',
                  added
                    ? 'border-hairline bg-surface-soft'
                    : 'border-hairline hover:border-ink disabled:opacity-50',
                ].join(' ')}
              >
                <span
                  className={[
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                    added ? 'bg-ink text-canvas' : 'border border-hairline text-muted',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  {added ? <Check size={12} /> : <Plus size={12} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-keep text-sm font-medium leading-snug text-ink">
                    {item.name}
                  </span>
                  {item._en && item._en !== item.name && (
                    <span className="mt-0.5 block truncate text-xs text-muted">{item._en}</span>
                  )}
                  {added && <span className="mt-1 block text-xs text-muted">담김</span>}
                  {!added && busyKey === key && saving && (
                    <span className="mt-1 block text-xs text-muted">담는 중…</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs text-muted">
        장소 정보 © OpenStreetMap 기여자 · 이름 © Wikidata
      </p>
    </Card>
  );
}

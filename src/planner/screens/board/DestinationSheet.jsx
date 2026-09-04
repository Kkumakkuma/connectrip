import { useEffect, useMemo, useState } from 'react';
import { MapPin, Search } from 'lucide-react';
import EmptyState from '../../kit/EmptyState';
import Sheet from '../../kit/Sheet';
import { loadDestinations, searchDestinations } from '../../lib/destinations';

// 여행을 만든 뒤에 목적지를 정하거나 바꾸는 시트.
//
// 목적지를 처음에 건너뛴 여행, 게시판에서 가져왔는데 원본에 목적지가 없던 여행,
// 도시를 잘못 고른 여행 — 셋 다 여기서 고친다. 이게 없으면 한번 비어 있는 여행은
// 영원히 추천을 못 받는다(교차검토 지적).
//
// 검색은 네트워크를 쓰지 않는다. 목록은 미리 받아 둔 정적 파일이다.

export default function DestinationSheet({ open, current, saving, onClose, onPick }) {
  const [all, setAll] = useState([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    loadDestinations().then((rows) => {
      if (alive) setAll(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

  const matches = useMemo(() => searchDestinations(all, q, 20), [all, q]);

  return (
    <Sheet open={open} onClose={onClose} title="목적지">
      {current && (
        <p className="mb-3 text-xs text-muted">
          지금 목적지는 <strong className="font-semibold text-ink">{current}</strong>입니다.
        </p>
      )}
      <div className="relative">
        <Search
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          value={q}
          autoFocus
          autoComplete="off"
          aria-label="도시 이름"
          placeholder="도시 이름 (예: 도쿄)"
          onChange={(e) => setQ(e.target.value)}
          className="h-11 w-full rounded-sm border border-hairline bg-canvas pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none"
        />
      </div>

      <div className="mt-3 max-h-[46vh] overflow-y-auto">
        {q.trim() === '' ? (
          <p className="py-6 text-center text-xs text-muted">도시 이름을 입력해 주세요.</p>
        ) : matches.length === 0 ? (
          <EmptyState icon={Search} message="목록에 없는 도시입니다. 장소 검색으로 담아 주세요." />
        ) : (
          <ul>
            {matches.map((d) => (
              <li key={d.id} className="border-t border-hairline first:border-t-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onPick(d)}
                  className="flex w-full items-center gap-2 px-1 py-3 text-left transition-colors hover:bg-surface-soft disabled:opacity-50"
                >
                  <MapPin size={16} className="shrink-0 text-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{d.ko}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {d.country} · {d.en}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

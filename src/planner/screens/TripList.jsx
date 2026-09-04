import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogIn, MapPinned, Plus, RotateCcw } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import LoginPrompt from '../../components/LoginPrompt';
import Badge from '../kit/Badge';
import Button from '../kit/Button';
import Card from '../kit/Card';
import EmptyState from '../kit/EmptyState';
import {
  boardSyncList,
  getBoardPostTimes,
  getPlaceStats,
  importFromPost,
  importFromToken,
  listTrips,
} from '../api';
import { takePendingImport } from '../importPending';
import { resolveStale } from '../lib/boardSync';
import { formatDateRange, formatTripLength, latestTimestamp } from '../lib/format';

// 플래너에서 이 화면만 비로그인 진입을 받는다(설계 §1.1).
// 소개는 세 줄로 끝낸다 — 무엇을 하는 화면인지만 말하고 권유 문구는 넣지 않는다.
const INTRO = [
  '날짜별로 갈 곳을 담고 순서를 정합니다.',
  '항공권·입장권을 여행별로 모아 둡니다.',
  '만든 일정은 링크로 공유하거나 게시판에 올릴 수 있습니다.',
];

function TripCard({ trip, placeCount, sync }) {
  return (
    <li>
      <Link to={`/planner/t/${trip.id}`} className="block">
        <Card interactive className="p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="min-w-0 text-base font-semibold text-ink">{trip.title}</h2>
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              {sync?.postId && <Badge tone="outline">게시됨</Badge>}
              {sync?.stale && <Badge tone="warning">게시글 미반영</Badge>}
            </div>
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {formatDateRange(trip.start_date, trip.end_date)}
            {' · '}
            {formatTripLength(trip.start_date, trip.end_date)}
            {' · 장소 '}
            {placeCount}곳
          </p>
        </Card>
      </Link>
    </li>
  );
}

export default function TripList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id || null;

  const [loginOpen, setLoginOpen] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | importing | ready | error
  const [trips, setTrips] = useState([]);
  const [counts, setCounts] = useState(() => new Map());
  const [sync, setSync] = useState(() => new Map());
  const [errorText, setErrorText] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorText('');
    try {
      const [rows, placeStats] = await Promise.all([listTrips(), getPlaceStats()]);
      setTrips(rows);
      setCounts(placeStats.counts);
      setStatus('ready');

      // 게시 동기화 상태는 스냅샷을 다시 만들어 비교하는 비싼 조회라 목록을 먼저 그린 뒤 채운다.
      try {
        const tripIds = rows.map((r) => r.id);
        const [syncRows, postTimes] = await Promise.all([
          boardSyncList(),
          getBoardPostTimes(tripIds),
        ]);
        setSync(
          new Map(
            syncRows.map((r) => {
              const trip = rows.find((t) => t.id === r.trip_id);
              const lastChangedAt = latestTimestamp([
                trip?.updated_at,
                placeStats.latest.get(r.trip_id),
              ]);
              return [
                r.trip_id,
                {
                  postId: r.post_id,
                  // RPC 의 stale 을 그대로 쓰지 않는 이유는 lib/boardSync.js 주석 참조.
                  stale: resolveStale({
                    serverStale: r.stale,
                    postUpdatedAt: postTimes.get(r.trip_id) || null,
                    lastChangedAt,
                  }),
                },
              ];
            })
          )
        );
      } catch (err) {
        // 배지가 안 보이는 것뿐이라 목록 전체를 실패로 만들지 않는다.
        console.error('게시 상태를 확인하지 못했습니다:', err);
      }
    } catch (err) {
      setErrorText(err.message);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;

    (async () => {
      // 로그인 전에 눌러 둔 가져오기가 있으면 먼저 끝낸다(설계 §1.1 대기 항목).
      const pending = takePendingImport();
      if (pending) {
        setStatus('importing');
        try {
          const newTripId = pending.post
            ? await importFromPost(pending.post)
            : await importFromToken(pending.token);
          if (!alive) return;
          if (newTripId) {
            navigate(`/planner/t/${newTripId}`, { replace: true });
            return;
          }
          setNotice('가져올 일정을 찾지 못했습니다. 링크가 만료되었을 수 있습니다.');
        } catch (err) {
          if (!alive) return;
          setNotice(err.message);
        }
      }
      if (alive) await load();
    })();

    return () => {
      alive = false;
    };
  }, [userId, navigate, load]);

  if (!user) {
    return (
      <section className="mx-auto max-w-md">
        <h1 className="mb-4 text-xl">여행 플래너</h1>
        <Card className="p-6">
          <ul className="mb-6 space-y-2 text-sm text-body">
            {INTRO.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-soft" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <Button variant="primary" onClick={() => setLoginOpen(true)}>
            <LogIn size={16} aria-hidden="true" />
            로그인
          </Button>
        </Card>
        <LoginPrompt isOpen={loginOpen} onClose={() => setLoginOpen(false)} />
      </section>
    );
  }

  return (
    <section>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-xl">내 여행</h1>
        {/* a 안에 button 을 넣으면 잘못된 마크업이 된다. 화면 안 동작 버튼은 navigate 로 옮긴다. */}
        <Button variant="primary" size="sm" onClick={() => navigate('/planner/new')}>
          <Plus size={16} aria-hidden="true" />
          여행 만들기
        </Button>
      </div>

      {notice && (
        <p role="status" className="mb-4 rounded-sm border border-hairline px-3 py-2 text-sm text-body">
          {notice}
        </p>
      )}

      {status === 'importing' && (
        <Card>
          <EmptyState icon={MapPinned} message="공유받은 일정을 가져오는 중입니다." />
        </Card>
      )}

      {status === 'loading' && (
        <ul className="space-y-3">
          {[0, 1, 2].map((i) => (
            <li key={i} aria-hidden="true">
              <Card className="p-4">
                <div className="h-5 w-2/5 rounded-sm bg-surface-strong" />
                <div className="mt-2 h-3 w-3/5 rounded-sm bg-surface-soft" />
              </Card>
            </li>
          ))}
        </ul>
      )}

      {status === 'error' && (
        <Card>
          <EmptyState
            icon={RotateCcw}
            message={errorText || '목록을 불러오지 못했습니다.'}
            action={(
              <Button variant="secondary" size="sm" onClick={load}>
                다시 시도
              </Button>
            )}
          />
        </Card>
      )}

      {status === 'ready' && trips.length === 0 && (
        <Card>
          <EmptyState
            icon={MapPinned}
            message="아직 만든 여행이 없습니다."
            action={(
              <Button variant="secondary" size="sm" onClick={() => navigate('/planner/new')}>
                <Plus size={16} aria-hidden="true" />
                여행 만들기
              </Button>
            )}
          />
        </Card>
      )}

      {status === 'ready' && trips.length > 0 && (
        <ul className="space-y-3">
          {trips.map((trip) => (
            <TripCard
              key={trip.id}
              trip={trip}
              placeCount={counts.get(trip.id) || 0}
              sync={sync.get(trip.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MapPinned, Plus, RotateCcw, TriangleAlert } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import Button from '../kit/Button';
import Card from '../kit/Card';
import EmptyState from '../kit/EmptyState';
import { ToastStack } from '../kit/Toast';
import MapSurface from '../providers/MapSurface';
import DayTabs, { UNASSIGNED_ID } from './board/DayTabs';
import PlaceList from './board/PlaceList';
import PlaceSheet from './board/PlaceSheet';
import TripHeader from './board/TripHeader';
import ActionBar from './board/ActionBar';
import { LinkImportSheet, PlaceSearchSheet } from './board/PickerSheets';
import {
  AddPlaceSheet,
  AssumptionsSheet,
  DatesSheet,
  MoreSheet,
  WarningSheet,
} from './board/BoardSheets';
import { warningLabel, warningSentence } from './board/warningText';
import {
  boardSyncState,
  createPlace,
  upsertCatalog,
  createShare,
  deletePlace,
  getCatalogEntries,
  getTrip,
  publishToBoard,
  reorderPlaces,
  setDates,
  unpublish,
  updatePlace,
} from '../api';
import { checkDay, warningsByPlace } from '../lib/feasibility';
import { resolveStale } from '../lib/boardSync';
import { latestTimestamp } from '../lib/format';
import { estimateLegs, totalDurationSeconds } from '../lib/travelTime';
import { readDayWindow, writeDayWindow } from '../lib/dayWindow';

// /planner/t/:tripId — 일정판. 플래너의 중심 화면이다.
//
// 이 화면이 들고 있는 것: 여행·날짜·핀 원본 데이터와 화면 상태(어느 날짜를 보는지, 어떤 시트가 열렸는지).
// 계산(이동시간 추정·동선 검사)은 전부 lib 의 순수 함수에 맡기고, 저장은 api.js 를 거친다.
//
// 아직 없는 것: 장소 검색·링크로 담기·티켓 지갑. 셋 다 서버리스 함수가 있어야 동작해서
// 버튼만 두고 "준비 중입니다."로 안내한다. 그동안 장소는 지도 롱프레스나 '장소 추가'로 담는다.

const PREPARING = '준비 중입니다.';

export default function TripBoard() {
  const { tripId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [errorText, setErrorText] = useState('');
  const [trip, setTrip] = useState(null);
  const [days, setDays] = useState([]);
  const [places, setPlaces] = useState([]);
  const [catalog, setCatalog] = useState(() => new Map());
  const [sync, setSync] = useState({ published: false, stale: false });

  const [activeDayId, setActiveDayId] = useState(null);
  const [sheet, setSheet] = useState(null); // place | add | search | link | dates | assumptions | more | warning
  const [selectedPlaceId, setSelectedPlaceId] = useState(null);
  const [activeWarning, setActiveWarning] = useState(null);
  const [addSeed, setAddSeed] = useState(null);
  const [dayWindow, setDayWindow] = useState(() => readDayWindow(tripId));
  const [shareUrl, setShareUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState([]);

  const pushToast = useCallback((tone, message) => {
    setToasts((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, tone, message }]);
  }, []);

  // ---------------------------------------------------------------------
  // 불러오기
  // ---------------------------------------------------------------------
  // 게시 상태 판정에 여행·날짜·핀의 updated_at 이 필요한데, setState 직후에는 state 로 읽을 수
  // 없다(다음 렌더에 반영). 마지막으로 불러온 원본을 ref 로 함께 들고 있는다.
  const dataRef = useRef(null);

  const applyTrip = useCallback((data) => {
    dataRef.current = data;
    setTrip(data.trip);
    setDays(data.days);
    setPlaces(data.places);
    setActiveDayId((prev) => {
      const stillThere = prev === UNASSIGNED_ID || data.days.some((d) => d.id === prev);
      if (prev && stillThere) return prev;
      return data.days[0]?.id || UNASSIGNED_ID;
    });
  }, []);

  const loadSync = useCallback(async () => {
    try {
      const state = await boardSyncState(tripId);
      const data = dataRef.current;
      const lastChangedAt = data
        ? latestTimestamp([
            data.trip?.updated_at,
            ...data.days.map((d) => d.updated_at),
            ...data.places.map((p) => p.updated_at),
          ])
        : null;
      setSync({
        published: Boolean(state?.published),
        // RPC 의 stale 은 그대로 믿을 수 없다 — 이유와 SQL 해결책은 lib/boardSync.js 주석 참조.
        stale: resolveStale({
          serverStale: Boolean(state?.stale),
          postUpdatedAt: state?.post_updated_at || null,
          lastChangedAt,
        }),
        postId: state?.post_id || null,
      });
    } catch (err) {
      // 배지가 안 보이는 것뿐이라 화면 전체를 실패로 만들지 않는다.
      console.error('게시 상태를 확인하지 못했습니다:', err);
    }
  }, [tripId]);

  const loadCatalog = useCallback(async (rows) => {
    const ids = rows.map((p) => p.catalog_id).filter(Boolean);
    if (ids.length === 0) {
      setCatalog(new Map());
      return;
    }
    try {
      setCatalog(await getCatalogEntries(ids));
    } catch (err) {
      // 영업시간을 못 읽으면 그 기준의 경고만 사라진다(설계 §6: 근거가 없으면 경고하지 않는다).
      console.error('장소 정보를 불러오지 못했습니다:', err);
    }
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorText('');
    try {
      const data = await getTrip(tripId);
      applyTrip(data);
      // 가정값·공유 링크는 여행마다 다르다. 주소만 바뀌고 화면이 그대로 남는 이동에서도
      // 값이 섞이지 않도록 불러오기와 같은 자리에서 맞춘다.
      setDayWindow(readDayWindow(tripId));
      setShareUrl('');
      setStatus('ready');
      loadCatalog(data.places);
      loadSync();
    } catch (err) {
      setErrorText(err.message);
      setStatus('error');
    }
  }, [tripId, applyTrip, loadCatalog, loadSync]);

  // 저장 뒤 조용한 갱신. 화면을 로딩 상태로 되돌리지 않는다.
  const refresh = useCallback(async () => {
    const data = await getTrip(tripId);
    applyTrip(data);
    loadCatalog(data.places);
    loadSync();
  }, [tripId, applyTrip, loadCatalog, loadSync]);

  useEffect(() => {
    load();
  }, [load]);

  // ---------------------------------------------------------------------
  // 파생값
  // ---------------------------------------------------------------------
  const activeDay = useMemo(
    () => days.find((d) => d.id === activeDayId) || null,
    [days, activeDayId]
  );

  const dayPlaces = useMemo(() => {
    const list =
      activeDayId === UNASSIGNED_ID
        ? places.filter((p) => !p.day_id)
        : places.filter((p) => p.day_id === activeDayId);
    return [...list].sort((a, b) => a.sort_order - b.sort_order);
  }, [places, activeDayId]);

  const legs = useMemo(() => estimateLegs(dayPlaces), [dayPlaces]);
  const travelSeconds = useMemo(() => totalDurationSeconds(legs), [legs]);

  const feasibility = useMemo(() => {
    if (!activeDay) return { warnings: [], timeline: { rows: [] } };
    return checkDay({
      date: activeDay.date,
      places: dayPlaces.map((p) => ({
        ...p,
        opening_hours: catalog.get(p.catalog_id)?.opening_hours || null,
      })),
      legs,
      options: dayWindow,
    });
  }, [activeDay, dayPlaces, catalog, legs, dayWindow]);

  const warnMap = useMemo(() => warningsByPlace(feasibility.warnings), [feasibility]);
  const dayWarnings = useMemo(
    () => feasibility.warnings.filter((w) => !w.placeId),
    [feasibility]
  );

  const dayCounts = useMemo(() => {
    const map = new Map();
    places.forEach((p) => {
      if (p.day_id) map.set(p.day_id, (map.get(p.day_id) || 0) + 1);
    });
    return map;
  }, [places]);

  const unassignedCount = useMemo(() => places.filter((p) => !p.day_id).length, [places]);

  const budgetTotal = useMemo(
    () => places.reduce((sum, p) => sum + (Number.isFinite(p.cost) ? p.cost : 0), 0),
    [places]
  );

  const pins = useMemo(
    () =>
      dayPlaces.map((p, i) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        name: p.name,
        label: i + 1,
        selected: p.id === selectedPlaceId,
      })),
    [dayPlaces, selectedPlaceId]
  );

  const selectedPlace = useMemo(
    () => places.find((p) => p.id === selectedPlaceId) || null,
    [places, selectedPlaceId]
  );

  const activeLabel = activeDay ? `${activeDay.day_index + 1}일차` : '보관함';

  // ---------------------------------------------------------------------
  // 동작
  // ---------------------------------------------------------------------
  const runSaving = useCallback(
    async (fn, { success } = {}) => {
      if (busy) return false;
      setBusy(true);
      try {
        await fn();
        if (success) pushToast('success', success);
        return true;
      } catch (err) {
        pushToast('error', err.message);
        // 저장이 반만 반영된 상태로 화면이 남지 않도록 서버 상태를 다시 읽는다.
        try {
          await refresh();
        } catch {
          // 갱신까지 실패하면 화면은 그대로 두고 사용자가 다시 시도하게 한다.
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, pushToast, refresh]
  );

  // 드래그 중에는 화면 순서만 바꾼다. 정렬 상태를 목록 컴포넌트가 따로 들고 있으면
  // 목록이 갱신될 때마다 되돌리는 처리가 필요해져서, 순서의 주인을 여기 하나로 둔다.
  const previewOrder = useCallback((ids) => {
    setPlaces((prev) => {
      const rank = new Map(ids.map((id, i) => [id, i]));
      return prev.map((p) => (rank.has(p.id) ? { ...p, sort_order: rank.get(p.id) } : p));
    });
  }, []);

  const commitOrder = (ids) => {
    runSaving(async () => {
      await reorderPlaces(tripId, activeDayId === UNASSIGNED_ID ? null : activeDayId, ids);
      await refresh();
    });
  };

  const handleAddPlace = (values) => {
    runSaving(
      async () => {
        await createPlace({
          tripId,
          userId: user?.id,
          day_id: activeDayId === UNASSIGNED_ID ? null : activeDayId,
          sort_order: dayPlaces.length,
          source: 'longpress',
          ...values,
        });
        await refresh();
        setSheet(null);
        setAddSeed(null);
      },
      { success: `${activeLabel}에 담았습니다.` }
    );
  };

  // 검색·링크에서 고른 결과를 핀으로 담는다.
  // 제공자 정보가 있으면 장소 카탈로그에 먼저 넣어 catalog_id 를 받는다 — 후기는 그 id 로 걸린다.
  // 카탈로그 등록이 실패해도 핀은 담는다(좌표·이름은 이미 손에 있다). 후기만 나중 일이 된다.
  const handlePickPlace = (item) => {
    runSaving(
      async () => {
        let catalogId = null;
        if (item.provider && item.provider_place_id) {
          try {
            catalogId = await upsertCatalog({
              provider: item.provider,
              providerPlaceId: item.provider_place_id,
              name: item.name,
              address: item.address || null,
              lat: item.lat,
              lng: item.lng,
              extra: item.opening_hours ? { opening_hours: item.opening_hours } : null,
            });
          } catch {
            catalogId = null;
          }
        }
        await createPlace({
          tripId,
          userId: user?.id,
          day_id: activeDayId === UNASSIGNED_ID ? null : activeDayId,
          sort_order: dayPlaces.length,
          source: item.source || 'search',
          catalog_id: catalogId,
          name: item.name,
          address: item.address || null,
          lat: item.lat,
          lng: item.lng,
        });
        await refresh();
        setSheet(null);
      },
      { success: `${activeLabel}에 담았습니다.` }
    );
  };

  const handleSavePlace = ({ patch, dayId }) => {
    const target = selectedPlace;
    if (!target) return;
    const currentDayId = target.day_id || null;
    const nextDayId = dayId || null;

    runSaving(
      async () => {
        await updatePlace(target.id, patch);
        if (nextDayId !== currentDayId) {
          // 날짜 이동은 정렬 RPC 로 처리한다 — 목적지 날짜의 순번까지 한 번에 정리된다.
          const siblings = places
            .filter((p) => (nextDayId ? p.day_id === nextDayId : !p.day_id) && p.id !== target.id)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((p) => p.id);
          await reorderPlaces(tripId, nextDayId, [...siblings, target.id]);
        }
        await refresh();
        setSheet(null);
        setSelectedPlaceId(null);
      },
      { success: '저장했습니다.' }
    );
  };

  const handleDeletePlace = () => {
    const target = selectedPlace;
    if (!target) return;
    runSaving(
      async () => {
        await deletePlace(target.id);
        await refresh();
        setSheet(null);
        setSelectedPlaceId(null);
      },
      { success: '목록에서 지웠습니다.' }
    );
  };

  const handleSetDates = (start, end) => {
    runSaving(async () => {
      const { detached, cancelled } = await setDates(tripId, start, end);
      if (cancelled) return;
      await refresh();
      setSheet(null);
      if (detached > 0) pushToast('info', `핀 ${detached}개를 보관함으로 옮겼습니다.`);
      else pushToast('success', '기간을 바꿨습니다.');
    });
  };

  const handleAssumptions = (value) => {
    if (!writeDayWindow(tripId, value)) {
      pushToast('error', '시간을 다시 확인해 주세요.');
      return;
    }
    setDayWindow(value);
    setSheet(null);
  };

  const handleShare = () => {
    runSaving(async () => {
      const token = await createShare(tripId);
      setShareUrl(`${window.location.origin}/planner/s/${token}`);
    });
  };

  const handleCopyShare = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      pushToast('success', '링크를 복사했습니다.');
    } catch {
      pushToast('info', '링크를 길게 눌러 복사해 주세요.');
    }
  };

  const handlePublish = () => {
    runSaving(
      async () => {
        await publishToBoard(tripId);
        await loadSync();
        setSheet(null);
      },
      { success: sync.published ? '게시글을 갱신했습니다.' : '게시판에 올렸습니다.' }
    );
  };

  const handleUnpublish = () => {
    runSaving(
      async () => {
        await unpublish(tripId);
        await loadSync();
        setSheet(null);
      },
      { success: '게시판에서 내렸습니다.' }
    );
  };

  const openPlace = (placeId) => {
    setSelectedPlaceId(placeId);
    setSheet('place');
  };

  const openWarning = (warning) => {
    setActiveWarning(warning);
    setSheet('warning');
  };

  const closeSheet = () => {
    setSheet(null);
    setAddSeed(null);
  };

  // ---------------------------------------------------------------------
  // 그리기
  // ---------------------------------------------------------------------
  if (status === 'loading') {
    return (
      <Card>
        <EmptyState icon={MapPinned} message="일정을 불러오는 중입니다." />
      </Card>
    );
  }

  if (status === 'error') {
    return (
      <Card className="mx-auto max-w-md">
        <EmptyState
          icon={RotateCcw}
          message={errorText || '일정을 불러오지 못했습니다.'}
          action={(
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => navigate('/planner')}>
                내 여행
              </Button>
              <Button variant="primary" size="sm" onClick={load}>
                다시 시도
              </Button>
            </div>
          )}
        />
      </Card>
    );
  }

  const warningPlaceName = activeWarning
    ? places.find((p) => p.id === activeWarning.placeId)?.name || ''
    : '';

  return (
    <div className="pb-24">
      <Link
        to="/planner"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        내 여행
      </Link>

      <TripHeader
        trip={trip}
        budgetTotal={budgetTotal}
        travelSeconds={travelSeconds}
        dayWindow={dayWindow}
        sync={sync}
        busy={busy}
        onEditDates={() => setSheet('dates')}
        onEditAssumptions={() => setSheet('assumptions')}
        onRefreshPost={handlePublish}
      />

      <DayTabs
        days={days}
        counts={dayCounts}
        unassignedCount={unassignedCount}
        activeId={activeDayId}
        onSelect={(id) => {
          setActiveDayId(id);
          setSelectedPlaceId(null);
        }}
      />

      <div className="lg:grid lg:grid-cols-[64%_1fr] lg:items-start lg:gap-5">
        <div className="mb-4 lg:sticky lg:top-24 lg:mb-0">
          <MapSurface
            className="h-[42dvh] w-full overflow-hidden rounded-md border border-hairline lg:h-[calc(100dvh-18rem)]"
            pins={pins}
            route
            onPinClick={openPlace}
            onLongPress={(coords) => {
              setAddSeed(coords);
              setSheet('add');
            }}
          />
          <p className="mt-2 text-xs text-muted">
            지도를 길게 누르면 그 자리의 좌표로 장소를 담을 수 있습니다.
          </p>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-ink">
              {activeLabel}
              <span className="ml-2 text-sm font-normal text-muted">{dayPlaces.length}곳</span>
            </h2>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setAddSeed(null);
                setSheet('add');
              }}
            >
              <Plus size={16} aria-hidden="true" />
              장소 추가
            </Button>
          </div>

          {dayWarnings.length > 0 && (
            <ul className="mb-3 space-y-2">
              {dayWarnings.map((w) => (
                <li key={w.code}>
                  <button
                    type="button"
                    onClick={() => openWarning(w)}
                    className="flex w-full items-start gap-2 rounded-sm border border-hairline px-3 py-2.5 text-left transition-colors hover:bg-surface-soft"
                  >
                    <TriangleAlert
                      size={14}
                      className="mt-0.5 shrink-0 text-warning"
                      aria-hidden="true"
                    />
                    <span className="text-sm text-body">
                      <span className="font-medium text-ink">{warningLabel(w)}</span>
                      {' · '}
                      {warningSentence(w)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {dayPlaces.length === 0 ? (
            <Card>
              <EmptyState
                icon={MapPinned}
                message={
                  activeDay
                    ? '이 날에 담아 둔 장소가 없습니다.'
                    : '보관함에 담아 둔 장소가 없습니다.'
                }
              />
            </Card>
          ) : (
            <PlaceList
              places={dayPlaces}
              timeline={feasibility.timeline.rows}
              warningsByPlaceId={warnMap}
              currency={trip?.currency || 'KRW'}
              onPreviewOrder={previewOrder}
              onCommitOrder={commitOrder}
              onOpenPlace={openPlace}
              onOpenWarning={openWarning}
            />
          )}
        </div>
      </div>

      <ActionBar
        onSearch={() => setSheet('search')}
        onAddByLink={() => setSheet('link')}
        onTickets={() => pushToast('info', PREPARING)}
        onMore={() => setSheet('more')}
      />

      {/* 시트는 열려 있을 때만 렌더한다 — 닫혔다 열릴 때 새로 마운트되면서 폼이 초기화된다.
          (effect 안에서 setState 로 되돌리는 방식은 쓰지 않는다.) */}
      {sheet === 'place' && selectedPlace && (
        <PlaceSheet
          open
          place={selectedPlace}
          days={days}
          currency={trip?.currency || 'KRW'}
          saving={busy}
          onClose={closeSheet}
          onSave={handleSavePlace}
          onDelete={handleDeletePlace}
        />
      )}

      {sheet === 'add' && (
        <AddPlaceSheet
          open
          initial={addSeed}
          targetLabel={activeLabel}
          saving={busy}
          onClose={closeSheet}
          onSubmit={handleAddPlace}
        />
      )}

      {sheet === 'search' && (
        <PlaceSearchSheet
          open
          targetLabel={activeLabel}
          saving={busy}
          onClose={closeSheet}
          onPick={handlePickPlace}
        />
      )}

      {sheet === 'link' && (
        <LinkImportSheet
          open
          targetLabel={activeLabel}
          saving={busy}
          onClose={closeSheet}
          onPick={handlePickPlace}
        />
      )}

      {sheet === 'dates' && (
        <DatesSheet
          open
          startDate={trip?.start_date}
          endDate={trip?.end_date}
          saving={busy}
          onClose={closeSheet}
          onSubmit={handleSetDates}
        />
      )}

      {sheet === 'assumptions' && (
        <AssumptionsSheet
          open
          value={dayWindow}
          onClose={closeSheet}
          onSubmit={handleAssumptions}
        />
      )}

      {sheet === 'warning' && (
        <WarningSheet
          open
          warning={activeWarning}
          placeName={warningPlaceName}
          onClose={closeSheet}
        />
      )}

      <MoreSheet
        open={sheet === 'more'}
        busy={busy}
        published={sync.published}
        stale={sync.stale}
        shareUrl={shareUrl}
        onClose={closeSheet}
        onShare={handleShare}
        onCopyShare={handleCopyShare}
        onPublish={handlePublish}
        onUnpublish={handleUnpublish}
        onExport={() => navigate(`/planner/t/${tripId}/export`)}
      />

      <ToastStack
        items={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  );
}

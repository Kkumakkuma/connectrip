import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MapPinned, Plus, RotateCcw, TriangleAlert } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import Button from '../kit/Button';
import Card from '../kit/Card';
import EmptyState from '../kit/EmptyState';
import { ToastStack } from '../kit/Toast';
import MapSurface from '../providers/MapSurface';
import SourceAttribution from '../providers/SourceAttribution';
import DayTabs, { UNASSIGNED_ID } from './board/DayTabs';
import PlaceList from './board/PlaceList';
import PlaceSheet from './board/PlaceSheet';
import usePlaceTickets from './board/usePlaceTickets';
import TicketDateConfirm from '../tickets/TicketDateConfirm';
import FullScreenTicket from '../tickets/FullScreenTicket';
import TripHeader from './board/TripHeader';
import ActionBar from './board/ActionBar';
import { LinkImportSheet, PlaceSearchSheet } from './board/PickerSheets';
import SuggestedPlaces from './board/SuggestedPlaces';
import DestinationSheet from './board/DestinationSheet';
import SnapshotView from './SnapshotView';
import { buildLocalSnapshot } from '../lib/snapshot';
import { legsCurrent, legsValid } from '../lib/legs';
import { readSnapshot, saveSnapshot } from '../lib/offlineStore';
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
  updateTrip,
} from '../api';
import { checkDay, warningsByPlace } from '../lib/feasibility';
import { resolveStale } from '../lib/boardSync';
import { latestTimestamp } from '../lib/format';
import { estimateLegs, totalDurationSeconds } from '../lib/travelTime';
import { computeDayLegs } from '../api';
import { readDayWindow, writeDayWindow } from '../lib/dayWindow';

// /planner/t/:tripId — 일정판. 플래너의 중심 화면이다.
//
// 이 화면이 들고 있는 것: 여행·날짜·핀 원본 데이터와 화면 상태(어느 날짜를 보는지, 어떤 시트가 열렸는지).
// 계산(이동시간 추정·동선 검사)은 전부 lib 의 순수 함수에 맡기고, 저장은 api.js 를 거친다.
//
// 장소를 담는 길은 셋이다: 지도 롱프레스(수동 핀) · 장소 검색 · 링크로 담기.
// 뒤의 둘은 서버리스 함수(api/planner/*)를 거친다 — 외부 제공자 호출 정책과 SSRF 가드가
// 서버에 있어야 하기 때문이다.
//
// 네트워크가 죽으면 기기에 남겨 둔 스냅샷으로 읽기 전용 화면을 띄운다(설계 §7.1).

// 저장된 이동시간 검증(legsValid)·형식 버전(legsCurrent)은 lib/legs 에 있다 — 스냅샷 화면과 같은 규칙(2026-09-06).

export default function TripBoard() {
  const { tripId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus] = useState('loading'); // loading | ready | offline | error
  // 네트워크가 죽었을 때 기기에 남은 사본으로 띄우는 읽기 전용 화면.
  const [offlineSnapshot, setOfflineSnapshot] = useState(null);
  const [errorText, setErrorText] = useState('');
  const [trip, setTrip] = useState(null);
  const [days, setDays] = useState([]);
  const [places, setPlaces] = useState([]);
  // DB 에서 다시 읽을 때마다 +1. 이동시간 서버 계산은 이 값이 바뀔 때(=DB 확정 상태)만 부른다.
  const [dbVersion, setDbVersion] = useState(0);
  // 드래그 중(순서를 화면에서만 바꾼 상태)에는 서버 계산도, DB 에 저장된 이동시간도 쓰지 않는다.
  const [orderDirty, setOrderDirty] = useState(false);
  const [catalog, setCatalog] = useState(() => new Map());
  // 카탈로그(핀 출처) 확보 상태. 첫 로드에서만 'loading' 으로 지도를 잠깐 보류하고, 이후 재조회는 'ready' 를 유지한다.
  const [catalogStatus, setCatalogStatus] = useState('loading');
  const [sync, setSync] = useState({ published: false, stale: false });

  const [activeDayId, setActiveDayId] = useState(null);
  const [sheet, setSheet] = useState(null); // place | add | search | link | dates | assumptions | more | warning | dest
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

  // 장소에 붙이는 티켓(2026-09-06 쿠마님). 목록·업로드·확인 시트·전체화면 상태는 이 훅이 들고, 장소 시트가 닫혀도 흐름은 이어진다.
  // 티켓은 getTrip 결과에 섞지 않는다 — 그 결과가 기기 사본(buildLocalSnapshot)·내보내기로 흐른다.
  const tk = usePlaceTickets({ tripId, userId: user?.id, trip, places, pushToast });
  // 티켓 확인 시트·전체화면이 떠 있는 동안은 보드의 다른 시트를 전부 내려(open=false, 마운트 유지) 모달이 한 겹만 있게 한다(codex 9/6)
  const ticketModal = Boolean(tk.pending || tk.viewing);

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
    setOrderDirty(false);
    setDbVersion((v) => v + 1);
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
      setCatalogStatus('ready');
      return new Map();
    }
    setCatalogStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const entries = await getCatalogEntries(ids);
      setCatalog(entries);
      setCatalogStatus('ready');
      return entries;
    } catch (err) {
      // 영업시간을 못 읽으면 그 기준의 경고만 사라진다(설계 §6: 근거가 없으면 경고하지 않는다).
      // 핀 출처도 못 읽은 것이라 OSM 지도는 그리지 않는다(MapSurface provenance='error').
      setCatalogStatus('error');
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
      setOfflineSnapshot(null);
      // 카탈로그(제공자·영업시간)를 먼저 받아야 기기 사본에도 출처가 실린다. 실패하면 undefined — 표기만 빠진다.
      const entries = await loadCatalog(data.places);
      loadSync();
      // 기기에 사본을 남긴다. 비행기 안이나 로밍을 끈 상태에서 일정만이라도 보이게 하는 용도다.
      // 실패해도 화면에는 영향이 없다(저장은 있으면 좋은 것이지 없으면 못 쓰는 게 아니다).
      saveSnapshot(user?.id, tripId, buildLocalSnapshot(data, entries || null), data.trip?.end_date).catch(() => {});
    } catch (err) {
      // 네트워크가 죽었을 때 기기에 남은 사본으로 읽기 전용 화면을 띄운다.
      const cached = await readSnapshot(user?.id, tripId).catch(() => null);
      if (cached) {
        setOfflineSnapshot(cached);
        setStatus('offline');
        return;
      }
      setErrorText(err.message);
      setStatus('error');
    }
  }, [tripId, applyTrip, loadCatalog, loadSync, user?.id]);

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
    // 서버(routes.js)와 같은 순서 규칙: sort_order → created_at → id. 같은 sort_order 가 겹쳐도 구간 인덱스가 어긋나지 않게.
    return [...list].sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
        String(a.id).localeCompare(String(b.id))
    );
  }, [places, activeDayId]);

  // 이동시간 (2026-09-05): 화면 추정치를 먼저 보여 주고, DB 에 저장된 서버 계산(캐시·구글 경로·추정)이 있으면 그 값으로 바꾼다.
  //   · 값의 주인은 DB(planner_days.legs)다. 핀이 바뀌면 트리거가 legs 를 NULL 로 만들고, 화면은 DB 를 다시 읽은
  //     뒤(dbVersion 증가) legs 가 비어 있는 날짜만 서버에 계산·저장을 부탁한다. 화면 추정 상태로는 부르지 않는다
  //     (드래그 프리뷰나 아직 저장 안 된 순서로 부르면 서버는 DB 옛 순서를 계산해 엉뚱한 구간에 붙는다 — 교차검토 지적).
  //   · 서버가 저장했다고 답하면(saved) 그 날짜의 legs 를 화면 상태에도 넣는다. 그 사이 DB 를 또 읽었으면(dbVersion 변경) 버린다.
  //   · 드래그 중(orderDirty)·보관함(날짜 없음)은 추정치만 쓴다. 실패하면 추정치 그대로 — 화면이 멈추지 않는다.
  const estimatedLegs = useMemo(() => estimateLegs(dayPlaces), [dayPlaces]);
  const pinCount = dayPlaces.length;
  const dbVersionRef = useRef(0);
  dbVersionRef.current = dbVersion;
  const legsTriedRef = useRef(new Set());   // `${dayId}:${dbVersion}` — 저장 거부(saved:false)·실패가 렌더마다 재호출로 번지지 않게(agy 9/6)
  useEffect(() => {
    if (!activeDayId || activeDayId === UNASSIGNED_ID || orderDirty || pinCount < 2) return undefined;
    if (legsValid(activeDay?.legs?.items, pinCount - 1) && legsCurrent(activeDay?.legs)) return undefined; // DB 값이 있으면 부르지 않는다(구버전 legs 는 한 번 재계산)
    const dayId = activeDayId;
    const version = dbVersion;
    const tryKey = `${dayId}:${version}`;
    if (legsTriedRef.current.has(tryKey)) return undefined;   // 이 DB 상태에서는 이미 한 번 시도했다
    legsTriedRef.current.add(tryKey);
    let cancelled = false;
    // 연속 저장(핀 여러 개 담기)을 한 번으로 모은다.
    const timer = setTimeout(async () => {
      try {
        const out = await computeDayLegs(dayId);
        if (cancelled || version !== dbVersionRef.current || !out.saved) return;
        setDays((prev) =>
          prev.map((d) =>
            d.id === dayId ? { ...d, legs: { v: out.v, mode: out.mode, computed_at: out.computed_at, fp: out.fp, items: out.legs } } : d
          )
        );
      } catch (err) {
        // 추정치가 이미 보이고 있다. 서버 계산 실패는 조용히 넘긴다.
        console.error('이동시간을 계산하지 못했습니다:', err);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // activeDay 는 days 에서 파생되므로 days 갱신(저장 반영)에도 다시 판단한다.
  }, [activeDayId, activeDay, dbVersion, orderDirty, pinCount]);

  const legs = useMemo(() => {
    if (orderDirty) return estimatedLegs;
    const items = activeDay?.legs?.items;
    if (!legsValid(items, estimatedLegs.length)) return estimatedLegs;
    return estimatedLegs.map((est, i) => {
      const it = items[i];
      if (!Number.isFinite(Number(it?.duration_s))) return est;
      return {
        mode: it.mode || est?.mode || 'WALK',
        duration_s: Number(it.duration_s),
        distance_m: Number.isFinite(Number(it.distance_m)) ? Number(it.distance_m) : est?.distance_m ?? 0,
        source: it.source || 'estimate',
        ...(Array.isArray(it.steps) ? { steps: it.steps } : {}),   // 대중교통 요약(2026-09-06) — 화면까지 전달(codex)
      };
    });
  }, [orderDirty, activeDay, estimatedLegs]);
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
        // 출처(google/osm/null). MapSurface 의 역방향 가드가 본다 — OSM 지도 위에 구글 핀을 올리지 않기 위해.
        provider: (p.catalog_id && catalog.get(p.catalog_id)?.provider) || null,
      })),
    [dayPlaces, selectedPlaceId, catalog]
  );

  // 여행 전체(모든 날짜·보관함)에 구글 출처 핀이 있는지. MapSurface 의 역방향 가드가 본다.
  const tripHasGoogle = useMemo(
    () => places.some((p) => p.catalog_id && catalog.get(p.catalog_id)?.provider === 'google'),
    [places, catalog]
  );

  // 목록 아래 출처 표기용. 구글 지도로 바뀐 뒤에도 OSM 출처 핀(추천 명소·예전 검색)이 섞일 수 있어 둘 다 센다.
  const dayProviders = useMemo(
    () =>
      Array.from(
        new Set(dayPlaces.map((p) => (p.catalog_id ? catalog.get(p.catalog_id)?.provider : null)).filter(Boolean))
      ),
    [dayPlaces, catalog]
  );

  const selectedPlace = useMemo(
    () => places.find((p) => p.id === selectedPlaceId) || null,
    [places, selectedPlaceId]
  );

  const activeLabel = activeDay ? `${activeDay.day_index + 1}일차` : '보관함';

  // 추천 블록을 언제 보여줄지.
  //   목적지가 있으면 여행이 어느 정도 채워질 때까지 계속 곁에 둔다 — 하나 담자마자 사라지면
  //   두 번째 장소를 담을 방법이 없어진다(교차검토 지적).
  //   목적지가 없으면 완전히 빈 여행에서만 "목적지 정하기"를 권한다. 이미 장소를 담아 둔
  //   사람에게는 참견이 된다.
  const SUGGEST_UNTIL = 8;
  const showSuggest = trip?.dest_id ? places.length < SUGGEST_UNTIL : places.length === 0;

  // 추천 카드에 "담김"을 표시하려면 이 여행에 이미 들어온 장소의 제공자 id 가 필요하다.
  // 날짜와 무관하게 여행 전체를 본다 — 1일차에 담아 둔 곳이 2일차 추천에 또 뜨면 안 된다.
  const addedKeys = useMemo(() => {
    const keys = new Set();
    for (const p of places) {
      const entry = p.catalog_id ? catalog.get(p.catalog_id) : null;
      if (entry?.provider_place_id) keys.add(entry.provider_place_id);
    }
    return keys;
  }, [places, catalog]);

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
    setOrderDirty(true);
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

  // 목적지 정하기·바꾸기. 통화는 건드리지 않는다 — 이미 적어 둔 비용의 단위가 말없이 바뀐다.
  const handleSetDest = (d) => {
    runSaving(
      async () => {
        await updateTrip(tripId, {
          dest_id: d.id,
          dest_name: d.ko,
          dest_lat: d.lat,
          dest_lng: d.lng,
          country: d.country || null,
        });
        await refresh();
        setSheet(null);
      },
      { success: `목적지를 ${d.ko}(으)로 정했습니다.` }
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
        try {
          await tk.refresh();   // 장소가 사라진 티켓(place_id NULL)이 목록에서 빠지게. 실패해도 삭제 성공 토스트는 그대로
        } catch {
          // 티켓 목록은 다음 조작에서 다시 읽힌다
        }
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

  if (status === 'offline' && offlineSnapshot) {
    return (
      <section>
        <div className="mb-3 rounded-sm border border-hairline bg-surface-soft px-3 py-2 text-xs text-body">
          지금 인터넷에 연결되지 않아 <strong className="font-semibold text-ink">기기에 저장해 둔 일정</strong>을 보여 드립니다.
          이 화면에서는 고칠 수 없습니다.
          <button type="button" onClick={load} className="ml-2 underline underline-offset-2">
            다시 시도
          </button>
        </div>
        <SnapshotView snapshot={offlineSnapshot} />
      </section>
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
            hasGoogleData={tripHasGoogle}
            provenance={catalogStatus}
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
            // 추천 블록이 아래에 뜨는 상황이면 "없습니다" 안내를 겹쳐 놓지 않는다.
            showSuggest ? null : (
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
            )
          ) : (
            <PlaceList
              places={dayPlaces}
              legs={legs}
              timeline={feasibility.timeline.rows}
              warningsByPlaceId={warnMap}
              currency={trip?.currency || 'KRW'}
              onPreviewOrder={previewOrder}
              onCommitOrder={commitOrder}
              onOpenPlace={openPlace}
              onOpenWarning={openWarning}
            />
          )}
          {/* 장소 데이터 출처. 지도가 안 뜬 상태(한도·오류)에서도 구글 장소를 보이면 로고가 정책상 필요하다. */}
          <SourceAttribution providers={dayProviders} className="mt-2" />

          {/* 빈 화면을 그대로 두지 않는다. 그 도시 대표 명소를 눌러서 바로 담게 한다.
              목록 아래에 두어, 하나 담은 뒤에도 이어서 담을 수 있게 한다. */}
          {showSuggest && (
            <SuggestedPlaces
              destId={trip?.dest_id || null}
              destName={trip?.dest_name || null}
              addedKeys={addedKeys}
              saving={busy}
              onPick={handlePickPlace}
              onChooseDest={() => setSheet('dest')}
            />
          )}
        </div>
      </div>

      <ActionBar
        onSearch={() => setSheet('search')}
        onAddByLink={() => setSheet('link')}
        onTickets={() => navigate(`/planner/t/${tripId}/tickets`)}
        onMore={() => setSheet('more')}
      />

      {/* 시트는 열려 있을 때만 렌더한다 — 닫혔다 열릴 때 새로 마운트되면서 폼이 초기화된다.
          (effect 안에서 setState 로 되돌리는 방식은 쓰지 않는다.) */}
      {sheet === 'place' && selectedPlace && (
        <PlaceSheet
          open={!ticketModal}   // 티켓 확인 시트·전체화면 동안은 마운트만 유지하고 DOM 은 내린다(폼 입력 보존, 모달 한 겹)
          place={selectedPlace}
          days={days}
          currency={trip?.currency || 'KRW'}
          saving={busy}
          onClose={closeSheet}
          onSave={handleSavePlace}
          onDelete={handleDeletePlace}
          tickets={tk.byPlace.get(selectedPlace.id) || []}
          ticketsError={tk.ticketsError}
          ticketBusy={tk.busy}
          onUploadTicket={(file) => tk.upload(file, selectedPlace.id)}
          onOpenTicket={(t) => (t.event_date ? tk.open(t) : tk.reconfirm(t))}
        />
      )}

      {/* 티켓 확인 시트·전체화면은 sheet==='place' 조건 밖 — 업로드 중 시트를 닫아도 확인 시트가 뜨고, 저장 뒤 돌아갈 시트가 없으면 그냥 끝난다 */}
      {tk.pending && (
        <TicketDateConfirm
          key={tk.pending.row.id}
          open
          detection={tk.pending.detection}
          bcbp={tk.pending.bcbp}
          tripZone={tk.pending.tripZone}
          viewerZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
          saving={tk.busy}
          onClose={tk.dismiss}
          onSubmit={tk.confirm}
        />
      )}
      {tk.viewing && <FullScreenTicket ticket={tk.viewing.ticket} url={tk.viewing.url} onClose={tk.closeViewer} />}

      {sheet === 'add' && (
        <AddPlaceSheet
          open={!ticketModal}
          initial={addSeed}
          targetLabel={activeLabel}
          saving={busy}
          onClose={closeSheet}
          onSubmit={handleAddPlace}
        />
      )}

      {sheet === 'search' && (
        <PlaceSearchSheet
          open={!ticketModal}
          targetLabel={activeLabel}
          saving={busy}
          onClose={closeSheet}
          onPick={handlePickPlace}
          // 구글 자동완성 편향(여행 목적지 반경 50km)과 정적 추천 명소 매칭에 쓴다. 목적지가 없으면 null.
          bias={
            Number.isFinite(Number(trip?.dest_lat)) && Number.isFinite(Number(trip?.dest_lng))
              ? { lat: Number(trip.dest_lat), lng: Number(trip.dest_lng) }
              : null
          }
          destId={trip?.dest_id || null}
        />
      )}

      {sheet === 'link' && (
        <LinkImportSheet
          open={!ticketModal}
          targetLabel={activeLabel}
          saving={busy}
          onClose={closeSheet}
          onPick={handlePickPlace}
        />
      )}

      {sheet === 'dest' && (
        <DestinationSheet
          open={!ticketModal}
          current={trip?.dest_name || ''}
          saving={busy}
          onClose={closeSheet}
          onPick={handleSetDest}
        />
      )}

      {sheet === 'dates' && (
        <DatesSheet
          open={!ticketModal}
          startDate={trip?.start_date}
          endDate={trip?.end_date}
          saving={busy}
          onClose={closeSheet}
          onSubmit={handleSetDates}
        />
      )}

      {sheet === 'assumptions' && (
        <AssumptionsSheet
          open={!ticketModal}
          value={dayWindow}
          onClose={closeSheet}
          onSubmit={handleAssumptions}
        />
      )}

      {sheet === 'warning' && (
        <WarningSheet
          open={!ticketModal}
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
        destName={trip?.dest_name || ''}
        onClose={closeSheet}
        onShare={handleShare}
        onCopyShare={handleCopyShare}
        onPublish={handlePublish}
        onUnpublish={handleUnpublish}
        onExport={() => navigate(`/planner/t/${tripId}/export`)}
        onChooseDest={() => setSheet('dest')}
      />

      <ToastStack
        items={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  );
}

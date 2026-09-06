import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Image as ImageIcon, Loader2, MapPin, Plus, Ticket, Trash2 } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import Badge from '../kit/Badge';
import Button from '../kit/Button';
import Card from '../kit/Card';
import EmptyState from '../kit/EmptyState';
import { ToastStack } from '../kit/Toast';
import { deleteTicket, getTrip, listTickets, updateTicket } from '../api';
import Switch from '../kit/Switch';
import { formatDateWithWeekday, todayISO } from '../lib/format';
import { purgeTicket, saveTicket, ticketBytes } from '../lib/offlineStore';
import { KIND_LABEL, ticketLabel } from '../lib/ticketFile';
import { resolveTripZoneAsync, timeZoneGapText } from '../lib/timezone';
import TicketDateConfirm from '../tickets/TicketDateConfirm';
import FullScreenTicket from '../tickets/FullScreenTicket';
import { resolveTicketView, uploadAndDetect } from '../tickets/intake';

// /planner/t/:tripId/tickets — 티켓 지갑 (설계 §5)
//
// 원칙 셋
//   1. 원본 그대로 저장한다. 줄이면 전체화면에서 확대했을 때 바코드가 뭉개진다.
//   2. 판독 결과는 초안일 뿐이다. 업로드 직후 확인 시트를 반드시 한 번 거친다.
//   3. 전체화면은 언제나 원본을 보여 준다. 바코드를 다시 그리지 않는다 —
//      탑승권이 게이트에서 안 읽히면 그 자리에서 탑승이 막힌다.

// 파일 규칙·종류 라벨·업로드/열기 I/O 는 lib/ticketFile · tickets/intake 로 옮겨 장소 시트(PlaceSheet)와 함께 쓴다(2026-09-06).

function TicketRow({ ticket, placeName, onOpen, onDelete, busy }) {
  const isPdf = ticket.mime === 'application/pdf';
  return (
    <li className="border-t border-hairline first:border-t-0">
      <div className="flex items-center gap-3 py-3">
        <button
          type="button"
          onClick={() => onOpen(ticket)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-muted"
          >
            {isPdf ? <FileText size={18} /> : <ImageIcon size={18} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">
              {ticketLabel(ticket)}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
              {ticket.kind && <span>{KIND_LABEL[ticket.kind] || ticket.kind}</span>}
              {ticket.event_time && <span>{String(ticket.event_time).slice(0, 5)}</span>}
              {placeName && (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <MapPin size={11} aria-hidden="true" />
                  <span className="truncate">{placeName}</span>
                </span>
              )}
              {!ticket.event_date && <span className="text-warning">날짜 미확인</span>}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onDelete(ticket)}
          disabled={busy}
          aria-label="티켓 삭제"
          className="shrink-0 rounded-sm p-2 text-muted transition-colors hover:bg-surface-soft disabled:opacity-50"
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

export default function Tickets() {
  const { tripId } = useParams();
  const { user } = useAuth();
  const fileRef = useRef(null);

  const [trip, setTrip] = useState(null);
  const [places, setPlaces] = useState([]);     // 티켓 행에 붙은 장소 이름 표시용(2026-09-06)
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [pending, setPending] = useState(null);   // 업로드 직후 확인 대기 중인 티켓
  const [viewing, setViewing] = useState(null);
  const [viewUrl, setViewUrl] = useState(null);
  const viewRevokeRef = useRef(null);          // 기기 사본으로 만든 object URL 은 닫을 때·화면을 떠날 때 해제한다
  useEffect(() => () => {
    viewRevokeRef.current?.();
    viewRevokeRef.current = null;
  }, []);
  // 티켓 원본을 기기에 남길지. **여행별 opt-in, 기본 꺼짐**(설계 §5.4).
  // 탑승권 바코드는 성 + 예약번호 조합이라 항공사 예약 조회가 되는 자격증명이다.
  const [offlineOn, setOfflineOn] = useState(() => {
    try {
      return localStorage.getItem(`ct_planner_ticket_offline_${tripId}`) === '1';
    } catch {
      return false;
    }
  });
  const [offlineBytes, setOfflineBytes] = useState(0);
  // 알림 계산에 쓸 시간대. 여행에 저장된 값이 없으면 담은 장소 좌표에서 찾는다.
  // 좌표 판별 데이터는 152KB 라 이 화면에 들어올 때 한 번만 불러온다.
  const [tripZone, setTripZone] = useState(null);

  const pushToast = useCallback((tone, message) => {
    setToasts((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, tone, message }]);
  }, []);

  const refresh = useCallback(async () => {
    const rows = await listTickets(tripId);
    setTickets(rows);
    setOfflineBytes(await ticketBytes(user?.id).catch(() => 0));
  }, [tripId, user?.id]);

  // 기기 저장을 켜면 지금 있는 티켓을 내려받아 보관하고, 끄면 이 여행 사본을 지운다.
  const toggleOffline = async (on) => {
    setOfflineOn(on);
    try {
      localStorage.setItem(`ct_planner_ticket_offline_${tripId}`, on ? '1' : '0');
    } catch { /* 저장이 막힌 환경 — 이번 세션에만 적용된다 */ }

    setBusy(true);
    try {
      if (!on) {
        await Promise.all(tickets.map((t) => purgeTicket(user?.id, t.id)));
        setOfflineBytes(await ticketBytes(user?.id).catch(() => 0));
        pushToast('info', '기기에 저장된 티켓 사본을 지웠습니다.');
        return;
      }
      const { downloadTicket } = await import('../api');
      let saved = 0;
      let blocked = '';
      for (const t of tickets) {
        try {
          const blob = await downloadTicket(t.storage_path);
          const r = await saveTicket(user?.id, {
            tripId, ticketId: t.id, blob, mime: t.mime, tripEndDate: trip?.end_date,
          });
          if (r === 'ok') saved += 1;
          else blocked = r;
        } catch { /* 한 장 실패가 전체를 막지 않는다 */ }
      }
      setOfflineBytes(await ticketBytes(user?.id).catch(() => 0));
      if (blocked === 'quota' || blocked === 'no-room') {
        pushToast('error', '저장 공간이 부족해 일부만 저장했습니다.');
      } else {
        pushToast('success', `티켓 ${saved}장을 기기에 저장했습니다.`);
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [tripData, rows] = await Promise.all([getTrip(tripId), listTickets(tripId)]);
        if (!alive) return;
        setTrip(tripData.trip);
        setPlaces(tripData.places || []);
        setTickets(rows);
        const zone = await resolveTripZoneAsync(tripData.trip, tripData.places);
        if (alive) setTripZone(zone);
      } catch (e) {
        if (alive) pushToast('error', e?.message || '티켓을 불러오지 못했습니다.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tripId, pushToast]);

  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const placeById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';           // 같은 파일을 다시 골라도 이벤트가 오게 비운다
    if (!file) return;

    setBusy(true);
    try {
      // 검증 → 업로드 → 목록 갱신 → 판독(실패는 빈 후보로 흡수) — 장소 시트와 같은 경로(tickets/intake)
      let listFailed = false;
      const result = await uploadAndDetect({
        tripId,
        userId: user?.id,
        file,
        trip,
        placeId: null,
        onUploaded: async () => {
          try {
            await refresh();
          } catch {
            listFailed = true;
          }
        },
      });
      if (listFailed) {
        // 파일도 행도 이미 서버에 있다. "올리지 못했습니다"로 말하면 사용자가 다시 올려 사본이 둘 생긴다(교차검토 지적).
        pushToast('info', '올리기는 끝났는데 목록을 새로 못 읽었습니다. 화면을 새로고침해 주세요.');
      }
      setPending(result);
    } catch (err) {
      pushToast('error', err?.message || '올리지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (values) => {
    if (!pending) return;
    setBusy(true);
    try {
      await updateTicket(pending.row.id, {
        ...values,
        barcode_text: pending.barcode?.text || null,
        barcode_format: pending.barcode?.format || null,
      });
      await refresh();
      if (offlineOn) {
        try {
          const { downloadTicket } = await import('../api');
          const blob = await downloadTicket(pending.row.storage_path);
          await saveTicket(user?.id, {
            tripId, ticketId: pending.row.id, blob, mime: pending.row.mime, tripEndDate: trip?.end_date,
          });
        } catch { /* 기기 저장 실패는 티켓 저장 자체를 막지 않는다 */ }
      }
      setPending(null);
      pushToast('success', '티켓을 저장했습니다.');
    } catch (err) {
      pushToast('error', err?.message || '저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (ticket) => {
    if (!window.confirm('이 티켓을 지울까요? 되돌릴 수 없습니다.')) return;
    setBusy(true);
    try {
      await deleteTicket(ticket.id);
      await purgeTicket(user?.id, ticket.id);   // 기기 사본도 같이
      await refresh();
      pushToast('success', '티켓을 지웠습니다.');
    } catch (err) {
      pushToast('error', err?.message || '지우지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  // 날짜를 아직 확인하지 않은 티켓은 열면 확인 시트를 다시 띄운다.
  // "나중에"로 닫고 나면 되돌아올 길이 없던 문제(교차검토 지적).
  const handleOpen = async (ticket) => {
    if (!ticket.event_date) {
      setPending({ row: ticket, detection: { candidates: [], best: null, ambiguous: true }, bcbp: null, barcode: null });
      return;
    }
    setViewing(ticket);
    setViewUrl(null);
    try {
      const view = await resolveTicketView(ticket, user?.id);
      if (!view) {
        // null 을 성공으로 치면 전체화면이 영원히 로딩만 돈다.
        pushToast('error', ticket.mime === 'application/pdf' ? 'PDF 를 화면에 그리지 못했습니다.' : '티켓을 열지 못했습니다.');
        setViewing(null);
        return;
      }
      viewRevokeRef.current = view.revoke;
      setViewUrl(view.url);
    } catch {
      pushToast('error', '티켓을 열지 못했습니다.');
      setViewing(null);
    }
  };

  const closeViewer = () => {
    viewRevokeRef.current?.();
    viewRevokeRef.current = null;
    setViewing(null);
    setViewUrl(null);
  };

  const today = todayISO();
  const todayTickets = tickets.filter((t) => t.event_date === today);
  const grouped = tickets.reduce((acc, t) => {
    const key = t.event_date || '미확인';
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});
  const dayKeys = Object.keys(grouped).sort((a, b) => {
    if (a === '미확인') return 1;
    if (b === '미확인') return -1;
    return a.localeCompare(b);
  });

  return (
    <section className="pb-8">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link to={`/planner/t/${tripId}`} className="inline-flex items-center gap-1 text-sm text-muted">
          <ArrowLeft size={14} aria-hidden="true" />
          일정판으로
        </Link>
        <Button variant="primary" onClick={() => fileRef.current?.click()} loading={busy}>
          <Plus size={16} aria-hidden="true" />
          티켓 올리기
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      <h1 className="mb-1 text-xl">티켓 지갑</h1>
      <p className="mb-5 text-sm text-muted">
        항공권·입장권을 날짜별로 모아 둡니다. 올린 파일은 이 여행에서만 보이고, 공유·게시글에는 들어가지 않습니다.
      </p>

      {loading ? (
        <Card className="p-8 text-center">
          <Loader2 size={20} className="mx-auto animate-spin text-muted" aria-hidden="true" />
        </Card>
      ) : tickets.length === 0 ? (
        <Card>
          <EmptyState icon={Ticket} message="아직 올린 티켓이 없습니다." />
        </Card>
      ) : (
        <>
          {todayTickets.length > 0 && (
            <div className="mb-4">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
                오늘 <Badge tone="warning">{todayTickets.length}</Badge>
              </h2>
              <Card className="px-4">
                <ul>
                  {todayTickets.map((t) => (
                    <TicketRow key={`today-${t.id}`} ticket={t} placeName={placeById.get(t.place_id)?.name || ''} onOpen={handleOpen} onDelete={handleDelete} busy={busy} />
                  ))}
                </ul>
              </Card>
            </div>
          )}

          <div className="space-y-3">
            {dayKeys.map((key) => (
              <div key={key}>
                <h2 className="mb-1.5 text-sm font-semibold text-ink">
                  {key === '미확인' ? '날짜 미확인' : formatDateWithWeekday(key)}
                </h2>
                <Card className="px-4">
                  <ul>
                    {grouped[key].map((t) => (
                      <TicketRow key={t.id} ticket={t} placeName={placeById.get(t.place_id)?.name || ''} onOpen={handleOpen} onDelete={handleDelete} busy={busy} />
                    ))}
                  </ul>
                </Card>
              </div>
            ))}
          </div>
        </>
      )}

      <Card className="mt-5 p-4">
        <Switch
          checked={offlineOn}
          onChange={toggleOffline}
          disabled={busy}
          label="티켓 오프라인 저장"
        />
        <p className="mt-2 text-xs text-muted">
          {offlineOn
            ? `기기에 티켓 사본이 저장됩니다. 여행이 끝나면 자동으로 지워집니다. (현재 ${(offlineBytes / 1048576).toFixed(1)}MB)`
            : '켜면 인터넷이 없어도 티켓을 열 수 있습니다. 기기에 사본이 남으므로 공용 기기에서는 켜지 마세요.'}
        </p>
      </Card>

      {tripZone ? (
        <p className="mt-5 text-xs text-muted">
          시각은 여행지 기준({tripZone})으로 저장합니다.
          {timeZoneGapText(Date.now(), tripZone, viewerZone)
            ? ` 지금 보는 기기 기준으로 ${timeZoneGapText(Date.now(), tripZone, viewerZone)}.`
            : ''}
        </p>
      ) : (
        <p className="mt-5 text-xs text-muted">
          담은 장소가 없어 현지 시간대를 아직 알 수 없습니다. 일정에 장소를 하나 담으면 그 위치로 자동으로 잡힙니다.
        </p>
      )}

      {pending && (
        <TicketDateConfirm
          open
          detection={pending.detection}
          bcbp={pending.bcbp}
          tripZone={tripZone}
          viewerZone={viewerZone}
          saving={busy}
          onClose={() => setPending(null)}
          onSubmit={handleConfirm}
        />
      )}

      {viewing && <FullScreenTicket ticket={viewing} url={viewUrl} onClose={closeViewer} />}

      <ToastStack items={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </section>
  );
}

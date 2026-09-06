import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadTicket, listTickets, updateTicket } from '../../api';
import { saveTicket } from '../../lib/offlineStore';
import { readOfflineOptIn, ticketsByPlace } from '../../lib/ticketFile';
import { resolveTripZoneAsync } from '../../lib/timezone';
import { resolveTicketView, uploadAndDetect } from '../../tickets/intake';

// 일정판에서 장소에 티켓을 붙이는 상태 묶음(2026-09-06 쿠마님: "장소에 티켓을 올리면 그 장소에서도, 티켓 지갑에서도 보이게").
//
// - 티켓 목록은 일정판이 따로 들고 있다(getTrip 에 섞지 않는다 — 그 결과가 기기 사본·내보내기로 흐른다).
// - 업로드 → 확인 시트(pending) → 저장까지의 Promise 는 이 훅이 소유한다. 장소 시트가 닫혀도 확인 시트는 뜬다.
// - 경쟁 조건 방어(교차검토 9/6 codex·agy):
//     · genRef  — 여행(tripId)이 바뀌면 세대를 올려 이전 여행의 비동기 결과(목록·확인 시트·시간대)를 버린다
//     · seqRef  — 목록 응답 역전: 마지막 요청만 반영
//     · viewSeqRef — 뷰어 요청 번호: 이전 티켓의 실패가 지금 열린 티켓을 닫지 않게
//     · pending 은 티켓 ID 로 결속: 저장이 끝난 뒤 다른 pending 으로 바뀌어 있으면 지우지 않는다
//     · object URL 은 viewRevokeRef 가 소유: 교체·닫기·언마운트에서 해제(setState updater 안에서 부작용 금지)
export default function usePlaceTickets({ tripId, userId, trip, places, pushToast }) {
  const [tickets, setTickets] = useState([]);
  const [ticketsError, setTicketsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);   // { row, detection, bcbp, barcode, tripZone }
  const [viewing, setViewing] = useState(null);   // { ticket, url }

  const genRef = useRef(0);
  const seqRef = useRef(0);
  const viewSeqRef = useRef(0);
  const viewRevokeRef = useRef(null);
  const aliveRef = useRef(true);
  const busyRef = useRef(false);
  const zoneRef = useRef(null);
  const pendingRef = useRef(null);
  const tripRef = useRef(trip);
  const placesRef = useRef(places);
  useEffect(() => {
    tripRef.current = trip;
    placesRef.current = places;
  }, [trip, places]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const revokeView = useCallback(() => {
    viewRevokeRef.current?.();
    viewRevokeRef.current = null;
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      viewRevokeRef.current?.();
      viewRevokeRef.current = null;
    };
  }, []);

  const refresh = useCallback(async () => {
    const gen = genRef.current;
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    try {
      const rows = await listTickets(tripId);
      if (!aliveRef.current || gen !== genRef.current || seq !== seqRef.current) return;
      setTickets(rows);
      setTicketsError(false);
    } catch (err) {
      // 빈 목록으로 보이면 사용자가 같은 티켓을 다시 올린다 — 실패는 실패로 보여 준다
      if (aliveRef.current && gen === genRef.current && seq === seqRef.current) setTicketsError(true);
      throw err;
    }
  }, [tripId]);

  // 여행이 바뀌면 이전 여행의 상태를 전부 내려놓는다
  useEffect(() => {
    genRef.current += 1;
    zoneRef.current = null;
    setTickets([]);
    setTicketsError(false);
    setPending(null);
    revokeView();
    setViewing(null);
    refresh().catch(() => {});
  }, [refresh, revokeView]);

  // 여행지 시간대: 저장된 값이 있으면 즉시, 없으면 담은 장소 좌표로(152KB 데이터 지연 로드). 여행별로 한 번 알면 기억한다.
  const resolveZone = useCallback(async () => {
    if (zoneRef.current) return zoneRef.current;
    const gen = genRef.current;
    const zone = await resolveTripZoneAsync(tripRef.current, placesRef.current).catch(() => null);
    if (zone && gen === genRef.current) zoneRef.current = zone;
    return zone;
  }, []);

  const upload = useCallback(
    async (file, placeId) => {
      if (busyRef.current || pendingRef.current) return false;   // 확인 시트가 떠 있는 동안은 새 업로드를 받지 않는다
      busyRef.current = true;
      setBusy(true);
      const gen = genRef.current;
      try {
        const zonePromise = resolveZone();   // 확인 시트를 열기 전에 끝나 있도록 먼저 시작한다
        let listFailed = false;
        const result = await uploadAndDetect({
          tripId,
          userId,
          file,
          trip: tripRef.current,
          placeId,
          onUploaded: async () => {
            try {
              await refresh();
            } catch {
              listFailed = true;
            }
          },
        });
        if (gen !== genRef.current) return false;   // 그새 다른 여행으로 갔다 — 파일·행은 서버에 있으니 그 여행 지갑에서 보인다
        if (listFailed) {
          pushToast('info', '올리기는 끝났는데 목록을 새로 못 읽었습니다. 화면을 새로고침해 주세요.');
        }
        const tripZone = await zonePromise;
        if (aliveRef.current && gen === genRef.current) setPending({ ...result, tripZone });
        return true;
      } catch (err) {
        if (gen === genRef.current) pushToast('error', err?.message || '올리지 못했습니다.');
        return false;
      } finally {
        busyRef.current = false;
        if (aliveRef.current) setBusy(false);
      }
    },
    [tripId, userId, pushToast, refresh, resolveZone],
  );

  // 날짜를 아직 확인하지 않은 티켓은 열면 확인 시트를 다시 띄운다("나중에"로 닫고 나면 되돌아올 길이 없던 문제).
  const reconfirm = useCallback(
    async (ticket) => {
      if (busyRef.current) return;
      const gen = genRef.current;
      const seq = viewSeqRef.current + 1;   // 연속 탭이면 마지막 것만
      viewSeqRef.current = seq;
      const tripZone = await resolveZone();
      if (!aliveRef.current || gen !== genRef.current || seq !== viewSeqRef.current) return;
      setPending({
        row: ticket,
        detection: { candidates: [], best: null, ambiguous: true },
        bcbp: null,
        barcode: null,
        tripZone,
      });
    },
    [resolveZone],
  );

  const confirm = useCallback(
    async (values) => {
      const target = pendingRef.current;
      if (!target || busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      const gen = genRef.current;
      try {
        await updateTicket(target.row.id, {
          ...values,
          // 재확인(바코드 없음)일 때는 바코드 칸을 건드리지 않는다 — updateTicket 은 넘긴 키를 그대로 patch 에 넣는다
          ...(target.barcode ? { barcode_text: target.barcode.text || null, barcode_format: target.barcode.format || null } : {}),
        });
        try {
          await refresh();
        } catch {
          // 목록은 다음 조작에서 다시 읽힌다
        }
        if (readOfflineOptIn(tripId)) {
          try {
            const blob = await downloadTicket(target.row.storage_path);
            await saveTicket(userId, {
              tripId,
              ticketId: target.row.id,
              blob,
              mime: target.row.mime,
              tripEndDate: tripRef.current?.end_date,
            });
          } catch {
            // 기기 저장 실패는 티켓 저장 자체를 막지 않는다
          }
        }
        // 저장한 그 티켓의 확인 시트만 닫는다(그새 다른 티켓으로 바뀌었으면 그대로 둔다)
        if (aliveRef.current && gen === genRef.current && pendingRef.current?.row?.id === target.row.id) setPending(null);
        pushToast('success', '티켓을 저장했습니다.');
        return true;
      } catch (err) {
        pushToast('error', err?.message || '저장하지 못했습니다.');
        return false;
      } finally {
        busyRef.current = false;
        if (aliveRef.current) setBusy(false);
      }
    },
    [tripId, userId, pushToast, refresh],
  );

  // 저장 중에는 닫지 못한다(백그라운드 저장이 끝난 뒤 시트가 사라지는 혼란 방지)
  const dismiss = useCallback(() => {
    if (busyRef.current) return;
    setPending(null);
  }, []);

  const open = useCallback(
    async (ticket) => {
      const gen = genRef.current;
      const seq = viewSeqRef.current + 1;
      viewSeqRef.current = seq;
      revokeView();                      // 직전 티켓의 object URL 을 먼저 놓는다
      setViewing({ ticket, url: null });
      try {
        const view = await resolveTicketView(ticket, userId);
        const stale = !aliveRef.current || gen !== genRef.current || seq !== viewSeqRef.current;
        if (stale) {
          view?.revoke?.();
          return;
        }
        if (!view) {
          pushToast('error', ticket.mime === 'application/pdf' ? 'PDF 를 화면에 그리지 못했습니다.' : '티켓을 열지 못했습니다.');
          setViewing(null);
          return;
        }
        viewRevokeRef.current = view.revoke || null;
        setViewing({ ticket, url: view.url });
      } catch {
        if (!aliveRef.current || gen !== genRef.current || seq !== viewSeqRef.current) return;
        pushToast('error', '티켓을 열지 못했습니다.');
        setViewing(null);
      }
    },
    [userId, pushToast, revokeView],
  );

  const closeViewer = useCallback(() => {
    viewSeqRef.current += 1;   // 아직 오는 중인 응답은 버린다
    revokeView();
    setViewing(null);
  }, [revokeView]);

  const byPlace = useMemo(() => ticketsByPlace(tickets), [tickets]);

  return { tickets, ticketsError, byPlace, busy, pending, viewing, refresh, upload, reconfirm, confirm, dismiss, open, closeViewer };
}

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, FileJson, Loader2, Printer, TriangleAlert } from 'lucide-react';
import Button from '../kit/Button';
import Card from '../kit/Card';
import { ToastStack } from '../kit/Toast';
import { getCatalogEntries, getTrip } from '../api';
import { buildLocalSnapshot } from '../lib/snapshot';
import { safeFileBase } from '../lib/ics';
import { saveTextFile } from '../lib/fileSave';
import { prepareTripCalendar, saveTripCalendar } from '../lib/tripCalendar';
import SnapshotView from './SnapshotView';

// /planner/t/:tripId/export — 내보내기 (설계 §7.2)
//   캘린더  장소·티켓 하나가 일정 하나(.ics). 구글·삼성·네이버·애플 캘린더로 가져간다(lib/tripCalendar).
//   JSON    스냅샷 그대로. 다른 도구로 옮기거나 백업할 때.
//   인쇄    브라우저 인쇄 대화상자를 열어 종이나 PDF 로 저장한다.
//
// 파일 저장은 lib/fileSave 가 맡는다 — 웹은 Blob 다운로드, 앱(2026-09-04 부터 플래너가 앱에도 실린다)은
// 안드로이드 WebView 가 Blob 다운로드를 못 받아서 캐시에 쓰고 공유 창을 연다.

export default function ExportView() {
  const { tripId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [calendarBusy, setCalendarBusy] = useState(false);

  const pushToast = useCallback((message, tone = 'info') => {
    setToasts((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, tone, message }]);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getTrip(tripId);
        // 출처 표기(구글 로고·ODbL)를 위해 카탈로그 제공자도 읽는다. 실패해도 내보내기는 된다(표기만 빠진다).
        const catalog = await getCatalogEntries((res?.places || []).map((p) => p.catalog_id)).catch(() => null);
        if (alive) setData({ ...res, catalog });
      } catch (e) {
        if (alive) setError(e?.message || '여행을 불러오지 못했습니다.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [tripId]);

  const snapshot = data ? buildLocalSnapshot(data, data.catalog || null) : null;
  const base = safeFileBase(snapshot?.title);

  const onJson = async () => {
    if (!snapshot) return;
    try {
      const result = await saveTextFile({
        fileName: `${base}.json`,
        text: JSON.stringify(snapshot, null, 2),
        mime: 'application/json',
      });
      if (result === 'downloaded') pushToast('JSON 파일을 저장했습니다.', 'success');
    } catch {
      pushToast('JSON 파일을 만들지 못했습니다.', 'error');
    }
  };

  const onIcs = async () => {
    if (!data?.trip || calendarBusy) return;
    setCalendarBusy(true);
    try {
      // 스냅샷이 아니라 원본 행으로 만든다 — UID 에 장소·티켓 id 가 들어가야 다시 내보내도 같은 일정으로 잡힌다.
      const file = await prepareTripCalendar({ trip: data.trip, days: data.days || [], places: data.places || [] });
      if (!file.text) {
        if (file.ticketsFailed) pushToast('티켓을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.', 'error');
        else pushToast('캘린더에 넣을 일정이 없습니다. 날짜에 장소를 담아 주세요.', 'info');
        return;
      }
      const result = await saveTripCalendar(file);
      if (result === 'downloaded') pushToast(`일정 ${file.count}건을 캘린더 파일로 저장했습니다.`, 'success');
      if (file.ticketsFailed && result !== 'cancelled') pushToast('티켓을 불러오지 못해 장소 일정만 담았습니다.', 'info');
    } catch {
      pushToast('캘린더 파일을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.', 'error');
    } finally {
      setCalendarBusy(false);
    }
  };

  if (error) {
    return (
      <Card className="mx-auto max-w-md p-6 text-center">
        <TriangleAlert size={22} className="mx-auto mb-3 text-warning" aria-hidden="true" />
        <h1 className="mb-2 text-lg">불러오지 못했습니다</h1>
        <p className="mb-5 text-sm text-muted">{error}</p>
        <Link to="/planner">
          <Button variant="secondary">내 여행 목록</Button>
        </Link>
      </Card>
    );
  }

  if (!snapshot) {
    return (
      <Card className="mx-auto max-w-md p-8 text-center">
        <Loader2 size={22} className="mx-auto mb-3 animate-spin text-muted" aria-hidden="true" />
        <p className="text-sm text-muted">일정을 불러오는 중입니다.</p>
      </Card>
    );
  }

  return (
    <section>
      <div className="mb-4 flex items-center gap-2 print:hidden">
        <Link to={`/planner/t/${tripId}`} className="inline-flex items-center gap-1 text-sm text-muted">
          <ArrowLeft size={14} aria-hidden="true" />
          일정판으로
        </Link>
      </div>

      <Card className="mb-5 p-4 print:hidden">
        <h1 className="mb-1 text-lg">내보내기</h1>
        <p className="mb-4 text-sm text-muted">
          만든 일정을 파일로 저장하거나 인쇄합니다. 비공개로 표시한 메모는 어떤 형식에도 담기지 않습니다.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={onIcs} loading={calendarBusy}>
            <CalendarDays size={16} aria-hidden="true" />
            캘린더로 내보내기 (.ics)
          </Button>
          <Button variant="secondary" onClick={onJson}>
            <FileJson size={16} aria-hidden="true" />
            JSON 저장
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={16} aria-hidden="true" />
            인쇄 · PDF 저장
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          시각은 여행지 기준으로 넣습니다. 캘린더 앱은 지금 있는 곳의 시각으로 바꿔 보여 줍니다.
        </p>
      </Card>

      <SnapshotView snapshot={snapshot} />

      <ToastStack items={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </section>
  );
}

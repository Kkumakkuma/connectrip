import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, FileJson, Loader2, Printer, TriangleAlert } from 'lucide-react';
import Button from '../kit/Button';
import Card from '../kit/Card';
import { ToastStack } from '../kit/Toast';
import { getTrip } from '../api';
import { buildLocalSnapshot } from '../lib/snapshot';
import { buildIcs, safeFileBase } from '../lib/ics';
import SnapshotView from './SnapshotView';

// /planner/t/:tripId/export — 내보내기 (설계 §7.2)
//   JSON  스냅샷 그대로. 다른 도구로 옮기거나 백업할 때.
//   ICS   핀 하나가 일정 하나. 달력 앱으로 가져간다.
//   인쇄  브라우저 인쇄 대화상자를 열어 종이나 PDF 로 저장한다.
//
// 파일 저장은 Blob + a[download] 로 한다. 이 화면은 커넥트립 웹에서만 열리므로(앱 빌드에는
// 플래너가 실리지 않는다) 다운로드가 막히는 환경을 따로 다루지 않는다.

function download(filename, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 즉시 해제하면 사파리에서 저장이 취소되는 사례가 있어 한 틱 뒤에 푼다.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ExportView() {
  const { tripId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);

  const pushToast = useCallback((message, tone = 'info') => {
    setToasts((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, tone, message }]);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getTrip(tripId);
        if (alive) setData(res);
      } catch (e) {
        if (alive) setError(e?.message || '여행을 불러오지 못했습니다.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [tripId]);

  const snapshot = data ? buildLocalSnapshot(data) : null;
  const base = safeFileBase(snapshot?.title);

  const onJson = () => {
    if (!snapshot) return;
    download(`${base}.json`, JSON.stringify(snapshot, null, 2), 'application/json');
    pushToast('JSON 파일을 저장했습니다.', 'success');
  };

  const onIcs = () => {
    if (!snapshot) return;
    const text = buildIcs(snapshot, { uidSeed: tripId });
    const eventCount = (text.match(/BEGIN:VEVENT/g) || []).length;
    if (eventCount === 0) {
      pushToast('달력으로 내보낼 장소가 없습니다.', 'warning');
      return;
    }
    download(`${base}.ics`, text, 'text/calendar');
    pushToast(`일정 ${eventCount}건을 달력 파일로 저장했습니다.`, 'success');
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
          <Button variant="primary" onClick={onIcs}>
            <CalendarDays size={16} aria-hidden="true" />
            달력 파일 (.ics)
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
          달력 파일의 시각은 현지 시각 그대로 들어갑니다. 여행지에서 열면 적어 둔 시각으로 보입니다.
        </p>
      </Card>

      <SnapshotView snapshot={snapshot} />

      <ToastStack items={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </section>
  );
}

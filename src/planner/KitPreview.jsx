import { useState } from 'react';
import { Inbox, Plus } from 'lucide-react';
import Button from './kit/Button';
import Card from './kit/Card';
import Badge from './kit/Badge';
import Input from './kit/Input';
import EmptyState from './kit/EmptyState';
import Sheet from './kit/Sheet';
import { ToastStack } from './kit/Toast';

// /planner/__kit — 개발 중에만 열리는 컴포넌트 킷.
// 여기서 확인할 것:
//  · 버튼 테두리가 0px 인가(전역 index.css 의 `button { border: none }` 과 preflight 충돌 복구)
//  · secondary 버튼과 카드의 헤어라인이 보이는가(테두리 유틸리티가 죽지 않았는가)
//  · 바텀시트가 Esc 로 닫히고 Tab 이 시트 안에서만 도는가
//  · 390 / 1280 두 폭에서 레이아웃이 무너지지 않는가

function Row({ title, children }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold text-muted">{title}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  );
}

export default function KitPreview() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toasts, setToasts] = useState([]);

  const pushToast = (tone, message) =>
    setToasts((prev) => [...prev, { id: Date.now() + Math.random(), tone, message }]);

  return (
    <div>
      <h1 className="mb-1 text-xl">컴포넌트 킷</h1>
      <p className="mb-8 text-sm text-muted">플래너 화면이 공통으로 쓰는 UI 조각입니다.</p>

      <Row title="버튼">
        <Button variant="primary">기본</Button>
        <Button variant="secondary">보조</Button>
        <Button variant="ghost">고스트</Button>
        <Button variant="danger">삭제</Button>
        <Button variant="primary" loading>저장 중</Button>
        <Button variant="primary" disabled>비활성</Button>
        <Button variant="secondary" size="sm">작게</Button>
        <Button variant="secondary" size="lg">크게</Button>
        {/* 테두리 유틸리티가 살아 있는지 확인하는 표본 — 1px 빨간 테두리가 보여야 정상 */}
        <button type="button" className="h-11 rounded-sm border border-error px-4 text-sm text-error">
          border 유틸리티 확인
        </button>
      </Row>

      <Row title="배지">
        <Badge tone="neutral">보관함</Badge>
        <Badge tone="primary">1일차</Badge>
        <Badge tone="outline">OSM</Badge>
        <Badge tone="success">방문 완료</Badge>
        <Badge tone="warning">게시글 미반영</Badge>
        <Badge tone="error">시간 겹침</Badge>
      </Row>

      <Row title="카드">
        <Card className="w-full max-w-sm p-4">
          <p className="text-sm font-semibold text-ink">도쿄 4박 5일</p>
          <p className="mt-1 text-xs text-muted">2026.10.01 ~ 2026.10.05 · 12곳</p>
        </Card>
        <Card interactive className="w-full max-w-sm p-4">
          <p className="text-sm font-semibold text-ink">누를 수 있는 카드</p>
          <p className="mt-1 text-xs text-muted">호버하면 그림자만 바뀝니다.</p>
        </Card>
      </Row>

      <Row title="입력">
        <div className="w-full max-w-sm space-y-4">
          <Input label="여행 이름" placeholder="예: 도쿄 가을 여행" />
          <Input label="통화" defaultValue="KRW" hint="기본값은 원화입니다." />
          <Input label="시작일" type="date" error="종료일보다 늦을 수 없습니다." />
        </div>
      </Row>

      <Row title="빈 상태">
        <Card className="w-full max-w-md">
          <EmptyState
            icon={Inbox}
            message="보관함에 담아 둔 장소가 없습니다."
            action={(
              <Button variant="secondary" size="sm">
                <Plus size={16} aria-hidden="true" />
                장소 담기
              </Button>
            )}
          />
        </Card>
      </Row>

      <Row title="바텀시트 · 토스트">
        <Button variant="secondary" onClick={() => setSheetOpen(true)}>바텀시트 열기</Button>
        <Button variant="secondary" onClick={() => pushToast('info', '보관함으로 옮겼습니다.')}>
          토스트 (안내)
        </Button>
        <Button variant="secondary" onClick={() => pushToast('success', '게시글을 갱신했습니다.')}>
          토스트 (완료)
        </Button>
        <Button variant="secondary" onClick={() => pushToast('error', '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')}>
          토스트 (실패)
        </Button>
      </Row>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="핀 상세"
        footer={(
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setSheetOpen(false)}>취소</Button>
            <Button variant="primary" className="flex-1" onClick={() => setSheetOpen(false)}>저장</Button>
          </div>
        )}
      >
        <div className="space-y-4">
          <p>Esc 로 닫히고, Tab 은 시트 안에서만 돕니다.</p>
          <Input label="메모" placeholder="예: 예약 번호 1234" />
          <Input label="체류 시간(분)" type="number" defaultValue={60} />
        </div>
      </Sheet>

      <ToastStack
        items={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  );
}

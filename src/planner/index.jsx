import { Routes, Route, Outlet, Link, Navigate, useLocation } from 'react-router-dom';
import { Map } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import Button from './kit/Button';
import Card from './kit/Card';
import TripList from './screens/TripList';
import TripNew from './screens/TripNew';
import TripBoard from './screens/TripBoard';
import Tickets from './screens/Tickets';
import ExportView from './screens/ExportView';
import SharedView from './screens/SharedView';
import ImportView from './screens/ImportView';
import PlannerMissing from './screens/PlannerMissing';
import KitPreview from './KitPreview';
import './planner.css';

// 여행 플래너 셸. vite.config.js 의 '@planner' alias 가 가리키는 진입점이며,
// App.jsx 가 /planner/* 아래에 통째로 마운트한다(플래그가 켜졌을 때만).
//
// 이 파일이 책임지는 것: 라우트 구조 · 공통 레이아웃 · 로그인 가드 · 스코프 클래스(.ct-planner).
// 각 화면의 내용은 순차 작업으로 채운다.

// 컴포넌트 킷은 개발 중에만 연다(설계 §1.1 의 dev 전용 라우트).
// import.meta.env.DEV 는 프로덕션 빌드에서 false 로 접혀 라우트와 KitPreview 가 함께 사라진다.
const KIT_ENABLED = import.meta.env.DEV;

// 로그인 후 원래 보던 화면으로 돌아오게 할 경로. 오픈 리다이렉트가 되지 않도록
// 항상 현재 location 에서 만들고 외부에서 받은 값은 쓰지 않는다.
function useNextParam() {
  const location = useLocation();
  return encodeURIComponent(`${location.pathname}${location.search}`);
}

// 로그인이 있어야 하는 화면의 가드.
// 2026-09-04 쿠마님 지시로 "안내 카드를 띄우고 기다리는" 방식을 버렸다. 비회원에게
// 화면을 보여 주고 기다리면 가입할 이유가 없어진다 — 바로 로그인 화면으로 보낸다.
// 세션 확인 중에는 아무것도 하지 않는다(새로고침마다 로그인 화면이 번쩍이는 것 방지).
function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const next = useNextParam();

  if (loading) return null;
  if (user) return children;
  return <Navigate to={`/signup?mode=login&next=${next}`} replace />;
}

// 공통 레이아웃. 루트에 .ct-planner 를 달아 planner.css 스코프를 연다.
// ⚠ 이 컨테이너와 조상에는 transform/filter 를 걸지 않는다 — 바텀시트가 position:fixed 로
//    화면 전체를 덮는 것이 그 조건에 달려 있다.
function PlannerLayout() {
  return (
    <div className="ct-planner min-h-screen bg-canvas pt-20">
      <div className="border-b border-hairline">
        <div className="mx-auto flex h-14 max-w-content items-center justify-between px-4">
          <Link to="/planner" className="flex items-center gap-2 text-ink">
            <Map size={18} aria-hidden="true" />
            <span className="text-sm font-semibold">여행 플래너</span>
          </Link>
        </div>
      </div>
      <main className="mx-auto max-w-content px-4 py-6 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
    </div>
  );
}

export default function PlannerRoutes() {
  return (
    <Routes>
      <Route element={<PlannerLayout />}>
        {/* 내 여행 목록도 로그인 뒤에만 연다(2026-09-04). */}
        <Route index element={<RequireAuth><TripList /></RequireAuth>} />
        <Route path="new" element={<RequireAuth><TripNew /></RequireAuth>} />
        <Route path="t/:tripId" element={<RequireAuth><TripBoard /></RequireAuth>} />
        <Route path="t/:tripId/tickets" element={<RequireAuth><Tickets /></RequireAuth>} />
        <Route path="t/:tripId/export" element={<RequireAuth><ExportView /></RequireAuth>} />
        {/* 공유 보기도 로그인 뒤에만 연다(2026-09-04 쿠마님 지시). 공유 링크를 받은 사람이
            가입하고 보게 하는 것이 이 결정의 목적이다. noindex 는 그대로 건다. */}
        <Route path="s/:token" element={<RequireAuth><SharedView /></RequireAuth>} />
        {/* 가져오기는 화면 자체가 비로그인 분기를 갖는다(대기 항목 저장 + next 로 로그인 이동).
            RequireAuth 로 감싸면 그 분기가 실행되지 않아 대상이 사라진다. */}
        <Route path="import" element={<ImportView />} />
        {KIT_ENABLED && <Route path="__kit" element={<KitPreview />} />}
        <Route path="*" element={<PlannerMissing />} />
      </Route>
    </Routes>
  );
}

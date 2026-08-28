import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import PayTest from './pages/PayTest'; // 빌드플래그 false 시 트리셰이킹으로 프로덕션 번들에서 제거됨
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useAuth } from './lib/AuthContext';
import { keywordsApi, keywordAlertsApi } from './lib/db';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import ProfileCompleteGate from './components/ProfileCompleteGate';
import RouteResetGuard from './components/RouteResetGuard';
import AnalyticsTracker from './components/AnalyticsTracker';
import Footer from './components/Footer';
import PushPermission from './components/PushPermission';
import AppSplash from './components/AppSplash'; // 앱 오프닝 모션(웹 no-op)
import { isNativeApp } from './lib/native';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, Loader2 } from 'lucide-react';

// 코드 스플리팅: 첫 화면(Home)·Navbar·Footer·가드는 정적 유지하고,
// 나머지 라우트 컴포넌트는 React.lazy 로 분리해 초기 번들 크기를 줄인다.
const Signup = lazy(() => import('./pages/Signup'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const SignupEmail = lazy(() => import('./pages/SignupEmail'));
const SignupComplete = lazy(() => import('./pages/SignupComplete'));
const Destinations = lazy(() => import('./components/Destinations'));
const TravelQnA = lazy(() => import('./components/TravelQnA'));
const MarketBoard = lazy(() => import('./components/MarketBoard'));
const CrewOnly = lazy(() => import('./components/CrewOnly'));
const Promotions = lazy(() => import('./components/Promotions'));
const CompanionBoard = lazy(() => import('./components/CompanionBoard'));
const RegionalBoard = lazy(() => import('./components/RegionalBoard'));
const MyPage = lazy(() => import('./components/MyPage'));
const Search = lazy(() => import('./pages/Search'));
const Admin = lazy(() => import('./pages/Admin'));
const Terms = lazy(() => import('./pages/Terms'));
const Privacy = lazy(() => import('./pages/Privacy'));
const NotFound = lazy(() => import('./pages/NotFound'));
// 결제 테스트 라우트는 빌드플래그(VITE_PAYTEST=1)가 있을 때만 존재.
// ★정적 import 로 두어야 프로덕션(플래그 없음)에서 Rollup 이 트리셰이킹으로 통째로 제거한다.
//   lazy(()=>import) 는 항상 별도 청크를 생성해 프로덕션 dist 에 남으므로 쓰지 않는다.
const PAYTEST = import.meta.env.VITE_PAYTEST === '1';

// 라우트 전환 시 잠깐 보이는 로더 (기존 앱 스피너 톤 유지)
const RouteFallback = () => (
  <div className="flex items-center justify-center min-h-[60vh] w-full">
    <Loader2 className="animate-spin text-blue-600" size={40} />
  </div>
);

function App() {
  const { user, isLoggedIn } = useAuth();
  const [activeCategory, setActiveCategory] = useState('companion');
  const [toasts, setToasts] = useState([]);

  const showToast = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  };

  // 안드로이드 하드웨어 뒤로가기 (앱 전용) — 히스토리가 있으면 back, 루트면 앱 종료.
  // @capacitor/app 은 네이티브에서만 동적 import 해 웹 번들 비대화를 막는다.
  useEffect(() => {
    if (!isNativeApp()) return undefined;
    let cancelled = false;
    let handle = null;
    (async () => {
      const { App: CapApp } = await import('@capacitor/app');
      const h = await CapApp.addListener('backButton', ({ canGoBack }) => {
        if (window.location.pathname !== '/' && canGoBack) {
          window.history.back();
        } else {
          CapApp.exitApp();
        }
      });
      if (cancelled) {
        h.remove(); // 등록 완료 전에 언마운트된 경우 즉시 정리
        return;
      }
      handle = h;
    })();
    return () => {
      cancelled = true;
      if (handle) handle.remove();
    };
  }, []);

  // 키워드 알림 (폴링 방식)
  // 과거 supabase realtime 구독은 unsubscribe 시 "Maximum call stack exceeded" +
  // auth 변경 후 클라이언트 상태 오염 → 모든 데이터 fetch 가 깨지는 문제가 있었다.
  // 그래서 realtime 대신 60초 폴링으로 최근 글을 키워드와 매칭한다.
  // (realtime 퍼블리케이션 설정이 없어도 동작 + 구독 정리 문제 원천 차단)
  // 전 과정 try/catch 로 감싸 어떤 에러가 나도 앱이 죽지 않게 한다.
  const seenAlertIds = useRef(new Set());
  const lastCheckRef = useRef(null);

  useEffect(() => {
    // 로그아웃/비로그인 시 폴링 중지 + 상태 초기화
    if (!isLoggedIn || !user?.id) {
      seenAlertIds.current = new Set();
      lastCheckRef.current = null;
      return;
    }

    let cancelled = false;
    let timerId = null;
    let polling = false;       // 한 tick 이 60초 넘게 걸려도 다음 tick 과 겹치지 않게
    let myKeywords = [];

    // 알림 폭주 방지: 마운트 직후에는 "지금 이후" 글만 본다.
    lastCheckRef.current = new Date().toISOString();

    const loadKeywords = async () => {
      try {
        const data = await keywordsApi.getMyKeywords(user.id);
        if (cancelled) return;
        myKeywords = (data || []).map(k => k.keyword).filter(Boolean);
      } catch (err) {
        console.error('키워드 로딩 실패(폴링):', err);
        myKeywords = [];
      }
    };

    const poll = async () => {
      if (cancelled || myKeywords.length === 0) return;
      // 쿼리 "시작" 시각을 다음 구간 기준으로 미리 잡는다.
      // (쿼리 도중 생성된 글을 다음 폴링에서 누락하지 않도록)
      const since = lastCheckRef.current || new Date().toISOString();
      const nextSince = new Date().toISOString();
      try {
        const matches = await keywordAlertsApi.findMatches(since, myKeywords);
        // 사용자 전환/로그아웃이 그사이 발생했으면 이전 사용자 알림을 띄우지 않는다.
        if (cancelled) return;
        lastCheckRef.current = nextSince;
        for (const m of matches) {
          if (seenAlertIds.current.has(m.id)) continue;
          seenAlertIds.current.add(m.id);
          showToast(`'${m.keyword}' 키워드의 새 글이 올라왔어요!`, 'keyword');
        }
        // 메모리 누수 방지: seen 집합이 너무 커지면 최근 항목만 남긴다.
        if (seenAlertIds.current.size > 500) {
          seenAlertIds.current = new Set([...seenAlertIds.current].slice(-200));
        }
      } catch (err) {
        console.error('키워드 폴링 실패:', err);
      }
    };

    // 키워드 갱신 + 폴링을 묶되, 이전 실행이 끝나기 전엔 새로 시작하지 않는다.
    // 탭이 숨겨져 있으면 건너뛴다 — 안 보는 화면 때문에 1분마다 쿼리가 나가던 것을 막는다.
    const tick = async () => {
      if (cancelled || polling) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      polling = true;
      try {
        await loadKeywords();
        await poll();
      } finally {
        polling = false;
      }
    };

    // 탭으로 돌아오면 다음 tick(최대 1분)을 기다리지 않고 즉시 한 번 갱신한다.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    (async () => {
      await loadKeywords();
      if (cancelled) return;
      timerId = setInterval(tick, 60000);
    })();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (timerId) clearInterval(timerId);
    };
  }, [isLoggedIn, user?.id]);

  return (
    <Router>
      <AppSplash />
      <ProfileCompleteGate />
      <RouteResetGuard />
      <AnalyticsTracker />
      <div className="App">
        <Navbar />
        <main>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route
                path="/"
                element={
                  <Home
                    activeCategory={activeCategory}
                    setActiveCategory={setActiveCategory}
                  />
                }
              />
              <Route path="/signup" element={<Signup />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/signup/email" element={<SignupEmail />} />
              <Route path="/signup/complete" element={<SignupComplete />} />
              <Route path="/companion" element={<CompanionBoard />} />
              <Route path="/companion/:regionId" element={<RegionalBoard />} />
              <Route path="/qna" element={<div className="py-20"><TravelQnA /></div>} />
              <Route path="/market" element={<div className="py-20"><MarketBoard /></div>} />
              <Route path="/crew" element={<div className="py-20"><CrewOnly /></div>} />
              <Route path="/search" element={<Search />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/recommend" element={<div className="py-20"><Destinations /></div>} />
              <Route path="/recommend/:regionId" element={<div className="py-20"><Destinations /></div>} />
              <Route path="/reviews" element={<div className="py-20"><Promotions /></div>} />
              <Route path="/reviews/:regionId" element={<div className="py-20"><Promotions /></div>} />
              <Route
                path="/mypage"
                element={
                  <div className="py-20">
                    <MyPage />
                  </div>
                }
              />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              {PAYTEST && <Route path="/__paytest" element={<PayTest />} />}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>
        <Footer />

        {/* Push Notification Permission Banner */}
        <PushPermission />

        {/* Global Toast Notifications */}
        <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 max-w-sm w-full sm:w-80">
          <AnimatePresence>
            {toasts.map(toast => (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, x: 50, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20, scale: 0.9 }}
                className={`p-4 rounded-2xl shadow-2xl border flex items-start gap-3 ${toast.type === 'keyword'
                    ? 'bg-blue-600 text-white border-blue-400'
                    : 'bg-white text-gray-800 border-gray-100'
                  }`}
              >
                <div className={`p-2 rounded-xl ${toast.type === 'keyword' ? 'bg-white/20' : 'bg-blue-100 text-blue-600'}`}>
                  <Bell size={18} aria-hidden="true" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold leading-tight">{toast.message}</p>
                </div>
                <button
                  onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                  className="opacity-60 hover:opacity-100 transition-opacity"
                  aria-label="알림 닫기"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </Router>
  );
}

export default App;

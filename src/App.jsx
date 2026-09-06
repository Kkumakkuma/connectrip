import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import PayTest from './pages/PayTest'; // 빌드플래그 false 시 트리셰이킹으로 프로덕션 번들에서 제거됨
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from './lib/AuthContext';
import { PAYMENTS_ENABLED, PLANNER_ENABLED, ITINERARY_ENABLED, PROMO_REVIEWS_ENABLED } from './lib/featureFlags';
import RequireLogin from './components/RequireLogin';
import { keywordsApi, keywordAlertsApi, notificationPrefsApi } from './lib/db';
import { supabase } from './lib/supabase';
import Navbar from './components/Navbar';
import CrewRenewalBanner from './components/CrewRenewalBanner';
import Home from './pages/Home';
import ProfileCompleteGate from './components/ProfileCompleteGate';
import RouteResetGuard from './components/RouteResetGuard';
import AnalyticsTracker from './components/AnalyticsTracker';
import Footer from './components/Footer';
import AppSplash from './components/AppSplash'; // 앱 오프닝 모션(웹 no-op)
import { isNativeApp } from './lib/native';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, Loader2 } from 'lucide-react';

// 코드 스플리팅: 첫 화면(Home)·Navbar·Footer·가드는 정적 유지하고,
// 나머지 라우트 컴포넌트는 React.lazy 로 분리해 초기 번들 크기를 줄인다.
const Signup = lazy(() => import('./pages/Signup'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const FindLoginId = lazy(() => import('./pages/FindLoginId'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const SignupEmail = lazy(() => import('./pages/SignupEmail'));
const SignupComplete = lazy(() => import('./pages/SignupComplete'));
const Destinations = lazy(() => import('./components/Destinations'));
const TravelQnA = lazy(() => import('./components/TravelQnA'));
const MarketBoard = lazy(() => import('./components/MarketBoard'));
const MarketDetail = lazy(() => import('./pages/MarketDetail'));
const ChatList = lazy(() => import('./pages/ChatList'));
const ChatRoom = lazy(() => import('./pages/ChatRoom'));
const Messages = lazy(() => import('./pages/Messages'));
const CrewOnly = lazy(() => import('./components/CrewOnly'));
// 여행상품 홍보 및 후기 — 초창기라 숨김(2026-09-06 쿠마님). 플래그가 꺼지면 청크도 만들지 않는다(PLANNER 와 같은 방식).
const Promotions = PROMO_REVIEWS_ENABLED ? lazy(() => import('./components/Promotions')) : null;
const CompanionBoard = lazy(() => import('./components/CompanionBoard'));
const RegionalBoard = lazy(() => import('./components/RegionalBoard'));
// 여행 일정 게시판. 플래너와 달리 앱에도 실린다(앱은 게시판 + 가져오기만 갖는다).
const ItineraryBoard = lazy(() => import('./components/ItineraryBoard'));
const ItineraryPost = lazy(() => import('./components/ItineraryPost'));
const MyPage = lazy(() => import('./components/MyPage'));
const Search = lazy(() => import('./pages/Search'));
const Admin = lazy(() => import('./pages/Admin'));
const Terms = lazy(() => import('./pages/Terms'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Points = lazy(() => import('./pages/Points'));
const NotFound = lazy(() => import('./pages/NotFound'));
// 결제 테스트 라우트는 빌드플래그(VITE_PAYTEST=1)가 있을 때만 존재.
// ★정적 import 로 두어야 프로덕션(플래그 없음)에서 Rollup 이 트리셰이킹으로 통째로 제거한다.
//   lazy(()=>import) 는 항상 별도 청크를 생성해 프로덕션 dist 에 남으므로 쓰지 않는다.
const PAYTEST = PAYMENTS_ENABLED && import.meta.env.VITE_PAYTEST === '1';

// 여행 플래너 진입점.
// ★lazy() 호출식 자체가 삼항 안에 있어야 Vite 가 import.meta.env 를 상수로 접고
//   dynamic import 를 통째로 지운다. `{PLANNER_ENABLED && <Route …/>}` 로 라우트만 가리는
//   형태는 플래그가 꺼져 있어도 청크를 dist 에 남긴다(Points 선례 = featureFlags.js 말미 주석).
//   실제로 어떤 모듈이 붙는지는 vite.config.js 의 '@planner' alias 가 빌드 시점에 고른다.
const PlannerRoutes = PLANNER_ENABLED ? lazy(() => import('@planner')) : null;

// 플래너는 자체 하단 액션바를 쓰므로 커넥트립 Footer 를 겹쳐 놓지 않는다.
// useLocation 은 Router 안에서만 쓸 수 있어 별도 컴포넌트로 감싼다.
const ShellFooter = () => {
  const { pathname } = useLocation();
  if (PLANNER_ENABLED && (pathname === '/planner' || pathname.startsWith('/planner/'))) return null;
  return <Footer />;
};

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
    // 알림 설정에서 키워드 알림을 끄면 폴링 자체를 하지 않는다.
    // (설정을 켰다 껐다 한 결과는 다음 새로고침/로그인부터 반영된다 — 구조를 단순하게 유지)
    let keywordAlertsOn = true;

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
          // 종 아이콘 알림함에도 남긴다. 중복은 서버(유니크 인덱스)가 막고,
          // 실패해도 토스트는 이미 떴으므로 로그만 남기고 폴링을 계속한다.
          supabase
            .rpc('add_keyword_notification', {
              p_post_id: m.postId,
              p_post_type: m.postType,
              p_keyword: m.keyword,
            })
            .then(({ error }) => {
              if (error) console.error('키워드 알림 저장 실패:', error);
            }, (err) => console.error('키워드 알림 저장 실패:', err));
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
      if (cancelled || polling || !keywordAlertsOn) return;
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

    (async () => {
      try {
        const prefs = await notificationPrefsApi.get(user.id);
        if (cancelled) return;
        keywordAlertsOn = prefs.keywords !== false;
      } catch (err) {
        // 설정을 못 읽으면 기본값(켬)으로 동작한다
        console.error('알림 설정 로딩 실패(폴링):', err);
      }
      if (cancelled || !keywordAlertsOn) return;
      await loadKeywords();
      if (cancelled) return;
      // 리스너는 설정 확인이 끝난 뒤 등록한다 — 확인 전에 탭이 활성화되면
      // 꺼둔 사용자에게도 폴링이 한 번 나가기 때문이다.
      document.addEventListener('visibilitychange', onVisible);
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
        {/* 승무원 인증 만료 임박·만료 안내(해당자에게만 렌더). 없으면 요소 자체가 없어 기존 레이아웃 그대로다. */}
        <CrewRenewalBanner />
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
              <Route path="/find-id" element={<FindLoginId />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/signup/email" element={<SignupEmail />} />
              <Route path="/signup/complete" element={<SignupComplete />} />
              <Route path="/companion" element={<RequireLogin><CompanionBoard /></RequireLogin>} />
              <Route path="/companion/:regionId" element={<RequireLogin><RegionalBoard /></RequireLogin>} />
              {ITINERARY_ENABLED && (
                <Route path="/itinerary" element={<RequireLogin><ItineraryBoard /></RequireLogin>} />
              )}
              {ITINERARY_ENABLED && (
                <Route path="/itinerary/:postId" element={<RequireLogin><ItineraryPost /></RequireLogin>} />
              )}
              <Route path="/qna" element={<RequireLogin><div className="py-20"><TravelQnA /></div></RequireLogin>} />
              <Route path="/market" element={<RequireLogin><div className="py-20"><MarketBoard /></div></RequireLogin>} />
              <Route path="/market/:id" element={<RequireLogin><MarketDetail /></RequireLogin>} />
              <Route path="/chat" element={<RequireLogin><ChatList /></RequireLogin>} />
              <Route path="/chat/:roomId" element={<RequireLogin><ChatRoom /></RequireLogin>} />
              <Route path="/messages" element={<RequireLogin><Messages /></RequireLogin>} />
              <Route path="/crew" element={<RequireLogin><div className="py-20"><CrewOnly /></div></RequireLogin>} />
              <Route path="/search" element={<RequireLogin><Search /></RequireLogin>} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/recommend" element={<RequireLogin><div className="py-20"><Destinations /></div></RequireLogin>} />
              <Route path="/recommend/:regionId" element={<RequireLogin><div className="py-20"><Destinations /></div></RequireLogin>} />
              {PROMO_REVIEWS_ENABLED && (
                <Route path="/reviews" element={<RequireLogin><div className="py-20"><Promotions /></div></RequireLogin>} />
              )}
              {PROMO_REVIEWS_ENABLED && (
                <Route path="/reviews/:regionId" element={<RequireLogin><div className="py-20"><Promotions /></div></RequireLogin>} />
              )}
              {/* 숨김 동안 옛 링크·알림의 /reviews 는 같은 reviews 테이블을 보여 주는 여행 후기 탭으로 보낸다(NotFound 대신) */}
              {!PROMO_REVIEWS_ENABLED && <Route path="/reviews/*" element={<Navigate to="/qna?tab=review" replace />} />}
              <Route
                path="/mypage"
                element={
                  <RequireLogin>
                    <div className="py-20">
                      <MyPage />
                    </div>
                  </RequireLogin>
                }
              />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/points" element={PAYMENTS_ENABLED ? <Points /> : <NotFound />} />
              {PLANNER_ENABLED && PlannerRoutes && (
                <Route path="/planner/*" element={<PlannerRoutes />} />
              )}
              {PAYTEST && <Route path="/__paytest" element={<PayTest />} />}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>
        <ShellFooter />

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

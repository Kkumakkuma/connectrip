import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';

// 로그인해야 볼 수 있는 화면을 감싼다 (쿠마님 지시 2026-09-04).
//
// "안내 카드를 띄우고 기다린다"가 아니라 **바로 로그인 화면으로 보낸다.** 회원 콘텐츠를
// 비회원에게 미리 보여 주면 가입할 이유가 없어진다는 게 이 결정의 이유다.
//
// 돌아올 자리는 next 로 넘긴다. safeNext 가 우리 사이트 안 경로만 통과시키므로
// 열린 리다이렉트가 되지 않고, 로그인·가입을 마치면 보던 화면으로 되돌아온다.
//
// 세션을 아직 확인하는 중(loading)에는 아무것도 하지 않는다 — 여기서 성급히 튕기면
// 새로고침할 때마다 로그인 화면이 번쩍인다.
export default function RequireLogin({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (user) return children;

  const next = `${location.pathname}${location.search}`;
  return <Navigate to={`/signup?mode=login&next=${encodeURIComponent(next)}`} replace />;
}

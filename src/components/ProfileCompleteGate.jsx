import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { safeNext, rememberNext, nextQuery } from '../lib/safeNext';

// 로그인됐는데 profile_completed=false 인 유저를 /signup/complete 로 강제 이동.
// 단 이미 해당 페이지 위에 있거나, 관리자 페이지면 리다이렉트 안 함.
// /reset-password: 복구 링크 세션은 로그인 상태라 게이트에 걸리면 비밀번호를 못 바꾸고
// /signup/complete 로 튕김(codex 지적) — 재설정 흐름 2경로는 예외
const EXEMPT_PATHS = ['/signup/complete', '/admin', '/reset-password', '/forgot-password'];

// 이 게이트를 지나는 순간 URL 의 next 가 한 번 끊긴다(신규 가입 → 확인 메일 → 프로필 완성 경로).
// 아래 접두사로 들어온 경우에는 완성 직후 원래 화면으로 되돌린다.
// 목록에 없는 경로는 종전대로 완성 후 홈으로 간다 — 기존 화면 동작을 바꾸지 않기 위해서다.
const RETURN_PREFIXES = ['/planner'];

const isReturnPath = (pathname) =>
  RETURN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export default function ProfileCompleteGate() {
  const { isLoggedIn, profile, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!isLoggedIn) return;
    if (!profile) return; // 아직 프로필 로드 안 됨
    if (profile.profile_completed) return;
    if (EXEMPT_PATHS.some((p) => location.pathname.startsWith(p))) return;

    // 현재 URL 이 들고 온 next 를 우선하고, 없으면 플래너 경로 자신을 복귀 대상으로 삼는다.
    const fromQuery = safeNext(new URLSearchParams(location.search).get('next'));
    const carried = fromQuery
      || (isReturnPath(location.pathname) ? safeNext(location.pathname + location.search) : null);
    rememberNext(carried); // 값이 없으면 아무것도 쓰지 않는다(앞서 보관된 값을 지우지 않음)
    navigate(`/signup/complete${nextQuery(carried, { first: true })}`, { replace: true });
  }, [isLoggedIn, profile, loading, location.pathname, location.search, navigate]);

  return null;
}

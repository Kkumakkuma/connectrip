import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';

// 로그인됐는데 profile_completed=false 인 유저를 /signup/complete 로 강제 이동.
// 단 이미 해당 페이지 위에 있거나, 관리자 페이지면 리다이렉트 안 함.
// /reset-password: 복구 링크 세션은 로그인 상태라 게이트에 걸리면 비밀번호를 못 바꾸고
// /signup/complete 로 튕김(codex 지적) — 재설정 흐름 2경로는 예외
const EXEMPT_PATHS = ['/signup/complete', '/admin', '/reset-password', '/forgot-password'];

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
    navigate('/signup/complete', { replace: true });
  }, [isLoggedIn, profile, loading, location.pathname, navigate]);

  return null;
}

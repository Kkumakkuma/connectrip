import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';

// 로그인됐는데 profile_completed=false 인 유저를 /signup/complete 로 강제 이동.
// 단 이미 해당 페이지 위에 있거나, 관리자 페이지면 리다이렉트 안 함.
const EXEMPT_PATHS = ['/signup/complete', '/admin'];

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

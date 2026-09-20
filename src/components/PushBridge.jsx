import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { isNativeApp } from '../lib/native';
import { listenPushTap, registerPushForUser } from '../lib/push';

// 앱 푸시 브리지 (네이티브 전용, 화면 없음). Router 안에 두는 이유 = 푸시를 탭했을 때 navigate 로 그 화면을 연다.
// 로그인·세션 복원으로 user 가 정해지면 이 기기의 FCM 토큰을 서버에 등록한다(src/lib/push.js). 웹에서는 아무것도 하지 않는다.
export default function PushBridge() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id || null;

  useEffect(() => {
    if (!isNativeApp() || !userId) return;
    registerPushForUser();
  }, [userId]);

  useEffect(() => {
    if (!isNativeApp()) return undefined;
    let cancelled = false;
    let cleanup = null;
    listenPushTap(navigate)
      .then((c) => {
        if (cancelled) c();   // 등록 완료 전에 언마운트된 경우 즉시 정리
        else cleanup = c;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, [navigate]);

  return null;
}

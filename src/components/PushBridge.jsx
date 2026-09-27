import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { isNativeApp } from '../lib/native';
import { listenPushTap, listenTokenRefresh, refreshPushOnResume, registerPushForUser } from '../lib/push';

// 앱 푸시 브리지 (네이티브 전용, 화면 없음). Router 안에 두는 이유 = 푸시를 탭했을 때 navigate 로 그 화면을 연다.
// 로그인·세션 복원으로 user 가 정해지면 이 기기의 FCM 토큰을 서버에 등록한다(src/lib/push.js). 웹에서는 아무것도 하지 않는다.
// 로그인해 있는 동안은 FCM 토큰이 바뀌는 것도 받아서 올리고(listenTokenRefresh), 앱으로 돌아올 때
// 첫 등록 실패·설정에서 나중에 알림 허용한 경우를 조용히 다시 등록한다(refreshPushOnResume, 권한은 묻지 않음 — codex 검토).
export default function PushBridge() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id || null;

  useEffect(() => {
    if (!isNativeApp() || !userId) return undefined;
    registerPushForUser({ sessionStart: true });   // 로그인(세션 복원 포함) 시작 — 로그아웃 표시를 푼다
    let cancelled = false;
    let offRefresh = null;
    let offResume = null;
    listenTokenRefresh()
      .then((c) => {
        if (cancelled) c();
        else offRefresh = c;
      })
      .catch(() => {});
    import('@capacitor/app')
      .then(({ App }) => App.addListener('resume', () => { refreshPushOnResume().catch(() => {}); }))
      .then((h) => {
        if (cancelled) Promise.resolve(h.remove()).catch(() => {});
        else offResume = h;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (offRefresh) offRefresh();
      if (offResume) Promise.resolve(offResume.remove()).catch(() => {});
    };
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

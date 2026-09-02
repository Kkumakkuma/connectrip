import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { requestPermission, subscribeToPush, isNotificationDecided } from '../lib/pushNotifications';

const ASK_KEY = 'push_permission_dismissed'; // 값: 마지막으로 물어본 시각(ms). 구 버전 'true' 도 닫음으로 인정.
const SNOOZE_MS = 30 * 24 * 60 * 60_000;
function shouldAskAgain() {
  try {
    const v = localStorage.getItem(ASK_KEY);
    if (!v) return true;
    if (v === 'true') return false; // 구 버전 기록: 다시 묻지 않음
    return Date.now() - Number(v) > SNOOZE_MS;
  } catch { return true; }
}
function markAsked() {
  try { localStorage.setItem(ASK_KEY, String(Date.now())); } catch { /* noop */ }
}

const PushPermission = () => {
  const { user, isLoggedIn } = useAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isLoggedIn || !user) return;
    if (!('Notification' in window)) return;

    // Don't show if already decided (granted or denied)
    if (isNotificationDecided()) return;

    // 닫음/나중에/허용(브라우저 프롬프트를 닫아 미결정으로 남은 경우 포함) 뒤에는 30일간 다시 묻지 않는다.
    // 2026-09-03: 허용을 눌렀다가 브라우저 프롬프트를 닫으면 기록이 없어 페이지마다 재등장하던 문제(쿠마님 지적) 수정.
    if (!shouldAskAgain()) return;
    // 같은 세션(탭)에서는 한 번만
    try { if (sessionStorage.getItem('push_permission_seen')) return; sessionStorage.setItem('push_permission_seen', '1'); } catch { /* noop */ }

    // Show after a short delay
    const timer = setTimeout(() => setVisible(true), 3000);
    return () => clearTimeout(timer);
  }, [isLoggedIn, user]);

  const handleAllow = async () => {
    markAsked();
    setVisible(false);
    const permission = await requestPermission();
    if (permission === 'granted' && user) {
      await subscribeToPush(user.id);
    }
  };

  const handleDismiss = () => {
    markAsked();
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[9998] w-[90%] max-w-sm"
        >
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-100 rounded-xl text-blue-600 shrink-0">
                <Bell size={22} />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-gray-900 text-sm mb-1">알림을 받으시겠습니까?</h4>
                <p className="text-xs text-gray-500 leading-relaxed">
                  새 동행 모집, 키워드 알림 등 중요한 소식을 바로 받아보세요.
                </p>
              </div>
              <button
                onClick={handleDismiss}
                className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleDismiss}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
              >
                나중에
              </button>
              <button
                onClick={handleAllow}
                className="flex-1 px-4 py-2 text-sm font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
              >
                허용
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default PushPermission;

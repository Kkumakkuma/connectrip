import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Settings, ArrowLeft, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../lib/AuthContext';
import { notificationsApi, notificationPrefsApi } from '../lib/db';

const timeAgo = (dateStr) => {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = Math.floor((now - date) / 1000);

  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}일 전`;
  return date.toLocaleDateString('ko-KR');
};

// 설정 화면의 토글 5개.
const PREF_ROWS = [
  { key: 'comments', label: '댓글·답변' },
  { key: 'commendation', label: '칭찬매칭' },
  { key: 'flight', label: '같은 편 게시판', desc: '내 항공편 게시판에 새로 등록한 사람' },
  { key: 'companion', label: '동행 모집', desc: '내가 글을 올린 지역의 새 동행 글' },
  { key: 'keywords', label: '키워드 알림', desc: '등록한 키워드가 포함된 새 글' },
];

const NotificationBell = () => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState('list');       // 'list' | 'settings'
  const [prefs, setPrefs] = useState(null);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsError, setPrefsError] = useState('');
  const navigate = useNavigate();
  const dropdownRef = useRef(null);
  // 계정 전환 대비: 늦게 끝난 이전 사용자의 응답을 화면에 쓰지 않기 위한 기준값
  const activeUserRef = useRef(null);
  // 토글을 빠르게 연속으로 누를 때 직전 클릭의 결과를 잃지 않도록 최신 설정을 동기 보관
  const prefsRef = useRef(null);

  const userId = user?.id;

  const refreshUnread = useCallback(async () => {
    if (!userId) return;
    try {
      const count = await notificationsApi.getUnreadCount(userId);
      if (activeUserRef.current !== userId) return;
      setUnreadCount(count);
    } catch (err) {
      console.error('읽지 않은 알림 수 조회 실패:', err);
    }
  }, [userId]);

  const refreshList = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await notificationsApi.getMy(userId);
      if (activeUserRef.current !== userId) return;
      setNotifications(data || []);
    } catch (err) {
      console.error('알림 로딩 실패:', err);
    }
  }, [userId]);

  // 배지 숫자만 60초 폴링한다.
  // realtime 구독은 쓰지 않는다 — 이 프로젝트에서 unsubscribe 시
  // "Maximum call stack exceeded" + auth 상태 오염 사고가 있었다(App.jsx 키워드 폴링과 같은 이유).
  useEffect(() => {
    // 로그아웃뿐 아니라 계정 전환(A→B)에서도 이전 사용자의 목록·배지·설정이 남지 않게
    // userId 가 바뀔 때마다 무조건 초기화한다.
    activeUserRef.current = userId;
    prefsRef.current = null;
    setNotifications([]);
    setUnreadCount(0);
    setPrefs(null);
    setPrefsError('');
    setView('list');
    if (!userId) {
      setIsOpen(false);
      return undefined;
    }

    refreshUnread();

    const tick = () => {
      // 안 보는 화면 때문에 1분마다 쿼리가 나가지 않게 한다
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      refreshUnread();
    };
    const timerId = setInterval(tick, 60000);

    // 탭으로 돌아오면 다음 tick 을 기다리지 않고 즉시 한 번 갱신
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshUnread();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timerId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, refreshUnread]);

  // 바깥 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggleOpen = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      setView('list');
      refreshList();
      refreshUnread();
    }
  };

  // 실패 시 되돌리기는 "건드린 항목만" 고치고 숫자는 서버에서 다시 읽는다.
  // 목록 전체 스냅샷을 되돌리면 그사이 성공한 다른 작업까지 취소된다.
  const handleOpenItem = async (n) => {
    if (!n.read_at) {
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await notificationsApi.markRead(n.id);
      } catch (err) {
        console.error('알림 읽음 처리 실패:', err);
        setNotifications((prev) =>
          prev.map((x) => (x.id === n.id ? { ...x, read_at: null } : x))
        );
        refreshUnread();
      }
    }
    navigate(n.link || '/mypage');
    setIsOpen(false);
  };

  const handleRemove = async (n) => {
    const index = notifications.findIndex((x) => x.id === n.id);
    setNotifications((prev) => prev.filter((x) => x.id !== n.id));
    if (!n.read_at) setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await notificationsApi.remove(n.id);
    } catch (err) {
      console.error('알림 삭제 실패:', err);
      // 지웠던 항목만 원래 자리에 되돌린다
      setNotifications((prev) => {
        if (prev.some((x) => x.id === n.id)) return prev;
        const next = [...prev];
        next.splice(index < 0 ? next.length : index, 0, n);
        return next;
      });
      if (!n.read_at) refreshUnread();
    }
  };

  const handleMarkAllRead = async () => {
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    setUnreadCount(0);
    try {
      await notificationsApi.markAllRead();
    } catch (err) {
      console.error('모두 읽음 처리 실패:', err);
      // 어디까지 처리됐는지 알 수 없으므로 서버 상태로 다시 맞춘다
      refreshList();
      refreshUnread();
    }
  };

  const handleOpenSettings = async () => {
    setView('settings');
    setPrefsError('');
    if (prefs || !userId) return;
    setPrefsLoading(true);
    try {
      const loaded = await notificationPrefsApi.get(userId);
      if (activeUserRef.current !== userId) return;
      prefsRef.current = loaded;
      setPrefs(loaded);
    } catch (err) {
      console.error('알림 설정 로딩 실패:', err);
      if (activeUserRef.current === userId) setPrefsError('설정을 불러오지 못했습니다.');
    } finally {
      if (activeUserRef.current === userId) setPrefsLoading(false);
    }
  };

  const handleTogglePref = async (key) => {
    const current = prefsRef.current;
    if (!userId || !current) return;
    const wasOn = current[key] !== false;
    // 직전 클릭이 아직 저장 중이어도 그 결과 위에 쌓이도록 ref 기준으로 계산한다
    const next = { ...current, [key]: !wasOn };
    prefsRef.current = next;
    setPrefs(next);
    setPrefsError('');
    try {
      await notificationPrefsApi.upsert(userId, next);
    } catch (err) {
      console.error('알림 설정 저장 실패:', err);
      if (activeUserRef.current !== userId) return;
      // 실패한 스위치 하나만 되돌린다 (다른 스위치의 성공을 취소하지 않게)
      prefsRef.current = prefsRef.current ? { ...prefsRef.current, [key]: wasOn } : null;
      setPrefs((p) => (p ? { ...p, [key]: wasOn } : p));
      setPrefsError('설정을 저장하지 못했습니다.');
    }
  };

  if (!user) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleToggleOpen}
        className="p-2.5 rounded-full transition-all relative text-gray-600 hover:bg-gray-100"
        title="알림"
        aria-label={unreadCount > 0 ? `알림 ${unreadCount}개 읽지 않음` : '알림'}
        aria-expanded={isOpen}
      >
        <Bell size={22} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[20px] h-5 flex items-center justify-center bg-red-500 text-white text-[11px] font-bold rounded-full px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed sm:absolute right-2 sm:right-0 left-2 sm:left-auto top-16 sm:top-full sm:mt-2 w-auto sm:w-80 max-w-[calc(100vw-16px)] bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50"
          >
            {view === 'list' ? (
              <>
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h4 className="font-bold text-gray-900">알림</h4>
                    {unreadCount > 0 && (
                      <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-bold">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={handleMarkAllRead}
                        className="text-xs text-gray-500 hover:text-blue-600 px-1.5 py-1 rounded"
                      >
                        모두 읽음
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleOpenSettings}
                      className="p-1.5 rounded-full text-gray-500 hover:bg-gray-100 hover:text-blue-600"
                      aria-label="알림 설정"
                      title="알림 설정"
                    >
                      <Settings size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="py-10 text-center">
                      <Bell size={32} className="mx-auto text-gray-300 mb-2" aria-hidden="true" />
                      <p className="text-gray-400 text-sm">받은 알림이 없습니다</p>
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`flex items-start border-b border-gray-50 ${!n.read_at ? 'bg-blue-50/50' : ''}`}
                      >
                        <button
                          type="button"
                          onClick={() => handleOpenItem(n)}
                          className="flex-1 min-w-0 text-left pl-4 pr-1 py-3 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-start gap-3">
                            <span
                              className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${!n.read_at ? 'bg-blue-500' : 'bg-transparent'}`}
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <p
                                className={`text-sm leading-relaxed break-words ${!n.read_at ? 'font-bold text-gray-900' : 'text-gray-600'}`}
                              >
                                {n.message}
                              </p>
                              <p className="text-xs text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(n)}
                          className="mt-2.5 mr-2 p-1.5 rounded-full text-gray-300 hover:text-gray-600 hover:bg-gray-100 flex-shrink-0"
                          aria-label="알림 삭제"
                          title="삭제"
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setView('list')}
                    className="p-1 -ml-1 rounded-full text-gray-500 hover:bg-gray-100"
                    aria-label="알림 목록으로"
                    title="뒤로"
                  >
                    <ArrowLeft size={18} aria-hidden="true" />
                  </button>
                  <h4 className="font-bold text-gray-900">알림 설정</h4>
                </div>

                <div className="max-h-80 overflow-y-auto px-4 py-2">
                  {prefsLoading || !prefs ? (
                    <p className="py-8 text-center text-sm text-gray-400">
                      {prefsError || '불러오는 중입니다'}
                    </p>
                  ) : (
                    <>
                      {PREF_ROWS.map((row) => {
                        const on = prefs[row.key] !== false;
                        return (
                          <div
                            key={row.key}
                            className="flex items-center justify-between gap-3 py-2.5 border-b border-gray-50 last:border-b-0"
                          >
                            <div className="min-w-0">
                              <p className="text-sm text-gray-800">{row.label}</p>
                              {row.desc && (
                                <p className="text-xs text-gray-400 mt-0.5">{row.desc}</p>
                              )}
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={on}
                              aria-label={row.label}
                              onClick={() => handleTogglePref(row.key)}
                              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-blue-600' : 'bg-gray-300'}`}
                            >
                              <span
                                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-5' : ''}`}
                              />
                            </button>
                          </div>
                        );
                      })}

                      {prefsError && (
                        <p className="text-xs text-red-500 pt-2">{prefsError}</p>
                      )}

                      <div className="pt-2 pb-3">
                        <button
                          type="button"
                          onClick={() => {
                            setIsOpen(false);
                            navigate('/mypage?tab=keywords');
                          }}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          키워드 관리 →
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default NotificationBell;

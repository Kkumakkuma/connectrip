import { useState, useEffect } from 'react';
import { Bell, BellOff, MessageSquare, ShoppingBag, Users, Plane, Heart, Star } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { requestPermission, isNotificationGranted } from '../lib/pushNotifications';

const NOTIFICATION_CATEGORIES = [
  { id: 'companion', label: '동행 모집', desc: '새로운 동행 모집 글이 올라왔을 때', icon: Users, color: 'blue' },
  { id: 'qna', label: 'Q&A 게시판', desc: '새로운 질문이나 답변이 올라왔을 때', icon: MessageSquare, color: 'green' },
  { id: 'market', label: '장터', desc: '새로운 물품이 등록되었을 때', icon: ShoppingBag, color: 'orange' },
  { id: 'reviews', label: '여행후기/홍보', desc: '새로운 후기나 홍보글이 올라왔을 때', icon: Star, color: 'purple' },
  { id: 'flight', label: '항공편 매칭', desc: '같은 편 동행이 발견되었을 때', icon: Plane, color: 'sky' },
  { id: 'commendation', label: '칭송매칭', desc: '칭송매칭 관련 알림', icon: Heart, color: 'pink' },
  { id: 'keywords', label: '키워드 알림', desc: '등록한 키워드가 포함된 글이 올라왔을 때', icon: Bell, color: 'yellow' },
];

const COLOR_MAP = {
  blue: { bg: 'bg-blue-50', icon: 'text-blue-600', toggle: 'bg-blue-600' },
  green: { bg: 'bg-green-50', icon: 'text-green-600', toggle: 'bg-green-600' },
  orange: { bg: 'bg-orange-50', icon: 'text-orange-600', toggle: 'bg-orange-600' },
  purple: { bg: 'bg-purple-50', icon: 'text-purple-600', toggle: 'bg-purple-600' },
  sky: { bg: 'bg-sky-50', icon: 'text-sky-600', toggle: 'bg-sky-600' },
  pink: { bg: 'bg-pink-50', icon: 'text-pink-600', toggle: 'bg-pink-600' },
  yellow: { bg: 'bg-yellow-50', icon: 'text-yellow-600', toggle: 'bg-yellow-600' },
};

const STORAGE_KEY = 'notification_preferences';

const NotificationSettings = () => {
  const { user } = useAuth();
  const [pushEnabled, setPushEnabled] = useState(isNotificationGranted());
  const [preferences, setPreferences] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
    const defaults = {};
    NOTIFICATION_CATEGORIES.forEach(c => { defaults[c.id] = true; });
    return defaults;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  const handleToggle = (id) => {
    setPreferences(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleToggleAll = (value) => {
    const updated = {};
    NOTIFICATION_CATEGORIES.forEach(c => { updated[c.id] = value; });
    setPreferences(updated);
  };

  const handleEnablePush = async () => {
    if (!pushEnabled) {
      const granted = await requestPermission();
      setPushEnabled(granted);
    }
  };

  const enabledCount = Object.values(preferences).filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* Push Permission Status */}
      <div className={`rounded-xl p-4 flex items-center justify-between ${pushEnabled ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
        <div className="flex items-center gap-3">
          {pushEnabled ? <Bell size={20} className="text-green-600" /> : <BellOff size={20} className="text-red-500" />}
          <div>
            <p className="font-semibold text-sm">{pushEnabled ? '푸시 알림 활성화됨' : '푸시 알림 꺼짐'}</p>
            <p className="text-xs text-gray-500">{pushEnabled ? '브라우저 알림을 받고 있습니다' : '알림을 받으려면 활성화하세요'}</p>
          </div>
        </div>
        {!pushEnabled && (
          <button
            onClick={handleEnablePush}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            활성화
          </button>
        )}
      </div>

      {/* Toggle All */}
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-gray-500">
          {enabledCount}/{NOTIFICATION_CATEGORIES.length}개 카테고리 알림 켜짐
        </p>
        <div className="flex gap-2">
          <button onClick={() => handleToggleAll(true)} className="text-xs text-blue-600 hover:underline">전체 켜기</button>
          <span className="text-gray-300">|</span>
          <button onClick={() => handleToggleAll(false)} className="text-xs text-gray-400 hover:underline">전체 끄기</button>
        </div>
      </div>

      {/* Category Toggles */}
      <div className="space-y-2">
        {NOTIFICATION_CATEGORIES.map(cat => {
          const Icon = cat.icon;
          const colors = COLOR_MAP[cat.color];
          const enabled = preferences[cat.id];

          return (
            <div
              key={cat.id}
              className={`rounded-xl p-3.5 flex items-center justify-between transition-all ${enabled ? colors.bg : 'bg-gray-50'}`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${enabled ? colors.bg : 'bg-gray-100'}`}>
                  <Icon size={18} className={enabled ? colors.icon : 'text-gray-400'} />
                </div>
                <div>
                  <p className={`text-sm font-semibold ${enabled ? 'text-gray-800' : 'text-gray-400'}`}>{cat.label}</p>
                  <p className={`text-xs ${enabled ? 'text-gray-500' : 'text-gray-400'}`}>{cat.desc}</p>
                </div>
              </div>
              <button
                onClick={() => handleToggle(cat.id)}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${enabled ? colors.toggle : 'bg-gray-300'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default NotificationSettings;

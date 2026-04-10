import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Plane, Calendar, Send, MessageCircle, X, ChevronDown, ChevronUp, Inbox, Eye, EyeOff
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { flightApi, flightCompanionsApi, messagesApi } from '../lib/db';

const FlightCompanions = ({ flights: propFlights = [], onFlightsChange }) => {
  const { user, isLoggedIn, isCrew } = useAuth();

  const [myFlights, setMyFlights] = useState([]);
  const [companions, setCompanions] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedFlight, setExpandedFlight] = useState(null);

  // Messaging
  const [showMessageModal, setShowMessageModal] = useState(null); // { receiverId, receiverName, flightNumber }
  const [messageContent, setMessageContent] = useState('');
  const [sending, setSending] = useState(false);

  // Inbox
  const [showInbox, setShowInbox] = useState(false);
  const [myMessages, setMyMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyTo, setReplyTo] = useState(null); // { senderId, senderName }
  const [replyContent, setReplyContent] = useState('');

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Use flights from props, filter within 21 days
      const now = new Date();
      const cutoff = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);
      const upcomingFlights = (propFlights || []).filter((f) => {
        const fDate = new Date(f.flight_date);
        return fDate >= now && fDate <= cutoff;
      });
      setMyFlights(upcomingFlights);

      // Fetch companions for each upcoming flight (only if user's flight is public)
      const companionData = {};
      for (const flight of upcomingFlights) {
        try {
          if (flight.is_public) {
            const result = await flightCompanionsApi.getCompanions(
              flight.flight_number, flight.flight_date, user.id
            );
            companionData[`${flight.flight_number}_${flight.flight_date}`] = result || [];
          } else {
            companionData[`${flight.flight_number}_${flight.flight_date}`] = [];
          }
        } catch (err) {
          companionData[`${flight.flight_number}_${flight.flight_date}`] = [];
        }
      }
      setCompanions(companionData);
    } catch (err) {
      console.error('동행 데이터 로드 실패:', err);
    } finally {
      setLoading(false);
    }
  }, [user, propFlights]);

  useEffect(() => {
    if (isLoggedIn) fetchData();
  }, [isLoggedIn, fetchData]);

  const fetchMessages = async () => {
    if (!user) return;
    setLoadingMessages(true);
    try {
      const msgs = await messagesApi.getMyMessages(user.id);
      setMyMessages(msgs || []);
    } catch (err) {
      console.error('쪽지 로드 실패:', err);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleOpenInbox = async () => {
    setShowInbox(true);
    await fetchMessages();
  };

  const handleSendMessage = async () => {
    if (!showMessageModal || !messageContent.trim()) return;
    setSending(true);
    try {
      await messagesApi.send(
        user.id,
        showMessageModal.receiverId,
        messageContent.trim(),
        showMessageModal.flightNumber
      );
      setShowMessageModal(null);
      setMessageContent('');
      alert('쪽지가 전송되었습니다!');
    } catch (err) {
      console.error('쪽지 전송 실패:', err);
      alert('쪽지 전송에 실패했습니다.');
    } finally {
      setSending(false);
    }
  };

  const handleSendReply = async () => {
    if (!replyTo || !replyContent.trim()) return;
    setSending(true);
    try {
      await messagesApi.send(user.id, replyTo.senderId, replyContent.trim());
      setReplyTo(null);
      setReplyContent('');
      await fetchMessages();
      alert('답장이 전송되었습니다!');
    } catch (err) {
      console.error('답장 실패:', err);
      alert('답장 전송에 실패했습니다.');
    } finally {
      setSending(false);
    }
  };

  const getCompanionKey = (flight) => `${flight.flight_number}_${flight.flight_date}`;

  const unreadCount = myMessages.filter(
    (m) => m.receiver_id === user?.id && !m.read_at
  ).length;

  if (!isLoggedIn) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Users size={48} className="mx-auto mb-4 opacity-40" />
        <p className="text-lg font-semibold">로그인이 필요합니다</p>
        <p className="text-sm mt-1">동행 서비스를 이용하려면 로그인해주세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-green-500 to-teal-500 rounded-xl text-white">
            <Users size={24} />
          </div>
          <div>
            <h4 className="text-xl font-extrabold text-gray-800">{isCrew ? '듀티 동행' : '같은편 동행'}</h4>
            <p className="text-sm text-gray-500">{isCrew ? '같은 듀티 승무원과 소통하세요' : '같은 비행편 탑승객과 소통하세요'}</p>
          </div>
        </div>
        <button
          onClick={handleOpenInbox}
          className="relative flex items-center gap-2 px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl font-bold text-sm transition-colors"
        >
          <Inbox size={18} />
          받은 쪽지
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Info */}
      <div className="bg-gradient-to-r from-green-50 to-teal-50 rounded-2xl p-4 border border-green-100">
        <p className="text-xs text-gray-600">
          {isCrew
            ? <>출발일 <strong>3주(21일) 전</strong>부터 같은 듀티 승무원 목록이 표시됩니다. 레이오버 투어 모집, 맛집 공유, 동행 계획 등을 쪽지로 나눠보세요!</>
            : <>출발일 <strong>3주(21일) 전</strong>부터 같은 항공편 탑승객 목록이 표시됩니다. 택시 공유, 숙소, 동행 여행 등을 위해 쪽지를 보내보세요!</>
          }
        </p>
      </div>

      {/* Upcoming Flights with Companions */}
      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin w-8 h-8 border-3 border-green-500 border-t-transparent rounded-full mx-auto" />
          <p className="text-sm text-gray-400 mt-3">로딩 중...</p>
        </div>
      ) : myFlights.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <Plane size={48} className="mx-auto mb-3 opacity-30" />
          <p className="font-semibold">3주 이내 출발 스케줄이 없습니다</p>
          <p className="text-sm mt-1">{isCrew ? '비행 스케줄을 등록하면 같은 듀티 승무원을 확인할 수 있습니다.' : '비행 스케줄을 등록하면 같은편 탑승객을 확인할 수 있습니다.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {myFlights.map((flight) => {
            const key = getCompanionKey(flight);
            const flightCompanions = companions[key] || [];
            const isExpanded = expandedFlight === flight.id;
            const daysUntil = Math.ceil(
              (new Date(flight.flight_date) - new Date()) / (1000 * 60 * 60 * 24)
            );

            return (
              <div key={flight.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <button
                  onClick={() => setExpandedFlight(isExpanded ? null : flight.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-50 rounded-lg">
                      <Plane size={18} className="text-green-600" />
                    </div>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-gray-800">{flight.flight_number}</span>
                        <span className="text-sm text-gray-500">{flight.flight_date}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-green-600 font-semibold">
                          D-{daysUntil}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await flightApi.toggleVisibility(flight.id, !flight.is_public);
                            if (onFlightsChange) await onFlightsChange();
                            await fetchData();
                          } catch (err) {
                            console.error('공개 설정 변경 실패:', err);
                          }
                        }}
                        className="relative inline-flex h-6 w-11 items-center rounded-full border-none cursor-pointer transition-colors duration-200"
                        style={{ background: flight.is_public ? '#22c55e' : '#d1d5db', padding: 0 }}
                        title={flight.is_public ? '클릭하면 비공개' : '클릭하면 공개'}
                      >
                        <span
                          className="inline-block h-4 w-4 rounded-full bg-white transition-transform duration-200"
                          style={{ transform: flight.is_public ? 'translateX(24px)' : 'translateX(4px)' }}
                        />
                      </button>
                      <span className={`text-xs font-semibold flex items-center gap-1 ${flight.is_public ? 'text-green-600' : 'text-gray-400'}`}>
                        {flight.is_public ? <Eye size={11} /> : <EyeOff size={11} />}
                        {flight.is_public ? '공개' : '비공개'}
                      </span>
                    </div>
                    {flightCompanions.length > 0 && (
                      <span className="w-6 h-6 bg-green-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                        {flightCompanions.length}
                      </span>
                    )}
                    {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                  </div>
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 border-t border-gray-100">
                        {flightCompanions.length === 0 ? (
                          <p className="text-center py-6 text-sm text-gray-400">
                            {isCrew ? '아직 같은 듀티 승무원이 없습니다.' : '아직 같은 편 탑승객이 없습니다.'}
                          </p>
                        ) : (
                          <div className="space-y-2 mt-3">
                            {flightCompanions.map((companion) => (
                              <div
                                key={companion.id}
                                className="flex items-center justify-between p-3 bg-gray-50 rounded-xl"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-green-400 to-teal-400 flex items-center justify-center text-white font-bold text-sm overflow-hidden">
                                    {companion.profiles?.avatar_url ? (
                                      <img src={companion.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                      (companion.profiles?.name || '?').charAt(0)
                                    )}
                                  </div>
                                  <div>
                                    <p className="font-bold text-gray-800 text-sm">
                                      {companion.profiles?.name || '익명'}
                                    </p>
                                    <p className="text-xs text-gray-400">
                                      {companion.profiles?.user_type === 'crew' ? '승무원' : '탑승객'}
                                    </p>
                                  </div>
                                </div>
                                <button
                                  onClick={() => setShowMessageModal({
                                    receiverId: companion.user_id,
                                    receiverName: companion.profiles?.name || '익명',
                                    flightNumber: flight.flight_number,
                                  })}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs font-bold transition-colors"
                                >
                                  <MessageCircle size={12} />
                                  쪽지 보내기
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {/* Send Message Modal */}
      <AnimatePresence>
        {showMessageModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-[110] flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && setShowMessageModal(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl p-6 w-full max-w-md relative"
            >
              <button
                onClick={() => setShowMessageModal(null)}
                className="absolute top-4 right-4 p-1.5 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X size={18} className="text-gray-400" />
              </button>

              <div className="text-center mb-4">
                <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <MessageCircle size={28} className="text-blue-600" />
                </div>
                <h3 className="text-lg font-extrabold text-gray-800">쪽지 보내기</h3>
                <p className="text-sm text-gray-500 mt-1">
                  <strong>{showMessageModal.receiverName}</strong>님에게
                  {showMessageModal.flightNumber && ` (${showMessageModal.flightNumber})`}
                </p>
              </div>

              <textarea
                value={messageContent}
                onChange={(e) => setMessageContent(e.target.value)}
                placeholder="메시지를 입력하세요... (예: 택시 같이 타실 분 계신가요?)"
                rows={4}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-sm resize-none mb-4"
              />

              <button
                onClick={handleSendMessage}
                disabled={!messageContent.trim() || sending}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {sending ? (
                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <Send size={16} />
                )}
                보내기
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Inbox Modal */}
      <AnimatePresence>
        {showInbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-[110] flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && setShowInbox(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto relative"
            >
              <button
                onClick={() => { setShowInbox(false); setReplyTo(null); }}
                className="absolute top-4 right-4 p-1.5 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X size={18} className="text-gray-400" />
              </button>

              <div className="text-center mb-4">
                <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Inbox size={28} className="text-blue-600" />
                </div>
                <h3 className="text-lg font-extrabold text-gray-800">받은 쪽지함</h3>
              </div>

              {/* Reply area */}
              {replyTo && (
                <div className="mb-4 p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <p className="text-sm font-bold text-blue-700 mb-2">
                    {replyTo.senderName}님에게 답장
                  </p>
                  <textarea
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    placeholder="답장 내용을 입력하세요..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-blue-200 focus:border-blue-400 outline-none text-sm resize-none mb-2"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSendReply}
                      disabled={!replyContent.trim() || sending}
                      className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      <Send size={12} />
                      답장 보내기
                    </button>
                    <button
                      onClick={() => { setReplyTo(null); setReplyContent(''); }}
                      className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-600 rounded-lg font-bold text-xs transition-colors"
                    >
                      취소
                    </button>
                  </div>
                </div>
              )}

              {loadingMessages ? (
                <div className="text-center py-8">
                  <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
                </div>
              ) : myMessages.length === 0 ? (
                <p className="text-center py-8 text-sm text-gray-400">받은 쪽지가 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {myMessages.map((msg) => {
                    const isSent = msg.sender_id === user.id;
                    const otherPerson = isSent ? msg.receiver : msg.sender;
                    const isUnread = !isSent && !msg.read_at;

                    return (
                      <div
                        key={msg.id}
                        className={`p-3 rounded-xl border ${isUnread ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-100'}`}
                        onClick={async () => {
                          if (isUnread) {
                            try {
                              await messagesApi.markAsRead(msg.id);
                              fetchMessages();
                            } catch (e) { /* ignore */ }
                          }
                        }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${isSent ? 'text-green-600' : 'text-blue-600'}`}>
                              {isSent ? '보냄' : '받음'}
                            </span>
                            <span className="text-sm font-bold text-gray-800">
                              {otherPerson?.name || '알 수 없음'}
                            </span>
                            {msg.flight_number && (
                              <span className="text-xs text-gray-400">({msg.flight_number})</span>
                            )}
                          </div>
                          <span className="text-xs text-gray-400">
                            {new Date(msg.created_at).toLocaleDateString('ko-KR')}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700">{msg.content}</p>
                        {!isSent && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setReplyTo({ senderId: msg.sender_id, senderName: msg.sender?.name || '알 수 없음' });
                            }}
                            className="mt-2 text-xs font-bold text-blue-600 hover:text-blue-700"
                          >
                            답장하기
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default FlightCompanions;

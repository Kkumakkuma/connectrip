import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plane, Calendar, Heart, Send, CheckCircle, XCircle,
  Gift, Image as ImageIcon, Clock, Award, ChevronDown, ChevronUp, X,
  Ticket, UserCheck, Loader, Eye, EyeOff, ShieldCheck
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { flightApi, commendationApi, pointsApi } from '../lib/db';
import { supabase } from '../lib/supabase';
import ImageUpload from './ImageUpload';

const STATUS_CONFIG = {
  pending_crew: { label: '매칭 대기중', color: 'bg-orange-100 text-orange-700', icon: Clock },
  pending_passenger: { label: '매칭 대기중', color: 'bg-orange-100 text-orange-700', icon: Clock },
  matched: { label: '매칭 완료', color: 'bg-blue-100 text-blue-700', icon: Heart },
  commendation_submitted: { label: '인증 제출됨', color: 'bg-yellow-100 text-yellow-700', icon: ImageIcon },
  verified: { label: '관리자 승인', color: 'bg-green-100 text-green-700', icon: ShieldCheck },
  gift_sent: { label: '선물 발송 완료', color: 'bg-purple-100 text-purple-700', icon: Gift },
  rejected: { label: '반려', color: 'bg-red-100 text-red-700', icon: XCircle },
};

const CommendationMatching = ({ flights = [], onFlightsChange }) => {
  const { user, profile, isLoggedIn, isCrew, fetchProfile } = useAuth();

  const myFlights = flights;
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showScreenshotModal, setShowScreenshotModal] = useState(null);
  const [showGiftModal, setShowGiftModal] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(null);
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [giftPoints, setGiftPoints] = useState(5000);
  const [giftMessage, setGiftMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [applyingFlight, setApplyingFlight] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  const getLocalPoints = () => profile?.points_balance || 0;
  const getLocalVouchers = () => profile?.voucher_count || 0;

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const matchData = await commendationApi.getMyMatches(user.id);
      setMatches(matchData || []);
    } catch (err) {
      console.error('데이터 로드 실패:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (isLoggedIn) fetchData();
  }, [isLoggedIn, fetchData]);

  // flight_schedules에서 같은 편 상대방 찾기 (RLS 우회)
  const findPartnerFromSchedules = async (flightNumber, flightDate, targetType) => {
    const { data } = await supabase
      .from('flight_schedules')
      .select('user_id, user_type')
      .eq('flight_number', flightNumber)
      .eq('flight_date', flightDate)
      .eq('user_type', targetType)
      .neq('user_id', user.id)
      .limit(1);
    return data?.[0] || null;
  };

  // 중복 매칭 방지: 이미 활성 매칭이 있는지 확인
  const hasActiveMatch = (flightNumber, flightDate) => {
    return matches.some(m =>
      m.flight_number === flightNumber && m.flight_date === flightDate
      && !['rejected', 'deleted'].includes(m.status)
    );
  };

  // CREW: 매칭 신청 (신청권 1장 사용)
  const handleCrewApply = async (flight) => {
    if (hasActiveMatch(flight.flight_number, flight.flight_date)) {
      alert('이미 이 항공편에 매칭 신청이 되어있습니다.');
      return;
    }
    const currentVouchers = getLocalVouchers();

    if (currentVouchers <= 0) {
      alert('매칭신청권이 없습니다. 마이페이지에서 신청권을 먼저 구매해주세요.');
      return;
    }

    if (!window.confirm('매칭신청권 1장을 사용하여 매칭을 신청하시겠습니까?')) return;

    setApplyingFlight(flight.id);
    try {
      // 신청권 1장 차감
      await supabase.from('profiles').update({ voucher_count: currentVouchers - 1 }).eq('id', user.id);
      fetchProfile(user.id).catch(() => {});

      // flight_schedules에서 같은 편 승객 찾기
      const passenger = await findPartnerFromSchedules(flight.flight_number, flight.flight_date, 'passenger');

      if (passenger) {
        // 즉시 매칭
        await commendationApi.createMatch({
          flight_number: flight.flight_number,
          flight_date: flight.flight_date,
          crew_user_id: user.id,
          passenger_user_id: passenger.user_id,
          status: 'matched',
        });
        await fetchData();
        alert('같은 항공편 승객과 자동 매칭되었습니다!');
      } else {
        // 대기
        await commendationApi.createMatch({
          flight_number: flight.flight_number,
          flight_date: flight.flight_date,
          crew_user_id: user.id,
          passenger_user_id: null,
          status: 'pending_crew',
        });
        await fetchData();
        alert('매칭 신청 완료! 같은 항공편 승객이 등록하면 자동 매칭됩니다.');
      }
    } catch (err) {
      console.error('매칭 신청 실패:', err);
      alert('매칭 신청에 실패했습니다.');
      try {
        await supabase.from('profiles').update({ voucher_count: currentVouchers }).eq('id', user.id);
        fetchProfile(user.id).catch(() => {});
      } catch (e) { /* ignore */ }
    } finally {
      setApplyingFlight(null);
    }
  };

  // PASSENGER: 매칭 신청 (무료)
  const handlePassengerApply = async (flight) => {
    if (hasActiveMatch(flight.flight_number, flight.flight_date)) {
      alert('이미 이 항공편에 매칭 신청이 되어있습니다.');
      return;
    }
    if (!window.confirm('이 항공편에 칭송 매칭을 신청하시겠습니까? (무료)')) return;

    setApplyingFlight(flight.id);
    try {
      // flight_schedules에서 같은 편 승무원 찾기
      const crew = await findPartnerFromSchedules(flight.flight_number, flight.flight_date, 'crew');

      if (crew) {
        // 즉시 매칭
        await commendationApi.createMatch({
          flight_number: flight.flight_number,
          flight_date: flight.flight_date,
          crew_user_id: crew.user_id,
          passenger_user_id: user.id,
          status: 'matched',
        });
        await fetchData();
        alert('같은 항공편 승무원과 자동 매칭되었습니다!');
      } else {
        // 대기
        await commendationApi.createMatch({
          flight_number: flight.flight_number,
          flight_date: flight.flight_date,
          crew_user_id: null,
          passenger_user_id: user.id,
          status: 'pending_passenger',
        });
        await fetchData();
        alert('매칭 신청 완료! 같은 항공편 승무원이 등록하면 자동 매칭됩니다.');
      }
    } catch (err) {
      console.error('매칭 신청 실패:', err);
      alert('매칭 신청에 실패했습니다.');
    } finally {
      setApplyingFlight(null);
    }
  };

  // 승객: 칭송 스크린샷 인증 제출 → 관리자 검토 대기
  const handleSubmitScreenshot = async () => {
    if (!showScreenshotModal || !screenshotUrl) return;
    setSubmitting(true);
    try {
      await commendationApi.submitCommendation(showScreenshotModal, screenshotUrl);
      setShowScreenshotModal(null);
      setScreenshotUrl('');
      await fetchData();
      alert('칭송 인증이 제출되었습니다! 관리자 확인 후 선물이 지급됩니다.');
    } catch (err) {
      console.error('제출 실패:', err);
      alert('제출에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  // 승무원: 선물 보내기 (관리자 승인 후)
  const handleSendGift = async () => {
    if (!showGiftModal || giftPoints <= 0) return;
    setSubmitting(true);
    try {
      const match = matches.find((m) => m.id === showGiftModal);
      if (match) {
        await commendationApi.sendGift(showGiftModal, giftPoints, giftMessage);
        await pointsApi.addTransaction(match.passenger_user_id, giftPoints, 'gift_received', `칭송 감사 선물 (${match.flight_number})`);
        await pointsApi.addTransaction(match.crew_user_id, -giftPoints, 'gift_sent', `칭송 감사 선물 발송 (${match.flight_number})`);
      }
      setShowGiftModal(null);
      setGiftPoints(5000);
      setGiftMessage('');
      await fetchData();
      alert('선물이 발송되었습니다!');
    } catch (err) {
      console.error('선물 발송 실패:', err);
      alert('선물 발송에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  // Helpers
  const activeMatches = matches.filter((m) => !['gift_sent', 'rejected', 'deleted'].includes(m.status));
  const historyMatches = matches.filter((m) => ['gift_sent', 'rejected'].includes(m.status));

  const getMatchForFlight = (flight) => {
    return matches.find(
      (m) => m.flight_number === flight.flight_number && m.flight_date === flight.flight_date
        && !['rejected', 'deleted'].includes(m.status)
    );
  };

  // 비행 다음날 이후에만 승무원 이름 공개
  const isAfterFlight = (flightDate) => {
    const nextDay = new Date(flightDate);
    nextDay.setDate(nextDay.getDate() + 1);
    return new Date() >= nextDay;
  };

  const getPartnerInfo = (match) => {
    const afterFlight = isAfterFlight(match.flight_date);
    if (isCrew) {
      return { name: '승객', avatar: null, hidden: true };
    }
    // 승객이 보는 승무원 정보 - 비행 다음날 이후에만 공개
    if (afterFlight && ['matched', 'commendation_submitted', 'verified', 'gift_sent'].includes(match.status)) {
      return { name: match.crew?.name || '승무원', avatar: match.crew?.avatar_url, airline: match.crew?.airline, hidden: false };
    }
    return { name: '승무원 (비행 후 공개)', avatar: null, hidden: true };
  };

  if (!isLoggedIn) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Plane size={48} className="mx-auto mb-4 opacity-40" />
        <p className="text-lg font-semibold">로그인이 필요합니다</p>
        <p className="text-sm mt-1">칭송매칭 서비스를 이용하려면 로그인해주세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2.5 bg-gradient-to-br from-blue-500 to-purple-500 rounded-xl text-white">
          <Award size={24} />
        </div>
        <div>
          <h4 className="text-xl font-extrabold text-gray-800">칭송매칭</h4>
          <p className="text-sm text-gray-500">
            {isCrew
              ? '신청권을 사용하고 승객의 칭송을 받아보세요'
              : '무료로 매칭 신청하고 승무원에게 감사를 전해보세요'}
          </p>
        </div>
      </div>

      {/* 매칭 진행 방법 */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-2xl p-4 border border-blue-100">
        <h5 className="font-bold text-gray-700 text-sm mb-2">매칭 진행 방법</h5>
        {isCrew ? (
          <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
            <li>비행 스케줄을 등록합니다</li>
            <li><strong>매칭 신청</strong>을 눌러 신청권 1장으로 매칭을 신청합니다</li>
            <li>같은 항공편 승객이 신청하면 <strong>자동 매칭</strong>됩니다</li>
            <li>비행 후 승객이 칭송 스크린샷을 제출합니다</li>
            <li><strong>관리자</strong>가 확인/승인하면 승객에게 감사 선물이 지급됩니다</li>
          </ol>
        ) : (
          <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
            <li>비행 스케줄을 등록합니다</li>
            <li><strong>매칭 신청 (무료)</strong>을 눌러 매칭을 신청합니다</li>
            <li>같은 항공편 승무원이 신청하면 <strong>자동 매칭</strong>됩니다</li>
            <li>비행 다음날 승무원 이름이 공개됩니다</li>
            <li>항공사 홈페이지에 칭송 작성 → 스크린샷 제출 → 관리자 승인 후 선물을 받습니다</li>
          </ol>
        )}
      </div>

      {/* 매칭 현황 (미신청 스케줄 + 진행중 매칭 통합) */}
      {(() => {
        const unmatchedFlights = myFlights.filter(f => !getMatchForFlight(f));
        const totalItems = unmatchedFlights.length + activeMatches.length;
        if (totalItems === 0 && !loading) {
          return (
            <div className="text-center py-10 text-gray-400">
              <Plane size={48} className="mx-auto mb-3 opacity-30" />
              <p className="font-semibold">아직 등록된 스케줄이 없습니다</p>
              <p className="text-sm mt-1">위에서 비행 스케줄을 등록해보세요!</p>
            </div>
          );
        }
        return (
          <div className="space-y-3">
            {totalItems > 0 && (
              <h5 className="font-bold text-gray-700 flex items-center gap-2">
                <Heart size={18} className="text-pink-500" />
                매칭 현황 ({totalItems})
              </h5>
            )}

            {/* 아직 매칭 신청 안 한 스케줄 */}
            {unmatchedFlights.map((flight) => {
              const isApplying = applyingFlight === flight.id;
              return (
                <div key={'unmatched-' + flight.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-gray-100 rounded-lg"><Plane size={16} className="text-gray-500" /></div>
                      <div>
                        <span className="font-extrabold text-gray-800">{flight.flight_number}</span>
                        <span className="text-sm text-gray-500 ml-2">{flight.flight_date}</span>
                      </div>
                    </div>
                    {isCrew ? (
                      <button onClick={() => handleCrewApply(flight)} disabled={isApplying}
                        className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg font-bold text-xs transition-all disabled:opacity-50 shadow-md">
                        {isApplying ? <Loader size={14} className="animate-spin" /> : <Ticket size={14} />} 매칭 신청
                      </button>
                    ) : (
                      <button onClick={() => handlePassengerApply(flight)} disabled={isApplying}
                        className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white rounded-lg font-bold text-xs transition-all disabled:opacity-50 shadow-md">
                        {isApplying ? <Loader size={14} className="animate-spin" /> : <UserCheck size={14} />} 매칭 신청 (무료)
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* 진행중인 매칭 */}
            {activeMatches.map((match) => (
              <MatchCard key={match.id} match={match} isCrew={isCrew} partner={getPartnerInfo(match)}
                isAfterFlight={isAfterFlight(match.flight_date)} onViewDetail={() => setShowDetailModal(match)}
                onSubmitScreenshot={() => setShowScreenshotModal(match.id)} onSendGift={() => setShowGiftModal(match.id)} />
            ))}
          </div>
        );
      })()}

      {/* 완료 기록 */}
      {historyMatches.length > 0 && (
        <div>
          <button onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 font-semibold text-sm transition-colors">
            {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            완료된 매칭 기록 ({historyMatches.length})
          </button>
          <AnimatePresence>
            {showHistory && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-3 mt-3 overflow-hidden">
                {historyMatches.map((match) => (
                  <MatchCard key={match.id} match={match} isCrew={isCrew} partner={getPartnerInfo(match)} isAfterFlight={isAfterFlight(match.flight_date)} onViewDetail={() => setShowDetailModal(match)} isHistory onDelete={async () => {
                    if (!window.confirm('이 기록을 삭제하시겠습니까?')) return;
                    try {
                      await supabase.from('commendation_matches').update({ status: 'deleted' }).eq('id', match.id);
                      await fetchData();
                    } catch (e) { console.error('삭제 실패:', e); }
                  }} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* 칭송 스크린샷 제출 모달 */}
      <AnimatePresence>
        {showScreenshotModal && (
          <Modal onClose={() => { setShowScreenshotModal(null); setScreenshotUrl(''); }}>
            <div className="text-center mb-4">
              <div className="w-14 h-14 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <ImageIcon size={28} className="text-yellow-600" />
              </div>
              <h3 className="text-lg font-extrabold text-gray-800">칭송 인증 제출</h3>
              <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                항공사 홈페이지의 '칭송(고객의 말씀)' 게시판에<br />
                작성하신 후 제출 완료 화면을 캡쳐하여 업로드해 주세요.
              </p>
            </div>
            <div className="mb-4">
              <ImageUpload bucket="images" onUpload={(url) => setScreenshotUrl(url)} />
            </div>
            <button
              onClick={handleSubmitScreenshot}
              disabled={!screenshotUrl || submitting}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : <Send size={16} />}
              인증 내역 제출하기
            </button>
          </Modal>
        )}
      </AnimatePresence>

      {/* 선물 보내기 모달 */}
      <AnimatePresence>
        {showGiftModal && (
          <Modal onClose={() => { setShowGiftModal(null); setGiftMessage(''); setGiftPoints(5000); }}>
            <div className="text-center mb-4">
              <div className="w-14 h-14 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Gift size={28} className="text-purple-600" />
              </div>
              <h3 className="text-lg font-extrabold text-gray-800">감사 선물 보내기</h3>
              <p className="text-sm text-gray-500 mt-1">칭송에 대한 감사의 마음을 전해보세요</p>
            </div>
            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">포인트</label>
                <div className="grid grid-cols-4 gap-2">
                  {[1000, 3000, 5000, 10000].map((amount) => (
                    <button key={amount} type="button" onClick={() => setGiftPoints(amount)}
                      className={`py-2 rounded-lg text-sm font-bold transition-all ${giftPoints === amount ? 'bg-purple-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {amount.toLocaleString()}P
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">감사 메시지 (선택)</label>
                <textarea value={giftMessage} onChange={(e) => setGiftMessage(e.target.value)} placeholder="따뜻한 칭송 감사합니다!" rows={3}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-purple-400 focus:ring-2 focus:ring-purple-100 outline-none transition-all text-sm resize-none" />
              </div>
            </div>
            <button onClick={handleSendGift} disabled={submitting || giftPoints <= 0}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {submitting ? <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : <Gift size={16} />}
              {giftPoints.toLocaleString()}P 선물 보내기
            </button>
          </Modal>
        )}
      </AnimatePresence>

      {/* 상세보기 모달 */}
      <AnimatePresence>
        {showDetailModal && (
          <Modal onClose={() => setShowDetailModal(null)}>
            <MatchDetail match={showDetailModal} isCrew={isCrew} partner={getPartnerInfo(showDetailModal)} isAfterFlight={isAfterFlight(showDetailModal.flight_date)} />
          </Modal>
        )}
      </AnimatePresence>

      {loading && (
        <div className="text-center py-8">
          <div className="animate-spin w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full mx-auto" />
          <p className="text-sm text-gray-400 mt-3">로딩 중...</p>
        </div>
      )}
    </div>
  );
};

// ============================
// Sub-components
// ============================

const StatusBadge = ({ status }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.matched;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full ${config.color}`}>
      <Icon size={12} />
      {config.label}
    </span>
  );
};

const MatchCard = ({ match, isCrew, partner, isAfterFlight, onViewDetail, onSubmitScreenshot, onSendGift, isHistory, onDelete }) => {
  const isPending = match.status === 'pending_crew' || match.status === 'pending_passenger';

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className={`bg-white rounded-2xl p-4 shadow-sm border border-gray-100 ${isHistory ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-400 flex items-center justify-center text-white font-bold text-sm overflow-hidden">
            {isPending ? <Clock size={18} /> : partner.hidden ? <Plane size={18} /> : partner.avatar ? (
              <img src={partner.avatar} alt="" className="w-full h-full object-cover" />
            ) : partner.name.charAt(0)}
          </div>
          <div>
            <p className="font-bold text-gray-800 text-sm">
              {isPending ? '매칭 대기중...' : partner.name}
            </p>
            {isPending && (
              <p className="text-xs text-orange-500">같은 항공편 상대방 신청 대기중</p>
            )}
            {!isPending && !isCrew && !isAfterFlight && match.status === 'matched' && (
              <p className="text-xs text-blue-500">비행 다음날 승무원 이름이 공개됩니다</p>
            )}
            {!isPending && !isCrew && partner.airline && !partner.hidden && (
              <p className="text-xs text-gray-500">{partner.airline}</p>
            )}
          </div>
        </div>
        <StatusBadge status={match.status} />
      </div>

      <div className="flex items-center justify-between mb-3 bg-gray-50 rounded-xl p-3">
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <div className="flex items-center gap-1.5">
            <Plane size={14} className="text-blue-500" />
            <span className="font-bold">{match.flight_number}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar size={14} className="text-blue-500" />
            <span>{match.flight_date}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isPending && onViewDetail && (
            <button onClick={onViewDetail} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-200 text-gray-500 hover:bg-white transition-colors">
              상세보기
            </button>
          )}
          {/* 상태별 액션 - 항공편 바 우측에 통합 */}
          {!isHistory && (
            <>
              {!isCrew && match.status === 'matched' && isAfterFlight && onSubmitScreenshot && (
                <button onClick={onSubmitScreenshot} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white transition-colors flex items-center gap-1">
                  <ImageIcon size={12} /> 칭송 인증
                </button>
              )}
              {!isCrew && match.status === 'matched' && !isAfterFlight && (
                <span className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-50 text-blue-600 border border-blue-200">비행 후 인증 가능</span>
              )}
              {!isCrew && match.status === 'commendation_submitted' && (
                <span className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-yellow-50 text-yellow-600 border border-yellow-200">관리자 확인중</span>
              )}
              {match.status === 'verified' && (
                <span className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-50 text-green-600 border border-green-200">선물 발송 예정</span>
              )}
              {isCrew && match.status === 'commendation_submitted' && (
                <span className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-yellow-50 text-yellow-600 border border-yellow-200">관리자 검토중</span>
              )}
              {match.status === 'gift_sent' && match.gift_points && (
                <span className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-purple-50 text-purple-600 border border-purple-200">{match.gift_points.toLocaleString()}P 완료</span>
              )}
            </>
          )}
          {isHistory && onDelete && (
            <button onClick={onDelete} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-red-200 text-red-400 hover:bg-red-50 transition-colors">
              삭제
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

const MatchDetail = ({ match, isCrew, partner, isAfterFlight }) => {
  return (
    <div>
      <div className="text-center mb-5">
        <div className="w-20 h-20 rounded-full mx-auto mb-3 overflow-hidden bg-gradient-to-br from-blue-400 to-purple-400 flex items-center justify-center text-white text-2xl font-bold">
          {partner.hidden ? <Plane size={32} /> : partner.avatar ? (
            <img src={partner.avatar} alt="" className="w-full h-full object-cover" />
          ) : partner.name.charAt(0)}
        </div>
        <h3 className="text-xl font-extrabold text-gray-800">{partner.name}</h3>
        {!isCrew && partner.airline && !partner.hidden && (
          <p className="text-sm text-gray-500 mt-0.5">{partner.airline}</p>
        )}
        {!isCrew && partner.hidden && match.status === 'matched' && (
          <p className="text-sm text-blue-500 mt-0.5">비행 다음날 공개됩니다</p>
        )}
      </div>

      <div className="space-y-3 bg-gray-50 rounded-xl p-4">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">항공편</span>
          <span className="font-bold text-gray-800">{match.flight_number}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">날짜</span>
          <span className="font-bold text-gray-800">{match.flight_date}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">상태</span>
          <StatusBadge status={match.status} />
        </div>
        {match.gift_points && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">선물 포인트</span>
            <span className="font-bold text-purple-600">{match.gift_points.toLocaleString()}P</span>
          </div>
        )}
        {match.gift_message && (
          <div className="pt-2 border-t border-gray-200">
            <p className="text-xs text-gray-500 mb-1">감사 메시지</p>
            <p className="text-sm text-gray-700 bg-white rounded-lg p-3">{match.gift_message}</p>
          </div>
        )}
        {match.commendation_screenshot_url && (
          <div className="pt-2 border-t border-gray-200">
            <p className="text-xs text-gray-500 mb-2">칭송 캡쳐</p>
            <img src={match.commendation_screenshot_url} alt="칭송 캡쳐" className="w-full rounded-xl border border-gray-200" />
          </div>
        )}
      </div>
    </div>
  );
};

const Modal = ({ children, onClose }) => {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-[110] flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[85vh] overflow-y-auto relative">
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 hover:bg-gray-100 rounded-full transition-colors">
          <X size={18} className="text-gray-400" />
        </button>
        {children}
      </motion.div>
    </motion.div>
  );
};

export default CommendationMatching;

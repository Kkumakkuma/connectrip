import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Plane, ChevronDown, ChevronUp, Lock } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import FlightBoard from './FlightBoard';
import { kstDateString, dayDiff, boardFlights, boardStatus } from '../lib/flightBoard';

// 내가 등록한 항공편마다 붙는 "같은 편 게시판" 목록. (2026-09-06 개편)
// 같은 편 탑승자 명단은 개인정보라 누구에게도 보이지 않고, 쪽지도 없다.
// 스케줄 목록에서 "게시판 참여" 를 켠 편만 여기 보인다. 게시판 안에서는 서버가 배정한 익명 번호로만 글·댓글을 쓴다.
// 출발 2주 전부터 출발일까지 열리고, 출발일이 지나면 목록에서 사라진다.
// focus = { id, at } : 마이페이지 스케줄 목록의 "게시판" 버튼이 넘겨 주면 그 편을 펼치고 화면을 옮긴다.
const FlightCompanions = ({ flights = [], focus = null }) => {
  const { isLoggedIn, isCrew } = useAuth();
  const [expandedFlight, setExpandedFlight] = useState(null);
  const [consumedFocus, setConsumedFocus] = useState(null); // 사용자가 직접 접었다 편 뒤에는 focus 를 더 따르지 않는다
  const rootRef = useRef(null);

  const todayKst = kstDateString();
  const myFlights = boardFlights(flights, todayKst);
  const expanded = focus?.id && focus !== consumedFocus ? focus.id : expandedFlight;
  const toggle = (id) => {
    setConsumedFocus(focus);
    setExpandedFlight(expanded === id ? null : id);
  };

  useEffect(() => {
    if (focus?.id) rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus]);

  if (!isLoggedIn) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Users size={48} className="mx-auto mb-4 opacity-40" />
        <p className="text-lg font-semibold">로그인이 필요합니다</p>
        <p className="text-sm mt-1">같은 편 게시판을 이용하려면 로그인해 주세요.</p>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="space-y-6 scroll-mt-24">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-gradient-to-br from-green-500 to-teal-500 rounded-xl text-white">
          <Users size={24} />
        </div>
        <div>
          <h4 className="text-xl font-extrabold text-gray-800">{isCrew ? '듀티 게시판' : '같은 편 게시판'}</h4>
          <p className="text-sm text-gray-500">{isCrew ? '같은 듀티 승무원끼리 익명으로 이야기하는 곳' : '같은 비행기를 타는 사람끼리 익명으로 이야기하는 곳'}</p>
        </div>
      </div>

      <div className="bg-gradient-to-r from-green-50 to-teal-50 rounded-2xl p-4 border border-green-100">
        <p className="text-xs text-gray-600 leading-relaxed">
          스케줄 목록에서 <strong>게시판 참여</strong>를 켜면 그 편의 게시판에 들어가고, 끄면 나옵니다. 이름은 누구에게도 보이지 않고, 각자 <strong>익명 번호</strong>로 글과 댓글을 씁니다.
          게시판은 출발 <strong>2주 전</strong>부터 열리고 출발일이 지나면 닫힙니다. 연락처처럼 남에게 보이면 안 되는 내용은 <strong>비밀댓글</strong>로 남겨 주세요.
        </p>
      </div>

      {myFlights.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <Plane size={48} className="mx-auto mb-3 opacity-30" />
          <p className="font-semibold">참여 중인 게시판이 없습니다</p>
          <p className="text-sm mt-1">위 스케줄 목록에서 게시판 참여를 켜면 그 편의 게시판이 여기에 나타납니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {myFlights.map((flight) => {
            const isExpanded = expanded === flight.id;
            const daysUntil = dayDiff(flight.flight_date, todayKst);
            const status = boardStatus(flight.flight_date, todayKst);
            return (
              <div key={flight.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <button
                  onClick={() => toggle(flight.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                  aria-expanded={isExpanded}
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
                        <span className="text-xs font-semibold text-green-600">
                          {daysUntil === 0 ? '오늘 출발' : `D-${daysUntil}`}
                        </span>
                        {status === 'locked' && (
                          <span className="text-[11px] text-gray-400 flex items-center gap-1"><Lock size={10} />출발 2주 전에 열림</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
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
                        <FlightBoard flight={flight} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FlightCompanions;

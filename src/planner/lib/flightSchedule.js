// 플래너 항공권 티켓 → 마이페이지 비행 스케줄 등록 제안 (2026-09-14, 쿠마님 9623)
// 티켓 날짜 확정(TicketDateConfirm) 뒤 kind === 'flight' 이고 편명을 알 수 있으면 confirm 으로 묻고 등록한다.
// 이미 같은 편·같은 날짜가 등록돼 있으면 묻지 않는다.
import { flightApi } from '../../lib/db';

// 항공사 코드 2자(KE, OZ, 7C, 6E — 영문 하나 이상) + 편명 번호 1~4자리
export const FLIGHT_RE = /^(?=[A-Z0-9]{2}[0-9])(?:[A-Z][A-Z0-9]|[0-9][A-Z])[0-9]{1,4}$/;

// 비교용 정규화: KE081 과 KE81 은 같은 편
export function canonFlight(f) {
  const m = String(f || '').toUpperCase().replace(/\s+/g, '').match(/^([A-Z0-9]{2})0*([0-9]{1,4})$/);
  return m ? `${m[1]}${m[2]}` : null;
}

// 탑승권 바코드(bcbp.flight, 예 'KE81')가 우선, 없으면 제목('KE081 ICN→JFK')에서 찾는다. 대문자·공백 제거.
export function extractFlightNumber({ bcbp, title } = {}) {
  const fromBcbp = String(bcbp?.flight || '').toUpperCase().replace(/\s+/g, '');
  if (FLIGHT_RE.test(fromBcbp)) return fromBcbp;
  const m = String(title || '').toUpperCase().match(/(?:^|[^A-Z0-9])((?:[A-Z][A-Z0-9]|[0-9][A-Z])\s?[0-9]{1,4})(?![A-Z0-9])/);
  if (!m) return null;
  const f = m[1].replace(/\s+/g, '');
  return FLIGHT_RE.test(f) ? f : null;
}

export function isDuplicateFlight(list, flightNumber, date) {
  const want = canonFlight(flightNumber);
  return (list || []).some((f) => canonFlight(f.flight_number) === want && f.flight_date === date);
}

// 반환 { status: 'skip' | 'exists' | 'declined' | 'registered', flightNumber? }
export async function offerFlightSchedule({ userId, userType, values, bcbp, confirm = (msg) => window.confirm(msg), api = flightApi }) {
  if (!userId || !values || values.kind !== 'flight' || !values.event_date) return { status: 'skip' };
  const flightNumber = extractFlightNumber({ bcbp, title: values.title });
  if (!flightNumber) return { status: 'skip' };
  let mine = [];
  try { mine = (await api.getMyFlights(userId)) || []; } catch { mine = []; }
  if (isDuplicateFlight(mine, flightNumber, values.event_date)) return { status: 'exists', flightNumber };
  if (!confirm(`${flightNumber} ${values.event_date} 편을 마이페이지 비행 스케줄에도 등록할까요?`)) return { status: 'declined', flightNumber };
  await api.register({
    user_id: userId,
    flight_number: flightNumber,
    flight_date: values.event_date,
    user_type: userType === 'crew' ? 'crew' : 'passenger',
  });
  return { status: 'registered', flightNumber };
}

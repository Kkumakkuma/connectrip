// 플래너 항공권 티켓 → 마이페이지 비행 스케줄 등록 제안 (2026-09-14, 쿠마님 9623)
// 티켓 날짜 확정(TicketDateConfirm) 뒤 kind === 'flight' 이고 편명을 알 수 있으면 confirm 으로 묻고 등록한다.
// 이미 같은 편·같은 날짜가 등록돼 있으면 묻지 않는다.
import { flightApi } from '../../lib/db';
import { canonFlightNumber, validateFlightNumber } from '../../lib/flightNumber';

// 항공사 코드 2자(KE, OZ, 7C, 6E — 영문 하나 이상) + 편명 번호 1~4자리
export const FLIGHT_RE = /^(?=[A-Z0-9]{2}[0-9])(?:[A-Z][A-Z0-9]|[0-9][A-Z])[0-9]{1,4}$/;

// 비교용 정규화. 규칙이 갈리지 않게 공용 유틸에 위임한다(2026-09-17).
export const canonFlight = canonFlightNumber;

// 탑승권 바코드(bcbp.flight, 예 'KE81')가 우선, 없으면 제목('KE081 ICN→JFK')에서 찾는다. 대문자·공백 제거.
// 문법은 공용 유틸(canonFlightNumber)과 같아야 한다 — 예전에는 여기서 접미 영문(KE081A)을
// 못 읽거나 'KE081 A' 에서 접미사를 흘려 다른 편으로 저장됐다(2026-09-17 코덱스 지적).
export function extractFlightNumber({ bcbp, title } = {}) {
  const fromBcbp = canonFlightNumber(bcbp?.flight);
  if (fromBcbp) return fromBcbp;
  const m = String(title || '').toUpperCase()
    .match(/(?:^|[^A-Z0-9])((?:[A-Z][A-Z0-9]|[0-9][A-Z])\s?[0-9]{1,4}\s?[A-Z]?)(?![A-Z0-9])/);
  if (!m) return null;
  return canonFlightNumber(m[1]);
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
  // 탑승권에서 뽑은 편명이라도 마이페이지와 같은 기준을 통과해야 넣는다
  // (등록되지 않은 항공사 부호가 DB 에 들어가면 마이페이지에서 수정조차 못 하게 된다).
  const checked = validateFlightNumber(flightNumber);
  if (!checked.ok) return { status: 'skip' };
  if (!confirm(`${checked.value} ${values.event_date} 편을 마이페이지 비행 스케줄에도 등록할까요?`)) return { status: 'declined', flightNumber: checked.value };
  await api.register({
    user_id: userId,
    flight_number: checked.value,
    flight_date: values.event_date,
    user_type: userType === 'crew' ? 'crew' : 'passenger',
  });
  return { status: 'registered', flightNumber: checked.value };
}

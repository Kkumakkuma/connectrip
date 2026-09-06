// 티켓 파일 규칙·표시 문구 — 지갑(Tickets.jsx)과 장소 시트(PlaceSheet.jsx)가 같은 값을 쓴다.
// 순수 함수만 둔다(vitest 대상). 서버 CHECK(planner_20260904.sql: mime 4종·15,728,640바이트)와 같은 숫자.

export const TICKET_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const TICKET_MAX_BYTES = 15 * 1024 * 1024;

export const KIND_LABEL = {
  flight: '항공권',
  train: '기차',
  bus: '버스',
  ticket: '입장권',
  hotel: '숙소',
  other: '기타',
};

/** 올릴 수 있는 파일이면 null, 아니면 사용자에게 보여 줄 문구. */
export function validateTicketFile(file) {
  if (!file || !TICKET_MIME.includes(file.type)) return '사진(JPG·PNG·WebP)이나 PDF만 올릴 수 있습니다.';
  if (!(file.size > 0)) return '빈 파일은 올릴 수 없습니다.';
  if (file.size > TICKET_MAX_BYTES) return '15MB 이하 파일만 올릴 수 있습니다.';
  return null;
}

/** 목록에 보이는 이름. 제목이 없으면 파일 종류로. */
export function ticketLabel(ticket) {
  if (ticket?.title) return ticket.title;
  return ticket?.mime === 'application/pdf' ? 'PDF 티켓' : '사진 티켓';
}

/** 장소별 티켓 묶음. place_id 없는 티켓은 빠진다. 입력 순서(listTickets 정렬)를 그대로 둔다. */
export function ticketsByPlace(tickets) {
  const map = new Map();
  (tickets || []).forEach((t) => {
    if (!t?.place_id) return;
    if (!map.has(t.place_id)) map.set(t.place_id, []);
    map.get(t.place_id).push(t);
  });
  return map;
}

/** 여행별 "티켓 오프라인 저장" 옵트인. 저장이 막힌 환경(사파리 프라이빗 등)은 꺼진 것으로. */
export function readOfflineOptIn(tripId) {
  try {
    return globalThis.localStorage?.getItem(`ct_planner_ticket_offline_${tripId}`) === '1';
  } catch {
    return false;
  }
}

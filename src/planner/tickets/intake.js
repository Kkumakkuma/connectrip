// 티켓 올리기·열기의 I/O 공통 경로 — 지갑(Tickets.jsx)과 장소 시트(usePlaceTickets)가 같은 함수를 쓴다.
//
// 원칙(설계 §5): 원본 그대로 저장, 판독 결과는 초안(확인 시트 필수), 전체화면은 원본.
// 여기서부터 "파일도 행도 이미 서버에 있다" 시점이 있으므로 뒤 단계 실패를 "올리지 못했습니다"로 말하면
// 사용자가 다시 올려 사본이 둘 생긴다(교차검토 지적). 판독 실패는 빈 후보로 흡수한다.
import { downloadTicket, ticketUrl, uploadTicket } from '../api';
import { readTicket } from '../lib/offlineStore';
import { mergeBcbpCandidate, parseBcbp, pickTicketDate } from '../lib/ticketDate';
import { validateTicketFile } from '../lib/ticketFile';

const emptyDetection = () => ({ candidates: [], best: null, ambiguous: true });

/**
 * 파일 검증 → 업로드(+장소 연결) → 목록 갱신 콜백 → 판독(PDF 글자 / 이미지 바코드) → 날짜 후보.
 * @returns {{ row, detection, bcbp, barcode }}
 * @throws Error(사용자 문구) 검증 실패·업로드 실패. 판독 실패는 던지지 않는다.
 */
export async function uploadAndDetect({ tripId, userId, file, trip, placeId = null, onUploaded }) {
  const msg = validateTicketFile(file);
  if (msg) throw new Error(msg);

  const row = await uploadTicket({ tripId, userId, file, placeId });

  if (onUploaded) {
    try {
      await onUploaded(row);
    } catch (err) {
      // 목록 갱신 실패는 호출자가 안내한다(여기서는 업로드 성공을 뒤집지 않는다)
      console.warn('[planner] 티켓 목록 갱신 실패', err);
    }
  }

  let text = '';
  let bcbp = null;
  let barcode = null;
  try {
    if (file.type === 'application/pdf') {
      const { extractPdfText } = await import('../lib/pdfText');
      text = (await extractPdfText(file)) || '';
    } else {
      const { readBarcodeFromImage } = await import('../lib/barcode');
      barcode = await readBarcodeFromImage(file);
      if (barcode?.text) {
        text = barcode.text;
        bcbp = parseBcbp(barcode.text, trip);
      }
    }
  } catch {
    // 판독 모듈(청크) 로드 실패 등 — 날짜는 확인 시트에서 직접 넣게 한다
    text = '';
    bcbp = null;
    barcode = null;
  }

  let detection;
  try {
    detection = mergeBcbpCandidate(pickTicketDate(text, trip), bcbp);
  } catch {
    detection = emptyDetection();
  }
  return { row, detection, bcbp, barcode };
}

/**
 * 전체화면에 보여 줄 이미지 주소. PDF 는 첫 쪽을 그린 data URL, 이미지는 기기 사본(오프라인) → 서명 URL.
 * @returns {{ url: string, revoke: (() => void) | null } | null}  null 이면 호출자가 안내한다.
 */
export async function resolveTicketView(ticket, ownerId) {
  if (ticket.mime === 'application/pdf') {
    const { renderPdfFirstPage } = await import('../lib/pdfText');
    const blob = await downloadTicket(ticket.storage_path);
    const rendered = await renderPdfFirstPage(blob);
    return rendered ? { url: rendered, revoke: null } : null;
  }
  // 기기에 사본이 있으면 그걸 먼저 쓴다. 오프라인에서 티켓을 여는 게 이 기능의 목적이다.
  const local = await readTicket(ownerId, ticket.id).catch(() => null);
  if (local) {
    const url = URL.createObjectURL(local);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }
  const url = await ticketUrl(ticket.storage_path);
  return url ? { url, revoke: null } : null;
}

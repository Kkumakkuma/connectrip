// 포트원 V2 결제창 호출부 (ConnectTrip 포인트 충전, 2026-09-02. 토스 위젯 어댑터 대체)
// storeId·channelKey 는 파일에 안 박고 주문 생성 응답(order.pgParams)으로 서버가 내려준다.
// PC: 결제창이 팝업/iframe 으로 뜨고 응답 객체가 돌아온다 → 바로 confirm.
// 모바일·앱: REDIRECTION — 페이지가 이동하므로 이 함수는 돌아오지 않고, 복귀는 parsePaymentReturn 으로 처리한다.
// 결제 시작 기록(sessionStorage)을 남겨 PC 에서 confirm 이 실패해도 "다시 확인"으로 복구할 수 있게 한다.
import { isNativeApp } from '../native';

const PENDING_KEY = 'ct_pending_payment';
const RETURN_PARAMS = ['flow', 'paymentId', 'code', 'message', 'pgCode', 'pgMessage', 'transactionType', 'txId', 'paymentToken'];

const isMobileUA = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

export function readPendingPayment() {
  try {
    const v = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    if (!v?.paymentId) return null;
    if (Date.now() - Number(v.startedAt || 0) > 2 * 60 * 60_000) { clearPendingPayment(); return null; } // 결제창 유효시간(수십 분)보다 넉넉히, 하루 뒤 혼란은 방지
    return v;
  } catch { return null; }
}
export function savePendingPayment(paymentId) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ paymentId, startedAt: Date.now() })); } catch { /* noop */ }
}
export function clearPendingPayment() {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* noop */ }
}

const compact = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/**
 * 결제창 호출. 반환: { redirected:true } | { paymentId, txId }. 취소·실패는 Error(code, pgMessage) throw.
 * returnPath: 모바일/앱 복귀 경로(쿼리에 flow=charge 를 붙인다; paymentId 등은 포트원이 붙여 준다).
 */
export async function requestPointPayment(order, { returnPath = '/mypage' } = {}) {
  const storeId = order?.pgParams?.storeId;
  const channelKey = order?.pgParams?.channelKey;
  if (!storeId || !channelKey) throw Object.assign(new Error('결제 서비스가 아직 준비되지 않았습니다.'), { code: 'PG_UNCONFIGURED' });
  const PortOne = await import('@portone/browser-sdk/v2');
  const sp = new URLSearchParams();
  sp.set('flow', 'charge');
  const redirectUrl = `${window.location.origin}${returnPath}?${sp.toString()}`;
  const useRedirect = isNativeApp() || isMobileUA();
  savePendingPayment(order.orderId);
  const resp = await PortOne.requestPayment({
    storeId,
    channelKey,
    paymentId: order.orderId,
    orderName: order.orderName,
    totalAmount: order.amount,
    currency: 'KRW',
    payMethod: 'CARD',
    redirectUrl,
    customer: compact(order.customer),
    customData: { kind: 'point_charge', env: order.env },
    ...(useRedirect ? { windowType: { mobile: 'REDIRECTION' } } : {}),
  });
  if (!resp) return { redirected: true }; // REDIRECTION — 페이지 이동 중
  if (resp.code !== undefined) {
    clearPendingPayment();
    const e = new Error(resp.message || '결제가 취소되었거나 실패했습니다.');
    e.code = resp.code;
    e.pgMessage = resp.pgMessage || '';
    throw e;
  }
  return { paymentId: resp.paymentId || order.orderId, txId: resp.txId || '' };
}

/** 리다이렉트 복귀 파싱. flow=charge 가 아니면 null. code 가 있으면 실패 복귀. */
export function parsePaymentReturn(search) {
  const q = new URLSearchParams(search || window.location.search);
  if (q.get('flow') !== 'charge') return null;
  const code = q.get('code');
  return {
    paymentId: (q.get('paymentId') || '').trim(),
    code: code ? String(code) : null,
    message: q.get('pgMessage') || q.get('message') || '',
  };
}

/** 결제 관련 쿼리만 제거하고 나머지 쿼리는 보존 */
export function stripPaymentParams() {
  const url = new URL(window.location.href);
  RETURN_PARAMS.forEach((k) => url.searchParams.delete(k));
  window.history.replaceState({}, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash);
}

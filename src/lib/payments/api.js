// ConnectTrip 결제 API 호출부 (2026-07-30). Vercel Serverless(api/payment/*) 를 부른다.
// 로그인 사용자의 Supabase access_token 을 Authorization 으로 실어 서버가 본인을 판정한다.
import { supabase } from '../supabase.js';
import { apiUrl } from '../api.js';

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 충전 주문 생성. 금액(원)은 서버가 범위 검증한다. */
export async function createChargeOrder(amount) {
  const r = await fetch(apiUrl('/api/payment/create-order'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ amount }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error || `order_http_${r.status}`);
  return j;
}

/** 결제 승인(성공 리다이렉트 후). 성공 시 서버가 포인트 충전(라이브만). */
export async function confirmCharge({ paymentKey, orderId, amount }) {
  const r = await fetch(apiUrl('/api/payment/confirm'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });
  const j = await r.json().catch(() => null);
  return { httpOk: r.ok, ...(j || {}) };
}

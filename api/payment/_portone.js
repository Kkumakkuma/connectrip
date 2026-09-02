// 포트원 V2 결제 조회·검증·정산 공통 모듈 (2026-09-02, 토스 → 포트원(KG이니시스) 전환)
// confirm.js(사용자 복귀 경로)와 webhook.js(서버→서버 경로)가 같은 settleOrder 를 쓴다.
//
// 원칙
// - 금액·채널·상점은 "주문 생성 당시 서버 스냅샷"(ct_payment_orders.amount/channel_key/store_id)과만 대조.
// - 락: pending/failed/paid → confirming(lock_token·confirming_at). confirming→confirming 재획득 금지.
//   2분 넘은 stale confirming 만 새 토큰으로 회수. 실패/보류 전이는 자기 토큰일 때만.
// - 상태 분기: PG FAILED→failed, CANCELLED→canceled, 미완료/지연/5xx→pending(재시도), PAID 인데
//   금액·통화·채널·상점 불일치 또는 RPC 비정상→review(자동 재처리 금지, 관리자 확인).
// - 포인트 가산은 RPC ct_charge_points_by_payment 한 곳(원자·멱등, live 만 가산, test 는 paid_test).
import crypto from 'crypto';

const PORTONE_API = 'https://api.portone.io';
const PORTONE_TIMEOUT_MS = 8000;
export const STALE_LOCK_MS = 2 * 60_000;

const REVIEW_MSG = '결제는 완료됐습니다. 포인트 반영 확인이 필요해 곧 처리해 드립니다.';

/** 서버 env 묶음. PG_ENV 미설정은 test(fail-closed: 실제 포인트 가산 없음). */
export function portoneConfig() {
  const env = (process.env.PG_ENV || 'test') === 'live' ? 'live' : 'test';
  return {
    env,
    secret: (process.env.PORTONE_API_SECRET || '').trim(),
    storeId: (process.env.PORTONE_STORE_ID || '').trim(),
    channelKey: (process.env.PORTONE_PAY_CHANNEL_KEY || '').trim(),
  };
}

/** GET /payments/{paymentId}. { ok, payment } | { ok:false, code, retryable } */
export async function getPayment(secret, paymentId) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PORTONE_TIMEOUT_MS);
  try {
    const r = await fetch(`${PORTONE_API}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `PortOne ${secret}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => null);
    if (r.ok && j) return { ok: true, payment: j };
    if (r.status === 404) return { ok: false, code: 'not_found', retryable: true }; // 승인 직후 전파 지연 가능
    if (r.status === 401 || r.status === 403) return { ok: false, code: 'auth_' + r.status, retryable: false };
    return { ok: false, code: String(j?.type || 'http_' + r.status), retryable: r.status >= 500 || r.status === 429 };
  } catch (e) {
    return { ok: false, code: e?.name === 'AbortError' ? 'timeout' : 'network', retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 조회 결과를 주문 스냅샷과 대조.
 * { ok:true, paidAmount, pgTid, method } | { ok:false, code, kind: 'transient'|'failed'|'canceled'|'review' }
 */
export function verifyPaid(order, p) {
  const status = String(p?.status || '');
  if (status !== 'PAID') {
    if (status === 'FAILED') return { ok: false, code: 'pg_failed', kind: 'failed' };
    if (status === 'CANCELLED' || status === 'PARTIAL_CANCELLED') return { ok: false, code: 'pg_' + status.toLowerCase(), kind: 'canceled' };
    return { ok: false, code: 'not_paid_' + (status || 'unknown'), kind: 'transient' }; // READY / PENDING / VIRTUAL_ACCOUNT_ISSUED / PAY_PENDING
  }
  if (String(p.id || '') !== String(order.order_id)) return { ok: false, code: 'payment_id_mismatch', kind: 'review' };
  const total = p?.amount?.total;
  if (!Number.isInteger(total) || !Number.isInteger(order.amount) || total !== order.amount) return { ok: false, code: 'amount_mismatch', kind: 'review' };
  if (String(p.currency || '') !== 'KRW') return { ok: false, code: 'currency_mismatch', kind: 'review' };
  const chType = String(p?.channel?.type || '');
  if (chType !== (order.env === 'live' ? 'LIVE' : 'TEST')) return { ok: false, code: 'channel_env_mismatch', kind: 'review' };
  // 스냅샷 대조는 fail-closed: 응답에 값이 없어도 불일치로 본다(codex·agy 공통 지적).
  if (String(p?.channel?.key || '') !== String(order.channel_key || '')) return { ok: false, code: 'channel_key_mismatch', kind: 'review' };
  if (String(p?.storeId || '') !== String(order.store_id || '')) return { ok: false, code: 'store_mismatch', kind: 'review' };
  return {
    ok: true,
    paidAmount: total,
    // pg_tid 컬럼: PG 거래번호(pgTxId). 없으면 포트원 거래 ID(transactionId)를 멱등 식별자로 저장.
    pgTid: String(p.pgTxId || p.transactionId || ''),
    method: String(p?.method?.type || '').replace(/^PaymentMethod/, ''),
  };
}

const R = (http, body) => ({ http, body });
const doneBody = (o) => ({ ok: true, test: o.env !== 'live', credited: o.env === 'live' ? o.amount : 0, reused: true });

/** 주문 ID 로 조회 후 정산. 응답 정책은 호출자(confirm/webhook)가 http 로 판단. */
export async function settleOrder(supabase, orderId, { secret }) {
  const { data: order, error } = await supabase.from('ct_payment_orders').select('*').eq('order_id', orderId).maybeSingle();
  if (error) { console.error('[settle] lookup', orderId, error); return R(500, { ok: false, error: 'server_error', retryable: true }); }
  if (!order) return R(404, { ok: false, error: 'order_not_found' });
  return settleLoaded(supabase, order, { secret });
}

export async function settleLoaded(supabase, order, { secret }) {
  const orderId = order.order_id;
  if (order.status === 'credited' || order.status === 'paid_test') return R(200, doneBody(order));
  if (order.status === 'canceled') return R(409, { ok: false, error: 'canceled' });
  if (order.status === 'review') return R(200, { ok: false, error: 'credit_failed', code: 'review', message: REVIEW_MSG });

  // 락 획득: pending/failed/paid → confirming. stale(2분↑ 또는 시각 없음) confirming 만 회수.
  const token = crypto.randomUUID();
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS).toISOString();
  const { data: locked, error: lErr } = await supabase.from('ct_payment_orders')
    .update({ status: 'confirming', lock_token: token, confirming_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .or(`status.in.(pending,failed,paid),and(status.eq.confirming,confirming_at.lt.${staleBefore}),and(status.eq.confirming,confirming_at.is.null)`)
    .select('order_id').maybeSingle();
  if (lErr) { console.error('[settle] lock', orderId, lErr); return R(500, { ok: false, error: 'server_error', retryable: true }); }
  if (!locked) {
    const { data: o2 } = await supabase.from('ct_payment_orders').select('*').eq('order_id', orderId).maybeSingle();
    if (o2 && (o2.status === 'credited' || o2.status === 'paid_test')) return R(200, doneBody(o2));
    if (o2 && o2.status === 'review') return R(200, { ok: false, error: 'credit_failed', code: 'review', message: REVIEW_MSG });
    return R(409, { ok: false, error: 'busy', retryable: true });
  }
  // 자기 토큰일 때만 전이(다른 처리자가 회수한 락을 덮어쓰지 않게)
  const mine = (patch) => supabase.from('ct_payment_orders').update(patch)
    .eq('order_id', orderId).eq('lock_token', token).eq('status', 'confirming');

  const q = await getPayment(secret, orderId);
  if (!q.ok) {
    await mine({ status: 'pending', last_error: q.code });
    return R(q.retryable ? 503 : 502, { ok: false, error: 'confirm_failed', code: q.code, retryable: q.retryable });
  }
  const v = verifyPaid(order, q.payment);
  if (!v.ok) {
    const next = v.kind === 'failed' ? 'failed' : v.kind === 'canceled' ? 'canceled' : v.kind === 'review' ? 'review' : 'pending';
    await mine({ status: next, last_error: v.code });
    if (v.kind === 'transient') return R(503, { ok: false, error: 'confirm_failed', code: v.code, retryable: true });
    if (v.kind === 'review') { console.error('[settle] review', orderId, v.code); return R(200, { ok: false, error: 'credit_failed', code: v.code, message: REVIEW_MSG }); }
    return R(402, { ok: false, error: 'confirm_failed', code: v.code, retryable: false });
  }

  // 승인 확인 → 원자 RPC(금액 대조 + credited/paid_test 전이 + 가산 + 멱등)
  const { data: charge, error: cErr } = await supabase.rpc('ct_charge_points_by_payment', {
    p_order_id: orderId, p_paid_amount: v.paidAmount, p_pg_tid: v.pgTid, p_method: v.method,
  });
  if (cErr) {
    // DB 일시 장애 가능성 — confirming 유지(stale 회수로 재시도), 결제는 PAID 이므로 failed 로 내리지 않는다.
    console.error('[settle] charge rpc', orderId, cErr);
    await mine({ last_error: 'rpc_error' });
    return R(503, { ok: false, error: 'credit_failed', code: 'rpc_error', retryable: true, message: '결제는 완료됐습니다. 포인트 반영 중 문제가 있어 확인 후 처리해 드립니다.' });
  }
  const st = charge?.status;
  if (st === 'ok') return R(200, { ok: true, test: false, credited: charge.credited ?? 0 });
  if (st === 'test') return R(200, { ok: true, test: true, credited: 0 });
  console.error('[settle] charge non-ok', orderId, charge);
  await mine({ status: 'review', last_error: 'rpc_' + String(st || 'unknown') });
  return R(200, { ok: false, error: 'credit_failed', code: st, message: REVIEW_MSG });
}

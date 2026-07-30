// Vercel Serverless: 포인트 충전 결제 승인 + 충전 (2026-07-30, 토스페이먼츠)
// POST /api/payment/confirm   body: { paymentKey, orderId, amount }
//
// 상태머신 + reconcile(장애 후 재호출 대비). 금액은 반드시 원장(ct_payment_orders.amount)으로만.
// 라이브(env='live')만 실제 포인트 충전. 테스트는 잔액 절대 안 건드림(RPC 가 이중 방어).
import { createClient } from '@supabase/supabase-js';
import { applyCors } from '../_cors.js';

const TEST_SECRET_KEY = 'test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6'; // 토스 공식 공개 테스트키

async function tossConfirm(secretKey, orderId, paymentKey, expectedAmount) {
  const auth = 'Basic ' + Buffer.from(secretKey + ':').toString('base64'); // ★키 뒤 콜론 필수
  const r = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentKey, orderId, amount: expectedAmount }),
  });
  const j = await r.json().catch(() => null);
  if (r.ok && j) return { ok: true, tid: String(j.paymentKey), paidAmount: Number(j.totalAmount), method: String(j.method || '') };
  const code = String(j?.code || 'http_' + r.status);
  return { ok: false, code, retryable: r.status >= 500, alreadyDone: code === 'ALREADY_PROCESSED_PAYMENT' };
}

async function tossQuery(secretKey, orderId, expectedAmount) {
  const auth = 'Basic ' + Buffer.from(secretKey + ':').toString('base64');
  const r = await fetch('https://api.tosspayments.com/v1/payments/orders/' + encodeURIComponent(orderId), {
    headers: { Authorization: auth },
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) return { ok: false, code: String(j?.code || 'query_http_' + r.status), retryable: r.status >= 500 };
  if (j.status !== 'DONE') return { ok: false, code: 'not_done_' + String(j.status), retryable: false };
  if (Number(j.totalAmount) !== expectedAmount) return { ok: false, code: 'amount_mismatch', retryable: false };
  return { ok: true, tid: String(j.paymentKey), paidAmount: Number(j.totalAmount), method: String(j.method || '') };
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });

  try {
    const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
    const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!SUPA_URL || !SUPA_KEY) return res.status(500).json({ ok: false, error: '서버 설정 오류' });

    const body = req.body || {};
    const orderId = String(body.orderId || '').trim();
    const paymentKey = String(body.paymentKey || '').trim();
    if (!orderId || !paymentKey) return res.status(400).json({ ok: false, error: 'bad_request' });

    const supabase = createClient(SUPA_URL, SUPA_KEY);

    // 로그인 사용자 확인(codex P2): 유출된 주문 ID 로 남이 상태조회·실패전환 DoS 하는 것 차단.
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return res.status(401).json({ ok: false, error: 'login_required' });
    const { data: userData, error: uErr } = await supabase.auth.getUser(token);
    if (uErr || !userData?.user) return res.status(401).json({ ok: false, error: 'invalid_session' });
    const userId = userData.user.id;

    // 주문 조회
    const { data: order, error: qErr } = await supabase.from('ct_payment_orders')
      .select('*').eq('order_id', orderId).maybeSingle();
    if (qErr) { console.error('[confirm] lookup', qErr); return res.status(500).json({ ok: false, error: 'server_error' }); }
    if (!order) return res.status(404).json({ ok: false, error: 'order_not_found' });
    if (order.user_id !== userId) return res.status(403).json({ ok: false, error: 'not_your_order' });

    // env/키 결합 검증(codex P1): 라이브 주문은 라이브 시크릿 필수. 테스트키 fallback 금지
    //   (PG_ENV=live 인데 라이브 키 누락 시 테스트키로 승인해 실제 포인트 지급되는 사고 차단).
    const secretKey = (process.env.TOSS_SECRET_KEY || '').trim() || (order.env === 'live' ? '' : TEST_SECRET_KEY);
    if (!secretKey || (order.env === 'live' && /^test_/.test(secretKey))) {
      console.error('[confirm] live secret key missing/invalid for order', orderId);
      return res.status(500).json({ ok: false, error: 'pg_unconfigured' });
    }

    // 이미 처리 완료면 멱등 반환
    if (order.status === 'credited' || order.status === 'paid_test') {
      return res.status(200).json({ ok: true, test: order.env !== 'live', credited: order.env === 'live' ? order.amount : 0, reused: true });
    }
    if (order.status === 'canceled') return res.status(409).json({ ok: false, error: 'canceled' });

    const expectedAmount = Number(order.amount);

    // 원자적 전이: pending/failed/confirming → confirming
    const { data: locked } = await supabase.from('ct_payment_orders')
      .update({ status: 'confirming' })
      .eq('order_id', orderId).in('status', ['pending', 'failed', 'confirming'])
      .select('order_id').maybeSingle();
    if (!locked) {
      const { data: o2 } = await supabase.from('ct_payment_orders').select('status,env,amount').eq('order_id', orderId).maybeSingle();
      if (o2 && (o2.status === 'credited' || o2.status === 'paid_test')) {
        return res.status(200).json({ ok: true, test: o2.env !== 'live', credited: o2.env === 'live' ? o2.amount : 0, reused: true });
      }
      return res.status(409).json({ ok: false, error: 'busy' });
    }

    // 승인. 금액은 원장 금액으로만.
    let result = await tossConfirm(secretKey, orderId, paymentKey, expectedAmount);
    if (!result.ok && result.alreadyDone) result = await tossQuery(secretKey, orderId, expectedAmount);

    if (!result.ok) {
      // 실패 전환은 confirming 상태일 때만(성공 처리된 주문을 덮어쓰지 않게 — codex P1)
      await supabase.from('ct_payment_orders').update({ status: 'failed' }).eq('order_id', orderId).eq('status', 'confirming');
      return res.status(402).json({ ok: false, error: 'confirm_failed', code: result.code, retryable: result.retryable });
    }

    // 승인 성공 → 원자 RPC 하나로 (금액 대조 + paid/credited 전환 + 충전 + 멱등).
    // JS 에서 별도 'paid' UPDATE 를 하지 않는다(그 사이 장애 시 미충전 갭이 생기던 것 제거 — codex P1).
    const { data: charge, error: cErr } = await supabase.rpc('ct_charge_points_by_payment', {
      p_order_id: orderId, p_paid_amount: result.paidAmount, p_pg_tid: result.tid, p_method: result.method,
    });
    if (cErr) {
      console.error('[confirm] charge rpc', orderId, cErr);
      return res.status(200).json({ ok: false, error: 'credit_failed', message: '결제는 완료됐습니다. 포인트 반영 중 문제가 있어 확인 후 처리해 드립니다.' });
    }
    const st = charge?.status;
    if (st === 'ok') return res.status(200).json({ ok: true, test: false, credited: charge.credited ?? 0 });
    if (st === 'test') return res.status(200).json({ ok: true, test: true, credited: 0 });
    // amount_mismatch / not_payable / user_not_found / not_found 등 — 결제는 됐으나 이행 보류
    console.error('[confirm] charge non-ok', orderId, charge);
    return res.status(200).json({ ok: false, error: 'credit_failed', code: st, message: '결제는 완료됐습니다. 포인트 반영 중 확인이 필요해 곧 처리해 드립니다.' });
  } catch (e) {
    console.error('[confirm] 예외', e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

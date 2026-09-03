// Vercel Serverless: 포인트 충전 결제 확인 + 충전 (2026-09-02, 포트원 V2)
// POST /api/payment/confirm   body: { paymentId }   header: Authorization: Bearer <supabase access_token>
//
// paymentId = 주문 ID(ct-…/test-…). 결제 결과의 진실은 포트원 결제 조회(GET /payments/{id})이며,
// 금액·채널·상점은 주문 스냅샷과만 대조한다(_portone.js settleLoaded). 멱등: 몇 번 불러도 안전.
// 사용자 경로라 주문 소유자(JWT)만 호출 가능. 서버→서버 경로는 webhook.js.
import { createClient } from '@supabase/supabase-js';
import { applyCors } from '../_cors.js';
import { portoneConfig, settleLoaded, paymentsEnabled } from './_portone.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });
  if (!paymentsEnabled()) return res.status(404).json({ ok: false, error: 'payments_disabled' });
  try {
    const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
    const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!SUPA_URL || !SUPA_KEY) return res.status(500).json({ ok: false, error: '서버 설정 오류' });

    const body = req.body || {};
    const paymentId = String(body.paymentId || body.orderId || '').trim();
    if (!paymentId || !/^(ct|test)-[a-f0-9]{20}$/.test(paymentId)) return res.status(400).json({ ok: false, error: 'bad_request' });

    const supabase = createClient(SUPA_URL, SUPA_KEY);
    // 로그인 사용자 확인: 유출된 주문 ID 로 남이 상태조회·전이 유발하는 것 차단.
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return res.status(401).json({ ok: false, error: 'login_required' });
    const { data: userData, error: uErr } = await supabase.auth.getUser(token);
    if (uErr || !userData?.user) return res.status(401).json({ ok: false, error: 'invalid_session' });
    const userId = userData.user.id;

    const { data: order, error: qErr } = await supabase.from('ct_payment_orders').select('*').eq('order_id', paymentId).maybeSingle();
    if (qErr) { console.error('[confirm] lookup', qErr); return res.status(500).json({ ok: false, error: 'server_error' }); }
    if (!order) return res.status(404).json({ ok: false, error: 'order_not_found' });
    if (order.user_id !== userId) return res.status(403).json({ ok: false, error: 'not_your_order' });

    const { secret } = portoneConfig();
    if (!secret) {
      console.error('[confirm] PORTONE_API_SECRET missing');
      return res.status(503).json({ ok: false, error: 'pg_unconfigured', retryable: true });
    }
    const r = await settleLoaded(supabase, order, { secret });
    return res.status(r.http).json(r.body);
  } catch (e) {
    console.error('[confirm] 예외', e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

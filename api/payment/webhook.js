// Vercel Serverless(Web 핸들러): 포트원 V2 웹훅 수신 (2026-09-02)
// POST /api/payment/webhook  — 포트원 콘솔 "결제알림(Webhook) 관리"에 등록. 서명 시크릿은 PORTONE_WEBHOOK_SECRET.
//
// 역할: 사용자가 결제 후 브라우저/앱을 닫아 confirm 을 못 부른 경우의 복구 경로.
// 웹훅 본문은 "트리거"로만 쓰고, 진실은 settleOrder 안의 포트원 결제 조회(API Secret)로 다시 확인한다.
// - 서명 검증: @portone/server-sdk Webhook.verify(Standard Webhooks). 원문(raw text)으로 검증해야 하므로
//   Web 표준 Request 를 쓰는 핸들러(request.text())로 구현(레거시 (req,res) 는 본문이 미리 파싱됨).
// - 시크릿 미설정이면 503(fail-closed). 서명 없는 트리거를 받으면 임의 주문 조회·락으로 DoS 가 가능하므로 허용하지 않는다.
// - 응답: 최종 결과(처리 완료·무시 대상·PG 실패/취소·주문 없음)는 200, 일시 장애(조회 timeout/5xx·락 경합·DB)는 503 → 포트원 재시도.
import { createClient } from '@supabase/supabase-js';
import * as PortOne from '@portone/server-sdk';
import { portoneConfig, settleOrder, paymentsEnabled } from './_portone.js';

const MAX_BODY = 64 * 1024;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function POST(request) {
  if (!paymentsEnabled()) return json(200, { ok: true, ignored: 'payments_disabled' });
  try {
    const raw = await request.text();
    if (!raw || raw.length > MAX_BODY) return json(413, { ok: false, error: 'body_too_large' });

    const headers = {};
    request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

    const whSecret = (process.env.PORTONE_WEBHOOK_SECRET || '').trim();
    if (!whSecret) { console.error('[webhook] PORTONE_WEBHOOK_SECRET missing'); return json(503, { ok: false, error: 'webhook_unconfigured' }); }
    let evt = null;
    try {
      evt = await PortOne.Webhook.verify(whSecret, raw, headers);
    } catch (e) {
      console.warn('[webhook] signature rejected', e?.reason || e?.message || e);
      return json(400, { ok: false, error: 'bad_signature' });
    }

    const type = String(evt?.type || '');
    if (type !== 'Transaction.Paid') return json(200, { ok: true, ignored: type || 'unknown' });
    const paymentId = String(evt?.data?.paymentId || '').trim();
    if (!/^(ct|test)-[a-f0-9]{20}$/.test(paymentId)) return json(200, { ok: true, ignored: 'foreign_payment_id' });

    const { secret, storeId } = portoneConfig();
    if (storeId && evt?.data?.storeId && evt.data.storeId !== storeId) return json(200, { ok: true, ignored: 'other_store' });
    if (!secret) { console.error('[webhook] PORTONE_API_SECRET missing'); return json(503, { ok: false, error: 'pg_unconfigured' }); }

    const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
    const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!SUPA_URL || !SUPA_KEY) return json(503, { ok: false, error: 'server_unconfigured' });
    const supabase = createClient(SUPA_URL, SUPA_KEY);

    const r = await settleOrder(supabase, paymentId, { secret });
    const transient = r.http === 503 || r.http === 500 || (r.http === 409 && r.body?.error === 'busy');
    return json(transient ? 503 : 200, { ...r.body, settled_http: r.http });
  } catch (e) {
    console.error('[webhook] 예외', e);
    return json(503, { ok: false, error: 'server_error' });
  }
}

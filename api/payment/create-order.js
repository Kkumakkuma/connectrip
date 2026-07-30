// Vercel Serverless: 포인트 충전 주문 생성 (2026-07-30, 토스페이먼츠 사전 배치)
// POST /api/payment/create-order   body: { amount }   header: Authorization: Bearer <supabase access_token>
//
// - 로그인 사용자만(서버가 JWT 로 본인 확인). 금액은 서버가 범위 검증.
// - env 는 서버 환경변수 PG_ENV 에서만(없으면 test = fail-closed). 테스트는 실제 결제·충전 안 됨.
// - 결과로 토스 clientKey(공개값)만 내려준다. 시크릿 키는 절대 응답에 안 넣는다.
//
// 라이브 전환: Vercel 환경변수 TOSS_CLIENT_KEY(live_gck_*)·TOSS_SECRET_KEY(live_gsk_*)·PG_ENV=live 설정.
//   (Solapi/Resend 키와 동일 방식). 설정 전엔 토스 공식 공개 테스트키로 결제창까지만 뜬다.
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { applyCors } from '../_cors.js';

// 토스 공식 문서 공개 테스트키(가입 불필요). 라이브는 env 로 덮어쓴다.
const TEST_CLIENT_KEY = 'test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm';

const MIN_AMOUNT = 1000;       // 최소 충전 1,000원
const MAX_AMOUNT = 1_000_000;  // 최대 충전 100만원(1회)

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });

  try {
    const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
    const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!SUPA_URL || !SUPA_KEY) return res.status(500).json({ ok: false, error: '서버 설정 오류' });

    const env = (process.env.PG_ENV || 'test') === 'live' ? 'live' : 'test';
    // env/키 결합 검증(codex P1): 라이브는 라이브 clientKey 필수. 테스트키 fallback 금지.
    const clientKey = (process.env.TOSS_CLIENT_KEY || '').trim() || (env === 'live' ? '' : TEST_CLIENT_KEY);
    if (!clientKey || (env === 'live' && /^test_/.test(clientKey))) {
      console.error('[create-order] live client key missing/invalid');
      return res.status(500).json({ ok: false, error: 'pg_unconfigured' });
    }

    // 로그인 사용자 확인 — 클라가 준 user_id 는 신뢰하지 않고 JWT 로 서버가 판정
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return res.status(401).json({ ok: false, error: 'login_required' });

    const supabase = createClient(SUPA_URL, SUPA_KEY);
    const { data: userData, error: uErr } = await supabase.auth.getUser(token);
    if (uErr || !userData?.user) return res.status(401).json({ ok: false, error: 'invalid_session' });
    const userId = userData.user.id;

    // 금액 검증(서버 권위). 정수·범위.
    const amount = Number((req.body || {}).amount);
    if (!Number.isInteger(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
      return res.status(400).json({ ok: false, error: `충전 금액은 ${MIN_AMOUNT.toLocaleString()}~${MAX_AMOUNT.toLocaleString()}원입니다.` });
    }

    // 간단 rate limit: 최근 10분 미완료 주문 20건 초과면 거부
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await supabase.from('ct_payment_orders')
      .select('order_id', { count: 'exact', head: true })
      .eq('user_id', userId).gte('created_at', since);
    if ((count || 0) >= 20) return res.status(429).json({ ok: false, error: 'rate_limited' });

    const orderId = (env === 'live' ? 'ct-' : 'test-') +
      crypto.randomUUID().replace(/-/g, '').slice(0, 20);

    const { error: insErr } = await supabase.from('ct_payment_orders').insert({
      order_id: orderId, user_id: userId, amount, currency: 'KRW',
      provider: 'toss', env, status: 'pending',
    });
    if (insErr) { console.error('[create-order] insert', insErr); return res.status(500).json({ ok: false, error: 'server_error' }); }

    return res.status(200).json({
      ok: true, orderId, amount, currency: 'KRW', provider: 'toss', env,
      orderName: `ConnectTrip 포인트 충전 ${amount.toLocaleString()}P`,
      pgParams: { clientKey },
    });
  } catch (e) {
    console.error('[create-order] 예외', e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

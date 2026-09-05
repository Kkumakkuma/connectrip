// Vercel Serverless: 포인트 충전 주문 생성 (2026-09-02, 포트원 V2 · PG=KG이니시스. 토스 직접연동 폐기)
// POST /api/payment/create-order   body: { amount }   header: Authorization: Bearer <supabase access_token>
//
// - 로그인 사용자만(서버가 JWT 로 본인 확인). 금액은 서버가 고정 패키지 화이트리스트로 검증.
// - env 는 서버 환경변수 PG_ENV 에서만(없으면 test = fail-closed). 테스트 주문은 실제 포인트 가산 없음.
// - 결제창 파라미터(storeId·channelKey 는 공개값)는 서버 env 에서 내려준다 — PG_ENV 와 채널 키의 결합을
//   서버 한곳에서 통제하고, 주문 행에 store_id/channel_key 스냅샷을 남겨 승인 시 대조한다.
// - 구매자 정보(customer)는 KG이니시스 PC 결제창 요건(이름·전화·이메일). 로그에 남기지 않는다.
//
// 환경변수: PORTONE_STORE_ID, PORTONE_PAY_CHANNEL_KEY(테스트 채널 → 계약 후 라이브 채널로 교체), PG_ENV,
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. (PORTONE_API_SECRET 은 승인 단계에서 사용)
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { applyCors } from '../_cors.js';
import { portoneConfig, paymentsEnabled } from './_portone.js';

// 허용 금액 = 고정 패키지만(src/lib/products.js POINT_PACKAGES 와 동기). 임의 금액은 PG 심사 요건(임의가격 불가)으로 차단.
const ALLOWED_AMOUNTS = [10000, 30000, 50000, 100000];

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });
  if (!paymentsEnabled()) return res.status(404).json({ ok: false, error: 'payments_disabled' });
  try {
    const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
    const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!SUPA_URL || !SUPA_KEY) return res.status(500).json({ ok: false, error: '서버 설정 오류' });

    const { env, storeId, channelKey } = portoneConfig();
    // fail-closed: 상점/채널 키 없으면 주문 자체를 만들지 않는다(라이브·테스트 공통).
    if (!storeId || !channelKey) {
      console.error('[create-order] portone store/channel key missing (env=' + env + ')');
      return res.status(503).json({ ok: false, error: 'pg_unconfigured' });
    }

    // 로그인 사용자 확인 — 클라가 준 user_id 는 신뢰하지 않고 JWT 로 서버가 판정
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return res.status(401).json({ ok: false, error: 'login_required' });
    const supabase = createClient(SUPA_URL, SUPA_KEY);
    const { data: userData, error: uErr } = await supabase.auth.getUser(token);
    if (uErr || !userData?.user) return res.status(401).json({ ok: false, error: 'invalid_session' });
    const user = userData.user;
    const userId = user.id;

    // 금액 검증(서버 권위). 고정 패키지 금액만 허용.
    const amount = Number((req.body || {}).amount);
    if (!Number.isInteger(amount) || !ALLOWED_AMOUNTS.includes(amount)) {
      return res.status(400).json({ ok: false, error: `충전 금액은 ${ALLOWED_AMOUNTS.map((v) => v.toLocaleString()).join('·')}원 중 하나여야 합니다.` });
    }

    // 간단 rate limit: 최근 10분 주문 20건 초과면 거부
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await supabase.from('ct_payment_orders')
      .select('order_id', { count: 'exact', head: true })
      .eq('user_id', userId).gte('created_at', since);
    if ((count || 0) >= 20) return res.status(429).json({ ok: false, error: 'rate_limited' });

    // 구매자 정보(이니시스 V2 일반결제 요건: 이름·휴대폰·이메일 전부 필수 — 휴대폰 없으면 SDK 가 '구매자 휴대폰 번호는 필수' 로 결제창 호출 실패, 2026-09-03 실측). 프로필 값 우선, 이메일은 계정 이메일 fallback.
    // 값은 로그에 남기지 않는다(누락 필드명만).
    const { data: prof, error: pErr } = await supabase.from('profiles').select('name, nickname, phone, email').eq('id', userId).maybeSingle();
    if (pErr) { console.error('[create-order] profile lookup', pErr.code || pErr.message); return res.status(500).json({ ok: false, error: 'server_error' }); }
    const customer = {
      customerId: userId,
      fullName: String(prof?.name || prof?.nickname || '').trim() || undefined,
      phoneNumber: String(prof?.phone || '').replace(/[^0-9+]/g, '') || undefined,
      email: String(prof?.email || user.email || '').trim() || undefined,
    };
    const missing = ['fullName', 'phoneNumber', 'email'].filter((k) => !customer[k]);
    if (missing.length) {
      console.warn('[create-order] customer incomplete', missing.join(','));
      return res.status(400).json({ ok: false, error: 'customer_incomplete', missing });
    }

    const orderId = (env === 'live' ? 'ct-' : 'test-') + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const { error: insErr } = await supabase.from('ct_payment_orders').insert({
      order_id: orderId, user_id: userId, amount, currency: 'KRW',
      provider: 'portone', env, status: 'pending',
      store_id: storeId, channel_key: channelKey,
    });
    if (insErr) { console.error('[create-order] insert', insErr); return res.status(500).json({ ok: false, error: 'server_error' }); }

    return res.status(200).json({
      ok: true, orderId, amount, currency: 'KRW', provider: 'portone', env,
      orderName: `ConnectTrip 포인트 충전 ${amount.toLocaleString()}P`,
      pgParams: { storeId, channelKey },
      customer,
    });
  } catch (e) {
    // 예외 원문은 서버 로그에만. 응답엔 고정 code + 일반 문구만 싣는다.
    console.error('[create-order] 예외', e);
    return res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: 'server_error' });
  }
}

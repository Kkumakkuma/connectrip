// Vercel Serverless Function: SMS OTP 발송
// POST /api/send-otp
// body: { phone: "01012345678" }
// Solapi HTTP API v4 + HMAC-SHA256 서명

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

function solapiAuthHeader(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(date + salt)
    .digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const phoneRaw = String(body.phone || '');
    const cleaned = phoneRaw.replace(/[^0-9]/g, '');

    if (!/^01[016789][0-9]{7,8}$/.test(cleaned)) {
      return res.status(400).json({
        ok: false,
        error: '휴대폰 번호 형식이 올바르지 않습니다.'
      });
    }

    const SUPA_URL = process.env.SUPABASE_URL;
    const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SOLAPI_KEY = process.env.SOLAPI_API_KEY;
    const SOLAPI_SECRET = process.env.SOLAPI_API_SECRET;
    const SOLAPI_FROM = process.env.SOLAPI_SENDER_NUMBER;

    if (!SUPA_URL || !SUPA_KEY || !SOLAPI_KEY || !SOLAPI_SECRET || !SOLAPI_FROM) {
      console.error('[send-otp] 환경변수 누락', {
        hasSupaUrl: !!SUPA_URL,
        hasSupaKey: !!SUPA_KEY,
        hasSolapiKey: !!SOLAPI_KEY,
        hasSolapiSecret: !!SOLAPI_SECRET,
        hasSolapiFrom: !!SOLAPI_FROM,
      });
      return res.status(500).json({ ok: false, error: '서버 설정 오류' });
    }

    const supabase = createClient(SUPA_URL, SUPA_KEY);

    // 레이트리밋: 같은 번호에 최근 60초 내 발송 이력 있으면 차단
    const sixtySecAgo = new Date(Date.now() - 60_000).toISOString();
    const { data: recent } = await supabase
      .from('phone_otps')
      .select('id')
      .eq('phone', cleaned)
      .gte('created_at', sixtySecAgo)
      .limit(1);
    if (recent && recent.length > 0) {
      return res.status(429).json({
        ok: false,
        error: '인증번호 발송은 60초마다 1회만 가능합니다. 잠시 후 다시 시도하세요.'
      });
    }

    // 6자리 OTP 생성 (crypto 안전)
    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { error: insErr } = await supabase.from('phone_otps').insert({
      phone: cleaned,
      code,
      expires_at: expiresAt,
      ip_address: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || null,
    });
    if (insErr) {
      console.error('[send-otp] DB insert 오류', insErr);
      return res.status(500).json({ ok: false, error: 'DB 저장 실패' });
    }

    // Solapi 발송
    const solResp = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: {
        Authorization: solapiAuthHeader(SOLAPI_KEY, SOLAPI_SECRET),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          to: cleaned,
          from: String(SOLAPI_FROM).replace(/[^0-9]/g, ''),
          text: `[ConnectTrip] 인증번호 ${code} (5분 유효). 이 번호는 발신전용입니다.`,
        },
      }),
    });
    const solData = await solResp.json();
    if (!solResp.ok) {
      console.error('[send-otp] Solapi 발송 실패', solResp.status, solData);
      return res.status(502).json({
        ok: false,
        error: 'SMS 발송에 실패했습니다. 잠시 후 다시 시도하세요.',
      });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[send-otp] 예외', e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

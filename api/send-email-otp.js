// Vercel Serverless Function: 이메일 OTP 발송 (Resend 사용)
// POST /api/send-email-otp  body: { email: "user@example.com" }

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();

    if (!/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(email)) {
      return res.status(400).json({ ok: false, error: '이메일 형식이 올바르지 않습니다.' });
    }

    const SUPA_URL = process.env.SUPABASE_URL;
    const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const RESEND_KEY = process.env.RESEND_API_KEY;
    const FROM = (process.env.EMAIL_FROM_ADDRESS || 'onboarding@resend.dev').trim();

    if (!SUPA_URL || !SUPA_KEY || !RESEND_KEY) {
      console.error('[send-email-otp] 환경변수 누락', {
        hasSupaUrl: !!SUPA_URL,
        hasSupaKey: !!SUPA_KEY,
        hasResendKey: !!RESEND_KEY,
      });
      return res.status(500).json({ ok: false, error: '서버 설정 오류' });
    }

    const supabase = createClient(SUPA_URL, SUPA_KEY);

    // 60초 레이트리밋
    const sixtySecAgo = new Date(Date.now() - 60_000).toISOString();
    const { data: recent } = await supabase
      .from('email_otps')
      .select('id')
      .eq('email', email)
      .gte('created_at', sixtySecAgo)
      .limit(1);
    if (recent && recent.length > 0) {
      return res.status(429).json({
        ok: false,
        error: '인증번호 발송은 60초마다 1회만 가능합니다.',
      });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { error: insErr } = await supabase.from('email_otps').insert({
      email,
      code,
      expires_at: expiresAt,
      ip_address: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || null,
    });
    if (insErr) {
      console.error('[send-email-otp] DB insert 오류', insErr);
      return res.status(500).json({ ok: false, error: 'DB 저장 실패' });
    }

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: '[ConnectTrip] 이메일 인증번호',
        html: `<div style="font-family:'Noto Sans KR',sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#ffffff">
  <h1 style="font-size:20px;color:#1e3a8a;margin-bottom:12px">ConnectTrip 이메일 인증</h1>
  <p style="color:#334155;font-size:15px;line-height:1.6">아래 6자리 인증번호를 회원가입 화면에 입력해주세요.</p>
  <div style="font-size:32px;font-weight:700;color:#2563eb;letter-spacing:8px;text-align:center;background:#eff6ff;padding:20px 0;border-radius:12px;margin:24px 0">${code}</div>
  <p style="color:#64748b;font-size:13px;line-height:1.6">이 인증번호는 5분간 유효합니다.<br>본인이 요청하지 않았다면 이 이메일을 무시하셔도 됩니다.</p>
  <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="color:#94a3b8;font-size:12px">ConnectTrip — 여행자·승무원 커뮤니티</p>
</div>`,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error('[send-email-otp] Resend 발송 실패', resp.status, data);
      return res.status(502).json({
        ok: false,
        error: '이메일 발송에 실패했습니다. 잠시 후 다시 시도하세요.',
      });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[send-email-otp] 예외', e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

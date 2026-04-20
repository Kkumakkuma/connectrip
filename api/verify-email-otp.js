// Vercel Serverless Function: 이메일 OTP 검증
// POST /api/verify-email-otp  body: { email, code }

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').replace(/[^0-9]/g, '');

    if (!/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(email)) {
      return res.status(400).json({ ok: false, error: '이메일 형식이 올바르지 않습니다.' });
    }
    if (code.length !== 6) {
      return res.status(400).json({ ok: false, error: '인증번호 6자리를 입력해주세요.' });
    }

    const SUPA_URL = process.env.SUPABASE_URL;
    const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPA_URL || !SUPA_KEY) {
      return res.status(500).json({ ok: false, error: '서버 설정 오류' });
    }

    const supabase = createClient(SUPA_URL, SUPA_KEY);
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('email_otps')
      .select('id, expires_at, verified_at')
      .eq('email', email)
      .eq('code', code)
      .is('verified_at', null)
      .gte('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[verify-email-otp] DB 조회 오류', error);
      return res.status(500).json({ ok: false, error: 'DB 조회 실패' });
    }
    if (!data) {
      return res.status(400).json({
        ok: false,
        error: '인증번호가 일치하지 않거나 만료되었습니다.',
      });
    }

    await supabase
      .from('email_otps')
      .update({ verified_at: now })
      .eq('id', data.id);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[verify-email-otp] 예외', e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

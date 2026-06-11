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

    // ① 해당 이메일의 최신 유효 OTP 행을 코드와 무관하게 먼저 조회
    //    (브루트포스 시도 횟수를 추적하기 위해 코드 일치 여부와 분리)
    // attempts 컬럼 포함 조회를 우선 시도하고, 컬럼 미존재(SQL 미적용)면 attempts 없이 폴백.
    // 전환기 폴백: email_otps.attempts 컬럼 추가 SQL 적용 후 폴백 분기는 제거 가능.
    const queryRow = (cols) => supabase
      .from('email_otps')
      .select(cols)
      .eq('email', email)
      .is('verified_at', null)
      .gte('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let { data: row, error } = await queryRow('id, code, expires_at, verified_at, attempts');
    if (error) {
      // attempts 컬럼 미존재 등으로 실패하면 attempts 없이 재조회
      ({ data: row, error } = await queryRow('id, code, expires_at, verified_at'));
    }

    if (error) {
      console.error('[verify-email-otp] DB 조회 오류', error);
      return res.status(500).json({ ok: false, error: 'DB 조회 실패' });
    }

    // ② 유효한 발급 OTP 자체가 없으면 400
    if (!row) {
      return res.status(400).json({
        ok: false,
        error: '인증번호가 일치하지 않거나 만료되었습니다.',
      });
    }

    // ③ 시도 횟수 초과 시 코드 일치 여부와 무관하게 429 (브루트포스 차단)
    if ((row.attempts || 0) >= 5) {
      return res.status(429).json({
        ok: false,
        error: '시도 횟수 초과. 새 인증번호를 요청해주세요.',
      });
    }

    // ④ 코드 불일치: attempts +1 후 400
    if (row.code !== code) {
      // 원자 증가 RPC 우선(동시 오답 경쟁에도 카운트 보존), 미존재 시 read-modify-write 폴백.
      // attempts 컬럼/RPC 미존재(SQL 미적용) 시 실패는 무시 (전환기 호환)
      const { error: bumpErr } = await supabase.rpc('bump_email_otp_attempts', { p_id: row.id });
      if (bumpErr) {
        const { error: updErr } = await supabase
          .from('email_otps')
          .update({ attempts: (row.attempts || 0) + 1 })
          .eq('id', row.id);
        if (updErr) console.warn('[verify-email-otp] attempts bump skipped:', updErr.code, updErr.message);
      }
      return res.status(400).json({
        ok: false,
        error: '인증번호가 일치하지 않거나 만료되었습니다.',
      });
    }

    // ⑤ 일치: verified_at 기록
    await supabase
      .from('email_otps')
      .update({ verified_at: now })
      .eq('id', row.id);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[verify-email-otp] 예외', e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

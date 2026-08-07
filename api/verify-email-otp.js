// Vercel Serverless Function: 이메일 OTP 검증
// POST /api/verify-email-otp  body: { email, code, purpose? }
// 성공 시 일회성 소비 토큰(verifyToken)을 발급한다. 가입 완료 RPC 가 이 토큰을 요구하므로,
// 실제로 인증을 통과한 그 클라이언트만 인증 결과를 사용할 수 있다.

import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'node:crypto';
import { applyCors } from './_cors.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return; // 앱(Capacitor) 교차 출처 허용 + OPTIONS 종결
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').replace(/[^0-9]/g, '');
    const purpose = String(body.purpose || 'generic');

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

    // 토큰은 원문을 클라이언트에만 주고 DB 에는 해시만 저장한다(DB 유출 시 그대로 쓰이지 않도록).
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    // 조회·검증·토큰기록을 DB 함수 한 트랜잭션에서 처리(동시 검증 시 마지막 토큰만 남는 경쟁 제거).
    const { data: result, error } = await supabase.rpc('verify_otp_and_issue_token', {
      p_kind: 'email',
      p_subject: email,
      p_code: code,
      p_token_hash: tokenHash,
      p_purpose: purpose,
    });

    if (error) {
      console.error('[verify-email-otp] RPC 오류', error);
      return res.status(500).json({ ok: false, error: '인증 처리에 실패했습니다.' });
    }

    if (result === 'too_many_attempts') {
      return res.status(429).json({ ok: false, error: '시도 횟수 초과. 새 인증번호를 요청해주세요.' });
    }
    if (result !== 'ok') {
      // not_found / mismatch 는 동일 문구로 응답(존재 여부 노출 방지)
      return res.status(400).json({ ok: false, error: '인증번호가 일치하지 않거나 만료되었습니다.' });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, verifyToken: token });
  } catch (e) {
    console.error('[verify-email-otp] 예외', e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

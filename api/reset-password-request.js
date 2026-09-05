// Vercel Serverless Function: 비밀번호 찾기 1단계 — 아이디로 인증번호 발송
// POST /api/reset-password-request  body: { login_id }
// 응답은 계정 존재 여부와 무관하게 200 { ok: true } (열거 방지). 형식 오류·레이트리밋만 4xx.
//
// 흐름: 아이디 → profiles.login_id 로 연락 이메일 조회(service_role RPC) → password_resets 챌린지 발급
//       (user_id 결합, 이전 챌린지 무효, 60초 쿨다운) → HMAC 해시만 저장, 원문은 메일로만.
// Supabase 표준 resetPasswordForEmail 은 쓰지 않는다(Auth 주소가 합성 주소라 수신 불가).

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { applyCors } from './_cors.js';
import { normalizeLoginId } from './_login_id.js';
import { hashOtp, otpHashSecret } from './_otp_hash.js';
import { sendCodeMail } from './_mail.js';

const fail = (res, status, code, error) => res.status(status).json({ ok: false, code, error });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OK_MSG = { ok: true };

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }
  const started = Date.now();
  // 존재/미존재 경로의 응답 시간을 비슷하게 맞춘다(최소 400ms).
  const finishOk = async () => {
    const wait = 400 - (Date.now() - started);
    if (wait > 0) await sleep(wait);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(OK_MSG);
  };

  try {
    const loginId = normalizeLoginId((req.body || {}).login_id);
    if (!loginId) return fail(res, 400, 'LOGIN_ID_INVALID', '아이디 형식이 올바르지 않습니다.');

    const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
    const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!SUPA_URL || !SUPA_KEY) return fail(res, 500, 'SERVER_CONFIG', '서버 설정 오류');
    const supabase = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || '';
    if (ip) {
      const { data: hits, error: rErr } = await supabase.rpc('planner_rate_hit', { p_key: `pwreset:ip:${ip}`, p_limit: 10 });
      if (!rErr && Number(hits) > 10) return fail(res, 429, 'RATE_LIMITED', '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.');
    }

    const OTP_SECRET = await otpHashSecret(supabase);
    if (!OTP_SECRET) {
      console.error('[reset-request] OTP 해시 비밀 없음');
      return fail(res, 503, 'SERVICE_UNAVAILABLE', '잠시 후 다시 시도해주세요.');
    }

    const { data: rows, error: cErr } = await supabase.rpc('login_id_contact', { p_login_id: loginId });
    if (cErr) {
      console.error('[reset-request] login_id_contact 오류', cErr);
      return fail(res, 503, 'SERVICE_UNAVAILABLE', '잠시 후 다시 시도해주세요.');
    }
    const target = Array.isArray(rows) ? rows[0] : rows;
    if (!target?.user_id || !target?.email) return finishOk(); // 없는 아이디·연락 메일 없음 → 조용히 200

    const code = String(crypto.randomInt(100000, 1000000));
    const { data: issued, error: iErr } = await supabase.rpc('password_reset_issue', {
      p_user: target.user_id, p_code_hash: hashOtp(code, OTP_SECRET), p_ip: ip || null,
    });
    if (iErr) {
      console.error('[reset-request] password_reset_issue 오류', iErr);
      return fail(res, 503, 'SERVICE_UNAVAILABLE', '잠시 후 다시 시도해주세요.');
    }
    if (issued !== 'ok') return finishOk(); // cooldown: 최근 60초 안에 이미 발송 — 재발송 안 함(조용히)

    const sent = await sendCodeMail({
      to: target.email, code,
      subject: '[ConnectTrip] 비밀번호 재설정 인증번호',
      heading: 'ConnectTrip 비밀번호 재설정',
      lead: '아래 6자리 인증번호를 비밀번호 찾기 화면에 입력해주세요.',
    });
    if (!sent.ok) console.error('[reset-request] 메일 발송 실패', sent.reason);
    return finishOk();
  } catch (e) {
    console.error('[reset-request] 예외', e);
    return fail(res, 500, 'SERVER_ERROR', '처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }
}

// Vercel Serverless Function: 비밀번호 찾기 2단계 — 인증번호 확인 + 새 비밀번호 설정
// POST /api/reset-password-confirm  body: { login_id, code, new_password }
// 성공: 200 { ok: true }. 이후 클라이언트는 새 비밀번호로 다시 로그인한다.
//
// 통제: 챌린지는 user_id 에 결합돼 있고 DB 함수가 원자적으로 소비한다(5회 초과 잠금, 5분 만료, 1회 소비).
//       성공하면 auth.admin.updateUserById 로 비밀번호를 바꾸고 admin.signOut(global) 로 기존 세션을 전부 폐기한다
//       (탈취된 세션이 살아남지 않게 — agy·codex 공통 지적). 불일치·만료·없음은 같은 문구(존재 여부 비노출).

import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_cors.js';
import { normalizeLoginId, passwordWeak } from './_login_id.js';
import { hashOtp, otpHashSecret } from './_otp_hash.js';

const fail = (res, status, code, error) => res.status(status).json({ ok: false, code, error });

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }
  try {
    const b = req.body || {};
    const loginId = normalizeLoginId(b.login_id);
    const code = String(b.code || '').replace(/[^0-9]/g, '');
    const newPassword = String(b.new_password || '');
    if (!loginId) return fail(res, 400, 'LOGIN_ID_INVALID', '아이디 형식이 올바르지 않습니다.');
    if (code.length !== 6) return fail(res, 400, 'BAD_CODE', '인증번호 6자리를 입력해주세요.');
    if (passwordWeak(newPassword)) return fail(res, 400, 'PASSWORD_WEAK', '비밀번호는 8자 이상, 영문과 숫자를 포함해야 합니다.');

    const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
    const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!SUPA_URL || !SUPA_KEY) return fail(res, 500, 'SERVER_CONFIG', '서버 설정 오류');
    const supabase = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || '';
    // IP 축(10분 20회) + 아이디 축(10분 10회). 챌린지 자체의 5회 제한이 본 방어선, 이건 분산 IP 완충(codex 지적).
    if (ip) {
      const { data: hits, error: rErr } = await supabase.rpc('planner_rate_hit', { p_key: `pwconfirm:ip:${ip}`, p_limit: 20 });
      if (!rErr && Number(hits) > 20) return fail(res, 429, 'RATE_LIMITED', '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.');
    }
    {
      const { data: hits, error: rErr } = await supabase.rpc('planner_rate_hit', { p_key: `pwconfirm:id:${loginId}`, p_limit: 10 });
      if (!rErr && Number(hits) > 10) return fail(res, 429, 'RATE_LIMITED', '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.');
    }

    const OTP_SECRET = await otpHashSecret(supabase);
    if (!OTP_SECRET) {
      console.error('[reset-confirm] OTP 해시 비밀 없음');
      return fail(res, 503, 'SERVICE_UNAVAILABLE', '잠시 후 다시 시도해주세요.');
    }

    const { data: rows, error: cErr } = await supabase.rpc('login_id_contact', { p_login_id: loginId });
    if (cErr) {
      console.error('[reset-confirm] login_id_contact 오류', cErr);
      return fail(res, 503, 'SERVICE_UNAVAILABLE', '잠시 후 다시 시도해주세요.');
    }
    const target = Array.isArray(rows) ? rows[0] : rows;
    // 없는 아이디도 '불일치'와 같은 문구로 — 존재 여부를 알려주지 않는다.
    if (!target?.user_id) return fail(res, 400, 'OTP_INVALID', '인증번호가 일치하지 않거나 만료되었습니다.');

    const { data: result, error: vErr } = await supabase.rpc('password_reset_consume', {
      p_user: target.user_id, p_code_hash: hashOtp(code, OTP_SECRET),
    });
    if (vErr) {
      console.error('[reset-confirm] password_reset_consume 오류', vErr);
      return fail(res, 500, 'SERVER_ERROR', '처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
    if (result === 'too_many_attempts') return fail(res, 429, 'TOO_MANY_ATTEMPTS', '시도 횟수를 초과했습니다. 인증번호를 다시 요청해주세요.');
    if (result !== 'ok') return fail(res, 400, 'OTP_INVALID', '인증번호가 일치하지 않거나 만료되었습니다.');

    // 2단계 소비(codex 지적): consume 은 코드를 '검증됨'으로 잠글 뿐이고, 비밀번호 변경이 성공해야 finalize 로
    // 최종 소비한다. Auth 장애로 변경이 실패하면 release 로 잠금을 풀어 같은 코드로 재시도할 수 있다(만료·5회는 그대로).
    const { error: uErr } = await supabase.auth.admin.updateUserById(target.user_id, { password: newPassword });
    if (uErr) {
      console.error('[reset-confirm] updateUserById 오류', uErr);
      const { error: relErr } = await supabase.rpc('password_reset_release', { p_user: target.user_id });
      if (relErr) console.error('[reset-confirm] release 실패', relErr);
      return fail(res, 500, 'SERVER_ERROR', '비밀번호 변경에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
    const { error: finErr } = await supabase.rpc('password_reset_finalize', { p_user: target.user_id });
    if (finErr) console.error('[reset-confirm] finalize 실패(비밀번호는 변경됨)', finErr);

    // 기존 세션 전부 폐기. supabase-js admin.signOut 은 사용자 JWT 가 필요해 서버에서 쓸 수 없으므로
    // auth.sessions 를 지우는 service_role 전용 RPC(refresh_tokens 는 FK CASCADE). 이미 발급된 access JWT 는
    // 만료(≤1h)까지 유효 — 감수. 실패하면 1회 재시도하고, 그래도 실패하면 경보 로그(비밀번호는 이미 바뀜).
    let revoked = false;
    for (let i = 0; i < 2 && !revoked; i += 1) {
      const { error: sErr } = await supabase.rpc('revoke_user_sessions', { p_user: target.user_id });
      if (!sErr) revoked = true;
      else console.error(`[reset-confirm] 세션 폐기 실패(${i + 1}/2)`, sErr);
    }
    if (!revoked) console.error('[reset-confirm][ALERT] 세션 폐기 실패 — 수동 점검 필요', target.user_id);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[reset-confirm] 예외', e);
    return fail(res, 500, 'SERVER_ERROR', '처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }
}

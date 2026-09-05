// Vercel Serverless Function: 비밀번호 찾기 — 아이디 + PASS 본인확인으로 새 비밀번호 설정
// POST /api/reset-password-confirm  body: { login_id, identity_token, new_password }
// 성공: 200 { ok: true }. 이후 클라이언트는 새 비밀번호로 다시 로그인한다.
//
// 흐름(쿠마님 확정 2026-09-05): 아이디 → PASS(api/verify-identity.js, purpose 'password_reset') → 증빙 토큰과
// 새 비밀번호를 여기로. DB RPC password_reset_by_identity 가 증빙을 1회 소비하고 "증빙 CI == 계정 CI" 를
// 확인한다. 통과하면 auth.admin.updateUserById + revoke_user_sessions(기존 세션 전부 폐기).
// 없는 아이디·CI 불일치는 같은 문구(계정 존재 여부·본인 여부를 구분해 알리지 않는다).

import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_cors.js';
import { normalizeLoginId, passwordWeak } from './_login_id.js';

const fail = (res, status, code, error) => res.status(status).json({ ok: false, code, error });
const MISMATCH = '본인확인 정보와 계정이 일치하지 않습니다.';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }
  try {
    const b = req.body || {};
    const loginId = normalizeLoginId(b.login_id);
    const identityToken = String(b.identity_token || '').trim().slice(0, 128);
    const newPassword = String(b.new_password || '');
    if (!loginId) return fail(res, 400, 'LOGIN_ID_INVALID', '아이디 형식이 올바르지 않습니다.');
    if (!identityToken) return fail(res, 401, 'IDENTITY_REQUIRED', '휴대폰 본인확인을 먼저 완료해주세요.');
    if (passwordWeak(newPassword)) return fail(res, 400, 'PASSWORD_WEAK', '비밀번호는 8자 이상, 영문과 숫자를 포함해야 합니다.');

    const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
    const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!SUPA_URL || !SUPA_KEY) return fail(res, 500, 'SERVER_CONFIG', '서버 설정 오류');
    const supabase = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || '';
    if (ip) {
      const { data: hits, error: rErr } = await supabase.rpc('planner_rate_hit', { p_key: `pwreset:ip:${ip}`, p_limit: 10 });
      if (!rErr && Number(hits) > 10) return fail(res, 429, 'RATE_LIMITED', '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.');
    }
    {
      const { data: hits, error: rErr } = await supabase.rpc('planner_rate_hit', { p_key: `pwreset:id:${loginId}`, p_limit: 5 });
      if (!rErr && Number(hits) > 5) return fail(res, 429, 'RATE_LIMITED', '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.');
    }

    const { data: rows, error: cErr } = await supabase.rpc('login_id_contact', { p_login_id: loginId });
    if (cErr) {
      console.error('[reset-confirm] login_id_contact 오류', cErr);
      return fail(res, 503, 'SERVICE_UNAVAILABLE', '잠시 후 다시 시도해주세요.');
    }
    const target = Array.isArray(rows) ? rows[0] : rows;
    if (!target?.user_id) {
      // 없는 아이디: 증빙은 소비하지 않지만 응답은 불일치와 같게(존재 여부 비노출)
      return fail(res, 403, 'IDENTITY_MISMATCH', MISMATCH);
    }

    const { data: result, error: vErr } = await supabase.rpc('password_reset_by_identity', {
      p_user: target.user_id, p_identity_token: identityToken,
    });
    if (vErr) {
      console.error('[reset-confirm] password_reset_by_identity 오류', vErr);
      return fail(res, 500, 'SERVER_ERROR', '처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
    if (result === 'proof_invalid') return fail(res, 401, 'IDENTITY_PROOF_INVALID', '본인확인이 만료되었습니다. 다시 진행해주세요.');
    if (result !== 'ok') return fail(res, 403, 'IDENTITY_MISMATCH', MISMATCH);

    const { error: uErr } = await supabase.auth.admin.updateUserById(target.user_id, { password: newPassword });
    if (uErr) {
      console.error('[reset-confirm] updateUserById 오류', uErr);
      return fail(res, 500, 'SERVER_ERROR', '비밀번호 변경에 실패했습니다. 본인확인부터 다시 진행해주세요.');
    }

    // 기존 세션 전부 폐기(auth.sessions 삭제 RPC, refresh_tokens 는 FK CASCADE). 이미 발급된 access JWT 는
    // 만료(≤1h)까지 유효 — 감수. 실패하면 1회 재시도, 그래도 실패하면 경보 로그(비밀번호는 이미 바뀜).
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

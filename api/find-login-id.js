// Vercel Serverless Function: 아이디 찾기 — PASS 본인확인 증빙으로 내 아이디 조회
// POST /api/find-login-id  body: { identity_token }
// 성공: 200 { ok: true, login_id, user_type, created_at }  /  일치 계정 없음: 404 NO_ACCOUNT
//
// 흐름(2026-09-05): 화면에서 PASS(api/verify-identity.js, purpose 'find_id') → 증빙 토큰을 여기로.
// DB RPC find_login_id_by_identity 가 증빙을 1회 소비하고 같은 CI(profiles_identity)로 가입된 계정의 아이디를 돌려준다.
// 아이디 외 개인정보는 돌려주지 않는다. 증빙 없이는 아무것도 조회할 수 없다(열거 불가).

import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_cors.js';

const fail = (res, status, code, error) => res.status(status).json({ ok: false, code, error });

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }
  try {
    const identityToken = String((req.body || {}).identity_token || '').trim().slice(0, 128);
    if (!identityToken) return fail(res, 401, 'IDENTITY_REQUIRED', '휴대폰 본인확인을 먼저 완료해주세요.');

    const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
    const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!SUPA_URL || !SUPA_KEY) return fail(res, 500, 'SERVER_CONFIG', '서버 설정 오류');
    const supabase = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || '';
    if (ip) {
      const { data: hits, error: rErr } = await supabase.rpc('planner_rate_hit', { p_key: `findid:ip:${ip}`, p_limit: 10 });
      if (!rErr && Number(hits) > 10) return fail(res, 429, 'RATE_LIMITED', '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.');
    }

    const { data, error } = await supabase.rpc('find_login_id_by_identity', { p_identity_token: identityToken });
    if (error) {
      if (String(error.message || '').includes('IDENTITY_PROOF_INVALID')) {
        return fail(res, 401, 'IDENTITY_PROOF_INVALID', '본인확인이 만료되었습니다. 다시 진행해주세요.');
      }
      console.error('[find-login-id] RPC 오류', error);
      return fail(res, 500, 'SERVER_ERROR', '처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.login_id) return fail(res, 404, 'NO_ACCOUNT', '본인확인 정보로 가입된 계정이 없습니다.');

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, login_id: row.login_id, user_type: row.user_type || null, created_at: row.created_at || null });
  } catch (e) {
    console.error('[find-login-id] 예외', e);
    return fail(res, 500, 'SERVER_ERROR', '처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }
}

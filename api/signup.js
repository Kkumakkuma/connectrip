// Vercel Serverless Function: 회원가입 (아이디 기반, 서버가 계정을 만든다)
// POST /api/signup
// body: {
//   login_id, password, user_type: 'traveler'|'crew',
//   identity_token,                                   PASS 증빙(api/verify-identity.js 가 발급)
//   email, email_otp_token,                           여행자: 개인 연락 이메일 + OTP 소비 토큰(purpose 'signup')
//   airline_email, airline_name, airline_otp_token,   승무원: 회사 이메일 + OTP 소비 토큰(purpose 'airline_email')
//   name, nickname, birthdate, phone, zipcode, road, detail, referred_by,
//   terms_agreed_at, privacy_agreed_at
// }
// 성공: 200 { ok: true } → 클라이언트가 signInWithPassword(synthEmail(login_id), password) 로 세션을 만든다.
//
// 왜 서버에서 만드는가(2026-09-05 codex 치명 지적): 브라우저가 supabase.auth.signUp 을 직접 부르면 누구나
// 남의 아이디의 합성 주소를 먼저 만들어 선점할 수 있다. 여기서는 증빙(PASS·이메일 OTP)을 DB RPC 가 검증한
// 뒤에만 계정이 남고, RPC 가 실패하면 방금 만든 Auth 계정을 지운다(고아 계정 없음).

import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_cors.js';
import { normalizeLoginId, isReservedLoginId, synthEmail, passwordWeak } from './_login_id.js';

const fail = (res, status, code, error) => res.status(status).json({ ok: false, code, error });

// RPC 예외 문구(RAISE EXCEPTION 'CODE') → HTTP 응답. 목록 밖은 500 + 일반 문구(내부 원문 비노출).
const RPC_ERRORS = {
  LOGIN_ID_INVALID: [400, '아이디 형식이 올바르지 않습니다.'],
  LOGIN_ID_RESERVED: [400, '사용할 수 없는 아이디입니다.'],
  LOGIN_ID_TAKEN: [409, '이미 사용 중인 아이디입니다.'],
  LOGIN_ID_MISMATCH: [400, '아이디가 계정과 맞지 않습니다.'],
  NICKNAME_TAKEN: [409, '이미 사용 중인 닉네임입니다.'],
  EMAIL_INVALID: [400, '이메일 형식이 올바르지 않습니다.'],
  EMAIL_ALREADY_CLAIMED: [409, '이미 가입에 사용된 이메일입니다.'],
  OTP_PROOF_REQUIRED_EMAIL: [401, '이메일 인증을 먼저 완료해주세요.'],
  OTP_PROOF_INVALID_EMAIL: [401, '이메일 인증이 만료되었습니다. 다시 인증해주세요.'],
  OTP_PROOF_REQUIRED_AIRLINE: [401, '회사 이메일 인증을 먼저 완료해주세요.'],
  OTP_PROOF_INVALID_AIRLINE: [401, '회사 이메일 인증이 만료되었습니다. 다시 인증해주세요.'],
  IDENTITY_REQUIRED: [401, '휴대폰 본인확인을 먼저 완료해주세요.'],
  IDENTITY_PROOF_INVALID: [401, '본인확인이 만료되었습니다. 다시 진행해주세요.'],
  IDENTITY_BLOCKED: [403, '가입할 수 없는 본인확인 정보입니다.'],
  IDENTITY_ALREADY_REGISTERED: [409, '이미 가입된 본인확인 정보입니다. 기존 계정으로 로그인해주세요.'],
  PHONE_BLOCKED: [403, '가입할 수 없는 휴대폰 번호입니다.'],
  PHONE_ALREADY_CLAIMED: [409, '이미 가입에 사용된 휴대폰 번호입니다.'],
  AIRLINE_EMAIL_ALREADY_CLAIMED: [409, '이미 가입에 사용된 회사 이메일입니다.'],
  AIRLINE_EMAIL_PREVIOUSLY_USED: [409, '이전에 사용된 회사 이메일은 다시 쓸 수 없습니다.'],
  'crew airline verification required': [400, '승무원은 지원 항공사 회사 이메일로 인증해야 합니다.'],
  CONSENT_REQUIRED: [400, '필수 약관에 동의해주세요.'],
  age_under_14: [403, '만 14세 미만은 가입할 수 없습니다.'],
  'name required': [400, '이름을 확인해주세요.'],
  'birthdate required': [400, '생년월일을 확인해주세요.'],
  'birthdate invalid': [400, '생년월일을 확인해주세요.'],
};

function mapRpcError(message) {
  const msg = String(message || '');
  for (const [key, [status, text]] of Object.entries(RPC_ERRORS)) {
    if (msg.includes(key)) return { status, code: key.toUpperCase().replace(/[^A-Z0-9_]+/g, '_'), error: text };
  }
  return null;
}

const isoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const str = (v, max) => String(v ?? '').trim().slice(0, max);

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }

  const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
  const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!SUPA_URL || !SUPA_KEY) return fail(res, 500, 'SERVER_CONFIG', '서버 설정 오류');

  const b = req.body || {};
  const loginId = normalizeLoginId(b.login_id);
  if (!loginId) return fail(res, 400, 'LOGIN_ID_INVALID', '아이디는 영문 소문자·숫자·밑줄 4~20자입니다.');
  if (isReservedLoginId(loginId)) return fail(res, 400, 'LOGIN_ID_RESERVED', '사용할 수 없는 아이디입니다.');
  const password = String(b.password || '');
  if (passwordWeak(password)) return fail(res, 400, 'PASSWORD_WEAK', '비밀번호는 8자 이상, 영문과 숫자를 포함해야 합니다.');
  const userType = b.user_type === 'crew' ? 'crew' : b.user_type === 'traveler' ? 'traveler' : '';
  if (!userType) return fail(res, 400, 'BAD_INPUT', '가입 유형이 올바르지 않습니다.');
  const identityToken = str(b.identity_token, 128);
  if (!identityToken) return fail(res, 401, 'IDENTITY_REQUIRED', '휴대폰 본인확인을 먼저 완료해주세요.');
  const birthdate = isoDate(b.birthdate) ? String(b.birthdate) : '';
  if (!birthdate) return fail(res, 400, 'BAD_INPUT', '생년월일을 확인해주세요.');
  if (!b.terms_agreed_at || !b.privacy_agreed_at) return fail(res, 400, 'CONSENT_REQUIRED', '필수 약관에 동의해주세요.');
  const email = userType === 'traveler' ? str(b.email, 254).toLowerCase() : '';
  const emailOtpToken = userType === 'traveler' ? str(b.email_otp_token, 128) : '';
  if (userType === 'traveler' && (!email || !emailOtpToken)) {
    return fail(res, 401, 'OTP_PROOF_REQUIRED_EMAIL', '이메일 인증을 먼저 완료해주세요.');
  }
  const airlineEmail = userType === 'crew' ? str(b.airline_email, 254).toLowerCase() : '';
  const airlineOtpToken = userType === 'crew' ? str(b.airline_otp_token, 128) : '';
  if (userType === 'crew' && (!airlineEmail || !airlineOtpToken)) {
    return fail(res, 401, 'OTP_PROOF_REQUIRED_AIRLINE', '회사 이메일 인증을 먼저 완료해주세요.');
  }
  const referredBy = isUuid(b.referred_by) ? String(b.referred_by) : null;

  const supabase = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || '';

  // IP 축 레이트리밋(10분 5회). 실패해도 통과 — 증빙 검증이 본 방어선이다.
  if (ip) {
    const { data: hits, error: rErr } = await supabase.rpc('planner_rate_hit', { p_key: `signup:ip:${ip}`, p_limit: 5 });
    if (!rErr && Number(hits) > 5) return fail(res, 429, 'RATE_LIMITED', '가입 요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.');
  }

  // 1) 아이디 선점 여부(빠른 실패). 진짜 판정은 createUser 의 유일성 + RPC 가 한다.
  const { data: taken, error: tErr } = await supabase.rpc('check_login_id_taken', { p_login_id: loginId });
  if (tErr) {
    console.error('[signup] check_login_id_taken 오류', tErr);
    return fail(res, 503, 'SERVICE_UNAVAILABLE', '잠시 후 다시 시도해주세요.');
  }
  if (taken) return fail(res, 409, 'LOGIN_ID_TAKEN', '이미 사용 중인 아이디입니다.');

  // 2) Auth 계정 생성(합성 주소, 확인 완료 상태). handle_new_user 가 프로필 뼈대를 만든다.
  const { data: created, error: cErr } = await supabase.auth.admin.createUser({
    email: synthEmail(loginId),
    password,
    email_confirm: true,
    user_metadata: { login_id: loginId, name: str(b.name, 30), nickname: str(b.nickname, 20), birthdate },
  });
  if (cErr || !created?.user?.id) {
    const m = String(cErr?.message || '');
    if (/already|exists|registered|duplicate/i.test(m)) return fail(res, 409, 'LOGIN_ID_TAKEN', '이미 사용 중인 아이디입니다.');
    if (/age_under_14/.test(m)) return fail(res, 403, 'AGE_UNDER_14', '만 14세 미만은 가입할 수 없습니다.');
    console.error('[signup] createUser 오류', cErr);
    return fail(res, 500, 'SERVER_ERROR', '가입 처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }
  const userId = created.user.id;

  // 3) 증빙 검증 + 프로필 완성(한 트랜잭션). 실패하면 방금 만든 계정을 지운다.
  const { error: pErr } = await supabase.rpc('complete_signup_profile_admin', {
    p_user: userId,
    p_login_id: loginId,
    p_email: email || null,
    p_email_otp_token: emailOtpToken || null,
    p_name: str(b.name, 30),
    p_nickname: str(b.nickname, 20),
    p_phone: str(b.phone, 20),
    p_zipcode: str(b.zipcode, 10),
    p_road: str(b.road, 200),
    p_detail: str(b.detail, 200),
    p_user_type: userType,
    p_airline_email: airlineEmail || null,
    p_airline_name: userType === 'crew' ? str(b.airline_name, 50) || null : null,
    p_referred_by: referredBy,
    p_birthdate: birthdate,
    p_airline_otp_token: airlineOtpToken || null,
    p_terms_agreed_at: b.terms_agreed_at,
    p_privacy_agreed_at: b.privacy_agreed_at,
    p_identity_token: identityToken,
  });
  if (pErr) {
    const { error: dErr } = await supabase.auth.admin.deleteUser(userId);
    if (dErr) console.error('[signup] 고아 계정 삭제 실패', userId, dErr);
    const mapped = mapRpcError(pErr.message);
    if (mapped) return fail(res, mapped.status, mapped.code, mapped.error);
    console.error('[signup] complete_signup_profile_admin 오류', pErr);
    return fail(res, 500, 'SERVER_ERROR', '가입 처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
}

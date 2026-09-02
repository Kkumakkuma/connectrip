// Vercel Serverless Function: 통신사 휴대폰 본인확인(PASS 앱/SMS) 결과 서버 검증
// POST /api/verify-identity
// body: { identityVerificationId }
//
// 흐름: 클라(포트원 V2 SDK)가 받은 identityVerificationId 만 넘긴다 → IP rate limit(포트원 호출 전)
//       → 포트원 REST 로 결과를 직접 조회(클라가 보낸 이름·번호는 절대 믿지 않는다)
//       → 결과 필드 타입·CI·생년월일·휴대폰 검증 → DB 기록(record_identity_verification: 차단·중복 검사 후 INSERT)
//       → 일회성 소비 토큰 발급. 가입 완료 RPC(complete_signup_profile)가 토큰을 소비하며 서버 보관값으로
//       프로필을 확정한다.
// CI/DI 원문은 응답·로그 어디에도 남기지 않는다(DB 엔 sha256(CI)만). 오류는 고정 code + 일반 메시지만 응답.
// 환경변수: PORTONE_API_SECRET(없으면 503 = 서비스 준비 중), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'node:crypto';
import { applyCors } from './_cors.js';

const PORTONE_API = 'https://api.portone.io';
const PORTONE_TIMEOUT_MS = 8000;
const RATE_LIMIT_PER_10MIN = 10;
const ID_RE = /^[A-Za-z0-9-]{8,80}$/;              // KCP 제약(영숫자 40자 이하)보다 넓게, 경로 인젝션만 차단
const PHONE_RE = /^01[016789][0-9]{7,8}$/;
const BIRTH_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CI_RE = /^[A-Za-z0-9+/=_-]{32,200}$/;         // CI 는 88자 base64 — 빈 값·이상값 해시 방지

const RESULT_MAP = {
  already_used:  { status: 400, code: 'IDENTITY_ALREADY_USED',       error: '이미 처리된 본인확인 요청입니다. 본인확인을 다시 진행해주세요.' },
  ci_registered: { status: 409, code: 'IDENTITY_ALREADY_REGISTERED', error: '이미 가입된 회원입니다. 로그인하거나 아이디·비밀번호 찾기를 이용해주세요.' },
  phone_claimed: { status: 409, code: 'PHONE_ALREADY_CLAIMED',       error: '이미 가입에 사용된 휴대폰 번호입니다. 번호 하나로 계정 하나만 만들 수 있습니다.' },
  blocked:       { status: 403, code: 'IDENTITY_BLOCKED',            error: '이용이 제한된 사용자입니다. 문의가 필요하면 고객센터로 연락해주세요.' },
  under_14:      { status: 400, code: 'UNDER_14',                    error: '만 14세 미만은 가입할 수 없습니다.' },
  birth_invalid: { status: 502, code: 'PROVIDER_ERROR',              error: '본인확인 결과의 생년월일이 올바르지 않습니다. 고객센터로 문의해주세요.' },
  phone_invalid: { status: 502, code: 'PHONE_UNAVAILABLE',           error: '본인확인 결과에 휴대폰 번호가 없습니다. 고객센터로 문의해주세요.' },
};

// 실제 달력 날짜인지 + 1900-01-01 ~ 오늘(KST) 범위인지
export function parseBirth(s) {
  const raw = String(s ?? '').trim();
  const v = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw.slice(0, 10);
  const m = BIRTH_RE.exec(v);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  if (t > today || y < 1900) return null;
  return v;
}

// DB 의 `birthdate > CURRENT_DATE - 14 years` 와 같은 기준(KST). 최종 권위는 RPC 의 재검사.
export function isUnder14(birth) {
  const m = BIRTH_RE.exec(birth || '');
  if (!m) return true;
  const bd = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const cutoff = Date.UTC(kst.getUTCFullYear() - 14, kst.getUTCMonth(), kst.getUTCDate());
  return bd > cutoff;
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const fail = (res, status, code, error) => res.status(status).json({ ok: false, code, error });

async function fetchPortOne(id, secret) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PORTONE_TIMEOUT_MS);
  try {
    return await fetch(`${PORTONE_API}/identity-verifications/${encodeURIComponent(id)}`, {
      headers: { Authorization: `PortOne ${secret}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return; // 앱(Capacitor) 교차 출처 허용 + OPTIONS 종결
  res.setHeader('Cache-Control', 'no-store'); // 오류 응답까지 캐시 금지
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const secret = (process.env.PORTONE_API_SECRET || '').trim();
    const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
    const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!secret) {
      // 계약·키 배포 전: 프론트도 같은 조건(VITE_PORTONE_*)으로 본인확인 UI 를 숨기므로 정상 사용자는 오지 않는다.
      return fail(res, 503, 'IDENTITY_DISABLED', '본인확인 서비스 준비 중입니다. 잠시 후 다시 시도해주세요.');
    }
    if (!SUPA_URL || !SUPA_KEY) {
      console.error('[verify-identity] 환경변수 누락', { hasSupaUrl: !!SUPA_URL, hasSupaKey: !!SUPA_KEY });
      return fail(res, 500, 'SERVER_CONFIG', '서버 설정 오류');
    }

    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const id = str(body.identityVerificationId);
    if (!ID_RE.test(id)) {
      return fail(res, 400, 'BAD_REQUEST', '본인확인 요청 정보가 올바르지 않습니다.');
    }

    const supabase = createClient(SUPA_URL, SUPA_KEY);
    const ipAddr = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip'] || null;

    // ① 포트원 호출 "전" IP rate limit(원자적 버킷) — 위조 id 로 포트원 조회를 반복시키는 남용 차단
    const { data: hits, error: rlErr } = await supabase.rpc('identity_rate_hit', { p_ip: ipAddr, p_limit: RATE_LIMIT_PER_10MIN });
    if (rlErr) {
      console.error('[verify-identity] rate RPC 오류', rlErr.message);
      return fail(res, 500, 'SERVER_ERROR', '본인확인 처리에 실패했습니다.');
    }
    if (Number(hits) > RATE_LIMIT_PER_10MIN) {
      return fail(res, 429, 'RATE_LIMITED', '본인확인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
    }

    // ② 포트원에서 결과를 직접 조회 — 클라가 위조할 수 없는 유일한 근거
    let r;
    try {
      r = await fetchPortOne(id, secret);
    } catch (e) {
      console.error('[verify-identity] 포트원 연결 실패', e?.name === 'AbortError' ? 'timeout' : e?.message);
      return fail(res, 504, 'PROVIDER_TIMEOUT', '본인확인 서비스 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
    }
    if (r.status === 404) return fail(res, 400, 'IDENTITY_NOT_FOUND', '본인확인 내역을 찾을 수 없습니다. 다시 진행해주세요.');
    if (r.status === 401 || r.status === 403) {
      console.error('[verify-identity] 포트원 인증 실패(API Secret 확인 필요)', r.status);
      return fail(res, 500, 'SERVER_CONFIG', '서버 설정 오류');
    }
    if (r.status === 429) return fail(res, 429, 'PROVIDER_BUSY', '본인확인 서비스가 혼잡합니다. 잠시 후 다시 시도해주세요.');
    if (!r.ok) {
      console.error('[verify-identity] 포트원 조회 실패', r.status);
      return fail(res, 502, 'PROVIDER_ERROR', '본인확인 서비스 응답 오류입니다. 잠시 후 다시 시도해주세요.');
    }
    let iv;
    try {
      iv = await r.json();
    } catch {
      console.error('[verify-identity] 포트원 응답 파싱 실패');
      return fail(res, 502, 'PROVIDER_ERROR', '본인확인 서비스 응답 오류입니다. 잠시 후 다시 시도해주세요.');
    }
    if (!iv || typeof iv !== 'object' || iv.status !== 'VERIFIED') {
      const msg = iv?.status === 'FAILED'
        ? '본인확인에 실패했습니다. 다시 진행해주세요.'
        : '본인확인이 완료되지 않았습니다. 인증 창에서 인증을 마친 뒤 다시 시도해주세요.';
      return fail(res, 400, 'IDENTITY_NOT_VERIFIED', msg);
    }

    // ③ 결과 필드 검증 (타입·빈값·형식)
    const c = (iv.verifiedCustomer && typeof iv.verifiedCustomer === 'object') ? iv.verifiedCustomer : {};
    const name = str(c.name).slice(0, 30);
    const birth = parseBirth(c.birthDate);
    const phone = str(c.phoneNumber).replace(/[^0-9]/g, '');
    const ci = str(c.ci);
    if (!name || !CI_RE.test(ci)) {
      console.error('[verify-identity] 결과 필드 누락', { hasName: !!name, ciOk: CI_RE.test(ci) });
      return fail(res, 502, 'PROVIDER_ERROR', '본인확인 결과에 필요한 정보가 없습니다. 고객센터로 문의해주세요.');
    }
    if (!birth) {
      const m = RESULT_MAP.birth_invalid;
      return fail(res, m.status, m.code, m.error);
    }
    if (!PHONE_RE.test(phone)) {
      // KCP 는 항상 반환, 다날은 전화번호 반환 추가 계약 필요 — 계약 옵션 문제라 운영자 확인 대상
      console.error('[verify-identity] 휴대폰 번호 누락 — PG 계약 옵션 확인 필요');
      const m = RESULT_MAP.phone_invalid;
      return fail(res, m.status, m.code, m.error);
    }
    if (isUnder14(birth)) {
      const m = RESULT_MAP.under_14;
      return fail(res, m.status, m.code, m.error);
    }

    // ④ 토큰 원문은 클라이언트에만, DB 에는 해시만. CI 도 해시만.
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const ciHash = createHash('sha256').update(ci).digest('hex');

    const { data: result, error } = await supabase.rpc('record_identity_verification', {
      p_provider_ref: id,
      p_pg: str(iv.channel?.pgProvider) || null,
      p_name: name,
      p_birthdate: birth,
      p_gender: str(c.gender) || null,
      p_phone: phone,
      p_operator: str(c.operator) || null,
      p_is_foreigner: typeof c.isForeigner === 'boolean' ? c.isForeigner : null,
      p_ci_hash: ciHash,
      p_token_hash: tokenHash,
      p_purpose: 'signup_identity',
      p_ip: ipAddr,
    });
    if (error) {
      console.error('[verify-identity] RPC 오류', error.message);
      return fail(res, 500, 'SERVER_ERROR', '본인확인 처리에 실패했습니다.');
    }
    if (result !== 'ok') {
      const m = RESULT_MAP[result];
      if (!m) {
        console.error('[verify-identity] 알 수 없는 RPC 결과', String(result));
        return fail(res, 500, 'SERVER_ERROR', '본인확인 처리에 실패했습니다.');
      }
      return fail(res, m.status, m.code, m.error);
    }

    return res.status(200).json({
      ok: true,
      verifyToken: token,
      customer: { name, birthdate: birth, phone },
    });
  } catch (e) {
    console.error('[verify-identity] 예외', e?.message || e);
    return fail(res, 500, 'SERVER_ERROR', '본인확인 처리 중 오류가 발생했습니다.');
  }
}

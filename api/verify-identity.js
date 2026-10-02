// Vercel Serverless Function: 통신사 휴대폰 본인확인(PASS 앱/SMS) — 시작 등록(start) + 결과 서버 검증(confirm)
// POST /api/verify-identity
//   start   body: { action: 'start', purpose, dsHash }      → 200 { ok: true, identityVerificationId }
//   confirm body: { identityVerificationId, purpose, ds }    → 200 { ok: true, verifyToken[, customer] }
//           (action 이 없거나 'confirm')
//
// 결속(2026-10-02 R1 근본 수정, 설계 문서/커넥트립_PASS결속_설계_v2_20261002.md §2):
//   예전에는 identityVerificationId + 호출자가 고른 purpose 만으로 증빙을 내줬다. 그래서 공격자가 자기 id 로 만든 링크로
//   피해자가 PASS 를 끝내면 그 결과(아이디 찾기·비밀번호 재설정 증빙)를 공격자가 가져갈 수 있었다.
//   이제 id 는 서버가 발급한다. PASS 창을 띄울 페이지가 비밀값 ds(32바이트 난수 hex)를 만들어 sha256(ds) 만 start 로 보내면,
//   서버가 id 를 난수로 만들어 (id, sha256(ds), 용도)를 identity_starts 에 묶어 둔다. 증빙은 ds 원문을 가진 쪽이,
//   묶어 둔 용도로, 1시간 안에만 받는다. 클라이언트가 고른 id 는 어디서도 등록되지 않는다.
//
// start 흐름: 용도·dsHash 형식 → IP 속도 제한(planner_rate_hit 'idstart:ip:<ip>', 10분 30회)
//       → id = 'ct' + 난수 16바이트 hex → identity_start_register('exists' 면 새 id 로 1회 재시도) → id 응답
// confirm 흐름: 용도·id 형식 → ds 없음(결속 이전 화면·옛 앱) 400 / ds 형식 오류 400 → IP rate limit(identity_rate_hit)
//       → 결속 확인(identity_start_check: id·sha256(ds)·용도·1시간·미사용). 통과하기 전에는 포트원을 부르지 않는다
//       → 포트원 REST 로 결과를 직접 조회(클라가 보낸 이름·번호는 절대 믿지 않는다) → 실연동(LIVE) 채널 결과인지
//       → 인증 시각(1시간)·결과 필드 타입·CI·생년월일·휴대폰 검증
//       → DB 기록(record_identity_verification_bound: 등록 행을 잠근 채 결속을 다시 대조한 뒤, 기존 기록 함수의
//          차단·중복 검사 후 INSERT) → 일회성 소비 토큰 발급.
//       가입(complete_signup_profile·_admin)·비밀번호 재설정·아이디 찾기 RPC 가 토큰을 소비하며 서버 보관값을 쓴다.
//       응답의 customer(이름·생년월일·휴대폰)는 가입 용도에만 싣는다(찾기 화면은 토큰만 쓴다).
// CI/DI 원문은 응답·로그 어디에도 남기지 않는다(DB 엔 sha256(CI)만). ds 원문도 DB·로그에 남기지 않는다(sha256 만).
// 오류는 고정 code + 일반 메시지만 응답.
// 환경변수: PORTONE_API_SECRET(없으면 503 = 서비스 준비 중), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'node:crypto';
import { applyCors } from './_cors.js';

const PORTONE_API = 'https://api.portone.io';
const PORTONE_TIMEOUT_MS = 8000;
const RATE_LIMIT_PER_10MIN = 10;
// start 는 PC 웹이 화면을 열 때 미리 등록까지 하므로 confirm 보다 넉넉히 잡는다(설계 v2 §2 — v1 의 20회 → 30회).
const START_RATE_LIMIT_PER_10MIN = 30;
const PURPOSES = ['signup_identity', 'password_reset', 'find_id'];
const ID_RE = /^[A-Za-z0-9-]{8,80}$/;              // KCP 제약(영숫자 40자 이하)보다 넓게, 경로 인젝션만 차단
const HEX64_RE = /^[0-9a-f]{64}$/;                 // ds(32바이트 난수 hex)·dsHash(sha256 hex) — 둘 다 소문자 hex 64자
const PHONE_RE = /^01[016789][0-9]{7,8}$/;
const BIRTH_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CI_RE = /^[A-Za-z0-9+/=_-]{32,200}$/;         // CI 는 88자 base64 — 빈 값·이상값 해시 방지
// 앱(Capacitor WebView) 출처 — _cors.js 의 허용 출처와 같은 값. ds 없음 안내 문구를 고르는 데만 쓴다(결속 면제에는 안 쓴다).
const APP_ORIGINS = new Set(['https://localhost', 'capacitor://localhost']);

// 인증 완료 시각 신선도(1시간). 오래전에 완료된 인증 ID 를 다시 제출해 새 증빙을 받는 경로 차단(codex 지적, 2026-09-14).
const IDENTITY_FRESH_MS = 60 * 60 * 1000;

const BAD_REQUEST_MSG = '본인확인 요청 정보가 올바르지 않습니다.';
const SERVER_ERROR_MSG = '본인확인 처리에 실패했습니다.';

// 결속 오류(2026-10-02). 포트원 조회 전 확인(identity_start_check)과 기록 직전 재확인(record_identity_verification_bound)이
// 같은 사유로 거절하면 같은 code 로 답한다.
const BINDING_INVALID = { status: 403, code: 'IDENTITY_BINDING_INVALID', error: '본인확인 요청 정보가 맞지 않습니다. 본인확인을 다시 진행해주세요.' };
const PURPOSE_MISMATCH = { status: 400, code: 'IDENTITY_PURPOSE_MISMATCH', error: '본인확인 용도가 맞지 않습니다. 본인확인을 다시 진행해주세요.' };
const STALE = { status: 400, code: 'IDENTITY_STALE', error: '본인확인이 만료되었습니다. 다시 진행해주세요.' };
// ds 없음 = 결속 이전 화면(배포 전에 열어 둔 탭)이거나 옛 앱(1.3.4 이하). 앱이면 업데이트, 웹이면 새로 고침을 안내한다.
const BINDING_REQUIRED_APP = '커넥트립 앱을 최신 버전으로 업데이트한 뒤 본인확인을 다시 진행해주세요. 업데이트 전에는 웹사이트에서 진행할 수 있습니다.';
const BINDING_REQUIRED_WEB = '화면을 새로 고친 뒤 본인확인을 다시 진행해주세요.';

const RESULT_MAP = {
  already_used:  { status: 400, code: 'IDENTITY_ALREADY_USED',       error: '이미 처리된 본인확인 요청입니다. 본인확인을 다시 진행해주세요.' },
  ci_registered: { status: 409, code: 'IDENTITY_ALREADY_REGISTERED', error: '이미 가입된 회원입니다. 로그인하거나 아이디·비밀번호 찾기를 이용해주세요.' },
  phone_claimed: { status: 409, code: 'PHONE_ALREADY_CLAIMED',       error: '이미 가입에 사용된 휴대폰 번호입니다. 번호 하나로 계정 하나만 만들 수 있습니다.' },
  blocked:       { status: 403, code: 'IDENTITY_BLOCKED',            error: '이용이 제한된 사용자입니다. 문의가 필요하면 고객센터로 연락해주세요.' },
  under_14:      { status: 400, code: 'UNDER_14',                    error: '만 14세 미만은 가입할 수 없습니다.' },
  birth_invalid: { status: 502, code: 'PROVIDER_ERROR',              error: '본인확인 결과의 생년월일이 올바르지 않습니다. 고객센터로 문의해주세요.' },
  phone_invalid: { status: 502, code: 'PHONE_UNAVAILABLE',           error: '본인확인 결과에 휴대폰 번호가 없습니다. 고객센터로 문의해주세요.' },
  // 기록 직전 결속 재확인(record_identity_verification_bound, 2026-10-02) — 확인과 기록 사이에 만료되는 경우 등
  binding_invalid: BINDING_INVALID,
  binding_purpose: PURPOSE_MISMATCH,
  binding_expired: STALE,
};

// identity_start_check 결과 → 응답. 'mismatch' 는 등록 없음과 ds 불일치를 합친 답이다(ds 를 모르는 쪽에 등록 여부를 알려 주지 않는다).
const CHECK_MAP = {
  mismatch: BINDING_INVALID,
  purpose: PURPOSE_MISMATCH,
  expired: STALE,
  used: RESULT_MAP.already_used,
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
const failWith = (res, m) => fail(res, m.status, m.code, m.error);
// RPC 결과 문자열 → 응답 항목. 표에 없는 값(상속 키 'constructor' 같은 것 포함)은 null — 호출부가 500 으로 처리한다.
const lookup = (map, key) => (typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : null);
const sha256Hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const clientIp = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || null;

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

// ── start: 본인확인 번호(id) 발급 + (id, sha256(ds), 용도) 결속 등록 ──
// 등록만으로는 아무것도 내주지 않는다. 증빙은 confirm 이 ds 원문·용도·1시간을 대조한 뒤에만 나간다.
async function handleStart(req, res, body, db) {
  // 새 계약이라 용도 생략(기본값)을 두지 않는다 — confirm 의 기본값은 옛 가입 화면 호환용이다.
  const purpose = typeof body.purpose === 'string' ? body.purpose : '';
  if (!PURPOSES.includes(purpose)) {
    return fail(res, 400, 'BAD_PURPOSE', '본인확인 용도가 올바르지 않습니다.');
  }
  // 결속 값은 다듬지 않고(trim 없음) 계약 형식(소문자 hex 64자) 그대로만 받는다 — 앞뒤 공백 붙은 값도 400.
  const dsHash = typeof body.dsHash === 'string' ? body.dsHash : '';
  if (!HEX64_RE.test(dsHash)) {
    return fail(res, 400, 'BAD_REQUEST', BAD_REQUEST_MSG);
  }

  const supabase = db();
  // IP 축 속도 제한(고정 10분 창). 기존 관례(signup·아이디 찾기)대로 IP 가 없으면 건너뛰고, RPC 가 실패하면 통과시킨다 —
  // 등록이 막히면 본인확인 자체를 못 하고, 증빙은 confirm 의 identity_rate_hit·결속 확인이 따로 지킨다.
  const ip = clientIp(req);
  if (ip) {
    const { data: hits, error: rErr } = await supabase.rpc('planner_rate_hit', {
      p_key: `idstart:ip:${ip}`,
      p_limit: START_RATE_LIMIT_PER_10MIN,
    });
    if (!rErr && Number(hits) > START_RATE_LIMIT_PER_10MIN) {
      return fail(res, 429, 'RATE_LIMITED', '본인확인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
    }
  }

  // id 는 서버 난수만 쓴다('ct' + hex 32자 = 34자, KCP 영숫자 40자 이하). 'exists'(이미 쓰인 id)는 난수라 사실상 없지만,
  // 나오면 새 id 로 한 번만 더 시도한다.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const id = `ct${randomBytes(16).toString('hex')}`;
    const { data: result, error } = await supabase.rpc('identity_start_register', {
      p_provider_ref: id,
      p_ds_hash: dsHash,
      p_purpose: purpose,
    });
    if (error) {
      console.error('[verify-identity] start 등록 RPC 오류', error.message);
      return fail(res, 500, 'SERVER_ERROR', SERVER_ERROR_MSG);
    }
    if (result === 'ok') return res.status(200).json({ ok: true, identityVerificationId: id });
    if (result === 'invalid') return fail(res, 400, 'BAD_REQUEST', BAD_REQUEST_MSG);
    if (result !== 'exists') {
      console.error('[verify-identity] 알 수 없는 start 등록 결과', String(result));
      return fail(res, 500, 'SERVER_ERROR', SERVER_ERROR_MSG);
    }
  }
  console.error('[verify-identity] start 등록 id 충돌 반복');
  return fail(res, 500, 'SERVER_ERROR', SERVER_ERROR_MSG);
}

// ── confirm: 결속 확인 → 포트원 결과 조회·검증 → 결속 재확인과 함께 기록 → 일회성 증빙 토큰 ──
async function handleConfirm(req, res, body, db, secret) {
  const id = str(body.identityVerificationId);
  // 증빙 용도: 가입(signup_identity)·비밀번호 찾기(password_reset)·아이디 찾기(find_id). 허용 밖은 400.
  // 생략하면 가입으로 본다(용도를 보내지 않던 옛 가입 화면 호환 — 기존과 같다).
  const purpose = body.purpose === undefined ? 'signup_identity' : String(body.purpose);
  if (!PURPOSES.includes(purpose)) {
    return fail(res, 400, 'BAD_PURPOSE', '본인확인 용도가 올바르지 않습니다.');
  }
  if (!ID_RE.test(id)) {
    return fail(res, 400, 'BAD_REQUEST', BAD_REQUEST_MSG);
  }
  // ds 가 없으면 400. Origin 은 안내 문구에만 쓴다 — 위조할 수 있는 값이라 결속 면제 근거로 쓰지 않는다.
  const rawDs = body.ds;
  if (rawDs === undefined || rawDs === null || (typeof rawDs === 'string' && !rawDs.trim())) {
    const isApp = APP_ORIGINS.has(String(req.headers.origin || ''));
    return fail(res, 400, 'IDENTITY_BINDING_REQUIRED', isApp ? BINDING_REQUIRED_APP : BINDING_REQUIRED_WEB);
  }
  // start 의 dsHash 와 같이 다듬지 않는다 — 정확히 소문자 hex 64자가 아니면 400(앞뒤 공백 포함).
  const ds = typeof rawDs === 'string' ? rawDs : '';
  if (!HEX64_RE.test(ds)) {
    return fail(res, 400, 'BAD_REQUEST', BAD_REQUEST_MSG);
  }

  const supabase = db();
  const ipAddr = clientIp(req);

  // ① 포트원 호출 "전" IP rate limit(원자적 버킷) — 위조 id 로 포트원 조회를 반복시키는 남용 차단
  const { data: hits, error: rlErr } = await supabase.rpc('identity_rate_hit', { p_ip: ipAddr, p_limit: RATE_LIMIT_PER_10MIN });
  if (rlErr) {
    console.error('[verify-identity] rate RPC 오류', rlErr.message);
    return fail(res, 500, 'SERVER_ERROR', SERVER_ERROR_MSG);
  }
  if (Number(hits) > RATE_LIMIT_PER_10MIN) {
    return fail(res, 429, 'RATE_LIMITED', '본인확인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
  }

  // ② 결속 확인(읽기만) — 서버가 발급한 id 인지, ds 원문을 가진 쪽인지, 등록한 용도인지, 1시간 안인지, 아직 안 썼는지.
  //    통과하기 전에는 포트원을 부르지 않는다 — 남의 id 로 인증 진행 상태(완료·실패)를 떠보는 통로를 막는다.
  const dsHash = sha256Hex(ds);
  const { data: chk, error: chkErr } = await supabase.rpc('identity_start_check', {
    p_provider_ref: id,
    p_ds_hash: dsHash,
    p_purpose: purpose,
  });
  if (chkErr) {
    console.error('[verify-identity] 결속 확인 RPC 오류', chkErr.message);
    return fail(res, 500, 'SERVER_ERROR', SERVER_ERROR_MSG);
  }
  if (chk !== 'ok') {
    const m = lookup(CHECK_MAP, chk);
    if (!m) {
      console.error('[verify-identity] 알 수 없는 결속 확인 결과', String(chk));
      return fail(res, 500, 'SERVER_ERROR', SERVER_ERROR_MSG);
    }
    return failWith(res, m);
  }

  // ③ 포트원에서 결과를 직접 조회 — 클라가 위조할 수 없는 유일한 근거
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

  // ③-a 결과 채널(2026-10-02, 설계 v2 §0-6) — 실연동(LIVE) 채널 결과만 증빙으로 인정한다. 테스트 채널은 아무 정보로나
  //      VERIFIED 를 만들 수 있어 가짜 신원 증빙이 된다(T8). 채널이 없으면 응답 이상으로 보고 재시도할 수 있게 502.
  //      로그에는 채널 유형만 남긴다(채널 키·상점 아이디는 남기지 않는다).
  const ch = (iv.channel && typeof iv.channel === 'object') ? iv.channel : null;
  if (!ch) {
    console.error('[verify-identity] 포트원 결과에 채널 없음', { type: null });
    return fail(res, 502, 'PROVIDER_ERROR', '본인확인 서비스 응답 오류입니다. 잠시 후 다시 시도해주세요.');
  }
  if (ch.type !== 'LIVE') {
    console.error('[verify-identity] 실연동이 아닌 채널의 결과 거절', { type: String(ch.type).slice(0, 20) });
    return fail(res, 403, 'IDENTITY_CHANNEL_INVALID', '사용할 수 없는 본인확인 결과입니다. 고객센터로 문의해주세요.');
  }

  // ③-b 인증 시각 — 포트원 V2 응답의 verifiedAt(ISO) 기준. 필드가 없으면(구형 응답) 검사하지 않는다.
  const verifiedAtMs = iv.verifiedAt ? Date.parse(iv.verifiedAt) : NaN;
  if (Number.isFinite(verifiedAtMs) && Date.now() - verifiedAtMs > IDENTITY_FRESH_MS) {
    return failWith(res, STALE);
  }
  // ④ 결과 필드 검증 (타입·빈값·형식)
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
    return failWith(res, RESULT_MAP.birth_invalid);
  }
  if (!PHONE_RE.test(phone)) {
    // KCP 는 항상 반환, 다날은 전화번호 반환 추가 계약 필요 — 계약 옵션 문제라 운영자 확인 대상
    console.error('[verify-identity] 휴대폰 번호 누락 — PG 계약 옵션 확인 필요');
    return failWith(res, RESULT_MAP.phone_invalid);
  }
  if (isUnder14(birth)) {
    return failWith(res, RESULT_MAP.under_14);
  }

  // ⑤ 토큰 원문은 클라이언트에만, DB 에는 해시만. CI·ds 도 해시만.
  //    기록은 결속 함수로만 한다 — 등록 행을 잠근 채 ds·용도·1시간을 다시 대조한 뒤 기존 기록 함수를 부른다.
  //    옛 record_identity_verification 은 부르지 않는다(2부 배포 뒤 service_role 실행 권한이 회수된다).
  const token = randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(token);
  const ciHash = sha256Hex(ci);

  const { data: result, error } = await supabase.rpc('record_identity_verification_bound', {
    p_provider_ref: id,
    p_ds_hash: dsHash,
    p_pg: str(ch.pgProvider) || null,
    p_name: name,
    p_birthdate: birth,
    p_gender: str(c.gender) || null,
    p_phone: phone,
    p_operator: str(c.operator) || null,
    p_is_foreigner: typeof c.isForeigner === 'boolean' ? c.isForeigner : null,
    p_ci_hash: ciHash,
    p_token_hash: tokenHash,
    p_purpose: purpose,
    p_ip: ipAddr,
  });
  if (error) {
    console.error('[verify-identity] RPC 오류', error.message);
    return fail(res, 500, 'SERVER_ERROR', SERVER_ERROR_MSG);
  }
  if (result !== 'ok') {
    const m = lookup(RESULT_MAP, result);
    if (!m) {
      console.error('[verify-identity] 알 수 없는 RPC 결과', String(result));
      return fail(res, 500, 'SERVER_ERROR', SERVER_ERROR_MSG);
    }
    return failWith(res, m);
  }

  // ⑥ customer(이름·생년월일·휴대폰)는 가입 폼 잠금 표시에만 쓰므로 가입 용도에만 싣는다.
  //    비밀번호·아이디 찾기 화면은 토큰만 쓴다 — 개인정보를 응답에 더 싣지 않는다(설계 v2 §2-8).
  if (purpose !== 'signup_identity') {
    return res.status(200).json({ ok: true, verifyToken: token });
  }
  return res.status(200).json({
    ok: true,
    verifyToken: token,
    customer: { name, birthdate: birth, phone },
  });
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return; // 앱(Capacitor) 교차 출처 허용 + OPTIONS 종결
  res.setHeader('Cache-Control', 'no-store'); // 오류 응답까지 캐시 금지(start 의 id 포함)
  if (req.method !== 'POST') {
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed'); // 다른 api(signup·OTP·계정 찾기)와 같은 형식
  }

  try {
    const secret = (process.env.PORTONE_API_SECRET || '').trim();
    const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
    const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!secret) {
      // 계약·키 배포 전: 프론트도 같은 조건(VITE_PORTONE_*)으로 본인확인 UI 를 숨기므로 정상 사용자는 오지 않는다.
      // start·confirm 공통으로 형식 검사보다 먼저 본다(기존 순서 유지 — 꺼져 있으면 본문과 상관없이 503 이라 DB 를 건드리지
      // 않고, 배포 뒤 빈 요청 하나로 비밀키 설정 여부를 점검할 수 있다).
      return fail(res, 503, 'IDENTITY_DISABLED', '본인확인 서비스 준비 중입니다. 잠시 후 다시 시도해주세요.');
    }
    if (!SUPA_URL || !SUPA_KEY) {
      console.error('[verify-identity] 환경변수 누락', { hasSupaUrl: !!SUPA_URL, hasSupaKey: !!SUPA_KEY });
      return fail(res, 500, 'SERVER_CONFIG', '서버 설정 오류');
    }

    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const db = () => createClient(SUPA_URL, SUPA_KEY);
    // action 이 없으면 confirm — 결속 이전 화면·옛 앱은 action 없이 확인만 보낸다. 그 밖의 값은 400.
    const action = body.action ?? 'confirm';
    if (action === 'start') return await handleStart(req, res, body, db);
    if (action === 'confirm') return await handleConfirm(req, res, body, db, secret);
    return fail(res, 400, 'BAD_REQUEST', BAD_REQUEST_MSG);
  } catch (e) {
    console.error('[verify-identity] 예외', e?.message || e);
    return fail(res, 500, 'SERVER_ERROR', '본인확인 처리 중 오류가 발생했습니다.');
  }
}

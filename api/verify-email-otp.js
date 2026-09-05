// Vercel Serverless Function: 승무원 회사 이메일 OTP 검증
// POST /api/verify-email-otp  body: { email, code }
// purpose 는 클라이언트 값을 받지 않고 서버가 'airline_email' 로 고정한다 — 가입 완료 RPC 가
// 이 purpose 의 소비 토큰만 승무원 증빙으로 인정한다(codex 지적: 발송·검증 양쪽 고정).
// 성공 시 일회성 소비 토큰(verifyToken)을 발급한다. 가입 완료 RPC 가 이 토큰을 요구하므로,
// 실제로 인증을 통과한 그 클라이언트만 인증 결과를 사용할 수 있다.

import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'node:crypto';
import { applyCors } from './_cors.js';
import { hashOtp, otpHashSecret } from './_otp_hash.js';
import { checkAirlineDomain, airlineDomainFailure } from './_airline_domain.js';

// 실패 응답 규격(api/planner/_common.js 와 동일): 고정 code + 일반 문구.
const fail = (res, status, code, error) => res.status(status).json({ ok: false, code, error });

export default async function handler(req, res) {
  if (applyCors(req, res)) return; // 앱(Capacitor) 교차 출처 허용 + OPTIONS 종결
  if (req.method !== 'POST') {
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }
  try {
    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').replace(/[^0-9]/g, '');

    // 아래 둘은 사용자가 고쳐야 알 수 있는 검증 오류라 문구를 유지한다.
    if (!/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(email)) {
      return fail(res, 400, 'BAD_EMAIL', '이메일 형식이 올바르지 않습니다.');
    }
    if (code.length !== 6) {
      return fail(res, 400, 'BAD_CODE', '인증번호 6자리를 입력해주세요.');
    }

    const SUPA_URL = process.env.SUPABASE_URL;
    const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPA_URL || !SUPA_KEY) {
      return fail(res, 500, 'SERVER_CONFIG', '서버 설정 오류');
    }

    const supabase = createClient(SUPA_URL, SUPA_KEY);

    // 발송과 같은 규칙: 항공사 도메인이 아니면 검증도 하지 않는다.
    const domainFail = airlineDomainFailure(await checkAirlineDomain(supabase, email));
    if (domainFail) return fail(res, domainFail.status, domainFail.code, domainFail.error);

    // 발송 쪽과 같은 비밀이 있어야 해시 비교가 성립한다. 없으면 통과시키지 않는다(fail-closed).
    const OTP_SECRET = await otpHashSecret(supabase);
    if (!OTP_SECRET) {
      console.error('[verify-email-otp] OTP 해시 비밀 없음(env·Vault 모두) — 검증 중단');
      return fail(res, 503, 'SERVICE_UNAVAILABLE', '인증 서비스 준비 중입니다. 잠시 후 다시 시도해주세요.');
    }


    // 토큰은 원문을 클라이언트에만 주고 DB 에는 해시만 저장한다(DB 유출 시 그대로 쓰이지 않도록).
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    // 조회·검증·토큰기록을 DB 함수 한 트랜잭션에서 처리(동시 검증 시 마지막 토큰만 남는 경쟁 제거).
    // 비교는 code_hash 끼리 한다. p_code(평문)는 해시 도입 전에 발급된 행에만 쓰이는 전환기 인자다
    // (src/lib/otp_hash_20260905.sql 참조 — 배포 1시간 뒤 제거).
    const { data: result, error } = await supabase.rpc('verify_otp_and_issue_token', {
      p_kind: 'email',
      p_subject: email,
      p_code: code,
      p_code_hash: hashOtp(code, OTP_SECRET),
      p_token_hash: tokenHash,
      p_purpose: 'airline_email', // 서버 고정 — 클라이언트 값 무시
    });

    if (error) {
      console.error('[verify-email-otp] RPC 오류', error);
      return fail(res, 500, 'SERVER_ERROR', '인증 처리에 실패했습니다.');
    }

    if (result === 'too_many_attempts') {
      return fail(res, 429, 'TOO_MANY_ATTEMPTS', '시도 횟수 초과. 새 인증번호를 요청해주세요.');
    }
    if (result !== 'ok') {
      // not_found / mismatch 는 동일 문구로 응답(존재 여부 노출 방지)
      return fail(res, 400, 'OTP_INVALID', '인증번호가 일치하지 않거나 만료되었습니다.');
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, verifyToken: token });
  } catch (e) {
    console.error('[verify-email-otp] 예외', e);
    return fail(res, 500, 'SERVER_ERROR', '인증 처리에 실패했습니다.');
  }
}

// Vercel Serverless Function: SMS OTP 검증
// POST /api/verify-otp
// body: { phone: "01012345678", code: "123456", purpose? }
// 성공 시 일회성 소비 토큰(verifyToken)을 발급한다. 가입 완료 RPC 가 이 토큰을 요구하므로,
// 같은 번호로 인증만 통과하면 아무 계정이나 쓰던 문제를 막는다.

import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'node:crypto';
import { applyCors } from './_cors.js';
import { hashOtp, otpHashSecret } from './_otp_hash.js';

// 실패 응답 규격(api/planner/_common.js 와 동일): 고정 code + 일반 문구.
const fail = (res, status, code, error) => res.status(status).json({ ok: false, code, error });

export default async function handler(req, res) {
  if (applyCors(req, res)) return; // 앱(Capacitor) 교차 출처 허용 + OPTIONS 종결
  if (req.method !== 'POST') {
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }

  try {
    const body = req.body || {};
    const cleanPhone = String(body.phone || '').replace(/[^0-9]/g, '');
    const cleanCode = String(body.code || '').replace(/[^0-9]/g, '');
    const purpose = String(body.purpose || 'generic');

    // 아래 둘은 사용자가 고쳐야 알 수 있는 검증 오류라 문구를 유지한다.
    if (!/^01[016789][0-9]{7,8}$/.test(cleanPhone)) {
      return fail(res, 400, 'BAD_PHONE', '휴대폰 번호 형식이 올바르지 않습니다.');
    }
    if (cleanCode.length !== 6) {
      return fail(res, 400, 'BAD_CODE', '인증번호 6자리를 입력해주세요.');
    }

    const SUPA_URL = process.env.SUPABASE_URL;
    const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPA_URL || !SUPA_KEY) {
      return fail(res, 500, 'SERVER_CONFIG', '서버 설정 오류');
    }

    // 발송 쪽과 같은 비밀이 있어야 해시 비교가 성립한다. 없으면 통과시키지 않는다(fail-closed).
    const supabase = createClient(SUPA_URL, SUPA_KEY);
    const OTP_SECRET = await otpHashSecret(supabase);
    if (!OTP_SECRET) {
      console.error('[verify-otp] OTP 해시 비밀 없음(env·Vault 모두) — 검증 중단');
      return fail(res, 503, 'SERVICE_UNAVAILABLE', '인증 서비스 준비 중입니다. 잠시 후 다시 시도해주세요.');
    }


    // 토큰 원문은 클라이언트에만, DB 에는 해시만 저장한다.
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    // 조회·검증·토큰기록을 DB 함수 한 트랜잭션에서 처리(동시 검증 경쟁 제거).
    // 비교는 code_hash 끼리 한다. p_code(평문)는 해시 도입 전에 발급된 행에만 쓰이는 전환기 인자다
    // (src/lib/otp_hash_20260905.sql 참조 — 배포 1시간 뒤 제거).
    const { data: result, error } = await supabase.rpc('verify_otp_and_issue_token', {
      p_kind: 'phone',
      p_subject: cleanPhone,
      p_code: cleanCode,
      p_code_hash: hashOtp(cleanCode, OTP_SECRET),
      p_token_hash: tokenHash,
      p_purpose: purpose,
    });

    if (error) {
      console.error('[verify-otp] RPC 오류', error);
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
    console.error('[verify-otp] 예외', e);
    return fail(res, 500, 'SERVER_ERROR', '인증 처리에 실패했습니다.');
  }
}

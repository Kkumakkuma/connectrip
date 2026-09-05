// Vercel Serverless Function: 승무원 회사 이메일 OTP 발송 (Resend 사용)
// POST /api/send-email-otp  body: { email: "crew@koreanair.com" }
// 2026-09-05 가입 개편: 본인확인은 PASS 하나로 하고 개인 이메일 OTP 는 폐지했다. 이 API 는
// airline_domains 에 등록된 항공사 도메인에만 발송한다(api/_airline_domain.js) — 아무 주소로나
// 메일을 쏘는 비용·남용을 막고, 최종 판정은 DB RPC complete_signup_profile 이 같은 표로 다시 한다.
// 코드 원문은 메일로만 나가고 DB 에는 HMAC 해시(code_hash)만 저장한다 — api/_otp_hash.js 참조.

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
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

    if (!/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(email)) {
      // 사용자가 고쳐야 알 수 있는 검증 오류라 문구를 유지한다.
      return fail(res, 400, 'BAD_EMAIL', '이메일 형식이 올바르지 않습니다.');
    }

    const SUPA_URL = process.env.SUPABASE_URL;
    const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const RESEND_KEY = process.env.RESEND_API_KEY;
    const FROM = (process.env.EMAIL_FROM_ADDRESS || 'onboarding@resend.dev').trim();

    if (!SUPA_URL || !SUPA_KEY || !RESEND_KEY) {
      console.error('[send-email-otp] 환경변수 누락', {
        hasSupaUrl: !!SUPA_URL,
        hasSupaKey: !!SUPA_KEY,
        hasResendKey: !!RESEND_KEY,
      });
      return fail(res, 500, 'SERVER_CONFIG', '서버 설정 오류');
    }

    const supabase = createClient(SUPA_URL, SUPA_KEY);

    // 승무원 회사 메일 도메인만 발송한다. 조회 실패는 503, 미등록은 403 — 둘 다 발송 안 함.
    const domainFail = airlineDomainFailure(await checkAirlineDomain(supabase, email));
    if (domainFail) return fail(res, domainFail.status, domainFail.code, domainFail.error);

    // OTP 해시 비밀이 없으면 발송하지 않는다(fail-closed). 평문 저장으로 되돌아가지 않는다.
    const OTP_SECRET = await otpHashSecret(supabase);
    if (!OTP_SECRET) {
      console.error('[send-email-otp] OTP 해시 비밀 없음(env·Vault 모두) — 발송 중단');
      return fail(res, 503, 'SERVICE_UNAVAILABLE', '인증 서비스 준비 중입니다. 잠시 후 다시 시도해주세요.');
    }

    const ipAddr = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip'] || null;

    // 60초 레이트리밋 (같은 이메일)
    const sixtySecAgo = new Date(Date.now() - 60_000).toISOString();
    const { data: recent } = await supabase
      .from('email_otps')
      .select('id')
      .eq('email', email)
      .gte('created_at', sixtySecAgo)
      .limit(1);
    if (recent && recent.length > 0) {
      return fail(res, 429, 'RATE_LIMITED', '인증번호 발송은 60초마다 1회만 가능합니다.');
    }

    // 같은 IP 10분 12건 초과 차단 (이메일 주소를 바꿔가며 발송 남용/비용 유발 방어).
    if (ipAddr) {
      const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
      const { count: ipCount } = await supabase
        .from('email_otps')
        .select('id', { count: 'exact', head: true })
        .eq('ip_address', ipAddr)
        .gte('created_at', tenMinAgo);
      if ((ipCount || 0) >= 12) {
        return fail(res, 429, 'RATE_LIMITED', '인증 요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
      }
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // 원문(code)은 메일로만 나가고 DB 에는 HMAC 해시만 남긴다. code 컬럼은 채우지 않는다.
    const { error: insErr } = await supabase.from('email_otps').insert({
      email,
      code_hash: hashOtp(code, OTP_SECRET),
      expires_at: expiresAt,
      ip_address: ipAddr,
    });
    if (insErr) {
      console.error('[send-email-otp] DB insert 오류', insErr);
      return fail(res, 500, 'SERVER_ERROR', '인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: '[ConnectTrip] 승무원 회사 이메일 인증번호',
        html: `<div style="font-family:'Noto Sans KR',sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#ffffff">
  <h1 style="font-size:20px;color:#1e3a8a;margin-bottom:12px">ConnectTrip 승무원 회사 이메일 인증</h1>
  <p style="color:#334155;font-size:15px;line-height:1.6">아래 6자리 인증번호를 회원가입 화면의 승무원 회사 이메일 인증 칸에 입력해주세요.</p>
  <div style="font-size:32px;font-weight:700;color:#2563eb;letter-spacing:8px;text-align:center;background:#eff6ff;padding:20px 0;border-radius:12px;margin:24px 0">${code}</div>
  <p style="color:#64748b;font-size:13px;line-height:1.6">이 인증번호는 5분간 유효합니다.<br>본인이 요청하지 않았다면 이 이메일을 무시하셔도 됩니다.</p>
  <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="color:#94a3b8;font-size:12px">ConnectTrip — 여행자·승무원 커뮤니티</p>
</div>`,
      }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      // Resend 응답 원문은 서버 로그에만(도메인 검증 상태 등 내부 사정이 담긴다).
      console.error('[send-email-otp] Resend 발송 실패', resp.status, data);
      return fail(res, 502, 'PROVIDER_ERROR', '이메일 발송에 실패했습니다. 잠시 후 다시 시도하세요.');
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[send-email-otp] 예외', e);
    return fail(res, 500, 'SERVER_ERROR', '인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }
}

// Vercel Serverless Function: SMS OTP 발송
// POST /api/send-otp
// body: { phone: "01012345678" }
// Solapi HTTP API v4 + HMAC-SHA256 서명
// 코드 원문은 문자로만 나가고 DB 에는 HMAC 해시(code_hash)만 저장한다 — api/_otp_hash.js 참조.

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_cors.js';
import { hashOtp, otpHashSecret } from './_otp_hash.js';

// 실패 응답 규격(api/planner/_common.js 와 동일): 고정 code + 일반 문구.
// 내부 예외·외부 API 응답 원문은 절대 싣지 않는다 — 사유가 자세할수록 그 자체가 탐색 도구가 된다.
const fail = (res, status, code, error) => res.status(status).json({ ok: false, code, error });

function solapiAuthHeader(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(date + salt)
    .digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return; // 앱(Capacitor) 교차 출처 허용 + OPTIONS 종결
  if (req.method !== 'POST') {
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }

  try {
    const body = req.body || {};
    const phoneRaw = String(body.phone || '');
    const cleaned = phoneRaw.replace(/[^0-9]/g, '');

    if (!/^01[016789][0-9]{7,8}$/.test(cleaned)) {
      // 사용자가 고쳐야 알 수 있는 검증 오류라 문구를 유지한다.
      return fail(res, 400, 'BAD_PHONE', '휴대폰 번호 형식이 올바르지 않습니다.');
    }

    const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
    const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const SOLAPI_KEY = (process.env.SOLAPI_API_KEY || '').trim();
    const SOLAPI_SECRET = (process.env.SOLAPI_API_SECRET || '').trim();
    const SOLAPI_FROM = (process.env.SOLAPI_SENDER_NUMBER || '').trim();

    if (!SUPA_URL || !SUPA_KEY || !SOLAPI_KEY || !SOLAPI_SECRET || !SOLAPI_FROM) {
      console.error('[send-otp] 환경변수 누락', {
        hasSupaUrl: !!SUPA_URL,
        hasSupaKey: !!SUPA_KEY,
        hasSolapiKey: !!SOLAPI_KEY,
        hasSolapiSecret: !!SOLAPI_SECRET,
        hasSolapiFrom: !!SOLAPI_FROM,
      });
      return fail(res, 500, 'SERVER_CONFIG', '서버 설정 오류');
    }

    // OTP 해시 비밀이 없으면 발송하지 않는다. 여기서 평문 저장으로 되돌아가면
    // 감사에서 잡힌 그 취약점이 조용히 되살아난다(fail-closed).
    const supabase = createClient(SUPA_URL, SUPA_KEY);
    const OTP_SECRET = await otpHashSecret(supabase);
    if (!OTP_SECRET) {
      console.error('[send-otp] OTP 해시 비밀 없음(env·Vault 모두) — 발송 중단');
      return fail(res, 503, 'SERVICE_UNAVAILABLE', '인증 서비스 준비 중입니다. 잠시 후 다시 시도해주세요.');
    }

    const ipAddr = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip'] || null;

    // 레이트리밋 ①: 같은 번호에 최근 60초 내 발송 이력 있으면 차단
    const sixtySecAgo = new Date(Date.now() - 60_000).toISOString();
    const { data: recent } = await supabase
      .from('phone_otps')
      .select('id')
      .eq('phone', cleaned)
      .gte('created_at', sixtySecAgo)
      .limit(1);
    if (recent && recent.length > 0) {
      return fail(res, 429, 'RATE_LIMITED', '인증번호 발송은 60초마다 1회만 가능합니다. 잠시 후 다시 시도하세요.');
    }

    // 레이트리밋 ②: 같은 IP 에서 최근 10분 내 발송 8건 초과면 차단 (번호를 바꿔가며 SMS 비용을
    //   유발하는 펌핑 공격 방어). 정상 사용자는 본인 번호 1개라 도달하지 않는다.
    if (ipAddr) {
      const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
      const { count: ipCount } = await supabase
        .from('phone_otps')
        .select('id', { count: 'exact', head: true })
        .eq('ip_address', ipAddr)
        .gte('created_at', tenMinAgo);
      if ((ipCount || 0) >= 8) {
        return fail(res, 429, 'RATE_LIMITED', '인증 요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
      }
    }

    // 6자리 OTP 생성 (crypto 안전)
    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // 원문(code)은 문자로만 나가고 DB 에는 HMAC 해시만 남긴다. code 컬럼은 채우지 않는다.
    const { error: insErr } = await supabase.from('phone_otps').insert({
      phone: cleaned,
      code_hash: hashOtp(code, OTP_SECRET),
      expires_at: expiresAt,
      ip_address: ipAddr,
    });
    if (insErr) {
      console.error('[send-otp] DB insert 오류', insErr);
      return fail(res, 500, 'SERVER_ERROR', '인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }

    // Solapi 발송 (키 파생정보는 로그에 남기지 않는다 — 로그 경유 정보 노출 차단)
    console.log('[send-otp] Solapi 호출 준비', {
      fromNumber: String(SOLAPI_FROM).replace(/[^0-9]/g, ''),
      toNumber: cleaned.slice(0, 3) + '***',
    });
    const solResp = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: {
        Authorization: solapiAuthHeader(SOLAPI_KEY, SOLAPI_SECRET),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          to: cleaned,
          from: String(SOLAPI_FROM).replace(/[^0-9]/g, ''),
          text: `[ConnectTrip] 인증번호 ${code} (5분 유효). 이 번호는 발신전용입니다.`,
        },
      }),
    });
    const solData = await solResp.json().catch(() => null);
    if (!solResp.ok) {
      // Solapi 응답 원문은 서버 로그에만. 응답에 실으면 발신번호·계정 상태 같은 내부 사정이
      // 그대로 사용자 화면(과 그것을 긁는 쪽)으로 나간다. 원인 확인은 Vercel Logs 에서 한다.
      console.error('[send-otp] Solapi 발송 실패', solResp.status, solData);
      return fail(res, 502, 'PROVIDER_ERROR', 'SMS 발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[send-otp] 예외', e);
    return fail(res, 500, 'SERVER_ERROR', '인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }
}

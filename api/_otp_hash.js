// 공유 모듈: OTP 코드 해시 (2026-09-05 보안 감사 ⑤).
//
// phone_otps / email_otps 에는 6자리 원문을 저장하지 않는다 — 그 테이블 한 줄이 읽히면
// 문자·메일을 받지 못한 사람도 인증을 통과한다(= 본인확인 우회). 저장·비교 모두 해시로만 한다.
//
// 왜 sha256 이 아니라 HMAC 인가: 6자리는 경우의 수가 100만이라 페퍼 없는 해시는 노트북으로도
// 즉시 전수대입된다. 서버만 아는 비밀을 키로 써야 해시가 의미를 갖는다.
//
// 비밀의 출처(우선순위):
//   1) Vercel 환경변수 OTP_HASH_SECRET — 있으면 그대로 쓴다.
//   2) Supabase Vault 의 ct_otp_hash_key_v1 — service_role 전용 RPC otp_hash_secret() 로 읽는다.
//      (플래너 청소 토큰과 같은 방식. 환경변수를 새로 등록하지 않아도 fail-closed 가 성립한다.)
//   둘 다 없으면 빈 문자열 → 호출부가 503 으로 닫는다(평문 저장으로 조용히 되돌아가지 않는다).
// Vault 값은 인스턴스 메모리에 5분 캐시한다. OTP 수명(5분)과 같아서, 키를 바꾸면 최대 5분간
// 옛 키로 발급된 코드가 검증 불가가 되는데 이는 키 회전 시 감수하는 창이다. 캐시가 만료된 뒤
// RPC 가 실패하면 마지막 값을 그대로 쓴다(순단 완충). 처음부터 한 번도 못 읽었을 때만 503.
//
// 왜 SUPABASE_SERVICE_ROLE_KEY 에서 파생하지 않는가: 그 키를 돌리는 순간 발급 중인 OTP 가 전부
// 죽고, 한쪽 유출이 곧 다른 쪽 유출이 된다.
//
// ⚠ 배포 순서: src/lib/otp_hash_20260905.sql(컬럼·RPC·Vault 비밀) 적용이 먼저다.
//   코드만 올라가면 code_hash 컬럼이 없어 발송 insert 가 실패한다.

import { createHmac } from 'node:crypto';

const CACHE_MS = 5 * 60 * 1000;
let cache = null; // { value, at }

/** 테스트용: 인스턴스 캐시 비우기. */
export function resetOtpSecretCache() {
  cache = null;
}

/**
 * 서버 비밀. env → Vault(RPC) 순. 둘 다 없으면 빈 문자열 — 호출부가 503(SERVICE_UNAVAILABLE)으로 닫는다.
 * @param {object} [supabase] service_role 클라이언트(Vault 조회용). 없으면 env 만 본다.
 */
export async function otpHashSecret(supabase) {
  const env = (process.env.OTP_HASH_SECRET || '').trim();
  if (env) return env;
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  if (!supabase || typeof supabase.rpc !== 'function') return cache ? cache.value : '';
  try {
    const { data, error } = await supabase.rpc('otp_hash_secret');
    const value = !error && typeof data === 'string' ? data.trim() : '';
    if (value) {
      cache = { value, at: Date.now() };
      return value;
    }
  } catch {
    // 아래 stale 폴백으로
  }
  // RPC 가 잠깐 죽었을 때: 만료됐더라도 이 인스턴스가 마지막으로 읽은 값을 쓴다.
  // 키는 회전 때만 바뀌므로, DB 순단 한 번에 인증 전체를 503 으로 닫지 않기 위한 완충이다(agy 지적 반영).
  return cache ? cache.value : '';
}

/** OTP 원문 → HMAC-SHA256 hex(64자). 비밀이 없으면 null. */
export function hashOtp(code, secret) {
  if (!secret) return null;
  return createHmac('sha256', secret).update(String(code), 'utf8').digest('hex');
}

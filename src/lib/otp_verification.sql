-- OTP 인증 테이블 (2026-04-21)
-- Solapi SMS OTP 6자리 인증번호 저장 및 검증용.
-- Vercel Serverless Function (/api/send-otp, /api/verify-otp) 에서 service_role 키로 접근.
-- 일반 클라이언트(anon) 접근은 RLS로 차단.
-- Supabase SQL Editor 에 이 내용 전체 붙여넣고 Run.

CREATE TABLE IF NOT EXISTS public.phone_otps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,             -- 숫자만 (01012345678)
  code        TEXT NOT NULL,             -- 6자리 인증번호
  expires_at  TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  ip_address  TEXT,                      -- 레이트리밋용 (나중)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_otps_phone ON public.phone_otps (phone);
CREATE INDEX IF NOT EXISTS idx_phone_otps_created_at ON public.phone_otps (created_at);

-- RLS: 익명 사용자는 접근 불가 (service_role만 쓰기/읽기).
-- 정책 없음 + RLS 켜짐 = anon 차단.
ALTER TABLE public.phone_otps ENABLE ROW LEVEL SECURITY;

-- 만료된 OTP는 24시간 후 자동 삭제 (크론 역할을 pg_cron 대신 수동/주기 클린업으로)
-- 운영 쿼리 예시:
-- DELETE FROM public.phone_otps WHERE created_at < NOW() - INTERVAL '24 hours';

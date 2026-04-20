-- 이메일 OTP 인증 테이블 (2026-04-21)
-- Resend API 로 6자리 인증번호 이메일 발송. /api/send-email-otp, /api/verify-email-otp 에서 service_role 로 접근.
-- Supabase SQL Editor 에 전체 붙여넣고 Run.

CREATE TABLE IF NOT EXISTS public.email_otps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  code        TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_otps_email ON public.email_otps (email);
CREATE INDEX IF NOT EXISTS idx_email_otps_created_at ON public.email_otps (created_at);

-- RLS: 익명 접근 차단. service_role 만 읽기/쓰기.
ALTER TABLE public.email_otps ENABLE ROW LEVEL SECURITY;

-- 만료 24시간 지난 레코드 정리 쿼리 (필요 시 주기 실행):
-- DELETE FROM public.email_otps WHERE created_at < NOW() - INTERVAL '24 hours';

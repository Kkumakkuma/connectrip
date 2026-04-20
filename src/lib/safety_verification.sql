-- 안전/신원 검증 확장: 통신사 본인인증 강제 업그레이드를 위한 플래그 (2026-04-21)
-- ConnecTrip 제품 원칙: 낯선 사람 만남 서비스 → 범죄 예방이 최우선.
-- 초기엔 SMS OTP (Solapi) 로 휴대폰 본인 번호만 검증, 사업자 등록 후 통신사 본인인증 강제 적용.
-- Supabase SQL Editor 에서 한 번 실행.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS identity_verified      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verification_method    TEXT,           -- 'sms_otp' | 'sms_otp_pending' | 'carrier_auth' | NULL
  ADD COLUMN IF NOT EXISTS verified_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_required  BOOLEAN DEFAULT FALSE;  -- TRUE 로 바꾸면 로그인 후 통신사 인증 강제 플로우

-- 기존 사용자 상태 표시용 (Solapi 붙기 전 가입자는 pending 상태)
UPDATE public.profiles
SET verification_method = 'sms_otp_pending'
WHERE phone_verified = TRUE
  AND verification_method IS NULL;

-- 신규 가입 트리거 확장: 회원가입 메타데이터에서 identity_verified / verification_method 받기
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  meta JSONB;
BEGIN
  meta := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  INSERT INTO public.profiles (
    id, email, name, nickname, phone, phone_verified,
    address_zipcode, address_road, address_detail,
    user_type, avatar_url, provider, profile_completed, referred_by,
    identity_verified, verification_method
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(meta->>'name', meta->>'full_name', split_part(NEW.email, '@', 1)),
    NULLIF(meta->>'nickname', ''),
    NULLIF(meta->>'phone', ''),
    COALESCE((meta->>'phone_verified')::boolean, FALSE),
    NULLIF(meta->>'address_zipcode', ''),
    NULLIF(meta->>'address_road', ''),
    NULLIF(meta->>'address_detail', ''),
    COALESCE(NULLIF(meta->>'user_type', ''), 'traveler'),
    NULLIF(meta->>'avatar_url', ''),
    COALESCE(NULLIF(NEW.raw_app_meta_data->>'provider', ''), 'email'),
    COALESCE((meta->>'profile_completed')::boolean, FALSE),
    CASE WHEN (meta->>'referred_by') ~ '^[0-9a-fA-F-]{36}$'
         THEN (meta->>'referred_by')::uuid ELSE NULL END,
    COALESCE((meta->>'identity_verified')::boolean, FALSE),
    NULLIF(meta->>'verification_method', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 인덱스: 나중 일괄 강제 업그레이드 쿼리 빠르게
CREATE INDEX IF NOT EXISTS idx_profiles_identity_verified ON public.profiles (identity_verified);
CREATE INDEX IF NOT EXISTS idx_profiles_verification_required ON public.profiles (verification_required);

-- 운영 쿼리 예시 (주석, 실행 X):
-- 통신사 본인인증 도입 시 모든 sms_otp 유저에게 강제 플래그 부여:
-- UPDATE public.profiles SET verification_required = TRUE WHERE verification_method IN ('sms_otp', 'sms_otp_pending');
--
-- 통신사 인증 완료한 유저를 승격:
-- UPDATE public.profiles SET identity_verified = TRUE, verification_method = 'carrier_auth',
--   verification_required = FALSE, verified_at = NOW() WHERE id = '...';

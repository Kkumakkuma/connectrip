-- 회원가입 확장: 휴대폰/주소/닉네임 필드 추가 (2026-04-19)
-- Supabase SQL Editor에서 한 번 실행하면 됨.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS nickname TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS address_zipcode TEXT,
  ADD COLUMN IF NOT EXISTS address_road TEXT,
  ADD COLUMN IF NOT EXISTS address_detail TEXT,
  ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN DEFAULT FALSE;

-- 기존 사용자는 profile_completed=true 로 간주 (migration 안전)
UPDATE public.profiles
SET profile_completed = TRUE
WHERE created_at < '2026-04-19'::TIMESTAMPTZ
  AND profile_completed IS DISTINCT FROM TRUE;

-- 닉네임 중복 체크용 인덱스 (이미 UNIQUE 제약이 있지만 명시)
CREATE INDEX IF NOT EXISTS idx_profiles_nickname ON public.profiles (nickname);

-- OAuth(구글/카카오) 사용자는 trigger로 자동 생성된 뒤 profile_completed=false 로 유지
-- /signup/complete 페이지에서 나머지 정보를 채워야 profile_completed=true 로 변경됨

-- 추천인 기능
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS referral_bonus_given BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_referred_by ON public.profiles (referred_by);

-- 추천 보너스 지급 함수: referred_by 가 세팅되고 referral_bonus_given=false 면
-- 본인+추천인 양쪽에 포인트 +10,000 지급 후 플래그 true 로.
CREATE OR REPLACE FUNCTION public.grant_referral_bonus(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_referrer UUID;
  v_given BOOLEAN;
BEGIN
  SELECT referred_by, referral_bonus_given INTO v_referrer, v_given
  FROM public.profiles WHERE id = p_user_id;

  IF v_referrer IS NULL OR v_given THEN
    RETURN;
  END IF;

  UPDATE public.profiles
    SET points_balance = COALESCE(points_balance, 0) + 10000,
        referral_bonus_given = TRUE,
        updated_at = NOW()
    WHERE id = p_user_id;

  UPDATE public.profiles
    SET points_balance = COALESCE(points_balance, 0) + 10000,
        updated_at = NOW()
    WHERE id = v_referrer;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

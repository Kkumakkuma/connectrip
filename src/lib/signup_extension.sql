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
-- 본인+추천인 양쪽에 포인트 +3,000 지급 후 플래그 true 로.
-- 신규 사용자 생성 트리거 확장: /signup/email 에서 signUp({ data: metadata }) 로 넘긴
-- 모든 필드를 profiles 테이블에 자동 반영. 이메일 확인 ON 상태에서도 OK.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  meta JSONB;
BEGIN
  meta := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  INSERT INTO public.profiles (
    id, email, name, nickname, phone, phone_verified,
    address_zipcode, address_road, address_detail,
    user_type, avatar_url, provider, profile_completed, referred_by
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
         THEN (meta->>'referred_by')::uuid ELSE NULL END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
    SET points_balance = COALESCE(points_balance, 0) + 3000,
        referral_bonus_given = TRUE,
        updated_at = NOW()
    WHERE id = p_user_id;

  UPDATE public.profiles
    SET points_balance = COALESCE(points_balance, 0) + 3000,
        updated_at = NOW()
    WHERE id = v_referrer;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

-- ★ 이 파일의 초기 버전은 무제한·전회원 지급이었음. 2026-07-18 최종 정책(보너스는 인증 승무원인
--   당사자에게만 각 3,000P / 가입자 1회 / 추천인 최대 20회=총 60,000P / 상시)으로
--   security_hardening.sql 5-7 과 동일본 유지. (재실행 시 운영 함수 퇴행 방지)
CREATE OR REPLACE FUNCTION public.grant_referral_bonus(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_referrer UUID;
  v_paid_count INT;
  v_new_is_crew BOOLEAN;
  v_ref_is_crew BOOLEAN;
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  PERFORM set_config('app.allow_sensitive', 'on', true);

  -- 당사자별 승무원 판정: 인증 승무원인 쪽만 지급.
  -- complete_signup_profile 이 crew_verified 세팅 "후" 본 함수를 호출하므로 같은 트랜잭션에서 판정 가능.
  SELECT (user_type = 'crew' AND COALESCE(crew_verified, FALSE)), referred_by
    INTO v_new_is_crew, v_referrer
    FROM public.profiles WHERE id = p_user_id;
  IF v_referrer IS NULL THEN RETURN; END IF;
  SELECT (user_type = 'crew' AND COALESCE(crew_verified, FALSE))
    INTO v_ref_is_crew
    FROM public.profiles WHERE id = v_referrer;
  IF NOT COALESCE(v_new_is_crew, FALSE) AND NOT COALESCE(v_ref_is_crew, FALSE) THEN
    RETURN;  -- 둘 다 일반 회원이면 지급 대상 없음
  END IF;

  -- 이 가입의 추천 처리 멱등 마킹 + 가입자가 승무원이면 본인 3,000P 동시 지급
  -- (이미 처리된 가입이면 0 rows → 종료. 중복 지급 불가)
  UPDATE public.profiles
    SET points_balance = COALESCE(points_balance, 0)
                         + CASE WHEN COALESCE(v_new_is_crew, FALSE) THEN 3000 ELSE 0 END,
        referral_bonus_given = TRUE, updated_at = NOW()
    WHERE id = p_user_id
      AND COALESCE(referral_bonus_given, FALSE) = FALSE
      AND referred_by IS NOT NULL
    RETURNING referred_by INTO v_referrer;
  IF v_referrer IS NULL THEN RETURN; END IF;

  -- 추천인이 승무원이면 3,000P: 최대 20회(총 60,000P). 동시 가입 경합으로 상한 초과 지급이 없도록
  -- 추천인 row 를 잠근 뒤 처리 횟수를 센다 (처리 마커 count 에 방금 처리된 가입자 본인 포함).
  IF NOT COALESCE(v_ref_is_crew, FALSE) THEN RETURN; END IF;
  PERFORM 1 FROM public.profiles WHERE id = v_referrer FOR UPDATE;
  SELECT count(*) INTO v_paid_count
    FROM public.profiles
   WHERE referred_by = v_referrer
     AND COALESCE(referral_bonus_given, FALSE) = TRUE;
  IF v_paid_count <= 20 THEN
    UPDATE public.profiles
      SET points_balance = COALESCE(points_balance, 0) + 3000, updated_at = NOW()
      WHERE id = v_referrer;
  END IF;
END;
$$;

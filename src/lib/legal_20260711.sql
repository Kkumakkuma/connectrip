-- ============================================================
-- ConnectTrip 법규 대응 마이그레이션 (2026-07-11)
-- 개인정보보호법(PIPA) 대응 (2026-07-11 3차 보정 포함):
--   1) 만 14세 연령확인   : birthdate 는 profiles 가 아니라 비공개 테이블 profiles_private 에 저장.
--                           handle_new_user(이메일가입 birthdate 필수) / complete_signup_profile 서버 검증.
--   2) 회원탈퇴(파기)      : request_account_deletion RPC — 탈퇴자 식별정보는 파기하되
--                           쪽지/매칭은 상대방 이력 보존 위해 익명화(FK ON DELETE SET NULL).
--   3) 생년월일 비공개     : profiles_private(user_id PK) + RLS 로 본인(auth.uid()=user_id)만 SELECT/INSERT/UPDATE.
--                           → 타인은 birthdate 접근 불가. profiles 테이블 자체 조회정책은 건드리지 않는다
--                             (프론트 10곳+ 이 profiles 를 직접 SELECT 하므로 회귀 0을 보장).
--   4) (문구) 국외이전 고지 : Privacy.jsx 에서 처리.
--
-- ★ 3차 보정 요지: 2차의 "profiles SELECT 전체 회수 + 화이트리스트 컬럼 GRANT" 잠금을 폐기했다.
--   실측 결과 AuthContext.jsx / db.js / pushNotifications.js / SignupEmail·SignupComplete 등
--   10곳+ 이 profiles 를 직접 SELECT 하므로, 그 잠금은 42501 권한오류로 로그인·마이페이지·게시판을 깼다.
--   민감정보(생년월일)는 컬럼 잠금 대신 별도 비공개 테이블 격리(profiles_private)로 보호한다.
--
-- ★ 적용: Supabase SQL Editor(프로젝트 owhtldabzcvavsazdufy)에서 이 파일 전체를 1회 Run.
--   security_hardening.sql / signup_extension.sql 가 이미 적용된 위에 얹는 멱등 스크립트.
-- ★ 배포 순서 권장: 이 SQL 먼저 적용 → 그 다음 코드 push(Vercel 배포).
--   (신버전 클라는 complete_signup_profile 에 p_birthdate 를 넘긴다. SQL 을 먼저 반영해야
--    전환 구간에서 "함수 없음" 에러가 없다.)
-- ★ request_account_deletion 은 auth.users 를 삭제한다. Supabase SQL Editor(소유자=postgres)로
--   생성하면 auth 스키마에 대한 권한이 있어 정상 동작한다. 소유자가 다르면 auth.users 삭제가
--   막힐 수 있으니 postgres 로 실행할 것.
-- ============================================================

-- ------------------------------------------------------------
-- 0. 컬럼/테이블 준비 (멱등)
-- ------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;   -- (예비) 소프트 삭제 시각. 하드삭제 경로에서는 미사용.

-- 0-1. 생년월일 비공개 테이블 — profiles 와 분리해 본인만 접근하도록 격리.
--   profiles 컬럼으로 두면 profiles 를 조회하는 아무 화면에서나 타인 birthdate 가 노출될 수 있어,
--   RLS 로 본인행만 열람 가능한 별도 테이블에 담는다. auth.users 삭제 시 CASCADE 로 함께 파기된다.
CREATE TABLE IF NOT EXISTS public.profiles_private (
  user_id   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  birthdate DATE                                        -- 만 14세 연령확인용 생년월일(본인만 열람)
);
ALTER TABLE public.profiles_private ENABLE ROW LEVEL SECURITY;

-- 본인(auth.uid()=user_id)만 SELECT/INSERT/UPDATE. 타인·anon 은 접근 불가.
DROP POLICY IF EXISTS "own_private_select" ON public.profiles_private;
CREATE POLICY "own_private_select" ON public.profiles_private
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own_private_insert" ON public.profiles_private;
CREATE POLICY "own_private_insert" ON public.profiles_private
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own_private_update" ON public.profiles_private;
CREATE POLICY "own_private_update" ON public.profiles_private
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- anon 은 전면 차단, authenticated 는 위 RLS 로 본인행만.
REVOKE ALL   ON TABLE public.profiles_private FROM anon;
GRANT  SELECT, INSERT, UPDATE ON TABLE public.profiles_private TO authenticated;

-- 0-2. (이관·정리) 이전 2차 스크립트가 추가했을 수 있는 profiles.birthdate 를 profiles_private 로 옮기고 제거(취소).
--   프레시 실행(2차 미적용)이면 이 블록은 아무 일도 하지 않는다. 재실행 안전.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'birthdate'
  ) THEN
    INSERT INTO public.profiles_private (user_id, birthdate)
      SELECT id, birthdate FROM public.profiles WHERE birthdate IS NOT NULL
      ON CONFLICT (user_id) DO UPDATE SET birthdate = EXCLUDED.birthdate;
    ALTER TABLE public.profiles DROP COLUMN birthdate;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 1. 만 14세 미만 가입 차단 — 가입 INSERT 트리거(handle_new_user) 재정의
--    security_hardening.sql 의 정의를 그대로 유지하고 만14세 미만 예외 + birthdate 를
--    profiles_private 저장만 추가한다(profiles 에는 birthdate 를 넣지 않는다).
--    (이메일 가입은 signUp metadata 로 birthdate 를 넘기므로 여기서 즉시 차단 가능.
--     OAuth 가입은 birthdate 가 없어 NULL → 이후 complete_signup_profile 에서 강제.)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  meta JSONB;
  v_bd DATE;
  v_provider TEXT;
BEGIN
  meta := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_provider := COALESCE(NULLIF(NEW.raw_app_meta_data->>'provider', ''), 'email');
  -- 생년월일(이메일 가입 metadata). 형식이 맞을 때만 파싱.
  v_bd := CASE WHEN (meta->>'birthdate') ~ '^\d{4}-\d{2}-\d{2}$'
               THEN (meta->>'birthdate')::date ELSE NULL END;
  -- 만 14세 미만이면 가입 자체를 차단(auth.users INSERT 롤백) — 생년월일이 있으면 전 provider 공통
  IF v_bd IS NOT NULL AND v_bd > (CURRENT_DATE - INTERVAL '14 years') THEN
    RAISE EXCEPTION 'age_under_14';
  END IF;
  -- 이메일 직접가입은 생년월일 metadata 필수. 누락/조작으로 만14세 확인을 우회하려는 signUp 은
  -- 여기서 트랜잭션을 롤백해 auth.users 가 생성(=개인정보 수집)되기 전에 차단한다.
  -- (OAuth 가입은 provider<>'email' 이고 birthdate 가 없어 NULL 허용 → complete_signup_profile 에서 강제.)
  IF v_provider = 'email' AND v_bd IS NULL THEN
    RAISE EXCEPTION 'birthdate required';
  END IF;

  INSERT INTO public.profiles (
    id, email, name, nickname, phone,
    address_zipcode, address_road, address_detail,
    avatar_url, provider, referred_by,
    -- 보호컬럼: 항상 안전 기본값 (가입 후 complete_signup_profile RPC 가 서버검증 후 설정)
    user_type, phone_verified, identity_verified, verification_method,
    crew_verified, profile_completed
  ) VALUES (
    NEW.id, NEW.email,
    COALESCE(meta->>'name', meta->>'full_name', split_part(NEW.email, '@', 1)),
    NULLIF(meta->>'nickname', ''),
    NULLIF(regexp_replace(COALESCE(meta->>'phone',''), '[^0-9]', '', 'g'), ''),
    NULLIF(meta->>'address_zipcode', ''),
    NULLIF(meta->>'address_road', ''),
    NULLIF(meta->>'address_detail', ''),
    NULLIF(meta->>'avatar_url', ''),
    COALESCE(NULLIF(NEW.raw_app_meta_data->>'provider', ''), 'email'),
    -- referred_by 는 metadata 로 선주입하지 않는다(NULL). 추천인은 complete_signup_profile 이
    -- 서버검증(인증 승무원 여부)한 값만 기록 → 단일 신뢰 경로(2026-07-18).
    NULL,
    'traveler', FALSE, FALSE, 'sms_otp_pending', FALSE, FALSE
  );

  -- 생년월일은 비공개 테이블에 저장(profiles 에는 저장하지 않음). OAuth 가입은 v_bd 가 NULL 이라
  -- 빈 행이 생성되고, 이후 complete_signup_profile 이 실제 birthdate 로 upsert 한다.
  INSERT INTO public.profiles_private (user_id, birthdate)
  VALUES (NEW.id, v_bd)
  ON CONFLICT (user_id) DO UPDATE SET birthdate = EXCLUDED.birthdate;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 2. complete_signup_profile 재정의 — 만 14세 서버 검증 + birthdate 를 profiles_private 저장
--    기존 10-인자 함수를 DROP 하고 p_birthdate 를 추가한 함수로 교체(시그니처·프론트 호출부 유지).
--    p_birthdate DEFAULT NULL 로 두되, 본문에서 NULL/만14세미만을 예외 처리(우회 불가).
--    profiles 에는 birthdate 를 넣지 않고 profiles_private 로 upsert 한다.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.complete_signup_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.complete_signup_profile(
  p_name TEXT, p_nickname TEXT, p_phone TEXT,
  p_zipcode TEXT, p_road TEXT, p_detail TEXT,
  p_user_type TEXT, p_airline_email TEXT, p_airline_name TEXT,
  p_referred_by UUID,
  p_birthdate DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_phone_ok    BOOLEAN;
  v_crew        BOOLEAN := FALSE;
  v_clean_phone TEXT;
  v_ref         UUID;
  v_domain      TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_user_type NOT IN ('traveler', 'crew') THEN RAISE EXCEPTION 'invalid user_type'; END IF;

  -- 만 14세 연령확인 (서버 권위 검증 — 클라 우회 방지)
  IF p_birthdate IS NULL THEN RAISE EXCEPTION 'birthdate required'; END IF;
  IF p_birthdate > (CURRENT_DATE - INTERVAL '14 years') THEN
    RAISE EXCEPTION 'age_under_14';
  END IF;

  v_clean_phone := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');

  -- 휴대폰 본인인증 서버 재검증 (최근 1시간 내 인증된 번호)
  SELECT EXISTS (
    SELECT 1 FROM public.phone_otps
    WHERE phone = v_clean_phone AND verified_at IS NOT NULL
      AND verified_at > NOW() - INTERVAL '1 hour'
  ) INTO v_phone_ok;
  IF NOT v_phone_ok THEN RAISE EXCEPTION 'phone not verified'; END IF;

  -- 승무원이면 항공사 이메일 도메인을 화이트리스트로 서버 검증
  IF p_user_type = 'crew' THEN
    v_domain := lower(split_part(COALESCE(p_airline_email, ''), '@', 2));
    SELECT EXISTS (SELECT 1 FROM public.airline_domains WHERE domain = v_domain) INTO v_crew;
    IF NOT v_crew THEN RAISE EXCEPTION 'crew airline verification required'; END IF;
  END IF;

  v_ref := p_referred_by;
  IF v_ref = auth.uid() THEN v_ref := NULL; END IF; -- self-referral 차단
  -- 추천인은 "인증 승무원"만 유효 (2026-07-18 정책, 마이그레이션 complete_signup_validate_crew_referrer).
  -- UI(find_crew_referrer)를 우회한 임의 UUID 를 서버에서도 무시. 미해당/미존재면 NULL.
  IF v_ref IS NOT NULL THEN
    SELECT CASE WHEN (user_type = 'crew' AND COALESCE(crew_verified, FALSE)) THEN v_ref ELSE NULL END
      INTO v_ref
      FROM public.profiles WHERE id = v_ref;  -- 미존재 시 INTO 가 NULL 세팅
  END IF;

  PERFORM set_config('app.allow_sensitive', 'on', true);
  UPDATE public.profiles SET
    name                = p_name,
    nickname            = p_nickname,
    phone               = v_clean_phone,
    phone_verified      = TRUE,
    verification_method = COALESCE(verification_method, 'sms_otp'),
    address_zipcode     = p_zipcode,
    address_road        = p_road,
    address_detail      = p_detail,
    user_type           = p_user_type,
    airline_email       = CASE WHEN v_crew THEN p_airline_email ELSE airline_email END,
    airline_name        = CASE WHEN v_crew THEN p_airline_name  ELSE airline_name  END,
    crew_verified       = CASE WHEN v_crew THEN TRUE ELSE crew_verified END,
    crew_verified_at    = CASE WHEN v_crew THEN NOW() ELSE crew_verified_at END,
    referred_by         = COALESCE(referred_by, v_ref),
    profile_completed   = TRUE,
    updated_at          = NOW()
  WHERE id = auth.uid();

  -- 생년월일은 비공개 테이블에 저장(profiles 에는 저장하지 않음).
  INSERT INTO public.profiles_private (user_id, birthdate)
  VALUES (auth.uid(), p_birthdate)
  ON CONFLICT (user_id) DO UPDATE SET birthdate = EXCLUDED.birthdate;

  IF v_ref IS NOT NULL THEN
    PERFORM public.grant_referral_bonus(auth.uid());
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_signup_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_signup_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE) TO authenticated;

-- ------------------------------------------------------------
-- 3. 회원탈퇴 — 개인정보 파기 + 법정 보존기록 분리보관
-- ------------------------------------------------------------

-- 3-0. 탈퇴 익명화 준비 — 쪽지/매칭/장터구매자의 프로필 FK 를 ON DELETE SET NULL 로 전환.
--   기존 스키마는 messages.sender_id/receiver_id, commendation_matches.crew_user_id/passenger_user_id,
--   market_listings.buyer_id 가 profiles(id) 를 ON DELETE 미지정(NO ACTION=RESTRICT)으로 참조했다.
--   → 탈퇴 시 물리 DELETE 로 상대방 이력까지 지워야만 auth.users 삭제가 가능했고, 특히 buyer_id 는
--     선정리도 안 돼 '물건을 산 적 있는 회원'의 탈퇴가 아예 막히던 잠복결함이었다.
--   SET NULL 로 바꾸면 auth.users 삭제→profiles CASCADE 파기 시 탈퇴자측 컬럼만 NULL 로 익명화되고
--   (=화면에 '탈퇴한 사용자'), 상대방의 대화·매칭·판매 이력은 그대로 보존된다.
--   FK 는 이름이 아니라 "컬럼 기준"으로 찾아 걷어낸다(실제 FK명이 표준과 달라도 안전).
--   messages/commendation_matches 는 profiles 참조 FK 가 대상 컬럼뿐이라 전부 걷어내고 표준명으로 재생성.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT rel.relname AS tbl, con.conname
    FROM pg_constraint con
    JOIN pg_class     rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns  ON ns.oid = rel.relnamespace
    WHERE con.contype = 'f'
      AND ns.nspname = 'public'
      AND rel.relname IN ('messages', 'commendation_matches')
      AND con.confrelid = 'public.profiles'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

-- (3차 codex 방어) SET NULL 대상 컬럼 nullable 보장 — 이미 nullable 이면 무해·멱등.
-- 만약 NOT NULL 이면 auth.users 삭제 시 SET NULL 이 not-null 위반으로 롤백되어 탈퇴가 막힌다.
ALTER TABLE public.messages             ALTER COLUMN sender_id         DROP NOT NULL;
ALTER TABLE public.messages             ALTER COLUMN receiver_id       DROP NOT NULL;
ALTER TABLE public.commendation_matches ALTER COLUMN crew_user_id      DROP NOT NULL;
ALTER TABLE public.commendation_matches ALTER COLUMN passenger_user_id DROP NOT NULL;
ALTER TABLE public.market_listings      ALTER COLUMN buyer_id          DROP NOT NULL;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_sender_id_fkey
    FOREIGN KEY (sender_id)   REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD CONSTRAINT messages_receiver_id_fkey
    FOREIGN KEY (receiver_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.commendation_matches
  ADD CONSTRAINT commendation_matches_crew_user_id_fkey
    FOREIGN KEY (crew_user_id)      REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD CONSTRAINT commendation_matches_passenger_user_id_fkey
    FOREIGN KEY (passenger_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 장터 구매자: 판매자(user_id, CASCADE)는 그대로 두고 buyer_id 만 SET NULL 로 교체.
--   market_listings 는 user_id·buyer_id 두 FK 가 모두 profiles 를 참조하므로, 테이블 전체를 걷어내면
--   판매자 CASCADE 까지 날아간다. 따라서 "buyer_id 컬럼을 참조하는 FK" 만 컬럼 기준으로 찾아 제거한다
--   (실제 FK명이 market_listings_buyer_id_fkey 가 아니어도 안전 — messages/matches 와 동일 패턴).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class     rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns  ON ns.oid = rel.relnamespace
    WHERE con.contype = 'f'
      AND ns.nspname = 'public'
      AND rel.relname = 'market_listings'
      AND con.confrelid = 'public.profiles'::regclass
      AND (SELECT attname FROM pg_attribute
           WHERE attrelid = con.conrelid AND attnum = con.conkey[1]) = 'buyer_id'
  LOOP
    EXECUTE format('ALTER TABLE public.market_listings DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.market_listings
  ADD CONSTRAINT market_listings_buyer_id_fkey
    FOREIGN KEY (buyer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 3-1. 분리보관 아카이브 (전자상거래법 등 결제·거래기록 보존용, 접근 제한)
--      RLS ON + 정책 없음 = 일반/anon 접근 전면 차단. RPC(SECURITY DEFINER)와 service_role 만 기록/열람.
CREATE TABLE IF NOT EXISTS public.account_deletion_archive (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            UUID,            -- 법적 분쟁 대응 목적(접근 통제됨). 라이브 profiles 와 분리 보관.
  email_hash         TEXT,            -- 원문 대신 해시(md5)만 보관
  reason             TEXT DEFAULT 'user_requested',
  point_transactions JSONB,           -- 결제·포인트 거래기록 스냅샷(법정 보존 대상)
  deleted_at         TIMESTAMPTZ DEFAULT NOW(),
  retention_until    DATE             -- 보존 만료일(거래기록 최장 5년)
);
ALTER TABLE public.account_deletion_archive ENABLE ROW LEVEL SECURITY;
-- (의도적으로 정책을 만들지 않는다 → authenticated/anon 은 SELECT/INSERT 불가.
--  service_role 은 RLS 를 우회하므로 운영/감사 접근은 백엔드 키로만.)

-- 3-2. 탈퇴 RPC
--   순서: (1) 법정 보존기록 아카이브 이관 → (2) RESTRICT FK 선정리(타인 referred_by) →
--         (3) auth.users 삭제 로 profiles + 전체 CASCADE 자식 파기 + 쪽지/매칭 익명화.
--   CASCADE 파기(자식): companion_posts/market_listings/qna_posts/qna_comments/crew_posts/reviews/
--                destinations/flight_schedules/user_keywords/notifications/point_transactions/post_likes/
--                profiles_private(=생년월일).
--   ON DELETE SET NULL(익명화): reports.reporter_id/reported_user_id,
--                messages.sender_id/receiver_id, commendation_matches.crew_user_id/passenger_user_id,
--                market_listings.buyer_id.
--     → 탈퇴자 개인식별(프로필+생년월일)은 파기되고, 상대방이 보유한 대화·매칭·판매 이력은 '탈퇴한 사용자'로 남아 보존된다.
--   수동 선정리(RESTRICT): profiles.referred_by(타인 행)만 NULL 로.
--   ※ SET NULL 카스케이드가 commendation_matches 를 갱신하면 commendation_guard(보호필드 트리거)를 타므로,
--     auth.users 삭제 전에 app.allow_sensitive='on'(트랜잭션 로컬)을 세팅해 가드를 우회한다.
CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
  v_phone TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT email, phone INTO v_email, v_phone FROM public.profiles WHERE id = v_uid;

  -- (1) 법정 보존 대상(결제·포인트 거래기록)을 분리보관 아카이브로 이관
  INSERT INTO public.account_deletion_archive(user_id, email_hash, point_transactions, retention_until)
  VALUES (
    v_uid,
    md5(COALESCE(v_email, '')),
    COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at)
              FROM public.point_transactions t WHERE t.user_id = v_uid), '[]'::jsonb),
    (CURRENT_DATE + INTERVAL '5 years')::date
  );

  -- (2) 트리거 우회 플래그(트랜잭션 로컬) — 타인 referred_by 수정 + 이후 매칭 SET NULL 카스케이드 허용
  PERFORM set_config('app.allow_sensitive', 'on', true);
  UPDATE public.profiles SET referred_by = NULL, updated_at = NOW() WHERE referred_by = v_uid;
  --   쪽지·매칭은 삭제하지 않는다. (3)의 auth.users 삭제 → profiles CASCADE 파기 시
  --   FK ON DELETE SET NULL 로 탈퇴자측 컬럼만 자동 NULL(익명화)되고 상대방 이력은 보존된다.

  -- OTP 임시기록(휴대폰/이메일 인증 PII) 정리 — user_id FK 는 없고 값으로 매칭
  IF v_email IS NOT NULL THEN DELETE FROM public.email_otps WHERE email = v_email; END IF;
  IF v_phone IS NOT NULL AND v_phone <> '' THEN DELETE FROM public.phone_otps WHERE phone = v_phone; END IF;

  -- (3) 신원 삭제 → profiles + CASCADE 자식 전체 파기(생년월일 profiles_private 포함), 쪽지/매칭은 SET NULL 익명화
  --     (point_transactions 는 위에서 이미 아카이브됨)
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;

-- ------------------------------------------------------------
-- 4. (4차 보정 2026-07-18) profiles PII 컬럼 잠금 "유지" — 3차의 원복 GRANT 폐기.
--    3차는 "프론트 10곳+ 이 직접 SELECT 라 잠그면 깨진다"며 여기서 전체 GRANT 로 원복했는데,
--    그 한 줄이 2026-06-11 PART2 잠금을 회귀시켜 공개 anon 키로 전 회원 email/phone/주소가
--    노출되던 원인이었다(2026-07-18 실측 확정). 전수 재실측 결과:
--     · 프론트 17곳 전부 안전 컬럼 임베드/RPC(get_my_profile·admin_list_profiles·check_*_taken)만 사용
--     · 유일한 42501 지점 = reports 구정책 2개(invoker 로 profiles.role 서브쿼리) → 함께 제거
--       (is_admin() SECURITY DEFINER 기반 동일 기능 정책이 병존해 기능 손실 없음)
--    운영 적용은 마이그레이션 lock_profiles_pii_columns(2026-07-18). 이 파일을 재실행해도
--    잠금이 유지되도록 동일 잠금을 재확인한다(멱등). 절대 전체 GRANT 로 되돌리지 말 것.
DROP POLICY IF EXISTS "Admin read all reports" ON public.reports;
DROP POLICY IF EXISTS "Admin update reports" ON public.reports;
REVOKE SELECT ON TABLE public.profiles FROM anon, authenticated;
GRANT SELECT (id, name, nickname, avatar_url, user_type, crew_verified, airline_name, bio, created_at)
  ON TABLE public.profiles TO anon, authenticated;

-- ============================================================
-- 끝. 롤백:
--  · handle_new_user / complete_signup_profile → security_hardening.sql 정의 재실행으로 원복.
--  · request_account_deletion / account_deletion_archive → DROP.
--  · profiles_private → DROP TABLE public.profiles_private;  (생년월일 데이터도 함께 삭제됨)
--  · 쪽지/매칭 FK 익명화 → 필요 시 ON DELETE SET NULL 을 떼고 재생성(이미 NULL 처리된 값은 복구 불가).
-- ============================================================

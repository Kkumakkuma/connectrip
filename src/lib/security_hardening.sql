-- ============================================================
-- ConnectTrip 보안 하드닝 (2026-06-03)
-- Supabase SQL Editor 에 전체 붙여넣고 Run. 멱등 — 여러 번 실행해도 안전.
--
-- 목적:
--  1) profiles 민감컬럼(role/points/identity/user_type/crew_verified 등) 자가수정 차단
--  2) 포인트·바우처·선물·장터결제는 검증된 RPC 로만 (양수 무한적립/타인조작/부분결제 차단)
--  3) 가입 INSERT 경로(handle_new_user)로도 보호컬럼 위조 불가
--  4) crew_posts 는 인증 승무원만 작성 / reports 는 admin 만 열람
--  5) 테스트 계정 포인트는 floor 이상 자동 유지
--
-- 적용 전 확인(권장):
--   SELECT tgname FROM pg_trigger WHERE tgrelid='public.profiles'::regclass;
-- 적용 후:
--   UPDATE public.profiles SET role='admin' WHERE email='admin@connectrip.com';  -- admin 권한 1회 시드
-- ============================================================

-- ------------------------------------------------------------
-- 0. 누락 컬럼 방어 보강 (라이브에 이미 있으면 no-op)
-- ------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role             TEXT DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS is_banned        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS crew_verified    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS crew_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS airline_email    TEXT,
  ADD COLUMN IF NOT EXISTS airline_name     TEXT;

ALTER TABLE public.market_listings
  ADD COLUMN IF NOT EXISTS buyer_id UUID REFERENCES public.profiles(id);

-- ------------------------------------------------------------
-- 1. admin 판별 helper
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- ------------------------------------------------------------
-- 2. 항공사 도메인 화이트리스트 (승무원 인증 서버 검증용) + 테스트 계정 floor
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.airline_domains (
  domain TEXT PRIMARY KEY,
  name   TEXT NOT NULL
);
ALTER TABLE public.airline_domains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read airline domains" ON public.airline_domains;
CREATE POLICY "Anyone can read airline domains" ON public.airline_domains FOR SELECT USING (true);
INSERT INTO public.airline_domains (domain, name) VALUES
  ('koreanair.com', '대한항공'), ('flyasiana.com', '아시아나항공'), ('jinair.com', '진에어'),
  ('airbusan.com', '에어부산'), ('flyairseoul.com', '에어서울'), ('air-incheon.com', '에어인천'),
  ('twayair.com', '티웨이항공'), ('jejuair.net', '제주항공'), ('airpremia.com', '에어프레미아'),
  ('aerok.com', '에어로케이'), ('flyparata.com', '파라타항공')
ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name;

CREATE TABLE IF NOT EXISTS public.test_account_floors (
  email      TEXT PRIMARY KEY,
  min_points INT NOT NULL DEFAULT 0
);
ALTER TABLE public.test_account_floors ENABLE ROW LEVEL SECURITY; -- 정책 없음 = 클라 접근 차단
INSERT INTO public.test_account_floors (email, min_points) VALUES
  ('test@connectrip.com',  300000),
  ('crew@connectrip.com',  300000),
  ('admin@connectrip.com', 1000000)
ON CONFLICT (email) DO UPDATE SET min_points = EXCLUDED.min_points;

-- 추천코드 컬럼 (2026-07-18) — 인증 승무원 고유 코드. 발급은 get_my_referral_code RPC 만,
-- 클라 직접 변경은 profiles_guard 가 차단(referral_code 보호). 서버 발급 코드만 허용(CHECK).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_key ON public.profiles (referral_code);
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_referral_code_format;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_referral_code_format
  CHECK (referral_code IS NULL OR referral_code ~ '^[A-Z2-9]{8}$');

-- ------------------------------------------------------------
-- 3. BEFORE UPDATE 가드 트리거
--    bypass = 서버컨텍스트(auth.uid() IS NULL) | admin | RPC 플래그(app.allow_sensitive='on')
--    ⚠ COALESCE 필수: current_setting(...,true) 는 GUC 미설정 세션에서 NULL 반환 →
--      FALSE OR NULL OR FALSE = NULL → IF NOT NULL 은 실행 안 됨 → 가드 전체 무력화(2026-07-18 실증 수정).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_floor  INT;
  v_bypass BOOLEAN;
BEGIN
  v_bypass := (auth.uid() IS NULL)
              OR (COALESCE(current_setting('app.allow_sensitive', true), 'off') = 'on')
              OR COALESCE(public.is_admin(), FALSE);

  IF NOT v_bypass THEN
    IF NEW.role                 IS DISTINCT FROM OLD.role
    OR NEW.is_banned            IS DISTINCT FROM OLD.is_banned
    OR NEW.points_balance       IS DISTINCT FROM OLD.points_balance
    OR NEW.available_likes      IS DISTINCT FROM OLD.available_likes
    OR NEW.voucher_count        IS DISTINCT FROM OLD.voucher_count
    OR NEW.user_type            IS DISTINCT FROM OLD.user_type
    OR NEW.crew_verified        IS DISTINCT FROM OLD.crew_verified
    OR NEW.phone_verified       IS DISTINCT FROM OLD.phone_verified
    OR NEW.identity_verified    IS DISTINCT FROM OLD.identity_verified
    OR NEW.verification_method  IS DISTINCT FROM OLD.verification_method
    OR NEW.verified_at          IS DISTINCT FROM OLD.verified_at
    OR NEW.verification_required IS DISTINCT FROM OLD.verification_required
    OR NEW.referral_bonus_given IS DISTINCT FROM OLD.referral_bonus_given
    OR NEW.referred_by          IS DISTINCT FROM OLD.referred_by
    OR NEW.referral_code        IS DISTINCT FROM OLD.referral_code
    OR NEW.profile_completed    IS DISTINCT FROM OLD.profile_completed
    OR NEW.phone                IS DISTINCT FROM OLD.phone
    OR NEW.airline_email        IS DISTINCT FROM OLD.airline_email
    OR NEW.airline_name         IS DISTINCT FROM OLD.airline_name
    OR NEW.crew_verified_at     IS DISTINCT FROM OLD.crew_verified_at
    THEN
      RAISE EXCEPTION 'protected column modification denied';
    END IF;
  END IF;

  -- 테스트 계정 floor 보정 (모든 경로 적용)
  SELECT min_points INTO v_floor FROM public.test_account_floors WHERE email = NEW.email;
  IF v_floor IS NOT NULL AND COALESCE(NEW.points_balance, 0) < v_floor THEN
    NEW.points_balance := v_floor;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_guard ON public.profiles;
CREATE TRIGGER trg_profiles_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard();

-- ------------------------------------------------------------
-- 4. 가입 INSERT 트리거 재정의 — 보호컬럼은 metadata 무시하고 안전 기본값 강제
--    (이전엔 raw_user_meta_data 의 phone_verified/user_type/identity_verified 를 그대로 INSERT →
--     직접 auth.signUp 으로 위조 가능했음. 일반 필드만 metadata 허용)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE meta JSONB;
BEGIN
  meta := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
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
    CASE WHEN (meta->>'referred_by') ~ '^[0-9a-fA-F-]{36}$' THEN (meta->>'referred_by')::uuid ELSE NULL END,
    'traveler', FALSE, FALSE, 'sms_otp_pending', FALSE, FALSE
  );
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 5. 정상 증감 RPC (SECURITY DEFINER, 자기 행만, 트리거 우회 플래그 ON)
--    set_config(...,true) = 트랜잭션 로컬 → 호출 끝나면 자동 소멸
-- ------------------------------------------------------------

-- 5-1. 매칭신청권 구매 (포인트 1장당 30,000 차감 + 바우처 증가)
CREATE OR REPLACE FUNCTION public.purchase_voucher(p_qty INT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_cost INT; v_cur INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > 100 THEN RAISE EXCEPTION 'invalid qty'; END IF;
  v_cost := 30000 * p_qty;
  PERFORM set_config('app.allow_sensitive', 'on', true);
  SELECT points_balance INTO v_cur FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  IF COALESCE(v_cur, 0) < v_cost THEN RAISE EXCEPTION 'insufficient points'; END IF;
  UPDATE public.profiles
    SET points_balance = points_balance - v_cost,
        voucher_count  = COALESCE(voucher_count, 0) + p_qty,
        updated_at     = NOW()
    WHERE id = auth.uid();
  INSERT INTO public.point_transactions(user_id, amount, type, description)
    VALUES (auth.uid(), -v_cost, 'voucher_purchase', '매칭신청권 ' || p_qty || '개 구매');
END;
$$;

-- 5-2. 매칭신청권 사용 (차감) — 양수 수량만
CREATE OR REPLACE FUNCTION public.use_voucher(p_qty INT DEFAULT 1)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_new INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > 100 THEN RAISE EXCEPTION 'invalid qty'; END IF;
  PERFORM set_config('app.allow_sensitive', 'on', true);
  UPDATE public.profiles SET voucher_count = voucher_count - p_qty, updated_at = NOW()
    WHERE id = auth.uid() AND voucher_count >= p_qty
    RETURNING voucher_count INTO v_new;
  IF v_new IS NULL THEN RAISE EXCEPTION 'no voucher'; END IF;
  RETURN v_new;
END;
$$;

-- 5-3. 좋아요 → 포인트 전환 (보유 좋아요는 가입 시 고정·보호컬럼이라 총량 제한적)
CREATE OR REPLACE FUNCTION public.convert_likes_to_points(p_qty INT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_qty IS NULL OR p_qty < 1 THEN RAISE EXCEPTION 'invalid qty'; END IF;
  PERFORM set_config('app.allow_sensitive', 'on', true);
  UPDATE public.profiles
    SET available_likes = available_likes - p_qty,
        points_balance  = COALESCE(points_balance, 0) + p_qty,
        updated_at      = NOW()
    WHERE id = auth.uid() AND available_likes >= p_qty;
  IF NOT FOUND THEN RAISE EXCEPTION 'insufficient likes'; END IF;
  INSERT INTO public.point_transactions(user_id, amount, type, description)
    VALUES (auth.uid(), p_qty, 'likes_convert', '좋아요 ' || p_qty || '개 → 포인트 전환');
END;
$$;

-- 5-4. 장터 결제 — 포인트 전액 결제만(부분/현금은 PG 연동 후). 서버가 price 강제.
--      p_expected_price: 구매자가 화면에서 확인한 가격. 서버 가격과 다르면(판매자 인상 TOCTOU) 거부.
CREATE OR REPLACE FUNCTION public.market_purchase(p_listing_id UUID, p_expected_price INT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_seller UUID; v_price INT; v_status TEXT; v_buyer UUID; v_cur INT;
BEGIN
  v_buyer := auth.uid();
  IF v_buyer IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT user_id, price, status INTO v_seller, v_price, v_status
    FROM public.market_listings WHERE id = p_listing_id FOR UPDATE;
  IF v_seller IS NULL THEN RAISE EXCEPTION 'listing not found'; END IF;
  IF v_seller = v_buyer THEN RAISE EXCEPTION 'cannot buy own listing'; END IF;
  IF v_status = 'sold' THEN RAISE EXCEPTION 'already sold'; END IF;
  IF COALESCE(v_price, 0) <= 0 THEN RAISE EXCEPTION 'invalid listing price'; END IF;
  IF p_expected_price IS NULL OR p_expected_price <> v_price THEN RAISE EXCEPTION 'price changed'; END IF;

  PERFORM set_config('app.allow_sensitive', 'on', true);
  SELECT points_balance INTO v_cur FROM public.profiles WHERE id = v_buyer FOR UPDATE;
  IF COALESCE(v_cur, 0) < v_price THEN RAISE EXCEPTION 'insufficient points'; END IF;
  UPDATE public.profiles SET points_balance = points_balance - v_price, updated_at = NOW() WHERE id = v_buyer;
  UPDATE public.profiles SET points_balance = COALESCE(points_balance, 0) + v_price, updated_at = NOW() WHERE id = v_seller;
  INSERT INTO public.point_transactions(user_id, amount, type, description) VALUES
    (v_buyer,  -v_price, 'market_purchase', '장터 물품 구매 (' || p_listing_id || ')'),
    (v_seller,  v_price, 'market_sale',     '장터 물품 판매 수익 (' || p_listing_id || ')');
  UPDATE public.market_listings SET status = 'sold', buyer_id = v_buyer WHERE id = p_listing_id;
END;
$$;

-- 5-5. 칭송 감사 선물 — verified 매칭에서만. crew 발송=본인차감+승객가산 / admin 발송=승객가산
CREATE OR REPLACE FUNCTION public.send_commendation_gift(p_match_id UUID, p_amount INT, p_message TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_crew UUID; v_pass UUID; v_status TEXT; v_admin BOOLEAN; v_cur INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 100000 THEN RAISE EXCEPTION 'invalid amount'; END IF;
  v_admin := public.is_admin();
  SELECT crew_user_id, passenger_user_id, status INTO v_crew, v_pass, v_status
    FROM public.commendation_matches WHERE id = p_match_id FOR UPDATE;
  IF v_crew IS NULL OR v_pass IS NULL THEN RAISE EXCEPTION 'invalid match'; END IF;
  IF v_status = 'gift_sent' THEN RAISE EXCEPTION 'already sent'; END IF;
  IF v_status <> 'verified' THEN RAISE EXCEPTION 'match not verified'; END IF;
  IF NOT v_admin AND v_crew <> auth.uid() THEN RAISE EXCEPTION 'only crew or admin can send gift'; END IF;
  -- crew 측이 인증 승무원인지 재검증(오염된 verified row 로 admin 발송 위조 차단)
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_crew AND user_type = 'crew' AND COALESCE(crew_verified, FALSE) = TRUE
  ) THEN RAISE EXCEPTION 'crew not verified'; END IF;

  PERFORM set_config('app.allow_sensitive', 'on', true);
  IF NOT v_admin THEN
    -- 승무원이 본인 포인트로 발송
    SELECT points_balance INTO v_cur FROM public.profiles WHERE id = v_crew FOR UPDATE;
    IF COALESCE(v_cur, 0) < p_amount THEN RAISE EXCEPTION 'insufficient points'; END IF;
    UPDATE public.profiles SET points_balance = points_balance - p_amount, updated_at = NOW() WHERE id = v_crew;
    INSERT INTO public.point_transactions(user_id, amount, type, description)
      VALUES (v_crew, -p_amount, 'gift_sent', '칭송 감사 선물 발송');
  END IF;
  -- 승객 가산 (crew/admin 공통)
  UPDATE public.profiles SET points_balance = COALESCE(points_balance, 0) + p_amount, updated_at = NOW() WHERE id = v_pass;
  INSERT INTO public.point_transactions(user_id, amount, type, description)
    VALUES (v_pass, p_amount, 'gift_received', '칭송 감사 선물');
  UPDATE public.commendation_matches
    SET status = 'gift_sent', gift_points = p_amount, gift_message = p_message, updated_at = NOW()
    WHERE id = p_match_id;
END;
$$;

-- 5-5b. 관리자 직접 지급 — 포인트/매칭신청권(칭송사용권) 선물 (admin 전용)
--   회원가입·구매 흐름 없이 관리자가 특정 회원에게 직접 지급한다. RPC 경유 지급은 point_transactions 에 감사 기록.
--   (참고: admin 은 RLS상 profiles 를 직접 UPDATE 할 수도 있어 감사로그 강제는 RPC 경유분 한정 — 기존 admin 권한 특성.)
--   일반 유저의 보호컬럼(points_balance/voucher_count) 직접변경은 profiles_guard 가 계속 차단(우회는 RPC 내부 allow_sensitive 뿐).
CREATE OR REPLACE FUNCTION public.admin_grant_points(p_user_id UUID, p_amount INT, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 10000000 THEN RAISE EXCEPTION 'invalid amount'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN RAISE EXCEPTION 'user not found'; END IF;
  PERFORM set_config('app.allow_sensitive', 'on', true);
  UPDATE public.profiles
    SET points_balance = COALESCE(points_balance, 0) + p_amount, updated_at = NOW()
    WHERE id = p_user_id;
  INSERT INTO public.point_transactions(user_id, amount, type, description)
    VALUES (p_user_id, p_amount, 'admin_grant', COALESCE(NULLIF(p_reason, ''), '관리자 포인트 지급'));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_grant_vouchers(p_user_id UUID, p_qty INT, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > 1000 THEN RAISE EXCEPTION 'invalid qty'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN RAISE EXCEPTION 'user not found'; END IF;
  PERFORM set_config('app.allow_sensitive', 'on', true);
  UPDATE public.profiles
    SET voucher_count = COALESCE(voucher_count, 0) + p_qty, updated_at = NOW()
    WHERE id = p_user_id;
  -- 바우처 전용 원장이 없어 감사 추적은 point_transactions 에 amount=0 으로 남긴다
  INSERT INTO public.point_transactions(user_id, amount, type, description)
    VALUES (p_user_id, 0, 'admin_voucher_grant', COALESCE(NULLIF(p_reason, ''), '관리자 사용권 지급') || ' (' || p_qty || '장)');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_points(UUID, INT, TEXT)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_grant_vouchers(UUID, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_points(UUID, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_vouchers(UUID, INT, TEXT) TO authenticated;

-- 5-6. 회원가입 프로필 완성 (보호컬럼 user_type/crew_verified/phone_verified 를 서버 검증 후 설정)
CREATE OR REPLACE FUNCTION public.complete_signup_profile(
  p_name TEXT, p_nickname TEXT, p_phone TEXT,
  p_zipcode TEXT, p_road TEXT, p_detail TEXT,
  p_user_type TEXT, p_airline_email TEXT, p_airline_name TEXT,
  p_referred_by UUID
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
  v_norm_email  TEXT;
  v_otp_id      UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_user_type NOT IN ('traveler', 'crew') THEN RAISE EXCEPTION 'invalid user_type'; END IF;
  v_clean_phone := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');

  -- 휴대폰 본인인증 서버 재검증 (최근 1시간 내 인증된 번호)
  SELECT EXISTS (
    SELECT 1 FROM public.phone_otps
    WHERE phone = v_clean_phone AND verified_at IS NOT NULL
      AND verified_at > NOW() - INTERVAL '1 hour'
  ) INTO v_phone_ok;
  IF NOT v_phone_ok THEN RAISE EXCEPTION 'phone not verified'; END IF;

  -- 승무원이면 (1) 항공사 이메일 도메인 화이트리스트 + (2) 그 회사 이메일 OTP 인증을 서버 검증.
  -- 회사 이메일은 가입/로그인 이메일과 분리된 별도 인증(2026-07-18). 도메인만 맞으면 통과하던 구멍 차단.
  IF p_user_type = 'crew' THEN
    v_norm_email := lower(trim(COALESCE(p_airline_email, '')));
    v_domain := split_part(v_norm_email, '@', 2);
    SELECT EXISTS (SELECT 1 FROM public.airline_domains WHERE domain = v_domain) INTO v_crew;
    IF NOT v_crew THEN RAISE EXCEPTION 'crew airline verification required'; END IF;

    -- 최근 1시간 내 verified 이고 미소비 email_otps 1건을 소비(consume). 재사용/피기백 차단.
    SELECT id INTO v_otp_id FROM public.email_otps
      WHERE lower(email) = v_norm_email
        AND verified_at IS NOT NULL
        AND verified_at > NOW() - INTERVAL '1 hour'
        AND consumed_at IS NULL
      ORDER BY verified_at DESC
      LIMIT 1;
    IF v_otp_id IS NULL THEN RAISE EXCEPTION 'airline email not verified'; END IF;
    UPDATE public.email_otps SET consumed_at = NOW() WHERE id = v_otp_id;
  END IF;

  v_ref := p_referred_by;
  IF v_ref = auth.uid() THEN v_ref := NULL; END IF; -- self-referral 차단
  -- 추천인은 "인증 승무원"만 유효 (2026-07-18 정책). UI(find_crew_referrer) 우회 임의 UUID 서버 차단.
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
    airline_email       = CASE WHEN v_crew THEN v_norm_email ELSE airline_email END,
    airline_name        = CASE WHEN v_crew THEN p_airline_name  ELSE airline_name  END,
    crew_verified       = CASE WHEN v_crew THEN TRUE ELSE crew_verified END,
    crew_verified_at    = CASE WHEN v_crew THEN NOW() ELSE crew_verified_at END,
    referred_by         = COALESCE(referred_by, v_ref),
    profile_completed   = TRUE,
    updated_at          = NOW()
  WHERE id = auth.uid();

  IF v_ref IS NOT NULL THEN
    PERFORM public.grant_referral_bonus(auth.uid());
  END IF;
END;
$$;

-- 5-7. 추천 보너스 (트리거 우회 + 동시 중복지급 방지: 조건부 UPDATE 원자화)
--   ★ 2026-07-18 정책 최종(쿠마님): 보너스는 "인증 승무원인 당사자"에게만 각 3,000P.
--     승무원↔승무원=둘 다 / 승무원 추천인+일반 가입자=추천인만 / 일반 추천인+승무원 가입자=가입자만 / 일반끼리=미지급.
--     가입자 1회 / 추천인 최대 20회(총 60,000P) / 상시. 운영 적용 = 마이그레이션 referral_bonus_crew_recipients_cap_20.
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

-- 5-7b. 추천 승무원 ID/추천코드 검증 — 가입 폼 전용 (2026-07-18).
--   PII 잠금으로 클라가 email 컬럼을 직접 조회할 수 없으므로, 입력한 ID/코드가 "인증 승무원"의
--   로그인 이메일·항공사 이메일·추천코드 중 하나인지 확인해 uuid 만 돌려준다.
--   존재 여부 외 정보 비노출. v3: 입력 길이 가드 + '@' 유무로 이메일/코드 분기(코드는 유니크 인덱스 정확매칭).
CREATE OR REPLACE FUNCTION public.find_crew_referrer(p_login_id TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public AS $$
DECLARE v_in TEXT := trim(COALESCE(p_login_id, '')); v_id UUID;
BEGIN
  IF length(v_in) < 3 OR length(v_in) > 254 THEN RETURN NULL; END IF;
  IF position('@' IN v_in) > 0 THEN
    SELECT id INTO v_id FROM public.profiles
     WHERE (lower(email) = lower(v_in) OR lower(airline_email) = lower(v_in))
       AND user_type = 'crew' AND COALESCE(crew_verified, FALSE) LIMIT 1;
  ELSE
    SELECT id INTO v_id FROM public.profiles
     WHERE referral_code = upper(v_in)
       AND user_type = 'crew' AND COALESCE(crew_verified, FALSE) LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.find_crew_referrer(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_crew_referrer(TEXT) TO anon, authenticated, service_role;

-- 5-7c. 암호학적 추천코드 생성기 (pgcrypto, extensions 스키마 한정) — random() 대신.
CREATE OR REPLACE FUNCTION public._gen_referral_code()
RETURNS TEXT LANGUAGE sql VOLATILE
SET search_path = public AS $$
  SELECT string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
           (get_byte(extensions.gen_random_bytes(1), 0) % 31) + 1, 1), '')
  FROM generate_series(1, 8);
$$;

-- 5-7d. 내 추천코드 조회/발급 — 인증 승무원 전용, 없으면 lazy 생성. 마이페이지에서 코드/초대링크 표시용.
CREATE OR REPLACE FUNCTION public.get_my_referral_code()
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_code  TEXT;
  v_ok    BOOLEAN;
  v_try   TEXT;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT referral_code, (user_type = 'crew' AND COALESCE(crew_verified, FALSE))
    INTO v_code, v_ok FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR NOT COALESCE(v_ok, FALSE) THEN RETURN NULL; END IF;  -- 인증 승무원만
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;

  PERFORM set_config('app.allow_sensitive', 'on', true);
  FOR i IN 1..20 LOOP
    v_try := public._gen_referral_code();
    BEGIN
      UPDATE public.profiles SET referral_code = v_try WHERE id = v_uid AND referral_code IS NULL;
      IF FOUND THEN RETURN v_try; END IF;
      SELECT referral_code INTO v_code FROM public.profiles WHERE id = v_uid;
      RETURN v_code;  -- 동시 호출로 이미 발급됨
    EXCEPTION WHEN unique_violation THEN
      -- 코드 충돌 → 재시도
    END;
  END LOOP;
  RAISE EXCEPTION 'referral code generation failed';
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_referral_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_referral_code() TO authenticated, service_role;

-- 5-8. 칭송 매칭 신청 — 같은 항공편 승객↔승무원 1:1 자동연결.
--      대기중(pending)인 반대편 매칭이 있으면 그 row 를 matched 로 연결(중복 row 안 만듦),
--      없으면 새 pending 생성. SKIP LOCKED 로 동시신청 경합 안전. crew 신청만 신청권 1장 차감.
--      시그니처: (항공편, 날짜, 역할) — partner/status 는 서버가 결정(클라가 정하지 않음).
CREATE OR REPLACE FUNCTION public.apply_commendation_match(
  p_flight_number TEXT, p_flight_date DATE, p_role TEXT
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_me UUID; v_existing UUID; v_result TEXT;
BEGIN
  v_me := auth.uid();
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_role NOT IN ('crew', 'passenger') THEN RAISE EXCEPTION 'invalid role'; END IF;
  -- 호출자 본인이 해당 항공편에 등록돼 있어야(자기 스케줄 기반 신청만 허용)
  IF NOT EXISTS (
    SELECT 1 FROM public.flight_schedules
    WHERE flight_number = p_flight_number AND flight_date = p_flight_date AND user_id = v_me
  ) THEN RAISE EXCEPTION 'you are not on this flight'; END IF;
  -- crew 역할 신청은 인증된 승무원만
  IF p_role = 'crew' AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_me AND user_type = 'crew' AND COALESCE(crew_verified, FALSE) = TRUE
  ) THEN RAISE EXCEPTION 'crew only'; END IF;
  -- 같은 항공편에 본인의 활성 매칭이 이미 있으면 거부(중복 1:1 방지)
  IF EXISTS (
    SELECT 1 FROM public.commendation_matches
    WHERE flight_number = p_flight_number AND flight_date = p_flight_date
      AND status NOT IN ('rejected', 'deleted')
      AND (crew_user_id = v_me OR passenger_user_id = v_me)
  ) THEN RAISE EXCEPTION 'already applied'; END IF;

  PERFORM set_config('app.allow_sensitive', 'on', true);

  IF p_role = 'crew' THEN
    -- 같은 편에서 승객을 기다리던 매칭(pending_passenger, 승무원칸 비어있음)을 잠그고 연결
    SELECT id INTO v_existing FROM public.commendation_matches
      WHERE flight_number = p_flight_number AND flight_date = p_flight_date
        AND status = 'pending_passenger' AND crew_user_id IS NULL
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED LIMIT 1;
    -- 신청권 1장 차감(승무원 신청만 유료)
    UPDATE public.profiles SET voucher_count = voucher_count - 1, updated_at = NOW()
      WHERE id = v_me AND voucher_count >= 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'no voucher'; END IF;
    IF v_existing IS NOT NULL THEN
      UPDATE public.commendation_matches
        SET crew_user_id = v_me, status = 'matched', updated_at = NOW()
        WHERE id = v_existing;
      v_result := 'matched';
    ELSE
      INSERT INTO public.commendation_matches(flight_number, flight_date, crew_user_id, passenger_user_id, status)
        VALUES (p_flight_number, p_flight_date, v_me, NULL, 'pending_crew');
      v_result := 'pending_crew';
    END IF;
  ELSE
    -- 승객: 같은 편에서 승객을 기다리던 승무원 매칭(pending_crew, 승객칸 비어있음)을 잠그고 연결
    SELECT id INTO v_existing FROM public.commendation_matches
      WHERE flight_number = p_flight_number AND flight_date = p_flight_date
        AND status = 'pending_crew' AND passenger_user_id IS NULL
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED LIMIT 1;
    IF v_existing IS NOT NULL THEN
      UPDATE public.commendation_matches
        SET passenger_user_id = v_me, status = 'matched', updated_at = NOW()
        WHERE id = v_existing;
      v_result := 'matched';
    ELSE
      INSERT INTO public.commendation_matches(flight_number, flight_date, crew_user_id, passenger_user_id, status)
        VALUES (p_flight_number, p_flight_date, NULL, v_me, 'pending_passenger');
      v_result := 'pending_passenger';
    END IF;
  END IF;
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------
-- 6. RPC 실행 권한 (anon 차단, authenticated 만)
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.purchase_voucher(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.use_voucher(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convert_likes_to_points(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.market_purchase(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_commendation_gift(UUID, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_signup_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_referral_bonus(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.purchase_voucher(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_voucher(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_likes_to_points(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.market_purchase(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_commendation_gift(UUID, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_signup_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;
DROP FUNCTION IF EXISTS public.apply_commendation_match(TEXT, DATE, UUID, TEXT, TEXT);
REVOKE ALL ON FUNCTION public.apply_commendation_match(TEXT, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_commendation_match(TEXT, DATE, TEXT) TO authenticated;
-- grant_referral_bonus 는 클라에 직접 노출하지 않는다(REVOKE 만). complete_signup_profile(SECURITY DEFINER) 내부에서만
-- 호출되어 휴대폰 재검증·프로필 완성을 거친 가입에만 보너스가 지급되도록 한다.
REVOKE ALL ON FUNCTION public.grant_referral_bonus(UUID) FROM authenticated;

-- 구버전/제거된 함수가 이전 배포에 남아 우회 경로가 되지 않도록 정리 (없으면 no-op)
DROP FUNCTION IF EXISTS public.market_purchase(UUID);
DROP FUNCTION IF EXISTS public.adjust_points(INT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.refund_voucher(INT);

-- ------------------------------------------------------------
-- 7. crew_verified 백필 — [2026-07-18 비활성화]
--    도메인만 보고 crew_verified 를 켜는 1회성 백필. 이미 prod 에 적용됐고, 이제 회사 이메일
--    OTP 인증(complete_signup_profile) 정책이 도입돼 도메인-only 검증은 우회 경로가 된다.
--    파일 재실행 시 새 미인증 crew 가 도메인만으로 인증되지 않도록 영구 비활성화한다.
--    (기존 승무원은 이미 crew_verified=TRUE 라 영향 없음.)
-- UPDATE public.profiles SET crew_verified = TRUE
--   WHERE user_type = 'crew'
--     AND COALESCE(crew_verified, FALSE) = FALSE
--     AND airline_email IS NOT NULL
--     AND lower(split_part(airline_email, '@', 2)) IN (SELECT domain FROM public.airline_domains);

-- ------------------------------------------------------------
-- 8. 정책 재작성
-- ------------------------------------------------------------

-- 8-1. profiles: 자기 행만 UPDATE (컬럼 보호는 트리거) + admin 전체 UPDATE
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
CREATE POLICY "Admins can update any profile" ON public.profiles
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 8-2. crew_posts: 인증된 승무원만 작성
DROP POLICY IF EXISTS "Auth users can create crew posts" ON public.crew_posts;
DROP POLICY IF EXISTS "Crew can create crew posts" ON public.crew_posts;
CREATE POLICY "Crew can create crew posts" ON public.crew_posts
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type = 'crew' AND COALESCE(p.crew_verified, FALSE) = TRUE
    )
  );

-- 8-3. reports: 작성=인증사용자(본인 reporter), 조회=본인 or admin, 수정=admin
CREATE TABLE IF NOT EXISTS public.reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reported_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  post_id          UUID,
  board_type       TEXT,
  reason           TEXT,
  status           TEXT DEFAULT '대기',
  admin_note       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can create reports" ON public.reports;
CREATE POLICY "Auth users can create reports" ON public.reports
  FOR INSERT WITH CHECK (auth.uid() = reporter_id);
DROP POLICY IF EXISTS "Reporters or admin can read reports" ON public.reports;
CREATE POLICY "Reporters or admin can read reports" ON public.reports
  FOR SELECT USING (auth.uid() = reporter_id OR public.is_admin());
DROP POLICY IF EXISTS "Admin can update reports" ON public.reports;
CREATE POLICY "Admin can update reports" ON public.reports
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- 9. point_transactions 직접 INSERT 차단 (감사로그 위조 방지)
--    정상 거래기록은 RPC(SECURITY DEFINER)가 RLS 우회로 INSERT 한다.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can create own transactions" ON public.point_transactions;

-- ------------------------------------------------------------
-- 10. commendation_matches 가드 — status forge / 당사자·선물 필드 위조 차단
--     (RLS 가 본인행 UPDATE 를 허용하므로, 사용자가 자기 매칭을 'verified' 로 바꿔
--      send_commendation_gift 의 verified 전제를 위조하던 구멍을 트리거로 봉쇄)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commendation_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_bypass BOOLEAN; v_me UUID;
BEGIN
  v_me := auth.uid();
  -- ⚠ COALESCE 필수: current_setting(...,true) 는 미설정 세션에서 NULL → FALSE OR NULL OR FALSE = NULL →
  --   IF NOT NULL 미실행으로 가드 전체 무력화(profiles_guard 와 동일 버그, 2026-07-18 수정).
  v_bypass := (v_me IS NULL)
              OR (COALESCE(current_setting('app.allow_sensitive', true), 'off') = 'on')
              OR COALESCE(public.is_admin(), FALSE);
  IF NOT v_bypass THEN
    IF TG_OP = 'INSERT' THEN
      -- 본인이 당사자(crew 또는 passenger)인 매칭만 생성 가능, 초기 상태만 허용
      IF v_me <> COALESCE(NEW.crew_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
         AND v_me <> COALESCE(NEW.passenger_user_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
        RAISE EXCEPTION 'not your match';
      END IF;
      IF NEW.status NOT IN ('pending_crew', 'pending_passenger', 'matched') THEN
        RAISE EXCEPTION 'invalid initial status';
      END IF;
      NEW.gift_points := NULL;
      NEW.gift_message := NULL;
      -- crew_user_id 가 지정되면 반드시 인증 승무원이어야(직접 INSERT 로 일반 사용자를 crew 로 위조 차단)
      IF NEW.crew_user_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = NEW.crew_user_id AND user_type = 'crew' AND COALESCE(crew_verified, FALSE) = TRUE
      ) THEN RAISE EXCEPTION 'crew_user_id must be verified crew'; END IF;
    ELSE -- UPDATE
      IF NEW.crew_user_id      IS DISTINCT FROM OLD.crew_user_id
      OR NEW.passenger_user_id IS DISTINCT FROM OLD.passenger_user_id
      OR NEW.gift_points       IS DISTINCT FROM OLD.gift_points
      OR NEW.gift_message      IS DISTINCT FROM OLD.gift_message THEN
        RAISE EXCEPTION 'protected match field';
      END IF;
      -- 종료 상태(gift_sent/verified)는 되돌리거나 재전이 불가 → 선물 재지급 우회 차단
      IF OLD.status IN ('gift_sent', 'verified') AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'finalized match cannot change';
      END IF;
      -- 승인/발송으로의 전이는 admin/RPC 만 (사용자는 commendation_submitted 제출, rejected 취소만 가능)
      IF NEW.status IN ('verified', 'gift_sent') AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'status transition not allowed';
      END IF;
      -- pending -> matched 전이는 RPC(자동연결)만 — 사용자가 자기 행을 임의 matched 위조 차단
      IF NEW.status = 'matched' AND OLD.status IS DISTINCT FROM 'matched' THEN
        RAISE EXCEPTION 'matched only via RPC';
      END IF;
      -- 칭송 인증 제출(commendation_submitted)은 스크린샷 URL 이 있을 때만 허용
      IF NEW.status = 'commendation_submitted' AND OLD.status IS DISTINCT FROM 'commendation_submitted'
         AND COALESCE(NEW.commendation_screenshot_url, '') = '' THEN
        RAISE EXCEPTION 'screenshot required';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_commendation_guard ON public.commendation_matches;
CREATE TRIGGER trg_commendation_guard
  BEFORE INSERT OR UPDATE ON public.commendation_matches
  FOR EACH ROW EXECUTE FUNCTION public.commendation_guard();

-- 직접 INSERT 차단 — 매칭 생성/연결은 apply_commendation_match RPC(SECURITY DEFINER)로만.
-- (사용자가 가짜 matched 또는 자기가 타지 않은 항공편 매칭을 직접 INSERT 하는 우회 차단)
DROP POLICY IF EXISTS "Users can create matches" ON public.commendation_matches;
DROP POLICY IF EXISTS "Users can create own matches" ON public.commendation_matches;

-- 같은 항공편당 본인 활성 매칭 1개씩만 — 동시 신청 race 도 DB 가 차단(1:1 강제)
CREATE UNIQUE INDEX IF NOT EXISTS uq_commendation_active_crew
  ON public.commendation_matches(flight_number, flight_date, crew_user_id)
  WHERE crew_user_id IS NOT NULL AND status NOT IN ('rejected', 'deleted');
CREATE UNIQUE INDEX IF NOT EXISTS uq_commendation_active_passenger
  ON public.commendation_matches(flight_number, flight_date, passenger_user_id)
  WHERE passenger_user_id IS NOT NULL AND status NOT IN ('rejected', 'deleted');

-- ============================================================
-- 끝. 롤백:  DROP TRIGGER IF EXISTS trg_profiles_guard ON public.profiles;
--           DROP TRIGGER IF EXISTS trg_commendation_guard ON public.commendation_matches;  (데이터 무손상)
-- 단 handle_new_user 는 본 파일이 재정의하므로, 롤백 시 signup_extension.sql/safety_verification.sql 의
-- handle_new_user 정의를 다시 실행해 원복할 것.
-- ============================================================

-- ============================================================
-- 2026-09-14 마이페이지 회원 정보 수정 (연락 이메일·휴대폰 변경 RPC + 보안 보강)
-- 적용: Supabase SQL 편집기 또는 MCP apply_migration. 멱등(여러 번 실행해도 안전).
--
-- 배경: 마이페이지에 회원 정보 수정 화면이 없었다(쿠마님 9581 "마이페이지에 내용이 너무 없다").
-- 닉네임·주소는 클라이언트가 본인 행을 직접 UPDATE 한다(RLS 소유자 정책 + profiles_guard 허용 컬럼 +
-- profiles_pii_sync 가 주소를 재암호화). 이메일·휴대폰은 profiles_guard 가 막는 보호 컬럼이라 아래 RPC 로만 바꾼다.
--
-- 이 파일이 하는 일
--   1. record_identity_verification: 가입 외 용도(password_reset·find_id·phone_change)에서는 "이미 가입된 CI/휴대폰"을
--      거절하지 않는다. 기존 회원이 본인확인을 다시 하는 용도라 등록된 CI 가 정상이다. (codex 지적 — 이 수정 전엔
--      기존 회원의 PASS 비밀번호 찾기·아이디 찾기도 ci_registered 로 실패했다.)
--   2. complete_signup_profile_for: 이미 가입을 마친 계정(profile_completed)이 다시 호출하지 못하게 막는다.
--      기존엔 로그인한 계정이 미가입 타인의 PASS 증빙으로 이름·휴대폰·CI 를 바꿔칠 수 있었다(codex 지적).
--      같은 자리에서 PHONE_BLOCKED 검사의 해시를 blocked_phone_claims 가 실제로 쓰는 sha256(canon_phone) 으로 맞춘다
--      (기존 pii.phone_hash(HMAC) 비교는 절대 일치하지 않아 차단이 무력했다).
--   3. profiles.lower(email) 유니크 인덱스(빈 값 제외) — 동시 가입·변경 경쟁 방지.
--   4. authenticated 의 암호문·해시 컬럼 UPDATE 권한 회수 — 트리거만 채우는 컬럼을 클라이언트가 직접 못 쓰게.
--   5. change_my_email(p_email, p_email_otp_token) / change_my_phone_by_identity(p_identity_token)
--      둘 다 상태 문자열을 돌려준다('ok' 외는 실패 사유). 증빙(토큰)은 실패해도 소비된다 — 재사용 방지.
-- ============================================================

-- ---------- 1. record_identity_verification: 용도별 중복 검사 ----------
CREATE OR REPLACE FUNCTION public.record_identity_verification(
  p_provider_ref TEXT, p_pg TEXT, p_name TEXT, p_birthdate DATE, p_gender TEXT, p_phone TEXT,
  p_operator TEXT, p_is_foreigner BOOLEAN, p_ci_hash TEXT, p_token_hash TEXT,
  p_purpose TEXT DEFAULT 'signup_identity', p_ip TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE
  v_clean_phone TEXT; v_phone_hash TEXT; v_purpose TEXT;
BEGIN
  IF COALESCE(btrim(p_provider_ref), '') = '' OR COALESCE(btrim(p_ci_hash), '') = ''
     OR COALESCE(btrim(p_token_hash), '') = '' OR COALESCE(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'invalid args';
  END IF;
  v_purpose := COALESCE(NULLIF(btrim(p_purpose), ''), 'signup_identity');

  DELETE FROM public.identity_verifications
   WHERE consumed_at IS NULL AND created_at < NOW() - INTERVAL '24 hours';

  v_clean_phone := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  IF v_clean_phone !~ '^01[016789][0-9]{7,8}$' THEN RETURN 'phone_invalid'; END IF;
  IF p_birthdate IS NULL OR p_birthdate > CURRENT_DATE OR p_birthdate < DATE '1900-01-01' THEN RETURN 'birth_invalid'; END IF;
  IF p_birthdate > (CURRENT_DATE - INTERVAL '14 years') THEN RETURN 'under_14'; END IF;

  IF EXISTS (SELECT 1 FROM public.identity_verifications WHERE provider_ref = p_provider_ref) THEN
    RETURN 'already_used';
  END IF;

  IF EXISTS (SELECT 1 FROM public.blocked_identity_claims WHERE ci_hash = p_ci_hash AND released_at IS NULL) THEN
    RETURN 'blocked';
  END IF;
  v_phone_hash := encode(extensions.digest(public.canon_phone(v_clean_phone), 'sha256'), 'hex');
  IF EXISTS (SELECT 1 FROM public.blocked_phone_claims WHERE phone_hash = v_phone_hash AND released_at IS NULL) THEN
    RETURN 'blocked';
  END IF;

  -- 가입용일 때만 "이미 가입된 사람" 검사. 비밀번호 찾기·아이디 찾기·휴대폰 변경은 기존 회원이 하는 것이라
  -- 등록된 CI 가 정상이며, 소비하는 쪽 RPC 가 계정과의 일치를 따로 검사한다.
  IF v_purpose = 'signup_identity' THEN
    IF EXISTS (SELECT 1 FROM public.profiles_identity WHERE ci_hash = p_ci_hash) THEN
      RETURN 'ci_registered';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles
                WHERE public.canon_phone(phone) = public.canon_phone(v_clean_phone)
                  AND COALESCE(profile_completed, FALSE)) THEN
      RETURN 'phone_claimed';
    END IF;
  END IF;

  INSERT INTO public.identity_verifications
    (provider_ref, pg, name, birthdate, gender, phone, operator, is_foreigner, ci_hash,
     consume_token_hash, purpose, ip_address)
  VALUES
    (p_provider_ref, p_pg, btrim(p_name), p_birthdate, p_gender, v_clean_phone, p_operator,
     p_is_foreigner, p_ci_hash, p_token_hash, v_purpose, p_ip);
  RETURN 'ok';
EXCEPTION WHEN unique_violation THEN
  RETURN 'already_used';
END;
$$;

-- ---------- 2. complete_signup_profile_for: 가입 완료 계정 재호출 차단 + 차단 휴대폰 해시 정정 ----------
DO $$
DECLARE
  v_oid OID; v_def TEXT; v_new TEXT;
  v_anchor TEXT := $a$IF p_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;$a$;
  v_gate   TEXT := $g$IF p_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND COALESCE(profile_completed, FALSE)) THEN
    RAISE EXCEPTION 'PROFILE_ALREADY_COMPLETED';
  END IF;$g$;
  v_old_hash TEXT := 'WHERE phone_hash = pii.phone_hash(v_clean_phone) AND released_at IS NULL LIMIT 1;';
  v_new_hash TEXT := 'WHERE phone_hash = encode(extensions.digest(public.canon_phone(v_clean_phone), ''sha256''), ''hex'') AND released_at IS NULL LIMIT 1;';
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'complete_signup_profile_for';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'complete_signup_profile_for not found'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('PROFILE_ALREADY_COMPLETED' IN v_def) > 0 THEN
    RAISE NOTICE 'complete_signup_profile_for: gate already present';
  ELSE
    IF position(v_anchor IN v_def) = 0 THEN RAISE EXCEPTION 'anchor not found in complete_signup_profile_for'; END IF;
    v_def := replace(v_def, v_anchor, v_gate);
  END IF;
  IF position(v_old_hash IN v_def) > 0 THEN
    v_def := replace(v_def, v_old_hash, v_new_hash);
  ELSIF position(v_new_hash IN v_def) = 0 THEN
    RAISE EXCEPTION 'blocked phone hash line not found in complete_signup_profile_for';
  END IF;
  v_new := v_def;
  EXECUTE v_new;
END $$;

-- ---------- 3. 연락 이메일 유니크(대소문자 무시, 빈 값 제외) ----------
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_email_lower
  ON public.profiles (lower(email)) WHERE COALESCE(btrim(email), '') <> '';

-- ---------- 4. 암호문·해시 컬럼은 클라이언트가 못 쓴다 (트리거 profiles_pii_sync 만 채움) ----------
-- 컬럼 단위 REVOKE 는 테이블 단위 UPDATE GRANT 가 남아 있으면 효력이 없다(운영 실측: 회수 뒤에도 phone_hash 직접 UPDATE 통과).
-- 테이블 UPDATE 를 통째로 회수하면 AuthContext 의 행 생성 upsert(ON CONFLICT DO UPDATE)·관리자 차단/권한 변경이 깨지므로,
-- 대신 profiles_guard 트리거(BEFORE UPDATE, pii_sync 보다 먼저 실행 — 이름순)에 이 컬럼들을 보호 목록으로 넣는다(6-c 참고).
-- 평문(phone/name/address_*)만 바뀐 정상 UPDATE 는 NEW.*_enc 가 OLD 와 같아 통과하고, 그 뒤 pii_sync 가 다시 암호화한다.

-- ---------- 5-a. 연락 이메일 변경 (여행자 회원, 새 주소로 받은 OTP 토큰 소비) ----------
CREATE OR REPLACE FUNCTION public.change_my_email(p_email TEXT, p_email_otp_token TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE
  v_uid UUID := auth.uid(); v_type TEXT; v_cur TEXT; v_contact TEXT;
  v_otp_id UUID; v_owner UUID; v_prev TEXT; v_rows INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT user_type, lower(COALESCE(email, '')) INTO v_type, v_cur FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile required'; END IF;
  -- 승무원은 회사 이메일이 연락 이메일(가입 RPC 확정). 갱신은 renew_crew_verification 경로만.
  IF v_type = 'crew' THEN RETURN 'crew_managed'; END IF;

  v_contact := lower(trim(COALESCE(p_email, '')));
  IF v_contact !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' THEN RETURN 'email_invalid'; END IF;
  IF v_contact = v_cur THEN RETURN 'same'; END IF;
  IF COALESCE(btrim(p_email_otp_token), '') = '' THEN RETURN 'proof_invalid'; END IF;

  -- 새 주소로 발송·확인된 OTP 의 소비 토큰(용도 email_change, 1시간, 1회)
  UPDATE public.email_otps SET consumed_at = NOW()
   WHERE lower(email) = v_contact AND verified_at IS NOT NULL
     AND verified_at > NOW() - INTERVAL '1 hour' AND consumed_at IS NULL
     AND purpose = 'email_change'
     AND consume_token_hash = encode(extensions.digest(p_email_otp_token, 'sha256'), 'hex')
  RETURNING id INTO v_otp_id;
  IF v_otp_id IS NULL THEN RETURN 'proof_invalid'; END IF;

  SELECT id INTO v_owner FROM public.profiles WHERE lower(email) = v_contact AND id <> v_uid LIMIT 1;
  IF v_owner IS NOT NULL THEN RETURN 'email_claimed'; END IF;

  -- profiles_guard 우회는 이 UPDATE 한 줄에만 (직후 원래 값으로 복원)
  v_prev := COALESCE(current_setting('app.allow_sensitive', true), 'off');
  PERFORM set_config('app.allow_sensitive', 'on', true);
  UPDATE public.profiles SET email = v_contact, updated_at = NOW() WHERE id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM set_config('app.allow_sensitive', v_prev, true);
  IF v_rows <> 1 THEN RAISE EXCEPTION 'profile update failed'; END IF;
  RETURN 'ok';
EXCEPTION WHEN unique_violation THEN
  RETURN 'email_claimed';
END;
$$;
REVOKE ALL ON FUNCTION public.change_my_email(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_my_email(TEXT, TEXT) TO authenticated;

-- ---------- 5-b. 휴대폰 번호 변경 (PASS 재확인 증빙 소비, 본인확인값(CI)이 계정과 같을 때만) ----------
CREATE OR REPLACE FUNCTION public.change_my_phone_by_identity(p_identity_token TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_idv_id UUID; v_ci TEXT; v_phone TEXT; v_operator TEXT; v_provider TEXT; v_pg TEXT;
  v_foreigner BOOLEAN; v_gender TEXT;
  v_account_ci TEXT; v_cur_phone TEXT; v_owner UUID; v_prev TEXT; v_rows INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT phone INTO v_cur_phone FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile required'; END IF;
  IF COALESCE(btrim(p_identity_token), '') = '' THEN RETURN 'proof_invalid'; END IF;

  -- 증빙 소비(용도 phone_change, 1시간, 1회). 아래 어떤 사유로 실패해도 소비된 채로 남는다(재사용 방지).
  UPDATE public.identity_verifications
     SET consumed_at = NOW(), consumed_by = v_uid
   WHERE consume_token_hash = encode(extensions.digest(p_identity_token, 'sha256'), 'hex')
     AND purpose = 'phone_change'
     AND verified_at > NOW() - INTERVAL '1 hour'
     AND consumed_at IS NULL AND consumed_by IS NULL
  RETURNING id, ci_hash, phone, operator, provider, pg, is_foreigner, gender
    INTO v_idv_id, v_ci, v_phone, v_operator, v_provider, v_pg, v_foreigner, v_gender;
  IF v_idv_id IS NULL OR v_ci IS NULL OR COALESCE(v_phone, '') = '' THEN RETURN 'proof_invalid'; END IF;
  -- 증빙 행의 개인정보는 읽었으니 즉시 지운다(password_reset_by_identity 와 동일)
  UPDATE public.identity_verifications
     SET name = NULL, birthdate = NULL, phone = NULL, gender = NULL, operator = NULL,
         is_foreigner = NULL, ci_hash = NULL, ip_address = NULL
   WHERE id = v_idv_id;

  -- 본인확인한 사람 = 계정 주인(CI 일치). CI 기록이 없는 계정은 바꿀 수 없다(고객센터 안내).
  SELECT ci_hash INTO v_account_ci FROM public.profiles_identity WHERE user_id = v_uid;
  IF v_account_ci IS NULL OR v_account_ci <> v_ci THEN RETURN 'mismatch'; END IF;

  IF EXISTS (SELECT 1 FROM public.blocked_phone_claims
              WHERE phone_hash = encode(extensions.digest(public.canon_phone(v_phone), 'sha256'), 'hex')
                AND released_at IS NULL) THEN
    RETURN 'phone_blocked';
  END IF;
  IF public.canon_phone(v_cur_phone) IS NOT DISTINCT FROM public.canon_phone(v_phone) THEN RETURN 'same'; END IF;
  SELECT id INTO v_owner FROM public.profiles
   WHERE public.canon_phone(phone) = public.canon_phone(v_phone) AND id <> v_uid LIMIT 1;
  IF v_owner IS NOT NULL THEN RETURN 'phone_claimed'; END IF;

  -- profiles_guard 우회는 이 UPDATE 한 줄에만. 트리거 profiles_pii_sync 가 phone_enc/phone_hash 를 다시 만든다.
  v_prev := COALESCE(current_setting('app.allow_sensitive', true), 'off');
  PERFORM set_config('app.allow_sensitive', 'on', true);
  UPDATE public.profiles SET phone = v_phone, phone_verified = TRUE, updated_at = NOW() WHERE id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM set_config('app.allow_sensitive', v_prev, true);
  IF v_rows <> 1 THEN RAISE EXCEPTION 'profile update failed'; END IF;

  UPDATE public.profiles_identity
     SET operator = COALESCE(v_operator, operator), provider = COALESCE(v_provider, provider),
         pg = COALESCE(v_pg, pg), is_foreigner = COALESCE(v_foreigner, is_foreigner),
         gender = COALESCE(v_gender, gender), verified_at = NOW()
   WHERE user_id = v_uid;
  RETURN 'ok';
EXCEPTION WHEN unique_violation THEN
  RETURN 'phone_claimed';
END;
$$;
REVOKE ALL ON FUNCTION public.change_my_phone_by_identity(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_my_phone_by_identity(TEXT) TO authenticated;

-- ---------- 6. 검토 반영 추가 보강 (2026-09-14, code-reviewer 지적) ----------
-- 6-a. profiles_private(생년월일)는 본인 SELECT 만. 쓰기는 가입 RPC(SECURITY DEFINER)만 하므로 클라이언트 쓰기 권한 회수.
REVOKE INSERT, UPDATE, DELETE ON public.profiles_private FROM anon, authenticated;

-- 6-b. 닉네임 길이 규칙을 DB 에도(가입 화면·마이페이지 모두 2~20자). NULL 은 허용(가입 전 행).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_nickname_len') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_nickname_len
      CHECK (nickname IS NULL OR char_length(btrim(nickname)) BETWEEN 2 AND 20);
  END IF;
END $$;

-- 6-c. profiles_guard 보호 목록에 name(본인확인으로 확정한 실명) 추가. 컬럼 REVOKE 대신 트리거로 막는 이유:
--      AuthContext 의 행 생성 upsert(id,email,name,…)가 ON CONFLICT DO UPDATE 형태라 컬럼 UPDATE 권한이 없으면 통째로 실패한다.
--      가입·승무원 갱신 RPC 는 app.allow_sensitive 를 켜고 쓰므로 영향 없음.
DO $$
DECLARE v_oid OID; v_def TEXT; v_anchor TEXT := 'IS DISTINCT FROM OLD.email' || E'\n';
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'profiles_guard';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'profiles_guard not found'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('NEW.name IS DISTINCT FROM OLD.name' IN v_def) > 0 THEN
    RAISE NOTICE 'profiles_guard: name already protected';
    RETURN;
  END IF;
  IF position(v_anchor IN v_def) = 0 THEN RAISE EXCEPTION 'anchor not found in profiles_guard'; END IF;
  v_def := replace(v_def, v_anchor, v_anchor || '    OR NEW.name IS DISTINCT FROM OLD.name' || E'\n');
  EXECUTE v_def;
END $$;

-- 6-d. profiles_guard 보호 목록에 암호문·해시·키버전 컬럼 추가 (4번 설명 참고). 멱등.
DO $$
DECLARE v_oid OID; v_def TEXT; v_anchor TEXT := 'OR NEW.name IS DISTINCT FROM OLD.name' || E'\n';
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'profiles_guard';
  v_def := pg_get_functiondef(v_oid);
  IF position('NEW.phone_hash IS DISTINCT FROM OLD.phone_hash' IN v_def) > 0 THEN
    RAISE NOTICE 'profiles_guard: pii columns already protected';
    RETURN;
  END IF;
  IF position(v_anchor IN v_def) = 0 THEN RAISE EXCEPTION 'name anchor not found in profiles_guard'; END IF;
  v_def := replace(v_def, v_anchor, v_anchor
    || '    OR NEW.phone_enc IS DISTINCT FROM OLD.phone_enc' || E'\n'
    || '    OR NEW.phone_hash IS DISTINCT FROM OLD.phone_hash' || E'\n'
    || '    OR NEW.name_enc IS DISTINCT FROM OLD.name_enc' || E'\n'
    || '    OR NEW.addr_zip_enc IS DISTINCT FROM OLD.addr_zip_enc' || E'\n'
    || '    OR NEW.addr_road_enc IS DISTINCT FROM OLD.addr_road_enc' || E'\n'
    || '    OR NEW.addr_detail_enc IS DISTINCT FROM OLD.addr_detail_enc' || E'\n'
    || '    OR NEW.pii_key_version IS DISTINCT FROM OLD.pii_key_version' || E'\n');
  EXECUTE v_def;
END $$;

-- ---------- 7. codex 2차 검토 반영 (2026-09-14) ----------
-- 7-a. 가입 완료 재호출 차단을 행 잠금(FOR UPDATE) 뒤에 검사 — 미완료 계정이 서로 다른 증빙으로 동시에 호출해도 하나만 통과.
--      같은 자리에서 연락 이메일 유니크 인덱스(uq_profiles_email_lower) 위반을 EMAIL_ALREADY_CLAIMED 로 매핑.
DO $$
DECLARE
  v_oid OID; v_def TEXT;
  v_gate_old TEXT := $o$IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND COALESCE(profile_completed, FALSE)) THEN
    RAISE EXCEPTION 'PROFILE_ALREADY_COMPLETED';
  END IF;$o$;
  v_gate_new TEXT := $n$PERFORM 1 FROM public.profiles WHERE id = p_user FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND COALESCE(profile_completed, FALSE)) THEN
    RAISE EXCEPTION 'PROFILE_ALREADY_COMPLETED';
  END IF;$n$;
  v_map_anchor TEXT := $m$IF v_constraint = 'profiles_nickname_key' THEN RAISE EXCEPTION 'NICKNAME_TAKEN'; END IF;$m$;
  v_map_new TEXT := $p$IF v_constraint = 'profiles_nickname_key' THEN RAISE EXCEPTION 'NICKNAME_TAKEN'; END IF;
  IF v_constraint = 'uq_profiles_email_lower' THEN RAISE EXCEPTION 'EMAIL_ALREADY_CLAIMED'; END IF;$p$;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'complete_signup_profile_for';
  v_def := pg_get_functiondef(v_oid);
  IF position('FOR UPDATE;' || E'\n' || '  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND COALESCE(profile_completed, FALSE))' IN v_def) = 0 THEN
    IF position(v_gate_old IN v_def) = 0 THEN RAISE EXCEPTION 'gate anchor not found in complete_signup_profile_for'; END IF;
    v_def := replace(v_def, v_gate_old, v_gate_new);
  END IF;
  IF position('uq_profiles_email_lower' IN v_def) = 0 THEN
    IF position(v_map_anchor IN v_def) = 0 THEN RAISE EXCEPTION 'map anchor not found in complete_signup_profile_for'; END IF;
    v_def := replace(v_def, v_map_anchor, v_map_new);
  END IF;
  EXECUTE v_def;
END $$;

-- 7-b. 닉네임 제약에 운영진 사칭 단어 차단 추가(클라이언트 검사와 동일 목록). 기존 제약을 새 정의로 교체.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_nickname_len;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_nickname_len
  CHECK (nickname IS NULL OR (char_length(btrim(nickname)) BETWEEN 2 AND 20
         AND nickname !~* '(관리자|운영자|운영진|admin|connecttrip|커넥트립)'));

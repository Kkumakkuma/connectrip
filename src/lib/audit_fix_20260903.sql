-- ============================================================================
-- 2026-09-03 기능 전수 감사 후속 (운영 DB 적용본, 재실행 안전)
--  1) flight_schedules.user_type 위조 차단: 서버가 profiles 기준으로 강제
--  2) 칭송 스크린샷 제출을 RPC 로 이전 + 가드 확장(제출 상태·URL 은 RPC 전용)
--  3) 매칭신청권 취소 환불 RPC (약관 7조: 구매 7일 안·미사용 → 포인트 반환)
-- ============================================================================

-- 1) flight_schedules 가드 --------------------------------------------------
-- 클라이언트가 user_type 을 'crew' 로 넣어도 인증 승무원이 아니면 'passenger' 로 덮어쓴다.
-- (can_use_flight_board 가 fs.user_type 으로 승무원/일반 게시판을 가르므로 이 값이 신뢰 경계)
CREATE OR REPLACE FUNCTION public.flight_schedules_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_type text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- 소유자 이전 금지(RLS USING 이 막지만 이중 방어)
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'schedule owner cannot change';
    END IF;
    -- 진행 중 칭송매칭이 걸린 항공편의 편명·날짜는 바꿀 수 없다(상대방 매칭까지 어긋나는 것을 서버에서 차단.
    -- 프런트 MyPage 는 사전 안내만 하고, 경쟁 조건은 여기서 최종 방어)
    IF (NEW.flight_number IS DISTINCT FROM OLD.flight_number OR NEW.flight_date IS DISTINCT FROM OLD.flight_date)
       AND EXISTS (SELECT 1 FROM public.commendation_matches m
                    WHERE m.flight_number = OLD.flight_number AND m.flight_date = OLD.flight_date
                      AND (m.crew_user_id = OLD.user_id OR m.passenger_user_id = OLD.user_id)
                      AND m.status NOT IN ('rejected', 'deleted')) THEN
      RAISE EXCEPTION 'active match exists';
    END IF;
  END IF;
  SELECT CASE WHEN p.user_type = 'crew' AND COALESCE(p.crew_verified, FALSE) THEN 'crew' ELSE 'passenger' END
    INTO v_type
    FROM public.profiles p
   WHERE p.id = NEW.user_id;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
  NEW.user_type := v_type;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flight_schedules_guard ON public.flight_schedules;
CREATE TRIGGER trg_flight_schedules_guard
  BEFORE INSERT OR UPDATE ON public.flight_schedules
  FOR EACH ROW EXECUTE FUNCTION public.flight_schedules_guard();

-- 기존 행 백필(트리거 도입 전 데이터도 같은 기준으로 정리, 재실행 안전)
UPDATE public.flight_schedules fs
   SET user_type = CASE WHEN p.user_type = 'crew' AND COALESCE(p.crew_verified, FALSE) THEN 'crew' ELSE 'passenger' END
  FROM public.profiles p
 WHERE p.id = fs.user_id
   AND fs.user_type IS DISTINCT FROM CASE WHEN p.user_type = 'crew' AND COALESCE(p.crew_verified, FALSE) THEN 'crew' ELSE 'passenger' END;

-- 프로필의 승무원 인증 상태가 바뀌면 그 회원의 스케줄 user_type 을 즉시 재계산(BEFORE UPDATE 가드가 값을 덮어씀)
CREATE OR REPLACE FUNCTION public.flight_schedules_sync_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_type IS DISTINCT FROM OLD.user_type OR NEW.crew_verified IS DISTINCT FROM OLD.crew_verified THEN
    UPDATE public.flight_schedules SET user_type = user_type WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_flight_schedules_sync_from_profile ON public.profiles;
CREATE TRIGGER trg_flight_schedules_sync_from_profile
  AFTER UPDATE OF user_type, crew_verified ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.flight_schedules_sync_from_profile();

-- 2) 칭송 스크린샷 제출 RPC ---------------------------------------------------
-- 조건: 호출자 = 승객 / status = 'matched' / 비행일이 KST 기준으로 지났을 것 / http(s) URL
CREATE OR REPLACE FUNCTION public.submit_commendation_screenshot(p_match_id uuid, p_url text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me  uuid := auth.uid();
  v_row public.commendation_matches%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_url IS NULL OR length(p_url) > 2000 OR p_url !~* '^https?://' THEN
    RAISE EXCEPTION 'invalid url';
  END IF;

  SELECT * INTO v_row FROM public.commendation_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'match not found'; END IF;
  IF v_row.passenger_user_id IS DISTINCT FROM v_me THEN RAISE EXCEPTION 'not your match'; END IF;
  IF v_row.status <> 'matched' THEN RAISE EXCEPTION 'match not active'; END IF;
  IF v_row.flight_date IS NULL OR v_row.flight_date >= (NOW() AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION 'flight not yet completed';
  END IF;

  PERFORM set_config('app.allow_sensitive', 'on', true);
  UPDATE public.commendation_matches
     SET status = 'commendation_submitted',
         commendation_screenshot_url = p_url,
         updated_at = NOW()
   WHERE id = p_match_id;
  RETURN 'commendation_submitted';
END;
$$;

REVOKE ALL ON FUNCTION public.submit_commendation_screenshot(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_commendation_screenshot(uuid, text) TO authenticated;

-- 가드 v3: security_hardening 원본(INSERT 검증·종료상태 불변·matched RPC 전용)에 제출 상태·스크린샷 URL 보호를 합친 최종본.
-- (운영 DB 에는 UPDATE 전용 구버전이 돌고 있었음 — 2026-09-03 실측 후 이 본문으로 교체)
CREATE OR REPLACE FUNCTION public.commendation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_bypass BOOLEAN; v_me UUID;
BEGIN
  v_me := auth.uid();
  -- ⚠ COALESCE 필수: current_setting(...,true) 는 미설정 세션에서 NULL → 가드 전체 무력화(실사고).
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
      IF NEW.status NOT IN ('pending_crew', 'pending_passenger') THEN
        RAISE EXCEPTION 'invalid initial status';
      END IF;
      NEW.gift_points := NULL;
      NEW.gift_message := NULL;
      NEW.commendation_screenshot_url := NULL;
      -- crew_user_id 가 지정되면 반드시 인증 승무원이어야(직접 INSERT 로 일반 사용자를 crew 로 위조 차단)
      IF NEW.crew_user_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = NEW.crew_user_id AND user_type = 'crew' AND COALESCE(crew_verified, FALSE) = TRUE
      ) THEN RAISE EXCEPTION 'crew_user_id must be verified crew'; END IF;
    ELSE -- UPDATE
      IF NEW.crew_user_id      IS DISTINCT FROM OLD.crew_user_id
      OR NEW.passenger_user_id IS DISTINCT FROM OLD.passenger_user_id
      OR NEW.gift_points       IS DISTINCT FROM OLD.gift_points
      OR NEW.gift_message      IS DISTINCT FROM OLD.gift_message
      OR NEW.flight_number     IS DISTINCT FROM OLD.flight_number
      OR NEW.flight_date       IS DISTINCT FROM OLD.flight_date
      OR NEW.commendation_screenshot_url IS DISTINCT FROM OLD.commendation_screenshot_url THEN
        RAISE EXCEPTION 'protected match field';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        -- 취소·거절된 건은 되살릴 수 없다(deleted→pending→RPC matched 로 선물 재지급 우회 차단)
        IF OLD.status IN ('deleted', 'rejected') THEN
          RAISE EXCEPTION 'closed match cannot change';
        END IF;
        -- 제출·승인·발송 완료 건은 기록 삭제(deleted)만 가능
        IF OLD.status IN ('gift_sent', 'verified', 'commendation_submitted') AND NEW.status <> 'deleted' THEN
          RAISE EXCEPTION 'finalized match cannot change';
        END IF;
        -- 제출/승인/발송으로의 전이는 RPC(submit_commendation_screenshot)·관리자만
        IF NEW.status IN ('commendation_submitted', 'verified', 'gift_sent') THEN
          RAISE EXCEPTION 'status transition not allowed';
        END IF;
        -- pending -> matched 전이는 RPC(apply_commendation_match)만 — 사용자가 자기 행을 임의 matched 위조 차단
        IF NEW.status = 'matched' THEN
          RAISE EXCEPTION 'matched only via RPC';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


-- 3) 매칭신청권 취소 환불 -----------------------------------------------------
-- ※ apply_commendation_match 는 신청권 차감 직후 point_transactions(amount 0, type 'voucher_use') 를 남긴다
--    (security_hardening.sql 의 정의가 원본, 2026-09-03 추가). 이 기록이 환불 가능 수량 계산의 근거다.
-- 최근 7일 구매분(point_transactions.voucher_purchase) 중 아직 환불되지 않은 수량 안에서,
-- 현재 보유 신청권(미사용) 범위로만 환불. 관리자 선물(admin_grant_vouchers) 분은 환불 대상 아님.
CREATE OR REPLACE FUNCTION public.refund_my_voucher(p_qty integer DEFAULT 1)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me       uuid := auth.uid();
  v_cnt      int;
  v_bought   int;
  v_refunded int;
  v_used     int;
  v_first    timestamptz;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > 100 THEN RAISE EXCEPTION 'invalid qty'; END IF;

  PERFORM set_config('app.allow_sensitive', 'on', true);
  SELECT COALESCE(voucher_count, 0) INTO v_cnt FROM public.profiles WHERE id = v_me FOR UPDATE;
  IF v_cnt IS NULL THEN RAISE EXCEPTION 'profile not found'; END IF;
  IF v_cnt < p_qty THEN RAISE EXCEPTION 'insufficient voucher'; END IF;

  -- 최근 7일 구매분과 그 첫 구매 시각
  SELECT COALESCE(SUM((-amount) / 30000), 0), MIN(created_at) INTO v_bought, v_first
    FROM public.point_transactions
   WHERE user_id = v_me AND type = 'voucher_purchase'
     AND created_at >= NOW() - INTERVAL '7 days';
  IF v_bought = 0 THEN
    IF EXISTS (SELECT 1 FROM public.point_transactions WHERE user_id = v_me AND type = 'voucher_purchase') THEN
      RAISE EXCEPTION 'refund window passed';
    END IF;
    RAISE EXCEPTION 'no refundable voucher';
  END IF;

  -- 첫 구매 이후의 환불·사용(voucher_use, apply_commendation_match 가 기록)은 구매분에서 먼저 차감.
  -- 관리자 지급분(admin_grant_vouchers)이 포인트로 환불되지 않도록 보수적으로 계산한다.
  SELECT COALESCE(SUM(amount / 30000), 0) INTO v_refunded
    FROM public.point_transactions
   WHERE user_id = v_me AND type = 'voucher_refund' AND created_at >= v_first;
  SELECT COUNT(*) INTO v_used
    FROM public.point_transactions
   WHERE user_id = v_me AND type = 'voucher_use' AND created_at >= v_first;
  IF LEAST(v_cnt, v_bought - v_refunded - v_used) < p_qty THEN
    RAISE EXCEPTION 'no refundable voucher';
  END IF;

  UPDATE public.profiles
     SET voucher_count  = voucher_count - p_qty,
         points_balance = COALESCE(points_balance, 0) + 30000 * p_qty,
         updated_at     = NOW()
   WHERE id = v_me;
  INSERT INTO public.point_transactions(user_id, amount, type, description)
    VALUES (v_me, 30000 * p_qty, 'voucher_refund', '매칭신청권 ' || p_qty || '개 취소 환불');
  RETURN p_qty;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_my_voucher(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_my_voucher(integer) TO authenticated;

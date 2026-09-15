-- ============================================================================
-- 이용제한(is_banned) 계정 = "다른 사람과 하는 활동"만 서버에서 막는다 (2026-09-16, 쿠마님 확정)
--   막는다   : 동행 모집 글 작성(companion_posts INSERT) · 동행 댓글·답글 = 참여(companion_comments INSERT)
--              · 같은 편 게시판 참여 스위치 켜기(flight_schedules.board_joined 가 TRUE 로 바뀌는 순간)
--              · 쪽지·1:1 대화·장터 거래는 이미 chat_open/chat_send/message_send 가 막고 있음(chat_market_20260906.sql, 그대로 둠)
--   막지 않는다: Q&A·자유·후기·추천지·CREW 글·댓글, 여행일정, 플래너 후기, 장터 글 올리기, 본인 글 수정·삭제, 신고, 계정 관리,
--              그리고 **좋아요**(toggle_post_like 의 is_banned 조건 제거 — phone_verified 조건은 유지)
--   서버 메시지: RAISE EXCEPTION 'BANNED' USING ERRCODE = 'P0001' (기존 chat RPC 와 같은 문자열 → 클라이언트는 'BANNED' 포함 여부로 판정)
-- 왜 트리거인가: 세 지점 모두 클라이언트 직접 테이블 쓰기(db.js companionApi.create / addComment / flightApi.setBoardJoined)이고
--   authenticated 는 profiles.is_banned SELECT 권한이 없어 RLS 정책 본문에 넣으면 42501 → SECURITY DEFINER 트리거로만 가능.
--   기존 BEFORE 트리거 함수(set_author_from_nickname 12개 테이블, trg_comment_parent_guard 6개 테이블)는 공용이라 손대지 않고
--   companion 두 테이블 전용 트리거(aa_ 접두어 = 알파벳순 가장 먼저 실행)를 새로 건다.
-- 운영 원본(적용 전 정의) 보관: 스크래치 nickname/ban2_functions_before.sql (2026-09-16 pg_get_functiondef 실측)
-- 재실행 안전(멱등). 운영 실측(9/16): is_banned=true 회원 0명.
-- ============================================================================

-- 1) 동행 전용 차단 트리거 함수 -------------------------------------------------
CREATE OR REPLACE FUNCTION public.deny_if_banned()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND COALESCE(p.is_banned, FALSE)) THEN
    RAISE EXCEPTION 'BANNED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.deny_if_banned() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aa_deny_banned ON public.companion_posts;
CREATE TRIGGER aa_deny_banned BEFORE INSERT ON public.companion_posts
  FOR EACH ROW EXECUTE FUNCTION public.deny_if_banned();

DROP TRIGGER IF EXISTS aa_deny_banned ON public.companion_comments;
CREATE TRIGGER aa_deny_banned BEFORE INSERT ON public.companion_comments
  FOR EACH ROW EXECUTE FUNCTION public.deny_if_banned();

-- 2) 같은 편 게시판 참여 스위치 --------------------------------------------------
-- RPC 가 아니라 flight_schedules.board_joined 직접 UPDATE(db.js flightApi.setBoardJoined). 기존 BEFORE INSERT OR UPDATE 트리거
-- 함수 flight_schedules_guard() 운영 원본(ban2_functions_before.sql)에 "board_joined 가 TRUE 로 켜지는 순간" 검사만 추가.
-- 끄기·단순 스케줄 등록은 막지 않는다. INSERT 에 board_joined:true 를 실어 보내는 우회도 같은 조건으로 잡힌다.
-- (게시판 글·댓글·목록은 flight_board_member_type 이 이미 is_banned 를 제외하므로 여기서 막는 건 "참여·번호 배정·타인 알림" 자체.)
CREATE OR REPLACE FUNCTION public.flight_schedules_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v_type text; v_banned boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'schedule owner cannot change'; END IF;
    -- 진행 중 칭송매칭이 걸린 항공편의 편명·날짜는 바꿀 수 없다(상대방 매칭까지 어긋나는 것을 서버에서 차단)
    IF (NEW.flight_number IS DISTINCT FROM OLD.flight_number OR NEW.flight_date IS DISTINCT FROM OLD.flight_date)
       AND EXISTS (SELECT 1 FROM public.commendation_matches m
                    WHERE m.flight_number = OLD.flight_number AND m.flight_date = OLD.flight_date
                      AND (m.crew_user_id = OLD.user_id OR m.passenger_user_id = OLD.user_id)
                      AND m.status NOT IN ('rejected', 'deleted')) THEN
      RAISE EXCEPTION 'active match exists';
    END IF;
  END IF;
  SELECT CASE WHEN p.user_type = 'crew' AND COALESCE(p.crew_verified, FALSE) THEN 'crew' ELSE 'passenger' END, COALESCE(p.is_banned, FALSE)
    INTO v_type, v_banned FROM public.profiles p WHERE p.id = NEW.user_id;
  IF v_type IS NULL THEN RAISE EXCEPTION 'profile not found'; END IF;
  -- 이용제한 계정은 같은 편 게시판 참여 스위치를 켤 수 없다(2026-09-16). 끄기·등록은 통과.
  IF v_banned AND COALESCE(NEW.board_joined, FALSE) AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.board_joined, FALSE)) THEN RAISE EXCEPTION 'BANNED' USING ERRCODE = 'P0001'; END IF;
  NEW.user_type := v_type;
  RETURN NEW;
END; $function$;
-- ACL 원본 유지: {postgres, service_role} 만 EXECUTE (CREATE OR REPLACE 는 ACL 을 보존하지만 새 DB 에선 명시)
REVOKE EXECUTE ON FUNCTION public.flight_schedules_guard() FROM PUBLIC, anon, authenticated;

-- 3) 좋아요는 풀어 준다 ------------------------------------------------------------
-- 운영 정의(= planner_20260904.sql:1389 정의와 일치, itinerary_posts + 존재 확인 포함. likes_economy.sql 본문 아님 — 그걸로 재적용하면
-- 여행일정 좋아요가 invalid board_type 으로 깨진다)에서 첫 검사 블록의 `and coalesce(is_banned, false) = false` 한 곳만 제거.
CREATE OR REPLACE FUNCTION public.toggle_post_like(p_board_type text, p_post_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_liked boolean;
  v_count int;
  v_exists boolean;
  v_author uuid;
  v_month_earned int;
  c_reward int := 1;
  c_month_cap int := 2000;
begin
  if v_user is null then raise exception 'auth required'; end if;
  if not exists (
    select 1 from public.profiles
    where id = v_user and coalesce(phone_verified, false) = true
  ) then
    raise exception 'phone verification required';
  end if;
  if p_board_type not in ('destinations','reviews','qna_posts','companion_posts','crew_posts','itinerary_posts') then
    raise exception 'invalid board_type';
  end if;
  if p_post_id is null then raise exception 'post not found'; end if;

  delete from public.post_likes
    where user_id = v_user and board_type = p_board_type and post_id = p_post_id;
  if found then
    v_liked := false;
  else
    v_exists := case p_board_type
      when 'destinations'     then exists (select 1 from public.destinations     where id = p_post_id)
      when 'reviews'          then exists (select 1 from public.reviews          where id = p_post_id)
      when 'qna_posts'        then exists (select 1 from public.qna_posts        where id = p_post_id)
      when 'companion_posts'  then exists (select 1 from public.companion_posts  where id = p_post_id)
      when 'crew_posts'       then exists (select 1 from public.crew_posts       where id = p_post_id)
      when 'itinerary_posts'  then exists (select 1 from public.itinerary_posts  where id = p_post_id)
    end;
    if not coalesce(v_exists, false) then raise exception 'post not found'; end if;

    insert into public.post_likes(user_id, board_type, post_id)
      values (v_user, p_board_type, p_post_id);
    v_liked := true;

    v_author := case p_board_type
      when 'destinations'     then (select user_id from public.destinations     where id = p_post_id)
      when 'reviews'          then (select user_id from public.reviews          where id = p_post_id)
      when 'qna_posts'        then (select user_id from public.qna_posts        where id = p_post_id)
      when 'companion_posts'  then (select user_id from public.companion_posts  where id = p_post_id)
      when 'crew_posts'       then (select user_id from public.crew_posts       where id = p_post_id)
      when 'itinerary_posts'  then (select user_id from public.itinerary_posts  where id = p_post_id)
    end;

    if p_board_type = 'crew_posts'
       and v_author is not null and v_author <> v_user
       and exists (select 1 from public.profiles where id = v_author and user_type = 'crew' and coalesce(crew_verified, false) = true) then
      select coalesce(sum(amount), 0) into v_month_earned
        from public.point_transactions
        where user_id = v_author and type = 'like_earn'
          and created_at >= date_trunc('month', now());
      if v_month_earned < c_month_cap then
        perform set_config('app.allow_sensitive', 'on', true);
        update public.profiles
          set points_balance = coalesce(points_balance, 0) + c_reward, updated_at = now()
          where id = v_author;
        insert into public.point_transactions(user_id, amount, type, description)
          values (v_author, c_reward, 'like_earn', '게시글 좋아요 보상');
      end if;
    end if;
  end if;

  select count(*) into v_count
    from public.post_likes where board_type = p_board_type and post_id = p_post_id;
  return jsonb_build_object('liked', v_liked, 'likes_count', v_count);
end;
$function$;
-- ACL 원본 유지: {postgres, authenticated, service_role} (likes_economy.sql:99-100 과 동일)
REVOKE ALL ON FUNCTION public.toggle_post_like(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_post_like(text, uuid) TO authenticated;

-- ============================================================================
-- 되돌리기 절차
--   1) 트리거 제거:
--        DROP TRIGGER IF EXISTS aa_deny_banned ON public.companion_posts;
--        DROP TRIGGER IF EXISTS aa_deny_banned ON public.companion_comments;
--        DROP FUNCTION IF EXISTS public.deny_if_banned();
--   2) flight_schedules_guard() · toggle_post_like(text, uuid) 를 적용 전 운영 원본으로 재적용:
--        C:\Users\goopy\AppData\Local\Temp\claude\C--Users-goopy-Desktop-Claude\e8f35951-d81d-4abb-8841-fb7c661648be\scratchpad\nickname\ban2_functions_before.sql
--        ([D] 절의 두 CREATE OR REPLACE FUNCTION 만 실행. toggle_post_like 원본은 planner_20260904.sql:1389 정의와도 동일)
--   3) 소스 동기화 대상: likes_economy.sql:47 · planner_20260904.sql:1404 (is_banned 조건 줄) — 되돌릴 땐 두 파일도 원복.
-- ============================================================================

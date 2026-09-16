-- 2026-09-16 이용제한 보강: 참여 중 편명·날짜 변경 우회 차단
--
-- 배경(codex 교차검토, ban_companion_20260916 후속):
--   ban_companion_20260916 은 이용제한(is_banned) 회원이 같은 편 게시판 참여 스위치를 "켜는 순간"(INSERT 로 켜짐,
--   꺼짐→켜짐)만 막았다. 제한되기 전에 이미 켜 둔 일정은 board_joined=true 로 남아 있어, 그 상태로 편명·날짜를
--   다른 열린 게시판으로 고치면 trg_flight_board_alias 가 새 게시판 번호를 배정하고
--   trg_notify_same_flight 가 그 편 참여자들에게 "새로 들어왔습니다" 알림을 보냈다. 쿠마님 결정(9/16)은
--   "다른 사람과 하는 활동만 막는다 — 같은 편 게시판 참여 포함" 이므로 이 경로도 막는다.
--
-- 막는 방식:
--   본인 일정 수정 자체는 막지 않는다(편명 오타 고치기 등). 대신 제한 회원이 참여 중인 일정의 편명·날짜·회원 유형이
--   바뀌면(= 다른 게시판으로 옮겨 가는 것과 같음) 참여 스위치를 끈 채로 저장한다. 스위치가 꺼지면 AFTER 트리거
--   두 개(번호 배정·참여 알림)가 모두 건너뛴다. 편명·날짜를 안 바꾸는 수정은 그대로 둔다.
--   게시판 읽기·쓰기는 flight_board_member_type 이 이미 is_banned 를 제외하므로 기존 참여 상태 유지는 문제 없다.
--
-- 적용 기준: 운영 정의(pg_get_functiondef, 2026-09-16 실측 = ban_companion_20260916.sql 42~69줄과 동일)에
--   "참여 중 이동 시 스위치 끄기" 블록 한 개만 추가. 나머지 줄은 한 글자도 바꾸지 않는다.

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
  IF v_banned AND COALESCE(NEW.board_joined, FALSE) AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.board_joined, FALSE)) THEN RAISE EXCEPTION 'BANNED' USING ERRCODE = 'P0001'; END IF;
  -- (2026-09-16 추가) 제한 회원이 참여 중인 일정을 다른 게시판(편명·날짜·회원 유형)으로 옮기면 스위치를 끈 채 저장한다.
  IF v_banned AND TG_OP = 'UPDATE' AND COALESCE(NEW.board_joined, FALSE)
     AND (NEW.flight_number IS DISTINCT FROM OLD.flight_number
          OR NEW.flight_date IS DISTINCT FROM OLD.flight_date
          OR v_type IS DISTINCT FROM OLD.user_type) THEN
    NEW.board_joined := FALSE;
  END IF;
  NEW.user_type := v_type;
  RETURN NEW;
END; $function$;
-- ACL 원본 유지: {postgres, service_role} 만 EXECUTE (CREATE OR REPLACE 는 ACL 을 보존하지만 새 DB 에선 명시)
REVOKE EXECUTE ON FUNCTION public.flight_schedules_guard() FROM PUBLIC, anon, authenticated;

-- 검증(운영, 트랜잭션 안에서 실행 후 예외로 전부 롤백):
--   테스트 계정 일정 하나를 참여 상태로 만들고(열리지 않은 먼 날짜라 알림 없음) → is_banned=true →
--   편명 변경 UPDATE → board_joined 가 false 인지, 편명만 안 바꾼 UPDATE 는 true 로 남는지 확인.
-- 롤백: 이 파일 적용 전 정의 = ban_companion_20260916.sql 42~70줄을 다시 실행.

-- ============================================================================
-- 같은 편 게시판 익명화 + 비밀댓글·답글 (2026-09-06, 쿠마님 지시) — 재실행 안전(멱등)
--   · 같은 편 탑승자 명단(이름)은 누구도 볼 수 없다 — flight_schedules 는 본인 행만 읽힌다.
--   · 스케줄마다 "게시판 참여" 스위치(flight_schedules.board_joined)를 켜야 들어가고, 끄면 나온다. 출발 14일 전~출발일에만 열린다(is_public 컬럼은 남기되 미사용).
--   · 게시판 안에서는 편·회원유형별로 자동 배정된 익명 번호("익명 승객 3")로만 글·댓글을 쓴다.
--   · 1:1 쪽지는 뺀다 — messages INSERT 권한 회수 + 알림 트리거 제거(테이블·데이터는 보존, 운영 데이터 0).
--   · 비밀댓글(글쓴이·댓글 쓴 사람·답글 대상·관리자만 봄) + 답글(parent_id) — 같은 편 게시판, Q&A 게시판.
--     비밀댓글에 단 답글은 항상 비밀댓글. 답글 대상(reply_to_user_id)은 등록 시점에 굳혀 두어 부모 댓글이 지워져도 열람권이 남는다.
--   · 글·댓글의 user_id·author_name 이 클라이언트로 나가지 않도록 테이블 직접 접근을 막고 RPC 만 연다.
--   · 신고·차단이 실명 역추적 경로가 되지 않도록: reports 열람은 관리자만, 게시판 숨김은 별도 mutes 테이블(RPC 전용, 게시판 단위).
--     전역 blocks 는 익명 게시판에 적용하지 않는다(실명 id 로 차단해 두고 글이 사라지는지 비교하면 번호를 되짚을 수 있으므로).
-- 운영 데이터 실측(9/6 18:15): flight_schedules 0, flight_posts 0, comments 0, messages 0 → 백필 없음.
-- 원본 파일도 같은 상태로 맞춰 두었다(재실행 회귀 방지): security_hardening.sql(GRANT→REVOKE, can_use_flight_board, reports 정책),
--   schema.sql(flight_schedules·qna_comments 정책), notifications_20260903.sql(트리거 3종).
-- 1차 적용 9/6 18:45, 교차검토(codex·agy) 반영 2차 적용 9/6 — 전체 재실행.
-- 3차(9/6 20:20 쿠마님 지시, v4 적용, agy 검토 반영 v5: 알림 중복 방지·열린 기간에만·KST 생일): 자동 참여 → 스케줄마다 "게시판 참여" 스위치(board_joined, 기본 꺼짐), 출발 2주 전부터 열리고 출발일이 지나면 닫힘(읽기 전용 없음).
-- ============================================================================

-- 1) 익명 번호 --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flight_board_aliases (
  flight_number text NOT NULL,
  flight_date   date NOT NULL,
  member_type   text NOT NULL CHECK (member_type IN ('passenger','crew')),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  alias_no      smallint NOT NULL CHECK (alias_no BETWEEN 1 AND 9999),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flight_number, flight_date, member_type, user_id),
  UNIQUE (flight_number, flight_date, member_type, alias_no)
);
ALTER TABLE public.flight_board_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flight_board_aliases FROM PUBLIC, anon, authenticated;

-- 1-2) 게시판 전용 숨김(뮤트). 게시판(편·날짜) 단위라 다른 편에서 같은 사람이 사라지는 것으로 번호를 잇지 못한다.
--      (2차: 편 키 추가 — 1차 테이블은 데이터 0 이라 새로 만든다)
DROP TABLE IF EXISTS public.flight_board_mutes;
CREATE TABLE public.flight_board_mutes (
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  flight_number  text NOT NULL,
  flight_date    date NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_user_id, flight_number, flight_date)
);
ALTER TABLE public.flight_board_mutes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flight_board_mutes FROM PUBLIC, anon, authenticated;

-- 1-3) 참여 알림 기록: (스케줄, 편명, 날짜, 수신자) 단위로 한 번만 알린다(스위치 반복 방지). 편명·날짜를 바꾸면 새 편 참여자에게는 알린다.
CREATE TABLE IF NOT EXISTS public.flight_board_join_notices (
  schedule_id   uuid NOT NULL REFERENCES public.flight_schedules(id) ON DELETE CASCADE,
  flight_number text NOT NULL,
  flight_date   date NOT NULL,
  receiver_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schedule_id, flight_number, flight_date, receiver_id)
);
ALTER TABLE public.flight_board_join_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flight_board_join_notices FROM PUBLIC, anon, authenticated;

-- 2) 글·댓글 컬럼 + 직접 접근 차단(RPC 전용) --------------------------------
ALTER TABLE public.flight_schedules ADD COLUMN IF NOT EXISTS board_joined boolean NOT NULL DEFAULT false;
ALTER TABLE public.flight_posts ADD COLUMN IF NOT EXISTS alias text NOT NULL DEFAULT '익명';
ALTER TABLE public.flight_post_comments ADD COLUMN IF NOT EXISTS alias text NOT NULL DEFAULT '익명';
ALTER TABLE public.flight_post_comments ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
ALTER TABLE public.flight_post_comments ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.flight_post_comments(id) ON DELETE SET NULL;
ALTER TABLE public.flight_post_comments ADD COLUMN IF NOT EXISTS reply_to_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
-- 기존 RLS 정책은 심층방어로 남긴다. 클라이언트는 아래 RPC 로만 읽고 쓴다(user_id 가 응답에 실리지 않는다).
REVOKE ALL ON public.flight_posts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.flight_post_comments FROM PUBLIC, anon, authenticated;

-- 게시판이 열리는 기간: 출발 14일 전부터 출발일까지(KST). 지나면 닫힌다(읽기 전용 없음).
CREATE OR REPLACE FUNCTION public.flight_board_writable(p_date date)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_date IS NOT NULL
     AND ((now() AT TIME ZONE 'Asia/Seoul')::date) >= (p_date - 14)
     AND ((now() AT TIME ZONE 'Asia/Seoul')::date) <= p_date;
$$;
GRANT EXECUTE ON FUNCTION public.flight_board_writable(date) TO authenticated;

-- 3) 자격: "게시판 참여" 스위치를 켠 본인 스케줄 + 열린 기간. 회원유형은 클라이언트가 아니라 스케줄 행(user_type)에서 정한다 ----
--    (flight_schedules_guard 가 미인증 승무원의 user_type 을 passenger 로 바꾸므로 클라이언트 값과 어긋날 수 있다)
CREATE OR REPLACE FUNCTION public.flight_board_member_type(p_user uuid, p_flight text, p_date date)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT fs.user_type
    FROM public.flight_schedules fs
    JOIN public.profiles pr ON pr.id = fs.user_id
    JOIN public.profiles_private pp ON pp.user_id = fs.user_id
   WHERE p_user IS NOT NULL AND fs.user_id = p_user
     AND fs.flight_number = p_flight AND fs.flight_date = p_date
     AND COALESCE(fs.board_joined, FALSE) = TRUE
     AND public.flight_board_writable(p_date)
     AND fs.user_type IN ('passenger','crew')
     AND COALESCE(pr.is_banned, FALSE) = FALSE
     AND pp.birthdate IS NOT NULL
     AND pp.birthdate <= (((now() AT TIME ZONE 'Asia/Seoul')::date) - INTERVAL '19 years')   -- 만 19세 판정도 KST
   ORDER BY fs.created_at DESC, fs.id
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.flight_board_member_type(uuid, text, date) FROM PUBLIC, anon, authenticated;

-- 기존 RLS 정책이 쓰는 함수. is_public 조건만 빠졌다.
CREATE OR REPLACE FUNCTION public.can_use_flight_board(p_flight TEXT, p_date DATE, p_member_type TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(public.flight_board_member_type(auth.uid(), p_flight, p_date) = p_member_type, FALSE);
$$;

-- 보는 사람이 이 게시판에서 숨긴 작성자인가(게시판 단위 mutes 만). NULL 이면 숨기지 않는다.
DROP FUNCTION IF EXISTS public.flight_board_hidden(uuid, uuid);
CREATE OR REPLACE FUNCTION public.flight_board_hidden(p_viewer uuid, p_author uuid, p_flight text, p_date date)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_viewer IS NULL OR p_author IS NULL OR p_viewer = p_author THEN FALSE
    ELSE EXISTS (SELECT 1 FROM public.flight_board_mutes m
                  WHERE m.user_id = p_viewer AND m.target_user_id = p_author
                    AND m.flight_number = p_flight AND m.flight_date = p_date)
  END;
$$;
REVOKE ALL ON FUNCTION public.flight_board_hidden(uuid, uuid, text, date) FROM PUBLIC, anon, authenticated;

-- 4) 익명 번호 배정 -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.flight_board_alias_label(p_member_type text, p_no int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_member_type = 'crew' THEN '익명 승무원 ' ELSE '익명 승객 ' END || p_no::text;
$$;

-- 편·회원유형·회원 조합에 한 번 배정하면 그대로 둔다(글을 지워도, 스케줄을 지웠다 다시 등록해도 같은 번호).
CREATE OR REPLACE FUNCTION public.flight_board_alias(p_user uuid, p_flight text, p_date date, p_member_type text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_no int;
BEGIN
  SELECT alias_no INTO v_no FROM public.flight_board_aliases
   WHERE flight_number = p_flight AND flight_date = p_date AND member_type = p_member_type AND user_id = p_user;
  IF v_no IS NULL THEN
    -- 같은 게시판 안에서 번호가 겹치지 않게 게시판 단위 잠금(트랜잭션 끝까지). 64비트 해시로 다른 게시판과의 충돌을 줄인다.
    PERFORM pg_advisory_xact_lock(hashtextextended('flight_board:' || p_flight || '|' || p_date::text || '|' || p_member_type, 0));
    SELECT COALESCE(MAX(alias_no), 0) + 1 INTO v_no FROM public.flight_board_aliases
     WHERE flight_number = p_flight AND flight_date = p_date AND member_type = p_member_type;
    INSERT INTO public.flight_board_aliases (flight_number, flight_date, member_type, user_id, alias_no)
    VALUES (p_flight, p_date, p_member_type, p_user, v_no)
    ON CONFLICT (flight_number, flight_date, member_type, user_id) DO NOTHING;
    SELECT alias_no INTO v_no FROM public.flight_board_aliases
     WHERE flight_number = p_flight AND flight_date = p_date AND member_type = p_member_type AND user_id = p_user;
  END IF;
  RETURN public.flight_board_alias_label(p_member_type, v_no);
END $$;
REVOKE ALL ON FUNCTION public.flight_board_alias(uuid, text, date, text) FROM PUBLIC, anon, authenticated;

-- 4-2) 참여를 켜는 즉시 번호 배정: 첫 글을 쓰기 전에도 "내 이름: 익명 승객 3" 을 보여 준다. 편명·날짜를 고치면 새 게시판에서 새 번호.
CREATE OR REPLACE FUNCTION public.trg_flight_board_alias() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF COALESCE(NEW.board_joined, FALSE) AND NEW.user_type IN ('passenger','crew') THEN
    PERFORM public.flight_board_alias(NEW.user_id, NEW.flight_number, NEW.flight_date, NEW.user_type);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'alias trigger skipped: %', SQLERRM;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.trg_flight_board_alias() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_flight_board_alias ON public.flight_schedules;
CREATE TRIGGER trg_flight_board_alias AFTER INSERT OR UPDATE OF flight_number, flight_date, user_type, board_joined ON public.flight_schedules
  FOR EACH ROW EXECUTE FUNCTION public.trg_flight_board_alias();

-- 5) RPC ------------------------------------------------------------------
-- 목록: 자격 없으면 eligible=false. 숨긴 작성자의 글·댓글은 빼고, 비밀댓글은 댓글 작성자·글 작성자·답글 대상·관리자에게만 준다.
-- 응답에 user_id·author_name 은 절대 싣지 않는다(mine 플래그만). 숨긴 사람이 쓴 부모 댓글의 번호도 내리지 않는다.
CREATE OR REPLACE FUNCTION public.flight_board_list(p_flight text, p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean := COALESCE(public.is_admin(), FALSE);
  v_type text;
  v_alias text;
  v_posts jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  v_type := public.flight_board_member_type(v_uid, p_flight, p_date);
  IF v_type IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'writable', false, 'member_type', NULL, 'my_alias', NULL, 'posts', '[]'::jsonb);
  END IF;
  SELECT public.flight_board_alias_label(v_type, alias_no) INTO v_alias FROM public.flight_board_aliases
   WHERE flight_number = p_flight AND flight_date = p_date AND member_type = v_type AND user_id = v_uid;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id, 'alias', p.alias, 'content', p.content, 'created_at', p.created_at,
           'mine', (p.user_id = v_uid), 'deletable', (p.user_id = v_uid OR v_admin),
           'comments', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'id', c.id, 'alias', c.alias, 'content', c.content, 'created_at', c.created_at,
                       'mine', (c.user_id = v_uid), 'deletable', (c.user_id = v_uid OR v_admin),
                       'is_private', c.is_private,
                       'parent_id', pa.id, 'parent_alias', pa.alias
                     ) ORDER BY c.created_at, c.id)
                FROM public.flight_post_comments c
                LEFT JOIN LATERAL (
                  SELECT pc.id, pc.alias FROM public.flight_post_comments pc
                   WHERE pc.id = c.parent_id AND NOT public.flight_board_hidden(v_uid, pc.user_id, p_flight, p_date)
                ) pa ON TRUE
               WHERE c.post_id = p.id
                 AND NOT public.flight_board_hidden(v_uid, c.user_id, p_flight, p_date)
                 AND (NOT c.is_private OR v_admin OR c.user_id = v_uid OR p.user_id = v_uid OR COALESCE(c.reply_to_user_id = v_uid, FALSE))
           ), '[]'::jsonb)
         ) ORDER BY p.created_at DESC, p.id), '[]'::jsonb)
    INTO v_posts
    FROM (SELECT fp.* FROM public.flight_posts fp
           WHERE fp.flight_number = p_flight AND fp.flight_date = p_date AND fp.member_type = v_type
             AND NOT public.flight_board_hidden(v_uid, fp.user_id, p_flight, p_date)
           ORDER BY fp.created_at DESC, fp.id LIMIT 200) p;

  RETURN jsonb_build_object('eligible', true, 'writable', public.flight_board_writable(p_date),
                            'member_type', v_type, 'my_alias', v_alias, 'posts', v_posts);
END $$;
REVOKE ALL ON FUNCTION public.flight_board_list(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flight_board_list(text, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.flight_board_post(p_flight text, p_date date, p_content text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_type text; v_id uuid; v_alias text; v_body text := btrim(COALESCE(p_content, ''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF v_body = '' OR length(v_body) > 1000 THEN RAISE EXCEPTION 'BAD_CONTENT'; END IF;
  v_type := public.flight_board_member_type(v_uid, p_flight, p_date);
  IF v_type IS NULL THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;
  IF NOT public.flight_board_writable(p_date) THEN RAISE EXCEPTION 'BOARD_CLOSED'; END IF;
  v_alias := public.flight_board_alias(v_uid, p_flight, p_date, v_type);
  INSERT INTO public.flight_posts (flight_number, flight_date, member_type, user_id, author_name, alias, content)
  VALUES (p_flight, p_date, v_type, v_uid, NULL, v_alias, v_body)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.flight_board_post(text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flight_board_post(text, date, text) TO authenticated;

-- 댓글: 전역 blocks 는 보지 않는다(차단 여부로 글쓴이를 되짚는 오라클이 되므로). 비밀 부모에는 그걸 볼 수 있는 사람만 답글.
CREATE OR REPLACE FUNCTION public.flight_board_comment(p_post_id uuid, p_content text, p_private boolean DEFAULT false, p_parent_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_post public.flight_posts%ROWTYPE;
  v_parent public.flight_post_comments%ROWTYPE;
  v_type text; v_id uuid; v_alias text;
  v_body text := btrim(COALESCE(p_content, ''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF v_body = '' OR length(v_body) > 500 THEN RAISE EXCEPTION 'BAD_CONTENT'; END IF;
  SELECT * INTO v_post FROM public.flight_posts WHERE id = p_post_id;
  IF v_post.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_type := public.flight_board_member_type(v_uid, v_post.flight_number, v_post.flight_date);
  IF v_type IS NULL OR v_type <> v_post.member_type THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;
  IF NOT public.flight_board_writable(v_post.flight_date) THEN RAISE EXCEPTION 'BOARD_CLOSED'; END IF;
  IF p_parent_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM public.flight_post_comments WHERE id = p_parent_id;
    IF v_parent.id IS NULL OR v_parent.post_id <> p_post_id THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    -- reply_to_user_id 가 NULL 이면 비교가 NULL 이 돼 IF 가 건너뛰어진다(1차 검증에서 실측) → COALESCE 로 FALSE 고정
    IF v_parent.is_private AND NOT (v_parent.user_id = v_uid OR v_post.user_id = v_uid OR COALESCE(v_parent.reply_to_user_id = v_uid, FALSE)
                                    OR COALESCE(public.is_admin(), FALSE)) THEN
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;
  END IF;
  v_alias := public.flight_board_alias(v_uid, v_post.flight_number, v_post.flight_date, v_post.member_type);
  -- 비밀댓글에 단 답글은 항상 비밀댓글. reply_to_user_id 는 트리거 trg_comment_parent_guard 가 부모 작성자로 채운다.
  INSERT INTO public.flight_post_comments (post_id, user_id, author_name, alias, content, is_private, parent_id)
  VALUES (p_post_id, v_uid, NULL, v_alias, v_body, COALESCE(p_private, false) OR COALESCE(v_parent.is_private, false), p_parent_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.flight_board_comment(uuid, text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flight_board_comment(uuid, text, boolean, uuid) TO authenticated;

-- 삭제: 본인 또는 관리자. 스케줄을 지운 뒤에도 자기 글은 지울 수 있게 게시판 자격은 묻지 않는다.
CREATE OR REPLACE FUNCTION public.flight_board_delete_post(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_n int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  DELETE FROM public.flight_posts WHERE id = p_id AND (user_id = v_uid OR COALESCE(public.is_admin(), FALSE));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;
REVOKE ALL ON FUNCTION public.flight_board_delete_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flight_board_delete_post(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.flight_board_delete_comment(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_n int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  DELETE FROM public.flight_post_comments WHERE id = p_id AND (user_id = v_uid OR COALESCE(public.is_admin(), FALSE));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;
REVOKE ALL ON FUNCTION public.flight_board_delete_comment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flight_board_delete_comment(uuid) TO authenticated;

-- 신고·숨김 대상: 호출자가 그 게시판 회원이고 그 글·댓글을 볼 수 있을 때만 작성자를 돌려준다(클라이언트에는 나가지 않는다).
DROP FUNCTION IF EXISTS public.flight_board_target(uuid, uuid);
CREATE OR REPLACE FUNCTION public.flight_board_target(p_uid uuid, p_post_id uuid, p_comment_id uuid,
                                                      OUT o_target uuid, OUT o_flight text, OUT o_date date)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
DECLARE v_post public.flight_posts%ROWTYPE; v_c public.flight_post_comments%ROWTYPE;
BEGIN
  IF p_uid IS NULL THEN RETURN; END IF;
  IF p_comment_id IS NOT NULL THEN
    SELECT * INTO v_c FROM public.flight_post_comments WHERE id = p_comment_id;
    IF v_c.id IS NULL OR (p_post_id IS NOT NULL AND v_c.post_id <> p_post_id) THEN RETURN; END IF;
    SELECT * INTO v_post FROM public.flight_posts WHERE id = v_c.post_id;
  ELSE
    SELECT * INTO v_post FROM public.flight_posts WHERE id = p_post_id;
  END IF;
  IF v_post.id IS NULL THEN RETURN; END IF;
  IF public.flight_board_member_type(p_uid, v_post.flight_number, v_post.flight_date) IS DISTINCT FROM v_post.member_type THEN RETURN; END IF;
  IF v_c.id IS NOT NULL AND v_c.is_private
     AND NOT (v_c.user_id = p_uid OR v_post.user_id = p_uid OR COALESCE(v_c.reply_to_user_id = p_uid, FALSE) OR COALESCE(public.is_admin(), FALSE)) THEN
    RETURN;
  END IF;
  o_target := COALESCE(v_c.user_id, v_post.user_id);
  o_flight := v_post.flight_number;
  o_date := v_post.flight_date;
END $$;
REVOKE ALL ON FUNCTION public.flight_board_target(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.flight_board_report(p_post_id uuid, p_comment_id uuid, p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); t record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_post_id IS NULL AND p_comment_id IS NULL THEN RAISE EXCEPTION 'BAD_REQUEST'; END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'BAD_REQUEST'; END IF;
  SELECT * INTO t FROM public.flight_board_target(v_uid, p_post_id, p_comment_id);
  IF t.o_target IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF t.o_target = v_uid THEN RAISE EXCEPTION 'SELF_REPORT'; END IF;
  -- reported_user_id 는 관리자 화면(대상자·차단 버튼)이 쓴다. reports 열람은 아래 7) 에서 관리자만으로 좁혔다.
  INSERT INTO public.reports (reporter_id, reported_user_id, post_id, board_type, reason, status)
  VALUES (v_uid, t.o_target, COALESCE(p_comment_id, p_post_id),
          CASE WHEN p_comment_id IS NOT NULL THEN 'flight_comment' ELSE 'flight_board' END,
          left(btrim(p_reason), 500), '대기');
  RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION public.flight_board_report(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flight_board_report(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.flight_board_mute(p_post_id uuid, p_comment_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); t record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO t FROM public.flight_board_target(v_uid, p_post_id, p_comment_id);
  IF t.o_target IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF t.o_target = v_uid THEN RETURN FALSE; END IF;
  INSERT INTO public.flight_board_mutes (user_id, target_user_id, flight_number, flight_date)
  VALUES (v_uid, t.o_target, t.o_flight, t.o_date)
  ON CONFLICT (user_id, target_user_id, flight_number, flight_date) DO NOTHING;
  RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION public.flight_board_mute(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flight_board_mute(uuid, uuid) TO authenticated;

-- 6) 명단 차단: 스케줄은 본인만 읽는다 --------------------------------------------
--    (칭찬매칭은 commendation_matches 와 본인 행만 쓰고 is_public 을 보지 않는다 — 9/6 실측. 공개 예외를 남길 이유가 없다)
DROP POLICY IF EXISTS "Read own or public flights" ON public.flight_schedules;
DROP POLICY IF EXISTS "Read own or public crew flights" ON public.flight_schedules;
DROP POLICY IF EXISTS "Read own flights" ON public.flight_schedules;
CREATE POLICY "Read own flights" ON public.flight_schedules FOR SELECT USING (auth.uid() = user_id);

-- 7) 신고 열람은 관리자만. 신고자가 reported_user_id 를 읽어 익명 작성자를 실명으로 되짚는 경로를 닫는다.
--    (클라이언트 reportApi.create 는 반환행을 요구하지 않도록 같이 고쳤다)
DROP POLICY IF EXISTS "Reporters or admin can read reports" ON public.reports;
DROP POLICY IF EXISTS "Users read own reports" ON public.reports;
DROP POLICY IF EXISTS "Admin reads reports" ON public.reports;
CREATE POLICY "Admin reads reports" ON public.reports FOR SELECT USING (COALESCE(public.is_admin(), FALSE));

-- 8) 쪽지 중단: 새 발송 불가(테이블·기존 정책은 보존), 알림 트리거 제거 --------------
REVOKE INSERT ON public.messages FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_message ON public.messages;

-- 9) 같은 편 게시판 참여 알림: 참여 스위치를 켤 때(INSERT 로 켜짐, 꺼짐→켜짐, 참여 중 편명·날짜 변경), 열린 기간에만,
--    이미 참여한 정지 아닌 회원에게, 이름 없이. 같은 (스케줄, 편명, 날짜)로 이미 알린 사람에겐 다시 보내지 않는다(flight_board_join_notices, 스위치 반복 방지).
--    actor 는 본인 제외·차단 관계 판정에만 쓰이고 저장되지 않는다.
CREATE OR REPLACE FUNCTION public.trg_notify_same_flight() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
  IF NOT COALESCE(NEW.board_joined, FALSE) OR NEW.user_type NOT IN ('passenger','crew') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.board_joined, FALSE)
     AND OLD.flight_number IS NOT DISTINCT FROM NEW.flight_number AND OLD.flight_date IS NOT DISTINCT FROM NEW.flight_date THEN
    RETURN NEW;
  END IF;
  IF NOT public.flight_board_writable(NEW.flight_date) THEN RETURN NEW; END IF;
  FOR r IN
    SELECT fs.user_id
      FROM public.flight_schedules fs
      JOIN public.profiles pr ON pr.id = fs.user_id
     WHERE fs.flight_number = NEW.flight_number AND fs.flight_date = NEW.flight_date
       AND fs.user_type = NEW.user_type AND fs.user_id <> NEW.user_id
       AND COALESCE(fs.board_joined, FALSE) = TRUE
       AND COALESCE(pr.is_banned, FALSE) = FALSE
       AND NOT EXISTS (SELECT 1 FROM public.flight_board_join_notices jn
                        WHERE jn.schedule_id = NEW.id AND jn.flight_number = NEW.flight_number
                          AND jn.flight_date = NEW.flight_date AND jn.receiver_id = fs.user_id)
     GROUP BY fs.user_id
     ORDER BY MIN(fs.created_at)
     LIMIT 50
  LOOP
    INSERT INTO public.flight_board_join_notices (schedule_id, flight_number, flight_date, receiver_id)
    VALUES (NEW.id, NEW.flight_number, NEW.flight_date, r.user_id)
    ON CONFLICT DO NOTHING;
    PERFORM public.notify_user(r.user_id, 'flight', 'flight',
      CASE WHEN NEW.user_type = 'crew' THEN '같은 듀티 게시판에 승무원이 새로 들어왔습니다 (' ELSE '같은 편 게시판에 탑승객이 새로 들어왔습니다 (' END
        || NEW.flight_number || ')',
      '/mypage', NEW.id, NEW.user_id);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify trigger skipped: %', SQLERRM;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.trg_notify_same_flight() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_same_flight ON public.flight_schedules;
CREATE TRIGGER trg_notify_same_flight AFTER INSERT OR UPDATE OF board_joined, flight_number, flight_date ON public.flight_schedules
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_same_flight();

-- 10) 댓글 알림: 글쓴이 + (답글이면) 답글 대상. 본문·작성자 정보는 담지 않는다. 그 게시판에서 내가 숨긴 사람의 댓글은 알리지 않는다.
CREATE OR REPLACE FUNCTION public.trg_notify_flight_post_comment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_post public.flight_posts%ROWTYPE;
BEGIN
  SELECT * INTO v_post FROM public.flight_posts WHERE id = NEW.post_id;
  IF v_post.id IS NULL THEN RETURN NEW; END IF;
  IF NOT public.flight_board_hidden(v_post.user_id, NEW.user_id, v_post.flight_number, v_post.flight_date) THEN
    PERFORM public.notify_user(v_post.user_id, 'comments', 'comment', '같은편 게시판 내 글에 댓글이 달렸습니다', '/mypage', NEW.post_id, NEW.user_id);
  END IF;
  IF NEW.reply_to_user_id IS NOT NULL AND NEW.reply_to_user_id <> v_post.user_id
     AND NOT public.flight_board_hidden(NEW.reply_to_user_id, NEW.user_id, v_post.flight_number, v_post.flight_date) THEN
    PERFORM public.notify_user(NEW.reply_to_user_id, 'comments', 'comment', '같은편 게시판 내 댓글에 답글이 달렸습니다', '/mypage', NEW.post_id, NEW.user_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify trigger skipped: %', SQLERRM;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.trg_notify_flight_post_comment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_flight_post_comment ON public.flight_post_comments;
CREATE TRIGGER trg_notify_flight_post_comment AFTER INSERT ON public.flight_post_comments FOR EACH ROW EXECUTE FUNCTION public.trg_notify_flight_post_comment();

-- 11) Q&A 비밀댓글·답글 ---------------------------------------------------------
ALTER TABLE public.qna_comments ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
ALTER TABLE public.qna_comments ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.qna_comments(id) ON DELETE SET NULL;
ALTER TABLE public.qna_comments ADD COLUMN IF NOT EXISTS reply_to_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 가시성 판정. 같은 테이블을 다시 조회하지 않으므로(답글 대상은 reply_to_user_id 로 굳혀 둠) 정책 재귀가 없다.
DROP POLICY IF EXISTS "Anyone can read comments" ON public.qna_comments;
DROP POLICY IF EXISTS "Read comments" ON public.qna_comments;
DROP POLICY IF EXISTS "Read comments unless private" ON public.qna_comments;
DROP FUNCTION IF EXISTS public.qna_comment_visible(boolean, uuid, uuid, uuid);
CREATE FUNCTION public.qna_comment_visible(p_is_private boolean, p_user_id uuid, p_post_id uuid, p_reply_to uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  -- NULL 비교가 NULL 로 새지 않도록 전체를 COALESCE 로 감싼다(정책·트리거 양쪽에서 확정 boolean 이 필요)
  SELECT COALESCE(
      NOT COALESCE(p_is_private, FALSE)
      OR (auth.uid() IS NOT NULL AND (
            COALESCE(p_user_id = auth.uid(), FALSE)
         OR COALESCE(p_reply_to = auth.uid(), FALSE)
         OR EXISTS (SELECT 1 FROM public.qna_posts p WHERE p.id = p_post_id AND p.user_id = auth.uid())
         OR COALESCE(public.is_admin(), FALSE))), FALSE);
$$;
REVOKE ALL ON FUNCTION public.qna_comment_visible(boolean, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qna_comment_visible(boolean, uuid, uuid, uuid) TO authenticated, anon;
CREATE POLICY "Read comments unless private" ON public.qna_comments FOR SELECT
  USING (public.qna_comment_visible(is_private, user_id, post_id, reply_to_user_id));

-- 답글 규칙(두 댓글 테이블 공용): 부모는 같은 글의 댓글이어야 하고, 비밀댓글에 단 답글은 항상 비밀댓글이며,
-- 답글 대상(reply_to_user_id)은 부모 작성자로 굳힌다. Q&A 는 볼 수 없는 비밀댓글에 답글을 달 수 없다.
CREATE OR REPLACE FUNCTION public.trg_comment_parent_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_post uuid; v_private boolean; v_author uuid; v_reply_to uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id AND NEW.post_id IS NOT DISTINCT FROM OLD.post_id THEN RETURN NEW; END IF;
  IF NEW.parent_id IS NULL THEN NEW.reply_to_user_id := NULL; RETURN NEW; END IF;
  IF NEW.post_id IS NULL OR NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'BAD_PARENT'; END IF;
  EXECUTE format('SELECT post_id, is_private, user_id, reply_to_user_id FROM %I.%I WHERE id = $1', TG_TABLE_SCHEMA, TG_TABLE_NAME)
     INTO v_post, v_private, v_author, v_reply_to USING NEW.parent_id;
  IF v_post IS NULL OR v_post <> NEW.post_id THEN RAISE EXCEPTION 'BAD_PARENT'; END IF;
  IF TG_TABLE_NAME = 'qna_comments' AND NOT COALESCE(public.qna_comment_visible(v_private, v_author, v_post, v_reply_to), FALSE) THEN
    RAISE EXCEPTION 'BAD_PARENT';
  END IF;
  IF COALESCE(v_private, FALSE) THEN NEW.is_private := TRUE; END IF;
  NEW.reply_to_user_id := v_author;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.trg_comment_parent_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_qna_comment_parent_guard ON public.qna_comments;
CREATE TRIGGER trg_qna_comment_parent_guard BEFORE INSERT OR UPDATE OF parent_id, post_id ON public.qna_comments
  FOR EACH ROW EXECUTE FUNCTION public.trg_comment_parent_guard();
DROP TRIGGER IF EXISTS trg_flight_comment_parent_guard ON public.flight_post_comments;
CREATE TRIGGER trg_flight_comment_parent_guard BEFORE INSERT OR UPDATE OF parent_id, post_id ON public.flight_post_comments
  FOR EACH ROW EXECUTE FUNCTION public.trg_comment_parent_guard();

-- Q&A 댓글 알림: 글쓴이 + (답글이면) 답글 대상
CREATE OR REPLACE FUNCTION public.trg_notify_qna_comment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.qna_posts WHERE id = NEW.post_id;
  PERFORM public.notify_user(v_owner, 'comments', 'comment', '내 질문에 새 답변이 달렸습니다', '/qna', NEW.post_id, NEW.user_id);
  IF NEW.reply_to_user_id IS NOT NULL AND (v_owner IS NULL OR NEW.reply_to_user_id <> v_owner) THEN
    PERFORM public.notify_user(NEW.reply_to_user_id, 'comments', 'comment', '내 답변에 답글이 달렸습니다', '/qna', NEW.post_id, NEW.user_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify trigger skipped: %', SQLERRM;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.trg_notify_qna_comment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_qna_comment ON public.qna_comments;
CREATE TRIGGER trg_notify_qna_comment AFTER INSERT ON public.qna_comments FOR EACH ROW EXECUTE FUNCTION public.trg_notify_qna_comment();

-- 확인용 ---------------------------------------------------------------------
-- SELECT proname FROM pg_proc WHERE proname LIKE 'flight_board_%';
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('flight_schedules','qna_comments','reports');
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name IN ('flight_posts','flight_post_comments','messages') AND grantee='authenticated';

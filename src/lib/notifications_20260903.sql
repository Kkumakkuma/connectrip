-- ============================================================================
-- 2026-09-03 앱 안 알림(인앱 알림) — 운영 DB 적용본, 재실행 안전
--  상단 종 아이콘 목록 + 톱니 설정. 푸시 없음(서비스워커 미사용 설계).
--  쓰기는 서버(트리거·RPC)만. 클라이언트는 SELECT/UPDATE(read_at)/DELETE own 만.
-- ============================================================================

-- 1) notifications 확장 ------------------------------------------------------
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link text;
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON public.notifications (user_id, created_at DESC);
-- 키워드 알림은 같은 글에 대해 1건만
CREATE UNIQUE INDEX IF NOT EXISTS notifications_keyword_dedupe_idx
  ON public.notifications (user_id, post_id) WHERE type = 'keyword' AND post_id IS NOT NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Update own notifications" ON public.notifications;
CREATE POLICY "Update own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Delete own notifications" ON public.notifications;
CREATE POLICY "Delete own notifications" ON public.notifications
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
-- 클라이언트 INSERT 정책은 두지 않는다(서버 함수만 쓴다). UPDATE 는 read_at 컬럼만.
-- schema.sql 의 레거시 "System can create notifications"(WITH CHECK true) 는 재실행 시 되살아나므로 명시적으로 제거.
DROP POLICY IF EXISTS "System can create notifications" ON public.notifications;
REVOKE INSERT, UPDATE ON public.notifications FROM PUBLIC, authenticated, anon;
GRANT SELECT, DELETE ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;

-- 2) 알림 설정 ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id      uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  comments     boolean NOT NULL DEFAULT true,   -- 내 질문 답변·같은편 게시판 내 글 댓글
  commendation boolean NOT NULL DEFAULT true,   -- 칭찬매칭 성사·승인·답례품·반려
  flight       boolean NOT NULL DEFAULT true,   -- 같은 항공편 동행 새 등록
  companion    boolean NOT NULL DEFAULT true,   -- 내가 글 올린 지역의 새 동행 글
  keywords     boolean NOT NULL DEFAULT true,   -- 키워드 알림
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prefs select own" ON public.notification_prefs;
CREATE POLICY "prefs select own" ON public.notification_prefs FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "prefs insert own" ON public.notification_prefs;
CREATE POLICY "prefs insert own" ON public.notification_prefs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "prefs update own" ON public.notification_prefs;
CREATE POLICY "prefs update own" ON public.notification_prefs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE ON public.notification_prefs TO authenticated;

-- 3) 내부 함수: 알림 1건 생성(설정·차단·본인 제외·보관 상한) ----------------------
-- p_kind: 'message'(항상) | 'comments' | 'commendation' | 'flight' | 'companion' | 'keywords'
-- (장터는 buyer_id 를 채우는 흐름이 프론트에 없어 이벤트가 없다 → 스위치·트리거 두지 않음, 2026-09-03)
CREATE OR REPLACE FUNCTION public.notify_user(
  p_user uuid, p_kind text, p_type text, p_message text, p_link text, p_post_id uuid DEFAULT NULL, p_actor uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_on boolean := true;
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  IF p_actor IS NOT NULL AND p_actor = p_user THEN RETURN; END IF;            -- 본인 행위
  -- 차단 관계(양방향). is_blocked_with(p_other) 는 auth.uid() 기준 1인자 함수라 트리거 맥락에선 못 쓴다 → 직접 조회.
  IF p_actor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.blocks
     WHERE (blocker_id = p_user AND blocked_id = p_actor) OR (blocker_id = p_actor AND blocked_id = p_user)
  ) THEN RETURN; END IF;
  IF p_kind <> 'message' THEN
    SELECT CASE p_kind
             WHEN 'comments' THEN comments WHEN 'commendation' THEN commendation
             WHEN 'flight' THEN flight
             WHEN 'companion' THEN companion WHEN 'keywords' THEN keywords
             ELSE true END
      INTO v_on FROM public.notification_prefs WHERE user_id = p_user;
    IF v_on IS NOT NULL AND v_on = false THEN RETURN; END IF;                 -- 행 없음 = 기본 켬
  END IF;

  INSERT INTO public.notifications (user_id, type, message, link, post_id)
    VALUES (p_user, p_type, left(p_message, 200), left(p_link, 300), p_post_id)
    ON CONFLICT (user_id, post_id) WHERE type = 'keyword' AND post_id IS NOT NULL DO NOTHING;

  -- 보관 상한 정리는 삽입 경로(팬아웃 트리거)에서 하지 않고 mark_all_notifications_read 에서 본인 것만 한다.
EXCEPTION WHEN OTHERS THEN
  -- 알림은 부가 기능: 어떤 오류도 본업무(쪽지·댓글·매칭 RPC) 트랜잭션을 되돌리지 않는다.
  RAISE WARNING 'notify_user skipped: %', SQLERRM;
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_user(uuid, text, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 4) 트리거 ------------------------------------------------------------------
-- 4-1 Q&A 답변 — ★ 2026-09-06 답글 대상(reply_to_user_id) 알림 추가(flight_board_anon_20260906.sql 과 동일 본문)
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

-- 4-2 같은편 게시판 댓글 — ★ 2026-09-06 답글 대상 알림·게시판 숨김 반영(flight_board_anon_20260906.sql 과 동일 본문)
CREATE OR REPLACE FUNCTION public.trg_notify_flight_post_comment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_post public.flight_posts%ROWTYPE;
BEGIN
  SELECT * INTO v_post FROM public.flight_posts WHERE id = NEW.post_id;
  IF v_post.id IS NULL THEN RETURN NEW; END IF;
  IF NOT public.flight_board_hidden(v_post.user_id, NEW.user_id, v_post.flight_number, v_post.flight_date) THEN
    PERFORM public.notify_user(v_post.user_id, 'comments', 'comment', '같은편 게시판 내 글에 댓글이 달렸습니다', '/mypage?tab=companions', NEW.post_id, NEW.user_id);
  END IF;
  IF NEW.reply_to_user_id IS NOT NULL AND NEW.reply_to_user_id <> v_post.user_id
     AND NOT public.flight_board_hidden(NEW.reply_to_user_id, NEW.user_id, v_post.flight_number, v_post.flight_date) THEN
    PERFORM public.notify_user(NEW.reply_to_user_id, 'comments', 'comment', '같은편 게시판 내 댓글에 답글이 달렸습니다', '/mypage?tab=companions', NEW.post_id, NEW.user_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify trigger skipped: %', SQLERRM;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.trg_notify_flight_post_comment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_flight_post_comment ON public.flight_post_comments;
CREATE TRIGGER trg_notify_flight_post_comment AFTER INSERT ON public.flight_post_comments FOR EACH ROW EXECUTE FUNCTION public.trg_notify_flight_post_comment();

-- 4-3 쪽지(항상) — ★ 2026-09-06 쪽지 기능 중단(flight_board_anon_20260906.sql): 트리거 제거, messages INSERT 권한 회수.
DROP TRIGGER IF EXISTS trg_notify_message ON public.messages;

-- 4-4 칭찬매칭 상태
CREATE OR REPLACE FUNCTION public.trg_notify_commendation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_msg_crew text; v_msg_pass text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  CASE NEW.status
    WHEN 'matched' THEN v_msg_crew := '같은 항공편 승객과 칭찬매칭이 성사됐습니다'; v_msg_pass := '같은 항공편 승무원과 칭찬매칭이 성사됐습니다';
    WHEN 'commendation_submitted' THEN v_msg_crew := '승객이 칭찬 인증을 제출했습니다'; v_msg_pass := NULL;
    WHEN 'verified' THEN v_msg_crew := '칭찬 인증이 승인됐습니다'; v_msg_pass := '칭찬 인증이 승인됐습니다';
    WHEN 'gift_sent' THEN v_msg_crew := '승객에게 답례품이 발송됐습니다'; v_msg_pass := '답례품이 발송됐습니다';
    WHEN 'rejected' THEN v_msg_crew := '칭찬매칭이 반려·취소됐습니다'; v_msg_pass := '칭찬매칭이 반려·취소됐습니다';
    ELSE RETURN NEW;
  END CASE;
  IF v_msg_crew IS NOT NULL THEN
    PERFORM public.notify_user(NEW.crew_user_id, 'commendation', 'commendation', v_msg_crew, '/mypage?tab=commendation', NEW.id, NULL);
  END IF;
  IF v_msg_pass IS NOT NULL THEN
    PERFORM public.notify_user(NEW.passenger_user_id, 'commendation', 'commendation', v_msg_pass, '/mypage?tab=commendation', NEW.id, NULL);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify trigger skipped: %', SQLERRM;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.trg_notify_commendation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_commendation ON public.commendation_matches;
CREATE TRIGGER trg_notify_commendation AFTER INSERT OR UPDATE OF status ON public.commendation_matches FOR EACH ROW EXECUTE FUNCTION public.trg_notify_commendation();

-- 4-5 같은 편 게시판 참여 알림 — ★ 2026-09-06 개편: 참여 스위치를 켤 때 참여자에게만, 이름 없이.
--     (본체는 flight_board_anon_20260906.sql 9). actor 는 차단 관계 판정에만 쓰이고 저장되지 않는다)
CREATE OR REPLACE FUNCTION public.trg_notify_same_flight() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
  IF NOT COALESCE(NEW.board_joined, FALSE) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.board_joined, FALSE) THEN RETURN NEW; END IF;
  FOR r IN
    SELECT DISTINCT fs.user_id FROM public.flight_schedules fs
     WHERE fs.flight_number = NEW.flight_number AND fs.flight_date = NEW.flight_date
       AND fs.user_type = NEW.user_type AND fs.user_id <> NEW.user_id
       AND COALESCE(fs.board_joined, FALSE) = TRUE
     LIMIT 50
  LOOP
    PERFORM public.notify_user(r.user_id, 'flight', 'flight',
      CASE WHEN NEW.user_type = 'crew' THEN '같은 듀티 게시판에 승무원이 새로 들어왔습니다 (' ELSE '같은 편 게시판에 탑승객이 새로 들어왔습니다 (' END
        || NEW.flight_number || ')',
      '/mypage?tab=companions', NEW.id, NEW.user_id);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify trigger skipped: %', SQLERRM;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.trg_notify_same_flight() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_same_flight ON public.flight_schedules;
CREATE TRIGGER trg_notify_same_flight AFTER INSERT OR UPDATE OF board_joined ON public.flight_schedules FOR EACH ROW EXECUTE FUNCTION public.trg_notify_same_flight();

-- 4-6 내가 글 올린 지역의 새 동행 글(최근 90일)
CREATE OR REPLACE FUNCTION public.trg_notify_companion_region() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
  IF NEW.region_id IS NULL THEN RETURN NEW; END IF;
  FOR r IN
    SELECT DISTINCT cp.user_id FROM public.companion_posts cp
     WHERE cp.region_id = NEW.region_id AND cp.user_id <> NEW.user_id
       AND cp.created_at > now() - interval '90 days'
     LIMIT 50
  LOOP
    PERFORM public.notify_user(r.user_id, 'companion', 'companion', '관심 지역에 새 동행 모집 글이 올라왔습니다', '/companion/' || NEW.region_id, NEW.id, NEW.user_id);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify trigger skipped: %', SQLERRM;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.trg_notify_companion_region() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_companion_region ON public.companion_posts;
CREATE TRIGGER trg_notify_companion_region AFTER INSERT ON public.companion_posts FOR EACH ROW EXECUTE FUNCTION public.trg_notify_companion_region();


-- 5) RPC(authenticated) ------------------------------------------------------
-- 키워드 매치는 클라이언트 폴링이 발견하므로 본인 알림만 만들 수 있는 RPC 로 저장(중복은 유니크 인덱스)
CREATE OR REPLACE FUNCTION public.add_keyword_notification(p_post_id uuid, p_post_type text, p_keyword text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := auth.uid(); v_link text; v_region text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_post_id IS NULL OR p_keyword IS NULL OR length(p_keyword) > 50 THEN RAISE EXCEPTION 'bad request'; END IF;
  -- 호출자가 실제로 등록한 키워드여야 한다
  IF NOT EXISTS (SELECT 1 FROM public.user_keywords WHERE user_id = v_me AND keyword = p_keyword) THEN RETURN; END IF;
  -- 글이 실제로 있어야 한다(가짜 UUID 로 알림함 오염 방지). 링크는 서버가 조립한다.
  CASE p_post_type
    WHEN 'qna' THEN
      IF NOT EXISTS (SELECT 1 FROM public.qna_posts WHERE id = p_post_id) THEN RETURN; END IF;
      v_link := '/qna';
    WHEN 'market' THEN
      IF NOT EXISTS (SELECT 1 FROM public.market_listings WHERE id = p_post_id) THEN RETURN; END IF;
      v_link := '/market';
    WHEN 'reviews' THEN
      IF NOT EXISTS (SELECT 1 FROM public.reviews WHERE id = p_post_id) THEN RETURN; END IF;
      v_link := '/reviews';
    WHEN 'destinations' THEN
      SELECT region_id INTO v_region FROM public.destinations WHERE id = p_post_id;
      IF NOT FOUND THEN RETURN; END IF;
      v_link := '/recommend' || COALESCE('/' || v_region, '');
    WHEN 'companion' THEN
      SELECT region_id INTO v_region FROM public.companion_posts WHERE id = p_post_id;
      IF NOT FOUND THEN RETURN; END IF;
      v_link := '/companion' || COALESCE('/' || v_region, '');
    ELSE RAISE EXCEPTION 'bad post type';
  END CASE;
  PERFORM public.notify_user(v_me, 'keywords', 'keyword', '''' || p_keyword || ''' 키워드의 새 글이 올라왔습니다', v_link, p_post_id, NULL);
END; $$;
REVOKE ALL ON FUNCTION public.add_keyword_notification(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_keyword_notification(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  UPDATE public.notifications SET read_at = now() WHERE user_id = auth.uid() AND read_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- 보관 상한: 60일 지난 것, 100건 초과분(본인 것만)
  DELETE FROM public.notifications WHERE user_id = auth.uid() AND created_at < now() - interval '60 days';
  DELETE FROM public.notifications WHERE id IN (
    SELECT id FROM public.notifications WHERE user_id = auth.uid() ORDER BY created_at DESC OFFSET 100
  );
  RETURN v_n;
END; $$;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;

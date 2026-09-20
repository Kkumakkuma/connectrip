-- 같은 편 게시판 새 글 알림 (2026-09-20, 쿠마님 10067·10068: "같은편 게시판에 글이나 답글이 오면 알림")
-- 댓글·답글은 notifications_20260903.sql 의 trg_notify_flight_post_comment 가 이미 보낸다. 새 글만 없었다.
-- 같은 편·같은 날짜·같은 종류(탑승객/승무원) 게시판에 참여(board_joined)한 다른 회원에게 보낸다.
-- 차단·뮤트(flight_board_hidden)·정지 회원 제외, 마감된 게시판(flight_board_writable) 제외, 최대 50명.
-- 종류 'flight' — notification_prefs.flight 로 끌 수 있다(합류 알림과 같은 스위치).
CREATE OR REPLACE FUNCTION public.trg_notify_flight_post() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
  IF NOT public.flight_board_writable(NEW.flight_date) THEN RETURN NEW; END IF;
  FOR r IN
    SELECT fs.user_id
      FROM public.flight_schedules fs
      JOIN public.profiles pr ON pr.id = fs.user_id
     WHERE fs.flight_number = NEW.flight_number AND fs.flight_date = NEW.flight_date
       AND fs.user_type = NEW.member_type AND fs.user_id <> NEW.user_id
       AND COALESCE(fs.board_joined, FALSE) = TRUE
       AND COALESCE(pr.is_banned, FALSE) = FALSE
       AND NOT public.flight_board_hidden(fs.user_id, NEW.user_id, NEW.flight_number, NEW.flight_date)
     GROUP BY fs.user_id
     ORDER BY MIN(fs.created_at)
     LIMIT 50
  LOOP
    PERFORM public.notify_user(r.user_id, 'flight', 'flight',
      CASE WHEN NEW.member_type = 'crew' THEN '같은 듀티 게시판에 새 글이 올라왔습니다 (' ELSE '같은 편 게시판에 새 글이 올라왔습니다 (' END
        || NEW.flight_number || ')',
      '/mypage', NEW.id, NEW.user_id);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify trigger skipped: %', SQLERRM;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.trg_notify_flight_post() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_flight_post ON public.flight_posts;
CREATE TRIGGER trg_notify_flight_post AFTER INSERT ON public.flight_posts FOR EACH ROW EXECUTE FUNCTION public.trg_notify_flight_post();

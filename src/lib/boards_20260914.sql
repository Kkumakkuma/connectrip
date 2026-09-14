-- ============================================================
-- 2026-09-14 밤 게시판 정비 (쿠마님 9612·9618)
--   1. 동행 게시판 모집 상태(status: open/closed) — 글쓴이가 "모집완료"로 전환, 목록 배지
--   2. 여행 후기 댓글(review_comments) — Q&A 댓글과 같은 구조(답글·비밀댓글·삭제·알림)
--   3. 1:1 대화 나가기(chat_rooms.lo_left_at/hi_left_at + chat_leave) — 나간 방은 목록에서 빠지고,
--      상대가 새 메시지를 보내면 다시 나타난다. 다시 열면(chat_open) 나간 표시가 풀린다. 나간 뒤의 메시지만 보인다.
-- 멱등. Supabase MCP apply_migration 으로 운영 적용.
-- ============================================================

-- ---------- 1. 동행 모집 상태 ----------
ALTER TABLE public.companion_posts ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';
ALTER TABLE public.companion_posts DROP CONSTRAINT IF EXISTS companion_posts_status_check;
ALTER TABLE public.companion_posts ADD CONSTRAINT companion_posts_status_check CHECK (status IN ('open', 'closed'));

-- ---------- 2. 후기 댓글 ----------
CREATE TABLE IF NOT EXISTS public.review_comments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id          uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_name      text,
  content          text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000),
  is_private       boolean NOT NULL DEFAULT false,
  parent_id        uuid REFERENCES public.review_comments(id) ON DELETE CASCADE,
  reply_to_user_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_comments_post ON public.review_comments (post_id, created_at);
ALTER TABLE public.review_comments ENABLE ROW LEVEL SECURITY;

-- 비밀댓글 가시성: 공개 댓글은 누구나, 비밀댓글은 쓴 사람·답글 대상·글쓴이·관리자만 (qna_comment_visible 과 동일 규칙)
CREATE OR REPLACE FUNCTION public.review_comment_visible(p_is_private boolean, p_user_id uuid, p_post_id uuid, p_reply_to uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
      NOT COALESCE(p_is_private, FALSE)
      OR (auth.uid() IS NOT NULL AND (
            COALESCE(p_user_id = auth.uid(), FALSE)
         OR COALESCE(p_reply_to = auth.uid(), FALSE)
         OR EXISTS (SELECT 1 FROM public.reviews p WHERE p.id = p_post_id AND p.user_id = auth.uid())
         OR COALESCE(public.is_admin(), FALSE))), FALSE);
$$;

DROP POLICY IF EXISTS "Read review comments unless private" ON public.review_comments;
CREATE POLICY "Read review comments unless private" ON public.review_comments FOR SELECT
  USING (public.review_comment_visible(is_private, user_id, post_id, reply_to_user_id));
DROP POLICY IF EXISTS "Create review comments" ON public.review_comments;
-- is_banned 서브쿼리는 넣지 않는다 — authenticated 는 profiles.is_banned 를 SELECT 할 수 없어(컬럼 잠금) 42501 로 INSERT 가 막힌다(운영 실측).
CREATE POLICY "Create review comments" ON public.review_comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Delete review comments" ON public.review_comments;
CREATE POLICY "Delete review comments" ON public.review_comments FOR DELETE USING (auth.uid() = user_id);
GRANT SELECT ON public.review_comments TO anon, authenticated;
GRANT INSERT, DELETE ON public.review_comments TO authenticated;

-- 답글 부모 검사: 공용 트리거 함수를 후기 댓글도 알게 확장(부모가 같은 글인지, 비밀 답글 상속, reply_to_user_id 확정)
CREATE OR REPLACE FUNCTION public.trg_comment_parent_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  IF TG_TABLE_NAME = 'review_comments' AND NOT COALESCE(public.review_comment_visible(v_private, v_author, v_post, v_reply_to), FALSE) THEN
    RAISE EXCEPTION 'BAD_PARENT';
  END IF;
  IF COALESCE(v_private, FALSE) THEN NEW.is_private := TRUE; END IF;
  NEW.reply_to_user_id := v_author;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_review_comment_parent_guard ON public.review_comments;
CREATE TRIGGER trg_review_comment_parent_guard BEFORE INSERT OR UPDATE ON public.review_comments
  FOR EACH ROW EXECUTE FUNCTION public.trg_comment_parent_guard();

-- 알림: 글쓴이에게 "내 후기에 댓글", 답글 대상에게 "내 댓글에 답글" (Q&A 와 동일 채널 'comments')
CREATE OR REPLACE FUNCTION public.trg_notify_review_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.reviews WHERE id = NEW.post_id;
  PERFORM public.notify_user(v_owner, 'comments', 'comment', '내 후기에 새 댓글이 달렸습니다', '/qna', NEW.post_id, NEW.user_id);
  IF NEW.reply_to_user_id IS NOT NULL AND (v_owner IS NULL OR NEW.reply_to_user_id <> v_owner) THEN
    PERFORM public.notify_user(NEW.reply_to_user_id, 'comments', 'comment', '내 댓글에 답글이 달렸습니다', '/qna', NEW.post_id, NEW.user_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify trigger skipped: %', SQLERRM;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_review_comment ON public.review_comments;
CREATE TRIGGER trg_notify_review_comment AFTER INSERT ON public.review_comments
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_review_comment();

-- ---------- 2-b. 자유게시판 (쿠마님 9619) — qna_posts 를 board 컬럼으로 나눠 쓴다. 댓글·좋아요·알림 인프라 그대로 ----------
ALTER TABLE public.qna_posts ADD COLUMN IF NOT EXISTS board text NOT NULL DEFAULT 'qna';
ALTER TABLE public.qna_posts DROP CONSTRAINT IF EXISTS qna_posts_board_check;
ALTER TABLE public.qna_posts ADD CONSTRAINT qna_posts_board_check CHECK (board IN ('qna', 'free'));
CREATE INDEX IF NOT EXISTS idx_qna_posts_board_created ON public.qna_posts (board, created_at DESC);

-- ---------- 3. 대화 나가기 ----------
ALTER TABLE public.chat_rooms ADD COLUMN IF NOT EXISTS lo_left_at timestamptz;
ALTER TABLE public.chat_rooms ADD COLUMN IF NOT EXISTS hi_left_at timestamptz;

CREATE OR REPLACE FUNCTION public.chat_leave(p_room uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  UPDATE public.chat_rooms
     SET lo_left_at = CASE WHEN user_lo = v_uid THEN now() ELSE lo_left_at END,
         hi_left_at = CASE WHEN user_hi = v_uid THEN now() ELSE hi_left_at END
   WHERE id = p_room AND v_uid IN (user_lo, user_hi);
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.chat_leave(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_leave(uuid) TO authenticated;

-- 목록: 내가 나간 방은 그 뒤에 새 메시지가 없으면 숨긴다
CREATE OR REPLACE FUNCTION public.chat_rooms_list()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'kind', r.kind, 'listing_id', r.listing_id, 'created_at', r.created_at,
           'last_message', r.last_message, 'last_message_at', r.last_message_at,
           'other_id', o.id, 'other_name', COALESCE(o.nickname, o.name, '탈퇴한 회원'), 'other_avatar', o.avatar_url,
           'other_crew', COALESCE(o.user_type = 'crew' AND o.crew_verified, FALSE),
           'listing_title', l.title, 'listing_image', COALESCE(l.image_urls[1], l.image_url), 'listing_price', l.price, 'listing_type', l.type, 'listing_status', l.status,
           'unread', (SELECT count(*) FROM public.chat_messages m
                       WHERE m.room_id = r.id AND m.sender_id <> auth.uid()
                         AND m.created_at > CASE WHEN r.user_lo = auth.uid() THEN r.lo_last_read_at ELSE r.hi_last_read_at END
                         AND m.created_at > COALESCE(CASE WHEN r.user_lo = auth.uid() THEN r.lo_left_at ELSE r.hi_left_at END, '-infinity'::timestamptz)),
           'blocked_by_me', EXISTS (SELECT 1 FROM public.blocks b WHERE b.blocker_id = auth.uid() AND b.blocked_id = o.id),
           'blocked', public.chat_blocked(auth.uid(), o.id)
         ) ORDER BY r.last_message_at DESC), '[]'::jsonb)
    FROM public.chat_rooms r
    LEFT JOIN public.profiles o ON o.id = CASE WHEN r.user_lo = auth.uid() THEN r.user_hi ELSE r.user_lo END
    LEFT JOIN public.market_listings l ON l.id = r.listing_id
   WHERE auth.uid() IS NOT NULL AND auth.uid() IN (r.user_lo, r.user_hi)
     AND r.last_message_at > COALESCE(CASE WHEN r.user_lo = auth.uid() THEN r.lo_left_at ELSE r.hi_left_at END, '-infinity'::timestamptz);
$$;

-- 방 정보: 내가 나간 시각(my_left_at) 추가 — 화면은 그 뒤 메시지만 보여준다
CREATE OR REPLACE FUNCTION public.chat_room_info(p_room uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
           'id', r.id, 'kind', r.kind, 'listing_id', r.listing_id,
           'other_id', o.id, 'other_name', COALESCE(o.nickname, o.name, '탈퇴한 회원'), 'other_avatar', o.avatar_url,
           'other_crew', COALESCE(o.user_type = 'crew' AND o.crew_verified, FALSE),
           'listing_title', l.title, 'listing_image', COALESCE(l.image_urls[1], l.image_url), 'listing_price', l.price, 'listing_type', l.type, 'listing_status', l.status,
           'listing_seller', l.user_id,
           'blocked_by_me', EXISTS (SELECT 1 FROM public.blocks b WHERE b.blocker_id = auth.uid() AND b.blocked_id = o.id),
           'blocked', public.chat_blocked(auth.uid(), o.id),
           'my_left_at', CASE WHEN r.user_lo = auth.uid() THEN r.lo_left_at ELSE r.hi_left_at END
         )
    FROM public.chat_rooms r
    LEFT JOIN public.profiles o ON o.id = CASE WHEN r.user_lo = auth.uid() THEN r.user_hi ELSE r.user_lo END
    LEFT JOIN public.market_listings l ON l.id = r.listing_id
   WHERE r.id = p_room AND auth.uid() IS NOT NULL AND auth.uid() IN (r.user_lo, r.user_hi);
$$;

-- 방 열기(chat_open)는 나간 표시를 풀지 않는다(codex 지적 반영). 나간 시각은 "그 뒤 메시지만 보인다"의 경계로 계속 쓰이고,
-- 내가 다시 메시지를 보내거나 상대가 보내면 last_message_at 이 경계를 넘어 목록에 다시 나타난다.
-- (첫 적용 때 chat_open 에 left_at 을 지우는 UPDATE 를 넣었다가 되돌렸다 — 아래 4-b)

-- ---------- 4. codex 종합 검토 반영 (2026-09-15) ----------
-- 4-a. 전체 미읽음 배지도 나간 시각 이후만 센다(방 목록 숫자와 일치)
CREATE OR REPLACE FUNCTION public.chat_unread_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(sum((SELECT count(*) FROM public.chat_messages m
                        WHERE m.room_id = r.id AND m.sender_id <> auth.uid()
                          AND m.created_at > CASE WHEN r.user_lo = auth.uid() THEN r.lo_last_read_at ELSE r.hi_last_read_at END
                          AND m.created_at > COALESCE(CASE WHEN r.user_lo = auth.uid() THEN r.lo_left_at ELSE r.hi_left_at END, '-infinity'::timestamptz))), 0)::int
    FROM public.chat_rooms r
   WHERE auth.uid() IS NOT NULL AND auth.uid() IN (r.user_lo, r.user_hi);
$$;

-- 4-b. chat_open 에서 left_at 을 지우던 UPDATE 제거(원래 본문으로 복원)
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.chat_open(uuid, uuid)'::regprocedure);
  IF position('lo_left_at' IN v_def) = 0 THEN
    RAISE NOTICE 'chat_open: nothing to revert';
    RETURN;
  END IF;
  v_def := regexp_replace(v_def, E'\\s*UPDATE public\\.chat_rooms SET lo_left_at = CASE WHEN user_lo = v_uid THEN NULL ELSE lo_left_at END,\\s*hi_left_at = CASE WHEN user_hi = v_uid THEN NULL ELSE hi_left_at END\\s*WHERE id = v_id;', '');
  IF position('lo_left_at' IN v_def) > 0 THEN RAISE EXCEPTION 'chat_open revert failed'; END IF;
  EXECUTE v_def;
END $$;

-- 4-c. 댓글 알림 링크를 글 상세로(후기 /post/review/:id, Q&A·자유 /post/:board/:id)
CREATE OR REPLACE FUNCTION public.trg_notify_review_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_owner uuid; v_link text;
BEGIN
  SELECT user_id INTO v_owner FROM public.reviews WHERE id = NEW.post_id;
  v_link := '/post/review/' || NEW.post_id::text;
  PERFORM public.notify_user(v_owner, 'comments', 'comment', '내 후기에 새 댓글이 달렸습니다', v_link, NEW.post_id, NEW.user_id);
  IF NEW.reply_to_user_id IS NOT NULL AND (v_owner IS NULL OR NEW.reply_to_user_id <> v_owner) THEN
    PERFORM public.notify_user(NEW.reply_to_user_id, 'comments', 'comment', '내 댓글에 답글이 달렸습니다', v_link, NEW.post_id, NEW.user_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify trigger skipped: %', SQLERRM;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_notify_qna_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_owner uuid; v_board text; v_link text;
BEGIN
  SELECT user_id, COALESCE(board, 'qna') INTO v_owner, v_board FROM public.qna_posts WHERE id = NEW.post_id;
  v_link := '/post/' || COALESCE(v_board, 'qna') || '/' || NEW.post_id::text;
  PERFORM public.notify_user(v_owner, 'comments', 'comment',
    CASE WHEN v_board = 'free' THEN '내 글에 새 댓글이 달렸습니다' ELSE '내 질문에 새 답변이 달렸습니다' END, v_link, NEW.post_id, NEW.user_id);
  IF NEW.reply_to_user_id IS NOT NULL AND (v_owner IS NULL OR NEW.reply_to_user_id <> v_owner) THEN
    PERFORM public.notify_user(NEW.reply_to_user_id, 'comments', 'comment',
      CASE WHEN v_board = 'free' THEN '내 댓글에 답글이 달렸습니다' ELSE '내 답변에 답글이 달렸습니다' END, v_link, NEW.post_id, NEW.user_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify trigger skipped: %', SQLERRM;
  RETURN NEW;
END; $$;

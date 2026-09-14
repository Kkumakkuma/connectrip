-- ============================================================
-- 2026-09-15 동행·CREW 전용·승무원 추천지 댓글 (쿠마님 9638 "동행 게시판에 댓글이 없으면 누가 간다고 어떻게 쓰냐")
-- review_comments(boards_20260914.sql) 와 같은 구조를 세 게시판에 만든다: 답글·비밀댓글·본인 삭제·글쓴이/답글 대상 알림.
-- 멱등. Supabase MCP apply_migration 으로 운영 적용.
-- ============================================================

-- 부모 검사 트리거를 게시판 이름으로 일반화: <t>_comments → <t>_comment_visible(is_private, user_id, post_id, reply_to)
CREATE OR REPLACE FUNCTION public.trg_comment_parent_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_post uuid; v_private boolean; v_author uuid; v_reply_to uuid; v_fn text; v_ok boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id AND NEW.post_id IS NOT DISTINCT FROM OLD.post_id THEN RETURN NEW; END IF;
  IF NEW.parent_id IS NULL THEN NEW.reply_to_user_id := NULL; RETURN NEW; END IF;
  IF NEW.post_id IS NULL OR NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'BAD_PARENT'; END IF;
  EXECUTE format('SELECT post_id, is_private, user_id, reply_to_user_id FROM %I.%I WHERE id = $1', TG_TABLE_SCHEMA, TG_TABLE_NAME)
     INTO v_post, v_private, v_author, v_reply_to USING NEW.parent_id;
  IF v_post IS NULL OR v_post <> NEW.post_id THEN RAISE EXCEPTION 'BAD_PARENT'; END IF;
  v_fn := regexp_replace(TG_TABLE_NAME, '_comments$', '_comment_visible');
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = v_fn) THEN
    EXECUTE format('SELECT public.%I($1, $2, $3, $4)', v_fn) INTO v_ok USING v_private, v_author, v_post, v_reply_to;
    IF NOT COALESCE(v_ok, FALSE) THEN RAISE EXCEPTION 'BAD_PARENT'; END IF;
  END IF;
  IF COALESCE(v_private, FALSE) THEN NEW.is_private := TRUE; END IF;
  NEW.reply_to_user_id := v_author;
  RETURN NEW;
END; $$;

-- 댓글 알림 공용: TG_ARGV = (글 테이블, 게시판 키, 글쓴이 문구, 답글 대상 문구)
CREATE OR REPLACE FUNCTION public.trg_notify_board_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_owner uuid; v_link text;
BEGIN
  EXECUTE format('SELECT user_id FROM public.%I WHERE id = $1', TG_ARGV[0]) INTO v_owner USING NEW.post_id;
  v_link := '/post/' || TG_ARGV[1] || '/' || NEW.post_id::text;
  PERFORM public.notify_user(v_owner, 'comments', 'comment', TG_ARGV[2], v_link, NEW.post_id, NEW.user_id);
  IF NEW.reply_to_user_id IS NOT NULL AND (v_owner IS NULL OR NEW.reply_to_user_id <> v_owner) THEN
    PERFORM public.notify_user(NEW.reply_to_user_id, 'comments', 'comment', TG_ARGV[3], v_link, NEW.post_id, NEW.user_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify trigger skipped: %', SQLERRM;
  RETURN NEW;
END; $$;

-- ---------- 동행 ----------
CREATE TABLE IF NOT EXISTS public.companion_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.companion_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_name text, content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000),
  is_private boolean NOT NULL DEFAULT false,
  parent_id uuid REFERENCES public.companion_comments(id) ON DELETE CASCADE,
  reply_to_user_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_companion_comments_post ON public.companion_comments (post_id, created_at);
ALTER TABLE public.companion_comments ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.companion_comment_visible(p_is_private boolean, p_user_id uuid, p_post_id uuid, p_reply_to uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(NOT COALESCE(p_is_private, FALSE)
      OR (auth.uid() IS NOT NULL AND (COALESCE(p_user_id = auth.uid(), FALSE) OR COALESCE(p_reply_to = auth.uid(), FALSE)
         OR EXISTS (SELECT 1 FROM public.companion_posts p WHERE p.id = p_post_id AND p.user_id = auth.uid())
         OR COALESCE(public.is_admin(), FALSE))), FALSE);
$$;
DROP POLICY IF EXISTS "Read companion comments unless private" ON public.companion_comments;
CREATE POLICY "Read companion comments unless private" ON public.companion_comments FOR SELECT USING (public.companion_comment_visible(is_private, user_id, post_id, reply_to_user_id));
DROP POLICY IF EXISTS "Create companion comments" ON public.companion_comments;
CREATE POLICY "Create companion comments" ON public.companion_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Delete companion comments" ON public.companion_comments;
CREATE POLICY "Delete companion comments" ON public.companion_comments FOR DELETE USING (auth.uid() = user_id);
GRANT SELECT ON public.companion_comments TO anon, authenticated;
GRANT INSERT, DELETE ON public.companion_comments TO authenticated;
DROP TRIGGER IF EXISTS trg_companion_comment_parent_guard ON public.companion_comments;
CREATE TRIGGER trg_companion_comment_parent_guard BEFORE INSERT OR UPDATE ON public.companion_comments FOR EACH ROW EXECUTE FUNCTION public.trg_comment_parent_guard();
DROP TRIGGER IF EXISTS trg_notify_companion_comment ON public.companion_comments;
CREATE TRIGGER trg_notify_companion_comment AFTER INSERT ON public.companion_comments FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_board_comment('companion_posts', 'companion', '내 동행 모집글에 새 댓글이 달렸습니다', '내 댓글에 답글이 달렸습니다');

-- ---------- CREW 전용 ----------
CREATE TABLE IF NOT EXISTS public.crew_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.crew_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_name text, content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000),
  is_private boolean NOT NULL DEFAULT false,
  parent_id uuid REFERENCES public.crew_comments(id) ON DELETE CASCADE,
  reply_to_user_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crew_comments_post ON public.crew_comments (post_id, created_at);
ALTER TABLE public.crew_comments ENABLE ROW LEVEL SECURITY;
-- CREW 전용 글은 승무원만 보므로 댓글도 인증 승무원(또는 관리자)만 읽고 쓴다
CREATE OR REPLACE FUNCTION public.crew_comment_visible(p_is_private boolean, p_user_id uuid, p_post_id uuid, p_reply_to uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(auth.uid() IS NOT NULL
      AND (COALESCE(public.is_admin(), FALSE) OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.user_type = 'crew' AND COALESCE(pr.crew_verified, FALSE) = TRUE))
      AND (NOT COALESCE(p_is_private, FALSE)
        OR COALESCE(p_user_id = auth.uid(), FALSE) OR COALESCE(p_reply_to = auth.uid(), FALSE)
        OR EXISTS (SELECT 1 FROM public.crew_posts p WHERE p.id = p_post_id AND p.user_id = auth.uid())
        OR COALESCE(public.is_admin(), FALSE)), FALSE);
$$;
DROP POLICY IF EXISTS "Read crew comments" ON public.crew_comments;
CREATE POLICY "Read crew comments" ON public.crew_comments FOR SELECT USING (public.crew_comment_visible(is_private, user_id, post_id, reply_to_user_id));
DROP POLICY IF EXISTS "Create crew comments" ON public.crew_comments;
CREATE POLICY "Create crew comments" ON public.crew_comments FOR INSERT
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.user_type = 'crew' AND COALESCE(pr.crew_verified, FALSE) = TRUE));
DROP POLICY IF EXISTS "Delete crew comments" ON public.crew_comments;
CREATE POLICY "Delete crew comments" ON public.crew_comments FOR DELETE USING (auth.uid() = user_id);
GRANT SELECT, INSERT, DELETE ON public.crew_comments TO authenticated;
DROP TRIGGER IF EXISTS trg_crew_comment_parent_guard ON public.crew_comments;
CREATE TRIGGER trg_crew_comment_parent_guard BEFORE INSERT OR UPDATE ON public.crew_comments FOR EACH ROW EXECUTE FUNCTION public.trg_comment_parent_guard();
DROP TRIGGER IF EXISTS trg_notify_crew_comment ON public.crew_comments;
CREATE TRIGGER trg_notify_crew_comment AFTER INSERT ON public.crew_comments FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_board_comment('crew_posts', 'crew', '내 글에 새 댓글이 달렸습니다', '내 댓글에 답글이 달렸습니다');

-- ---------- 승무원 추천지 ----------
CREATE TABLE IF NOT EXISTS public.destination_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_name text, content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000),
  is_private boolean NOT NULL DEFAULT false,
  parent_id uuid REFERENCES public.destination_comments(id) ON DELETE CASCADE,
  reply_to_user_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_destination_comments_post ON public.destination_comments (post_id, created_at);
ALTER TABLE public.destination_comments ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.destination_comment_visible(p_is_private boolean, p_user_id uuid, p_post_id uuid, p_reply_to uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(NOT COALESCE(p_is_private, FALSE)
      OR (auth.uid() IS NOT NULL AND (COALESCE(p_user_id = auth.uid(), FALSE) OR COALESCE(p_reply_to = auth.uid(), FALSE)
         OR EXISTS (SELECT 1 FROM public.destinations p WHERE p.id = p_post_id AND p.user_id = auth.uid())
         OR COALESCE(public.is_admin(), FALSE))), FALSE);
$$;
DROP POLICY IF EXISTS "Read destination comments unless private" ON public.destination_comments;
CREATE POLICY "Read destination comments unless private" ON public.destination_comments FOR SELECT USING (public.destination_comment_visible(is_private, user_id, post_id, reply_to_user_id));
DROP POLICY IF EXISTS "Create destination comments" ON public.destination_comments;
CREATE POLICY "Create destination comments" ON public.destination_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Delete destination comments" ON public.destination_comments;
CREATE POLICY "Delete destination comments" ON public.destination_comments FOR DELETE USING (auth.uid() = user_id);
GRANT SELECT ON public.destination_comments TO anon, authenticated;
GRANT INSERT, DELETE ON public.destination_comments TO authenticated;
DROP TRIGGER IF EXISTS trg_destination_comment_parent_guard ON public.destination_comments;
CREATE TRIGGER trg_destination_comment_parent_guard BEFORE INSERT OR UPDATE ON public.destination_comments FOR EACH ROW EXECUTE FUNCTION public.trg_comment_parent_guard();
DROP TRIGGER IF EXISTS trg_notify_destination_comment ON public.destination_comments;
CREATE TRIGGER trg_notify_destination_comment AFTER INSERT ON public.destination_comments FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_board_comment('destinations', 'destination', '내 추천지에 새 댓글이 달렸습니다', '내 댓글에 답글이 달렸습니다');

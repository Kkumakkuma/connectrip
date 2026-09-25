-- 글쓰기 임시저장 v2 (2026-09-25 쿠마님 지시): "임시저장" 버튼으로 서버에 저장하고, 로그인하면 어느 기기에서든
-- 글쓰기 창의 "불러오기"로 골라서 불러온다. 자동 저장·자동 복원은 하지 않는다(v1 localStorage 방식 폐기).
-- 재실행 안전. 운영 적용: 마이그레이션 post_drafts_20260925.
--
-- 규칙(codex·agy 검토 반영)
--   - 본인 행만 읽고 쓰고 지운다(RLS). anon 권한 없음. 수정은 title·data 칼럼만(칼럼 단위 GRANT).
--   - user_id 는 서버가 auth.uid() 로 채운다(트리거가 RLS 보다 먼저 돌므로 넘겨받은 값은 쓰지 않는다).
--   - 수정 때 user_id·board·scope·created_at 은 바뀌지 않고, revision 이 1씩 오른다. 클라이언트는
--     "불러온 revision" 과 같을 때만 고치고(다른 기기에서 먼저 고친 원고를 덮지 않게), 등록 뒤 지울 때도 같다.
--   - id 는 클라이언트가 만들어 보낼 수 있다(저장 응답이 끊겨 다시 누를 때 같은 id 로 재시도 → 중복 생성 방지).
--   - (계정, 게시판, 범위)당 20건·계정 전체 200건. 넘으면 'draft limit …' 로 거절(동시 저장은 계정 단위 advisory lock).
--   - scope 는 같은 편 게시판만 '<편명>:<YYYY-MM-DD>', 나머지는 ''.
--   - 탈퇴: request_account_deletion → DELETE auth.users → profiles CASCADE → post_drafts CASCADE.
--   - 같은 편 게시판 임시저장본은 출발일이 지나면(게시판이 닫히면) 매일 cron 이 지운다. 그 밖엔 자동 만료 없음
--     (보관 기간은 쿠마님이 정하지 않았다 — 회원이 지우거나 탈퇴할 때까지).

CREATE TABLE IF NOT EXISTS public.post_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  board text NOT NULL CHECK (board IN (
    'qna:review', 'qna:qna', 'qna:free', 'companion', 'crew:free', 'crew:layover', 'crew:deals',
    'destination', 'market:sell', 'market:share', 'market:buy', 'market:groupbuy',
    'promo:promotion', 'promo:review', 'flight')),
  scope text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 120),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 30000),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_drafts_scope_chk CHECK (
    (board = 'flight' AND scope ~ '^[A-Z0-9]{2,8}:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    OR (board <> 'flight' AND scope = ''))
);
CREATE INDEX IF NOT EXISTS post_drafts_user_board_idx ON public.post_drafts (user_id, board, scope, updated_at DESC);

ALTER TABLE public.post_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.post_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.post_drafts TO authenticated;
GRANT UPDATE (title, data) ON public.post_drafts TO authenticated;

DROP POLICY IF EXISTS "Own drafts read" ON public.post_drafts;
DROP POLICY IF EXISTS "Own drafts insert" ON public.post_drafts;
DROP POLICY IF EXISTS "Own drafts update" ON public.post_drafts;
DROP POLICY IF EXISTS "Own drafts delete" ON public.post_drafts;
CREATE POLICY "Own drafts read" ON public.post_drafts FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Own drafts insert" ON public.post_drafts FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Own drafts update" ON public.post_drafts FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Own drafts delete" ON public.post_drafts FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 저장 한도·주인 고정. SECURITY DEFINER 라 개수 세기가 RLS 에 가리지 않는다. 넘겨받은 user_id 는 믿지 않는다.
CREATE OR REPLACE FUNCTION public.post_drafts_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  NEW.user_id := v_uid;
  NEW.revision := 1;
  NEW.created_at := now();
  NEW.updated_at := now();
  PERFORM pg_advisory_xact_lock(hashtextextended('post_drafts:' || v_uid::text, 0));
  -- 같은 id 재시도(첫 저장은 성공했는데 응답만 끊긴 경우): 한도 검사보다 먼저 통과시켜 PK 충돌(23505)로 떨어지게 한다
  -- — 한도 20번째에서 응답이 끊겨도 클라이언트가 그 건을 찾아 고칠 수 있다(codex 9/25).
  IF EXISTS (SELECT 1 FROM public.post_drafts WHERE id = NEW.id AND user_id = v_uid) THEN
    RETURN NEW;
  END IF;
  IF (SELECT count(*) FROM public.post_drafts WHERE user_id = v_uid AND board = NEW.board AND scope = NEW.scope) >= 20 THEN
    RAISE EXCEPTION 'draft limit board';
  END IF;
  IF (SELECT count(*) FROM public.post_drafts WHERE user_id = v_uid) >= 200 THEN
    RAISE EXCEPTION 'draft limit total';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.post_drafts_before_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.id := OLD.id;
  NEW.user_id := OLD.user_id;
  NEW.board := OLD.board;
  NEW.scope := OLD.scope;
  NEW.created_at := OLD.created_at;
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := now();
  RETURN NEW;
END; $function$;

REVOKE ALL ON FUNCTION public.post_drafts_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_drafts_before_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS post_drafts_before_insert ON public.post_drafts;
CREATE TRIGGER post_drafts_before_insert BEFORE INSERT ON public.post_drafts
  FOR EACH ROW EXECUTE FUNCTION public.post_drafts_before_insert();
DROP TRIGGER IF EXISTS post_drafts_before_update ON public.post_drafts;
CREATE TRIGGER post_drafts_before_update BEFORE UPDATE ON public.post_drafts
  FOR EACH ROW EXECUTE FUNCTION public.post_drafts_before_update();

-- 같은 편 게시판은 출발일이 지나면 닫힌다(목록에서도 사라져 지울 곳이 없다) → 그 편의 임시저장본을 매일 지운다.
DO $cron$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'drafts-flight-purge';
  PERFORM cron.schedule('drafts-flight-purge', '45 18 * * *', $job$
    DELETE FROM public.post_drafts
    WHERE board = 'flight'
      AND split_part(scope, ':', 2)::date < (now() AT TIME ZONE 'Asia/Seoul')::date
  $job$);
END $cron$;

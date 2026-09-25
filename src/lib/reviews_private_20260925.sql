-- 후기 "나만 보기(비공개)" (2026-09-25 쿠마님 지시: 후기 관련 게시판 전부 공개/비공개 선택)
-- 대상: public.reviews (여행후기 및 Q&A > 여행 후기 탭, 여행상품 홍보 및 후기 > 후기 탭 — 둘 다 이 테이블).
-- 재실행 안전. 운영 적용: 마이그레이션 reviews_private_20260925.
--
-- "나만 보기" = 작성자 본인만. 관리자 예외도 두지 않는다(codex·agy 검토 2026-09-25):
--   - 관리자 계정으로 일반 목록·검색을 보면 남의 비공개 후기가 섞여 보이게 된다.
--   - is_admin() 은 anon 실행 권한이 회수돼 있어(security_optimize_20260611) SELECT 정책에 넣으면
--     비로그인 목록 조회가 권한 오류로 깨질 수 있다.
--   모더레이션이 필요하면 Supabase 대시보드(service_role)로 본다.
--
-- 새는 길을 막는 지점
--   1) reviews SELECT 정책          : 공개 글 / 작성자 본인만
--   2) review_comments INSERT 정책   : 볼 수 있는 후기에만 댓글
--   3) review_comment_visible        : 글이 비공개면 댓글도 글쓴이만 (SECURITY DEFINER 라 RLS 가 안 걸린다)
--   4) trg_notify_review_comment     : 비공개 글에서는 글쓴이 말고는 알림을 안 보낸다(공개 때 댓글 단 사람에게 답글 알림 → 글 존재가 샌다)
--   5) post_likes SELECT 정책        : 비공개 후기의 좋아요 행은 글쓴이만
--   6) toggle_post_like              : SECURITY DEFINER — 비공개 후기는 작성자만 좋아요
--   7) add_keyword_notification      : SECURITY DEFINER — 비공개 후기는 키워드 알림 대상이 아님
-- 홍보 글(type='promotion')은 나만 보기로 만들 수 없다(CHECK).

ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_private_only_review;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_private_only_review CHECK (NOT is_private OR type = 'review');

-- 1) 읽기. 기존 USING(true) 정책 두 개(중복)를 모두 지우고 하나로 둔다.
DROP POLICY IF EXISTS "Anyone can read reviews" ON public.reviews;
DROP POLICY IF EXISTS "Read reviews" ON public.reviews;
DROP POLICY IF EXISTS "Read reviews unless private" ON public.reviews;
CREATE POLICY "Read reviews unless private" ON public.reviews FOR SELECT
  USING (NOT is_private OR user_id = (SELECT auth.uid()));

-- 2) 댓글 쓰기: 볼 수 있는 후기에만.
DROP POLICY IF EXISTS "Create review comments" ON public.review_comments;
CREATE POLICY "Create review comments" ON public.review_comments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.reviews r
      WHERE r.id = post_id
        AND (NOT r.is_private OR r.user_id = auth.uid())
    )
  );

-- 3) 댓글 읽기. 부모 글을 한 번만 읽고, 비공개 글이면 글쓴이만 통과시킨다.
--    공개 글에서는 기존 규칙(비밀댓글 = 댓글 쓴이·답글 대상·글쓴이·관리자) 그대로.
CREATE OR REPLACE FUNCTION public.review_comment_visible(p_is_private boolean, p_user_id uuid, p_post_id uuid, p_reply_to uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((
    SELECT CASE
             WHEN p.is_private THEN (me.uid IS NOT NULL AND p.user_id = me.uid)
             ELSE NOT COALESCE(p_is_private, FALSE)
                  OR (me.uid IS NOT NULL AND (
                        COALESCE(p_user_id = me.uid, FALSE)
                     OR COALESCE(p_reply_to = me.uid, FALSE)
                     OR COALESCE(p.user_id = me.uid, FALSE)
                     OR COALESCE(public.is_admin(), FALSE)))
           END
    FROM public.reviews p, (SELECT auth.uid() AS uid) me
    WHERE p.id = p_post_id
  ), FALSE);
$function$;

-- 4) 댓글 알림. 운영 정의(2026-09-25 실측)를 옮기고 비공개 글 분기만 더한다.
CREATE OR REPLACE FUNCTION public.trg_notify_review_comment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_owner uuid; v_private boolean; v_link text;
BEGIN
  SELECT user_id, is_private INTO v_owner, v_private FROM public.reviews WHERE id = NEW.post_id;
  v_link := '/post/review/' || NEW.post_id::text;
  PERFORM public.notify_user(v_owner, 'comments', 'comment', '내 후기에 새 댓글이 달렸습니다', v_link, NEW.post_id, NEW.user_id);
  -- 나만 보기 글에서는 답글 대상이 글쓴이가 아니면 알리지 않는다(그 사람은 이 글을 볼 수 없다).
  IF NEW.reply_to_user_id IS NOT NULL AND (v_owner IS NULL OR NEW.reply_to_user_id <> v_owner)
     AND NOT COALESCE(v_private, FALSE) THEN
    PERFORM public.notify_user(NEW.reply_to_user_id, 'comments', 'comment', '내 댓글에 답글이 달렸습니다', v_link, NEW.post_id, NEW.user_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify trigger skipped: %', SQLERRM;
  RETURN NEW;
END; $function$;

-- 5) 좋아요 행 읽기: 비공개 후기에 달린 행은 글쓴이만 본다(글 id·활동이 새지 않게).
DROP POLICY IF EXISTS "Anyone can read post_likes" ON public.post_likes;
DROP POLICY IF EXISTS "Read post_likes unless private review" ON public.post_likes;
CREATE POLICY "Read post_likes unless private review" ON public.post_likes FOR SELECT
  USING (
    board_type <> 'reviews'
    OR EXISTS (
      SELECT 1 FROM public.reviews r
      WHERE r.id = post_likes.post_id
        AND (NOT r.is_private OR r.user_id = (SELECT auth.uid()))
    )
  );

-- 6) 좋아요 토글. 운영 정의(2026-09-25 실측)를 그대로 옮기고 비공개 후기 확인만 더한다.
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

  -- 나만 보기 후기(2026-09-25): 작성자가 아니면 없는 글과 같다(좋아요 취소 포함 — 남은 행·개수를 알려주지 않는다)
  if p_board_type = 'reviews' and exists (
    select 1 from public.reviews where id = p_post_id and is_private and user_id is distinct from v_user
  ) then
    raise exception 'post not found';
  end if;

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

-- 7) 키워드 알림. 운영 정의(2026-09-25 실측)를 그대로 옮기고 reviews 분기만 바꾼다.
CREATE OR REPLACE FUNCTION public.add_keyword_notification(p_post_id uuid, p_post_type text, p_keyword text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_me uuid := auth.uid(); v_link text; v_region text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_post_id IS NULL OR p_keyword IS NULL OR length(p_keyword) > 50 THEN RAISE EXCEPTION 'bad request'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_keywords WHERE user_id = v_me AND keyword = p_keyword) THEN RETURN; END IF;
  CASE p_post_type
    WHEN 'qna' THEN IF NOT EXISTS (SELECT 1 FROM public.qna_posts WHERE id = p_post_id) THEN RETURN; END IF; v_link := '/qna';
    WHEN 'market' THEN IF NOT EXISTS (SELECT 1 FROM public.market_listings WHERE id = p_post_id) THEN RETURN; END IF; v_link := '/market';
    WHEN 'reviews' THEN IF NOT EXISTS (SELECT 1 FROM public.reviews WHERE id = p_post_id AND NOT is_private) THEN RETURN; END IF; v_link := '/reviews';
    WHEN 'destinations' THEN SELECT region_id INTO v_region FROM public.destinations WHERE id = p_post_id; IF NOT FOUND THEN RETURN; END IF; v_link := '/recommend' || COALESCE('/' || v_region, '');
    WHEN 'companion' THEN SELECT region_id INTO v_region FROM public.companion_posts WHERE id = p_post_id; IF NOT FOUND THEN RETURN; END IF; v_link := '/companion' || COALESCE('/' || v_region, '');
    WHEN 'itinerary' THEN IF NOT EXISTS (SELECT 1 FROM public.itinerary_posts WHERE id = p_post_id) THEN RETURN; END IF; v_link := '/itinerary/' || p_post_id::text;
    ELSE RAISE EXCEPTION 'bad post type';
  END CASE;
  PERFORM public.notify_user(v_me, 'keywords', 'keyword', '''' || p_keyword || ''' 키워드의 새 글이 올라왔습니다', v_link, p_post_id, NULL);
END; $function$;

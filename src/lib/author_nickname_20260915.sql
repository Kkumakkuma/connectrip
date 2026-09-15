-- ============================================================================
-- ConnectTrip 게시판·댓글 작성자 표시 = 닉네임 전환 (1차, 2026-09-15)
-- ----------------------------------------------------------------------------
-- 목적
--   일반 회원에게 보이는 모든 작성자명을 실명 대신 profiles.nickname 으로 통일한다.
--   닉네임이 없으면 '회원', 쪽지·대화에서 상대 프로필이 없으면 '탈퇴한 회원'.
--   관리자 신고 목록은 is_admin() 으로 막은 RPC(admin_list_reports)로 실명+닉네임 조회.
--
-- 저장 방식 A
--   · BEFORE INSERT OR UPDATE 트리거(zz_author_nickname)가 author_name(장터는 author)을
--     서버에서 항상 닉네임으로 덮어쓴다. 클라이언트가 보낸 값(구버전 앱의 실명 포함)은 무시.
--   · profiles.nickname 이 바뀌면 AFTER UPDATE 트리거(zz_propagate_nickname)가 12개 테이블의
--     해당 회원 행에 전파한다.
--   · 같은 편 익명 게시판(flight_posts, flight_post_comments)은 대상이 아니다.
--
-- 적용
--   · 운영 함수 원본(pg_get_functiondef, 2026-09-15 추출)을 기준으로 RPC 6개를 재정의했다.
--     바뀐 것은 이름 대체값 표현식뿐이고 나머지 로직은 원본 그대로다.
--   · 파일 전체를 한 트랜잭션으로 적용한다(apply_migration 또는 BEGIN; ... COMMIT;).
--     백업 → 트리거 설치 → 이관 사이에 새 글이 끼어들지 않게 하기 위해서다.
--   · 멱등: 다시 실행해도 결과가 같다(백업은 처음 값을 보존).
--   · 이번 1차에는 NICKNAME_REQUIRED 서버 거부와 profiles.name 컬럼 권한 회수가 없다.
--
-- 실측 근거(2026-09-15): 기존 BEFORE 트리거 이름은 전부 trg_ 로 시작 → zz_ 가 가장 뒤에 실행.
--   함수 소유자 postgres 는 rolbypassrls=true → SECURITY DEFINER 함수가 RLS 에 막히지 않는다.
--   public 스키마 기본 ACL 이 새 함수에 anon/authenticated EXECUTE 를 자동 부여 → 명시 REVOKE.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. 전파 UPDATE 용 user_id 인덱스(댓글 4개 테이블에 없었음)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_companion_comments_user_id   ON public.companion_comments (user_id);
CREATE INDEX IF NOT EXISTS idx_crew_comments_user_id        ON public.crew_comments (user_id);
CREATE INDEX IF NOT EXISTS idx_destination_comments_user_id ON public.destination_comments (user_id);
CREATE INDEX IF NOT EXISTS idx_review_comments_user_id      ON public.review_comments (user_id);


-- ----------------------------------------------------------------------------
-- 1. 백업: 이관 전 작성자명 원본 보관(실명이 들어 있을 수 있음 → 외부 접근 전부 차단)
--    보존 기한이 지나면 DROP SCHEMA backup_20260915 CASCADE; 로 삭제한다.
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS backup_20260915;
REVOKE ALL ON SCHEMA backup_20260915 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS backup_20260915.author_names (
  tbl         text        NOT NULL,
  row_id      uuid        NOT NULL,
  user_id     uuid,
  old_value   text,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tbl, row_id)
);
REVOKE ALL ON TABLE backup_20260915.author_names FROM PUBLIC, anon, authenticated;

-- 이미 백업된 행은 건드리지 않는다(재실행해도 최초 원본 유지)
INSERT INTO backup_20260915.author_names (tbl, row_id, user_id, old_value)
SELECT 'companion_posts',       id, user_id, author_name FROM public.companion_posts
UNION ALL SELECT 'qna_posts',             id, user_id, author_name FROM public.qna_posts
UNION ALL SELECT 'qna_comments',          id, user_id, author_name FROM public.qna_comments
UNION ALL SELECT 'crew_posts',            id, user_id, author_name FROM public.crew_posts
UNION ALL SELECT 'reviews',               id, user_id, author_name FROM public.reviews
UNION ALL SELECT 'review_comments',       id, user_id, author_name FROM public.review_comments
UNION ALL SELECT 'companion_comments',    id, user_id, author_name FROM public.companion_comments
UNION ALL SELECT 'crew_comments',         id, user_id, author_name FROM public.crew_comments
UNION ALL SELECT 'destination_comments',  id, user_id, author_name FROM public.destination_comments
UNION ALL SELECT 'planner_place_reviews', id, user_id, author_name FROM public.planner_place_reviews
UNION ALL SELECT 'itinerary_posts',       id, user_id, author_name FROM public.itinerary_posts
UNION ALL SELECT 'market_listings',       id, user_id, author      FROM public.market_listings
ON CONFLICT (tbl, row_id) DO NOTHING;


-- ----------------------------------------------------------------------------
-- 2. 작성자명 강제 트리거
--    user_id NULL·프로필 없음·닉네임 공백 → '회원'
--    TG_TABLE_NAME 으로 author(장터)/author_name 을 나눠 대입한다(없는 필드는 참조하지 않음).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_author_from_nickname()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE v_name text;
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    SELECT NULLIF(btrim(p.nickname), '') INTO v_name FROM public.profiles p WHERE p.id = NEW.user_id;
  END IF;
  v_name := COALESCE(v_name, '회원');
  IF TG_TABLE_NAME = 'market_listings' THEN
    NEW.author := v_name;
  ELSE
    NEW.author_name := v_name;
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.set_author_from_nickname() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_author_nickname ON public.companion_posts;
CREATE TRIGGER zz_author_nickname BEFORE INSERT OR UPDATE ON public.companion_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_author_from_nickname();
DROP TRIGGER IF EXISTS zz_author_nickname ON public.qna_posts;
CREATE TRIGGER zz_author_nickname BEFORE INSERT OR UPDATE ON public.qna_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_author_from_nickname();
DROP TRIGGER IF EXISTS zz_author_nickname ON public.qna_comments;
CREATE TRIGGER zz_author_nickname BEFORE INSERT OR UPDATE ON public.qna_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_author_from_nickname();
DROP TRIGGER IF EXISTS zz_author_nickname ON public.crew_posts;
CREATE TRIGGER zz_author_nickname BEFORE INSERT OR UPDATE ON public.crew_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_author_from_nickname();
DROP TRIGGER IF EXISTS zz_author_nickname ON public.reviews;
CREATE TRIGGER zz_author_nickname BEFORE INSERT OR UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_author_from_nickname();
DROP TRIGGER IF EXISTS zz_author_nickname ON public.review_comments;
CREATE TRIGGER zz_author_nickname BEFORE INSERT OR UPDATE ON public.review_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_author_from_nickname();
DROP TRIGGER IF EXISTS zz_author_nickname ON public.companion_comments;
CREATE TRIGGER zz_author_nickname BEFORE INSERT OR UPDATE ON public.companion_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_author_from_nickname();
DROP TRIGGER IF EXISTS zz_author_nickname ON public.crew_comments;
CREATE TRIGGER zz_author_nickname BEFORE INSERT OR UPDATE ON public.crew_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_author_from_nickname();
DROP TRIGGER IF EXISTS zz_author_nickname ON public.destination_comments;
CREATE TRIGGER zz_author_nickname BEFORE INSERT OR UPDATE ON public.destination_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_author_from_nickname();
DROP TRIGGER IF EXISTS zz_author_nickname ON public.planner_place_reviews;
CREATE TRIGGER zz_author_nickname BEFORE INSERT OR UPDATE ON public.planner_place_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_author_from_nickname();
DROP TRIGGER IF EXISTS zz_author_nickname ON public.itinerary_posts;
CREATE TRIGGER zz_author_nickname BEFORE INSERT OR UPDATE ON public.itinerary_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_author_from_nickname();
DROP TRIGGER IF EXISTS zz_author_nickname ON public.market_listings;
CREATE TRIGGER zz_author_nickname BEFORE INSERT OR UPDATE ON public.market_listings
  FOR EACH ROW EXECUTE FUNCTION public.set_author_from_nickname();


-- ----------------------------------------------------------------------------
-- 3. 닉네임 변경 전파 트리거
--    각 UPDATE 도 위 zz_author_nickname 트리거를 거치므로 값은 같은 규칙으로 다시 계산된다.
--    IS DISTINCT FROM 조건으로 바뀔 행만 건드린다(profiles 를 다시 수정하지 않으므로 재귀 없음).
--    부작용: itinerary_posts·planner_place_reviews 는 touch 트리거로 updated_at 이 갱신된다
--    (여행일정 목록은 created_at 정렬이라 순서 영향 없음).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.propagate_nickname_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE v_name text := COALESCE(NULLIF(btrim(NEW.nickname), ''), '회원');
BEGIN
  IF OLD.nickname IS NOT DISTINCT FROM NEW.nickname THEN
    RETURN NULL;
  END IF;
  UPDATE public.companion_posts       SET author_name = v_name WHERE user_id = NEW.id AND author_name IS DISTINCT FROM v_name;
  UPDATE public.qna_posts             SET author_name = v_name WHERE user_id = NEW.id AND author_name IS DISTINCT FROM v_name;
  UPDATE public.qna_comments          SET author_name = v_name WHERE user_id = NEW.id AND author_name IS DISTINCT FROM v_name;
  UPDATE public.crew_posts            SET author_name = v_name WHERE user_id = NEW.id AND author_name IS DISTINCT FROM v_name;
  UPDATE public.reviews               SET author_name = v_name WHERE user_id = NEW.id AND author_name IS DISTINCT FROM v_name;
  UPDATE public.review_comments       SET author_name = v_name WHERE user_id = NEW.id AND author_name IS DISTINCT FROM v_name;
  UPDATE public.companion_comments    SET author_name = v_name WHERE user_id = NEW.id AND author_name IS DISTINCT FROM v_name;
  UPDATE public.crew_comments         SET author_name = v_name WHERE user_id = NEW.id AND author_name IS DISTINCT FROM v_name;
  UPDATE public.destination_comments  SET author_name = v_name WHERE user_id = NEW.id AND author_name IS DISTINCT FROM v_name;
  UPDATE public.planner_place_reviews SET author_name = v_name WHERE user_id = NEW.id AND author_name IS DISTINCT FROM v_name;
  UPDATE public.itinerary_posts       SET author_name = v_name WHERE user_id = NEW.id AND author_name IS DISTINCT FROM v_name;
  UPDATE public.market_listings       SET author      = v_name WHERE user_id = NEW.id AND author      IS DISTINCT FROM v_name;
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.propagate_nickname_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_propagate_nickname ON public.profiles;
CREATE TRIGGER zz_propagate_nickname AFTER UPDATE OF nickname ON public.profiles
  FOR EACH ROW WHEN (OLD.nickname IS DISTINCT FROM NEW.nickname)
  EXECUTE FUNCTION public.propagate_nickname_change();


-- ----------------------------------------------------------------------------
-- 4. RPC 6개 재정의 (운영 원본 기준, 이름 대체값에서 profiles.name 제거만)
--    원본: scratchpad/nickname/prod_functions_before.sql
-- ----------------------------------------------------------------------------

-- 4-1. 플래너 장소 후기 저장 (원본: COALESCE(NULLIF(nickname,''), NULLIF(name,''), '익명'))
CREATE OR REPLACE FUNCTION public.planner_submit_review(p_catalog_id uuid, p_rating integer, p_body text DEFAULT NULL::text, p_menu text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_me uuid := auth.uid(); v_root uuid; v_visited date; v_name text; v_id uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'bad rating'; END IF;
  IF p_body IS NOT NULL AND length(p_body) > 1000 THEN RAISE EXCEPTION 'body too long'; END IF;
  IF p_menu IS NOT NULL AND length(p_menu) > 200 THEN RAISE EXCEPTION 'menu too long'; END IF;
  v_root := public.planner_catalog_root(p_catalog_id);
  IF v_root IS NULL THEN RAISE EXCEPTION 'unknown place'; END IF;
  SELECT min(visited_at)::date INTO v_visited FROM public.planner_places
   WHERE user_id = v_me AND visited_at IS NOT NULL
     AND catalog_id IN (SELECT public.planner_catalog_group(v_root));
  IF v_visited IS NULL THEN RAISE EXCEPTION 'visit required'; END IF;
  SELECT COALESCE(NULLIF(btrim(nickname), ''), '회원') INTO v_name FROM public.profiles WHERE id = v_me;
  INSERT INTO public.planner_place_reviews (catalog_id, user_id, rating, body, recommended_menu, visited_on, author_name)
  VALUES (v_root, v_me, p_rating, NULLIF(btrim(COALESCE(p_body, '')), ''), NULLIF(btrim(COALESCE(p_menu, '')), ''), v_visited, v_name)
  ON CONFLICT (catalog_id, user_id) DO UPDATE
    SET rating = EXCLUDED.rating, body = EXCLUDED.body, recommended_menu = EXCLUDED.recommended_menu,
        visited_on = EXCLUDED.visited_on, updated_at = now()
  RETURNING id INTO v_id;
  DELETE FROM public.planner_place_reviews r
   WHERE r.user_id = v_me AND r.id <> v_id
     AND r.catalog_id IN (SELECT public.planner_catalog_group(v_root));
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public.planner_submit_review(uuid, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_submit_review(uuid, integer, text, text) TO authenticated, service_role;

-- 4-2. 공유 일정 조회 (anon 도 호출 가능 유지)
CREATE OR REPLACE FUNCTION public.planner_get_shared(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_trip uuid; v_owner uuid; v_snap jsonb; v_name text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT s.trip_id, s.user_id INTO v_trip, v_owner FROM public.planner_shares s
   WHERE s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF v_trip IS NULL THEN RETURN NULL; END IF;
  IF public.planner_rate_hit('share:' || v_trip::text, 120) > 120 THEN RETURN NULL; END IF;
  v_snap := public.planner_build_snapshot(v_trip);
  IF v_snap IS NULL THEN RETURN NULL; END IF;
  SELECT NULLIF(btrim(nickname), '') INTO v_name FROM public.profiles WHERE id = v_owner;
  v_name := COALESCE(v_name, '회원');
  RETURN v_snap || jsonb_build_object('shared', true, 'author_name', v_name);
END $function$;
REVOKE ALL ON FUNCTION public.planner_get_shared(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.planner_get_shared(text) TO anon, authenticated, service_role;

-- 4-3. 플래너 일정을 여행일정 게시판에 게시
CREATE OR REPLACE FUNCTION public.planner_publish_to_board(p_trip_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_me uuid := auth.uid(); v_trip public.planner_trips%ROWTYPE; v_snap jsonb; v_title text; v_name text; v_id uuid; v_content text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT * INTO v_trip FROM public.planner_trips WHERE id = p_trip_id AND user_id = v_me;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found'; END IF;
  v_snap := public.planner_build_snapshot(p_trip_id);
  IF (v_snap->'summary'->>'places_count')::int < 1 THEN RAISE EXCEPTION 'empty trip'; END IF;
  IF (v_snap->'summary'->>'days_count')::int < 1 THEN RAISE EXCEPTION 'no days'; END IF;
  v_title := left(v_trip.title || ' · ' || to_char(v_trip.start_date, 'YYYY.MM.DD') ||
             CASE WHEN v_trip.end_date <> v_trip.start_date THEN '~' || to_char(v_trip.end_date, CASE WHEN extract(year FROM v_trip.end_date) = extract(year FROM v_trip.start_date) THEN 'MM.DD' ELSE 'YYYY.MM.DD' END) ELSE '' END, 120);
  v_content := public.planner_summary_text(v_snap);
  SELECT COALESCE(NULLIF(btrim(nickname), ''), '회원') INTO v_name FROM public.profiles WHERE id = v_me;
  INSERT INTO public.itinerary_posts (user_id, trip_id, title, content, author_name, country, start_date, end_date, days_count, places_count, snapshot)
  VALUES (v_me, p_trip_id, v_title, v_content, v_name, v_trip.country, v_trip.start_date, v_trip.end_date,
          (v_snap->'summary'->>'days_count')::int, (v_snap->'summary'->>'places_count')::int, v_snap)
  ON CONFLICT (trip_id) DO UPDATE
    SET title = EXCLUDED.title, content = EXCLUDED.content, author_name = EXCLUDED.author_name, country = EXCLUDED.country,
        start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, days_count = EXCLUDED.days_count,
        places_count = EXCLUDED.places_count, snapshot = EXCLUDED.snapshot, updated_at = now()
  RETURNING id INTO v_id;
  UPDATE public.planner_trips SET visibility = 'board' WHERE id = p_trip_id;
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public.planner_publish_to_board(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_publish_to_board(uuid) TO authenticated, service_role;

-- 4-4. 쪽지함 (원본: COALESCE(o.nickname, o.name, '탈퇴한 회원'))
CREATE OR REPLACE FUNCTION public.message_box(p_box text, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'content', m.content, 'created_at', m.created_at, 'read_at', m.read_at,
           'other_id', o.id, 'other_name', COALESCE(NULLIF(btrim(o.nickname), ''), CASE WHEN o.id IS NULL THEN '탈퇴한 회원' ELSE '회원' END), 'other_avatar', o.avatar_url,
           'other_crew', COALESCE(o.user_type = 'crew' AND o.crew_verified, FALSE),
           'mine', (m.sender_id = auth.uid())
         ) ORDER BY m.created_at DESC), '[]'::jsonb)
    FROM (SELECT * FROM public.messages m
           WHERE auth.uid() IS NOT NULL
             AND ((p_box = 'in'  AND m.receiver_id = auth.uid() AND NOT m.receiver_deleted)
               OR (p_box = 'out' AND m.sender_id   = auth.uid() AND NOT m.sender_deleted))
           ORDER BY m.created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 300)) m
    LEFT JOIN public.profiles o ON o.id = CASE WHEN p_box = 'in' THEN m.sender_id ELSE m.receiver_id END;
$function$;
REVOKE ALL ON FUNCTION public.message_box(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_box(text, integer) TO authenticated, service_role;

-- 4-5. 대화 목록
CREATE OR REPLACE FUNCTION public.chat_rooms_list()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'kind', r.kind, 'listing_id', r.listing_id, 'created_at', r.created_at,
           'last_message', r.last_message, 'last_message_at', r.last_message_at,
           'other_id', o.id, 'other_name', COALESCE(NULLIF(btrim(o.nickname), ''), CASE WHEN o.id IS NULL THEN '탈퇴한 회원' ELSE '회원' END), 'other_avatar', o.avatar_url,
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
$function$;
REVOKE ALL ON FUNCTION public.chat_rooms_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_rooms_list() TO authenticated, service_role;

-- 4-6. 대화방 정보
CREATE OR REPLACE FUNCTION public.chat_room_info(p_room uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
           'id', r.id, 'kind', r.kind, 'listing_id', r.listing_id,
           'other_id', o.id, 'other_name', COALESCE(NULLIF(btrim(o.nickname), ''), CASE WHEN o.id IS NULL THEN '탈퇴한 회원' ELSE '회원' END), 'other_avatar', o.avatar_url,
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
$function$;
REVOKE ALL ON FUNCTION public.chat_room_info(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_room_info(uuid) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 5. 관리자 신고 목록 RPC (db.js reports.getAll 대체)
--    반환: reports 행 전체 컬럼 + reporter/reported {id, name(실명), nickname, avatar_url}
--    관리자가 아니면 빈 결과(admin_list_profiles 와 같은 방식). 최신순.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_reports()
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT to_jsonb(r) || jsonb_build_object(
           'reporter', CASE WHEN rp.id IS NULL THEN NULL ELSE
             jsonb_build_object('id', rp.id, 'name', rp.name, 'nickname', rp.nickname, 'avatar_url', rp.avatar_url) END,
           'reported', CASE WHEN rd.id IS NULL THEN NULL ELSE
             jsonb_build_object('id', rd.id, 'name', rd.name, 'nickname', rd.nickname, 'avatar_url', rd.avatar_url) END
         )
    FROM public.reports r
    LEFT JOIN public.profiles rp ON rp.id = r.reporter_id
    LEFT JOIN public.profiles rd ON rd.id = r.reported_user_id
   WHERE COALESCE(public.is_admin(), FALSE)
   ORDER BY r.created_at DESC;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_reports() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_reports() TO authenticated;


-- ----------------------------------------------------------------------------
-- 6. 기존 행 이관: 12개 테이블 전체 행을 기대값으로 맞춘다.
--    상관 서브쿼리라 user_id NULL·프로필 없음도 '회원'이 된다(zz 트리거도 같은 값을 계산).
-- ----------------------------------------------------------------------------
UPDATE public.companion_posts t SET author_name = COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')
 WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원');
UPDATE public.qna_posts t SET author_name = COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')
 WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원');
UPDATE public.qna_comments t SET author_name = COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')
 WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원');
UPDATE public.crew_posts t SET author_name = COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')
 WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원');
UPDATE public.reviews t SET author_name = COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')
 WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원');
UPDATE public.review_comments t SET author_name = COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')
 WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원');
UPDATE public.companion_comments t SET author_name = COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')
 WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원');
UPDATE public.crew_comments t SET author_name = COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')
 WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원');
UPDATE public.destination_comments t SET author_name = COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')
 WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원');
UPDATE public.planner_place_reviews t SET author_name = COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')
 WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원');
UPDATE public.itinerary_posts t SET author_name = COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')
 WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원');
UPDATE public.market_listings t SET author = COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')
 WHERE t.author IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원');


-- ----------------------------------------------------------------------------
-- 7. 검증: 테이블별 "기대값과 다른 행 수"(전체 행 기준, 모두 0 이어야 함). 값은 출력하지 않는다.
-- ----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.companion_posts t       WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')) AS companion_posts,
  (SELECT count(*) FROM public.qna_posts t             WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')) AS qna_posts,
  (SELECT count(*) FROM public.qna_comments t          WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')) AS qna_comments,
  (SELECT count(*) FROM public.crew_posts t            WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')) AS crew_posts,
  (SELECT count(*) FROM public.reviews t               WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')) AS reviews,
  (SELECT count(*) FROM public.review_comments t       WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')) AS review_comments,
  (SELECT count(*) FROM public.companion_comments t    WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')) AS companion_comments,
  (SELECT count(*) FROM public.crew_comments t         WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')) AS crew_comments,
  (SELECT count(*) FROM public.destination_comments t  WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')) AS destination_comments,
  (SELECT count(*) FROM public.planner_place_reviews t WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')) AS planner_place_reviews,
  (SELECT count(*) FROM public.itinerary_posts t       WHERE t.author_name IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')) AS itinerary_posts,
  (SELECT count(*) FROM public.market_listings t       WHERE t.author      IS DISTINCT FROM COALESCE((SELECT NULLIF(btrim(p.nickname), '') FROM public.profiles p WHERE p.id = t.user_id), '회원')) AS market_listings;


-- ============================================================================
-- 되돌리기 절차 (문제가 생겼을 때만. 실명을 되살리는 동작이므로 판단 후 한 트랜잭션으로)
-- ----------------------------------------------------------------------------
-- 1) 트리거 제거
--    DROP TRIGGER IF EXISTS zz_propagate_nickname ON public.profiles;
--    DROP TRIGGER IF EXISTS zz_author_nickname ON public.companion_posts;
--    DROP TRIGGER IF EXISTS zz_author_nickname ON public.qna_posts;
--    DROP TRIGGER IF EXISTS zz_author_nickname ON public.qna_comments;
--    DROP TRIGGER IF EXISTS zz_author_nickname ON public.crew_posts;
--    DROP TRIGGER IF EXISTS zz_author_nickname ON public.reviews;
--    DROP TRIGGER IF EXISTS zz_author_nickname ON public.review_comments;
--    DROP TRIGGER IF EXISTS zz_author_nickname ON public.companion_comments;
--    DROP TRIGGER IF EXISTS zz_author_nickname ON public.crew_comments;
--    DROP TRIGGER IF EXISTS zz_author_nickname ON public.destination_comments;
--    DROP TRIGGER IF EXISTS zz_author_nickname ON public.planner_place_reviews;
--    DROP TRIGGER IF EXISTS zz_author_nickname ON public.itinerary_posts;
--    DROP TRIGGER IF EXISTS zz_author_nickname ON public.market_listings;
--    DROP FUNCTION IF EXISTS public.propagate_nickname_change();
--    DROP FUNCTION IF EXISTS public.set_author_from_nickname();
--
-- 2) 백업 복원 (테이블마다 같은 형태, 장터는 author 컬럼)
--    UPDATE public.companion_posts t SET author_name = b.old_value
--      FROM backup_20260915.author_names b WHERE b.tbl = 'companion_posts' AND b.row_id = t.id;
--    ... qna_posts, qna_comments, crew_posts, reviews, review_comments, companion_comments,
--        crew_comments, destination_comments, planner_place_reviews, itinerary_posts 동일
--    UPDATE public.market_listings t SET author = b.old_value
--      FROM backup_20260915.author_names b WHERE b.tbl = 'market_listings' AND b.row_id = t.id;
--    (백업 이후 새로 쓴 글은 백업에 없으므로 닉네임 그대로 남는다)
--
-- 3) 옛 RPC 정의 재적용: 0단계 백업 파일 prod_functions_before.sql 전체 실행
--    (planner_submit_review, planner_get_shared, planner_publish_to_board, message_box,
--     chat_rooms_list, chat_room_info 정의와 EXECUTE 권한이 작업 전으로 돌아간다)
--
-- 4) 신고 RPC 제거(클라이언트를 옛 버전으로 되돌린 뒤): DROP FUNCTION IF EXISTS public.admin_list_reports();
--    추가한 인덱스 4개는 남겨도 무해하다.
-- 5) 보존 기한 후 백업 삭제: DROP SCHEMA backup_20260915 CASCADE;
-- ============================================================================

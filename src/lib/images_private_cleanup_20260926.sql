-- 사진 2차(2026-09-26 쿠마님 지시): 나만 보기·CREW 사진 비공개 + 안 쓰는 사진 자동 삭제 + 프로필 사진
-- 앞 단계: post_limits_images_20260926.sql. 교차검토: codex(계획 단계) 지적 반영.
--
-- 1) 비공개 버킷 post-images. 후기(reviews)·CREW(crew_posts) 사진은 여기로만 올리고, 글에는 공개 주소 대신
--    'sb://post-images/<파일이름>' 참조를 저장한다. 화면은 로그인 토큰으로 파일을 직접 받아(다운로드) 그린다 —
--    공유할 수 있는 주소를 만들지 않는다. 읽기 권한 = 그 사진이 붙은 글을 볼 권한(작성자 본인 사진만 붙일 수 있다).
-- 2) 파일 이름 형식 고정('<내 id>_<시각>[_<난수>].<확장자>'): 정리 작업이 참조를 정확히 찾도록.
-- 3) 안 쓰는 사진 정리: images_orphans / images_still_orphaned (service_role 전용) + 서버 작업
--    api/planner/purge.js?task=images 가 매일 지운다(올린 지 72시간 지난 것만, 지우기 직전 다시 확인).
-- 4) profiles.avatar_url 은 비우거나 https 주소만.

BEGIN;

-- ── 1) 비공개 버킷 ───────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('post-images', 'post-images', false, 5242880,
        ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 2) 파일 이름·업로드 규칙 ─────────────────────────────────────
-- 화면(src/lib/imageUpload.js)이 만드는 이름: <uid>_<밀리초>_<32자 난수>.<확장자>. 옛 화면 형식(<uid>_<밀리초>.<확장자>,
-- <uid>_<밀리초>_<36진 난수>.<확장자>)도 받는다. 글자는 영문·숫자·_·.·- 만 — 참조 추출 정규식과 같다.
CREATE OR REPLACE FUNCTION public.image_name_ok(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND p_name ~ ('^' || auth.uid()::text || '_[0-9]{10,16}(_[A-Za-z0-9]{1,64})?\.[a-z0-9]{2,5}$');
$function$;
REVOKE ALL ON FUNCTION public.image_name_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.image_name_ok(text) TO authenticated;

-- 하루 업로드 상한(두 버킷 합산, 최근 24시간 300장)
CREATE OR REPLACE FUNCTION public.images_upload_quota_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'storage', 'pg_temp'
AS $function$
  SELECT count(*) < 300
  FROM storage.objects o
  WHERE o.bucket_id IN ('images', 'post-images')
    AND starts_with(o.name, auth.uid()::text || '_')
    AND o.created_at > now() - interval '24 hours';
$function$;
REVOKE ALL ON FUNCTION public.images_upload_quota_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.images_upload_quota_ok() TO authenticated;

DROP POLICY IF EXISTS "images insert own" ON storage.objects;
CREATE POLICY "images insert own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'images' AND public.image_name_ok(name) AND public.images_upload_quota_ok());

DROP POLICY IF EXISTS "post-images insert own" ON storage.objects;
CREATE POLICY "post-images insert own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'post-images' AND public.image_name_ok(name) AND public.images_upload_quota_ok());

-- 읽기: 내가 올린 파일(작성 중 미리보기·임시저장) 또는 내가 볼 수 있는 글에 붙은 작성자 본인 사진.
-- 글의 SELECT RLS 와 같은 조건을 쓴다(후기: 공개 또는 작성자 / CREW: 관리자 또는 인증 승무원).
-- 작성자 접두사 확인 = 남의 사진 이름을 자기 글에 적어 읽기 권한을 얻는 우회 차단(codex 9/26).
CREATE OR REPLACE FUNCTION public.can_view_post_image(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
           SELECT 1 FROM public.reviews r
           WHERE r.image_urls @> ARRAY['sb://post-images/' || p_name]
             AND starts_with(p_name, r.user_id::text || '_')
             AND (NOT r.is_private OR r.user_id = auth.uid())
         )
      OR EXISTS (
           SELECT 1 FROM public.crew_posts c
           WHERE c.image_urls @> ARRAY['sb://post-images/' || p_name]
             AND starts_with(p_name, c.user_id::text || '_')
             AND (COALESCE(public.is_admin(), false)
                  OR EXISTS (SELECT 1 FROM public.profiles p
                             WHERE p.id = auth.uid() AND p.user_type = 'crew' AND COALESCE(p.crew_verified, false)))
         );
$function$;
REVOKE ALL ON FUNCTION public.can_view_post_image(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_post_image(text) TO authenticated;

-- 로그인 다운로드만 허용하고 서명 주소 발급(sign)은 막는다 — 서명 주소는 가진 사람 누구나 열 수 있어서
-- 볼 권한이 있는 회원이 만들어 밖으로 넘기면 나만 보기·CREW 사진이 새어 나간다(codex 9/26). 화면은 서명을 쓰지 않는다.
DROP POLICY IF EXISTS "post-images read" ON storage.objects;
CREATE POLICY "post-images read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'post-images'
    AND COALESCE(storage.operation(), '') NOT ILIKE '%sign%'
    AND (starts_with(name, auth.uid()::text || '_') OR public.can_view_post_image(name))
  );

CREATE INDEX IF NOT EXISTS reviews_image_urls_gin ON public.reviews USING gin (image_urls);
CREATE INDEX IF NOT EXISTS crew_posts_image_urls_gin ON public.crew_posts USING gin (image_urls);

-- ── 사진 목록 정리 트리거: 게시판별 허용 형식 ─────────────────────
-- 인자: (최대 장수, 'private' | 'public')
--   private(후기·CREW): 'sb://post-images/<작성자 id>_…' 참조만. 공개 주소(https)는 버린다 — 옛 화면·직접 API 로
--                        공개 사진을 붙이면 나만 보기로 바꿔도 주소로 열리기 때문(codex 9/26).
--   public(추천지):     공개 주소(http/https)만.
CREATE OR REPLACE FUNCTION public.post_image_ref_ok(p_ref text, p_mode text, p_owner uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_ref IS NULL OR length(p_ref) > 2048 THEN false
    WHEN p_mode = 'private' THEN
      p_owner IS NOT NULL
      AND p_ref ~ '^sb://post-images/[A-Za-z0-9_.-]+$'
      AND starts_with(p_ref, 'sb://post-images/' || p_owner::text || '_')
    ELSE p_ref ~ '^https?://'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_post_images()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_max  int  := COALESCE(NULLIF(TG_ARGV[0], '')::int, 20);
  v_mode text := COALESCE(NULLIF(TG_ARGV[1], ''), 'public');
BEGIN
  IF NEW.image_urls IS NULL THEN NEW.image_urls := '{}'; END IF;
  IF array_ndims(NEW.image_urls) > 1 THEN RAISE EXCEPTION 'BAD_IMAGES'; END IF;

  -- 옛 화면(대표 사진 한 칸만 보냄) 호환: image_urls 는 그대로인데 image_url 만 바뀌면 '대표 자리'만 고친다.
  IF TG_OP = 'UPDATE' AND NEW.image_urls IS NOT DISTINCT FROM OLD.image_urls
     AND NEW.image_url IS DISTINCT FROM OLD.image_url THEN
    IF NOT public.post_image_ref_ok(NEW.image_url, v_mode, NEW.user_id) THEN
      NEW.image_urls := array_remove(OLD.image_urls, OLD.image_url);
    ELSIF NEW.image_url = ANY(OLD.image_urls) THEN
      NEW.image_urls := ARRAY[NEW.image_url] || array_remove(OLD.image_urls, NEW.image_url);
    ELSE
      NEW.image_urls := ARRAY[NEW.image_url] || array_remove(OLD.image_urls, OLD.image_url);
    END IF;
  END IF;

  -- 허용 형식만·중복 제거(처음 나온 순서 유지)
  NEW.image_urls := ARRAY(
    SELECT d.u FROM (
      SELECT t.u, min(t.n) AS n
      FROM unnest(NEW.image_urls) WITH ORDINALITY AS t(u, n)
      WHERE public.post_image_ref_ok(t.u, v_mode, NEW.user_id)
      GROUP BY t.u
    ) d ORDER BY d.n
  );
  -- 새 글을 옛 화면이 image_url 로만 올린 경우
  IF cardinality(NEW.image_urls) = 0 AND public.post_image_ref_ok(NEW.image_url, v_mode, NEW.user_id) THEN
    NEW.image_urls := ARRAY[NEW.image_url];
  END IF;
  IF cardinality(NEW.image_urls) > v_max THEN NEW.image_urls := NEW.image_urls[1:v_max]; END IF;
  NEW.image_url := NEW.image_urls[1];
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_post_images ON public.reviews;
CREATE TRIGGER trg_post_images BEFORE INSERT OR UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20', 'private');
DROP TRIGGER IF EXISTS trg_post_images ON public.crew_posts;
CREATE TRIGGER trg_post_images BEFORE INSERT OR UPDATE ON public.crew_posts
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20', 'private');
DROP TRIGGER IF EXISTS trg_post_images ON public.destinations;
CREATE TRIGGER trg_post_images BEFORE INSERT OR UPDATE ON public.destinations
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20', 'public');

-- ── 3) 안 쓰는 사진 정리 ─────────────────────────────────────────
-- 참조 = 아래 테이블 행 전체(행을 텍스트로)에서 뽑은 파일 이름. 컬럼을 빠뜨려도 지워지지 않는 쪽으로 안전하다.
-- 본문에 붙여 넣은 주소도 참조로 본다(보수적). 파일 이름은 image_name_ok 형식이라 정규식으로 정확히 뽑힌다.
CREATE OR REPLACE FUNCTION public.images_referenced_names()
RETURNS TABLE(name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH src(txt) AS (
    SELECT r::text FROM public.reviews r
    UNION ALL SELECT c::text FROM public.crew_posts c
    UNION ALL SELECT d::text FROM public.destinations d
    UNION ALL SELECT m::text FROM public.market_listings m
    UNION ALL SELECT p.avatar_url FROM public.profiles p WHERE p.avatar_url IS NOT NULL
    UNION ALL SELECT cm::text FROM public.commendation_matches cm
    UNION ALL SELECT pd.data::text FROM public.post_drafts pd
  )
  SELECT DISTINCT (regexp_matches(src.txt, '(?:/storage/v1/object/public/images/|sb://post-images/)([A-Za-z0-9_.-]+)', 'g'))[1]
  FROM src;
$function$;
REVOKE ALL ON FUNCTION public.images_referenced_names() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.images_referenced_names() TO service_role;

-- 지울 후보: 올린 지 p_min_age 가 지났고 어디에도 참조되지 않은 파일
CREATE OR REPLACE FUNCTION public.images_orphans(p_min_age interval DEFAULT interval '72 hours', p_limit int DEFAULT 1000)
RETURNS TABLE(bucket_id text, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
  -- 참조 목록은 한 번만 만든다(파일마다 다시 만들지 않게 MATERIALIZED)
  WITH refs AS MATERIALIZED (SELECT r.name FROM public.images_referenced_names() r)
  SELECT o.bucket_id, o.name
  FROM storage.objects o
  WHERE o.bucket_id IN ('images', 'post-images')
    AND o.created_at < now() - GREATEST(p_min_age, interval '1 hour')
    AND NOT EXISTS (SELECT 1 FROM refs WHERE refs.name = o.name)
  ORDER BY o.created_at
  LIMIT GREATEST(1, LEAST(p_limit, 1000));
$function$;
REVOKE ALL ON FUNCTION public.images_orphans(interval, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.images_orphans(interval, int) TO service_role;

-- 지우기 직전 다시 확인: 넘긴 이름 중 지금도 참조가 없는 것만 돌려준다(후보를 뽑은 뒤 다시 붙은 사진 보호)
CREATE OR REPLACE FUNCTION public.images_still_orphaned(p_bucket text, p_names text[])
RETURNS TABLE(name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
  WITH refs AS MATERIALIZED (SELECT r.name FROM public.images_referenced_names() r)
  SELECT o.name
  FROM storage.objects o
  WHERE o.bucket_id = p_bucket
    AND p_bucket IN ('images', 'post-images')
    AND o.name = ANY(p_names)
    AND NOT EXISTS (SELECT 1 FROM refs WHERE refs.name = o.name);
$function$;
REVOKE ALL ON FUNCTION public.images_still_orphaned(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.images_still_orphaned(text, text[]) TO service_role;

-- ── 4) 프로필 사진 ───────────────────────────────────────────────
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_avatar_url_https;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_avatar_url_https
  CHECK (avatar_url IS NULL OR (avatar_url ~ '^https://' AND length(avatar_url) <= 2048));

COMMIT;

-- 매일 정리 예약(적용 후 한 번 실행):
-- SELECT cron.schedule('images-purge', '10 19 * * *', $$
--   select net.http_get(
--     url := 'https://www.connecttrip.co.kr/api/planner/purge?task=images',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ct_planner_purge_secret'),
--       'User-Agent', 'ct-pgcron/1.0'),
--     timeout_milliseconds := 60000);
-- $$);

-- 게시판 글 한도 상향 + 사진 여러 장 + 사진 저장소 업로드 규칙 (2026-09-26 쿠마님 지시)
-- 화면 한도는 src/lib/postLimits.js. 숫자를 바꾸면 이 파일의 CHECK·트리거 인자도 같이 바꾼다.
--
-- 1) reviews·destinations·crew_posts 에 image_urls(사진 여러 장, 최대 20장). image_url 은 대표(첫 장)로 계속 채운다
--    — 목록 썸네일과 옛 화면(사진 1장 폼: 캐시된 웹·재빌드 전 앱)이 그대로 동작하게.
-- 2) 서버 글자 수 한도(CHECK). 지금까지는 화면 maxLength 만 있었다. char_length(코드포인트)로 재므로
--    화면(maxLength = UTF-16 단위)을 통과한 글은 여기서 막히지 않는다.
-- 3) 임시저장(post_drafts) 크기 30,000 → 200,000 바이트. 본문 2만 자(한글 약 60KB, JSON 이스케이프 최악 120KB)가 들어가게.
-- 4) 사진 저장소(images 버킷) 업로드 규칙. storage.objects 에 images 정책이 하나도 없어 모든 회원의 사진 업로드가
--    "new row violates row-level security policy" 로 막혀 있었다(2026-09-26 운영 실측, 버킷 파일 0개).
--    ImageUpload.jsx 의 파일 이름 규칙('<user id>_…', 폴더 없음)과 같은 것만 받는다.

BEGIN;

-- ── 1) 사진 여러 장 ─────────────────────────────────────────────
ALTER TABLE public.reviews      ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.destinations ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.crew_posts   ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';

UPDATE public.reviews      SET image_urls = ARRAY[image_url] WHERE image_url ~ '^https?://' AND cardinality(image_urls) = 0;
UPDATE public.destinations SET image_urls = ARRAY[image_url] WHERE image_url ~ '^https?://' AND cardinality(image_urls) = 0;
UPDATE public.crew_posts   SET image_urls = ARRAY[image_url] WHERE image_url ~ '^https?://' AND cardinality(image_urls) = 0;

-- image_urls 정리 + image_url(대표) 동기화. 인자 = 최대 장수.
-- 장터(trg_market_listing_images)와 같은 방식에, 옛 화면 호환 규칙 하나를 더했다.
CREATE OR REPLACE FUNCTION public.trg_post_images()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_max int := COALESCE(NULLIF(TG_ARGV[0], '')::int, 20);
BEGIN
  IF NEW.image_urls IS NULL THEN NEW.image_urls := '{}'; END IF;
  IF array_ndims(NEW.image_urls) > 1 THEN RAISE EXCEPTION 'BAD_IMAGES'; END IF;

  -- 옛 화면은 image_url 한 칸(대표 사진)만 보고 보낸다. 수정에서 image_urls 는 그대로인데 image_url 만
  -- 바뀌었으면 옛 화면이 '대표 사진 자리'만 고친 것으로 본다. 옛 화면에 안 보이던 나머지 사진은 지우지 않는다
  -- (오래 열어 둔 옛 수정창이 옛 대표값을 보내도 사진 묶음이 한 장으로 줄지 않게 — codex 9/26).
  --   사진 지움        → 기존 대표만 빼고 나머지 유지
  --   목록에 있는 사진 → 그 사진을 맨 앞(대표)으로
  --   새 사진          → 기존 대표 자리를 새 사진으로 바꾸고 나머지 유지
  IF TG_OP = 'UPDATE' AND NEW.image_urls IS NOT DISTINCT FROM OLD.image_urls
     AND NEW.image_url IS DISTINCT FROM OLD.image_url THEN
    IF NEW.image_url IS NULL OR NEW.image_url !~ '^https?://' THEN
      NEW.image_urls := array_remove(OLD.image_urls, OLD.image_url);
    ELSIF NEW.image_url = ANY(OLD.image_urls) THEN
      NEW.image_urls := ARRAY[NEW.image_url] || array_remove(OLD.image_urls, NEW.image_url);
    ELSE
      NEW.image_urls := ARRAY[NEW.image_url] || array_remove(OLD.image_urls, OLD.image_url);
    END IF;
  END IF;

  -- 빈 값·http(s) 가 아닌 값·너무 긴 값·중복 제거(처음 나온 순서 유지)
  NEW.image_urls := ARRAY(
    SELECT d.u FROM (
      SELECT t.u, min(t.n) AS n
      FROM unnest(NEW.image_urls) WITH ORDINALITY AS t(u, n)
      WHERE t.u ~ '^https?://' AND length(t.u) <= 2048
      GROUP BY t.u
    ) d ORDER BY d.n
  );
  -- 새 글을 옛 화면이 image_url 로만 올린 경우
  IF cardinality(NEW.image_urls) = 0 AND NEW.image_url ~ '^https?://' AND length(NEW.image_url) <= 2048 THEN
    NEW.image_urls := ARRAY[NEW.image_url];
  END IF;
  IF cardinality(NEW.image_urls) > v_max THEN NEW.image_urls := NEW.image_urls[1:v_max]; END IF;
  -- 대표 = 첫 장. 사진이 없으면 비운다(주소 형식이 아닌 옛 값도 함께 정리된다).
  NEW.image_url := NEW.image_urls[1];
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_post_images ON public.reviews;
CREATE TRIGGER trg_post_images BEFORE INSERT OR UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20');
DROP TRIGGER IF EXISTS trg_post_images ON public.destinations;
CREATE TRIGGER trg_post_images BEFORE INSERT OR UPDATE ON public.destinations
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20');
DROP TRIGGER IF EXISTS trg_post_images ON public.crew_posts;
CREATE TRIGGER trg_post_images BEFORE INSERT OR UPDATE ON public.crew_posts
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20');

-- ── 2) 서버 글자 수 한도 ─────────────────────────────────────────
ALTER TABLE public.reviews
  DROP CONSTRAINT IF EXISTS reviews_title_len,
  DROP CONSTRAINT IF EXISTS reviews_description_len,
  DROP CONSTRAINT IF EXISTS reviews_image_urls_max,
  ADD CONSTRAINT reviews_title_len CHECK (char_length(title) <= 100),
  ADD CONSTRAINT reviews_description_len CHECK (char_length(description) <= 20000),
  ADD CONSTRAINT reviews_image_urls_max CHECK (cardinality(image_urls) <= 20);

ALTER TABLE public.qna_posts
  DROP CONSTRAINT IF EXISTS qna_posts_title_len,
  DROP CONSTRAINT IF EXISTS qna_posts_content_len,
  ADD CONSTRAINT qna_posts_title_len CHECK (char_length(title) <= 100),
  ADD CONSTRAINT qna_posts_content_len CHECK (char_length(content) <= 20000);

ALTER TABLE public.crew_posts
  DROP CONSTRAINT IF EXISTS crew_posts_title_len,
  DROP CONSTRAINT IF EXISTS crew_posts_content_len,
  DROP CONSTRAINT IF EXISTS crew_posts_image_urls_max,
  ADD CONSTRAINT crew_posts_title_len CHECK (char_length(title) <= 100),
  ADD CONSTRAINT crew_posts_content_len CHECK (char_length(content) <= 20000),
  ADD CONSTRAINT crew_posts_image_urls_max CHECK (cardinality(image_urls) <= 20);

ALTER TABLE public.companion_posts
  DROP CONSTRAINT IF EXISTS companion_posts_title_len,
  DROP CONSTRAINT IF EXISTS companion_posts_content_len,
  ADD CONSTRAINT companion_posts_title_len CHECK (char_length(title) <= 100),
  ADD CONSTRAINT companion_posts_content_len CHECK (char_length(content) <= 5000);

ALTER TABLE public.destinations
  DROP CONSTRAINT IF EXISTS destinations_name_len,
  DROP CONSTRAINT IF EXISTS destinations_description_len,
  DROP CONSTRAINT IF EXISTS destinations_crew_comment_len,
  DROP CONSTRAINT IF EXISTS destinations_image_urls_max,
  ADD CONSTRAINT destinations_name_len CHECK (char_length(name) <= 100),
  ADD CONSTRAINT destinations_description_len CHECK (char_length(description) <= 200),
  ADD CONSTRAINT destinations_crew_comment_len CHECK (char_length(crew_comment) <= 20000),
  ADD CONSTRAINT destinations_image_urls_max CHECK (cardinality(image_urls) <= 20);

-- ── 3) 임시저장 크기 ─────────────────────────────────────────────
ALTER TABLE public.post_drafts DROP CONSTRAINT IF EXISTS post_drafts_data_check;
ALTER TABLE public.post_drafts ADD CONSTRAINT post_drafts_data_check
  CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 200000);

-- ── 4) 사진 저장소(images 버킷) ──────────────────────────────────
-- 로그인 회원이 자기 id 로 시작하는 이름(폴더 없음)으로만 올릴 수 있다. 읽기는 공개 버킷 주소로 한다.
-- 하루 업로드 상한(최근 24시간 300장): 글 한 편 20장 한도와 별개로, 글 없이 계속 올려 저장소를 채우는 것을 막는다.
-- 정책 안의 하위 조회는 RLS 가 걸려(images SELECT 정책 없음) 0건으로 보이므로 SECURITY DEFINER 함수로 센다.
CREATE OR REPLACE FUNCTION public.images_upload_quota_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'storage', 'pg_temp'
AS $function$
  SELECT count(*) < 300
  FROM storage.objects o
  WHERE o.bucket_id = 'images'
    AND starts_with(o.name, auth.uid()::text || '_')
    AND o.created_at > now() - interval '24 hours';
$function$;
REVOKE ALL ON FUNCTION public.images_upload_quota_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.images_upload_quota_ok() TO authenticated;

DROP POLICY IF EXISTS "images insert own" ON storage.objects;
CREATE POLICY "images insert own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'images'
    AND starts_with(name, auth.uid()::text || '_')
    AND strpos(name, '/') = 0
    AND public.images_upload_quota_ok()
  );
-- 5MB(화면 ImageUpload 와 같은 한도)·래스터 이미지만. SVG 는 스크립트를 담을 수 있어 받지 않는다.
UPDATE storage.buckets
  SET file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
  WHERE id = 'images';

COMMIT;

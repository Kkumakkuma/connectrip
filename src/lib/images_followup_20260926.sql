-- 사진 3차 보완(2026-09-26, agy 구조 검토 반영). 앞 단계: images_private_cleanup_20260926.sql
-- 1) 사진 트리거를 사진 칸이 바뀔 때만 돌게 한정한다 — 장터 트리거(chat_market_20260906.sql)와 같은 방식.
--    닉네임 일괄 변경처럼 사진과 무관한 UPDATE 때 행마다 정규식이 돌지 않게.
-- 2) 프로필 사진 주소 정리: 소셜 가입(카카오 등)이 http:// 주소를 넘기면 profiles_avatar_url_https CHECK 에 걸려
--    가입이 실패할 수 있다(handle_new_user 는 메타데이터를 그대로 넣는다). CHECK 는 두고, 먼저 https 로 올리고
--    주소 형식이 아니면 비운다(기본 사람 그림으로 보인다).

BEGIN;

DROP TRIGGER IF EXISTS trg_post_images ON public.reviews;
CREATE TRIGGER trg_post_images BEFORE INSERT OR UPDATE OF image_url, image_urls ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20', 'private');
DROP TRIGGER IF EXISTS trg_post_images ON public.crew_posts;
CREATE TRIGGER trg_post_images BEFORE INSERT OR UPDATE OF image_url, image_urls ON public.crew_posts
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20', 'private');
DROP TRIGGER IF EXISTS trg_post_images ON public.destinations;
CREATE TRIGGER trg_post_images BEFORE INSERT OR UPDATE OF image_url, image_urls ON public.destinations
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20', 'public');

CREATE OR REPLACE FUNCTION public.profiles_avatar_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  IF NEW.avatar_url IS NOT NULL THEN
    NEW.avatar_url := btrim(NEW.avatar_url);
    IF NEW.avatar_url ~* '^http://' THEN
      NEW.avatar_url := 'https://' || substr(NEW.avatar_url, 8);
    END IF;
    IF NEW.avatar_url = '' OR NEW.avatar_url !~ '^https://' OR length(NEW.avatar_url) > 2048 THEN
      NEW.avatar_url := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 이름 aa_ = 다른 BEFORE 트리거(trg_profiles_guard 등)보다 먼저. CHECK 는 BEFORE 트리거 뒤에 검사된다.
DROP TRIGGER IF EXISTS aa_profiles_avatar_normalize ON public.profiles;
CREATE TRIGGER aa_profiles_avatar_normalize BEFORE INSERT OR UPDATE OF avatar_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_avatar_normalize();

COMMIT;

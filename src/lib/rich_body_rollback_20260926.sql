-- 서식 편집기 1단계 되돌리기 R2: DB 까지 되돌리기(2026-09-26, 설계 plan_v3 3-4 + plan_v3_1 3장·8장).
-- ⚠ 실행하지 않는다 — 운영 DB 에서 BEGIN … ROLLBACK 리허설만 해 둔다. 실제 실행은 쿠마님 확인 후에만(등급 3).
--   서식 글·서식 원고가 0행이면 이 파일 대신 rich_body_20260926.sql 끝의 R0 절(트리거만 바꿔 끼우기)을 쓴다.
--   화면만 문제면 R1 = Vercel 이전 배포로 되돌리기(DB 는 그대로 — trg_post_body·원고 가드 유지).
--
-- 순서(v3.1 8장):
--   ① 대상 5개 게시판 + post_drafts 잠금(SHARE ROW EXCLUSIVE — 변환 동안 다른 쓰기는 기다리고 읽기는 계속된다)
--   ② 백업: 서식 글의 문서·파일 목록·지금 평문·사진 목록, 서식 원고(fmt 2)의 data 통째 → rich_rollback_backup
--   ③ 원고 가드 제거: post_drafts_before_update 를 post_drafts_20260925.sql 원형 본문으로(revision·updated_at 갱신 유지),
--      DELETE 가드 트리거 삭제
--   ④ trg_post_body 를 끄고 → 문서 칸 NULL(평문·사진 목록·대표 사진은 이미 파생된 값이라 그대로 유효)
--      → 서식 원고를 옛 형식으로(content / 추천지 crewComment = 평문, image_urls·image_url = 문서 사진, fmt·문서 키 제거)
--   ⑤ trg_post_body 삭제 → trg_post_images 3개를 images_followup_20260926.sql 과 같이 다시 만든다
--
-- 남는 것(무해): 새 칸(문서 NULL·file_urls — 참조가 남아 파일이 고아 정리로 지워지지 않는다)·백업 표(사진 정리가 참조로 본다)·
--   RPC post_draft_delete(화면이 새 판이면 삭제에 계속 쓰인다 — 가드가 없으니 그냥 지운다)·원고 크기 한도 540,672
--   (1단계 전 200,000 으로 줄이지 않는다 — 그사이 저장된 큰 원고 하나 때문에 롤백 전체가 실패하지 않게. 옛 화면에는 넉넉할 뿐이다).
--   지도는 백업에만 남는다.
-- 잠금: 트리거를 지우는 DROP TRIGGER 는 ACCESS EXCLUSIVE 로 올라가 그동안 읽기도 기다린다(짧다). 긴 조회 뒤에 줄 서서
--   뒤따르는 요청까지 막지 않게 lock_timeout 을 건다 — 시간 안에 못 잡으면 트랜잭션 전체가 취소되고 아무것도 바뀌지 않는다(다시 실행).
-- 다시 앞으로 갈 때: 1단계 SQL 을 다시 적용한 뒤 백업의 문서를 문서 칸만 UPDATE 로 되살린다(트리거가 평문·사진을 다시 뽑는다).
--   롤백 뒤 옛 화면에서 고쳐진 행(지금 평문·사진이 plain_at_backup·images_at_backup 과 다름)은 건너뛰고 목록으로 보고한다.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ① 잠금(트랜잭션의 첫 동작)
LOCK TABLE public.reviews, public.crew_posts, public.destinations, public.qna_posts, public.companion_posts, public.post_drafts
  IN SHARE ROW EXCLUSIVE MODE;

-- ② 백업
INSERT INTO public.rich_rollback_backup (tbl, row_id, doc, file_urls, plain_at_backup, images_at_backup)
SELECT 'reviews', id, description_doc, file_urls, description, image_urls FROM public.reviews WHERE description_doc IS NOT NULL
UNION ALL
SELECT 'crew_posts', id, content_doc, file_urls, content, image_urls FROM public.crew_posts WHERE content_doc IS NOT NULL
UNION ALL
SELECT 'destinations', id, crew_comment_doc, file_urls, crew_comment, image_urls FROM public.destinations WHERE crew_comment_doc IS NOT NULL
UNION ALL
SELECT 'qna_posts', id, content_doc, '{}', content, '{}' FROM public.qna_posts WHERE content_doc IS NOT NULL
UNION ALL
SELECT 'companion_posts', id, content_doc, '{}', content, '{}' FROM public.companion_posts WHERE content_doc IS NOT NULL
UNION ALL
SELECT 'post_drafts', id, data, '{}', NULL, '{}' FROM public.post_drafts WHERE data->>'fmt' = '2';

-- ③ 원고 가드 제거
DROP TRIGGER IF EXISTS post_drafts_before_delete ON public.post_drafts;
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
REVOKE ALL ON FUNCTION public.post_drafts_before_update() FROM PUBLIC, anon, authenticated;

-- ④ 본문 트리거를 끄고 문서를 비운다(평문·사진 목록은 서버가 파생해 둔 값 그대로)
ALTER TABLE public.reviews         DISABLE TRIGGER trg_post_body;
ALTER TABLE public.crew_posts      DISABLE TRIGGER trg_post_body;
ALTER TABLE public.destinations    DISABLE TRIGGER trg_post_body;
ALTER TABLE public.qna_posts       DISABLE TRIGGER trg_post_body;
ALTER TABLE public.companion_posts DISABLE TRIGGER trg_post_body;
UPDATE public.reviews         SET description_doc = NULL  WHERE description_doc IS NOT NULL;
UPDATE public.crew_posts      SET content_doc = NULL      WHERE content_doc IS NOT NULL;
UPDATE public.destinations    SET crew_comment_doc = NULL WHERE crew_comment_doc IS NOT NULL;
UPDATE public.qna_posts       SET content_doc = NULL      WHERE content_doc IS NOT NULL;
UPDATE public.companion_posts SET content_doc = NULL      WHERE content_doc IS NOT NULL;

-- 서식 원고 → 옛 형식. 문서 칸: 후기·Q&A·자유·CREW = doc, 추천지 = crewCommentDoc(src/lib/draftForms.js 2단계 스펙)
UPDATE public.post_drafts pd
SET data = (pd.data - 'fmt' - 'doc' - 'crewCommentDoc')
  || jsonb_build_object(
       CASE WHEN pd.board = 'destination' THEN 'crewComment' ELSE 'content' END, public.rich_doc_plain(x.doc),
       'image_urls', to_jsonb(public.rich_doc_images(x.doc)),
       'image_url', coalesce((public.rich_doc_images(x.doc))[1], ''))
FROM (
  SELECT id, CASE WHEN board = 'destination' THEN data->'crewCommentDoc' ELSE data->'doc' END AS doc
  FROM public.post_drafts
  WHERE data->>'fmt' = '2'
) x
WHERE pd.id = x.id;

-- ⑤ 통합 트리거 삭제, 사진 트리거 3개 재생성(images_followup_20260926.sql:10-18 과 같다)
DROP TRIGGER IF EXISTS trg_post_body ON public.reviews;
DROP TRIGGER IF EXISTS trg_post_body ON public.crew_posts;
DROP TRIGGER IF EXISTS trg_post_body ON public.destinations;
DROP TRIGGER IF EXISTS trg_post_body ON public.qna_posts;
DROP TRIGGER IF EXISTS trg_post_body ON public.companion_posts;
DROP TRIGGER IF EXISTS trg_post_images ON public.reviews;
CREATE TRIGGER trg_post_images BEFORE INSERT OR UPDATE OF image_url, image_urls ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20', 'private');
DROP TRIGGER IF EXISTS trg_post_images ON public.crew_posts;
CREATE TRIGGER trg_post_images BEFORE INSERT OR UPDATE OF image_url, image_urls ON public.crew_posts
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20', 'private');
DROP TRIGGER IF EXISTS trg_post_images ON public.destinations;
CREATE TRIGGER trg_post_images BEFORE INSERT OR UPDATE OF image_url, image_urls ON public.destinations
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20', 'public');

COMMIT;

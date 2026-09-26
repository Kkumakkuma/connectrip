-- 사진 4차(2026-09-27 쿠마님 지시): 사람이 버린 사진은 그 자리에서 지운다. 앞 단계: rich_body_20260926.sql(참조 목록),
-- images_private_cleanup_20260926.sql(버킷·이름 규칙·72시간 정리).
--
-- 화면(src/lib/imageDiscard.js)이 지우는 때: 글 수정 저장으로 뺀 사진, 글 삭제, 임시저장 원고에서 뺀 사진·원고 삭제,
-- 프로필 사진 교체·기본으로 되돌리기, 사진은 올렸는데 글·원고 저장이 실패한 경우. 사진은 등록·임시저장 버튼을 누를 때만
-- 올라가므로(지연 업로드) 고르기만 하고 닫은 사진은 서버에 없다.
--
-- 1) image_name_referenced(이름): 그 사진이 어디에서든 쓰이면 true. 매일 정리(images_referenced_names)와 같은 곳을 본다 —
--    후기·CREW·추천지·장터 글 행, 프로필 사진, 칭찬매칭 행, 임시저장 원고, 롤백 백업 표.
--    내 이름('<내 id>_…')이 아니면 무조건 true(= 지우지 말 것) — 남의 사진이 어디 쓰이는지 떠보지 못하게.
-- 2) storage.objects 삭제 규칙: 내 사진이고(이름 접두사 + 올린 사람 owner_id) 어디에도 안 쓰일 때만 지워진다.
--    쓰이고 있으면 조용히 남는다(삭제 0건, 오류 없음). Storage remove 는 SELECT 권한도 필요하다
--    (storage-js remove 주석: objects 권한 delete 와 select) → images 버킷에 "내 파일 읽기" 규칙을 더한다.
--    post-images 는 기존 "post-images read" 가 내 파일을 이미 허용한다.
--
-- 72시간 자동 정리(images-purge)는 그대로 둔다 — 사진을 올린 직후 글 저장 전에 앱이 꺼지는 짧은 틈의 안전망.
-- 규모 메모: 참조 확인은 사진 한 장마다 위 표들을 통째로(행 → 텍스트) 훑는다. 2026-09-27 리허설 실측 = 1회 0.38ms
-- (후기·장터 0행, 원고 1행 등 표가 거의 빈 상태). 글·원고가 수천 건을 넘으면 참조 표(이름 → 글)로 바꿀 것 —
-- 삭제 요청 한 번(최대 100장)이 그만큼 풀스캔을 반복한다. 매일 정리(images_referenced_names)도 같은 방식이다.
-- 남는 위험(교차검토 codex 9/27): 확인과 삭제 사이에 같은 사진을 참조하는 저장이 동시에 커밋되면(같은 회원이 두 창에서
-- 한쪽은 빼고 한쪽은 넣어 동시에 저장) 그 글의 사진이 사라질 수 있다. 참조 표 + 직렬화로만 완전히 막힌다.

BEGIN;

-- ── 1) 참조 확인 ─────────────────────────────────────────────────
-- 문자열 검사는 LIKE 를 쓰지 않는다(이름의 '_' 가 한 글자 와일드카드). strpos 로 먼저 거르고,
-- 경로 접두사 + 이름 + "이름이 끝나는 자리"(다음 글자가 이름에 못 쓰는 글자이거나 문자열 끝)를 정규식으로 확인한다 —
-- 'a.jp' 가 'a.jpg' 안에서 잡히는 부분 일치를 막는다. 이름 글자는 영문·숫자·_·.·- 뿐이라 정규식 특수문자는 '.' 하나.
CREATE OR REPLACE FUNCTION public.image_name_referenced(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL
      OR p_name IS NULL
      OR p_name !~ '^[A-Za-z0-9_.-]{1,200}$'
      OR NOT starts_with(p_name, auth.uid()::text || '_')
    THEN true
    ELSE EXISTS (
      SELECT 1
      FROM (
        SELECT r::text AS txt FROM public.reviews r
        UNION ALL SELECT c::text FROM public.crew_posts c
        UNION ALL SELECT d::text FROM public.destinations d
        UNION ALL SELECT m::text FROM public.market_listings m
        UNION ALL SELECT p.avatar_url FROM public.profiles p WHERE p.avatar_url IS NOT NULL
        UNION ALL SELECT cm::text FROM public.commendation_matches cm
        UNION ALL SELECT pd.data::text FROM public.post_drafts pd
        UNION ALL SELECT b::text FROM public.rich_rollback_backup b
      ) src
      -- CASE 로 순서를 고정한다 — AND 로 두면 실행 계획이 정규식을 먼저 돌렸다(리허설 EXPLAIN 실측)
      WHERE CASE WHEN strpos(src.txt, p_name) > 0
                 THEN src.txt ~ ('(/storage/v1/object/public/images/|sb://post-images/)'
                                 || replace(p_name, '.', '\.')
                                 || '([^A-Za-z0-9_.-]|$)')
                 ELSE false
            END
    )
  END;
$function$;
REVOKE ALL ON FUNCTION public.image_name_referenced(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.image_name_referenced(text) TO authenticated;

-- ── 2) 저장소 규칙 ───────────────────────────────────────────────
-- images(공개 버킷) 내 파일 읽기 — 지우기(remove)에 필요. 공개 버킷이라 파일은 원래 주소로 열리고,
-- 목록 조회도 내 파일만 보인다(남의 파일 목록은 계속 막힌다).
DROP POLICY IF EXISTS "images select own" ON storage.objects;
CREATE POLICY "images select own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'images' AND starts_with(name, (SELECT auth.uid())::text || '_'));

-- 지우기: 두 사진 버킷, 폴더 없는 이름, 내 이름 접두사, 내가 올린 파일(owner_id), 어디에도 안 쓰일 때만.
-- owner_id 조건은 설계안에 더한 것 — 이름 규칙(image_name_ok)이 이미 접두사를 강제하지만, 서버 키로 올린 파일
-- (owner_id 없음)이나 규칙 이전 파일은 회원이 지우지 못하게 한 겹 더 막는다(그런 파일은 72시간 정리 몫).
DROP POLICY IF EXISTS "images discard own" ON storage.objects;
CREATE POLICY "images discard own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN ('images', 'post-images')
    AND position('/' in name) = 0
    AND starts_with(name, (SELECT auth.uid())::text || '_')
    AND owner_id = (SELECT auth.uid())::text
    AND NOT public.image_name_referenced(name)
  );

COMMIT;

-- 되돌리기(필요할 때만):
-- BEGIN;
-- DROP POLICY IF EXISTS "images discard own" ON storage.objects;
-- DROP POLICY IF EXISTS "images select own" ON storage.objects;
-- DROP FUNCTION IF EXISTS public.image_name_referenced(text);
-- COMMIT;

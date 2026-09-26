-- 게시판 서식 편집기 1단계: 기반(2026-09-26). 설계 = memory/connectrip_rich_editor/plan_v3.md + plan_v3_1.md(충돌 시 v3.1).
-- 사용자 화면은 바뀌지 않는다(읽는 쪽·서버 먼저). 편집기(TipTap)는 2단계, PDF 첨부는 4단계.
-- 문서 규칙의 단일 원천은 src/lib/rich/schema.js 다. 숫자·팔레트·정규식을 바꾸면 이 파일도 같이 바꾼다
-- (src/lib/rich/schema.test.js 가 두 파일을 대조한다).
--
-- 1) 서식 문서 칸 <평문 칸>_doc(jsonb, NULL = 옛날식 평문 글) + 크기 CHECK, 추천지 꿀팁 목록용 미리보기 칸,
--    파일 목록 칸 file_urls(PDF 첨부 4단계 전까지 항상 빈 배열).
-- 2) 문서 검증·파생 함수: rich_doc_check(검증 + 평문·사진 목록), rich_doc_plain(평문), rich_doc_images(사진).
--    파일(file) 노드는 서버가 거부한다(파일 기능 스위치 전).
-- 3) 본문 트리거 통합: trg_post_body → post_body_guard(). 사진 트리거 trg_post_images 3개를 없애고 그 규칙을
--    "옛 글" 분기로 옮긴다. 서식 글은 평문·사진 목록·대표 사진·파일 목록을 서버가 문서에서 뽑아 덮어쓴다
--    (불변식: 문서 = 평문 = 사진 목록. 어떤 칸만 골라 UPDATE 해도 이 트리거를 지난다).
-- 4) 원고(post_drafts) 가드: 서식 원고(data.fmt = 2)는 fmt 를 모르는 옛 화면이 덮어쓰거나(UPDATE) 지울(DELETE) 수 없다.
--    새 화면의 삭제는 RPC post_draft_delete 로만. 탈퇴(request_account_deletion 은 app.allow_sensitive 를 켠다)·
--    서버 정리 작업(auth.uid() 없음)은 통과.
-- 5) 원고 크기 200,000 → 540,672 바이트(문서 524,288 + 제목·말머리 등 나머지 칸 + 여유).
-- 6) 롤백 백업 표 rich_rollback_backup(지금은 빈 표, 클라이언트 접근 0) + 안 쓰는 사진 정리가 이 표의 참조도 보호.
-- 되돌리기: 이 파일 끝 R0 절(서식 행 0개일 때만) / rich_body_rollback_20260926.sql(R2, 서식 행이 있을 때 — 쿠마님 확인 후).
-- 적용 순서: 이 SQL 을 먼저 적용하고 화면(postDrafts.js 의 RPC 삭제)을 배포한다.

BEGIN;

-- ── 1) 칸·CHECK ──────────────────────────────────────────────────
ALTER TABLE public.reviews         ADD COLUMN IF NOT EXISTS description_doc jsonb;
ALTER TABLE public.crew_posts      ADD COLUMN IF NOT EXISTS content_doc jsonb;
ALTER TABLE public.destinations    ADD COLUMN IF NOT EXISTS crew_comment_doc jsonb;
ALTER TABLE public.qna_posts       ADD COLUMN IF NOT EXISTS content_doc jsonb;
ALTER TABLE public.companion_posts ADD COLUMN IF NOT EXISTS content_doc jsonb;

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_description_doc_chk,
  ADD CONSTRAINT reviews_description_doc_chk CHECK (description_doc IS NULL
    OR (jsonb_typeof(description_doc) = 'object' AND octet_length(description_doc::text) <= 524288));
ALTER TABLE public.crew_posts DROP CONSTRAINT IF EXISTS crew_posts_content_doc_chk,
  ADD CONSTRAINT crew_posts_content_doc_chk CHECK (content_doc IS NULL
    OR (jsonb_typeof(content_doc) = 'object' AND octet_length(content_doc::text) <= 524288));
ALTER TABLE public.destinations DROP CONSTRAINT IF EXISTS destinations_crew_comment_doc_chk,
  ADD CONSTRAINT destinations_crew_comment_doc_chk CHECK (crew_comment_doc IS NULL
    OR (jsonb_typeof(crew_comment_doc) = 'object' AND octet_length(crew_comment_doc::text) <= 524288));
ALTER TABLE public.qna_posts DROP CONSTRAINT IF EXISTS qna_posts_content_doc_chk,
  ADD CONSTRAINT qna_posts_content_doc_chk CHECK (content_doc IS NULL
    OR (jsonb_typeof(content_doc) = 'object' AND octet_length(content_doc::text) <= 524288));
ALTER TABLE public.companion_posts DROP CONSTRAINT IF EXISTS companion_posts_content_doc_chk,
  ADD CONSTRAINT companion_posts_content_doc_chk CHECK (content_doc IS NULL
    OR (jsonb_typeof(content_doc) = 'object' AND octet_length(content_doc::text) <= 524288));

-- 추천지 목록 카드용 꿀팁 앞부분(목록은 문서·긴 꿀팁을 받지 않는다 — src/lib/db.js DESTINATION_LIST_COLUMNS)
ALTER TABLE public.destinations
  ADD COLUMN IF NOT EXISTS crew_comment_preview text GENERATED ALWAYS AS (left(crew_comment, 200)) STORED;

-- 파일 목록(4단계 PDF). 서버가 문서에서 뽑아 채운다 — 지금은 file 노드를 거부하므로 항상 빈 배열.
ALTER TABLE public.reviews      ADD COLUMN IF NOT EXISTS file_urls text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.crew_posts   ADD COLUMN IF NOT EXISTS file_urls text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.destinations ADD COLUMN IF NOT EXISTS file_urls text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.reviews      DROP CONSTRAINT IF EXISTS reviews_file_urls_max,
  ADD CONSTRAINT reviews_file_urls_max CHECK (cardinality(file_urls) <= 5);
ALTER TABLE public.crew_posts   DROP CONSTRAINT IF EXISTS crew_posts_file_urls_max,
  ADD CONSTRAINT crew_posts_file_urls_max CHECK (cardinality(file_urls) <= 5);
ALTER TABLE public.destinations DROP CONSTRAINT IF EXISTS destinations_file_urls_max,
  ADD CONSTRAINT destinations_file_urls_max CHECK (cardinality(file_urls) <= 5);
CREATE INDEX IF NOT EXISTS reviews_file_urls_gin      ON public.reviews      USING gin (file_urls);
CREATE INDEX IF NOT EXISTS crew_posts_file_urls_gin   ON public.crew_posts   USING gin (file_urls);
CREATE INDEX IF NOT EXISTS destinations_file_urls_gin ON public.destinations USING gin (file_urls);

-- ── 2) 사진 참조 규칙(설계 4-7) ───────────────────────────────────
-- 추천지(public) 서식 글의 사진: 우리 공개 버킷 주소 + 작성자 접두사만(쿼리·조각 없음).
-- 옛 글 분기는 지금처럼 post_image_ref_ok(…,'public',…) = http(s) 주소 전부를 그대로 받는다.
CREATE OR REPLACE FUNCTION public.post_public_image_ok(p_ref text, p_owner uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT p_ref IS NOT NULL AND p_owner IS NOT NULL AND length(p_ref) <= 2048
     AND starts_with(p_ref, x.prefix || p_owner::text || '_')
     AND substr(p_ref, char_length(x.prefix) + 1) ~ '^[A-Za-z0-9_.-]+$'
  FROM (SELECT 'https://owhtldabzcvavsazdufy.supabase.co/storage/v1/object/public/images/'::text AS prefix) x;
$function$;

-- 서식 문서 사진 규칙: private = 비공개 버킷 참조(post_image_ref_ok), public = 위 함수, none = 사진 없음
CREATE OR REPLACE FUNCTION public.rich_image_ref_ok(p_ref text, p_mode text, p_owner uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_mode
    WHEN 'private' THEN public.post_image_ref_ok(p_ref, 'private', p_owner)
    WHEN 'public'  THEN public.post_public_image_ok(p_ref, p_owner)
    ELSE false
  END;
$function$;

-- ── 3) 파생: 평문·사진(검증 없이도 안전 — 원고·롤백 변환에서도 쓴다) ─────────
-- 평문 파생(설계 4-10, src/lib/rich/doc.js docToPlain 과 같은 결과 — __fixtures__ 표본으로 대조):
-- 문단·소제목마다 한 줄(글 이어 붙임, hardBreak = 줄바꿈), 줄들을 \n 으로 잇고 끝의 \n 을 지운다.
-- 인용구·목록 안의 문단도 같은 방식(기호·번호 없음). 사진·묶음·파일·지도·구분선은 아무것도 내지 않는다.
-- 봉투({v, doc}) 또는 doc 노드 자체를 받는다.
CREATE OR REPLACE FUNCTION public.rich_doc_plain(p_doc jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  WITH RECURSIVE root(r) AS (
    SELECT CASE WHEN jsonb_typeof(p_doc) = 'object' AND p_doc->>'type' = 'doc' THEN p_doc
                WHEN jsonb_typeof(p_doc) = 'object' THEN p_doc->'doc' END
  ),
  -- 컨테이너(doc·인용구·목록·항목)만 내려간다. 문단·소제목은 잎(글은 아래 lines 에서 모은다).
  walk(node, path) AS (
    SELECT r, ARRAY[]::int[] FROM root WHERE jsonb_typeof(r) = 'object' AND r->>'type' = 'doc'
    UNION ALL
    SELECT c.value, w.path || c.ord::int
    FROM walk w
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(w.node->'content') = 'array' THEN w.node->'content' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS c(value, ord)
    WHERE w.node->>'type' IN ('doc', 'blockquote', 'bulletList', 'orderedList', 'listItem')
      AND jsonb_typeof(c.value) = 'object'
      AND c.value->>'type' IN ('blockquote', 'bulletList', 'orderedList', 'listItem', 'paragraph', 'heading')
  ),
  lines(path, txt) AS (
    SELECT w.path, coalesce((
      SELECT string_agg(CASE WHEN i.value->>'type' = 'text' AND jsonb_typeof(i.value->'text') = 'string' THEN i.value->>'text'
                             WHEN i.value->>'type' = 'hardBreak' THEN E'\n'
                             ELSE '' END, '' ORDER BY i.ord)
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(w.node->'content') = 'array' THEN w.node->'content' ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS i(value, ord)
      WHERE jsonb_typeof(i.value) = 'object'
    ), '')
    FROM walk w
    WHERE w.node->>'type' IN ('paragraph', 'heading')
  )
  SELECT coalesce(rtrim(string_agg(txt, E'\n' ORDER BY path), E'\n'), '') FROM lines;
$function$;

-- 문서 최상위의 사진 참조(단일 사진 + 묶음, 문서 순서, 중복 없음). doc.js docImages 와 같다.
CREATE OR REPLACE FUNCTION public.rich_doc_images(p_doc jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  WITH root(r) AS (
    SELECT CASE WHEN jsonb_typeof(p_doc) = 'object' AND p_doc->>'type' = 'doc' THEN p_doc
                WHEN jsonb_typeof(p_doc) = 'object' THEN p_doc->'doc' END
  ),
  blocks(value, ord) AS (
    SELECT b.value, b.ord
    FROM root CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r) = 'object' AND r->>'type' = 'doc' AND jsonb_typeof(r->'content') = 'array'
           THEN r->'content' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS b(value, ord)
  ),
  refs(ref, ord, sub) AS (
    SELECT b.value->'attrs'->>'src', b.ord, 0::bigint
    FROM blocks b
    WHERE jsonb_typeof(b.value) = 'object' AND b.value->>'type' = 'image'
      AND jsonb_typeof(b.value->'attrs') = 'object' AND jsonb_typeof(b.value->'attrs'->'src') = 'string'
    UNION ALL
    SELECT g.value #>> '{}', b.ord, g.ord
    FROM blocks b
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(b.value) = 'object' AND b.value->>'type' = 'gallery'
                AND jsonb_typeof(b.value->'attrs') = 'object' AND jsonb_typeof(b.value->'attrs'->'images') = 'array'
           THEN b.value->'attrs'->'images' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS g(value, ord)
    WHERE jsonb_typeof(g.value) = 'string'
  )
  SELECT coalesce(array_agg(ref ORDER BY first_seen), '{}')
  FROM (
    SELECT ref, min(rn) AS first_seen
    FROM (SELECT ref, row_number() OVER (ORDER BY ord, sub) AS rn FROM refs) x
    GROUP BY ref
  ) d;
$function$;

-- ── 4) 검증(설계 4장). 실패 = 'BAD_BODY_DOC'(DETAIL = 사유 코드, 화면 validateDoc 의 reason 과 같은 이름) ──
-- 순서: 바이트 → 봉투 → 명시적 스택 순회(자식을 넣기 전에 깊이·누계 노드 수 비교) → 노드 문법·토큰 → 사진·지도 개수.
-- 반환: plain(파생 평문), images(사진 참조, 문서 순서), files(4단계 전 항상 빈 배열), media(사진·묶음·파일·지도 노드 수 — 빈 글 판정용)
CREATE OR REPLACE FUNCTION public.rich_doc_check(p_doc jsonb, p_mode text, p_owner uuid,
  OUT plain text, OUT images text[], OUT files text[], OUT media int)
LANGUAGE plpgsql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- 한도·토큰(src/lib/rich/schema.js 와 같은 값 — schema.test.js 가 대조)
  c_doc_bytes       CONSTANT int := 524288;
  c_nodes           CONSTANT int := 10000;
  c_depth           CONSTANT int := 16;
  c_text_chars      CONSTANT int := 20000;
  c_marks           CONSTANT int := 6;
  c_images          CONSTANT int := 20;
  c_gallery_min     CONSTANT int := 2;
  c_gallery_max     CONSTANT int := 10;
  c_maps            CONSTANT int := 10;
  c_href_max        CONSTANT int := 2048;
  c_map_name_max    CONSTANT int := 120;
  c_map_address_max CONSTANT int := 300;
  c_map_url_max     CONSTANT int := 2048;
  c_place_id_min    CONSTANT int := 10;     -- PostgreSQL 정규식 반복 상한이 255 라 길이는 따로 본다
  c_place_id_max    CONSTANT int := 300;
  c_ordered_start_max CONSTANT int := 999;
  c_fonts     CONSTANT text[] := ARRAY['myeongjo', 'pen', 'dodum'];
  c_sizes     CONSTANT numeric[] := ARRAY[13, 15, 19, 24, 28];
  c_colors    CONSTANT text[] := ARRAY['#000000', '#555555', '#777777', '#ba0000', '#b85c00', '#36851e', '#00756a', '#0078cb', '#004e82', '#aa1f91', '#bb005c'];
  c_bg_colors CONSTANT text[] := ARRAY['#fff8b2', '#ffe3c8', '#ffcdc0', '#e3fdc8', '#c2f4db', '#b0f1ff', '#fdd5f5', '#e2e2e2'];
  c_aligns    CONSTANT text[] := ARRAY['center', 'right'];
  c_layouts   CONSTANT text[] := ARRAY['grid', 'slide', 'strip'];
  c_re_ctrl      CONSTANT text := '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]';
  c_re_ctrl_line CONSTANT text := '[\x01-\x1F\x7F]';
  c_re_href      CONSTANT text := '^https?://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*(:[0-9]{1,5})?([/?#][^\x01-\x20\x7F]*)?$';
  c_re_map_url   CONSTANT text := '^https://((maps\.app\.goo\.gl|maps\.google\.com)(/[^?#\x01-\x20\x7F]*)?|(goo\.gl|www\.google\.com|google\.com|www\.google\.co\.kr|google\.co\.kr)/maps(/[^?#\x01-\x20\x7F]*)?)([?#][^\x01-\x20\x7F]*)?$';
  c_re_place_id  CONSTANT text := '^[A-Za-z0-9_-]+$';
  -- 순회 스택(재귀 대신 반복). [노드, 부모 종류, 부모 안 순서, 깊이(doc = 0)]
  s_node  jsonb[] := '{}';
  s_ptype text[]  := '{}';
  s_idx   int[]   := '{}';
  s_depth int[]   := '{}';
  v_top   int := 1;
  v_count int := 1;                 -- 노드 수(doc 포함)
  v_node jsonb; v_t text; v_ptype text; v_idx int; v_depth int;
  v_attrs jsonb; v_v jsonb; v_s text; v_c jsonb; v_n int; v_min int; v_push boolean; i int; j int;
  v_marks jsonb; v_mark jsonb; v_mt text; v_seen text[]; v_any boolean;
  v_lat jsonb; v_lng jsonb; v_nlat numeric; v_nlng numeric; v_has_pid boolean; v_has_xy boolean;
  v_imgs  text[] := '{}';
  v_maps  int := 0;
  v_media int := 0;
BEGIN
  IF p_doc IS NULL OR jsonb_typeof(p_doc) <> 'object' THEN
    RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'ENVELOPE';
  END IF;
  -- 바이트 한도는 순회보다 먼저
  IF octet_length(p_doc::text) > c_doc_bytes THEN
    RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'TOO_LARGE';
  END IF;
  -- 봉투 { "v": 1, "doc": … } — 키는 정확히 v, doc
  IF NOT (p_doc ? 'v' AND p_doc ? 'doc') OR (p_doc - ARRAY['v', 'doc']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'ENVELOPE';
  END IF;
  IF jsonb_typeof(p_doc->'v') <> 'number' OR (p_doc->'v')::numeric <> 1 THEN
    RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'VERSION';
  END IF;

  s_node[1] := p_doc->'doc'; s_ptype[1] := ''; s_idx[1] := 0; s_depth[1] := 0;
  WHILE v_top > 0 LOOP
    v_node := s_node[v_top]; v_ptype := s_ptype[v_top]; v_idx := s_idx[v_top]; v_depth := s_depth[v_top];
    v_top := v_top - 1;
    IF jsonb_typeof(v_node) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'NODE';
    END IF;
    v_t := CASE WHEN jsonb_typeof(v_node->'type') = 'string' THEN v_node->>'type' END;
    v_push := false; v_min := 0;

    CASE v_t
    WHEN 'doc' THEN
      IF v_ptype <> '' THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'PLACEMENT'; END IF;
      IF (v_node - ARRAY['type', 'content']) <> '{}'::jsonb THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'KEYS'; END IF;
      v_push := true; v_min := 1;

    WHEN 'paragraph' THEN
      IF NOT (v_ptype IN ('doc', 'blockquote') OR (v_ptype = 'listItem' AND v_idx = 0)) THEN
        RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'PLACEMENT';
      END IF;
      IF (v_node - ARRAY['type', 'attrs', 'content']) <> '{}'::jsonb THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'KEYS'; END IF;
      v_attrs := v_node->'attrs';
      IF v_attrs IS NOT NULL AND jsonb_typeof(v_attrs) <> 'null' THEN
        IF jsonb_typeof(v_attrs) <> 'object' OR (v_attrs - 'textAlign') <> '{}'::jsonb THEN
          RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'ATTRS';
        END IF;
        v_v := v_attrs->'textAlign';
        IF v_v IS NOT NULL AND jsonb_typeof(v_v) <> 'null'
           AND (jsonb_typeof(v_v) <> 'string' OR NOT ((v_v #>> '{}') = ANY (c_aligns))) THEN
          RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'ALIGN';
        END IF;
      END IF;
      v_push := true;

    WHEN 'heading' THEN
      IF v_ptype <> 'doc' THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'PLACEMENT'; END IF;
      IF (v_node - ARRAY['type', 'attrs', 'content']) <> '{}'::jsonb THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'KEYS'; END IF;
      v_attrs := v_node->'attrs';
      IF jsonb_typeof(v_attrs) IS DISTINCT FROM 'object' OR (v_attrs - ARRAY['level', 'textAlign']) <> '{}'::jsonb
         OR jsonb_typeof(v_attrs->'level') IS DISTINCT FROM 'number' OR (v_attrs->'level')::numeric <> 2 THEN
        RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'HEADING';
      END IF;
      v_v := v_attrs->'textAlign';
      IF v_v IS NOT NULL AND jsonb_typeof(v_v) <> 'null'
         AND (jsonb_typeof(v_v) <> 'string' OR NOT ((v_v #>> '{}') = ANY (c_aligns))) THEN
        RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'ALIGN';
      END IF;
      v_push := true;

    WHEN 'blockquote' THEN
      IF v_ptype <> 'doc' THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'PLACEMENT'; END IF;
      IF (v_node - ARRAY['type', 'content']) <> '{}'::jsonb THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'KEYS'; END IF;
      v_push := true; v_min := 1;

    WHEN 'bulletList' THEN
      IF NOT (v_ptype IN ('doc', 'blockquote') OR (v_ptype = 'listItem' AND v_idx > 0)) THEN
        RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'PLACEMENT';
      END IF;
      IF (v_node - ARRAY['type', 'content']) <> '{}'::jsonb THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'KEYS'; END IF;
      v_push := true; v_min := 1;

    WHEN 'orderedList' THEN
      IF NOT (v_ptype IN ('doc', 'blockquote') OR (v_ptype = 'listItem' AND v_idx > 0)) THEN
        RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'PLACEMENT';
      END IF;
      IF (v_node - ARRAY['type', 'attrs', 'content']) <> '{}'::jsonb THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'KEYS'; END IF;
      v_attrs := v_node->'attrs';
      IF v_attrs IS NOT NULL AND jsonb_typeof(v_attrs) <> 'null' THEN
        IF jsonb_typeof(v_attrs) <> 'object' OR (v_attrs - ARRAY['start', 'type']) <> '{}'::jsonb THEN
          RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'ATTRS';
        END IF;
        v_v := v_attrs->'start';
        IF v_v IS NOT NULL AND jsonb_typeof(v_v) <> 'null'
           AND (jsonb_typeof(v_v) <> 'number' OR (v_v)::numeric <> trunc((v_v)::numeric)
                OR (v_v)::numeric < 1 OR (v_v)::numeric > c_ordered_start_max) THEN
          RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'LIST_START';
        END IF;
        v_v := v_attrs->'type';
        IF v_v IS NOT NULL AND jsonb_typeof(v_v) <> 'null' THEN
          RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'ATTRS';
        END IF;
      END IF;
      v_push := true; v_min := 1;

    WHEN 'listItem' THEN
      IF v_ptype NOT IN ('bulletList', 'orderedList') THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'PLACEMENT'; END IF;
      IF (v_node - ARRAY['type', 'content']) <> '{}'::jsonb THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'KEYS'; END IF;
      v_push := true; v_min := 1;

    WHEN 'horizontalRule' THEN
      IF v_ptype <> 'doc' THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'PLACEMENT'; END IF;
      IF (v_node - 'type') <> '{}'::jsonb THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'KEYS'; END IF;

    WHEN 'hardBreak' THEN
      IF v_ptype NOT IN ('paragraph', 'heading') THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'PLACEMENT'; END IF;
      IF (v_node - 'type') <> '{}'::jsonb THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'KEYS'; END IF;

    WHEN 'text' THEN
      IF v_ptype NOT IN ('paragraph', 'heading') THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'PLACEMENT'; END IF;
      IF (v_node - ARRAY['type', 'text', 'marks']) <> '{}'::jsonb THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'KEYS'; END IF;
      IF jsonb_typeof(v_node->'text') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'TEXT'; END IF;
      v_s := v_node->>'text';
      IF v_s = '' OR char_length(v_s) > c_text_chars OR v_s ~ c_re_ctrl THEN
        RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'TEXT';
      END IF;
      v_marks := v_node->'marks';
      IF v_marks IS NOT NULL THEN
        IF jsonb_typeof(v_marks) <> 'array' OR jsonb_array_length(v_marks) > c_marks THEN
          RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MARKS';
        END IF;
        v_seen := '{}';
        FOR j IN 0 .. jsonb_array_length(v_marks) - 1 LOOP
          v_mark := v_marks -> j;
          IF jsonb_typeof(v_mark) <> 'object' OR (v_mark - ARRAY['type', 'attrs']) <> '{}'::jsonb
             OR jsonb_typeof(v_mark->'type') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MARK';
          END IF;
          v_mt := v_mark->>'type';
          IF v_mt = ANY (v_seen) THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MARK_DUP'; END IF;
          v_seen := v_seen || v_mt;
          v_attrs := v_mark->'attrs';
          IF v_mt IN ('bold', 'italic', 'underline', 'strike') THEN
            IF v_attrs IS NOT NULL AND jsonb_typeof(v_attrs) <> 'null' AND v_attrs <> '{}'::jsonb THEN
              RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MARK_ATTRS';
            END IF;
          ELSIF v_mt = 'link' THEN
            IF jsonb_typeof(v_attrs) IS DISTINCT FROM 'object' OR (v_attrs - 'href') <> '{}'::jsonb
               OR jsonb_typeof(v_attrs->'href') IS DISTINCT FROM 'string'
               OR char_length(v_attrs->>'href') > c_href_max OR (v_attrs->>'href') !~ c_re_href THEN
              RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'LINK';
            END IF;
          ELSIF v_mt = 'textStyle' THEN
            IF jsonb_typeof(v_attrs) IS DISTINCT FROM 'object'
               OR (v_attrs - ARRAY['fontFamily', 'fontSize', 'color', 'backgroundColor']) <> '{}'::jsonb THEN
              RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'TEXT_STYLE';
            END IF;
            v_any := false;
            v_v := v_attrs->'fontFamily';
            IF v_v IS NOT NULL AND jsonb_typeof(v_v) <> 'null' THEN
              IF jsonb_typeof(v_v) <> 'string' OR NOT ((v_v #>> '{}') = ANY (c_fonts)) THEN
                RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'TEXT_STYLE';
              END IF;
              v_any := true;
            END IF;
            v_v := v_attrs->'fontSize';
            IF v_v IS NOT NULL AND jsonb_typeof(v_v) <> 'null' THEN
              IF jsonb_typeof(v_v) <> 'number' OR NOT ((v_v)::numeric = ANY (c_sizes)) THEN
                RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'TEXT_STYLE';
              END IF;
              v_any := true;
            END IF;
            v_v := v_attrs->'color';
            IF v_v IS NOT NULL AND jsonb_typeof(v_v) <> 'null' THEN
              IF jsonb_typeof(v_v) <> 'string' OR NOT ((v_v #>> '{}') = ANY (c_colors)) THEN
                RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'TEXT_STYLE';
              END IF;
              v_any := true;
            END IF;
            v_v := v_attrs->'backgroundColor';
            IF v_v IS NOT NULL AND jsonb_typeof(v_v) <> 'null' THEN
              IF jsonb_typeof(v_v) <> 'string' OR NOT ((v_v #>> '{}') = ANY (c_bg_colors)) THEN
                RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'TEXT_STYLE';
              END IF;
              v_any := true;
            END IF;
            IF NOT v_any THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'TEXT_STYLE'; END IF;
          ELSE
            RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MARK_TYPE';
          END IF;
        END LOOP;
      END IF;

    WHEN 'image' THEN
      IF v_ptype <> 'doc' THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'PLACEMENT'; END IF;
      IF p_mode IS DISTINCT FROM 'private' AND p_mode IS DISTINCT FROM 'public' THEN
        RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MEDIA_NOT_ALLOWED';
      END IF;
      IF (v_node - ARRAY['type', 'attrs']) <> '{}'::jsonb THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'KEYS'; END IF;
      v_attrs := v_node->'attrs';
      IF jsonb_typeof(v_attrs) IS DISTINCT FROM 'object' OR (v_attrs - 'src') <> '{}'::jsonb
         OR jsonb_typeof(v_attrs->'src') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'ATTRS';
      END IF;
      v_s := v_attrs->>'src';
      IF NOT public.rich_image_ref_ok(v_s, p_mode, p_owner) THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'IMAGE_REF'; END IF;
      IF v_s = ANY (v_imgs) THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'IMAGE_DUP'; END IF;
      v_imgs := v_imgs || v_s;
      IF cardinality(v_imgs) > c_images THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'TOO_MANY_IMAGES'; END IF;
      v_media := v_media + 1;

    WHEN 'gallery' THEN
      IF v_ptype <> 'doc' THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'PLACEMENT'; END IF;
      IF p_mode IS DISTINCT FROM 'private' AND p_mode IS DISTINCT FROM 'public' THEN
        RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MEDIA_NOT_ALLOWED';
      END IF;
      IF (v_node - ARRAY['type', 'attrs']) <> '{}'::jsonb THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'KEYS'; END IF;
      v_attrs := v_node->'attrs';
      IF jsonb_typeof(v_attrs) IS DISTINCT FROM 'object' OR (v_attrs - ARRAY['layout', 'images']) <> '{}'::jsonb
         OR jsonb_typeof(v_attrs->'layout') IS DISTINCT FROM 'string' OR NOT ((v_attrs->>'layout') = ANY (c_layouts))
         OR jsonb_typeof(v_attrs->'images') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_attrs->'images') < c_gallery_min OR jsonb_array_length(v_attrs->'images') > c_gallery_max THEN
        RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'GALLERY';
      END IF;
      v_c := v_attrs->'images';
      FOR j IN 0 .. jsonb_array_length(v_c) - 1 LOOP
        v_v := v_c -> j;
        IF jsonb_typeof(v_v) <> 'string' THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'IMAGE_REF'; END IF;
        v_s := v_v #>> '{}';
        IF NOT public.rich_image_ref_ok(v_s, p_mode, p_owner) THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'IMAGE_REF'; END IF;
        IF v_s = ANY (v_imgs) THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'IMAGE_DUP'; END IF;
        v_imgs := v_imgs || v_s;
        IF cardinality(v_imgs) > c_images THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'TOO_MANY_IMAGES'; END IF;
      END LOOP;
      v_media := v_media + 1;

    WHEN 'map' THEN
      IF v_ptype <> 'doc' THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'PLACEMENT'; END IF;
      IF (v_node - ARRAY['type', 'attrs']) <> '{}'::jsonb THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'KEYS'; END IF;
      v_attrs := v_node->'attrs';
      IF jsonb_typeof(v_attrs) IS DISTINCT FROM 'object'
         OR (v_attrs - ARRAY['placeId', 'name', 'address', 'lat', 'lng', 'url']) <> '{}'::jsonb THEN
        RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MAP';
      END IF;
      -- 이름(필수, 작성자가 확인한 표시 이름)
      IF jsonb_typeof(v_attrs->'name') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MAP_NAME'; END IF;
      v_s := v_attrs->>'name';
      IF v_s = '' OR char_length(v_s) > c_map_name_max OR v_s ~ c_re_ctrl_line THEN
        RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MAP_NAME';
      END IF;
      -- 구글 place ID
      v_v := v_attrs->'placeId';
      v_has_pid := false;
      IF v_v IS NOT NULL AND jsonb_typeof(v_v) <> 'null' THEN
        IF jsonb_typeof(v_v) <> 'string' OR char_length(v_v #>> '{}') < c_place_id_min
           OR char_length(v_v #>> '{}') > c_place_id_max OR (v_v #>> '{}') !~ c_re_place_id THEN
          RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MAP_PLACE';
        END IF;
        v_has_pid := true;
      END IF;
      -- 주소(작성자가 적은 경우만)
      v_v := v_attrs->'address';
      IF v_v IS NOT NULL AND jsonb_typeof(v_v) <> 'null'
         AND (jsonb_typeof(v_v) <> 'string' OR char_length(v_v #>> '{}') > c_map_address_max OR (v_v #>> '{}') ~ c_re_ctrl_line) THEN
        RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MAP_ADDRESS';
      END IF;
      -- 좌표: 둘 다 없거나 둘 다 범위 안 숫자, (0,0) 금지, 소수 6자리까지
      v_lat := v_attrs->'lat'; v_lng := v_attrs->'lng';
      v_has_xy := v_lat IS NOT NULL AND jsonb_typeof(v_lat) <> 'null';
      IF v_has_xy IS DISTINCT FROM (v_lng IS NOT NULL AND jsonb_typeof(v_lng) <> 'null') THEN
        RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MAP_COORD';
      END IF;
      IF v_has_xy THEN
        IF jsonb_typeof(v_lat) <> 'number' OR jsonb_typeof(v_lng) <> 'number' THEN
          RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MAP_COORD';
        END IF;
        v_nlat := (v_lat)::numeric; v_nlng := (v_lng)::numeric;
        IF v_nlat < -90 OR v_nlat > 90 OR v_nlng < -180 OR v_nlng > 180 OR (v_nlat = 0 AND v_nlng = 0)
           OR v_nlat <> round(v_nlat, 6) OR v_nlng <> round(v_nlng, 6) THEN
          RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MAP_COORD';
        END IF;
      END IF;
      -- 원 링크(기록용, href 로 쓰지 않는다)
      v_v := v_attrs->'url';
      IF v_v IS NOT NULL AND jsonb_typeof(v_v) <> 'null'
         AND (jsonb_typeof(v_v) <> 'string' OR char_length(v_v #>> '{}') > c_map_url_max OR (v_v #>> '{}') !~ c_re_map_url) THEN
        RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MAP_URL';
      END IF;
      IF NOT v_has_pid AND NOT v_has_xy THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'MAP_TARGET'; END IF;
      v_maps := v_maps + 1;
      IF v_maps > c_maps THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'TOO_MANY_MAPS'; END IF;
      v_media := v_media + 1;

    WHEN 'file' THEN
      -- PDF 첨부는 4단계(post-files 버킷·검증 표)와 함께 연다. 그 전까지 문서에 들어올 수 없다.
      RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'FILE_NOT_ENABLED';

    ELSE
      RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'NODE_TYPE';
    END CASE;

    IF v_push THEN
      v_c := v_node->'content';
      IF v_c IS NULL THEN
        IF v_min > 0 THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'CONTENT'; END IF;
      ELSE
        IF jsonb_typeof(v_c) <> 'array' THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'CONTENT'; END IF;
        v_n := jsonb_array_length(v_c);
        IF v_n < v_min THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'CONTENT'; END IF;
        IF v_n > 0 THEN
          -- 자식을 스택에 넣기 전에 깊이·누계 노드 수를 본다(넘으면 그 자리에서 중단)
          IF v_depth + 1 > c_depth THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'TOO_DEEP'; END IF;
          v_count := v_count + v_n;
          IF v_count > c_nodes THEN RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'TOO_MANY_NODES'; END IF;
          FOR i IN REVERSE v_n - 1 .. 0 LOOP
            v_top := v_top + 1;
            s_node[v_top] := v_c -> i;
            s_ptype[v_top] := v_t;
            s_idx[v_top] := i;
            s_depth[v_top] := v_depth + 1;
          END LOOP;
        END IF;
      END IF;
    END IF;
  END LOOP;

  plain  := public.rich_doc_plain(p_doc);
  images := v_imgs;
  files  := '{}';
  media  := v_media;
END;
$function$;

REVOKE ALL ON FUNCTION public.post_public_image_ok(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rich_image_ref_ok(text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rich_doc_plain(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rich_doc_images(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rich_doc_check(jsonb, text, uuid) FROM PUBLIC, anon;
-- 트리거(post_body_guard, 호출자 권한)가 로그인 회원 권한으로 부른다
GRANT EXECUTE ON FUNCTION public.post_public_image_ok(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rich_image_ref_ok(text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rich_doc_plain(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rich_doc_images(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rich_doc_check(jsonb, text, uuid) TO authenticated, service_role;

-- ── 5) 본문 트리거 통합 ───────────────────────────────────────────
-- 사진·문서·평문·파일 칸을 바꾸는 BEFORE 트리거는 이것 하나만 둔다(zz_author_nickname 은 작성자 이름만 건드린다).
-- 처리 순서(설계 3-3):
--   0) UPDATE 인데 관련 칸이 전부 그대로 → 통과
--   1) 서식 글의 문서를 비우면 → RICH_DOC_DOWNGRADE
--   2) 서식 글인데 문서는 그대로이고 평문·사진·파일 칸만 바뀜 → RICH_DOC_APP_UPDATE_REQUIRED
--      (열려 있던 옛 탭·테스트 APK 1.2.1 이 textarea 로 고친 경우. 행은 그대로 둔다)
--   3) 문서 없음(옛 글) → 옛 trg_post_images 규칙 그대로(images_private_cleanup_20260926.sql), file_urls = 빈 배열
--   4) 문서 있음 → rich_doc_check 로 검증(BAD_BODY_DOC) → 빈 글이면 EMPTY_BODY → 평문·사진 목록·대표 사진·파일 목록 덮어쓰기
-- 테이블별로 칸 이름이 달라 정적 칸 이름으로 나눈다. 칸이 없는 테이블의 문장은 그 테이블에서 실행되지 않는다
-- (PL/pgSQL 은 실행되는 문장만 해석한다 — set_author_from_nickname 과 같은 방식).
CREATE OR REPLACE FUNCTION public.post_body_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_images_max CONSTANT int := 20;      -- postLimits.js IMAGES_MAX
  -- 빈 글 판정 공백 문자(schema.js WS_CODEPOINTS = JS \s 와 같은 집합). 평문에서 이 문자를 모두 지워 빈 문자열이면 공백뿐.
  c_ws_chars CONSTANT text := chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760)
    || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202)
    || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279);
  v_tbl   text := TG_TABLE_NAME;
  v_mode  text;          -- 사진 규칙: private | public | none
  v_imgs  boolean;       -- 사진·파일 칸이 있는 테이블
  n_doc jsonb; o_doc jsonb; n_plain text; o_plain text;
  v_same_doc boolean; v_other boolean;
  v_plain text; v_images text[]; v_files text[]; v_media int;
BEGIN
  IF v_tbl = 'reviews' THEN
    v_mode := 'private'; v_imgs := true;
    n_doc := NEW.description_doc; n_plain := NEW.description;
    IF TG_OP = 'UPDATE' THEN o_doc := OLD.description_doc; o_plain := OLD.description; END IF;
  ELSIF v_tbl = 'crew_posts' THEN
    v_mode := 'private'; v_imgs := true;
    n_doc := NEW.content_doc; n_plain := NEW.content;
    IF TG_OP = 'UPDATE' THEN o_doc := OLD.content_doc; o_plain := OLD.content; END IF;
  ELSIF v_tbl = 'destinations' THEN
    v_mode := 'public'; v_imgs := true;
    n_doc := NEW.crew_comment_doc; n_plain := NEW.crew_comment;
    IF TG_OP = 'UPDATE' THEN o_doc := OLD.crew_comment_doc; o_plain := OLD.crew_comment; END IF;
  ELSIF v_tbl IN ('qna_posts', 'companion_posts') THEN
    v_mode := 'none'; v_imgs := false;
    n_doc := NEW.content_doc; n_plain := NEW.content;
    IF TG_OP = 'UPDATE' THEN o_doc := OLD.content_doc; o_plain := OLD.content; END IF;
  ELSE
    RAISE EXCEPTION 'post_body_guard: unsupported table %', v_tbl;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_same_doc := n_doc IS NOT DISTINCT FROM o_doc;
    v_other := n_plain IS DISTINCT FROM o_plain;
    IF v_imgs THEN
      v_other := v_other OR NEW.image_url IS DISTINCT FROM OLD.image_url
                 OR NEW.image_urls IS DISTINCT FROM OLD.image_urls
                 OR NEW.file_urls IS DISTINCT FROM OLD.file_urls;
    END IF;
    -- 0)
    IF v_same_doc AND NOT v_other AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
      RETURN NEW;
    END IF;
    -- 1)
    IF o_doc IS NOT NULL AND n_doc IS NULL THEN
      RAISE EXCEPTION 'RICH_DOC_DOWNGRADE';
    END IF;
    -- 2)
    IF o_doc IS NOT NULL AND v_same_doc AND v_other THEN
      RAISE EXCEPTION 'RICH_DOC_APP_UPDATE_REQUIRED';
    END IF;
  END IF;

  -- 3) 옛 글: 사진 규칙은 옛 trg_post_images 와 한 글자도 다르지 않게 옮겼다(인자 '20', 모드 private/public)
  IF n_doc IS NULL THEN
    IF v_imgs THEN
      IF NEW.image_urls IS NULL THEN NEW.image_urls := '{}'; END IF;
      IF array_ndims(NEW.image_urls) > 1 THEN RAISE EXCEPTION 'BAD_IMAGES'; END IF;
      -- 옛 화면(대표 사진 한 칸만 보냄) 호환: image_urls 는 그대로인데 image_url 만 바뀌면 '대표 자리'만 고친다.
      IF TG_OP = 'UPDATE' AND NEW.image_urls IS NOT DISTINCT FROM OLD.image_urls
         AND NEW.image_url IS DISTINCT FROM OLD.image_url THEN
        IF NOT public.post_image_ref_ok(NEW.image_url, v_mode, NEW.user_id) THEN
          NEW.image_urls := array_remove(OLD.image_urls, OLD.image_url);
        ELSIF NEW.image_url = ANY (OLD.image_urls) THEN
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
      IF cardinality(NEW.image_urls) > c_images_max THEN NEW.image_urls := NEW.image_urls[1:c_images_max]; END IF;
      NEW.image_url := NEW.image_urls[1];
      NEW.file_urls := '{}';
    END IF;
    RETURN NEW;
  END IF;

  -- 4) 서식 글
  SELECT c.plain, c.images, c.files, c.media INTO v_plain, v_images, v_files, v_media
  FROM public.rich_doc_check(n_doc, v_mode, NEW.user_id) c;
  IF translate(v_plain, c_ws_chars, '') = '' AND v_media = 0 THEN
    RAISE EXCEPTION 'EMPTY_BODY';
  END IF;
  IF v_tbl = 'reviews' THEN
    NEW.description := v_plain;
  ELSIF v_tbl = 'destinations' THEN
    NEW.crew_comment := v_plain;
  ELSE
    NEW.content := v_plain;
  END IF;
  IF v_imgs THEN
    NEW.image_urls := v_images;
    NEW.image_url := v_images[1];
    NEW.file_urls := v_files;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.post_body_guard() FROM PUBLIC, anon, authenticated;

-- 사진 트리거 3개를 없애고(규칙은 위 3번 분기로 옮김) 5개 게시판에 통합 트리거를 건다.
-- 걸리는 칸 = 작성자·평문·문서(·사진·파일). 이 칸이 SET 에 있으면(값이 같아도) 실행된다. 닉네임·조회수·상태만 바꾸는 UPDATE 는 안 돈다.
-- 함수 trg_post_images() 는 지우지 않는다(R0·R2 롤백이 이 함수로 트리거를 다시 만든다).
DROP TRIGGER IF EXISTS trg_post_images ON public.reviews;
DROP TRIGGER IF EXISTS trg_post_images ON public.crew_posts;
DROP TRIGGER IF EXISTS trg_post_images ON public.destinations;

DROP TRIGGER IF EXISTS trg_post_body ON public.reviews;
CREATE TRIGGER trg_post_body
  BEFORE INSERT OR UPDATE OF user_id, description, description_doc, image_url, image_urls, file_urls ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.post_body_guard();
DROP TRIGGER IF EXISTS trg_post_body ON public.crew_posts;
CREATE TRIGGER trg_post_body
  BEFORE INSERT OR UPDATE OF user_id, content, content_doc, image_url, image_urls, file_urls ON public.crew_posts
  FOR EACH ROW EXECUTE FUNCTION public.post_body_guard();
DROP TRIGGER IF EXISTS trg_post_body ON public.destinations;
CREATE TRIGGER trg_post_body
  BEFORE INSERT OR UPDATE OF user_id, crew_comment, crew_comment_doc, image_url, image_urls, file_urls ON public.destinations
  FOR EACH ROW EXECUTE FUNCTION public.post_body_guard();
DROP TRIGGER IF EXISTS trg_post_body ON public.qna_posts;
CREATE TRIGGER trg_post_body
  BEFORE INSERT OR UPDATE OF user_id, content, content_doc ON public.qna_posts
  FOR EACH ROW EXECUTE FUNCTION public.post_body_guard();
DROP TRIGGER IF EXISTS trg_post_body ON public.companion_posts;
CREATE TRIGGER trg_post_body
  BEFORE INSERT OR UPDATE OF user_id, content, content_doc ON public.companion_posts
  FOR EACH ROW EXECUTE FUNCTION public.post_body_guard();

-- ── 6) 원고(post_drafts) 가드·한도 ─────────────────────────────────
-- 서식 원고(data.fmt = 2)를 fmt 를 모르는 옛 화면이 덮어쓰면 지도·파일 참조가 사라진다 → 거부하고 행은 그대로 둔다.
-- 나머지는 post_drafts_20260925.sql 원형과 같다(R2 롤백은 이 함수를 원형 본문으로 되돌린다).
CREATE OR REPLACE FUNCTION public.post_drafts_before_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.data->>'fmt' = '2' AND coalesce(NEW.data->>'fmt', '') <> '2' THEN
    RAISE EXCEPTION 'DRAFT_APP_UPDATE_REQUIRED';
  END IF;
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

-- 서식 원고 직접 DELETE 가드(v3.1 2장·8장). 옛 화면은 등록 뒤 소비 삭제로 서식 원고를 지울 수 있다 → 막는다.
-- 통과: auth.uid() 없음(서버 키·계정 삭제 CASCADE·cron 정리), app.allow_sensitive = 'on'(request_account_deletion —
-- SECURITY DEFINER 지만 auth.uid() 가 그대로 남는다), ct.draft_v2 = '1'(새 화면의 RPC post_draft_delete).
CREATE OR REPLACE FUNCTION public.post_drafts_before_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.data->>'fmt' = '2'
     AND auth.uid() IS NOT NULL
     AND coalesce(current_setting('app.allow_sensitive', true), '') <> 'on'
     AND coalesce(current_setting('ct.draft_v2', true), '') <> '1' THEN
    RAISE EXCEPTION 'DRAFT_APP_UPDATE_REQUIRED';
  END IF;
  RETURN OLD;
END; $function$;
REVOKE ALL ON FUNCTION public.post_drafts_before_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS post_drafts_before_delete ON public.post_drafts;
CREATE TRIGGER post_drafts_before_delete BEFORE DELETE ON public.post_drafts
  FOR EACH ROW EXECUTE FUNCTION public.post_drafts_before_delete();

-- 새 화면의 원고 삭제(목록의 삭제 버튼 = p_rev NULL, 등록 뒤 소비 삭제 = 불러온 revision 일 때만).
-- 호출자 권한(RLS: 본인 원고만) + user_id 조건. 지운 id 를 돌려준다(없으면 NULL).
CREATE OR REPLACE FUNCTION public.post_draft_delete(p_id uuid, p_rev int DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  PERFORM set_config('ct.draft_v2', '1', true);
  DELETE FROM public.post_drafts
   WHERE id = p_id AND user_id = auth.uid() AND (p_rev IS NULL OR revision = p_rev)
  RETURNING id INTO v_id;
  PERFORM set_config('ct.draft_v2', '', true);
  RETURN v_id;
END; $function$;
REVOKE ALL ON FUNCTION public.post_draft_delete(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_draft_delete(uuid, int) TO authenticated;

-- 원고 크기: 문서 524,288 + 제목·말머리·지역·공개 여부·fmt(약 3천) + 여유 = 540,672(528KiB)
ALTER TABLE public.post_drafts DROP CONSTRAINT IF EXISTS post_drafts_data_check;
ALTER TABLE public.post_drafts ADD CONSTRAINT post_drafts_data_check
  CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 540672);

-- ── 7) 롤백 백업 표 + 사진 참조 보호 ──────────────────────────────
-- R2 롤백(rich_body_rollback_20260926.sql)이 서식 문서·서식 원고를 옮겨 두는 곳. 지금은 빈 표.
-- RLS 켜고 정책 없음 + 권한 회수 = 클라이언트(anon·authenticated) 접근 0.
CREATE TABLE IF NOT EXISTS public.rich_rollback_backup (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tbl text NOT NULL,                        -- reviews | crew_posts | destinations | qna_posts | companion_posts | post_drafts
  row_id uuid NOT NULL,
  doc jsonb,                                -- 글: 서식 문서 / 원고: data 통째
  file_urls text[] NOT NULL DEFAULT '{}',
  plain_at_backup text,                     -- 되살릴 때 "롤백 뒤 옛 화면에서 고쳐졌는지" 비교용
  images_at_backup text[] NOT NULL DEFAULT '{}',
  saved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rich_rollback_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rich_rollback_backup FROM PUBLIC, anon, authenticated;

-- 안 쓰는 사진 정리의 참조 목록에 백업 표를 더한다 — 백업에만 남은 사진이 지워지지 않게(v3.1 3장).
-- 4단계(PDF)에서 정규식에 sb://post-files/ 를 더한다.
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
    UNION ALL SELECT b::text FROM public.rich_rollback_backup b
  )
  SELECT DISTINCT (regexp_matches(src.txt, '(?:/storage/v1/object/public/images/|sb://post-images/)([A-Za-z0-9_.-]+)', 'g'))[1]
  FROM src;
$function$;
REVOKE ALL ON FUNCTION public.images_referenced_names() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.images_referenced_names() TO service_role;

COMMIT;

-- ── R0: 트리거만 되돌리기(서식 글·서식 원고가 0행일 때만) ─────────────
-- 설계 3-4. 서식 행이 하나라도 있으면 R0 를 쓰지 말고 rich_body_rollback_20260926.sql(R2, 쿠마님 확인 후)를 쓴다.
-- 새 칸·백업 표·RPC 는 남아도 무해하다(NULL·빈 배열·빈 표). 아래를 통째로 실행한다(조건이 안 맞으면 멈춘다).
-- 확인하기 전에 먼저 잠근다 — 확인과 트리거 교체 사이에 새 서식 글·원고가 들어오면 가드 없는 서식 행이 남는다(codex 9/26).
--
-- BEGIN;
-- SET LOCAL lock_timeout = '10s';
-- LOCK TABLE public.reviews, public.crew_posts, public.destinations, public.qna_posts, public.companion_posts, public.post_drafts
--   IN SHARE ROW EXCLUSIVE MODE;
-- DO $r0$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM public.reviews WHERE description_doc IS NOT NULL)
--      OR EXISTS (SELECT 1 FROM public.crew_posts WHERE content_doc IS NOT NULL)
--      OR EXISTS (SELECT 1 FROM public.destinations WHERE crew_comment_doc IS NOT NULL)
--      OR EXISTS (SELECT 1 FROM public.qna_posts WHERE content_doc IS NOT NULL)
--      OR EXISTS (SELECT 1 FROM public.companion_posts WHERE content_doc IS NOT NULL)
--      OR EXISTS (SELECT 1 FROM public.post_drafts WHERE data->>'fmt' = '2') THEN
--     RAISE EXCEPTION 'R0_NOT_ALLOWED: 서식 글·서식 원고가 있다 — rich_body_rollback_20260926.sql(R2)를 쓸 것';
--   END IF;
-- END $r0$;
-- DROP TRIGGER IF EXISTS trg_post_body ON public.reviews;
-- DROP TRIGGER IF EXISTS trg_post_body ON public.crew_posts;
-- DROP TRIGGER IF EXISTS trg_post_body ON public.destinations;
-- DROP TRIGGER IF EXISTS trg_post_body ON public.qna_posts;
-- DROP TRIGGER IF EXISTS trg_post_body ON public.companion_posts;
-- CREATE TRIGGER trg_post_images BEFORE INSERT OR UPDATE OF image_url, image_urls ON public.reviews
--   FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20', 'private');
-- CREATE TRIGGER trg_post_images BEFORE INSERT OR UPDATE OF image_url, image_urls ON public.crew_posts
--   FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20', 'private');
-- CREATE TRIGGER trg_post_images BEFORE INSERT OR UPDATE OF image_url, image_urls ON public.destinations
--   FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20', 'public');
-- DROP TRIGGER IF EXISTS post_drafts_before_delete ON public.post_drafts;
-- CREATE OR REPLACE FUNCTION public.post_drafts_before_update()
--  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- BEGIN
--   NEW.id := OLD.id;
--   NEW.user_id := OLD.user_id;
--   NEW.board := OLD.board;
--   NEW.scope := OLD.scope;
--   NEW.created_at := OLD.created_at;
--   NEW.revision := OLD.revision + 1;
--   NEW.updated_at := now();
--   RETURN NEW;
-- END; $function$;
-- COMMIT;

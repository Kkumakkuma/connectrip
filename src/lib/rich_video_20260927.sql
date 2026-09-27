-- 서식 문서에 영상 노드(video) 추가(2026-09-27 서식 편집기 2단계, 쿠마님 9/27 "후기나 게시판에 영상도 올릴 수 있게").
-- 설계: memory/connectrip_rich_editor/plan_stage2.md D장·J장(codex B6).
-- 운영 적용: 2026-09-27(apply_migration rich_video_20260927) → md5(prosrc) 6a076fa75e4cc5bb9be4de20cc624073 → 7516a48a0e198404bece3ce9776bbbc6.
--   운영 확인: 유튜브·인스타그램 통과, 짧은 ID(VIDEO_ID)·다른 제공자·남는 속성(VIDEO)·인용 안(PLACEMENT)·11개(TOO_MANY_VIDEOS) 거부.
--   되돌리기 = rich_video_rollback_20260927.sql(운영 리허설 통과).
--
-- video = { "type": "video", "attrs": { "provider": "youtube" | "instagram", "id": "<영상 ID>" } } — 문서 최상위만, 글당 10개.
--   유튜브 ID 11자 [A-Za-z0-9_-], 인스타그램 게시물 코드 5~64자. 원 주소·제목은 저장하지 않는다(화면이 공식 임베드 주소를 조립).
--   업로드가 아니라 링크라 게시판 사진 규칙(p_mode)과 무관하게 받는다(Q&A·자유·동행 포함). 평문은 내지 않고,
--   빈 글 판정에서는 내용(media)으로 센다(영상만 있는 글 허용 — 사진·지도와 같다).
--   화면 쪽 같은 규칙: src/lib/rich/schema.js(VIDEO_PROVIDERS, RE_SRC.youtubeId·instagramId, LIMITS.videos),
--   src/lib/rich/videoLink.js(videoAttrsError). schema.test.js 가 rich_body_20260926.sql(운영 상태) 값과 대조한다.
--
-- 적용 방식(rich_gallery_strip_20260926.sql 과 같다): 운영의 현재 rich_doc_check 정의를 읽어 아래 다섯 자리만 바꾼다.
-- 나머지(strip 포함)는 한 글자도 건드리지 않는다. 이미 적용됐으면(video 분기 있음) 건너뛴다. 바꿀 자리가 정확히 한 번이
-- 아니면 멈춘다(정의가 예상과 다름). rich_body_20260926.sql 의 함수 본문도 같은 내용으로 고쳐 두었다(파일 = 운영 상태).
--
-- 되돌리기(codex B6 — 순서 중요):
--   1) 영상 넣기 화면을 먼저 내린다(웹 배포 되돌리기 — 새 영상 글·원고가 더 생기지 않게).
--   2) 한 트랜잭션에서 게시판 5개 + post_drafts 를 잠그고 영상이 든 글·원고가 0인지 확인한다:
--        BEGIN;
--        LOCK TABLE public.reviews, public.crew_posts, public.destinations, public.qna_posts, public.companion_posts,
--                   public.post_drafts IN SHARE ROW EXCLUSIVE MODE;
--        SELECT (SELECT count(*) FROM public.reviews WHERE description_doc::text LIKE '%"type": "video"%')
--             + (SELECT count(*) FROM public.crew_posts WHERE content_doc::text LIKE '%"type": "video"%')
--             + (SELECT count(*) FROM public.destinations WHERE crew_comment_doc::text LIKE '%"type": "video"%')
--             + (SELECT count(*) FROM public.qna_posts WHERE content_doc::text LIKE '%"type": "video"%')
--             + (SELECT count(*) FROM public.companion_posts WHERE content_doc::text LIKE '%"type": "video"%') AS posts,
--               (SELECT count(*) FROM public.post_drafts WHERE data->>'fmt' = '2' AND data::text LIKE '%"type": "video"%') AS drafts;
--   3) 글이 0이면 같은 트랜잭션에서 아래 DO 블록의 치환을 거꾸로(v_new → v_old) 실행해 영상 추가 직전 정의(strip 포함)로 되돌리고 COMMIT.
--      글이 있으면 되돌리지 않는다(그 글을 먼저 영상 칸을 뺀 문서로 고친 뒤). 원고에 남은 영상은 영상을 모르는 화면이
--      불러올 때 정리(sanitizeDoc)로 빠지므로 막지 않아도 된다. 제목만 고치는 수정은 검증을 건너뛰므로(post_body_guard 0번)
--      되돌린 뒤에도 영상 글의 제목 수정은 된다 — 본문 수정만 막힌다.

BEGIN;

DO $video$
DECLARE
  v_def text;
  -- [옛 조각, 새 조각] 다섯 쌍. 옛 조각은 운영 정의에 정확히 한 번 있어야 한다.
  v_pairs text[][] := ARRAY[
    ARRAY[
      E'  c_maps            CONSTANT int := 10;\n',
      E'  c_maps            CONSTANT int := 10;\n  c_videos          CONSTANT int := 10;     -- 영상 링크(유튜브·인스타그램, 2026-09-27)\n'
    ],
    ARRAY[
      E'  c_layouts   CONSTANT text[] := ARRAY[''grid'', ''slide'', ''strip''];\n',
      E'  c_layouts   CONSTANT text[] := ARRAY[''grid'', ''slide'', ''strip''];\n  c_video_providers CONSTANT text[] := ARRAY[''youtube'', ''instagram''];\n'
    ],
    ARRAY[
      E'  c_re_place_id  CONSTANT text := ''^[A-Za-z0-9_-]+$'';\n',
      E'  c_re_place_id  CONSTANT text := ''^[A-Za-z0-9_-]+$'';\n  c_re_youtube_id   CONSTANT text := ''^[A-Za-z0-9_-]{11}$'';\n  c_re_instagram_id CONSTANT text := ''^[A-Za-z0-9_-]{5,64}$'';\n'
    ],
    ARRAY[
      E'  v_maps  int := 0;\n',
      E'  v_maps  int := 0;\n  v_videos int := 0;\n'
    ],
    ARRAY[
      E'    WHEN ''file'' THEN\n',
      E'    WHEN ''video'' THEN\n'
      || E'      -- 영상 링크(유튜브·인스타그램, 2026-09-27) — 업로드가 아니라 링크라 게시판 사진 규칙(p_mode)과 무관하게 받는다\n'
      || E'      IF v_ptype <> ''doc'' THEN RAISE EXCEPTION ''BAD_BODY_DOC'' USING DETAIL = ''PLACEMENT''; END IF;\n'
      || E'      IF (v_node - ARRAY[''type'', ''attrs'']) <> ''{}''::jsonb THEN RAISE EXCEPTION ''BAD_BODY_DOC'' USING DETAIL = ''KEYS''; END IF;\n'
      || E'      v_attrs := v_node->''attrs'';\n'
      || E'      IF jsonb_typeof(v_attrs) IS DISTINCT FROM ''object'' OR (v_attrs - ARRAY[''provider'', ''id'']) <> ''{}''::jsonb\n'
      || E'         OR jsonb_typeof(v_attrs->''provider'') IS DISTINCT FROM ''string''\n'
      || E'         OR NOT ((v_attrs->>''provider'') = ANY (c_video_providers)) THEN\n'
      || E'        RAISE EXCEPTION ''BAD_BODY_DOC'' USING DETAIL = ''VIDEO'';\n'
      || E'      END IF;\n'
      || E'      IF jsonb_typeof(v_attrs->''id'') IS DISTINCT FROM ''string''\n'
      || E'         OR ((v_attrs->>''provider'') = ''youtube'' AND (v_attrs->>''id'') !~ c_re_youtube_id)\n'
      || E'         OR ((v_attrs->>''provider'') = ''instagram'' AND (v_attrs->>''id'') !~ c_re_instagram_id) THEN\n'
      || E'        RAISE EXCEPTION ''BAD_BODY_DOC'' USING DETAIL = ''VIDEO_ID'';\n'
      || E'      END IF;\n'
      || E'      v_videos := v_videos + 1;\n'
      || E'      IF v_videos > c_videos THEN RAISE EXCEPTION ''BAD_BODY_DOC'' USING DETAIL = ''TOO_MANY_VIDEOS''; END IF;\n'
      || E'      v_media := v_media + 1;\n'
      || E'\n'
      || E'    WHEN ''file'' THEN\n'
    ]
  ];
  i int;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('public.rich_doc_check(jsonb, text, uuid)'::regprocedure) INTO v_def;
  IF position(E'    WHEN ''video'' THEN\n' IN v_def) > 0 THEN
    RAISE NOTICE 'rich_doc_check: video 분기가 이미 있다 — 건너뜀';
    RETURN;
  END IF;
  FOR i IN 1 .. array_length(v_pairs, 1) LOOP
    v_old := v_pairs[i][1];
    v_new := v_pairs[i][2];
    IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
      RAISE EXCEPTION 'rich_doc_check: % 번째 바꿀 자리를 정확히 한 번 찾지 못했다', i;
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END LOOP;
  EXECUTE v_def;
END $video$;

COMMIT;

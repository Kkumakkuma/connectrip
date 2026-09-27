-- 영상 노드 되돌리기 — rich_video_20260927.sql 의 역방향(2026-09-27 서식 편집기 2단계, codex 9/27 경미 지적).
-- 운영에 영상 분기를 넣은 뒤 문제가 생겨 빼야 할 때만 쓴다. 평소에는 실행하지 않는다.
--
-- 순서(codex B6 — 순서 중요):
--   1) 영상 넣기 화면을 먼저 내린다(웹 배포 되돌리기 — 새 영상 글·원고가 더 생기지 않게).
--   2) 이 파일을 실행한다. 한 트랜잭션에서 게시판 5개 + post_drafts 를 잠그고 영상이 든 글을 센다.
--      글이 1개라도 있으면 멈춘다(아무것도 바꾸지 않음) — 그 글을 영상 칸을 뺀 문서로 먼저 고친 뒤 다시 실행한다.
--      원고(post_drafts)에 남은 영상은 막지 않는다: 영상을 모르는 화면이 불러올 때 정리(sanitizeDoc)로 빠진다. 개수만 알린다.
--   3) 영상 분기가 없으면(이미 되돌렸거나 적용 전) 건너뛴다. 바꿀 자리가 정확히 한 번이 아니면 멈춘다(정의가 예상과 다름).
--   4) 되돌린 뒤 md5(prosrc) 가 영상 추가 직전 값 6a076fa75e4cc5bb9be4de20cc624073 과 같은지 확인한다.
--      (2026-09-27 운영 리허설 — 이 블록 끝에 예외를 던져 되돌림: 글 0·원고 0 → md5 6a076fa75e4cc5bb9be4de20cc624073, video 분기 없음)
--      rich_body_20260926.sql 의 함수 본문도 video 분기를 뺀 내용으로 되돌려 둔다(파일 = 운영 상태).
-- 제목만 고치는 수정은 검증을 건너뛰므로(post_body_guard 0번) 되돌린 뒤에도 영상 글의 제목 수정은 된다.

BEGIN;

LOCK TABLE public.reviews, public.crew_posts, public.destinations, public.qna_posts, public.companion_posts,
           public.post_drafts IN SHARE ROW EXCLUSIVE MODE;

DO $video_rollback$
DECLARE
  v_def text;
  -- rich_video_20260927.sql 과 똑같은 [옛 조각, 새 조각] 다섯 쌍(그 파일에서 그대로 옮김). 되돌릴 때는 새 조각이 정확히 한 번 있어야 한다.
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
  v_posts bigint;
  v_drafts bigint;
BEGIN
  SELECT (SELECT count(*) FROM public.reviews WHERE description_doc IS NOT NULL AND jsonb_path_exists(description_doc, 'lax $.** ? (@.type == "video")'))
       + (SELECT count(*) FROM public.crew_posts WHERE content_doc IS NOT NULL AND jsonb_path_exists(content_doc, 'lax $.** ? (@.type == "video")'))
       + (SELECT count(*) FROM public.destinations WHERE crew_comment_doc IS NOT NULL AND jsonb_path_exists(crew_comment_doc, 'lax $.** ? (@.type == "video")'))
       + (SELECT count(*) FROM public.qna_posts WHERE content_doc IS NOT NULL AND jsonb_path_exists(content_doc, 'lax $.** ? (@.type == "video")'))
       + (SELECT count(*) FROM public.companion_posts WHERE content_doc IS NOT NULL AND jsonb_path_exists(content_doc, 'lax $.** ? (@.type == "video")'))
    INTO v_posts;
  IF v_posts > 0 THEN
    RAISE EXCEPTION 'rich_doc_check 되돌리기 멈춤: 영상이 든 글이 % 개 있다 — 그 글의 영상 칸을 먼저 뺀다', v_posts;
  END IF;
  SELECT count(*) INTO v_drafts FROM public.post_drafts
   WHERE data->>'fmt' = '2' AND jsonb_path_exists(data, 'lax $.** ? (@.type == "video")');
  IF v_drafts > 0 THEN
    RAISE NOTICE '영상이 든 원고 % 개 — 불러올 때 화면 정리로 빠지므로 그대로 둔다', v_drafts;
  END IF;

  SELECT pg_get_functiondef('public.rich_doc_check(jsonb, text, uuid)'::regprocedure) INTO v_def;
  IF position(E'    WHEN ''video'' THEN\n' IN v_def) = 0 THEN
    RAISE NOTICE 'rich_doc_check: video 분기가 없다 — 건너뜀';
    RETURN;
  END IF;
  FOR i IN REVERSE array_length(v_pairs, 1) .. 1 LOOP
    v_old := v_pairs[i][1];
    v_new := v_pairs[i][2];
    IF (length(v_def) - length(replace(v_def, v_new, ''))) / length(v_new) <> 1 THEN
      RAISE EXCEPTION 'rich_doc_check 되돌리기: % 번째 자리를 정확히 한 번 찾지 못했다', i;
    END IF;
    v_def := replace(v_def, v_new, v_old);
  END LOOP;
  EXECUTE v_def;
END $video_rollback$;

COMMIT;

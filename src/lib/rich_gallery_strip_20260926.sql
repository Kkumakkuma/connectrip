-- 사진 묶음 레이아웃에 'strip'(옆으로 나열, 밀어서 보기) 추가(2026-09-26, 쿠마님 지시 — 글쓸 때 콜라주·한 장씩·옆으로 나열 중 고른다).
-- 앞 단계: rich_body_20260926.sql. 그 파일의 rich_doc_check 도 같은 값으로 고쳐 두었다(파일 = 운영 상태, schema.test.js 가 schema.js 와 대조).
-- 함수 본문 중 레이아웃 목록 한 줄만 바꾼다 — 나머지는 한 글자도 건드리지 않도록 운영의 현재 정의를 읽어 그 줄만 치환해 다시 만든다.
-- 이미 적용된 상태(새 줄 1번·옛 줄 0번)면 아무것도 하지 않는다. 그 밖에 옛 줄이 정확히 한 번이 아니면 멈춘다(정의가 예상과 다름).
-- 되돌리기: 아래 v_old·v_new 를 맞바꿔 실행한다(단, strip 묶음이 든 글이 있으면 그 글은 다음 수정 때 검증에 걸린다).

BEGIN;

DO $strip$
DECLARE
  v_old CONSTANT text := 'c_layouts   CONSTANT text[] := ARRAY[''grid'', ''slide''];';
  v_new CONSTANT text := 'c_layouts   CONSTANT text[] := ARRAY[''grid'', ''slide'', ''strip''];';
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.rich_doc_check(jsonb, text, uuid)'::regprocedure) INTO v_def;
  IF position(v_old IN v_def) = 0
     AND (length(v_def) - length(replace(v_def, v_new, ''))) / length(v_new) = 1 THEN
    RAISE NOTICE 'rich_doc_check: strip 이 이미 들어 있다 — 건너뜀';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'rich_doc_check: 레이아웃 목록 줄을 정확히 한 번 찾지 못했다(이미 적용됐는지 확인)';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $strip$;

COMMIT;

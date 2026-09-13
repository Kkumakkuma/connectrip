-- 2026-09-14 쿠마님 지시: 아이디(login_id)에서 밑줄(_) 제거 — 영문 소문자·숫자 4~20자만.
-- 클라이언트(src/lib/loginId.js)·서버(api/_login_id.js)의 LOGIN_ID_RE 와 동일 규칙으로 DB 를 맞춘다.
-- 적용 시점 실측: profiles 3행 중 밑줄 포함 login_id 0건 → 제약 강화에 걸리는 행 없음.
-- 원본 정의: src/lib/loginid_20260905.sql (CHECK profiles_login_id_format, normalize_login_id).

BEGIN;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_login_id_format;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_login_id_format
  CHECK (login_id IS NULL OR login_id ~ '^[a-z0-9]{4,20}$');

-- 운영 정의(2026-09-14 실측: LANGUAGE sql IMMUTABLE, search_path 설정 없음)와 같은 형태로 정규식만 바꾼다.
CREATE OR REPLACE FUNCTION public.normalize_login_id(p_raw TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lower(btrim(COALESCE(p_raw,''))) ~ '^[a-z0-9]{4,20}$'
              THEN lower(btrim(p_raw)) ELSE NULL END;
$$;

COMMIT;

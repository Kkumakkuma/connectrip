-- 앱 푸시 알림 골격 (2026-09-20, 쿠마님 10068: "앱에는 기능만 만들어 놓고 나중에 클라우드플레어 연결하면 바로 가능하게")
--
-- 구조
--   push_tokens  : 기기(FCM 토큰) ↔ 회원. 앱이 로그인·세션 복원 때 push_token_upsert 로 등록(갱신), 로그아웃 때 push_token_remove.
--   push_outbox  : 보낼 푸시 대기열. notifications 에 행이 생길 때 트리거가 (그 회원에게 등록된 기기가 있으면) 넣는다.
--                  문구를 복사해 두므로(스냅샷) 회원이 인앱 알림을 지워도 대기열은 그대로다(agy 검토).
--   발송 워커     : 나중에 붙일 Cloudflare Worker 가 service_role 로 sent_at IS NULL 을 읽어 FCM 으로 보내고
--                  sent_at / attempts / last_error 를 갱신한다. 워커가 없어도 사이트 알림(종 아이콘)은 그대로 동작한다.
--   push_purge   : pg_cron 매일 — 보낸 지 14일 지난 대기열, 하루 넘게 못 보낸 것(오래된 푸시는 보내 봐야 소용없고,
--                  워커를 처음 켤 때 밀린 알림이 한꺼번에 쏟아지는 사고를 막는다 — agy 검토), 90일 넘게 갱신 안 된 토큰(앱 삭제 등) 정리.
-- 클라이언트는 두 테이블에 직접 접근하지 않는다(RLS 켜고 정책 없음 = authenticated 차단, service_role 만 GRANT). RPC 로만.
-- 어떤 알림을 푸시할지는 notify_user 가 notification_prefs 로 이미 거른 뒤 notifications 에 넣으므로 여기서 다시 거르지 않는다.

CREATE TABLE IF NOT EXISTS public.push_tokens (
  token       text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform    text NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  app_version text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_tokens_user_idx ON public.push_tokens (user_id);
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.push_tokens TO service_role;   -- 발송 워커 전용

-- 같은 토큰이 다른 계정으로 로그인하면(한 기기에서 계정 전환) 토큰의 주인을 바꾼다 — 이전 계정 알림이 그 기기로 가면 안 된다.
-- 토큰 문자열만 알면 남의 기기를 내 계정에 붙일 수 있지만, FCM 토큰은 기기 밖으로 안 나가는 고엔트로피 값이라 실질 위험은 없다(agy 검토).
CREATE OR REPLACE FUNCTION public.push_token_upsert(p_token text, p_platform text, p_app_version text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_token IS NULL OR length(p_token) < 20 OR length(p_token) > 512 THEN RAISE EXCEPTION 'BAD_TOKEN'; END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('android', 'ios', 'web') THEN RAISE EXCEPTION 'BAD_PLATFORM'; END IF;
  INSERT INTO public.push_tokens (token, user_id, platform, app_version)
  VALUES (p_token, v_uid, p_platform, left(p_app_version, 40))
  ON CONFLICT (token) DO UPDATE
    SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, app_version = EXCLUDED.app_version, updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public.push_token_upsert(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_token_upsert(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.push_token_remove(p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  DELETE FROM public.push_tokens WHERE token = p_token AND user_id = auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.push_token_remove(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_token_remove(text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.push_outbox (
  id              bigserial PRIMARY KEY,
  notification_id uuid,                       -- notifications.id (FK 없음: 인앱 알림을 지워도 발송 기록은 남긴다)
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- 탈퇴하면 대기 중 푸시·문구도 같이 사라진다
  title           text NOT NULL,
  body            text NOT NULL,
  link            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  attempts        int NOT NULL DEFAULT 0,
  last_error      text
);
CREATE INDEX IF NOT EXISTS push_outbox_pending_idx ON public.push_outbox (created_at) WHERE sent_at IS NULL;
ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.push_outbox TO service_role;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.push_outbox_id_seq TO service_role;

-- 알림이 생기면 대기열에 넣는다. 등록된 기기가 없는 회원·문구가 빈 알림은 넣지 않는다(빈 푸시 방지). 실패해도 알림 INSERT 는 막지 않는다.
-- notify_user 가 쓰는 컬럼: user_id, type, message, link, post_id (notifications_20260903.sql).
CREATE OR REPLACE FUNCTION public.trg_push_outbox_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF COALESCE(btrim(NEW.message), '') <> ''
     AND EXISTS (SELECT 1 FROM public.push_tokens WHERE user_id = NEW.user_id) THEN
    INSERT INTO public.push_outbox (notification_id, user_id, title, body, link)
    VALUES (NEW.id, NEW.user_id, '커넥트립', left(COALESCE(NEW.message, ''), 200), NEW.link);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push outbox skipped: %', SQLERRM;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_push_outbox_enqueue() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_push_outbox_enqueue ON public.notifications;
CREATE TRIGGER trg_push_outbox_enqueue AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.trg_push_outbox_enqueue();

-- 정리 (개인정보: 알림 문구를 오래 쌓아 두지 않는다). 매일 18:40 UTC(03:40 KST), 다른 cron 과 겹치지 않는 시각.
CREATE OR REPLACE FUNCTION public.push_purge() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM public.push_outbox
   WHERE (sent_at IS NOT NULL AND sent_at < now() - interval '14 days')
      OR (sent_at IS NULL AND created_at < now() - interval '1 day');
  DELETE FROM public.push_tokens WHERE updated_at < now() - interval '90 days';
$$;
REVOKE ALL ON FUNCTION public.push_purge() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('push-purge', '40 18 * * *', 'select public.push_purge()')
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'push-purge');

-- 워커 붙일 때(나중에): service_role 로
--   먼저 한 번: DELETE FROM push_outbox WHERE sent_at IS NULL;  (워커 없던 동안 쌓인 건 보내지 않는다)
--   SELECT id, user_id, title, body, link FROM push_outbox
--    WHERE sent_at IS NULL AND attempts < 5 AND created_at > now() - interval '1 hour' ORDER BY created_at LIMIT 100;
--   (1시간 넘은 건 건너뛴다 — 워커가 한동안 죽었다 살아나도 밀린 알림을 한꺼번에 쏟지 않는다)
--   토큰: SELECT token FROM push_tokens WHERE user_id = $1;  (기기 여러 대면 토큰 여러 개 → FCM 일괄 발송)
--   성공: UPDATE push_outbox SET sent_at = now() WHERE id = $1;  실패: attempts = attempts + 1, last_error = $2
--   FCM 이 UNREGISTERED/INVALID_ARGUMENT 로 답한 토큰은 push_tokens 에서 지운다.
--   앱이 받는 data 필드: { link } — 탭하면 그 화면으로 이동(src/lib/push.js listenPushTap).

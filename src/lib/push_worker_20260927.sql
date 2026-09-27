-- 앱 푸시 발송기 연결 (2026-09-27). 골격 = push_20260920.sql.
-- 발송기는 Cloudflare Worker 대신 Supabase Edge Function push-send(supabase/functions/push-send/index.js, 설정 supabase/config.toml) —
-- 새 계정이 필요 없고 service_role 키가 Supabase 밖으로 나가지 않는다(쿠마님 결정 10480).
--
-- 흐름: notifications INSERT → (기존 트리거) push_outbox 적재 → (이 파일) 트랜잭션당 1번 push_kick
--       → pg_net 이 커밋 뒤 push-send 호출 → push_outbox_claim → FCM HTTP v1 → push_outbox_finish.
--       매분 push-sweep 이 재시도·누락을 챙긴다.
-- 보장 수준(codex 검토): FCM 에 멱등 키가 없어 "최소 1회, 드물게 중복"이다(접수 직후 워커가 죽으면 점유 기한 뒤 다시 보냄).
--   중복은 발송기가 android.notification.tag(=outbox id)를 붙여 알림창에서 덮어쓰므로 한 개로 보인다.
--   1시간 넘은 것·5번 시도한 것은 더 보내지 않고 last_error 를 남긴 채 둔다(하루 뒤 push_purge 가 지운다).
--   sent_at = "처리 끝난 시각"이다. last_error 가 있으면 일부/전부 못 보낸 채 끝난 것(토큰 없음·영구 오류).
-- 비밀(서비스 계정 JSON·워커 비밀·함수 URL)은 Vault 에만 있다 — 이 파일엔 값이 없다.
--   net·vault 스키마는 API(PostgREST)에 노출되지 않는다(2026-09-27 PGRST106 실측) → pg_net 대기표의 비밀 헤더를 회원이 못 읽는다.

-- 점유(claim) 소유권·기한, 재시도 시각, 기기별로 이미 보낸 토큰(한 기기만 성공한 경우 나머지만 재시도 — codex 검토)
ALTER TABLE public.push_outbox
  ADD COLUMN IF NOT EXISTS claim_id        uuid,
  ADD COLUMN IF NOT EXISTS claimed_until   timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS done_tokens     text[] NOT NULL DEFAULT '{}';
-- push_purge 의 '보낸 지 14일' 정리가 전체 스캔이 되지 않게(agy 검토). 대기 행은 기존 push_outbox_pending_idx 가 맡는다.
CREATE INDEX IF NOT EXISTS push_outbox_sent_idx ON public.push_outbox (sent_at) WHERE sent_at IS NOT NULL;

-- 발송기 설정(워커 비밀·서비스 계정). Edge Function 이 service_role 로만 부른다.
CREATE OR REPLACE FUNCTION public.push_worker_config() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'push_worker_secret'),
    'fcm_sa', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'push_fcm_sa'))
$$;
REVOKE ALL ON FUNCTION public.push_worker_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_worker_config() TO service_role;

-- 보낼 것 점유. 한 번에 최대 100행, 점유 기한(기본 120초) 동안 다른 발송기가 못 가져간다.
-- 토큰은 이미 보낸 기기(done_tokens)를 뺀 목록. CTE + FOR UPDATE SKIP LOCKED = 표준 큐 패턴(agy 검토).
CREATE OR REPLACE FUNCTION public.push_outbox_claim(p_limit int DEFAULT 20, p_lease_seconds int DEFAULT 120)
RETURNS TABLE (id bigint, claim_id uuid, title text, body text, link text, created_at timestamptz, tokens text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_claim uuid := gen_random_uuid();
  v_limit int := least(greatest(COALESCE(p_limit, 20), 1), 100);
  v_lease int := least(greatest(COALESCE(p_lease_seconds, 120), 30), 600);
BEGIN
  RETURN QUERY
  WITH target AS (
    SELECT o.id
      FROM public.push_outbox o
     WHERE o.sent_at IS NULL
       AND o.attempts < 5
       AND o.created_at > now() - interval '1 hour'
       AND (o.claimed_until IS NULL OR o.claimed_until < now())
       AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= now())
     ORDER BY o.created_at
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.push_outbox o
       SET claim_id = v_claim,
           claimed_until = now() + make_interval(secs => v_lease),
           attempts = o.attempts + 1
      FROM target
     WHERE o.id = target.id
    RETURNING o.id, o.user_id, o.title, o.body, o.link, o.created_at, o.done_tokens
  )
  SELECT u.id, v_claim, u.title, u.body, u.link, u.created_at,
         COALESCE((SELECT array_agg(t.token ORDER BY t.token)
                     FROM public.push_tokens t
                    WHERE t.user_id = u.user_id
                      AND NOT (t.token = ANY (u.done_tokens))), '{}'::text[])
    FROM upd u
   ORDER BY u.created_at;
END $$;
REVOKE ALL ON FUNCTION public.push_outbox_claim(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_outbox_claim(int, int) TO service_role;

-- 발송 결과 기록. 점유한 발송기(p_claim)만 자기 행을 바꿀 수 있다 — 기한이 지나 다른 발송기가 가져간 행은 건드리지 않는다(codex 검토).
-- p_results: [{"id":1,"finished_tokens":["..."],"done":true|false,"error":"503 UNAVAILABLE ...","retry_after":0}, ...]
--   finished_tokens = 이 알림이 끝난 기기(성공 + 400 같은 영구 실패) → done_tokens 에 쌓여 재시도 때 빠진다(codex 검토)
--   done=true  → 처리 끝(sent_at 기록, 오류가 있었으면 last_error 에 남김 — 앞선 오류 기록도 지우지 않는다)
--   done=false → 재시도: next_attempt_at = 지금 + max(Retry-After, 30초 × 2^(시도횟수-1)) → 30·60·120·240초
-- p_dead_tokens: FCM 이 UNREGISTERED 로 답한 토큰 — 앱 삭제·로그아웃(unregister)된 기기라 목록에서 지운다.
CREATE OR REPLACE FUNCTION public.push_outbox_finish(p_claim uuid, p_results jsonb, p_dead_tokens text[] DEFAULT '{}')
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  v_rows int;
  v_total int := 0;
BEGIN
  IF p_claim IS NULL THEN RAISE EXCEPTION 'CLAIM_REQUIRED'; END IF;
  IF COALESCE(cardinality(p_dead_tokens), 0) > 0 THEN
    DELETE FROM public.push_tokens t WHERE t.token = ANY (p_dead_tokens);
  END IF;
  FOR r IN
    SELECT x.id, COALESCE(x.finished_tokens, '{}'::text[]) AS finished_tokens, COALESCE(x.done, false) AS done,
           left(x.error, 300) AS error, least(greatest(COALESCE(x.retry_after, 0), 0), 3600) AS retry_after
      FROM jsonb_to_recordset(COALESCE(p_results, '[]'::jsonb))
        AS x(id bigint, finished_tokens text[], done boolean, error text, retry_after int)
  LOOP
    UPDATE public.push_outbox o
       SET done_tokens = ARRAY(SELECT DISTINCT d FROM unnest(o.done_tokens || r.finished_tokens) AS d),
           sent_at = CASE WHEN r.done THEN now() END,
           last_error = COALESCE(r.error, o.last_error),
           next_attempt_at = CASE WHEN r.done THEN NULL
                                  ELSE now() + make_interval(secs => greatest(r.retry_after, 30 * (2 ^ (greatest(o.attempts, 1) - 1))::int)) END,
           claim_id = NULL,
           claimed_until = NULL
     WHERE o.id = r.id
       AND o.claim_id = p_claim
       AND o.sent_at IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_total := v_total + v_rows;
  END LOOP;
  RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION public.push_outbox_finish(uuid, jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_outbox_finish(uuid, jsonb, text[]) TO service_role;

-- 발송기 깨우기. 비밀이 다 들어가기 전(활성화 전)에는 아무것도 하지 않는다.
-- 한 트랜잭션에서 여러 번 불려도(예: 같은편 알림 50건 루프) 호출은 1번 — 커밋 뒤 한 번의 발송이 전부 처리한다(agy·codex 검토).
-- pg_net 은 요청을 대기표에 적기만 하고 전송은 커밋 뒤 백그라운드가 한다 → 알림 INSERT 는 기다리지 않는다. 실패는 삼킨다.
CREATE OR REPLACE FUNCTION public.push_kick() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  IF current_setting('connecttrip.push_kicked', true) = '1' THEN RETURN; END IF;
  SELECT s.decrypted_secret INTO v_url FROM vault.decrypted_secrets s WHERE s.name = 'push_worker_url';
  SELECT s.decrypted_secret INTO v_secret FROM vault.decrypted_secrets s WHERE s.name = 'push_worker_secret';
  v_url := btrim(v_url);
  IF v_url IS NULL OR v_secret IS NULL
     OR NOT EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = 'push_fcm_sa') THEN
    RETURN;   -- 활성화 전(비밀 미입력)
  END IF;
  IF v_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/push-send/?$' THEN
    RAISE WARNING 'push kick skipped: unexpected worker url';   -- 조용히 멈추지 않게 흔적을 남긴다(agy 검토)
    RETURN;
  END IF;
  PERFORM set_config('connecttrip.push_kicked', '1', true);
  PERFORM net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 10000);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push kick skipped: %', SQLERRM;
END $$;
REVOKE ALL ON FUNCTION public.push_kick() FROM PUBLIC, anon, authenticated;

-- 대기열에 들어오면 바로 깨운다(문장 단위). push_kick 이 예외를 삼키므로 적재는 절대 되돌려지지 않는다.
CREATE OR REPLACE FUNCTION public.trg_push_outbox_kick() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.push_kick();
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.trg_push_outbox_kick() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_push_outbox_kick ON public.push_outbox;
CREATE TRIGGER trg_push_outbox_kick AFTER INSERT ON public.push_outbox
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_push_outbox_kick();

-- 매분 점검: 보낼 차례가 된 행(재시도 대기 끝남·점유 기한 지남)이 있을 때만 깨운다 — 할 일 없으면 호출 0.
CREATE OR REPLACE FUNCTION public.push_sweep() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.push_outbox o
              WHERE o.sent_at IS NULL
                AND o.attempts < 5
                AND o.created_at > now() - interval '1 hour'
                AND (o.claimed_until IS NULL OR o.claimed_until < now())
                AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= now())) THEN
    PERFORM public.push_kick();
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.push_sweep() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('push-sweep', '* * * * *', 'select public.push_sweep()')
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'push-sweep');

-- 활성화(값은 저장소에 없음 — 운영에서 한 번, 이 순서대로):
--   1) push-send 배포(verify_jwt=false, supabase/config.toml)  2) 이 SQL 적용(비밀이 없으니 kick·sweep 은 아무것도 안 한다)
--   3) vault: push_worker_secret(64자리 hex, DB 안에서 생성)·push_worker_url
--   4) DELETE FROM push_outbox WHERE sent_at IS NULL;  (발송기 없던 동안 쌓인 건 보내지 않는다 — push_20260920 계약)
--   5) vault: push_fcm_sa(서비스 계정 JSON) — 이 순간부터 push_kick 이 동작한다.
-- 비밀 교체: vault.update_secret 후 발송기 캐시(1분)가 지나면 반영된다.

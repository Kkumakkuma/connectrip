-- ============================================================================
-- 회원 간 쪽지(네이버 카페식 메일함) + 1:1 대화(대화방) + 당근식 중고거래·나눔 + 차단은 쪽지·대화만 (2026-09-06, 쿠마님 지시)
--   · 쪽지: 레거시 messages 재사용(받은/보낸 쪽지함, 읽음, 내 함에서만 삭제). 발송·읽음·삭제는 RPC 전용, 조회는 RPC(jsonb).
--   · 대화: chat_rooms(두 참여자 + 선택적 매물) / chat_messages. 방 열기·보내기·읽음은 RPC, 메시지 조회는 RLS(참여자).
--   · 차단(blocks): 쪽지·대화 발송만 막는다(게시글 숨김은 클라이언트에서 제거). 알림도 차단 관계면 안 간다(notify_user).
--   · 장터: 사진 여러 장(image_urls), 상태(active/reserved/sold), 조회수, 끌어올리기(refreshed_at), 찜(market_favorites).
-- 재실행 안전(멱등). 운영 데이터 실측(9/6 22:20): messages 0, market_listings 0, blocks 0.
-- ============================================================================

-- 장터 컬럼은 대화 RPC(SQL 함수, 생성 시 검증)가 참조하므로 맨 앞에서 먼저 만든다.
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS refreshed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS view_count int NOT NULL DEFAULT 0;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS bumped_at timestamptz;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- 0) 쪽지 -----------------------------------------------------------------------
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS receiver_deleted boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_messages_receiver_created ON public.messages (receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_created ON public.messages (sender_id, created_at DESC);
-- 쓰기는 전부 RPC. 조회는 RPC(jsonb)라 테이블 SELECT 도 회수한다(sender_id/receiver_id 가 profiles FK 2개라 임베드 모호 — PGRST201 재발 방지).
REVOKE ALL ON public.messages FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Users update own messages" ON public.messages;
DROP POLICY IF EXISTS "Users send messages" ON public.messages;

CREATE OR REPLACE FUNCTION public.message_send(p_to uuid, p_content text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_body text := btrim(COALESCE(p_content, ''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_to IS NULL OR p_to = v_uid THEN RAISE EXCEPTION 'BAD_REQUEST'; END IF;
  IF v_body = '' OR length(v_body) > 1000 THEN RAISE EXCEPTION 'BAD_CONTENT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_to AND COALESCE(p.is_banned, FALSE) = FALSE AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND COALESCE(p.is_banned, FALSE)) THEN RAISE EXCEPTION 'BANNED'; END IF;
  IF EXISTS (SELECT 1 FROM public.blocks b WHERE (b.blocker_id = v_uid AND b.blocked_id = p_to) OR (b.blocker_id = p_to AND b.blocked_id = v_uid)) THEN
    RAISE EXCEPTION 'BLOCKED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('message_send:' || v_uid::text, 0));   -- 동시 발송으로 상한을 넘지 않게
  IF (SELECT count(*) FROM public.messages m WHERE m.sender_id = v_uid AND m.created_at > now() - interval '1 day') >= 200 THEN
    RAISE EXCEPTION 'RATE_LIMIT';
  END IF;
  INSERT INTO public.messages (sender_id, receiver_id, content) VALUES (v_uid, p_to, v_body) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.message_send(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_send(uuid, text) TO authenticated;

-- 받은/보낸 쪽지함. 상대 표시명(nickname 우선)·아바타·읽음 여부. 내 함에서 지운 것은 빠진다.
CREATE OR REPLACE FUNCTION public.message_box(p_box text, p_limit int DEFAULT 100)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'content', m.content, 'created_at', m.created_at, 'read_at', m.read_at,
           'other_id', o.id, 'other_name', COALESCE(o.nickname, o.name, '탈퇴한 회원'), 'other_avatar', o.avatar_url,
           'other_crew', (o.user_type = 'crew' AND COALESCE(o.crew_verified, FALSE)),
           'mine', (m.sender_id = auth.uid())
         ) ORDER BY m.created_at DESC), '[]'::jsonb)
    FROM (SELECT * FROM public.messages m
           WHERE auth.uid() IS NOT NULL
             AND ((p_box = 'in'  AND m.receiver_id = auth.uid() AND NOT m.receiver_deleted)
               OR (p_box = 'out' AND m.sender_id   = auth.uid() AND NOT m.sender_deleted))
           ORDER BY m.created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 300)) m
    LEFT JOIN public.profiles o ON o.id = CASE WHEN p_box = 'in' THEN m.sender_id ELSE m.receiver_id END;
$$;
REVOKE ALL ON FUNCTION public.message_box(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_box(text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.message_mark_read(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  UPDATE public.messages SET read_at = COALESCE(read_at, now()) WHERE id = p_id AND receiver_id = auth.uid();
  GET DIAGNOSTICS v_n = ROW_COUNT; RETURN v_n > 0;
END $$;
REVOKE ALL ON FUNCTION public.message_mark_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_mark_read(uuid) TO authenticated;

-- 내 함에서만 지운다. 양쪽 다 지우면 행 삭제.
CREATE OR REPLACE FUNCTION public.message_delete(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_n int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  UPDATE public.messages SET
    sender_deleted   = sender_deleted   OR (sender_id   = v_uid),
    receiver_deleted = receiver_deleted OR (receiver_id = v_uid)
  WHERE id = p_id AND (sender_id = v_uid OR receiver_id = v_uid);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public.messages WHERE id = p_id AND sender_deleted AND receiver_deleted;
  RETURN v_n > 0;
END $$;
REVOKE ALL ON FUNCTION public.message_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_delete(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.message_unread_count()
RETURNS int LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM public.messages m
   WHERE auth.uid() IS NOT NULL AND m.receiver_id = auth.uid() AND m.read_at IS NULL AND NOT m.receiver_deleted;
$$;
REVOKE ALL ON FUNCTION public.message_unread_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_unread_count() TO authenticated;

-- 쪽지 알림(항상). 링크는 쪽지함.
CREATE OR REPLACE FUNCTION public.trg_notify_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.notify_user(NEW.receiver_id, 'message', 'message', '새 쪽지가 도착했습니다', '/messages', NEW.id, NEW.sender_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify trigger skipped: %', SQLERRM;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.trg_notify_message() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_message ON public.messages;
CREATE TRIGGER trg_notify_message AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.trg_notify_message();

-- 1) 대화방 -------------------------------------------------------------------
-- kind: 'dm' = 회원 간 1:1 대화(둘 사이 1개), 'listing' = 매물 대화(매물마다 구매자·판매자 1개).
-- 매물이 지워져도 대화는 남는다(listing_id 만 NULL, kind 는 유지 → dm 방과 섞이지 않는다).
CREATE TABLE IF NOT EXISTS public.chat_rooms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL DEFAULT 'dm' CHECK (kind IN ('dm','listing')),
  listing_id      uuid REFERENCES public.market_listings(id) ON DELETE SET NULL,
  user_lo         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_hi         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message    text,
  lo_last_read_at timestamptz NOT NULL DEFAULT now(),
  hi_last_read_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_lo < user_hi)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_rooms_dm ON public.chat_rooms (user_lo, user_hi) WHERE kind = 'dm';
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_rooms_listing ON public.chat_rooms (listing_id, user_lo, user_hi) WHERE kind = 'listing' AND listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_rooms_lo ON public.chat_rooms (user_lo, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_hi ON public.chat_rooms (user_hi, last_message_at DESC);
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_rooms FROM PUBLIC, anon, authenticated;   -- 목록은 RPC(jsonb)

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    uuid NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content    text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON public.chat_messages (room_id, created_at, id);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_messages TO authenticated;   -- 참여자만(정책). 쓰기는 RPC.
DROP POLICY IF EXISTS "Read chat messages" ON public.chat_messages;
-- 참여자 판정 헬퍼. chat_rooms 는 authenticated 에게 잠겨 있어 정책 서브쿼리가 "permission denied for table chat_rooms" 를 내므로
-- SECURITY DEFINER 로 내 방 id 집합만 돌려준다(역할 시뮬레이션에서 실측, 2026-09-06 v2).
CREATE OR REPLACE FUNCTION public.chat_my_rooms()
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT r.id FROM public.chat_rooms r WHERE auth.uid() IS NOT NULL AND auth.uid() IN (r.user_lo, r.user_hi);
$$;
REVOKE ALL ON FUNCTION public.chat_my_rooms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_my_rooms() TO authenticated;
CREATE POLICY "Read chat messages" ON public.chat_messages FOR SELECT
  USING (room_id IN (SELECT public.chat_my_rooms()));

-- 두 사람 사이 차단 관계(양방향)
CREATE OR REPLACE FUNCTION public.chat_blocked(p_a uuid, p_b uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.blocks b WHERE (b.blocker_id = p_a AND b.blocked_id = p_b) OR (b.blocker_id = p_b AND b.blocked_id = p_a));
$$;
REVOKE ALL ON FUNCTION public.chat_blocked(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 방 열기(없으면 만들고 있으면 그 방). 매물 방은 매물의 판매자와 상대 사이에만.
CREATE OR REPLACE FUNCTION public.chat_open(p_user uuid, p_listing uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_lo uuid; v_hi uuid; v_id uuid; v_seller uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_user IS NULL OR p_user = v_uid THEN RAISE EXCEPTION 'BAD_REQUEST'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user AND COALESCE(p.is_banned, FALSE) = FALSE AND p.deleted_at IS NULL) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND COALESCE(p.is_banned, FALSE)) THEN RAISE EXCEPTION 'BANNED'; END IF;
  IF public.chat_blocked(v_uid, p_user) THEN RAISE EXCEPTION 'BLOCKED'; END IF;
  IF p_listing IS NOT NULL THEN
    SELECT user_id INTO v_seller FROM public.market_listings WHERE id = p_listing;
    IF v_seller IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF v_seller <> v_uid AND v_seller <> p_user THEN RAISE EXCEPTION 'BAD_REQUEST'; END IF;
  END IF;
  v_lo := LEAST(v_uid, p_user); v_hi := GREATEST(v_uid, p_user);
  IF p_listing IS NULL THEN
    SELECT id INTO v_id FROM public.chat_rooms WHERE kind = 'dm' AND user_lo = v_lo AND user_hi = v_hi;
    IF v_id IS NULL THEN
      INSERT INTO public.chat_rooms (kind, listing_id, user_lo, user_hi) VALUES ('dm', NULL, v_lo, v_hi)
      ON CONFLICT (user_lo, user_hi) WHERE kind = 'dm' DO NOTHING RETURNING id INTO v_id;
      IF v_id IS NULL THEN SELECT id INTO v_id FROM public.chat_rooms WHERE kind = 'dm' AND user_lo = v_lo AND user_hi = v_hi; END IF;
    END IF;
  ELSE
    SELECT id INTO v_id FROM public.chat_rooms WHERE kind = 'listing' AND listing_id = p_listing AND user_lo = v_lo AND user_hi = v_hi;
    IF v_id IS NULL THEN
      INSERT INTO public.chat_rooms (kind, listing_id, user_lo, user_hi) VALUES ('listing', p_listing, v_lo, v_hi)
      ON CONFLICT (listing_id, user_lo, user_hi) WHERE kind = 'listing' AND listing_id IS NOT NULL DO NOTHING RETURNING id INTO v_id;
      IF v_id IS NULL THEN SELECT id INTO v_id FROM public.chat_rooms WHERE kind = 'listing' AND listing_id = p_listing AND user_lo = v_lo AND user_hi = v_hi; END IF;
    END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.chat_open(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_open(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_send(p_room uuid, p_content text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_room public.chat_rooms%ROWTYPE; v_other uuid; v_id uuid; v_body text := btrim(COALESCE(p_content, ''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF v_body = '' OR length(v_body) > 2000 THEN RAISE EXCEPTION 'BAD_CONTENT'; END IF;
  SELECT * INTO v_room FROM public.chat_rooms WHERE id = p_room;
  IF v_room.id IS NULL OR v_uid NOT IN (v_room.user_lo, v_room.user_hi) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_other := CASE WHEN v_room.user_lo = v_uid THEN v_room.user_hi ELSE v_room.user_lo END;
  IF public.chat_blocked(v_uid, v_other) THEN RAISE EXCEPTION 'BLOCKED'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND COALESCE(p.is_banned, FALSE)) THEN RAISE EXCEPTION 'BANNED'; END IF;
  IF (SELECT count(*) FROM public.chat_messages m WHERE m.sender_id = v_uid AND m.created_at > now() - interval '1 hour') >= 500 THEN
    RAISE EXCEPTION 'RATE_LIMIT';
  END IF;
  INSERT INTO public.chat_messages (room_id, sender_id, content) VALUES (p_room, v_uid, v_body) RETURNING id INTO v_id;
  UPDATE public.chat_rooms SET last_message = left(v_body, 120), last_message_at = now(),
         lo_last_read_at = CASE WHEN user_lo = v_uid THEN now() ELSE lo_last_read_at END,
         hi_last_read_at = CASE WHEN user_hi = v_uid THEN now() ELSE hi_last_read_at END
   WHERE id = p_room;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.chat_send(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_send(uuid, text) TO authenticated;

-- 읽음: 화면에 실제로 표시한 마지막 메시지 시각(p_until)까지. 없으면 지금. 종 알림(그 방)도 같이 읽음 처리.
CREATE OR REPLACE FUNCTION public.chat_mark_read(p_room uuid, p_until timestamptz DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_n int; v_until timestamptz := LEAST(COALESCE(p_until, now()), now());
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  UPDATE public.chat_rooms SET
    lo_last_read_at = CASE WHEN user_lo = v_uid THEN GREATEST(lo_last_read_at, v_until) ELSE lo_last_read_at END,
    hi_last_read_at = CASE WHEN user_hi = v_uid THEN GREATEST(hi_last_read_at, v_until) ELSE hi_last_read_at END
  WHERE id = p_room AND v_uid IN (user_lo, user_hi);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    UPDATE public.notifications SET read_at = now() WHERE user_id = v_uid AND type = 'message' AND post_id = p_room AND read_at IS NULL;
  END IF;
  RETURN v_n > 0;
END $$;
REVOKE ALL ON FUNCTION public.chat_mark_read(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_mark_read(uuid, timestamptz) TO authenticated;

-- 내 대화방 목록(상대·매물·마지막 메시지·안 읽은 수·차단 여부)
CREATE OR REPLACE FUNCTION public.chat_rooms_list()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'kind', r.kind, 'listing_id', r.listing_id, 'created_at', r.created_at,
           'last_message', r.last_message, 'last_message_at', r.last_message_at,
           'other_id', o.id, 'other_name', COALESCE(o.nickname, o.name, '탈퇴한 회원'), 'other_avatar', o.avatar_url,
           'other_crew', (o.user_type = 'crew' AND COALESCE(o.crew_verified, FALSE)),
           'listing_title', l.title, 'listing_image', COALESCE(l.image_urls[1], l.image_url), 'listing_price', l.price, 'listing_type', l.type, 'listing_status', l.status,
           'unread', (SELECT count(*) FROM public.chat_messages m
                       WHERE m.room_id = r.id AND m.sender_id <> auth.uid()
                         AND m.created_at > CASE WHEN r.user_lo = auth.uid() THEN r.lo_last_read_at ELSE r.hi_last_read_at END),
           'blocked_by_me', EXISTS (SELECT 1 FROM public.blocks b WHERE b.blocker_id = auth.uid() AND b.blocked_id = o.id),
           'blocked', public.chat_blocked(auth.uid(), o.id)
         ) ORDER BY r.last_message_at DESC), '[]'::jsonb)
    FROM public.chat_rooms r
    LEFT JOIN public.profiles o ON o.id = CASE WHEN r.user_lo = auth.uid() THEN r.user_hi ELSE r.user_lo END
    LEFT JOIN public.market_listings l ON l.id = r.listing_id
   WHERE auth.uid() IS NOT NULL AND auth.uid() IN (r.user_lo, r.user_hi);
$$;
REVOKE ALL ON FUNCTION public.chat_rooms_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_rooms_list() TO authenticated;

-- 방 하나의 헤더 정보(방 화면 진입용)
CREATE OR REPLACE FUNCTION public.chat_room_info(p_room uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
           'id', r.id, 'kind', r.kind, 'listing_id', r.listing_id,
           'other_id', o.id, 'other_name', COALESCE(o.nickname, o.name, '탈퇴한 회원'), 'other_avatar', o.avatar_url,
           'other_crew', (o.user_type = 'crew' AND COALESCE(o.crew_verified, FALSE)),
           'listing_title', l.title, 'listing_image', COALESCE(l.image_urls[1], l.image_url), 'listing_price', l.price, 'listing_type', l.type, 'listing_status', l.status,
           'listing_seller', l.user_id,
           'blocked_by_me', EXISTS (SELECT 1 FROM public.blocks b WHERE b.blocker_id = auth.uid() AND b.blocked_id = o.id),
           'blocked', public.chat_blocked(auth.uid(), o.id)
         )
    FROM public.chat_rooms r
    LEFT JOIN public.profiles o ON o.id = CASE WHEN r.user_lo = auth.uid() THEN r.user_hi ELSE r.user_lo END
    LEFT JOIN public.market_listings l ON l.id = r.listing_id
   WHERE r.id = p_room AND auth.uid() IS NOT NULL AND auth.uid() IN (r.user_lo, r.user_hi);
$$;
REVOKE ALL ON FUNCTION public.chat_room_info(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_room_info(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_unread_count()
RETURNS int LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(sum((SELECT count(*) FROM public.chat_messages m
                        WHERE m.room_id = r.id AND m.sender_id <> auth.uid()
                          AND m.created_at > CASE WHEN r.user_lo = auth.uid() THEN r.lo_last_read_at ELSE r.hi_last_read_at END)), 0)::int
    FROM public.chat_rooms r
   WHERE auth.uid() IS NOT NULL AND auth.uid() IN (r.user_lo, r.user_hi);
$$;
REVOKE ALL ON FUNCTION public.chat_unread_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_unread_count() TO authenticated;

-- 대화 알림(항상). 링크는 그 방.
CREATE OR REPLACE FUNCTION public.trg_notify_chat_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_room public.chat_rooms%ROWTYPE; v_other uuid;
BEGIN
  SELECT * INTO v_room FROM public.chat_rooms WHERE id = NEW.room_id;
  IF v_room.id IS NULL THEN RETURN NEW; END IF;
  v_other := CASE WHEN v_room.user_lo = NEW.sender_id THEN v_room.user_hi ELSE v_room.user_lo END;
  -- 같은 방의 안 읽은 알림이 이미 있으면 다시 만들지 않는다(연속 메시지 알림 남발 방지)
  IF NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = v_other AND n.type = 'message' AND n.post_id = NEW.room_id AND n.read_at IS NULL) THEN
    PERFORM public.notify_user(v_other, 'message', 'message', '새 대화 메시지가 도착했습니다', '/chat/' || NEW.room_id::text, NEW.room_id, NEW.sender_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify trigger skipped: %', SQLERRM;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.trg_notify_chat_message() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_chat_message ON public.chat_messages;
CREATE TRIGGER trg_notify_chat_message AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.trg_notify_chat_message();

-- 2) 당근식 장터 --------------------------------------------------------------------
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS refreshed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS view_count int NOT NULL DEFAULT 0;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS bumped_at timestamptz;
UPDATE public.market_listings SET status = 'active' WHERE status IS NULL OR status NOT IN ('active','reserved','sold');
ALTER TABLE public.market_listings DROP CONSTRAINT IF EXISTS market_listings_status_check;
ALTER TABLE public.market_listings ADD CONSTRAINT market_listings_status_check CHECK (status IN ('active','reserved','sold'));
CREATE INDEX IF NOT EXISTS idx_market_listings_type_refreshed ON public.market_listings (type, refreshed_at DESC);
-- 대표 이미지(image_url)는 image_urls 첫 장과 같게 유지
CREATE OR REPLACE FUNCTION public.trg_market_listing_images() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.image_urls IS NULL THEN NEW.image_urls := '{}'; END IF;
  IF array_length(NEW.image_urls, 1) IS NULL AND NEW.image_url IS NOT NULL THEN NEW.image_urls := ARRAY[NEW.image_url]; END IF;
  IF array_length(NEW.image_urls, 1) > 5 THEN NEW.image_urls := NEW.image_urls[1:5]; END IF;
  NEW.image_url := NEW.image_urls[1];
  IF TG_OP = 'INSERT' THEN NEW.refreshed_at := now(); NEW.view_count := 0; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_market_listing_images ON public.market_listings;
CREATE TRIGGER trg_market_listing_images BEFORE INSERT OR UPDATE OF image_url, image_urls ON public.market_listings
  FOR EACH ROW EXECUTE FUNCTION public.trg_market_listing_images();

CREATE TABLE IF NOT EXISTS public.market_favorites (
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.market_listings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_market_favorites_listing ON public.market_favorites (listing_id);
ALTER TABLE public.market_favorites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_favorites FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.market_favorites TO authenticated;
DROP POLICY IF EXISTS "Read own favorites" ON public.market_favorites;
CREATE POLICY "Read own favorites" ON public.market_favorites FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Create own favorites" ON public.market_favorites;
CREATE POLICY "Create own favorites" ON public.market_favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Delete own favorites" ON public.market_favorites;
CREATE POLICY "Delete own favorites" ON public.market_favorites FOR DELETE USING (auth.uid() = user_id);

-- 매물별 찜·대화 수(목록·상세 표시)
CREATE OR REPLACE FUNCTION public.market_listing_stats(p_ids uuid[])
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_object_agg(x.id, jsonb_build_object('favorites', x.favs, 'chats', x.chats, 'mine_fav', x.mine_fav)), '{}'::jsonb)
    FROM (SELECT l.id,
                 (SELECT count(*) FROM public.market_favorites f WHERE f.listing_id = l.id) AS favs,
                 (SELECT count(*) FROM public.chat_rooms r WHERE r.listing_id = l.id) AS chats,
                 EXISTS (SELECT 1 FROM public.market_favorites f WHERE f.listing_id = l.id AND f.user_id = auth.uid()) AS mine_fav
            FROM public.market_listings l WHERE l.id = ANY(COALESCE(p_ids, '{}')) LIMIT 200) x;
$$;
REVOKE ALL ON FUNCTION public.market_listing_stats(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_listing_stats(uuid[]) TO authenticated;

-- 포인트로 결제된 매물(paid_at)은 거래완료로 고정(재판매 반복 결제 방지). 수동 거래완료는 되돌릴 수 있다.
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS paid_at timestamptz;
CREATE OR REPLACE FUNCTION public.market_set_status(p_listing uuid, p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n int; v_paid timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_status NOT IN ('active','reserved','sold') THEN RAISE EXCEPTION 'BAD_REQUEST'; END IF;
  SELECT paid_at INTO v_paid FROM public.market_listings WHERE id = p_listing AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_paid IS NOT NULL AND p_status <> 'sold' THEN RAISE EXCEPTION 'PAID_FINAL'; END IF;
  UPDATE public.market_listings SET status = p_status, updated_at = now() WHERE id = p_listing AND user_id = auth.uid();
  GET DIAGNOSTICS v_n = ROW_COUNT; RETURN v_n > 0;
END $$;
REVOKE ALL ON FUNCTION public.market_set_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_set_status(uuid, text) TO authenticated;

-- 끌어올리기: 본인 글, 24시간에 1번
CREATE OR REPLACE FUNCTION public.market_bump(p_listing uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  UPDATE public.market_listings SET refreshed_at = now(), bumped_at = now()
   WHERE id = p_listing AND user_id = auth.uid() AND status <> 'sold'
     AND (bumped_at IS NULL OR bumped_at < now() - interval '24 hours');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'BUMP_WAIT'; END IF;
  RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION public.market_bump(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_bump(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.market_bump_view(p_listing uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.market_listings SET view_count = view_count + 1 WHERE id = p_listing AND auth.uid() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.market_bump_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_bump_view(uuid) TO authenticated;

-- 포인트 결제는 '판매중'인 매물만(예약중·거래완료는 거부). 원본 security_hardening.sql 5-4 와 동일 본문 + 상태 검사만 강화.
CREATE OR REPLACE FUNCTION public.market_purchase(p_listing_id UUID, p_expected_price INT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_seller UUID; v_price INT; v_status TEXT; v_buyer UUID; v_cur INT;
BEGIN
  v_buyer := auth.uid();
  IF v_buyer IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT user_id, price, status INTO v_seller, v_price, v_status
    FROM public.market_listings WHERE id = p_listing_id FOR UPDATE;
  IF v_seller IS NULL THEN RAISE EXCEPTION 'listing not found'; END IF;
  IF v_seller = v_buyer THEN RAISE EXCEPTION 'cannot buy own listing'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'not available'; END IF;
  IF (SELECT type FROM public.market_listings WHERE id = p_listing_id) <> 'sell' THEN RAISE EXCEPTION 'not for sale'; END IF;
  IF COALESCE(v_price, 0) <= 0 THEN RAISE EXCEPTION 'invalid listing price'; END IF;
  IF p_expected_price IS NULL OR p_expected_price <> v_price THEN RAISE EXCEPTION 'price changed'; END IF;

  PERFORM set_config('app.allow_sensitive', 'on', true);
  SELECT points_balance INTO v_cur FROM public.profiles WHERE id = v_buyer FOR UPDATE;
  IF COALESCE(v_cur, 0) < v_price THEN RAISE EXCEPTION 'insufficient points'; END IF;
  UPDATE public.profiles SET points_balance = points_balance - v_price, updated_at = NOW() WHERE id = v_buyer;
  UPDATE public.profiles SET points_balance = COALESCE(points_balance, 0) + v_price, updated_at = NOW() WHERE id = v_seller;
  INSERT INTO public.point_transactions(user_id, amount, type, description) VALUES
    (v_buyer,  -v_price, 'market_purchase', '장터 물품 구매 (' || p_listing_id || ')'),
    (v_seller,  v_price, 'market_sale',     '장터 물품 판매 수익 (' || p_listing_id || ')');
  UPDATE public.market_listings SET status = 'sold', buyer_id = v_buyer, paid_at = NOW() WHERE id = p_listing_id;
END;
$$;

-- 보호 컬럼(status·buyer_id·paid_at·view_count·refreshed_at·bumped_at)은 클라이언트 직접 UPDATE 로 못 바꾼다(RPC 만).
-- SECURITY DEFINER RPC 는 함수 소유자(postgres)로 실행되므로 current_user 가 authenticated 가 아니다.
CREATE OR REPLACE FUNCTION public.trg_market_listing_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.status := 'active'; NEW.buyer_id := NULL; NEW.paid_at := NULL; NEW.view_count := 0; NEW.refreshed_at := now(); NEW.bumped_at := NULL;
    ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
       OR NEW.view_count IS DISTINCT FROM OLD.view_count OR NEW.refreshed_at IS DISTINCT FROM OLD.refreshed_at OR NEW.bumped_at IS DISTINCT FROM OLD.bumped_at
       OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.type IS DISTINCT FROM OLD.type THEN
      RAISE EXCEPTION 'READ_ONLY_COLUMN';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_market_listing_guard ON public.market_listings;
CREATE TRIGGER trg_market_listing_guard BEFORE INSERT OR UPDATE ON public.market_listings
  FOR EACH ROW EXECUTE FUNCTION public.trg_market_listing_guard();

-- 차단(blocks)은 쪽지·대화(p_kind = 'message')만 막는다. 댓글·동행·칭찬 알림은 차단과 무관.
CREATE OR REPLACE FUNCTION public.notify_user(
  p_user uuid, p_kind text, p_type text, p_message text, p_link text, p_post_id uuid DEFAULT NULL, p_actor uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_on boolean := true;
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  IF p_actor IS NOT NULL AND p_actor = p_user THEN RETURN; END IF;
  IF p_kind = 'message' AND p_actor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.blocks WHERE (blocker_id = p_user AND blocked_id = p_actor) OR (blocker_id = p_actor AND blocked_id = p_user)
  ) THEN RETURN; END IF;
  IF p_kind <> 'message' THEN
    SELECT CASE p_kind WHEN 'comments' THEN comments WHEN 'commendation' THEN commendation WHEN 'flight' THEN flight
                       WHEN 'companion' THEN companion WHEN 'keywords' THEN keywords ELSE true END
      INTO v_on FROM public.notification_prefs WHERE user_id = p_user;
    IF v_on IS NOT NULL AND v_on = false THEN RETURN; END IF;
  END IF;
  INSERT INTO public.notifications (user_id, type, message, link, post_id)
  VALUES (p_user, p_type, left(p_message, 200), left(p_link, 300), p_post_id)
  ON CONFLICT (user_id, post_id) WHERE type = 'keyword' AND post_id IS NOT NULL DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_user skipped: %', SQLERRM; RETURN;
END; $$;
REVOKE ALL ON FUNCTION public.notify_user(uuid, text, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 확인용 ---------------------------------------------------------------------
-- SELECT proname FROM pg_proc WHERE proname LIKE 'chat_%' OR proname LIKE 'message_%' OR proname LIKE 'market_%';

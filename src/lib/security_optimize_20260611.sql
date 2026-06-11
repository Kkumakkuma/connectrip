-- ============================================================================
-- ConnectTrip 보안·최적화 SQL (2026-06-11)
-- 실행: Supabase SQL Editor (프로젝트 owhtldabzcvavsazdufy)
--
-- ★ 2단계로 나눠 실행한다 (순서 중요):
--   PART 1: 지금 즉시 실행 — 전부 additive/무해. 배포된 기존 코드에 영향 없음.
--   PART 2: 새 코드가 Vercel에 배포·정상 확인된 "후"에 실행 — profiles 컬럼 잠금.
--           (PART 2를 먼저 실행하면 기존 배포 코드의 select('*')가 깨짐)
-- 전체 멱등(재실행 안전).
-- ============================================================================


-- ████████████████████████████████████████████████████████████████████████████
-- PART 1 — 지금 즉시 실행 (기존 코드 무영향)
-- ████████████████████████████████████████████████████████████████████████████

-- ----------------------------------------------------------------------------
-- 1-1. 프로필 접근 RPC (PII 잠금의 선행 준비물)
-- ----------------------------------------------------------------------------

-- 본인 전체 프로필 (컬럼 잠금 후에도 본인 행은 전체 접근)
create or replace function public.get_my_profile()
returns setof public.profiles
language sql stable security definer set search_path = public
as $$ select * from public.profiles where id = auth.uid(); $$;
revoke execute on function public.get_my_profile() from public, anon;
grant execute on function public.get_my_profile() to authenticated;

-- 관리자 전용 전체 프로필 목록 (비관리자는 빈 결과)
create or replace function public.admin_list_profiles()
returns setof public.profiles
language sql stable security definer set search_path = public
as $$ select p.* from public.profiles p where public.is_admin() order by p.created_at desc; $$;
revoke execute on function public.admin_list_profiles() from public, anon;
grant execute on function public.admin_list_profiles() to authenticated;

-- 가입 화면(비로그인) 중복검사 — 컬럼 잠금 후에도 동작
create or replace function public.check_email_taken(p_email text)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where lower(email) = lower(p_email)); $$;
revoke execute on function public.check_email_taken(text) from public;
grant execute on function public.check_email_taken(text) to anon, authenticated;

create or replace function public.check_nickname_taken(p_nickname text)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where nickname = p_nickname); $$;
revoke execute on function public.check_nickname_taken(text) from public;
grant execute on function public.check_nickname_taken(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1-2. 카운터 RPC (현재 운영 DB에 없어서 조회수가 무음실패 중이던 것)
-- ----------------------------------------------------------------------------

alter table public.qna_posts add column if not exists view_count integer not null default 0;

create or replace function public.increment_view_count(post_id uuid)
returns void
language sql security definer set search_path = public
as $$ update public.qna_posts set view_count = coalesce(view_count, 0) + 1 where id = post_id; $$;
revoke execute on function public.increment_view_count(uuid) from public;
grant execute on function public.increment_view_count(uuid) to anon, authenticated;

create or replace function public.increment_likes(dest_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v integer;
begin
  update public.destinations set likes_count = coalesce(likes_count, 0) + 1
  where id = dest_id returning likes_count into v;
  return v;
end; $$;
revoke execute on function public.increment_likes(uuid) from public, anon;
grant execute on function public.increment_likes(uuid) to authenticated;

create or replace function public.decrement_likes(dest_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v integer;
begin
  update public.destinations set likes_count = greatest(coalesce(likes_count, 0) - 1, 0)
  where id = dest_id returning likes_count into v;
  return v;
end; $$;
revoke execute on function public.decrement_likes(uuid) from public, anon;
grant execute on function public.decrement_likes(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 1-3. OTP 브루트포스 잠금용 attempts 컬럼 (api/verify-otp 코드가 5회 잠금에 사용)
-- ----------------------------------------------------------------------------

alter table public.phone_otps add column if not exists attempts integer not null default 0;
alter table public.email_otps add column if not exists attempts integer not null default 0;

-- ----------------------------------------------------------------------------
-- 1-4. FK 커버링 인덱스 21개 (성능 어드바이저 unindexed_foreign_keys 전체)
-- ----------------------------------------------------------------------------

create index if not exists idx_commendation_matches_crew_user_id on public.commendation_matches(crew_user_id);
create index if not exists idx_commendation_matches_passenger_user_id on public.commendation_matches(passenger_user_id);
create index if not exists idx_companion_posts_region_id on public.companion_posts(region_id);
create index if not exists idx_companion_posts_user_id on public.companion_posts(user_id);
create index if not exists idx_crew_posts_user_id on public.crew_posts(user_id);
create index if not exists idx_destinations_region_id on public.destinations(region_id);
create index if not exists idx_destinations_user_id on public.destinations(user_id);
create index if not exists idx_flight_schedules_user_id on public.flight_schedules(user_id);
create index if not exists idx_market_listings_buyer_id on public.market_listings(buyer_id);
create index if not exists idx_market_listings_user_id on public.market_listings(user_id);
create index if not exists idx_messages_receiver_id on public.messages(receiver_id);
create index if not exists idx_messages_sender_id on public.messages(sender_id);
create index if not exists idx_notifications_user_id on public.notifications(user_id);
create index if not exists idx_point_transactions_user_id on public.point_transactions(user_id);
create index if not exists idx_qna_comments_post_id on public.qna_comments(post_id);
create index if not exists idx_qna_comments_user_id on public.qna_comments(user_id);
create index if not exists idx_qna_posts_user_id on public.qna_posts(user_id);
create index if not exists idx_reports_reported_user_id on public.reports(reported_user_id);
create index if not exists idx_reports_reporter_id on public.reports(reporter_id);
create index if not exists idx_reviews_region_id on public.reviews(region_id);
create index if not exists idx_reviews_user_id on public.reviews(user_id);

-- ----------------------------------------------------------------------------
-- 1-5. 중복/불용 RLS 정책 정리 (운영 DB 실측으로 의미 동일·미사용 확인된 것만)
-- ----------------------------------------------------------------------------

-- 중복 정책 5건 (남는 쌍둥이 정책이 동일 의미 — advisor multiple_permissive_policies)
drop policy if exists "Users update own profile" on public.profiles;        -- "Users can update own profile" 잔존
drop policy if exists "Create destinations" on public.destinations;          -- "Auth users can create destinations" 잔존
drop policy if exists "Read destinations" on public.destinations;            -- "Anyone can read destinations" 잔존
drop policy if exists "Create reviews" on public.reviews;
drop policy if exists "Users create reports" on public.reports;

-- 무제한 INSERT 정책 2건 제거 (클라이언트 INSERT 경로 없음 실측 확인)
drop policy if exists "Create notifications" on public.notifications;        -- 알림 생성은 서버(service_role)만
drop policy if exists "Create matches" on public.commendation_matches;       -- 매칭 생성은 apply_commendation_match RPC만

-- ----------------------------------------------------------------------------
-- 1-6. SECURITY DEFINER 함수 EXECUTE 봉합 (비로그인 호출 차단)
-- ----------------------------------------------------------------------------

-- 트리거/내부 전용 함수: API 역할 전부 차단 (트리거는 영향 없음).
-- REVOKE에는 IF EXISTS가 없어, 미존재 함수가 있어도 스크립트가 중단되지 않게 가드.
do $$
declare f text;
begin
  foreach f in array array[
    'public.profiles_guard()',
    'public.commendation_guard()',
    'public.handle_new_user()',
    'public.rls_auto_enable()'
  ] loop
    if to_regprocedure(f) is not null then
      execute 'revoke execute on function ' || f || ' from public, anon, authenticated';
    end if;
  end loop;
end $$;

-- 사용자 RPC: 전부 로그인 후에만 호출됨 → public/anon 차단 + authenticated 명시 grant.
--   (기존엔 PUBLIC 기본 EXECUTE에 의존했을 수 있어, revoke from public 후 grant가 없으면
--    authenticated까지 잃는다 — 반드시 명시 grant 동반)
revoke execute on function public.apply_commendation_match(text, date, text) from public, anon;
grant  execute on function public.apply_commendation_match(text, date, text) to authenticated;
revoke execute on function public.complete_signup_profile(text, text, text, text, text, text, text, text, text, uuid) from public, anon;
grant  execute on function public.complete_signup_profile(text, text, text, text, text, text, text, text, text, uuid) to authenticated;
revoke execute on function public.convert_likes_to_points(integer) from public, anon;
grant  execute on function public.convert_likes_to_points(integer) to authenticated;
revoke execute on function public.market_purchase(uuid, integer) from public, anon;
grant  execute on function public.market_purchase(uuid, integer) to authenticated;
revoke execute on function public.purchase_voucher(integer) from public, anon;
grant  execute on function public.purchase_voucher(integer) to authenticated;
revoke execute on function public.use_voucher(integer) from public, anon;
grant  execute on function public.use_voucher(integer) to authenticated;
revoke execute on function public.send_commendation_gift(uuid, integer, text) from public, anon;
grant  execute on function public.send_commendation_gift(uuid, integer, text) to authenticated;
revoke execute on function public.toggle_post_like(text, uuid) from public, anon;
grant  execute on function public.toggle_post_like(text, uuid) to authenticated;
-- is_admin(): reports/profiles RLS 정책 평가에 필요 → authenticated 명시 grant
revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated;
-- grant_referral_bonus: complete_signup_profile 내부에서만 호출(직접 호출 불필요) → API 역할 전부 차단
revoke execute on function public.grant_referral_bonus(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1-7. OTP 시도횟수 원자 증가 RPC (api/verify-otp·verify-email-otp 폴백의
--      read-modify-write 경쟁 보완. service_role 전용)
-- ----------------------------------------------------------------------------

create or replace function public.bump_phone_otp_attempts(p_id uuid)
returns integer
language sql security definer set search_path = public
as $$ update public.phone_otps set attempts = coalesce(attempts, 0) + 1 where id = p_id returning attempts; $$;
revoke execute on function public.bump_phone_otp_attempts(uuid) from public, anon, authenticated;
grant  execute on function public.bump_phone_otp_attempts(uuid) to service_role;

create or replace function public.bump_email_otp_attempts(p_id uuid)
returns integer
language sql security definer set search_path = public
as $$ update public.email_otps set attempts = coalesce(attempts, 0) + 1 where id = p_id returning attempts; $$;
revoke execute on function public.bump_email_otp_attempts(uuid) from public, anon, authenticated;
grant  execute on function public.bump_email_otp_attempts(uuid) to service_role;

-- ============================================================================
-- (PART 1 끝) 여기까지 실행 후:
--   1) git push (새 코드 Vercel 자동배포)
--   2) www.connecttrip.co.kr 정상 동작 확인 (로그인/게시판/마이페이지)
--   3) 그 다음에 PART 2 실행
-- ============================================================================


-- ████████████████████████████████████████████████████████████████████████████
-- PART 2 — 새 코드 배포·확인 "후" 실행 (profiles PII 잠금 + destinations 봉합)
-- ████████████████████████████████████████████████████████████████████████████

-- ----------------------------------------------------------------------------
-- 2-1. profiles PII 컬럼 잠금 (핵심 P0)
--   현재: 로그인한 아무 유저나 타인의 email/phone/주소/추천인 조회 가능
--   이후: 타인 행은 아래 안전 컬럼만 조회 가능. 본인 행 전체 = get_my_profile(),
--        관리자 전체 목록 = admin_list_profiles().
-- ----------------------------------------------------------------------------

-- revoke select on table public.profiles from anon, authenticated;
-- grant select (id, name, nickname, avatar_url, user_type, crew_verified, airline_name, bio, created_at)
--   on table public.profiles to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2-2. destinations UPDATE 봉합 (현재 USING(true) — 아무나 타인 글 수정 가능)
--   새 코드의 좋아요는 increment_likes/decrement_likes RPC를 쓰므로 안전.
-- ----------------------------------------------------------------------------

-- drop policy if exists "Users can update destinations" on public.destinations;
-- create policy "Users update own destinations" on public.destinations
--   for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- ★ PART 2는 주석 처리돼 있음. 새 코드 배포 확인 후 위 주석(-- )을 풀고 실행.
--
-- 적용 후 점검 쿼리:
--   select policyname, cmd from pg_policies where tablename='profiles';
--   select policyname, cmd from pg_policies where tablename='destinations';
--
-- ※ 추가 권장(대시보드 설정, SQL 불가): Authentication → Settings →
--   "Leaked password protection" 활성화 (HaveIBeenPwned 유출 비밀번호 차단)
-- ============================================================================

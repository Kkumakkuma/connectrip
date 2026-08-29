-- ============================================================
-- ConnectTrip 게시판 좋아요 경제 (2026-06-06)
-- 좋아요 인프라(post_likes) + toggle_post_like RPC + 받은 좋아요 → 작성자 포인트 적립.
-- Supabase SQL Editor 에 붙여넣고 Run. 멱등(create if not exists / or replace).
--
-- ★★ 운영 적용 주의 (에이전트 4명 + codex 자문 결론) ★★
--  - 좋아요→포인트 적립은 봇·다계정·품앗이 어뷰징에 직접 노출된다. 유저 0 단계에서
--    켜면 포인트 인플레이션/조작 위험이 크다. 권장: 실유저 확보 + 어뷰징 모니터링 준비
--    후 운영 적용. 아래 c_reward / c_month_cap 은 초기 보수값이며 실데이터로 재조정 전제.
--  - 어뷰징 방어 내장: ①phone_verified + 미차단 유저만 좋아요 ②자가 좋아요 적립 무효
--    ③1인 1글 1좋아요(UNIQUE) ④작성자 월 적립 상한 ⑤직접 INSERT 차단(RPC 전용).
--  - 포인트는 "서비스 내 소비(칭송권 등)"로만, 현금 환급 불가 → 게임산업법 환전규제·사행성 회피.
-- ============================================================

-- 1) 좋아요 기록 테이블
create table if not exists public.post_likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  board_type text not null check (board_type in ('destinations','reviews','qna_posts','companion_posts','crew_posts')),
  post_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, board_type, post_id)   -- 1인 1글 1좋아요(중복/봇 연타 차단)
);
create index if not exists idx_post_likes_post on public.post_likes(board_type, post_id);

alter table public.post_likes enable row level security;
drop policy if exists "Anyone can read post_likes" on public.post_likes;
create policy "Anyone can read post_likes" on public.post_likes for select using (true);
-- INSERT/DELETE 직접 정책 없음 = 차단. 생성/취소는 toggle_post_like RPC(SECURITY DEFINER)로만.

-- 2) 좋아요 토글 + (자가 아닐 때) 작성자 포인트 적립
--    좋아요 1개 = 작성자 1P(쿠마님 확정), 작성자 월 적립 상한 2000P(어뷰징 방어)
create or replace function public.toggle_post_like(p_board_type text, p_post_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_liked boolean;
  v_count int;
  v_author uuid;
  v_month_earned int;
  c_reward int := 1;         -- 좋아요 1개당 작성자 적립 포인트(쿠마님 확정: 1)
  c_month_cap int := 2000;   -- 작성자 월 적립 상한(인플레/어뷰징 방어)
begin
  if v_user is null then raise exception 'auth required'; end if;
  if not exists (
    select 1 from public.profiles
    where id = v_user and coalesce(phone_verified, false) = true and coalesce(is_banned, false) = false
  ) then
    raise exception 'phone verification required';
  end if;
  if p_board_type not in ('destinations','reviews','qna_posts','companion_posts','crew_posts') then
    raise exception 'invalid board_type';
  end if;

  delete from public.post_likes
    where user_id = v_user and board_type = p_board_type and post_id = p_post_id;
  if found then
    v_liked := false;            -- 이미 눌렀던 것 → 취소(좋아요 해제, 적립 회수는 하지 않음=단순화)
  else
    insert into public.post_likes(user_id, board_type, post_id)
      values (v_user, p_board_type, p_post_id);
    v_liked := true;

    -- 작성자 조회(board_type 별)
    v_author := case p_board_type
      when 'destinations'     then (select user_id from public.destinations     where id = p_post_id)
      when 'reviews'          then (select user_id from public.reviews          where id = p_post_id)
      when 'qna_posts'        then (select user_id from public.qna_posts        where id = p_post_id)
      when 'companion_posts'  then (select user_id from public.companion_posts  where id = p_post_id)
      when 'crew_posts'       then (select user_id from public.crew_posts       where id = p_post_id)
    end;

    -- 포인트 적립은 승무원 게시판(crew_posts) 글에만. 다른 게시판은 좋아요만(혜택 없음, 쿠마님 지시).
    -- 자가 좋아요 무효 + 작성자 인증 승무원 + 이달 적립 상한 미만일 때만.
    if p_board_type = 'crew_posts'
       and v_author is not null and v_author <> v_user
       and exists (select 1 from public.profiles where id = v_author and user_type = 'crew' and coalesce(crew_verified, false) = true) then
      select coalesce(sum(amount), 0) into v_month_earned
        from public.point_transactions
        where user_id = v_author and type = 'like_earn'
          and created_at >= date_trunc('month', now());
      if v_month_earned < c_month_cap then
        perform set_config('app.allow_sensitive', 'on', true);  -- profiles_guard 우회(정상 적립)
        update public.profiles
          set points_balance = coalesce(points_balance, 0) + c_reward, updated_at = now()
          where id = v_author;
        insert into public.point_transactions(user_id, amount, type, description)
          values (v_author, c_reward, 'like_earn', '게시글 좋아요 보상');
      end if;
    end if;
  end if;

  select count(*) into v_count
    from public.post_likes where board_type = p_board_type and post_id = p_post_id;
  return jsonb_build_object('liked', v_liked, 'likes_count', v_count);
end;
$$;

revoke all on function public.toggle_post_like(text, uuid) from public, anon;
grant execute on function public.toggle_post_like(text, uuid) to authenticated;

-- 2026-08-29: 구 함수 increment_likes/decrement_likes(security_optimize_20260611.sql)의
-- authenticated 실행 권한 회수(운영 적용 완료). db.js 의 like/unlike 폴백 제거가 끝나
-- 클라이언트 호출 경로가 toggle_post_like 하나뿐임을 확인한 뒤 조였다. service_role 은 유지.
revoke execute on function public.increment_likes(uuid) from authenticated;
revoke execute on function public.decrement_likes(uuid) from authenticated;

-- 3) 칭송신청권 환율은 security_hardening.sql 의 purchase_voucher 가 관리한다(30,000P/장, 쿠마님 확정 수치).
--    여기서 재정의하지 않는다.

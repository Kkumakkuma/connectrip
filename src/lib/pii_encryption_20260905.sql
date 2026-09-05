-- 회원 개인정보 암호화 — 운영 DB 적용 기록 (2026-09-05). 아래는 apply_migration 으로 적용한 순서 그대로다.
--   1) pii_encryption_phase1_additive          Vault 키·pii 스키마·암호문/해시 컬럼·이중쓰기 트리거·백필
--   2) (execute_sql) create unique index concurrently uq_profiles_phone_hash on profiles(phone_hash) where phone_hash is not null
--   3) admin_commendation_reviews_from_encrypted  관리자 조회를 암호문 복호로 + 배송 주소 포함
--   4) privacy_scrub_auth_metadata_v2          가입 메타데이터의 휴대폰·주소 사본 파기 추가
--
-- 설계 (등급3 교차검토 codex+agy 반영, 쿠마님 지시 "중복가입 막는 게 더 중요, 관리자는 주소도 봐야, 적정선")
--   · 대칭 암호(pgp_sym AES-256, 압축 없음)는 IV 가 랜덤 → 인덱스 불가 → 유니크·검색은 페퍼 HMAC 해시 컬럼.
--     한국 휴대폰 번호는 경우의 수 1억 미만이라 페퍼 없는 해시는 전수대입에 뚫린다. 페퍼는 Vault 에만.
--   · 키·페퍼는 SQL 텍스트에 절대 안 나온다(pii.secret() 이 함수 안에서 읽는다) — 쿼리 로그 노출 방지.
--   · 쓰기 경로가 여럿(handle_new_user·complete_signup_profile·클라이언트 update)이라 RPC 가 아니라
--     BEFORE INSERT/UPDATE 트리거(profiles_pii_sync)로 이중쓰기한다.
--   · 기존 유니크 인덱스 uq_profiles_phone_canon 은 그대로 둔다(전환기 동안 둘 다 유지). 평문 컬럼도 아직 둔다.
--   · 클라이언트 롤(anon/authenticated)은 pii 스키마 USAGE 없음, 암호문·해시·평문 전화·주소 컬럼 SELECT 없음.
--
-- 검증(적용 직후 실측)
--   · 3행 백필: 전화 1/1 복호 일치, 이름 3/3 복호 일치, 해시 고유수 = canon 고유수
--   · UPDATE 트리거: 전화·주소 바꾸면 암호문·해시 갱신(롤백 트랜잭션으로 확인)
--   · authenticated: 암호문/해시/평문전화/주소 SELECT false, pii 스키마 USAGE false, 이름 SELECT true(기존)
--
-- 정직한 한계
--   DB 파일·백업·논리 덤프 유출과 읽기 전용 접근에서는 원문을 못 얻는다.
--   Vault 조회권한·복호 RPC 실행권한·프로젝트 관리권한까지 털리면 복호된다 — 어떤 컬럼 암호화도 이건 못 막는다.
--
-- 다음 단계(별도 배포, 관찰 후)
--   · get_my_profile 을 명시 컬럼 + 복호값으로 바꾸고 클라이언트 프리필을 그쪽으로 옮긴 뒤 평문 컬럼 DROP
--   · 그때 uq_profiles_phone_canon 제거, "완성 프로필은 phone_hash 필수" CHECK(NOT VALID → VALIDATE)
--   · profiles_private.birthdate 암호화(can_use_flight_board 는 본인 1행만 복호하면 됨)
--   · 키 회전: ct_pii_key_v2 추가 → 읽기는 pii_key_version 따라, 쓰기는 최신 → 재암호화 후 v1 폐기

-- ===== 1) pii_encryption_phase1_additive ================================================
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ct_pii_key_v1',      '회원 PII 대칭키 v1 (2026-09-05)');
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ct_phone_pepper_v1', '전화번호 HMAC 페퍼 v1 (2026-09-05)');

create schema if not exists pii;
revoke all on schema pii from public;
revoke all on schema pii from anon, authenticated;

create or replace function pii.secret(p_name text)
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1
$$;
create or replace function pii.enc(p_plain text, p_ver smallint default 1)
returns bytea language sql stable security definer set search_path = '' as $$
  select case when p_plain is null or p_plain = '' then null
         else extensions.pgp_sym_encrypt(p_plain, pii.secret('ct_pii_key_v' || p_ver::text),
                                         'cipher-algo=aes256, compress-algo=0') end
$$;
create or replace function pii.dec(p_cipher bytea, p_ver smallint default 1)
returns text language sql stable security definer set search_path = '' as $$
  select case when p_cipher is null then null
         else extensions.pgp_sym_decrypt(p_cipher, pii.secret('ct_pii_key_v' || p_ver::text)) end
$$;
create or replace function pii.phone_hash(p_phone text, p_ver smallint default 1)
returns text language sql stable security definer set search_path = '' as $$
  select case when public.canon_phone(p_phone) is null then null
         else encode(extensions.hmac(public.canon_phone(p_phone),
                                     pii.secret('ct_phone_pepper_v' || p_ver::text), 'sha256'), 'hex') end
$$;
revoke all on function pii.secret(text)               from public, anon, authenticated;
revoke all on function pii.enc(text, smallint)         from public, anon, authenticated;
revoke all on function pii.dec(bytea, smallint)        from public, anon, authenticated;
revoke all on function pii.phone_hash(text, smallint)  from public, anon, authenticated;

alter table public.profiles
  add column if not exists phone_enc       bytea,
  add column if not exists phone_hash      text,
  add column if not exists name_enc        bytea,
  add column if not exists addr_zip_enc    bytea,
  add column if not exists addr_road_enc   bytea,
  add column if not exists addr_detail_enc bytea,
  add column if not exists pii_key_version smallint not null default 1;
revoke select (phone_enc, phone_hash, name_enc, addr_zip_enc, addr_road_enc, addr_detail_enc, pii_key_version)
  on public.profiles from anon, authenticated;

create or replace function public.profiles_pii_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.phone is distinct from old.phone or new.pii_key_version is distinct from old.pii_key_version then
    new.phone_enc  := pii.enc(new.phone, new.pii_key_version);
    new.phone_hash := pii.phone_hash(new.phone, new.pii_key_version);
  end if;
  if tg_op = 'INSERT' or new.name is distinct from old.name or new.pii_key_version is distinct from old.pii_key_version then
    new.name_enc := pii.enc(new.name, new.pii_key_version);
  end if;
  if tg_op = 'INSERT' or new.address_zipcode is distinct from old.address_zipcode
     or new.address_road is distinct from old.address_road or new.address_detail is distinct from old.address_detail
     or new.pii_key_version is distinct from old.pii_key_version then
    new.addr_zip_enc    := pii.enc(new.address_zipcode, new.pii_key_version);
    new.addr_road_enc   := pii.enc(new.address_road,    new.pii_key_version);
    new.addr_detail_enc := pii.enc(new.address_detail,  new.pii_key_version);
  end if;
  return new;
end $$;
revoke all on function public.profiles_pii_sync() from public, anon, authenticated;
drop trigger if exists trg_profiles_pii_sync on public.profiles;
create trigger trg_profiles_pii_sync before insert or update on public.profiles
  for each row execute function public.profiles_pii_sync();

update public.profiles set
  phone_enc = pii.enc(phone, pii_key_version), phone_hash = pii.phone_hash(phone, pii_key_version),
  name_enc = pii.enc(name, pii_key_version),
  addr_zip_enc = pii.enc(address_zipcode, pii_key_version), addr_road_enc = pii.enc(address_road, pii_key_version),
  addr_detail_enc = pii.enc(address_detail, pii_key_version)
where phone_enc is null and name_enc is null;
notify pgrst, 'reload schema';

-- ===== 2) 트랜잭션 밖에서 따로 =============================================================
-- create unique index concurrently if not exists uq_profiles_phone_hash on public.profiles (phone_hash) where phone_hash is not null;

-- ===== 3) admin_commendation_reviews_from_encrypted ===================================
-- (본문은 운영 DB 와 동일 — 승인(verified/gift_sent) 이후에만 name/phone/zipcode/road/detail 복호)

-- ===== 4) privacy_scrub_auth_metadata_v2 ==============================================
-- (본문은 운영 DB 와 동일 — raw_user_meta_data 에서 phone/address_* 키 제거, 프로필 있는 계정·가입 1시간 후)

-- ===== 5) 재검토 반영 (같은 날 오전, codex 전수감사 + agy 사후검토) =================================
-- · pii.enc 를 VOLATILE 로 (랜덤 IV 함수를 STABLE 로 두면 한 문장 안에서 결과가 재사용될 수 있다)
--     alter function pii.enc(text, smallint) volatile;
-- · profiles_pii_sync: pii_key_version NULL → 1 보정, 전화번호가 있는데 canon_phone 이 NULL 이면 PHONE_INVALID_FORMAT 거부
-- · complete_signup_profile: 차단 번호 대조를 pii.phone_hash 로, unique_violation 매핑에 uq_profiles_phone_hash 추가
-- · request_account_deletion: 차단 탈퇴자 번호 기록도 pii.phone_hash 로 (blocked_phone_claims 는 0행이라 전환 비용 없음)
--
-- 결제 가산 RPC 정의 보존 (codex 지적: 저장소에 없어 검증 불가). 운영 정의 그대로. 읽어 본 판단:
--   주문별 advisory xact lock · credited/paid_test 멱등 · confirming/paid 만 진행 · 승인금액≠원장금액 거부 ·
--   env<>'live' 면 절대 가산 안 함 · 가산+원장+상태 전이가 한 트랜잭션. 문제 없음.
CREATE OR REPLACE FUNCTION public.ct_charge_points_by_payment(p_order_id text, p_paid_amount integer, p_pg_tid text, p_method text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
declare v_order public.ct_payment_orders%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('ct_charge:' || coalesce(p_order_id, '')));
  select * into v_order from public.ct_payment_orders where order_id = p_order_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if v_order.status = 'credited'  then return jsonb_build_object('status','ok','credited', v_order.amount, 'reused', true); end if;
  if v_order.status = 'paid_test' then return jsonb_build_object('status','test','credited', 0, 'reused', true); end if;
  if v_order.status not in ('confirming','paid') then
    return jsonb_build_object('status','not_payable','order_status', v_order.status);
  end if;
  if p_paid_amount is distinct from v_order.amount then
    return jsonb_build_object('status','amount_mismatch');
  end if;
  if v_order.env <> 'live' then
    update public.ct_payment_orders
       set status='paid_test', pg_tid=p_pg_tid, paid_amount=p_paid_amount, method=p_method
     where order_id = p_order_id;
    return jsonb_build_object('status','test','credited',0);
  end if;
  perform set_config('app.allow_sensitive','on', true);
  update public.profiles
     set points_balance = coalesce(points_balance,0) + v_order.amount, updated_at = now()
   where id = v_order.user_id;
  if not found then return jsonb_build_object('status','user_not_found'); end if;
  insert into public.point_transactions(user_id, amount, type, description)
    values (v_order.user_id, v_order.amount, 'cash_charge', '포인트 충전(결제) ' || v_order.amount || 'P · 주문 ' || p_order_id);
  update public.ct_payment_orders
     set status='credited', pg_tid=p_pg_tid, paid_amount=p_paid_amount, method=p_method
   where order_id = p_order_id;
  return jsonb_build_object('status','ok','credited', v_order.amount, 'reused', false);
end;
$function$;

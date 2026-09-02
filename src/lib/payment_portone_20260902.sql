-- ============================================================
-- ConnectTrip — 포인트 충전 결제 PG 전환: 토스페이먼츠 → 포트원 V2(KG이니시스) (2026-09-02)
--   서버(api/payment/create-order.js)가 주문 행에 사용한 store_id·channel_key 를 스냅샷으로 남기고,
--   승인(api/payment/confirm.js·webhook.js → _portone.js settleOrder)은 포트원 결제 조회 결과를
--   "주문 생성 당시 스냅샷"과 대조한다(테스트 채널 결제가 라이브 주문으로 충전되는 사고 차단).
--   상태머신: pending → confirming(lock_token·confirming_at) → credited | paid_test | failed | canceled | review
--     - failed   : PG 결제 실패(FAILED)
--     - canceled : PG 취소(CANCELLED)
--     - pending  : 조회 지연·timeout·5xx → 되돌려 재시도 가능
--     - review   : PAID 인데 금액/통화/채널/상점 불일치 또는 RPC 실패 → 자동 재처리 금지, 관리자 확인
--   충전 RPC ct_charge_points_by_payment 는 변경 없음. 배포된 정의(2026-09-02 pg_get_functiondef 실측): 인자
--   (p_order_id text, p_paid_amount int, p_pg_tid text, p_method text), advisory lock, credited/paid_test 멱등 반환,
--   status not in ('confirming','paid') → not_payable, 금액 불일치 → amount_mismatch, env<>'live' → paid_test(0P),
--   live → profiles.points_balance 가산 + point_transactions(cash_charge) + credited. DB 가 원본(저장소엔 정의 없음).
--   적용: Supabase MCP apply_migration(payment_portone_20260902). 멱등.
-- ============================================================

alter table public.ct_payment_orders alter column provider set default 'portone';

alter table public.ct_payment_orders
  add column if not exists store_id      text,
  add column if not exists channel_key   text,
  add column if not exists confirming_at timestamptz,
  add column if not exists lock_token    text,
  add column if not exists last_error    text;

comment on column public.ct_payment_orders.provider      is '결제 제공자: portone(포트원 V2, PG=KG이니시스). 구 toss 행은 테스트 주문만 존재.';
comment on column public.ct_payment_orders.store_id      is '주문 생성 시 서버 env PORTONE_STORE_ID 스냅샷 — 승인 시 결제 조회 storeId 와 대조';
comment on column public.ct_payment_orders.channel_key   is '주문 생성 시 서버 env PORTONE_PAY_CHANNEL_KEY 스냅샷 — 승인 시 결제 조회 channel.key 와 대조';
comment on column public.ct_payment_orders.confirming_at is 'confirming 락 획득 시각. 2분 넘은 stale 락만 새 lock_token 으로 회수';
comment on column public.ct_payment_orders.lock_token    is 'confirming 락 소유 토큰. 실패/보류 전이는 자기 토큰일 때만';
comment on column public.ct_payment_orders.last_error    is '마지막 승인 실패 코드(not_paid_READY, amount_mismatch, channel_mismatch, rpc_… 등)';
comment on column public.ct_payment_orders.status        is 'pending | confirming | paid | credited | paid_test | failed | canceled | review';

-- 승인 대기 주문 조회(웹훅·재시도) 용
create index if not exists ct_payment_orders_status_idx on public.ct_payment_orders (status, created_at desc);

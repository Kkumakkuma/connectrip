-- ============================================================
-- Messages (회원 간 쪽지) — 2026-09-06 chat_market_20260906.sql 로 재정의(쓰기·조회 RPC 전용, sender_deleted/receiver_deleted 추가). 아래 정책 중 INSERT/UPDATE 는 폐기됨.
-- ============================================================

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id UUID REFERENCES public.profiles(id),
  receiver_id UUID REFERENCES public.profiles(id),
  content TEXT NOT NULL,
  flight_number TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own messages" ON public.messages FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
CREATE POLICY "Users send messages" ON public.messages FOR INSERT WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "Users update own messages" ON public.messages FOR UPDATE USING (auth.uid() = receiver_id);

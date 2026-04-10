-- ============================================================
-- Commendation Matches (칭송매칭)
-- ============================================================

CREATE TABLE public.commendation_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_number TEXT NOT NULL,
  flight_date DATE NOT NULL,
  crew_user_id UUID REFERENCES public.profiles(id),
  passenger_user_id UUID REFERENCES public.profiles(id),
  status TEXT DEFAULT 'pending_crew' CHECK (status IN ('pending_crew', 'pending_passenger', 'matched', 'commendation_submitted', 'verified', 'gift_sent', 'rejected')),
  commendation_screenshot_url TEXT,
  gift_points INT,
  gift_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.commendation_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own matches" ON public.commendation_matches
  FOR SELECT USING (auth.uid() = crew_user_id OR auth.uid() = passenger_user_id);

CREATE POLICY "Users can create matches" ON public.commendation_matches
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own matches" ON public.commendation_matches
  FOR UPDATE USING (auth.uid() = crew_user_id OR auth.uid() = passenger_user_id);

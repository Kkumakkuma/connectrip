-- Travelers Hub Supabase Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. Users & Profiles
-- ============================================================

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email TEXT,
  user_type TEXT CHECK (user_type IN ('traveler', 'crew')) DEFAULT 'traveler',
  provider TEXT DEFAULT 'email',
  name TEXT,
  avatar_url TEXT,
  bio TEXT,
  points_balance INT DEFAULT 60000,
  voucher_count INT DEFAULT 0,
  available_likes INT DEFAULT 3450,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 2. Regions (Seed Data)
-- ============================================================

CREATE TABLE public.regions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ko TEXT NOT NULL,
  emoji TEXT,
  description TEXT
);

INSERT INTO public.regions (id, name, name_ko, emoji, description) VALUES
  ('europe', 'Europe', '유럽', '🇪🇺', '프랑스, 영국, 독일, 이탈리아 등'),
  ('americas', 'Americas', '아메리카', '🌎', '미국, 캐나다, 브라질, 멕시코 등'),
  ('africa', 'Africa', '아프리카', '🌍', '남아공, 모로코, 이집트 등'),
  ('southeast-asia', 'Southeast Asia', '동남아시아', '🌏', '태국, 베트남, 필리핀, 인도네시아 등'),
  ('asia', 'Asia', '아시아', '🗾', '일본, 중국, 인도, 대만 등'),
  ('oceania', 'Oceania', '오세아니아', '🦘', '호주, 뉴질랜드 등');

-- ============================================================
-- 3. Companion Board (동행 게시판)
-- ============================================================

CREATE TABLE public.companion_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  region_id TEXT REFERENCES public.regions(id),
  title TEXT NOT NULL,
  country TEXT,
  travel_date DATE,
  members_needed TEXT,
  content TEXT,
  author_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. Market Board (장터 게시판)
-- ============================================================

CREATE TABLE public.market_listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('sell', 'buy', 'share')) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price INT,
  budget INT,
  location TEXT,
  image_url TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5. Q&A Board (여행 Q&A)
-- ============================================================

CREATE TABLE public.qna_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  author_name TEXT,
  view_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.qna_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID REFERENCES public.qna_posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_name TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6. Crew Board (승무원 전용)
-- ============================================================

CREATE TABLE public.crew_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_type TEXT CHECK (post_type IN ('info', 'discount')) NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  category TEXT,
  brand TEXT,
  discount_percent INT,
  image_url TEXT,
  author_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. Promotions & Reviews
-- ============================================================

CREATE TABLE public.reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  region_id TEXT REFERENCES public.regions(id),
  type TEXT CHECK (type IN ('promotion', 'review')) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  rating DECIMAL(2,1),
  image_url TEXT,
  author_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. Destinations (승무원 추천)
-- ============================================================

CREATE TABLE public.destinations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  region_id TEXT REFERENCES public.regions(id),
  name TEXT NOT NULL,
  description TEXT,
  crew_comment TEXT,
  image_url TEXT,
  likes_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 9. Flight Matching
-- ============================================================

CREATE TABLE public.flight_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  flight_date DATE NOT NULL,
  flight_number TEXT NOT NULL,
  user_type TEXT DEFAULT 'passenger',
  is_public BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'matching', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 10. Keyword Alerts
-- ============================================================

CREATE TABLE public.user_keywords (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, keyword)
);

-- ============================================================
-- 11. Notifications
-- ============================================================

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT,
  message TEXT NOT NULL,
  post_id UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 12. Point Transactions
-- ============================================================

CREATE TABLE public.point_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount INT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RLS Policies
-- ============================================================

-- Profiles: users can read all, update own
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Companion posts: anyone can read, authenticated can create
ALTER TABLE public.companion_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read companion posts" ON public.companion_posts FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create companion posts" ON public.companion_posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own companion posts" ON public.companion_posts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own companion posts" ON public.companion_posts FOR DELETE USING (auth.uid() = user_id);

-- Market listings
ALTER TABLE public.market_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read listings" ON public.market_listings FOR SELECT USING (true);
CREATE POLICY "Auth users can create listings" ON public.market_listings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own listings" ON public.market_listings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own listings" ON public.market_listings FOR DELETE USING (auth.uid() = user_id);

-- QnA posts
ALTER TABLE public.qna_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read qna" ON public.qna_posts FOR SELECT USING (true);
CREATE POLICY "Auth users can create qna" ON public.qna_posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own qna" ON public.qna_posts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own qna" ON public.qna_posts FOR DELETE USING (auth.uid() = user_id);

-- QnA comments
ALTER TABLE public.qna_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read comments" ON public.qna_comments FOR SELECT USING (true);
CREATE POLICY "Auth users can create comments" ON public.qna_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own comments" ON public.qna_comments FOR DELETE USING (auth.uid() = user_id);

-- Crew posts: crew can create, anyone can read (app checks user_type)
ALTER TABLE public.crew_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read crew posts" ON public.crew_posts FOR SELECT USING (true);
CREATE POLICY "Auth users can create crew posts" ON public.crew_posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own crew posts" ON public.crew_posts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own crew posts" ON public.crew_posts FOR DELETE USING (auth.uid() = user_id);

-- Reviews
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read reviews" ON public.reviews FOR SELECT USING (true);
CREATE POLICY "Auth users can create reviews" ON public.reviews FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own reviews" ON public.reviews FOR UPDATE USING (auth.uid() = user_id);

-- Destinations
ALTER TABLE public.destinations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read destinations" ON public.destinations FOR SELECT USING (true);
CREATE POLICY "Auth users can create destinations" ON public.destinations FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Flight schedules: users can read all (needed for companions & matching), manage own
ALTER TABLE public.flight_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read flight schedules" ON public.flight_schedules FOR SELECT USING (true);
CREATE POLICY "Users can create own flights" ON public.flight_schedules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own flights" ON public.flight_schedules FOR UPDATE USING (auth.uid() = user_id);

-- Keywords: users manage own only
ALTER TABLE public.user_keywords ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own keywords" ON public.user_keywords FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own keywords" ON public.user_keywords FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own keywords" ON public.user_keywords FOR DELETE USING (auth.uid() = user_id);

-- Notifications: users see own only
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System can create notifications" ON public.notifications FOR INSERT WITH CHECK (true);

-- Point transactions: users see own only
ALTER TABLE public.point_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own transactions" ON public.point_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own transactions" ON public.point_transactions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Regions: public read
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read regions" ON public.regions FOR SELECT USING (true);

import { supabase } from './supabase';

// ============================================================
// Companion Posts (동행 게시판)
// ============================================================

export const companionApi = {
  async getByRegion(regionId) {
    const { data, error } = await supabase
      .from('companion_posts')
      .select('*')
      .eq('region_id', regionId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async create(post) {
    const { data, error } = await supabase
      .from('companion_posts')
      .insert(post)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase.from('companion_posts').delete().eq('id', id);
    if (error) throw error;
  },
};

// ============================================================
// Market Board (장터 게시판)
// ============================================================

export const marketApi = {
  async getAll(type = null) {
    let query = supabase.from('market_listings').select('*').order('created_at', { ascending: false });
    if (type) query = query.eq('type', type);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async create(listing) {
    const { data, error } = await supabase
      .from('market_listings')
      .insert(listing)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase.from('market_listings').delete().eq('id', id);
    if (error) throw error;
  },
};

// ============================================================
// QnA Board (여행 Q&A)
// ============================================================

export const qnaApi = {
  async getAll() {
    const { data, error } = await supabase
      .from('qna_posts')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getById(id) {
    // Increment view count
    await supabase.rpc('increment_view_count', { post_id: id }).catch(() => {});
    const { data, error } = await supabase
      .from('qna_posts')
      .select('*, qna_comments(*)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async create(post) {
    const { data, error } = await supabase
      .from('qna_posts')
      .insert(post)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async addComment(comment) {
    const { data, error } = await supabase
      .from('qna_comments')
      .insert(comment)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase.from('qna_posts').delete().eq('id', id);
    if (error) throw error;
  },
};

// ============================================================
// Crew Board (승무원 전용)
// ============================================================

export const crewApi = {
  async getAll(postType = null) {
    let query = supabase.from('crew_posts').select('*').order('created_at', { ascending: false });
    if (postType) query = query.eq('post_type', postType);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async create(post) {
    const { data, error } = await supabase
      .from('crew_posts')
      .insert(post)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase.from('crew_posts').delete().eq('id', id);
    if (error) throw error;
  },
};

// ============================================================
// Reviews & Promotions
// ============================================================

export const reviewsApi = {
  async getAll(regionId = null, type = null) {
    let query = supabase.from('reviews').select('*, profiles(name, user_type, avatar_url)').order('created_at', { ascending: false });
    if (regionId) query = query.eq('region_id', regionId);
    if (type) query = query.eq('type', type);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async create(review) {
    const { data, error } = await supabase
      .from('reviews')
      .insert(review)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase.from('reviews').delete().eq('id', id);
    if (error) throw error;
  },
};

// ============================================================
// Destinations (여행지 추천)
// ============================================================

export const destinationsApi = {
  async getAll(regionId = null) {
    let query = supabase.from('destinations').select('*, profiles(name, user_type, avatar_url)').order('likes_count', { ascending: false });
    if (regionId) query = query.eq('region_id', regionId);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async create(dest) {
    const { data, error } = await supabase
      .from('destinations')
      .insert(dest)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async like(id) {
    // Try RPC first, fallback to manual increment
    try {
      const { data, error } = await supabase.rpc('increment_likes', { dest_id: id });
      if (!error) return data;
    } catch {}
    // Fallback: manual increment
    const { data: dest } = await supabase.from('destinations').select('likes_count').eq('id', id).single();
    const { data, error } = await supabase
      .from('destinations')
      .update({ likes_count: (dest?.likes_count || 0) + 1 })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async unlike(id) {
    const { data: dest } = await supabase.from('destinations').select('likes_count').eq('id', id).single();
    const { data, error } = await supabase
      .from('destinations')
      .update({ likes_count: Math.max(0, (dest?.likes_count || 0) - 1) })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase.from('destinations').delete().eq('id', id);
    if (error) throw error;
  },
};

// ============================================================
// Flight Matching
// ============================================================

export const flightApi = {
  async getMyFlights(userId) {
    const { data, error } = await supabase
      .from('flight_schedules')
      .select('*')
      .eq('user_id', userId)
      .order('flight_date', { ascending: true });
    if (error) throw error;
    return data;
  },

  async register(flight) {
    const { data, error } = await supabase
      .from('flight_schedules')
      .insert(flight)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteFlight(id) {
    const { error } = await supabase
      .from('flight_schedules')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  async toggleVisibility(id, isPublic) {
    const { data, error } = await supabase
      .from('flight_schedules')
      .update({ is_public: isPublic })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async findMatches(flightNumber, flightDate, userId) {
    const { data, error } = await supabase
      .from('flight_schedules')
      .select('*, profiles(name, user_type, avatar_url)')
      .eq('flight_number', flightNumber)
      .eq('flight_date', flightDate)
      .eq('is_public', true)
      .neq('user_id', userId);
    if (error) throw error;
    return data;
  },
};

// ============================================================
// Commendation Matching (칭송매칭)
// ============================================================

export const commendationApi = {
  async getMyMatches(userId) {
    const { data, error } = await supabase
      .from('commendation_matches')
      .select('*, crew:profiles!commendation_matches_crew_user_id_fkey(id, name, user_type, avatar_url, airline), passenger:profiles!commendation_matches_passenger_user_id_fkey(id, name, user_type, avatar_url)')
      .or(`crew_user_id.eq.${userId},passenger_user_id.eq.${userId}`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async findMatch(flightNumber, flightDate) {
    const { data, error } = await supabase
      .from('flight_schedules')
      .select('*, profiles(id, name, user_type, avatar_url, airline)')
      .eq('flight_number', flightNumber)
      .eq('flight_date', flightDate)
      .eq('is_public', true);
    if (error) throw error;
    return data;
  },

  // Find pending matches waiting for the opposite side
  async findPendingMatch(flightNumber, flightDate, status) {
    const { data, error } = await supabase
      .from('commendation_matches')
      .select('*')
      .eq('flight_number', flightNumber)
      .eq('flight_date', flightDate)
      .eq('status', status);
    if (error) throw error;
    return data;
  },

  async createMatch(matchData) {
    const { data: result, error } = await supabase
      .from('commendation_matches')
      .insert(matchData)
      .select()
      .single();
    if (error) throw error;
    return result;
  },

  async updateMatchStatus(matchId, updates) {
    const { data, error } = await supabase
      .from('commendation_matches')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async submitCommendation(matchId, screenshotUrl) {
    const { data, error } = await supabase
      .from('commendation_matches')
      .update({
        status: 'commendation_submitted',
        commendation_screenshot_url: screenshotUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async verifyCommendation(matchId) {
    const { data, error } = await supabase
      .from('commendation_matches')
      .update({
        status: 'verified',
        updated_at: new Date().toISOString()
      })
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async sendGift(matchId, points, message) {
    const { data, error } = await supabase
      .from('commendation_matches')
      .update({
        status: 'gift_sent',
        gift_points: points,
        gift_message: message,
        updated_at: new Date().toISOString()
      })
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async rejectCommendation(matchId) {
    const { data, error } = await supabase
      .from('commendation_matches')
      .update({
        status: 'rejected',
        updated_at: new Date().toISOString()
      })
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

// ============================================================
// Keywords & Notifications
// ============================================================

export const keywordsApi = {
  async getMyKeywords(userId) {
    const { data, error } = await supabase
      .from('user_keywords')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async add(userId, keyword) {
    const { data, error } = await supabase
      .from('user_keywords')
      .insert({ user_id: userId, keyword })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async remove(id) {
    const { error } = await supabase.from('user_keywords').delete().eq('id', id);
    if (error) throw error;
  },
};

export const notificationsApi = {
  async getMy(userId) {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    return data;
  },

  async markRead(id) {
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
};

// ============================================================
// Points
// ============================================================

export const pointsApi = {
  async addTransaction(userId, amount, type, description) {
    // Add transaction
    await supabase.from('point_transactions').insert({
      user_id: userId, amount, type, description
    });
    // Update balance
    const { data } = await supabase
      .from('profiles')
      .select('points_balance')
      .eq('id', userId)
      .single();
    const newBalance = (data?.points_balance || 0) + amount;
    await supabase.from('profiles').update({ points_balance: newBalance }).eq('id', userId);
    return newBalance;
  },

  async getTransactions(userId) {
    const { data, error } = await supabase
      .from('point_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data;
  },
};

// ============================================================
// Messages (같은편 동행 쪽지)
// ============================================================

export const messagesApi = {
  async send(senderId, receiverId, content, flightNumber = null) {
    const { data, error } = await supabase
      .from('messages')
      .insert({ sender_id: senderId, receiver_id: receiverId, content, flight_number: flightNumber })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getConversation(userId, otherUserId) {
    const { data, error } = await supabase
      .from('messages')
      .select('*, sender:profiles!messages_sender_id_fkey(id, name, avatar_url), receiver:profiles!messages_receiver_id_fkey(id, name, avatar_url)')
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${userId})`)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  },

  async getMyMessages(userId) {
    const { data, error } = await supabase
      .from('messages')
      .select('*, sender:profiles!messages_sender_id_fkey(id, name, avatar_url), receiver:profiles!messages_receiver_id_fkey(id, name, avatar_url)')
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async markAsRead(messageId) {
    const { error } = await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('id', messageId);
    if (error) throw error;
  },
};

// ============================================================
// Flight Companions (같은편 동행)
// ============================================================

export const flightCompanionsApi = {
  async getCompanions(flightNumber, flightDate, userId) {
    const { data, error } = await supabase
      .from('flight_schedules')
      .select('*, profiles(id, name, avatar_url, user_type)')
      .eq('flight_number', flightNumber)
      .eq('flight_date', flightDate)
      .eq('is_public', true)
      .neq('user_id', userId);
    if (error) throw error;
    return data;
  },
};

// ============================================================
// Market Transactions (포인트 결제)
// ============================================================

export const marketTransactionApi = {
  async purchaseWithPoints(listingId, sellerId, buyerId, amount) {
    // Deduct points from buyer
    await pointsApi.addTransaction(
      buyerId,
      -amount,
      'market_purchase',
      `장터 물품 구매 (ID: ${listingId})`
    );
    // Add points to seller
    await pointsApi.addTransaction(
      sellerId,
      amount,
      'market_sale',
      `장터 물품 판매 수익 (ID: ${listingId})`
    );
    // Mark listing as sold
    const { data, error } = await supabase
      .from('market_listings')
      .update({ status: 'sold', buyer_id: buyerId })
      .eq('id', listingId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

// ============================================================
// Storage (이미지 업로드)
// ============================================================

export const storageApi = {
  async upload(bucket, filePath, file) {
    const { data, error } = await supabase.storage.from(bucket).upload(filePath, file);
    if (error) throw error;
    return data;
  },
  getPublicUrl(bucket, filePath) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
    return data.publicUrl;
  },
};

// ============================================================
// Real-time Subscriptions
// ============================================================

// ============================================================
// Reports (신고)
// ============================================================

export const reportApi = {
  async create(report) {
    const { data, error } = await supabase
      .from('reports')
      .insert(report)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getAll() {
    // NOTE: Admin needs to read ALL reports regardless of RLS.
    // Update RLS policy: allow select on reports where auth.uid() is in profiles with role='admin'
    const { data, error } = await supabase
      .from('reports')
      .select('*, reporter:profiles!reports_reporter_id_fkey(id, name, email, avatar_url), reported:profiles!reports_reported_user_id_fkey(id, name, email, avatar_url)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async updateStatus(id, status, adminNote = null) {
    const updates = { status };
    if (adminNote) updates.admin_note = adminNote;
    const { data, error } = await supabase
      .from('reports')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

// ============================================================
// Block (사용자 차단)
// ============================================================

export const blockApi = {
  async banUser(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ is_banned: true })
      .eq('id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async unbanUser(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ is_banned: false })
      .eq('id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

// ============================================================
// Admin API (관리자)
// ============================================================

export const adminApi = {
  async getAllProfiles() {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async updateUserRole(userId, role) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    // Total users
    const { count: totalUsers } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    // New users today
    const { count: newUsersToday } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayISO);

    // Pending reports
    const { count: pendingReports } = await supabase
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', '대기');

    // Post counts per board
    const { count: companionCount } = await supabase.from('companion_posts').select('*', { count: 'exact', head: true });
    const { count: qnaCount } = await supabase.from('qna_posts').select('*', { count: 'exact', head: true });
    const { count: marketCount } = await supabase.from('market_listings').select('*', { count: 'exact', head: true });
    const { count: crewCount } = await supabase.from('crew_posts').select('*', { count: 'exact', head: true });

    const totalPosts = (companionCount || 0) + (qnaCount || 0) + (marketCount || 0) + (crewCount || 0);

    // Daily signups (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const { data: recentUsers } = await supabase
      .from('profiles')
      .select('created_at')
      .gte('created_at', sevenDaysAgo.toISOString());

    // Daily posts (last 7 days) - combine all boards
    const { data: recentCompanion } = await supabase.from('companion_posts').select('created_at').gte('created_at', sevenDaysAgo.toISOString());
    const { data: recentQna } = await supabase.from('qna_posts').select('created_at').gte('created_at', sevenDaysAgo.toISOString());
    const { data: recentMarket } = await supabase.from('market_listings').select('created_at').gte('created_at', sevenDaysAgo.toISOString());
    const { data: recentCrew } = await supabase.from('crew_posts').select('created_at').gte('created_at', sevenDaysAgo.toISOString());

    return {
      totalUsers: totalUsers || 0,
      newUsersToday: newUsersToday || 0,
      pendingReports: pendingReports || 0,
      totalPosts,
      boardCounts: {
        companion: companionCount || 0,
        qna: qnaCount || 0,
        market: marketCount || 0,
        crew: crewCount || 0,
      },
      recentUsers: recentUsers || [],
      recentPosts: [
        ...(recentCompanion || []),
        ...(recentQna || []),
        ...(recentMarket || []),
        ...(recentCrew || []),
      ],
    };
  },
};

// ============================================================
// Real-time Subscriptions
// ============================================================

export const subscribeToNewPosts = (table, callback) => {
  const channel = supabase
    .channel(`public:${table}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table }, (payload) => {
      callback(payload.new);
    });

  channel.subscribe((status, err) => {
    if (err) {
      console.warn(`Realtime subscription error for ${table}:`, err);
    }
  });

  return channel;
};

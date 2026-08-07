import { supabase } from './supabase';

// ============================================================
// Companion Posts (동행 게시판)
// ============================================================

export const companionApi = {
  async getByRegion(regionId) {
    const { data, error } = await supabase
      .from('companion_posts')
      .select('*, profiles(user_type, crew_verified)')
      .eq('region_id', regionId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async create(post) {
    const { data, error } = await supabase
      .from('companion_posts')
      .insert(post)
      .select('*, profiles(user_type, crew_verified)')
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
    // market_listings 는 profiles FK 가 2개(user_id/buyer_id)라 작성자 임베드에 FK 힌트 필수
    let query = supabase.from('market_listings').select('*, profiles!market_listings_user_id_fkey(user_type, crew_verified)').order('created_at', { ascending: false });
    if (type) query = query.eq('type', type);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async create(listing) {
    const { data, error } = await supabase
      .from('market_listings')
      .insert(listing)
      .select('*, profiles!market_listings_user_id_fkey(user_type, crew_verified)')
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
      .select('*, qna_comments(*, profiles(user_type, crew_verified)), profiles(user_type, crew_verified)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getById(id) {
    // Increment view count
    await supabase.rpc('increment_view_count', { post_id: id }).catch(() => {});
    const { data, error } = await supabase
      .from('qna_posts')
      .select('*, qna_comments(*, profiles(user_type, crew_verified)), profiles(user_type, crew_verified)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async create(post) {
    const { data, error } = await supabase
      .from('qna_posts')
      .insert(post)
      .select('*, profiles(user_type, crew_verified)')
      .single();
    if (error) throw error;
    return data;
  },

  async addComment(comment) {
    const { data, error } = await supabase
      .from('qna_comments')
      .insert(comment)
      .select('*, profiles(user_type, crew_verified)')
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
    let query = supabase.from('crew_posts').select('*, profiles(user_type, crew_verified)').order('created_at', { ascending: false });
    if (postType) query = query.eq('post_type', postType);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async create(post) {
    const { data, error } = await supabase
      .from('crew_posts')
      .insert(post)
      .select('*, profiles(user_type, crew_verified)')
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
    let query = supabase.from('reviews').select('*, profiles(name, user_type, crew_verified, avatar_url)').order('created_at', { ascending: false });
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
      .select('*, profiles(name, user_type, crew_verified, avatar_url)')
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
    let query = supabase.from('destinations').select('*, profiles(name, user_type, crew_verified, avatar_url)').order('likes_count', { ascending: false });
    if (regionId) query = query.eq('region_id', regionId);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async create(dest) {
    const { data, error } = await supabase
      .from('destinations')
      .insert(dest)
      .select('*, profiles(name, user_type, crew_verified, avatar_url)')
      .single();
    if (error) throw error;
    return data;
  },

  async like(id) {
    // Try RPC first, fallback to manual increment
    try {
      const { data, error } = await supabase.rpc('increment_likes', { dest_id: id });
      if (!error) return data;
    } catch { /* RPC 미존재(전환기) — 아래 수동 증가로 폴백 */ }
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
    // Try RPC first, fallback to manual decrement
    try {
      const { data, error } = await supabase.rpc('decrement_likes', { dest_id: id });
      if (!error) return data;
    } catch { /* RPC 미존재(SQL 미적용)면 수동 감소 폴백 */ }
    // Fallback: manual decrement
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
  // 서버 RPC 로 조회한다. 예전엔 profiles 를 그대로 임베드해 승무원 실명·소속이
  // 공개 시점(비행 다음날) 전에도 응답에 담겨 내려왔고, 가림은 화면에서만 했다.
  // 이제 공개 조건을 서버가 판정하고 조건 미충족이면 crew 자체를 null 로 내린다.
  async getMyMatches() {
    const { data, error } = await supabase.rpc('get_my_commendation_matches');
    if (error) throw error;
    return data || [];
  },

  async findMatch(flightNumber, flightDate) {
    const { data, error } = await supabase
      .from('flight_schedules')
      .select('*, profiles(id, name, user_type, avatar_url, airline_name)')
      .eq('flight_number', flightNumber)
      .eq('flight_date', flightDate)
      .eq('is_public', true);
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

  // 승인·거절은 서버 RPC 로만 한다. 직접 UPDATE 는 commendation_guard 가 막고(정상),
  // RLS 상 관리자 정책도 필요해 예전엔 0행 갱신으로 조용히 실패했다.
  async verifyCommendation(matchId) {
    const { data, error } = await supabase.rpc('admin_review_commendation', {
      p_match_id: matchId,
      p_action: 'approve',
    });
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
    const { data, error } = await supabase.rpc('admin_review_commendation', {
      p_match_id: matchId,
      p_action: 'reject',
    });
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

// 키워드 알림: 최근 게시글을 가볍게 폴링해서 키워드와 매칭한다.
// (Supabase realtime 퍼블리케이션 설정 없이도 동작하도록 폴링 방식 채택.
//  RPC/보안 로직과 무관한 단순 SELECT 만 수행한다.)
// select('*') 로 받아 모든 문자열 컬럼을 매칭 대상으로 삼는다 →
// 보드별 컬럼명(content/description 등) 차이/스키마 변경에 영향받지 않는다.
const KEYWORD_BOARDS = [
  { table: 'companion_posts', path: '/companion' },
  { table: 'qna_posts', path: '/qna' },
  { table: 'market_listings', path: '/market' },
  { table: 'reviews', path: '/reviews' },
  { table: 'destinations', path: '/recommend' },
];

// 매칭에서 제외할 비텍스트/식별자 성격 컬럼 (오탐 방지)
const KEYWORD_SKIP_FIELDS = new Set([
  'id', 'user_id', 'buyer_id', 'region_id', 'image_url', 'avatar_url',
  'created_at', 'updated_at', 'status', 'type', 'post_type',
]);

export const keywordAlertsApi = {
  // sinceIso 이후 새 글 중 keywords(문자열 배열) 와 매칭되는 항목 목록 반환.
  // 실패한 보드는 조용히 건너뛰고(앱 안정성 우선) 나머지는 정상 반환한다.
  async findMatches(sinceIso, keywords) {
    if (!Array.isArray(keywords) || keywords.length === 0) return [];
    const lowered = keywords.map(k => String(k).toLowerCase()).filter(Boolean);
    if (lowered.length === 0) return [];

    const results = [];
    await Promise.all(
      KEYWORD_BOARDS.map(async (board) => {
        try {
          const { data, error } = await supabase
            .from(board.table)
            .select('*')
            .gt('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(20);
          if (error || !data) return;
          for (const row of data) {
            const haystack = Object.keys(row)
              .filter(k => !KEYWORD_SKIP_FIELDS.has(k) && typeof row[k] === 'string')
              .map(k => row[k])
              .join(' ')
              .toLowerCase();
            const matched = lowered.find(kw => haystack.includes(kw));
            if (matched) {
              results.push({
                id: `${board.table}:${row.id}`,
                keyword: matched,
                table: board.table,
                path: board.path,
                created_at: row.created_at,
              });
            }
          }
        } catch {
          // 개별 보드 실패는 무시 (네트워크/권한 등) — 전체 폴링은 계속 동작
        }
      })
    );
    return results;
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
  // 포인트 가감은 용도별 전용 RPC(purchase_voucher / convert_likes_to_points /
  // market_purchase / send_commendation_gift / grant_referral_bonus)로만 처리한다.
  // 임의 사용자 포인트를 직접 조정하는 범용 addTransaction 은 보안상 제거됨.
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
// Post Likes (게시판 글 좋아요 → 작성자 포인트 적립)
// 좋아요/적립 로직은 toggle_post_like RPC(SECURITY DEFINER)가 강제:
// 자가 좋아요 적립 무효 · phone_verified 한정 · 1인1글1좋아요 · 작성자 월 적립 상한.
// ============================================================
export const postLikeApi = {
  // 좋아요 토글. 반환 { liked, likes_count }
  toggle: (boardType, postId) =>
    supabase.rpc('toggle_post_like', { p_board_type: boardType, p_post_id: postId }),
  // 해당 보드 글들의 좋아요 수 + 내가 누른 여부 일괄 조회 → { [postId]: { count, liked } }
  async getForBoard(boardType, postIds, userId = null) {
    if (!postIds || postIds.length === 0) return {};
    const { data, error } = await supabase
      .from('post_likes').select('post_id, user_id')
      .eq('board_type', boardType).in('post_id', postIds);
    if (error) return {};  // post_likes 미적용/조회 실패 시 좋아요 없이 표시(목록은 정상)
    const map = {};
    (data || []).forEach((r) => {
      if (!map[r.post_id]) map[r.post_id] = { count: 0, liked: false };
      map[r.post_id].count += 1;
      if (userId && r.user_id === userId) map[r.post_id].liked = true;
    });
    return map;
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
  async purchaseWithPoints(listingId, expectedPrice) {
    // 서버 RPC 가 listing 가격 전액을 포인트로 결제(판매자/금액 위조 불가). 부분·현금 결제는 PG 연동 후.
    // expectedPrice = 구매자가 화면에서 확인한 가격. 서버가격과 다르면(결제 직전 인상) 거부된다.
    const { error } = await supabase.rpc('market_purchase', {
      p_listing_id: listingId, p_expected_price: expectedPrice,
    });
    if (error) throw error;
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
      .select('*, reporter:profiles!reports_reporter_id_fkey(id, name, avatar_url), reported:profiles!reports_reported_user_id_fkey(id, name, avatar_url)')
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
    // returning(.select()) 없음 — profiles 컬럼 잠금(PART2) 후에도 동작 (호출부는 반환값 미사용)
    const { error } = await supabase
      .from('profiles')
      .update({ is_banned: true })
      .eq('id', userId);
    if (error) throw error;
  },

  async unbanUser(userId) {
    const { error } = await supabase
      .from('profiles')
      .update({ is_banned: false })
      .eq('id', userId);
    if (error) throw error;
  },
};

// ============================================================
// User Blocks (회원 간 차단) — 관리자 제재(is_banned)와 별개.
// 차단하면 서버 정책이 양쪽 쪽지 발송을 막고, 목록에서는 상대 글이 숨겨진다.
// ============================================================

export const userBlockApi = {
  // 내가 차단한 사람 id 목록 (RLS 상 내가 건 차단만 조회된다)
  async getMyBlockedIds() {
    const { data, error } = await supabase.from('blocks').select('blocked_id');
    if (error) throw error;
    return (data || []).map((r) => r.blocked_id);
  },

  // 차단 목록 + 상대 표시 정보 (마이페이지용)
  async getMyBlocks() {
    const { data, error } = await supabase
      .from('blocks')
      .select('blocked_id, created_at, blocked:profiles!blocks_blocked_id_fkey(id, name, nickname, avatar_url)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async block(userId) {
    const { data: auth } = await supabase.auth.getUser();
    const me = auth?.user?.id;
    if (!me) throw new Error('로그인이 필요합니다.');
    if (me === userId) throw new Error('자기 자신은 차단할 수 없습니다.');
    const { error } = await supabase.from('blocks').insert({ blocker_id: me, blocked_id: userId });
    if (error && error.code !== '23505') throw error; // 이미 차단됨은 성공으로 취급
  },

  async unblock(userId) {
    const { error } = await supabase.from('blocks').delete().eq('blocked_id', userId);
    if (error) throw error;
  },
};

// ============================================================
// Admin API (관리자)
// ============================================================

export const adminApi = {
  async getAllProfiles() {
    // admin_list_profiles RPC 우선 (profiles SELECT 컬럼 잠금 대비).
    // 전환기 폴백: profiles 잠금 SQL 적용 후 select('*') 폴백은 제거 가능.
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('admin_list_profiles');
      if (!rpcError && rpcData) return rpcData;
    } catch { /* RPC 미존재(SQL 미적용)면 폴백 */ }
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async updateUserRole(userId, role) {
    // returning(.select()) 없음 — profiles 컬럼 잠금(PART2) 후에도 동작 (호출부는 반환값 미사용)
    const { error } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', userId);
    if (error) throw error;
  },

  // 관리자 직접 지급 — 포인트 선물 (RPC admin_grant_points: 서버에서 is_admin 가드 + point_transactions 감사로그)
  async grantPoints(userId, amount, reason) {
    const { error } = await supabase.rpc('admin_grant_points', {
      p_user_id: userId, p_amount: amount, p_reason: reason || null,
    });
    if (error) throw error;
  },

  // 관리자 직접 지급 — 칭송사용권(매칭신청권) 선물 (RPC admin_grant_vouchers)
  async grantVouchers(userId, qty, reason) {
    const { error } = await supabase.rpc('admin_grant_vouchers', {
      p_user_id: userId, p_qty: qty, p_reason: reason || null,
    });
    if (error) throw error;
  },

  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoISO = sevenDaysAgo.toISOString();

    // 모든 집계/조회 쿼리를 병렬로 실행해 직렬 await 지연을 제거한다.
    const [
      { count: totalUsers },
      { count: newUsersToday },
      { count: pendingReports },
      { count: companionCount },
      { count: qnaCount },
      { count: marketCount },
      { count: crewCount },
      { data: recentUsers },
      { data: recentCompanion },
      { data: recentQna },
      { data: recentMarket },
      { data: recentCrew },
    ] = await Promise.all([
      // Total users
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      // New users today
      supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', todayISO),
      // Pending reports
      supabase.from('reports').select('*', { count: 'exact', head: true }).eq('status', '대기'),
      // Post counts per board
      supabase.from('companion_posts').select('*', { count: 'exact', head: true }),
      supabase.from('qna_posts').select('*', { count: 'exact', head: true }),
      supabase.from('market_listings').select('*', { count: 'exact', head: true }),
      supabase.from('crew_posts').select('*', { count: 'exact', head: true }),
      // Daily signups (last 7 days)
      supabase.from('profiles').select('created_at').gte('created_at', sevenDaysAgoISO),
      // Daily posts (last 7 days) - combine all boards
      supabase.from('companion_posts').select('created_at').gte('created_at', sevenDaysAgoISO),
      supabase.from('qna_posts').select('created_at').gte('created_at', sevenDaysAgoISO),
      supabase.from('market_listings').select('created_at').gte('created_at', sevenDaysAgoISO),
      supabase.from('crew_posts').select('created_at').gte('created_at', sevenDaysAgoISO),
    ]);

    const totalPosts = (companionCount || 0) + (qnaCount || 0) + (marketCount || 0) + (crewCount || 0);

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

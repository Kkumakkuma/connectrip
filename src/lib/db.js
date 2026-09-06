import { supabase } from './supabase';
import { ITINERARY_ENABLED, PROMO_REVIEWS_ENABLED } from './featureFlags';

// ============================================================
// 게시판 목록 조회 상한
// ------------------------------------------------------------
// 목록 API 는 전건을 받아 화면에서 slice 하는 구조라, 글이 쌓이는 만큼 첫 화면
// 페이로드가 선형으로 커진다. 서버 페이지네이션(.range)으로 완전히 넘기려면
// 차단 회원 필터·정렬 타이브레이커·복합 인덱스를 함께 옮겨야 해서 별도 작업으로
// 두고, 여기서는 무한 증가만 막는 상한을 건다.
// 300 = 2026-08-28 실측 최대 테이블(destinations 34건, reviews 28건, 나머지 0건)의
// 약 9배 여유이고 화면당 6~8건 기준 38~50페이지 분량이라, 지금 화면 동작은 그대로다.
// 어느 게시판이든 300건을 넘기기 시작하면 이 상수를 올리지 말고 서버 페이지네이션
// 전환을 진행해야 한다.
// ============================================================
const LIST_FETCH_LIMIT = 300;

// ============================================================
// Companion Posts (동행 게시판)
// ============================================================

export const companionApi = {
  async getByRegion(regionId) {
    const { data, error } = await supabase
      .from('companion_posts')
      .select('*, profiles(user_type, crew_verified)')
      .eq('region_id', regionId)
      .order('created_at', { ascending: false })
      // id 2차 정렬 = 정렬값이 같을 때 상한 경계에서 뽑히는 행이 매번 달라지지 않게 고정
      .order('id', { ascending: false })
      .limit(LIST_FETCH_LIMIT);
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
    let query = supabase.from('market_listings')
      .select('*, profiles!market_listings_user_id_fkey(user_type, crew_verified)')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(LIST_FETCH_LIMIT);
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
// Itinerary Posts (여행 일정 게시판)
// ------------------------------------------------------------
// 글쓰기 경로가 없는 게시판이다. 글은 플래너의 planner_publish_to_board RPC 만 만들고
// (itinerary_posts = 읽기 공개 / 쓰기 RPC 전용), 여기에는 읽기와 가져오기만 둔다.
// 목록에서 snapshot(여행 전체 jsonb)을 통째로 받지 않는다 — 카드 미니맵에 필요한 days 만
// PostgREST 의 JSON 경로 선택(snapshot->days)으로 좁혀 받는다.
// ============================================================

// 카드가 실제로 쓰는 컬럼만. snapshot 은 여기에 넣지 않는다.
const ITINERARY_CARD_COLUMNS =
  'id,created_at,title,country,start_date,end_date,days_count,places_count,author_name,user_id,view_count,import_count';

export const itineraryApi = {
  // 1차 범위는 '더보기' 없이 첫 페이지 고정.
  // 정렬은 idx_itinerary_posts_created (created_at DESC, id DESC) 와 같은 순서로 둔다.
  async getList(limit = 20) {
    const { data, error } = await supabase
      .from('itinerary_posts')
      .select(`${ITINERARY_CARD_COLUMNS},days:snapshot->days,profiles(user_type, crew_verified)`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  // 상세는 날짜별 동선 요약을 그려야 해서 스냅샷 전문이 필요하다.
  async getById(id) {
    const { data, error } = await supabase
      .from('itinerary_posts')
      .select('*, profiles(user_type, crew_verified)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  // 조회수. 서버가 글당 10분 60회로 스로틀한다(planner_bump_post_view).
  async bumpView(id) {
    const { error } = await supabase.rpc('planner_bump_post_view', { p_post_id: id });
    if (error) throw error;
  },

  // 게시글 스냅샷을 내 플래너로 복사한다. 반환값 = 새로 만들어진 여행 id.
  // 값 검증·상한은 전부 서버(planner_import)가 한다.
  async importPost(postId) {
    const { data, error } = await supabase.rpc('planner_import', { p_post_id: postId });
    if (error) throw error;
    return data;
  },
};

// ============================================================
// QnA Board (여행 Q&A)
// ============================================================

export const qnaApi = {
  // 목록 카드가 쓰는 건 댓글 '개수'뿐이고 본문은 펼친 한 건에서만 그린다.
  // 예전엔 모든 글의 모든 댓글 + 댓글마다 profiles 조인까지 한 응답에 실려 내려왔다.
  // 이제 집계 임베드(qna_comments(count))로 개수만 받고, 본문은 getComments 로 따로 받는다.
  async getAll() {
    const { data, error } = await supabase
      .from('qna_posts')
      .select('*, qna_comments(count), profiles(user_type, crew_verified)')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(LIST_FETCH_LIMIT);
    if (error) throw error;
    // PostgREST 집계 임베드는 [{ count: n }] 형태로 온다. 호출부가 그 형태를 알 필요가
    // 없도록 comment_count 로 펴서 내리고, 본문이 없는 qna_comments 키는 제거한다.
    return (data || []).map(({ qna_comments: commentAgg, ...post }) => ({
      ...post,
      comment_count: commentAgg?.[0]?.count ?? 0,
    }));
  },

  // 글 하나의 댓글 본문 조회 (목록에서 글을 펼칠 때 호출).
  // getById 를 재사용하지 않는 이유 = 그쪽은 조회수 증가 RPC 가 함께 나간다.
  async getComments(postId) {
    const { data, error } = await supabase
      .from('qna_comments')
      .select('*, profiles(user_type, crew_verified)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
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
    let query = supabase.from('crew_posts')
      .select('*, profiles(user_type, crew_verified)')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(LIST_FETCH_LIMIT);
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
    let query = supabase.from('reviews')
      .select('*, profiles(name, user_type, crew_verified, avatar_url)')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(LIST_FETCH_LIMIT);
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
    // likes_count 는 같은 값이 흔하고 실시간으로 변한다. id 2차 정렬이 없으면
    // 같은 좋아요 수끼리 순서가 조회할 때마다 뒤바뀐다.
    let query = supabase.from('destinations')
      .select('*, profiles(name, user_type, crew_verified, avatar_url)')
      .order('likes_count', { ascending: false })
      .order('id', { ascending: false })
      .limit(LIST_FETCH_LIMIT);
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

  // like/unlike 는 제거했다(2026-08-28). destinations.likes_count 를 클라이언트가 직접
  // UPDATE 하는 경로라 좋아요를 무한히 조작할 수 있었다. 좋아요는 post_likes 테이블 +
  // toggle_post_like RPC 로 서버가 1인 1회를 강제한다(postLikeApi 참고).

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
};

// ============================================================
// Commendation Matching (칭찬매칭)
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

  // 제출 상태·스크린샷 URL 은 commendation_guard 가 보호한다(클라이언트 직접 UPDATE 는 거부).
  // 본인 매칭인지·상태·비행 완료(KST)·URL 형식 검증은 서버 RPC 가 한다.
  async submitCommendation(matchId, screenshotUrl) {
    const { data, error } = await supabase.rpc('submit_commendation_screenshot', {
      p_match_id: matchId,
      p_url: screenshotUrl,
    });
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
// 기본은 select('*') 로 받아 모든 문자열 컬럼을 매칭 대상으로 삼는다 →
// 보드별 컬럼명(content/description 등) 차이/스키마 변경에 영향받지 않는다.
// 단 큰 비텍스트 컬럼(itinerary_posts.snapshot jsonb = 여행 전체)을 가진 보드는 board.select 로
// 좁힌다. 폴링이 1분 주기 × 보드당 최대 20행이라 전송량이 그대로 Supabase egress 비용이 된다.
// (board.select 를 적어 두기만 하면 아무 일도 일어나지 않는다 — 아래 쿼리도 함께 읽어야 한다.)
// type = add_keyword_notification(p_post_type) 이 받는 값 (서버가 링크를 조립한다)
const KEYWORD_BOARDS = [
  { table: 'companion_posts', path: '/companion', type: 'companion' },
  { table: 'qna_posts', path: '/qna', type: 'qna' },
  { table: 'market_listings', path: '/market', type: 'market' },
  // reviews 테이블은 "여행상품 홍보 및 후기"(숨김 중)와 "여행후기 및 Q&A"의 여행 후기 탭이 함께 쓴다 — 알림은 유지한다.
  // 숨김 동안 /reviews 링크는 App.jsx 가 /qna?tab=review 로 보낸다(agy 9/6: 통째로 빼면 후기 알림까지 끊긴다).
  { table: 'reviews', path: PROMO_REVIEWS_ENABLED ? '/reviews' : '/qna?tab=review', type: 'reviews' },
  { table: 'destinations', path: '/recommend', type: 'destinations' },
  // author_name 포함은 의도적이다 — 기존 5개 보드가 전부 author_name 을 매칭 대상으로 삼고
  // 있어서(KEYWORD_SKIP_FIELDS 에도 없다) 여기서만 빼면 보드별 매칭 범위가 갈라진다.
  // 게시판이 닫혀 있는 동안은 대상에서 뺀다 — 알림을 눌러도 NotFound 로 떨어진다.
  ...(ITINERARY_ENABLED ? [{
    table: 'itinerary_posts',
    path: '/itinerary',
    type: 'itinerary',
    select: 'id,created_at,title,content,author_name,country',
  }] : []),
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
    // 매칭은 소문자로, 반환은 등록 원문으로 한다.
    // add_keyword_notification 이 user_keywords.keyword 와 정확히 비교하므로
    // 소문자로 변환된 값을 넘기면 영문 키워드가 조용히 무시된다.
    const targets = keywords
      .map(k => ({ raw: String(k), lc: String(k).toLowerCase() }))
      .filter(t => t.lc);
    if (targets.length === 0) return [];

    const results = [];
    await Promise.all(
      KEYWORD_BOARDS.map(async (board) => {
        try {
          const { data, error } = await supabase
            .from(board.table)
            .select(board.select || '*')
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
            const matched = targets.find(t => haystack.includes(t.lc));
            if (matched) {
              results.push({
                // id 는 seen 집합 키(테이블 간 id 충돌 방지) — 형식 유지
                id: `${board.table}:${row.id}`,
                postId: row.id,
                postType: board.type,
                keyword: matched.raw,
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
      .limit(30);
    if (error) throw error;
    return data;
  },

  // 종 아이콘 배지용 정확 집계. 목록(30건)만 세면 그보다 많을 때 숫자가 틀린다.
  // RLS 가 본인 행만 보여주지만 user_id 조건을 명시해 의도를 남긴다.
  async getUnreadCount(userId) {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) throw error;
    return count || 0;
  },

  async markRead(id) {
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  // 본인 것 전부 읽음 처리 + 보관 상한 정리. 처리 건수를 반환한다.
  async markAllRead() {
    const { data, error } = await supabase.rpc('mark_all_notifications_read');
    if (error) throw error;
    return data || 0;
  },

  async remove(id) {
    const { error } = await supabase.from('notifications').delete().eq('id', id);
    if (error) throw error;
  },
};

// 알림 설정 (행이 없으면 전부 켬으로 간주 — DB 의 notify_user 와 같은 기본값)
export const NOTIFICATION_PREF_DEFAULTS = {
  comments: true,
  commendation: true,
  flight: true,
  companion: true,
  keywords: true,
};

export const notificationPrefsApi = {
  async get(userId) {
    const { data, error } = await supabase
      .from('notification_prefs')
      .select('comments, commendation, flight, companion, keywords')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return { ...NOTIFICATION_PREF_DEFAULTS, ...(data || {}) };
  },

  async upsert(userId, prefs) {
    const row = { user_id: userId, updated_at: new Date().toISOString() };
    // 스위치 5개만 저장한다 (호출부가 넘긴 여분 필드로 upsert 가 깨지지 않게)
    for (const key of Object.keys(NOTIFICATION_PREF_DEFAULTS)) {
      row[key] = prefs?.[key] !== false;
    }
    const { error } = await supabase
      .from('notification_prefs')
      .upsert(row, { onConflict: 'user_id' });
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
  // .in() 은 id 를 전부 URL 쿼리스트링에 싣는다. uuid 는 1건당 약 40자라 목록이 길어지면
  // URL 길이 제한에 걸려 조회가 통째로 실패한다. 100건씩 잘라 병렬로 던진다.
  async getForBoard(boardType, postIds, userId = null) {
    if (!postIds || postIds.length === 0) return {};
    const CHUNK = 100;
    const chunks = [];
    for (let i = 0; i < postIds.length; i += CHUNK) chunks.push(postIds.slice(i, i + CHUNK));
    const results = await Promise.all(chunks.map((ids) =>
      supabase.from('post_likes').select('post_id, user_id')
        .eq('board_type', boardType).in('post_id', ids)
    ));
    // 한 청크라도 실패하면 좋아요 수가 실제보다 적게 보이므로 전체를 포기한다
    // (post_likes 미적용/조회 실패 시 좋아요 없이 표시 — 목록 자체는 정상 동작)
    if (results.some((r) => r.error)) return {};
    const data = results.flatMap((r) => r.data || []);
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
// Flight Board (같은 편 익명 게시판) — 2026-09-06 개편
//   스케줄을 등록한 사람만 그 편 게시판에 들어가고, 글·댓글은 서버가 배정한 익명 번호로만 표시된다.
//   입장 자격·작성 기간·비밀댓글 가시성·차단은 전부 서버 RPC 가 판정한다. 응답에 작성자 id·실명은 없다.
//   쪽지(messages)·동행 명단 조회는 이 개편으로 없어졌다(명단은 개인정보라 누구도 볼 수 없다).
// ============================================================

const rpc = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
};

export const flightBoardApi = {
  // → { eligible, writable, member_type, my_alias, posts: [{ id, alias, content, created_at, mine, deletable, comments: [...] }] }
  async list(flightNumber, flightDate) {
    const data = await rpc('flight_board_list', { p_flight: flightNumber, p_date: flightDate });
    return data || { eligible: false, writable: false, member_type: null, my_alias: null, posts: [] };
  },
  async createPost(flightNumber, flightDate, content) {
    return rpc('flight_board_post', { p_flight: flightNumber, p_date: flightDate, p_content: content });
  },
  async createComment(postId, content, { isPrivate = false, parentId = null } = {}) {
    return rpc('flight_board_comment', { p_post_id: postId, p_content: content, p_private: !!isPrivate, p_parent_id: parentId });
  },
  async deletePost(id) { return rpc('flight_board_delete_post', { p_id: id }); },
  async deleteComment(id) { return rpc('flight_board_delete_comment', { p_id: id }); },
  // 신고·숨김 대상은 글/댓글 id 로만 지정한다. 상대 회원 id 는 서버가 찾고 클라이언트에는 오지 않는다.
  async report({ postId = null, commentId = null, reason }) {
    return rpc('flight_board_report', { p_post_id: postId, p_comment_id: commentId, p_reason: reason });
  },
  async mute({ postId = null, commentId = null }) {
    return rpc('flight_board_mute', { p_post_id: postId, p_comment_id: commentId });
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
  // 신고 행 열람은 관리자만 가능하므로(2026-09-06) 반환행을 요구하지 않는다.
  async create(report) {
    const { error } = await supabase.from('reports').insert(report);
    if (error) throw error;
    return true;
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
// 차단하면 서로의 글·댓글이 목록에서 숨겨지고 알림도 오가지 않는다.
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

// 관리자 회원 목록에서 실제로 화면에 그리는 컬럼(src/pages/Admin.jsx '회원 관리' 탭 실측:
// 이름·이메일·회원유형·포인트·가입일·차단여부·권한 + 행 조작용 id).
// ⚠ select('*') 로 되돌리지 말 것 — 화면에 쓰지도 않는 개인정보(전화·주소·항공사 이메일 등)까지
//   브라우저로 내려보내게 되고, 관리자 PC 하나가 털리면 그게 그대로 유출 범위가 된다.
//   PII 암호화 컬럼(phone_enc/phone_hash/name_enc/addr_*_enc/pii_key_version)은 클라이언트 롤에
//   SELECT 권한 자체가 없으므로(src/lib/pii_encryption_20260905.sql) 절대 넣지 않는다.
const ADMIN_PROFILE_COLUMNS = 'id, name, email, user_type, points_balance, created_at, is_banned, role';

export const adminApi = {
  async getAllProfiles() {
    // admin_list_profiles RPC 우선 (profiles SELECT 컬럼 잠금 대비).
    // 전환기 폴백: profiles 잠금 SQL 적용 후 아래 직접 조회 폴백은 제거 가능.
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('admin_list_profiles');
      if (!rpcError && rpcData) return rpcData;
    } catch { /* RPC 미존재(SQL 미적용)면 폴백 */ }
    const { data, error } = await supabase
      .from('profiles')
      .select(ADMIN_PROFILE_COLUMNS)
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

  // 관리자 직접 지급 — 매칭신청권 선물 (RPC admin_grant_vouchers)
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
      { count: itineraryCount },
      { data: recentUsers },
      { data: recentCompanion },
      { data: recentQna },
      { data: recentMarket },
      { data: recentCrew },
      { data: recentItinerary },
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
      // 여행 일정 게시판. head:true 라 snapshot 본문은 오지 않는다(개수만).
      supabase.from('itinerary_posts').select('id', { count: 'exact', head: true }),
      // Daily signups (last 7 days)
      supabase.from('profiles').select('created_at').gte('created_at', sevenDaysAgoISO),
      // Daily posts (last 7 days) - combine all boards
      supabase.from('companion_posts').select('created_at').gte('created_at', sevenDaysAgoISO),
      supabase.from('qna_posts').select('created_at').gte('created_at', sevenDaysAgoISO),
      supabase.from('market_listings').select('created_at').gte('created_at', sevenDaysAgoISO),
      supabase.from('crew_posts').select('created_at').gte('created_at', sevenDaysAgoISO),
      supabase.from('itinerary_posts').select('created_at').gte('created_at', sevenDaysAgoISO),
    ]);

    const totalPosts =
      (companionCount || 0) + (qnaCount || 0) + (marketCount || 0) + (crewCount || 0) + (itineraryCount || 0);

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
        itinerary: itineraryCount || 0,
      },
      recentUsers: recentUsers || [],
      recentPosts: [
        ...(recentCompanion || []),
        ...(recentQna || []),
        ...(recentMarket || []),
        ...(recentCrew || []),
        ...(recentItinerary || []),
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

import { normalizeAdminReport } from './adminReports';
import { supabase } from './supabase';
import { searchTerm, ilikeOr } from './continents';
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

// 목록(최대 LIST_FETCH_LIMIT 건)은 본문을 받지 않는다(2026-09-26). 본문 한도가 2만 자로 늘어
// '*' 로 받으면 목록 한 번에 수 MB 가 내려올 수 있다. 목록 화면은 제목·작성자·날짜·썸네일만 그리고
// 본문은 상세(getById)에서만 받는다. 검색(ilike 본문)은 select 와 무관하게 서버에서 그대로 걸린다.
// 테이블에 목록이 쓰는 컬럼을 새로 만들면 여기에도 적어야 목록에 나온다.
const QNA_LIST_COLUMNS = 'id, user_id, title, author_name, view_count, created_at, updated_at, board';
const CREW_LIST_COLUMNS = 'id, user_id, post_type, title, category, brand, discount_percent, image_url, author_name, created_at, updated_at, airline_id';
const REVIEW_LIST_COLUMNS = 'id, user_id, region_id, type, title, rating, image_url, author_name, created_at, updated_at, is_private';
// 서식 문서 칸(*_doc, 2026-09-26 서식 편집기 1단계 — 글 하나에 최대 512KB)은 목록·검색·키워드 폴링에서 받지 않는다.
// 상세(getById)와 생성·수정 응답만 받는다. 목록 칸 상수에 '*' 나 '_doc' 이 들어가면 src/lib/rich/selects.test.js 가 막는다.
const COMPANION_LIST_COLUMNS = 'id, user_id, region_id, title, country, travel_date, members_needed, author_name, status, created_at, updated_at';
// 추천지 카드는 꿀팁 앞 200자(crew_comment_preview, 서버가 채우는 칸)만 그린다
const DESTINATION_LIST_COLUMNS = 'id, user_id, region_id, name, description, crew_comment_preview, image_url, likes_count, created_at';
// 홍보 게시판(Promotions, 현재 숨김)은 목록 카드에 본문(평문)을 그린다 — 문서 칸은 빼고 평문만
const REVIEW_BODY_LIST_COLUMNS = `${REVIEW_LIST_COLUMNS}, description`;

// ============================================================
// Companion Posts (동행 게시판)
// ============================================================

// PostgREST 집계 임베드 [{count}] → comment_count 로 펴는 공용 헬퍼 (2026-09-15). 행 하나·배열 모두 받는다.
const flattenCount = (key) => {
  const one = (row) => { if (!row) return row; const { [key]: agg, ...post } = row; return { ...post, comment_count: agg?.[0]?.count ?? 0 }; };
  return (v) => (Array.isArray(v) ? v.map(one) : one(v));
};
const flattenCompanion = flattenCount('companion_comments');
const flattenCrew = flattenCount('crew_comments');
const flattenDestination = flattenCount('destination_comments');

export const companionApi = {
  // 통합 게시판(2026-09-07): 대륙(region_id)·검색어를 서버에서 거르고 페이지 단위로 받는다. 반환 { data, count }.
  // 클라이언트에서 전체를 받아 거르면 인기 대륙이 상한(300)을 채워 다른 대륙 글이 사라진다(agy 지적).
  async getAll({ regionId = null, q = '', page = 1, limit = 20 } = {}) {
    let query = supabase
      .from('companion_posts')
      .select(`${COMPANION_LIST_COLUMNS}, companion_comments(count), profiles(user_type, crew_verified)`, { count: 'exact' })
      .order('created_at', { ascending: false })
      // id 2차 정렬 = 정렬값이 같을 때 페이지 경계에서 뽑히는 행이 매번 달라지지 않게 고정
      .order('id', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (regionId) query = query.eq('region_id', regionId);
    const term = searchTerm(q);
    if (term) query = query.or(ilikeOr(['title', 'country', 'content'], term));
    const { data, count, error } = await query;
    if (error) throw error;
    return { data: flattenCompanion(data || []), count: count || 0 };
  },

  async create(post) {
    const { data, error } = await supabase
      .from('companion_posts')
      .insert(post)
      .select('*, companion_comments(count), profiles(user_type, crew_verified)')
      .single();
    if (error) throw error;
    return flattenCompanion(data);
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('companion_posts')
      .select('*, companion_comments(count), profiles(nickname, user_type, crew_verified)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return flattenCompanion(data);
  },

  // 글쓴이 본인만 통과한다(RLS "Update companion"). status: 'open' | 'closed' (모집완료, 2026-09-14)
  async update(id, patch) {
    const { data, error } = await supabase
      .from('companion_posts')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, companion_comments(count), profiles(nickname, user_type, crew_verified)')
      .single();
    if (error) throw error;
    return flattenCompanion(data);
  },


  // 댓글(companion_comments, 2026-09-15) — 구조·규칙은 qna_comments 와 동일
  async getComments(postId) {
    const { data, error } = await supabase
      .from('companion_comments')
      .select('*, profiles!companion_comments_user_id_fkey(user_type, crew_verified)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async addComment(comment) {
    const { data, error } = await supabase
      .from('companion_comments')
      .insert(comment)
      .select('*, profiles!companion_comments_user_id_fkey(user_type, crew_verified)')
      .single();
    if (error) throw error;
    return data;
  },

  async deleteComment(id) {
    const { error } = await supabase.from('companion_comments').delete().eq('id', id);
    if (error) throw error;
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
  async getAll(type = null, q = '') {
    // market_listings 는 profiles FK 가 2개(user_id/buyer_id)라 작성자 임베드에 FK 힌트 필수
    let query = supabase.from('market_listings')
      .select('*, profiles!market_listings_user_id_fkey(user_type, crew_verified)')
      .order('refreshed_at', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(LIST_FETCH_LIMIT);
    if (type) query = query.eq('type', type);
    const term = searchTerm(q);
    if (term) query = query.or(ilikeOr(['title', 'location', 'content', 'country'], term));
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

  // ---- 당근식 장터(2026-09-06) ----
  async getById(id) {
    const { data, error } = await supabase
      .from('market_listings')
      .select('*, profiles!market_listings_user_id_fkey(id, nickname, avatar_url, user_type, crew_verified)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  async update(id, patch) {
    const { data, error } = await supabase
      .from('market_listings')
      .update(patch)
      .eq('id', id)
      .select('*, profiles!market_listings_user_id_fkey(id, nickname, avatar_url, user_type, crew_verified)')
      .single();
    if (error) throw error;
    return data;
  },
  // { [id]: { favorites, chats, mine_fav } }
  // 200개씩 나눠 요청해 목록 상한(300)과 어긋나지 않게 한다
  async stats(ids) {
    if (!ids || ids.length === 0) return {};
    const out = {};
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase.rpc('market_listing_stats', { p_ids: ids.slice(i, i + 200) });
      if (error) throw error;
      Object.assign(out, data || {});
    }
    return out;
  },
  async setStatus(id, status) {
    const { error } = await supabase.rpc('market_set_status', { p_listing: id, p_status: status });
    if (error) throw error;
  },
  async bump(id) {
    const { error } = await supabase.rpc('market_bump', { p_listing: id });
    if (error) throw error;
  },
  async bumpView(id) {
    const { error } = await supabase.rpc('market_bump_view', { p_listing: id });
    if (error) throw error;
  },
  async setFavorite(id, on) {
    if (on) {
      const { data: auth } = await supabase.auth.getUser();
      const me = auth?.user?.id;
      if (!me) throw new Error('AUTH_REQUIRED');
      const { error } = await supabase.from('market_favorites').insert({ user_id: me, listing_id: id });
      if (error && error.code !== '23505') throw error;
    } else {
      const { error } = await supabase.from('market_favorites').delete().eq('listing_id', id);
      if (error) throw error;
    }
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
  // board: 'qna'(질문) | 'free'(자유게시판, 2026-09-14). 같은 테이블을 board 컬럼으로 나눠 쓴다.
  // q: 검색어. 화면에서 목록을 받아 거르면 LIST_FETCH_LIMIT(300) 밖의 글이 검색에서 조용히
  // 빠지므로 서버에서 건다(2026-09-17). 동행·추천지가 쓰던 방식과 같다.
  async getAll(board = 'qna', q = '') {
    let query = supabase
      .from('qna_posts')
      .select(`${QNA_LIST_COLUMNS}, qna_comments(count), profiles(user_type, crew_verified)`)
      .eq('board', board)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(LIST_FETCH_LIMIT);
    const term = searchTerm(q);
    if (term) query = query.or(ilikeOr(['title', 'content'], term));
    const { data, error } = await query;
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
      .select('*, profiles!qna_comments_user_id_fkey(user_type, crew_verified)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async getById(id) {
    // 조회수 +1 — PostgREST 빌더는 .catch 가 없어 try/catch 로(2026-09-15 상세 페이지에서 실측한 TypeError 수정)
    try { await supabase.rpc('increment_view_count', { post_id: id }); } catch { /* 조회수는 실패해도 글은 보여준다 */ }
    const { data, error } = await supabase
      .from('qna_posts')
      .select('*, qna_comments(count), profiles(user_type, crew_verified)')
      .eq('id', id)
      .single();
    if (error) throw error;
    const { qna_comments: commentAgg, ...post } = data;
    return { ...post, comment_count: commentAgg?.[0]?.count ?? 0 };
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
      .select('*, profiles!qna_comments_user_id_fkey(user_type, crew_verified)')
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, patch) {
    const { data, error } = await supabase
      .from('qna_posts')
      .update(patch)
      .eq('id', id)
      .select('*, qna_comments(count), profiles(user_type, crew_verified)')
      .single();
    if (error) throw error;
    const { qna_comments: commentAgg, ...post } = data;
    return { ...post, comment_count: commentAgg?.[0]?.count ?? 0 };
  },

  // 댓글 삭제 — 본인 댓글만(RLS "Delete comments"). 답글이 달린 댓글은 parent_id CASCADE 로 답글도 지워진다.
  async deleteComment(id) {
    const { error } = await supabase.from('qna_comments').delete().eq('id', id);
    if (error) throw error;
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
  // airlineId: 자유게시판 항공사 말머리 필터(2026-09-17). null 이면 전체.
  async getAll(postType = null, airlineId = null, q = '') {
    let query = supabase.from('crew_posts')
      .select(`${CREW_LIST_COLUMNS}, crew_comments(count), profiles(user_type, crew_verified)`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(LIST_FETCH_LIMIT);
    if (postType) query = query.eq('post_type', postType);
    if (airlineId) query = query.eq('airline_id', airlineId);
    const term = searchTerm(q);
    if (term) query = query.or(ilikeOr(['title', 'content'], term));
    const { data, error } = await query;
    if (error) throw error;
    return flattenCrew(data);
  },

  async create(post) {
    const { data, error } = await supabase
      .from('crew_posts')
      .insert(post)
      .select('*, crew_comments(count), profiles(user_type, crew_verified)')
      .single();
    if (error) throw error;
    return flattenCrew(data);
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('crew_posts')
      .select('*, crew_comments(count), profiles(user_type, crew_verified)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return flattenCrew(data);
  },

  async update(id, patch) {
    const { data, error } = await supabase
      .from('crew_posts')
      .update(patch)
      .eq('id', id)
      .select('*, crew_comments(count), profiles(user_type, crew_verified)')
      .single();
    if (error) throw error;
    return flattenCrew(data);
  },


  // 댓글(crew_comments, 2026-09-15) — 구조·규칙은 qna_comments 와 동일
  async getComments(postId) {
    const { data, error } = await supabase
      .from('crew_comments')
      .select('*, profiles!crew_comments_user_id_fkey(user_type, crew_verified)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async addComment(comment) {
    const { data, error } = await supabase
      .from('crew_comments')
      .insert(comment)
      .select('*, profiles!crew_comments_user_id_fkey(user_type, crew_verified)')
      .single();
    if (error) throw error;
    return data;
  },

  async deleteComment(id) {
    const { error } = await supabase.from('crew_comments').delete().eq('id', id);
    if (error) throw error;
  },

  async delete(id) {
    const { error } = await supabase.from('crew_posts').delete().eq('id', id);
    if (error) throw error;
  },
};

// ============================================================
// Reviews & Promotions
// ============================================================

const REVIEW_SELECT = '*, review_comments(count), profiles(nickname, user_type, crew_verified, avatar_url)';
const REVIEW_LIST_SELECT = `${REVIEW_LIST_COLUMNS}, review_comments(count), profiles(nickname, user_type, crew_verified, avatar_url)`;
const REVIEW_BODY_LIST_SELECT = `${REVIEW_BODY_LIST_COLUMNS}, review_comments(count), profiles(nickname, user_type, crew_verified, avatar_url)`;
// PostgREST 집계 임베드 [{count}] → comment_count 로 편다 (qnaApi 와 동일)
const flattenReview = ({ review_comments: commentAgg, ...post }) => ({ ...post, comment_count: commentAgg?.[0]?.count ?? 0 });

export const reviewsApi = {
  // withBody: 목록에 본문을 그리는 화면(홍보 게시판 Promotions — 현재 기능 플래그로 꺼짐)만 true
  async getAll(regionId = null, type = null, q = '', { withBody = false } = {}) {
    let query = supabase.from('reviews')
      .select(withBody ? REVIEW_BODY_LIST_SELECT : REVIEW_LIST_SELECT)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(LIST_FETCH_LIMIT);
    if (regionId) query = query.eq('region_id', regionId);
    if (type) query = query.eq('type', type);
    const term = searchTerm(q);
    if (term) query = query.or(ilikeOr(['title', 'description'], term));
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(flattenReview);
  },

  async getById(id) {
    const { data, error } = await supabase.from('reviews').select(REVIEW_SELECT).eq('id', id).single();
    if (error) throw error;
    return flattenReview(data);
  },

  async update(id, patch) {
    const { data, error } = await supabase
      .from('reviews')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(REVIEW_SELECT)
      .single();
    if (error) throw error;
    return flattenReview(data);
  },

  // 후기 댓글(review_comments, 2026-09-14) — 구조·규칙은 qna_comments 와 동일
  async getComments(postId) {
    const { data, error } = await supabase
      .from('review_comments')
      .select('*, profiles!review_comments_user_id_fkey(user_type, crew_verified)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async addComment(comment) {
    const { data, error } = await supabase
      .from('review_comments')
      .insert(comment)
      .select('*, profiles!review_comments_user_id_fkey(user_type, crew_verified)')
      .single();
    if (error) throw error;
    return data;
  },

  async deleteComment(id) {
    const { error } = await supabase.from('review_comments').delete().eq('id', id);
    if (error) throw error;
  },

  async create(review) {
    const { data, error } = await supabase
      .from('reviews')
      .insert(review)
      .select(REVIEW_SELECT)
      .single();
    if (error) throw error;
    return flattenReview(data);
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
  // 통합 게시판(2026-09-07): 대륙·검색어 서버 필터 + 페이지. 반환 { data, count }.
  async getAll({ regionId = null, q = '', page = 1, limit = 24 } = {}) {
    // likes_count 는 같은 값이 흔하고 실시간으로 변한다. id 2차 정렬이 없으면
    // 같은 좋아요 수끼리 순서가 조회할 때마다 뒤바뀐다.
    let query = supabase.from('destinations')
      .select(`${DESTINATION_LIST_COLUMNS}, destination_comments(count), profiles(nickname, user_type, crew_verified, avatar_url)`, { count: 'exact' })
      .order('likes_count', { ascending: false })
      .order('id', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (regionId) query = query.eq('region_id', regionId);
    const term = searchTerm(q);
    // 승무원 한줄평(crew_comment)에만 든 단어로도 찾을 수 있어야 한다(2026-09-17 검색 점검)
    if (term) query = query.or(ilikeOr(['name', 'description', 'crew_comment'], term));
    const { data, count, error } = await query;
    if (error) throw error;
    return { data: flattenDestination(data || []), count: count || 0 };
  },

  async create(dest) {
    const { data, error } = await supabase
      .from('destinations')
      .insert(dest)
      .select('*, destination_comments(count), profiles(nickname, user_type, crew_verified, avatar_url)')
      .single();
    if (error) throw error;
    return flattenDestination(data);
  },

  // like/unlike 는 제거했다(2026-08-28). destinations.likes_count 를 클라이언트가 직접
  // UPDATE 하는 경로라 좋아요를 무한히 조작할 수 있었다. 좋아요는 post_likes 테이블 +
  // toggle_post_like RPC 로 서버가 1인 1회를 강제한다(postLikeApi 참고).

  async getById(id) {
    const { data, error } = await supabase
      .from('destinations')
      .select('*, destination_comments(count), profiles(nickname, user_type, crew_verified, avatar_url)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return flattenDestination(data);
  },

  async update(id, patch) {
    const { data, error } = await supabase
      .from('destinations')
      .update(patch)
      .eq('id', id)
      .select('*, destination_comments(count), profiles(nickname, user_type, crew_verified, avatar_url)')
      .single();
    if (error) throw error;
    return flattenDestination(data);
  },


  // 댓글(destination_comments, 2026-09-15) — 구조·규칙은 qna_comments 와 동일
  async getComments(postId) {
    const { data, error } = await supabase
      .from('destination_comments')
      .select('*, profiles!destination_comments_user_id_fkey(user_type, crew_verified)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async addComment(comment) {
    const { data, error } = await supabase
      .from('destination_comments')
      .insert(comment)
      .select('*, profiles!destination_comments_user_id_fkey(user_type, crew_verified)')
      .single();
    if (error) throw error;
    return data;
  },

  async deleteComment(id) {
    const { error } = await supabase.from('destination_comments').delete().eq('id', id);
    if (error) throw error;
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

  // 같은 편 게시판 참여 스위치(2026-09-06). 켜면 서버가 익명 번호를 배정하고 참여자에게 알린다.
  async setBoardJoined(id, joined) {
    const { data, error } = await supabase
      .from('flight_schedules')
      .update({ board_joined: !!joined })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
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
// 받아 온 행의 문자열 컬럼(KEYWORD_SKIP_FIELDS 제외)을 모두 매칭 대상으로 삼는다.
// 보드마다 select 를 적는다(2026-09-26 서식 편집기 1단계): 예전엔 '*' 로 받았는데 서식 문서 칸(*_doc, 최대 512KB)이
// 폴링(1분 주기 × 보드당 최대 20행)에 실려 Supabase egress 가 불어난다. 적힌 칸 = '*' 시절 매칭되던 문자열 칸 그대로
// (날짜·시각 문자열 칸 포함 — 매칭 범위를 바꾸지 않는다). 새 문자열 칸을 매칭에 넣으려면 여기에 더한다.
// (board.select 를 적어 두기만 하면 아무 일도 일어나지 않는다 — 아래 쿼리도 함께 읽어야 한다.)
// type = add_keyword_notification(p_post_type) 이 받는 값 (서버가 링크를 조립한다)
const KEYWORD_BOARDS = [
  { table: 'companion_posts', path: '/companion', type: 'companion', select: 'id,created_at,title,country,travel_date,members_needed,content,author_name' },
  { table: 'qna_posts', path: '/qna', type: 'qna', select: 'id,created_at,title,content,author_name,board' },
  {
    table: 'market_listings', path: '/market', type: 'market',
    select: 'id,created_at,title,description,location,content,author,country,transaction_type,refreshed_at,bumped_at,paid_at',
  },
  // reviews 테이블은 "여행상품 홍보 및 후기"(숨김 중)와 "여행후기 및 Q&A"의 여행 후기 탭이 함께 쓴다 — 알림은 유지한다.
  // 숨김 동안 /reviews 링크는 App.jsx 가 /qna?tab=review 로 보낸다(agy 9/6: 통째로 빼면 후기 알림까지 끊긴다).
  // 나만 보기 후기(2026-09-25)는 뺀다 — 작성자 본인 세션엔 RLS 로 보여서, 안 거르면 자기 비공개 글에
  // "키워드의 새 글" 토스트가 뜬다(agy·codex 검토). LIMIT 전에 걸러야 공개 글이 밀려나지 않는다.
  {
    table: 'reviews', path: PROMO_REVIEWS_ENABLED ? '/reviews' : '/qna?tab=review', type: 'reviews', eq: { is_private: false },
    select: 'id,created_at,title,description,author_name',
  },
  { table: 'destinations', path: '/recommend', type: 'destinations', select: 'id,created_at,name,description,crew_comment' },
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
          let query = supabase
            .from(board.table)
            .select(board.select)
            .gt('created_at', sinceIso);
          for (const [col, val] of Object.entries(board.eq || {})) query = query.eq(col, val);
          const { data, error } = await query
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
// 쪽지(네이버 카페식 메일함) — 2026-09-06. 전부 RPC. 차단 관계면 서버가 BLOCKED 로 거부한다.
// ============================================================
export const messageApi = {
  async send(toUserId, content) { return rpc('message_send', { p_to: toUserId, p_content: content }); },
  // kind: 'in' 받은 쪽지 | 'out' 보낸 쪽지
  async box(kind = 'in', limit = 300) { return (await rpc('message_box', { p_box: kind, p_limit: limit })) || []; },
  async markRead(id) { return rpc('message_mark_read', { p_id: id }); },
  async remove(id) { return rpc('message_delete', { p_id: id }); },
  async unreadCount() { return (await rpc('message_unread_count')) || 0; },
};

// ============================================================
// 1:1 대화(대화방) — 2026-09-06. 방 열기·보내기·읽음은 RPC, 메시지 조회는 RLS(참여자만).
//   listingId 를 주면 그 매물의 구매자·판매자 방, 없으면 두 사람 사이 1:1 대화방.
// ============================================================
export const chatApi = {
  async open(userId, listingId = null) { return rpc('chat_open', { p_user: userId, p_listing: listingId }); },
  async rooms() { return (await rpc('chat_rooms_list')) || []; },
  async roomInfo(roomId) { return rpc('chat_room_info', { p_room: roomId }); },
  // sinceAt 이후(같은 시각 포함)만 받아 호출부가 id 로 중복을 걸러 붙인다.
  // 처음엔 최신 limit 건(내림차순 → 뒤집기), sinceAt 이면 그 시각부터 오름차순 증분, beforeAt 이면 그 앞의 이전 대화.
  async messages(roomId, { sinceAt = null, beforeAt = null, limit = 300 } = {}) {
    let q = supabase
      .from('chat_messages')
      .select('id, room_id, sender_id, content, created_at')
      .eq('room_id', roomId)
      .limit(limit);
    if (sinceAt) {
      q = q.gte('created_at', sinceAt).order('created_at', { ascending: true }).order('id', { ascending: true });
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    }
    if (beforeAt) q = q.lt('created_at', beforeAt);
    q = q.order('created_at', { ascending: false }).order('id', { ascending: false });
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).reverse();
  },
  async send(roomId, content) { return rpc('chat_send', { p_room: roomId, p_content: content }); },
  // until: 화면에 실제로 붙은 마지막 메시지 시각(그 뒤에 온 메시지는 안 읽은 채로 남긴다)
  async markRead(roomId, until = null) { return rpc('chat_mark_read', { p_room: roomId, p_until: until }); },
  // 방 나가기(2026-09-14): 목록에서 빠지고 상대가 새 메시지를 보내면 다시 나타난다. 다시 열면(open) 나간 표시가 풀린다.
  async leave(roomId) { return rpc('chat_leave', { p_room: roomId }); },
  async unreadCount() { return (await rpc('chat_unread_count')) || 0; },
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

  // 관리자 전용(2026-09-15). 신고자·대상자의 실명·닉네임은 is_admin() 으로 막은 SECURITY DEFINER RPC 로만 받는다.
  // profiles(name) 임베드 조회를 쓰지 않는다. 반환 모양은 adminReports.js 주석 참고.
  async getAll() {
    const { data, error } = await supabase.rpc('admin_list_reports');
    if (error) throw error;
    return (data || []).map(normalizeAdminReport);
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
      .select('blocked_id, created_at, blocked:profiles!blocks_blocked_id_fkey(id, nickname, avatar_url)')
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
// 폴백 직접 조회에는 실명(name)을 넣지 않는다(2026-09-15). 관리자 회원 목록의 실명은 주 경로 admin_list_profiles RPC 에서만 온다 —
// RPC 가 실패해 폴백으로 떨어지면 이름 칸은 '-' 로 보인다.
const ADMIN_PROFILE_COLUMNS = 'id, nickname, email, user_type, points_balance, created_at, is_banned, role';

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

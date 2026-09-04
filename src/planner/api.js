import { supabase } from '../lib/supabase';

// 플래너 Supabase 데이터 레이어.
// 운영 DB(src/lib/planner_20260904.sql)에 이미 적용된 RPC 만 호출한다. 스키마는 여기서 바꾸지 않는다.
//
// 원칙
//  - 쓰기는 전부 SECURITY DEFINER RPC 를 거친다. 테이블 직접 쓰기는 planner_places 만 열려 있고
//    (GRANT SELECT/INSERT/UPDATE/DELETE), 기간·visibility 는 컬럼 단위 권한으로 막혀 있다.
//  - 읽기는 RLS own-only 라 테이블 select 를 그대로 쓴다.
//  - 에러는 PlannerError 로 감싸 화면이 그대로 노출할 수 있는 한국어 문장을 담고,
//    원문 코드는 code 에 보존한다(로그·분기용).

// ---------------------------------------------------------------------------
// 에러 변환
// ---------------------------------------------------------------------------

// RPC 가 RAISE EXCEPTION 으로 던지는 문자열 → 사용자에게 보일 한국어.
// 목록은 planner_20260904.sql 의 RAISE EXCEPTION 전량에서 뽑았다.
const ERROR_MESSAGES = {
  'auth required': '로그인이 필요합니다.',
  'not found': '요청한 일정을 찾을 수 없습니다.',
  'bad request': '요청 정보가 올바르지 않습니다.',
  'bad args': '요청 정보가 올바르지 않습니다.',
  'bad title': '여행 이름은 1자에서 80자까지 넣을 수 있습니다.',
  'bad dates': '시작일과 종료일을 다시 확인해 주세요. 기간은 최대 61일입니다.',
  'bad rating': '별점은 1점에서 5점 사이로 골라 주세요.',
  'bad coords': '위치 좌표가 올바르지 않습니다.',
  'bad name': '장소 이름은 1자에서 200자까지 넣을 수 있습니다.',
  'bad place id': '장소 식별자가 올바르지 않습니다.',
  'bad provider': '지원하지 않는 장소 제공자입니다.',
  'bad storage path': '티켓 파일 경로가 올바르지 않습니다.',
  'body too long': '후기 본문은 1,000자까지 쓸 수 있습니다.',
  'menu too long': '추천 메뉴는 200자까지 쓸 수 있습니다.',
  'day not in trip': '다른 여행의 날짜로는 옮길 수 없습니다.',
  'place not in trip': '다른 여행의 장소는 담을 수 없습니다.',
  'trip owner mismatch': '내 여행에만 저장할 수 있습니다.',
  'owner required': '로그인이 필요합니다.',
  'owner cannot change': '작성자는 바꿀 수 없습니다.',
  'trip cannot change': '다른 여행으로 옮길 수 없습니다.',
  'catalog cannot change': '연결된 장소 정보는 바꿀 수 없습니다.',
  'empty trip': '장소를 한 곳이라도 담아야 게시할 수 있습니다.',
  'no days': '날짜가 없는 여행은 게시할 수 없습니다.',
  'google provider disabled': '지금은 오픈스트리트맵 장소만 담을 수 있습니다.',
  'unknown place': '후기를 남길 장소를 찾을 수 없습니다.',
  'visit required': '방문 완료로 표시한 뒤에 후기를 남길 수 있습니다.',
  'unsupported snapshot': '이 일정은 지금 버전에서 가져올 수 없습니다.',
  'too many': '한 번에 옮길 수 있는 장소는 200곳까지입니다.',
  'too many places': '한 여행에 담을 수 있는 장소는 200곳까지입니다.',
  'too many days': '가져올 수 있는 날짜는 61일까지입니다.',
  'too many trips': '여행은 100개까지 만들 수 있습니다. 쓰지 않는 여행을 지우고 다시 시도해 주세요.',
  'admin only': '권한이 없습니다.',
  'gate row missing': '장소 검색을 지금은 쓸 수 없습니다. 잠시 후 다시 시도해 주세요.',
};

const FALLBACK_MESSAGE = '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const NETWORK_MESSAGE = '네트워크에 연결하지 못했습니다. 연결 상태를 확인해 주세요.';

export class PlannerError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = 'PlannerError';
    this.code = code;
    this.cause = cause;
  }
}

function rawMessage(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return String(err.message || err.error_description || err.error || '');
}

// 'confirm_detach:3' → 3, 그 외 → null
export function parseDetachCount(err) {
  const match = /^confirm_detach:(\d+)$/.exec(rawMessage(err).trim());
  return match ? Number(match[1]) : null;
}

// 사람이 읽을 한국어 문장으로 옮긴다. 모르는 코드는 원문을 노출하지 않고 공용 문장으로 덮는다.
export function mapError(err) {
  const raw = rawMessage(err).trim();
  if (!raw) return FALLBACK_MESSAGE;

  // 기간 축소 확인은 실패가 아니라 되물음이다. 왕복은 setDates 가 처리한다.
  const detach = parseDetachCount(raw);
  if (detach !== null) return `일정이 짧아지면서 핀 ${detach}개가 보관함으로 이동합니다.`;

  if (ERROR_MESSAGES[raw]) return ERROR_MESSAGES[raw];

  const code = typeof err === 'object' && err ? String(err.code || '') : '';
  if (code === '42501' || /permission denied/i.test(raw)) return '권한이 없습니다.';
  if (code === 'PGRST301' || /\bjwt\b/i.test(raw)) return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
  if (/failed to fetch|networkerror|network request failed/i.test(raw)) return NETWORK_MESSAGE;
  return FALLBACK_MESSAGE;
}

function fail(err) {
  throw new PlannerError(mapError(err), rawMessage(err).trim(), err);
}

async function callRpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) fail(error);
  return data;
}

// ---------------------------------------------------------------------------
// 여행
// ---------------------------------------------------------------------------

const TRIP_COLUMNS =
  'id, title, start_date, end_date, currency, budget_total, country, timezone, cover_place_id, visibility, origin_post_id, created_at, updated_at';

const PLACE_COLUMNS =
  'id, trip_id, day_id, catalog_id, name, address, lat, lng, sort_order, planned_time, stay_min, cost, note, note_public, visited_at, source, created_at, updated_at';

// planner_create_trip 은 여행 행과 날짜 행을 한 트랜잭션에서 만든다.
// timezone 은 RPC 인자에 없고 planner_trips 의 UPDATE 허용 컬럼이라, 값이 있을 때만 뒤이어 기록한다.
// 여행 생성은 이미 끝난 뒤이므로 timezone 저장 실패로 생성을 되돌리지 않는다(로그만 남긴다).
export async function createTrip({
  title,
  startDate,
  endDate,
  currency = 'KRW',
  country = null,
  timezone = null,
}) {
  const tripId = await callRpc('planner_create_trip', {
    p_title: title,
    p_start: startDate,
    p_end: endDate,
    p_currency: currency,
    p_country: country,
  });
  if (timezone) {
    const { error } = await supabase.from('planner_trips').update({ timezone }).eq('id', tripId);
    if (error) console.error('여행 타임존 저장 실패:', error);
  }
  return tripId;
}

// 기간 변경. 잘려나가는 날짜에 핀이 남아 있으면 RPC 가 confirm_detach:N 으로 한 번 되묻는다.
// 왕복(되물음 → 재호출)을 여기서 끝내고 호출부는 결과만 받는다.
//   confirm = async (n) => boolean. 넘기지 않으면 window.confirm 을 쓴다.
//   반환값  = { detached, cancelled }
export async function setDates(tripId, startDate, endDate, { confirm } = {}) {
  const ask =
    confirm ||
    (async (n) =>
      window.confirm(`일정이 짧아지면서 핀 ${n}개가 보관함으로 이동합니다. 계속할까요?`));

  const { data, error } = await supabase.rpc('planner_set_dates', {
    p_trip_id: tripId,
    p_start: startDate,
    p_end: endDate,
  });
  if (!error) return { detached: data || 0, cancelled: false };

  const detach = parseDetachCount(error);
  if (detach === null) fail(error);

  const agreed = await ask(detach);
  if (!agreed) return { detached: 0, cancelled: true };

  const detached = await callRpc('planner_set_dates', {
    p_trip_id: tripId,
    p_start: startDate,
    p_end: endDate,
    p_confirm_detach: true,
  });
  return { detached: detached || 0, cancelled: false };
}

// 내 여행 목록(RLS own-only). 최근 수정 순.
export async function listTrips() {
  const { data, error } = await supabase
    .from('planner_trips')
    .select(TRIP_COLUMNS)
    .order('updated_at', { ascending: false })
    // 정렬값이 같을 때 순서가 매번 달라지지 않게 고정(기존 게시판 관례)
    .order('id', { ascending: false });
  if (error) fail(error);
  return data || [];
}

// 일정판이 한 번에 필요로 하는 3덩이. 각각 RLS 로 내 것만 온다.
// 중첩 select 대신 병렬 3쿼리를 쓰는 이유: planner_places 가 trips·days 양쪽에 FK 를 가져
// 임베드 정렬 지정이 번거롭고, 날짜와 장소를 따로 갱신하는 화면 구조와도 맞지 않는다.
export async function getTrip(tripId) {
  const [tripRes, daysRes, placesRes] = await Promise.all([
    supabase.from('planner_trips').select(TRIP_COLUMNS).eq('id', tripId).maybeSingle(),
    supabase
      .from('planner_days')
      .select('id, trip_id, day_index, date, legs, updated_at')
      .eq('trip_id', tripId)
      .order('day_index', { ascending: true }),
    supabase
      .from('planner_places')
      .select(PLACE_COLUMNS)
      .eq('trip_id', tripId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ]);

  const firstError = tripRes.error || daysRes.error || placesRes.error;
  if (firstError) fail(firstError);
  if (!tripRes.data) fail('not found');

  const places = placesRes.data || [];
  return {
    trip: tripRes.data,
    days: daysRes.data || [],
    places,
    // day_id 가 NULL 인 핀 = 보관함
    unassigned: places.filter((p) => !p.day_id),
  };
}

// 정렬·날짜 이동을 한 번에. dayId 가 null 이면 보관함으로 보낸다.
export async function reorderPlaces(tripId, dayId, placeIds) {
  await callRpc('planner_reorder_places', {
    p_trip_id: tripId,
    p_day_id: dayId,
    p_place_ids: placeIds,
  });
}

// ---------------------------------------------------------------------------
// 장소 카탈로그 · 후기
// ---------------------------------------------------------------------------

// 제공자에서 정규화한 장소를 카탈로그에 넣고 id 를 받는다.
// 이미 있는 행은 값을 덮어쓰지 않는다(회원 경로에서 갱신 불가) — 영업시간은 저장 전에 확정해야 한다.
export async function upsertCatalog({
  provider,
  providerPlaceId,
  name,
  address = null,
  lat,
  lng,
  extra = null,
}) {
  return callRpc('planner_upsert_catalog', {
    p_provider: provider,
    p_provider_place_id: providerPlaceId,
    p_name: name,
    p_address: address,
    p_lat: lat,
    p_lng: lng,
    p_extra: extra,
  });
}

// 후기는 방문 완료로 표시한 내 핀이 있을 때만 저장된다(판정은 서버).
export async function submitReview({ catalogId, rating, body = null, menu = null }) {
  return callRpc('planner_submit_review', {
    p_catalog_id: catalogId,
    p_rating: rating,
    p_body: body,
    p_menu: menu,
  });
}

// ---------------------------------------------------------------------------
// 공유
// ---------------------------------------------------------------------------

// 재발급하면 이전 링크는 그 자리에서 무효가 된다. 원문 토큰은 이 반환값이 유일한 사본이다.
export async function createShare(tripId) {
  return callRpc('planner_create_share', { p_trip_id: tripId });
}

export async function revokeShare(tripId) {
  await callRpc('planner_revoke_share', { p_trip_id: tripId });
}

// 비로그인도 호출할 수 있다. 토큰이 틀렸거나 폐기·만료됐으면 예외가 아니라 null 이 온다.
export async function getShared(token) {
  return callRpc('planner_get_shared', { p_token: token });
}

// ---------------------------------------------------------------------------
// 게시판 (여행 일정)
// ---------------------------------------------------------------------------

// 같은 여행을 다시 올리면 글이 새로 생기지 않고 갱신된다(trip_id UNIQUE + upsert).
export async function publishToBoard(tripId) {
  return callRpc('planner_publish_to_board', { p_trip_id: tripId });
}

export async function unpublish(tripId) {
  await callRpc('planner_unpublish', { p_trip_id: tripId });
}

// 게시글 → 내 플래너 사본. 새로 만들어진 여행 id 를 돌려준다.
export async function importFromPost(postId) {
  return callRpc('planner_import', { p_post_id: postId });
}

// 공유 토큰 → 내 플래너 사본.
export async function importFromToken(token) {
  return callRpc('planner_import', { p_token: token });
}

// 일정판 헤더용. { published, stale, post_id, post_updated_at }
export async function boardSyncState(tripId) {
  return callRpc('planner_board_sync_state', { p_trip_id: tripId });
}

// 목록 화면용 일괄 조회. [{ trip_id, post_id, stale }]
export async function boardSyncList() {
  return (await callRpc('planner_board_sync_list')) || [];
}

// ---------------------------------------------------------------------------
// 핀 쓰기 (planner_places 만 테이블 직접 쓰기가 열려 있다)
// ---------------------------------------------------------------------------

// 클라이언트가 쓸 수 있는 컬럼. 여기 없는 키는 조용히 버린다 —
// trip_id·user_id 는 가드가 강제하고, 그 밖의 컬럼을 실수로 실어 보내면 요청 자체가 거절된다.
const PLACE_WRITABLE = [
  'day_id',
  'catalog_id',
  'name',
  'address',
  'lat',
  'lng',
  'sort_order',
  'planned_time',
  'stay_min',
  'cost',
  'note',
  'note_public',
  'visited_at',
  'source',
];

function pickWritable(values) {
  const out = {};
  PLACE_WRITABLE.forEach((key) => {
    if (values && Object.prototype.hasOwnProperty.call(values, key)) out[key] = values[key];
  });
  return out;
}

// 핀 1개 추가. user_id 는 BEFORE 트리거가 호출자로 덮어쓰지만, 값을 함께 보내야
// RLS WITH CHECK 와 컬럼 NOT NULL 을 읽을 때 의도가 코드에 드러난다.
export async function createPlace({ tripId, userId, ...values }) {
  const { data, error } = await supabase
    .from('planner_places')
    .insert({ trip_id: tripId, user_id: userId, ...pickWritable(values) })
    .select(PLACE_COLUMNS)
    .single();
  if (error) fail(error);
  return data;
}

export async function updatePlace(placeId, values) {
  const patch = pickWritable(values);
  if (Object.keys(patch).length === 0) return null;
  const { data, error } = await supabase
    .from('planner_places')
    .update(patch)
    .eq('id', placeId)
    .select(PLACE_COLUMNS)
    .single();
  if (error) fail(error);
  return data;
}

export async function deletePlace(placeId) {
  const { error } = await supabase.from('planner_places').delete().eq('id', placeId);
  if (error) fail(error);
}

// ---------------------------------------------------------------------------
// 여행 수정 (기간·visibility 는 컬럼 단위 권한으로 막혀 있어 여기로 오지 않는다)
// ---------------------------------------------------------------------------

const TRIP_WRITABLE = ['title', 'currency', 'budget_total', 'country', 'timezone', 'cover_place_id'];

export async function updateTrip(tripId, values) {
  const patch = {};
  TRIP_WRITABLE.forEach((key) => {
    if (values && Object.prototype.hasOwnProperty.call(values, key)) patch[key] = values[key];
  });
  if (Object.keys(patch).length === 0) return null;
  const { data, error } = await supabase
    .from('planner_trips')
    .update(patch)
    .eq('id', tripId)
    .select(TRIP_COLUMNS)
    .single();
  if (error) fail(error);
  return data;
}

// ---------------------------------------------------------------------------
// 목록 화면 보조
// ---------------------------------------------------------------------------

// 여행별 핀 수와 마지막 수정 시각. RLS 가 내 행만 돌려주므로 필터 없이 한 번에 받아
// 세는 편이 여행 수만큼 count 쿼리를 던지는 것보다 싸다.
//   반환 { counts: Map<tripId, number>, latest: Map<tripId, timestamptz> }
export async function getPlaceStats() {
  const { data, error } = await supabase.from('planner_places').select('trip_id, updated_at');
  if (error) fail(error);
  const counts = new Map();
  const latest = new Map();
  (data || []).forEach((row) => {
    counts.set(row.trip_id, (counts.get(row.trip_id) || 0) + 1);
    const prev = latest.get(row.trip_id);
    if (!prev || Date.parse(row.updated_at) > Date.parse(prev)) latest.set(row.trip_id, row.updated_at);
  });
  return { counts, latest };
}

// 내 여행에 딸린 게시글의 갱신 시각. itinerary_posts 는 열람이 공개라 직접 읽을 수 있다.
// planner_board_sync_list 가 post_updated_at 을 돌려주지 않아 목록 화면에서 따로 받아 온다.
export async function getBoardPostTimes(tripIds) {
  const list = Array.from(new Set((tripIds || []).filter(Boolean)));
  if (list.length === 0) return new Map();
  const { data, error } = await supabase
    .from('itinerary_posts')
    .select('trip_id, updated_at')
    .in('trip_id', list);
  if (error) fail(error);
  return new Map((data || []).map((row) => [row.trip_id, row.updated_at]));
}

// 핀에 연결된 카탈로그 행(영업시간·출처). 정책상 "내 핀 또는 내 후기가 참조하는 행"만 온다.
export async function getCatalogEntries(ids) {
  const list = Array.from(new Set((ids || []).filter(Boolean)));
  if (list.length === 0) return new Map();
  const { data, error } = await supabase
    .from('planner_catalog')
    .select('id, provider, provider_place_id, name, address, lat, lng, opening_hours, website, phone')
    .in('id', list);
  if (error) fail(error);
  return new Map((data || []).map((row) => [row.id, row]));
}

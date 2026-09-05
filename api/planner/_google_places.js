// 구글 Places API (New) 호출 모듈 (2026-09-05). places.js(텍스트 검색)와 _refresh_core.js(상세 재조회)가 같이 쓴다.
//
// 요금 등급은 필드마스크가 정한다(공식 data-fields 표, 2026-09-05 실측).
//   · Text Search  : displayName·formattedAddress·location = Pro(월 5,000회 무료).
//                    regularOpeningHours·rating·websiteUri·전화번호는 Enterprise(월 1,000회 무료)라 절대 넣지 않는다.
//                    → 영업시간은 받지 않는다(opening_hours: null). 지금 OSM 도 영업시간은 unknown 취급이라 기능 후퇴가 없다.
//   · Place Details: formattedAddress·location = Essentials, displayName = Pro(월 5,000회 무료).
// 아래 필드마스크 상수는 테스트(_google_places.test.js)가 완전일치로 고정한다. 필드를 늘리면 테스트가 먼저 막는다.
//
// 이 모듈은 호출 횟수를 세지 않는다(호출 한도는 2026-09-05 쿠마님 결정으로 두지 않는다). 부르는 쪽은 캐시 미스일 때만 부른다.

import { fetchWithTimeout } from './_common.js';

export const PLACES_BASE = 'https://places.googleapis.com/v1';
export const TEXT_SEARCH_URL = `${PLACES_BASE}/places:searchText`;
export const TEXT_SEARCH_FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location';
export const DETAILS_FIELD_MASK = 'id,displayName,formattedAddress,location';
// 자동완성(New) + 세션 토큰 + 상세(Essentials) 조합 (2026-09-05 쿠마님 승인, 업계 표준 방식).
//   · Autocomplete Requests: 월 1만 무료, $2.83/1k. 세션이 Details Essentials 로 끝나면 처음 12건만 과금, 13건째부터 무료.
//   · Place Details Essentials(id·location·formattedAddress): 월 1만 무료, $5/1k. 이름은 자동완성 예측문(mainText)에서 얻는다
//     — displayName 을 넣으면 Pro($17/1k)로 튀므로 넣지 않는다.
export const AUTOCOMPLETE_URL = `${PLACES_BASE}/places:autocomplete`;
export const AUTOCOMPLETE_FIELD_MASK =
  'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat';
export const DETAILS_ESSENTIALS_FIELD_MASK = 'id,location,formattedAddress';
export const MAX_RESULTS = 8;
// 여행 목적지 기준 편향 반경(m). 구글 상한이 50km 다. 후보가 엉뚱하게 나와 다시 치는 일을 줄인다(= 호출 감소).
export const BIAS_RADIUS_M = 50000;

const NAME_MAX = 120;
const ADDRESS_MAX = 300;
const PLACE_ID_MAX = 300;
// 구글 REST 참조상 세션 토큰은 최대 36자 ASCII(UUID 길이). 더 길면 INVALID_ARGUMENT 가 날 수 있어 여기서 버린다(codex 지적).
const SESSION_RE = /^[A-Za-z0-9-]{8,36}$/;

// 세션 토큰은 클라이언트가 만든 UUID 다. 형식이 이상하면 없는 것으로 본다(세션 없이도 동작은 한다 — 과금만 건별).
export function normalizeSessionToken(token) {
  const t = String(token || '').trim();
  return SESSION_RE.test(t) ? t : '';
}

export function normalizeBias(bias) {
  const lat = Number(bias?.lat);
  const lng = Number(bias?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

// 자동완성 예측 한 건 → { provider, provider_place_id, name, secondary }. 이름이 없으면 버린다.
export function normalizePrediction(p) {
  const id = typeof p?.placeId === 'string' ? p.placeId.trim() : '';
  const main = String(p?.structuredFormat?.mainText?.text || p?.text?.text || '').trim();
  if (!id || id.length > PLACE_ID_MAX || !main) return null;
  const secondary = String(p?.structuredFormat?.secondaryText?.text || '').trim();
  return {
    provider: 'google',
    provider_place_id: id,
    name: main.slice(0, NAME_MAX),
    secondary: secondary ? secondary.slice(0, ADDRESS_MAX) : '',
  };
}

// 자동완성. 실패는 사유만 돌려주고 던지지 않는다.
export async function autocompleteGoogle({ q, key, session, bias, fetchImpl = fetchWithTimeout, timeoutMs = 6000 }) {
  const term = String(q || '').trim();
  if (!key || !term) return { ok: false, reason: 'bad_input' };
  const body = { input: term, languageCode: 'ko', includeQueryPredictions: false };
  const tok = normalizeSessionToken(session);
  if (tok) body.sessionToken = tok;
  const b = normalizeBias(bias);
  if (b) body.locationBias = { circle: { center: { latitude: b.lat, longitude: b.lng }, radius: BIAS_RADIUS_M } };
  let resp;
  try {
    resp = await fetchImpl(AUTOCOMPLETE_URL, {
      method: 'POST',
      timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': AUTOCOMPLETE_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (!resp?.ok) return { ok: false, reason: 'http', status: Number(resp?.status) || 0 };
  let data;
  try {
    data = await resp.json();
  } catch {
    return { ok: false, reason: 'parse' };
  }
  const rows = Array.isArray(data?.suggestions) ? data.suggestions : [];
  const predictions = [];
  for (const row of rows) {
    const p = normalizePrediction(row?.placePrediction);
    if (p) predictions.push(p);
    if (predictions.length >= MAX_RESULTS) break;
  }
  return { ok: true, predictions };
}

// 상세(Essentials) — 좌표·주소만. 자동완성 세션의 마지막 호출이라 sessionToken 을 같이 보낸다(그래야 세션 과금).
export async function placeLocationGoogle({ placeId, key, session, fetchImpl = fetchWithTimeout, timeoutMs = 8000 }) {
  const id = String(placeId || '').trim();
  if (!key || !id || id.length > PLACE_ID_MAX) return { ok: false, reason: 'bad_input' };
  const tok = normalizeSessionToken(session);
  const url =
    `${PLACES_BASE}/places/${encodeURIComponent(id)}?languageCode=ko` +
    (tok ? `&sessionToken=${encodeURIComponent(tok)}` : '');
  let resp;
  try {
    resp = await fetchImpl(url, {
      method: 'GET',
      timeoutMs,
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': DETAILS_ESSENTIALS_FIELD_MASK, Accept: 'application/json' },
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (resp?.status === 404) return { ok: false, reason: 'not_found' };
  if (!resp?.ok) return { ok: false, reason: 'http', status: Number(resp?.status) || 0 };
  let data;
  try {
    data = await resp.json();
  } catch {
    return { ok: false, reason: 'parse' };
  }
  const lat = Number(data?.location?.latitude);
  const lng = Number(data?.location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, reason: 'schema' };
  }
  const address = String(data?.formattedAddress || '').trim();
  return {
    ok: true,
    place: { provider_place_id: id, address: address ? address.slice(0, ADDRESS_MAX) : null, lat, lng },
  };
}

// 구글 응답 한 건 → 공통 형식. 필수값이 하나라도 이상하면 null(호출자가 버린다).
export function normalizeGooglePlace(place) {
  const id = typeof place?.id === 'string' ? place.id.trim() : '';
  const name = String(place?.displayName?.text || '').trim();
  const lat = Number(place?.location?.latitude);
  const lng = Number(place?.location?.longitude);
  if (!id || id.length > PLACE_ID_MAX || !name) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const address = String(place?.formattedAddress || '').trim();
  return {
    provider: 'google',
    provider_place_id: id,
    name: name.slice(0, NAME_MAX),
    address: address ? address.slice(0, ADDRESS_MAX) : null,
    lat,
    lng,
    // 영업시간은 요청하지 않는다(Enterprise 등급). 형식 v1 의 "없음".
    opening_hours: null,
  };
}

// 텍스트 검색. 실패는 사유만 돌려주고 던지지 않는다 — 호출자가 502 로 닫는다.
export async function searchTextGoogle({ q, key, fetchImpl = fetchWithTimeout, timeoutMs = 8000 }) {
  const term = String(q || '').trim();
  if (!key || !term) return { ok: false, reason: 'bad_input' };
  let resp;
  try {
    resp = await fetchImpl(TEXT_SEARCH_URL, {
      method: 'POST',
      timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': TEXT_SEARCH_FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: term, languageCode: 'ko', pageSize: MAX_RESULTS }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (!resp?.ok) return { ok: false, reason: 'http', status: Number(resp?.status) || 0 };
  let data;
  try {
    data = await resp.json();
  } catch {
    return { ok: false, reason: 'parse' };
  }
  const rows = Array.isArray(data?.places) ? data.places : [];
  const results = [];
  for (const row of rows) {
    const p = normalizeGooglePlace(row);
    if (p) results.push(p);
    if (results.length >= MAX_RESULTS) break;
  }
  return { ok: true, results };
}

// 장소 상세(재조회용). 404 는 not_found 로 구분한다 — 사라진 장소는 다시 두드리지 않도록 호출자가 fetched_at 만 갱신한다.
export async function placeDetailsGoogle({ placeId, key, fetchImpl = fetchWithTimeout, timeoutMs = 8000 }) {
  const id = String(placeId || '').trim();
  if (!key || !id) return { ok: false, reason: 'bad_input' };
  const url = `${PLACES_BASE}/places/${encodeURIComponent(id)}?languageCode=ko`;
  let resp;
  try {
    resp = await fetchImpl(url, {
      method: 'GET',
      timeoutMs,
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': DETAILS_FIELD_MASK, Accept: 'application/json' },
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (resp?.status === 404) return { ok: false, reason: 'not_found' };
  if (!resp?.ok) return { ok: false, reason: 'http', status: Number(resp?.status) || 0 };
  let data;
  try {
    data = await resp.json();
  } catch {
    return { ok: false, reason: 'parse' };
  }
  const place = normalizeGooglePlace(data);
  if (!place) return { ok: false, reason: 'schema' };
  return { ok: true, place };
}

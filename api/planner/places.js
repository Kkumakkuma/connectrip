// POST /api/planner/places   header: Authorization: Bearer <supabase access_token>
//   body { q }                                   : 텍스트 검색(엔터). OSM 제공자의 기본 경로. (구글 제공자에서도 동작하지만 화면은 안 쓴다)
//   body { mode:'suggest', q, session, bias }    : 자동완성(구글 제공자 전용). 카탈로그 매치(0원) + 30일 캐시 + 구글 Autocomplete
//   body { mode:'details', place_id, name, session } : 고른 후보의 좌표·주소(구글 제공자 전용). 카탈로그에 있으면 0원, 없으면 Details Essentials
//
// 장소 검색 (설계 §4). 제공자는 DB 플래그(planner_google_enabled) 하나로 정한다.
// 자동완성은 구글에서만 한다 — Nominatim 정책이 타이핑마다 때리는 것을 금지한다. OSM 화면은 Enter 를 눌렀을 때만 부른다.
//
// 비용 원칙(2026-09-05 쿠마님 승인 — "제일 좋은 방법으로, 더 좋은 게 있으면 적용"):
//   · 텍스트 검색 Pro($32/1k)를 버리고 자동완성($2.83/1k, 세션당 최대 12건 과금) + Details Essentials($5/1k)로 간다.
//   · 이미 카탈로그에 있는 장소(누군가 한 번 담은 곳)는 구글을 부르지 않는다: 자동완성 후보에 먼저 섞고(카탈로그 매치가
//     KNOWN_MAX 건 차면 그 글자에서는 구글 자동완성 자체를 건너뛴다 — codex 지적), 고르면 좌표도 카탈로그에서(0원).
//   · 자동완성 응답은 (입력 글자 + 편향 좌표 0.1도) 단위로 24시간 캐시. 같은 글자를 치는 사람이 많을수록 0원에 수렴.
//     (30일로 늘리려 했으나 약관상 30일 캐시가 허용된 건 좌표뿐이라 예측문은 기존 텍스트 검색과 같은 24시간으로 둔다 — codex 지적.
//      만료 행은 재조회 잡이 이틀 뒤 지운다.)
//   · 여행 목적지 좌표로 편향(반경 50km)해 엉뚱한 후보 → 재검색을 줄인다.
//   · 호출 한도는 두지 않는다(쿠마님 결정). 남은 사용자 축 레이트리밋(10분 60/300회)은 구글 한도가 아니라 봇 남용 방어다.
//     캐시 조회 실패는 "미스"가 아니라 503(fail-closed), 키 없음도 503(OSM 강등 금지).
//
// 응답
//   search : { ok, provider, cached, results: [{ provider, provider_place_id, name, address, lat, lng, opening_hours }] }
//   suggest: { ok, provider:'google', cached, suggestions: [{ provider, provider_place_id, name, secondary, known, address?, lat?, lng? }] }
//   details: { ok, provider:'google', place: { provider, provider_place_id, name, address, lat, lng, opening_hours:null }, cached }

import { fail, fetchWithTimeout, gate, googleServerKey, pickProvider, sha256, waitForSlot } from './_common.js';
import { autocompleteGoogle, normalizeBias, normalizeSessionToken, placeLocationGoogle, searchTextGoogle } from './_google_places.js';

const OSM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GOOGLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 임시 성능 캐시 수준으로만(약관: 30일 캐시 허용은 좌표뿐)
const CATALOG_FRESH_MS = 30 * 24 * 60 * 60 * 1000; // 이보다 오래된 구글 카탈로그 행은 후보로 쓰지 않는다(재조회 잡이 갱신한다)
const MAX_RESULTS = 8;
const KNOWN_MAX = 4;
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
// Nominatim 정책: 실제 연락 가능한 주소를 UA 에 넣어야 한다.
const UA = 'ConnectTrip-Planner/1.0 (+https://www.connecttrip.co.kr; 200kgBrothers@gmail.com)';

function normalizeQuery(q) {
  return String(q || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function normalizePlaceId(id) {
  const s = String(id || '').trim();
  return s.length >= 1 && s.length <= 300 ? s : '';
}

// ILIKE 패턴 문자를 이스케이프한다. 사용자 입력이 와일드카드가 되면 안 된다.
function escapeLike(s) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

const isFresh = (row) => row?.fetched_at && Date.now() - Date.parse(row.fetched_at) < CATALOG_FRESH_MS;

// OSM 응답 → 공통 형식. 좌표가 숫자가 아니면 버린다.
function normalizeOsm(rows) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const lat = Number(row?.lat);
    const lng = Number(row?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const display = String(row?.display_name || '');
    const name = String(row?.name || display.split(',')[0] || '').trim();
    if (!name) continue;
    const raw = row?.extratags?.opening_hours;
    out.push({
      provider: 'osm',
      provider_place_id: `${row.osm_type || 'n'}${row.osm_id || ''}`,
      name: name.slice(0, 120),
      address: display.slice(0, 300),
      lat,
      lng,
      // 문자열 규칙("Mo-Fr 09:00-18:00")은 파싱하지 않는다. 형식 v1 에 맞춰 unknown 으로 보존.
      opening_hours: raw ? { v: 1, unknown: true, raw: String(raw).slice(0, 300) } : null,
    });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

async function searchOsm(supabase, q) {
  const ok = await waitForSlot(supabase, 'osm');
  if (!ok) return { limited: true, results: [] };

  const url =
    `${NOMINATIM}?format=jsonv2&limit=${MAX_RESULTS}&addressdetails=0&extratags=1` +
    `&accept-language=ko&q=${encodeURIComponent(q)}`;
  const resp = await fetchWithTimeout(url, {
    timeoutMs: 8000,
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!resp.ok) return { failed: true, results: [] };
  const rows = await resp.json();
  return { results: normalizeOsm(rows) };
}

// 구글 텍스트 검색(엔터). 화면은 자동완성을 쓰므로 여기로 오는 건 옛 번들뿐이다. 키 없음은 503, 호출 실패는 502.
async function searchGoogle(q) {
  const key = googleServerKey();
  if (!key) return { unavailable: true, results: [] };
  const r = await searchTextGoogle({ q, key });
  if (!r.ok) return { failed: true, reason: r.reason, results: [] };
  return { results: r.results };
}

// 캐시 한 건 읽기. 오류는 null 이 아니라 { error } 로 돌려 호출자가 fail-closed 하게 한다.
async function readCache(supabase, hash, ttlMs) {
  const { data, error } = await supabase
    .from('planner_place_search_cache')
    .select('result, fetched_at')
    .eq('query_hash', hash)
    .maybeSingle();
  if (error) return { error };
  if (data && Date.now() - Date.parse(data.fetched_at) < ttlMs) return { hit: data.result };
  return { hit: null };
}

async function writeCache(supabase, hash, provider, result) {
  const { error } = await supabase
    .from('planner_place_search_cache')
    .upsert({ query_hash: hash, provider, result, fetched_at: new Date().toISOString() });
  if (error) {
    // 저장 실패는 응답에 영향이 없지만 같은 검색이 반복 과금되는 원인이라 로그는 남긴다(codex 권고).
    console.error('[planner/places] cache save failed', provider, error.code || error.message || '');
  }
}

// 카탈로그에서 이름이 닿는 장소(0원). 구글 행은 30일 안에 받은 것만, OSM 행은 제한 없음. 대표 행(canonical_id null)만.
async function knownPlaces(supabase, q) {
  const since = new Date(Date.now() - CATALOG_FRESH_MS).toISOString();
  const { data, error } = await supabase
    .from('planner_catalog')
    .select('provider, provider_place_id, name, address, lat, lng')
    .ilike('name', `%${escapeLike(q)}%`)
    .is('canonical_id', null)
    .or(`provider.eq.osm,and(provider.eq.google,fetched_at.gt.${since})`)
    .order('fetched_at', { ascending: false })
    .limit(KNOWN_MAX);
  if (error) {
    console.error('[planner/places] catalog match failed', error.code || error.message || '');
    return [];
  }
  return (Array.isArray(data) ? data : [])
    .filter((r) => Number.isFinite(Number(r?.lat)) && Number.isFinite(Number(r?.lng)) && r?.name)
    .map((r) => ({
      provider: r.provider,
      provider_place_id: r.provider_place_id,
      name: String(r.name).slice(0, 120),
      secondary: r.address ? String(r.address).slice(0, 300) : '',
      known: true,
      address: r.address || null,
      lat: Number(r.lat),
      lng: Number(r.lng),
    }));
}

async function handleSuggest(req, res, supabase, provider) {
  if (provider !== 'google') {
    return fail(res, 400, 'BAD_MODE', '이 지도에서는 자동완성을 쓰지 않습니다. 검색어를 입력하고 엔터를 눌러 주세요.');
  }
  const key = googleServerKey();
  if (!key) return fail(res, 503, 'SERVICE_UNAVAILABLE', '장소 검색을 준비 중입니다.');

  const q = normalizeQuery(req.body?.q);
  if (q.length < 2) return fail(res, 400, 'BAD_QUERY', '두 글자 이상 입력해 주세요.');
  const session = normalizeSessionToken(req.body?.session);
  const bias = normalizeBias(req.body?.bias);

  // 1) 카탈로그 매치(0원). 실패해도 자동완성은 간다(가용성이 비용보다 앞선다 — 쿠마님 결정).
  const known = await knownPlaces(supabase, q);

  let predictions = [];
  let cached = false;
  if (known.length >= KNOWN_MAX) {
    // 카탈로그만으로 후보가 찼으면 이 글자에서는 구글을 부르지 않는다. 더 치면 매치가 줄어들며 구글이 붙는다.
    cached = true;
  } else {
    // 2) 24시간 캐시. 편향 좌표는 0.1도(약 10km) 단위로 뭉쳐 같은 도시면 같은 키가 되게 한다.
    const biasKey = bias ? `${bias.lat.toFixed(1)},${bias.lng.toFixed(1)}` : '';
    const hash = sha256(`google|ac|${q.toLowerCase()}|${biasKey}|ko`);
    const cache = await readCache(supabase, hash, GOOGLE_CACHE_TTL_MS);
    if (cache.error) return fail(res, 503, 'SERVICE_UNAVAILABLE', '장소 검색을 준비 중입니다.');
    if (Array.isArray(cache.hit)) {
      predictions = cache.hit;
      cached = true;
    } else {
      const r = await autocompleteGoogle({ q, key, session, bias });
      if (!r.ok) return fail(res, 502, 'PROVIDER_ERROR', '장소를 찾지 못했습니다. 잠시 뒤에 다시 시도해 주세요.');
      predictions = r.predictions;
      await writeCache(supabase, hash, 'google', predictions);
    }
  }

  // 3) 합치기: 카탈로그 먼저, 그다음 구글 예측(카탈로그와 같은 place ID 는 뺀다). 상한 8.
  const seen = new Set(known.map((k) => `${k.provider}:${k.provider_place_id}`));
  const suggestions = [...known];
  for (const p of predictions) {
    if (suggestions.length >= MAX_RESULTS) break;
    const id = `google:${p.provider_place_id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    suggestions.push({ ...p, known: false });
  }
  return res.status(200).json({ ok: true, provider, cached, suggestions });
}

async function handleDetails(req, res, supabase, provider) {
  if (provider !== 'google') return fail(res, 400, 'BAD_MODE', '이 지도에서는 쓰지 않는 요청입니다.');
  const key = googleServerKey();
  if (!key) return fail(res, 503, 'SERVICE_UNAVAILABLE', '장소 검색을 준비 중입니다.');

  const placeId = normalizePlaceId(req.body?.place_id);
  const name = normalizeName(req.body?.name);
  if (!placeId || !name) return fail(res, 400, 'BAD_REQUEST', '장소 정보가 올바르지 않습니다.');
  const session = normalizeSessionToken(req.body?.session);

  // 1) 카탈로그에 30일 안에 받은 행이 있으면 구글을 부르지 않는다.
  const { data: row, error: cErr } = await supabase
    .from('planner_catalog')
    .select('name, address, lat, lng, fetched_at')
    .eq('provider', 'google')
    .eq('provider_place_id', placeId)
    .maybeSingle();
  if (cErr) return fail(res, 503, 'SERVICE_UNAVAILABLE', '장소 검색을 준비 중입니다.');
  if (row && isFresh(row) && Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lng))) {
    return res.status(200).json({
      ok: true,
      provider,
      cached: true,
      place: {
        provider: 'google',
        provider_place_id: placeId,
        name: String(row.name || name).slice(0, 120),
        address: row.address || null,
        lat: Number(row.lat),
        lng: Number(row.lng),
        opening_hours: null,
      },
    });
  }

  // 2) 구글 상세(Essentials). 세션 토큰을 같이 보내 자동완성 세션을 닫는다.
  const r = await placeLocationGoogle({ placeId, key, session });
  if (!r.ok) {
    if (r.reason === 'not_found') return fail(res, 404, 'NOT_FOUND', '이 장소를 더는 찾을 수 없습니다.');
    return fail(res, 502, 'PROVIDER_ERROR', '장소를 찾지 못했습니다. 잠시 뒤에 다시 시도해 주세요.');
  }
  // 3) 오래된 카탈로그 행이 있었으면 방금 받은 값으로 갱신한다 — 안 하면 planner_upsert_catalog 가 옛 행 id 만 돌려줘
  //    30일이 지날 때마다 같은 장소에 Details 비용이 반복된다(codex 지적). 이름은 Essentials 에 없어 그대로 둔다.
  if (row) {
    const { error: uErr } = await supabase
      .from('planner_catalog')
      .update({ address: r.place.address, lat: r.place.lat, lng: r.place.lng, fetched_at: new Date().toISOString() })
      .eq('provider', 'google')
      .eq('provider_place_id', placeId);
    if (uErr) console.error('[planner/places] catalog refresh-on-pick failed', uErr.code || uErr.message || '');
  }
  return res.status(200).json({
    ok: true,
    provider,
    cached: false,
    place: {
      provider: 'google',
      provider_place_id: placeId,
      name,
      address: r.place.address,
      lat: r.place.lat,
      lng: r.place.lng,
      opening_hours: null,
    },
  });
}

async function handleSearch(req, res, supabase, provider) {
  const q = normalizeQuery(req.body?.q);
  if (q.length < 2) {
    return fail(res, 400, 'BAD_QUERY', '두 글자 이상 입력해 주세요.');
  }
  const hash = sha256(`${provider}|${q.toLowerCase()}|ko`);

  // 1) 캐시. 조회 오류는 미스가 아니다(fail-closed).
  const cache = await readCache(supabase, hash, provider === 'google' ? GOOGLE_CACHE_TTL_MS : OSM_CACHE_TTL_MS);
  if (cache.error) return fail(res, 503, 'SERVICE_UNAVAILABLE', '장소 검색을 준비 중입니다.');
  if (Array.isArray(cache.hit)) {
    return res.status(200).json({ ok: true, provider, cached: true, results: cache.hit });
  }

  // 2) 제공자 호출
  let results = [];
  try {
    const r = provider === 'google' ? await searchGoogle(q) : await searchOsm(supabase, q);
    if (r.unavailable) {
      return fail(res, 503, 'SERVICE_UNAVAILABLE', '장소 검색을 준비 중입니다.');
    }
    if (r.limited) {
      return fail(res, 429, 'BUSY', '검색이 몰리고 있습니다. 잠시 뒤에 다시 시도해 주세요.');
    }
    if (r.failed) {
      return fail(res, 502, 'PROVIDER_ERROR', '장소를 찾지 못했습니다. 잠시 뒤에 다시 시도해 주세요.');
    }
    results = r.results;
  } catch {
    return fail(res, 502, 'PROVIDER_ERROR', '장소를 찾지 못했습니다. 잠시 뒤에 다시 시도해 주세요.');
  }

  // 3) 캐시 저장. 실패해도 응답은 그대로 준다.
  await writeCache(supabase, hash, provider, results);
  return res.status(200).json({ ok: true, provider, cached: false, results });
}

export default async function handler(req, res) {
  const rawMode = req.body?.mode;
  const mode = rawMode === 'suggest' || rawMode === 'details' ? rawMode : 'search';
  // 자동완성은 글자마다 오므로 사용자 축 한도를 넓게 잡는다(남용 방어용, 정상 사용은 닿지 않는다).
  const ctx = await gate(req, res, {
    methods: ['POST'],
    rateKey: mode === 'suggest' ? 'places_suggest' : 'places',
    rateLimit: mode === 'suggest' ? 300 : 60,
  });
  if (!ctx) return;
  const { supabase } = ctx;

  const provider = await pickProvider(supabase);
  if (!provider) {
    // 제공자 판정 실패는 OSM 강등이 아니라 503 — 프런트가 구글 지도를 그리고 있을 수 있다.
    return fail(res, 503, 'SERVICE_UNAVAILABLE', '장소 검색을 준비 중입니다.');
  }

  if (mode === 'suggest') return handleSuggest(req, res, supabase, provider);
  if (mode === 'details') return handleDetails(req, res, supabase, provider);
  return handleSearch(req, res, supabase, provider);
}

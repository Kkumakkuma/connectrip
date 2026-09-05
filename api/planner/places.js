// POST /api/planner/places   body: { q }   header: Authorization: Bearer <supabase access_token>
//
// 장소 검색 (설계 §4). 제공자는 DB 플래그(planner_google_enabled) 하나로 정한다 — 구글이면 Places API (New) 텍스트 검색,
// 아니면 OSM Nominatim. 자동완성은 하지 않는다(Nominatim 정책이 타이핑마다 때리는 것을 금지하고, 구글은 호출당 과금
// 등급이 있다). 화면은 Enter 를 눌렀을 때만 이 함수를 부른다.
//
// 지키는 것
//   · 결과 24시간 캐시(planner_place_search_cache, 해시에 provider 포함). 캐시 히트는 외부 호출이 없다.
//   · 캐시 조회가 실패하면 "미스"로 보지 않고 503 으로 닫는다 — 구글이면 과금이 새고, OSM 이면 정책 위반 방향이다.
//   · OSM: 외부 호출 전 DB 전역 게이트(planner_geo_slot)로 1초에 한 번을 앱 전체에서 보장하고 UA 에 연락처를 쓴다.
//   · 구글(2026-09-05): 서버 키가 없으면 503(조용한 OSM 강등 금지). HTTP·파싱 실패는 502. 필드마스크는 _google_places.js
//     가 Pro 등급으로 고정한다(영업시간 없음). **호출 한도는 두지 않는다**(2026-09-05 쿠마님 결정 — 사용자가 한도에
//     막혀 떠나는 손실이 과금보다 크다. 남용 방어는 구글 콘솔 쿼터로만).
//   · opening_hours 는 파싱하지 않는다(설계 §6 형식 v1). OSM 은 원문을 unknown 으로, 구글은 null.
//
// 응답: { ok: true, provider, cached, results: [{ provider, provider_place_id, name, address, lat, lng, opening_hours }] }

import { fail, fetchWithTimeout, gate, googleServerKey, pickProvider, sha256, waitForSlot } from './_common.js';
import { searchTextGoogle } from './_google_places.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESULTS = 8;
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
// Nominatim 정책: 실제 연락 가능한 주소를 UA 에 넣어야 한다.
const UA = 'ConnectTrip-Planner/1.0 (+https://www.connecttrip.co.kr; 200kgBrothers@gmail.com)';

function normalizeQuery(q) {
  return String(q || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

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

// 구글 분기. 키 없음은 503, 호출 실패는 502. 한도는 없다(위 주석).
async function searchGoogle(q) {
  const key = googleServerKey();
  if (!key) return { unavailable: true, results: [] };
  const r = await searchTextGoogle({ q, key });
  if (!r.ok) return { failed: true, reason: r.reason, results: [] };
  return { results: r.results };
}

export default async function handler(req, res) {
  const ctx = await gate(req, res, { methods: ['POST'], rateKey: 'places', rateLimit: 60 });
  if (!ctx) return;
  const { supabase } = ctx;

  const q = normalizeQuery(req.body?.q);
  if (q.length < 2) {
    return fail(res, 400, 'BAD_QUERY', '두 글자 이상 입력해 주세요.');
  }

  const provider = await pickProvider(supabase);
  if (!provider) {
    // 제공자 판정 실패는 OSM 강등이 아니라 503 — 프런트가 구글 지도를 그리고 있을 수 있다.
    return fail(res, 503, 'SERVICE_UNAVAILABLE', '장소 검색을 준비 중입니다.');
  }
  const hash = sha256(`${provider}|${q.toLowerCase()}|ko`);

  // 1) 캐시. 조회 오류는 미스가 아니다(fail-closed).
  const { data: cached, error: cacheErr } = await supabase
    .from('planner_place_search_cache')
    .select('result, fetched_at')
    .eq('query_hash', hash)
    .maybeSingle();
  if (cacheErr) {
    return fail(res, 503, 'SERVICE_UNAVAILABLE', '장소 검색을 준비 중입니다.');
  }
  if (cached && Date.now() - Date.parse(cached.fetched_at) < CACHE_TTL_MS) {
    return res.status(200).json({ ok: true, provider, cached: true, results: cached.result || [] });
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

  // 3) 캐시 저장. 실패해도 응답은 그대로 주되, 같은 검색이 반복 과금되는 원인이 되므로 로그는 남긴다(codex 권고).
  const { error: saveErr } = await supabase
    .from('planner_place_search_cache')
    .upsert({ query_hash: hash, provider, result: results, fetched_at: new Date().toISOString() });
  if (saveErr) {
    console.error('[planner/places] cache save failed', provider, saveErr.code || saveErr.message || '');
  }

  return res.status(200).json({ ok: true, provider, cached: false, results });
}

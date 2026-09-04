// POST /api/planner/places   body: { q }   header: Authorization: Bearer <supabase access_token>
//
// 장소 검색 (설계 §4). 구글 키가 없으면 OSM Nominatim 을 쓴다.
// 자동완성은 하지 않는다 — Nominatim 이용 정책이 타이핑마다 때리는 것을 금지한다.
// 화면은 Enter 를 눌렀을 때만 이 함수를 부른다.
//
// 지키는 것
//   · 결과 24시간 캐시(planner_place_search_cache). 캐시 히트는 외부 호출을 아예 하지 않는다.
//   · 외부 호출 전 DB 전역 게이트(planner_geo_slot)로 1초에 한 번을 앱 전체에서 보장한다.
//   · User-Agent 에 연락처를 명시한다(Nominatim 정책 요구사항).
//   · opening_hours 는 파싱하지 않고 원문을 unknown 표시와 함께 넘긴다(설계 §6 정규화 형식 v1).
//     카탈로그에 한 번 들어가면 갱신되지 않으므로, 확실하지 않은 값을 확정된 척 넣지 않는다.
//
// 응답: { ok: true, provider, results: [{ provider, provider_place_id, name, address, lat, lng, opening_hours }] }

import { fail, fetchWithTimeout, gate, pickProvider, sha256, waitForSlot } from './_common.js';

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

export default async function handler(req, res) {
  const ctx = await gate(req, res, { methods: ['POST'], rateKey: 'places', rateLimit: 60 });
  if (!ctx) return;
  const { supabase } = ctx;

  const q = normalizeQuery(req.body?.q);
  if (q.length < 2) {
    return fail(res, 400, 'BAD_QUERY', '두 글자 이상 입력해 주세요.');
  }

  const provider = await pickProvider(supabase);
  const hash = sha256(`${provider}|${q.toLowerCase()}|ko`);

  // 1) 캐시
  const { data: cached } = await supabase
    .from('planner_place_search_cache')
    .select('result, fetched_at')
    .eq('query_hash', hash)
    .maybeSingle();
  if (cached && Date.now() - Date.parse(cached.fetched_at) < CACHE_TTL_MS) {
    return res.status(200).json({ ok: true, provider, cached: true, results: cached.result || [] });
  }

  // 2) 제공자 호출
  let results = [];
  try {
    if (provider === 'osm') {
      const r = await searchOsm(supabase, q);
      if (r.limited) {
        return fail(res, 429, 'BUSY', '검색이 몰리고 있습니다. 잠시 뒤에 다시 시도해 주세요.');
      }
      if (r.failed) {
        return fail(res, 502, 'PROVIDER_ERROR', '장소를 찾지 못했습니다. 잠시 뒤에 다시 시도해 주세요.');
      }
      results = r.results;
    } else {
      // 구글 경로는 키가 도착한 뒤에 붙인다. 지금 여기로 오면 설정이 어긋난 것이라
      // 조용히 빈 결과를 주지 않고 분명히 실패시킨다.
      return fail(res, 503, 'SERVICE_UNAVAILABLE', '장소 검색을 준비 중입니다.');
    }
  } catch {
    return fail(res, 502, 'PROVIDER_ERROR', '장소를 찾지 못했습니다. 잠시 뒤에 다시 시도해 주세요.');
  }

  // 3) 캐시 저장. 실패해도 응답은 그대로 준다.
  await supabase
    .from('planner_place_search_cache')
    .upsert({ query_hash: hash, provider, result: results, fetched_at: new Date().toISOString() });

  return res.status(200).json({ ok: true, provider, cached: false, results });
}

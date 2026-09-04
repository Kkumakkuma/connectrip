// POST /api/planner/routes   body: { legs: [{from:{lat,lng}, to:{lat,lng}}], mode }
//                            header: Authorization: Bearer <supabase access_token>
//
// 핀 사이 이동시간 (설계 §4).
//
// 구글 키가 있으면 Routes API 로 실제 경로를 받고, 없으면 직선거리 × 보정계수로 추정한다.
// 추정값은 source:'estimate' 로 표시해 화면이 "예상"이라고 밝히게 한다.
//
// 왜 서버에 두나
//   · 구글 키를 브라우저에 내려보내지 않기 위해서다. 키가 노출되면 남이 우리 할당량을 쓴다.
//   · 결과를 30일 캐시(planner_route_cache)해 같은 구간을 반복 호출하지 않는다.
//   · 제공자 선택(google/osm)의 근거는 DB 단일행이다 — 지도와 경로가 서로 다른 제공자로
//     갈라지면 구글 약관 3.2.4 위반이라 env 로 가르지 않는다.
//
// 한국은 구글이 자동차·도보 경로를 제공하지 않는다. 키가 있어도 estimate 로 떨어질 수 있고,
// 그건 결함이 아니라 예정된 동작이다.

import { fail, fetchWithTimeout, gate, pickProvider, sha256 } from './_common.js';
// 화면과 같은 추정식을 쓰려고 그대로 가져온다. 브라우저 의존이 없는 순수 모듈이다.
import { estimateLeg } from '../../src/planner/lib/travelTime.js';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LEGS = 30;
const MODES = ['WALK', 'DRIVE', 'TRANSIT'];
const GOOGLE_ROUTES = 'https://routes.googleapis.com/directions/v2:computeRoutes';

function estimate(from, to, mode) {
  // 화면과 **같은 함수**를 쓴다. 서버가 계산을 따로 들고 있으면 같은 구간이 화면마다
  // 다르게 보인다(실제로 대중교통 보정계수가 1.3 대 1.0 으로 갈려 있었다).
  const leg = estimateLeg(from, to, mode);
  return leg || { mode, duration_s: 0, distance_m: 0, source: 'estimate' };
}

function validPoint(p) {
  const lat = Number(p?.lat);
  const lng = Number(p?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    ? { lat, lng }
    : null;
}

// 구글 Routes. 필드마스크를 최소로 잡아 과금 등급을 낮춘다.
async function googleRoute(from, to, mode) {
  const key = (process.env.GOOGLE_MAPS_SERVER_KEY || '').trim();
  if (!key) return null;
  try {
    const resp = await fetchWithTimeout(GOOGLE_ROUTES, {
      method: 'POST',
      timeoutMs: 6000,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: mode,
        ...(mode === 'DRIVE' ? { routingPreference: 'TRAFFIC_UNAWARE' } : {}),
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const route = data?.routes?.[0];
    if (!route) return null;
    // duration 은 "123s" 형태다.
    const seconds = Number(String(route.duration || '').replace(/s$/, ''));
    const meters = Number(route.distanceMeters);
    if (!Number.isFinite(seconds) || !Number.isFinite(meters)) return null;
    return { mode, duration_s: Math.round(seconds), distance_m: Math.round(meters), source: 'google' };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const ctx = await gate(req, res, { methods: ['POST'], rateKey: 'routes', rateLimit: 120 });
  if (!ctx) return;
  const { supabase } = ctx;

  const mode = MODES.includes(req.body?.mode) ? req.body.mode : 'WALK';
  const rawLegs = Array.isArray(req.body?.legs) ? req.body.legs.slice(0, MAX_LEGS) : [];
  if (rawLegs.length === 0) {
    return fail(res, 400, 'BAD_REQUEST', '계산할 구간이 없습니다.');
  }

  const provider = await pickProvider(supabase);
  const out = [];

  for (const leg of rawLegs) {
    const from = validPoint(leg?.from);
    const to = validPoint(leg?.to);
    if (!from || !to) {
      // 좌표가 이상한 구간은 건너뛰지 않고 자리를 채운다 — 인덱스가 밀리면 화면이 어긋난다.
      out.push(null);
      continue;
    }

    // 좌표를 소수점 5자리(약 1m)로 잘라 캐시 키를 만든다. 그 이상은 캐시 적중률만 떨어뜨린다.
    const k = (p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    const hash = sha256(`${provider}|${mode}|${k(from)}|${k(to)}`);

    const { data: cached } = await supabase
      .from('planner_route_cache')
      .select('mode, duration_s, distance_m, fetched_at')
      .eq('key_hash', hash)
      .maybeSingle();
    if (cached && Date.now() - Date.parse(cached.fetched_at) < CACHE_TTL_MS) {
      out.push({
        mode: cached.mode,
        duration_s: cached.duration_s,
        distance_m: cached.distance_m,
        source: 'cache',
      });
      continue;
    }

    let leg1 = provider === 'google' ? await googleRoute(from, to, mode) : null;
    // 구글이 답을 못 주면(한국의 자동차·도보처럼) 추정으로 떨어진다. 결함이 아니다.
    if (!leg1) leg1 = estimate(from, to, mode);

    // 추정값은 캐시하지 않는다. 계산이 싸고, 캐시해 두면 나중에 키가 생겨도 옛 추정이 남는다.
    if (leg1.source === 'google') {
      await supabase.from('planner_route_cache').upsert({
        key_hash: hash,
        mode: leg1.mode,
        duration_s: leg1.duration_s,
        distance_m: leg1.distance_m,
        fetched_at: new Date().toISOString(),
      });
    }
    out.push(leg1);
  }

  return res.status(200).json({ ok: true, provider, mode, legs: out });
}

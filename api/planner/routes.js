// POST /api/planner/routes   header: Authorization: Bearer <supabase access_token>
//   body { day_id, mode? }                    : 그 날짜의 핀을 DB 에서 읽어 구간을 계산하고 planner_days.legs 에 저장(화면이 쓰는 경로)
//   body { legs: [{from,to}], mode }          : 좌표 쌍만 계산(저장 없음, 옛 호환)
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
// 날짜 모드(2026-09-05): 화면이 좌표 쌍을 보내지 않고 day_id 만 보낸다. 서버가 핀을 다시 읽어야
//   저장된 legs 와 DB 핀 순서가 어긋나지 않는다. 저장 직전 지문(planner_day_places_fp)을 다시 읽어
//   계산 중에 핀이 바뀌었으면 저장하지 않는다. 스냅샷·공유 화면은 지문이 맞는 legs 만 보여 준다.
//   구간별 수단은 화면과 같은 규칙(pickMode: 직선 1.2km 이하 도보, 그 밖은 대중교통)이고 mode 를 주면 전부 그 수단.
//
// 한국은 구글이 자동차·도보 경로를 제공하지 않는다. 키가 있어도 estimate 로 떨어질 수 있고,
// 그건 결함이 아니라 예정된 동작이다.

import { fail, fetchWithTimeout, gate, pickProvider, sha256, googleServerKey } from './_common.js';
// 화면과 같은 추정식을 쓰려고 그대로 가져온다. 브라우저 의존이 없는 순수 모듈이다.
import { estimateLeg, haversineMeters, pickMode } from '../../src/planner/lib/travelTime.js';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LEGS = 30; // 좌표 쌍 모드 상한
const MAX_DAY_PINS = 200; // 날짜 모드: 여행당 핀 상한과 같다
const MODES = ['WALK', 'DRIVE', 'TRANSIT'];
const GOOGLE_ROUTES = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 대중교통 출발 시각. "지금" 기준으로 물으면 서버 시각이 한밤일 때(한국 밤 = 일본·한국 막차 뒤) 구글이 경로를 못 주고
// 추정치로 떨어진다(9/5 운영 실측: 도쿄 00시 → 없음, 같은 시각 파리·뉴욕·런던 낮 → 정상). 여행은 낮에 움직이는 게
// 기본이므로 그 날짜의 현지 10시로 묻는다(시간대는 경도/15h 근사). 구글 허용 창(지금~100일 뒤) 밖이면 "다음 현지 10시".
export function transitDepartureTime(dateStr, lng, nowMs = Date.now()) {
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;
  const offsetH = Number.isFinite(lng) ? Math.round(lng / 15) : 0;
  const min = nowMs + 5 * 60 * 1000;      // 전송 지연 여유(구글은 과거 시각을 거부)
  const max = nowMs + 100 * DAY - HOUR;   // 구글 허용 상한 100일에서 한 시간 여유
  let t = NaN;
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const base = Date.parse(`${dateStr}T00:00:00Z`);
    if (Number.isFinite(base)) t = base + (10 - offsetH) * HOUR;
  }
  if (!Number.isFinite(t) || t < min || t > max) {
    const localNow = nowMs + offsetH * HOUR;
    t = Math.floor(localNow / DAY) * DAY + 10 * HOUR - offsetH * HOUR;
    if (t < min) t += DAY;
  }
  return new Date(t).toISOString();
}

function estimate(from, to, mode) {
  // 화면과 **같은 함수**를 쓴다. 서버가 계산을 따로 들고 있으면 같은 구간이 화면마다
  // 다르게 보인다(실제로 대중교통 보정계수가 1.3 대 1.0 으로 갈려 있었다).
  const leg = estimateLeg(from, to, mode);
  return leg || { mode, duration_s: 0, distance_m: 0, source: 'estimate' };
}

function validPoint(p) {
  // null/undefined/빈 문자열은 Number() 가 0 으로 바꿔 버리므로 먼저 걸러낸다(0,0 은 좌표가 아니라 결측이다).
  const raw = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const lat = raw(p?.lat);
  const lng = raw(p?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    ? { lat, lng }
    : null;
}

// 구글 Routes. 필드마스크를 최소로 잡아 과금 등급을 낮춘다.
async function googleRoute(from, to, mode, departureTime = null) {
  const key = googleServerKey();
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
        ...(mode === 'TRANSIT' && departureTime ? { departureTime } : {}),
      }),
    });
    if (!resp.ok) {
      // 실패 이유를 남긴다(9/5 운영 실측: TRANSIT 만 조용히 추정치로 떨어져 원인을 알 수 없었다). 키는 로그에 안 남는다.
      let detail = '';
      try { detail = (await resp.text()).slice(0, 300); } catch { /* ignore */ }
      console.error('[planner/routes] google', resp.status, mode, detail);
      return null;
    }
    const data = await resp.json();
    const route = data?.routes?.[0];
    if (!route) {
      console.warn('[planner/routes] google no route', mode, JSON.stringify(data).slice(0, 200));
      return null;
    }
    // duration 은 "123s" 형태다.
    const seconds = Number(String(route.duration || '').replace(/s$/, ''));
    const meters = Number(route.distanceMeters);
    if (!Number.isFinite(seconds) || !Number.isFinite(meters)) return null;
    return { mode, duration_s: Math.round(seconds), distance_m: Math.round(meters), source: 'google' };
  } catch (e) {
    console.error('[planner/routes] google fetch failed', mode, e?.name || '', String(e?.message || '').slice(0, 120));
    return null;
  }
}

// 한 구간: 캐시 → 구글(열려 있을 때) → 추정. 캐시 조회 오류는 미스가 아니라 추정치(fail-closed).
async function computeLeg(supabase, { provider, googleOpen, clientGone }, from, to, mode, dateStr = null) {
  // 좌표를 소수점 5자리(약 1m)로 잘라 캐시 키를 만든다. 그 이상은 캐시 적중률만 떨어뜨린다.
  const k = (p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  const departureTime = mode === 'TRANSIT' ? transitDepartureTime(dateStr, from.lng) : null;
  // 대중교통은 평일/주말 운행이 달라 캐시 키를 나눈다(codex 9/5). 대표 시각(현지 10시) 설계라 날짜 자체는 키에 안 넣는다.
  const dayClass = departureTime ? ([0, 6].includes(new Date(departureTime).getUTCDay()) ? 'we' : 'wd') : '';
  const hash = sha256(`${provider}|${mode}${dayClass ? `|${dayClass}` : ''}|${k(from)}|${k(to)}`);

  const { data: cached, error: cacheErr } = await supabase
    .from('planner_route_cache')
    .select('mode, duration_s, distance_m, fetched_at')
    .eq('key_hash', hash)
    .maybeSingle();
  if (cacheErr) return estimate(from, to, mode);
  if (cached && Date.now() - Date.parse(cached.fetched_at) < CACHE_TTL_MS) {
    return { mode: cached.mode, duration_s: cached.duration_s, distance_m: cached.distance_m, source: 'cache' };
  }

  let leg = googleOpen && !clientGone() ? await googleRoute(from, to, mode, departureTime) : null;
  // 구글이 답을 못 주면(한국의 자동차·도보처럼) 추정으로 떨어진다. 결함이 아니다.
  if (!leg) leg = estimate(from, to, mode);

  // 추정값은 캐시하지 않는다. 계산이 싸고, 캐시해 두면 나중에 키가 생겨도 옛 추정이 남는다.
  if (leg.source === 'google') {
    await supabase.from('planner_route_cache').upsert({
      key_hash: hash,
      mode: leg.mode,
      duration_s: leg.duration_s,
      distance_m: leg.distance_m,
      fetched_at: new Date().toISOString(),
    });
  }
  return leg;
}

async function dayFingerprint(supabase, dayId) {
  const { data, error } = await supabase.rpc('planner_day_places_fp', { p_day_id: dayId });
  if (error || typeof data !== 'string') return null;
  return data;
}

// 날짜 모드: 핀을 DB 에서 읽어 계산하고 저장한다.
async function handleDay(req, res, supabase, ctx, provider, cfg, dayId, requestedMode) {
  if (!UUID_RE.test(dayId)) return fail(res, 400, 'BAD_REQUEST', '날짜 정보가 올바르지 않습니다.');

  const { data: day, error: dErr } = await supabase
    .from('planner_days')
    .select('id, user_id, date')
    .eq('id', dayId)
    .maybeSingle();
  if (dErr) return fail(res, 503, 'SERVICE_UNAVAILABLE', '경로 계산을 준비 중입니다.');
  // 남의 날짜는 없는 것과 같게 답한다(존재를 알리지 않는다).
  if (!day || day.user_id !== ctx.user.id) return fail(res, 404, 'NOT_FOUND', '날짜를 찾을 수 없습니다.');

  const fpBefore = await dayFingerprint(supabase, dayId);
  if (fpBefore === null) return fail(res, 503, 'SERVICE_UNAVAILABLE', '경로 계산을 준비 중입니다.');

  const { data: pins, error: pErr } = await supabase
    .from('planner_places')
    .select('id, lat, lng, sort_order, created_at')
    .eq('day_id', dayId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (pErr) return fail(res, 503, 'SERVICE_UNAVAILABLE', '경로 계산을 준비 중입니다.');

  // 하루 최대 핀 수는 여행 상한(200)과 같게 본다 — 화면·스냅샷과 길이가 어긋나면 전부 추정치로 떨어진다(codex 지적).
  const list = (Array.isArray(pins) ? pins : []).slice(0, MAX_DAY_PINS);
  const items = [];
  for (let i = 0; i < list.length - 1; i += 1) {
    const from = validPoint(list[i]);
    const to = validPoint(list[i + 1]);
    const mode = requestedMode || (from && to ? pickMode(haversineMeters(from, to)) : 'WALK');
    // DB 좌표는 CHECK 로 보장되지만, 혹시 비면 자리를 비우지 않고 0 추정치로 채운다(인덱스가 밀리면 화면이 어긋난다 — agy 지적).
    const leg = from && to
      ? await computeLeg(supabase, cfg, from, to, mode, typeof day.date === 'string' ? day.date : null)
      : { mode, duration_s: 0, distance_m: 0, source: 'estimate' };
    items.push({ from: i, to: i + 1, ...leg });
  }

  // 저장은 DB 함수가 원자적으로 한다: 날짜 행을 잠그고 지문을 다시 읽어 계산 시작 때와 같을 때만 쓴다.
  // (지문 확인과 UPDATE 를 따로 하면 그 사이 핀이 바뀌었을 때 옛 legs 가 트리거의 NULL 을 덮어쓴다 — codex·agy 지적)
  const computedAt = new Date().toISOString();
  const envelope = { mode: requestedMode || 'AUTO', computed_at: computedAt, fp: fpBefore, items };
  const { data: savedRow, error: sErr } = await supabase.rpc('planner_save_day_legs', {
    p_day_id: dayId,
    p_user_id: ctx.user.id,
    p_fp: fpBefore,
    p_legs: envelope,
  });
  if (sErr) console.error('[planner/routes] legs save failed', sErr.code || sErr.message || '');
  const saved = !sErr && savedRow === true;
  return res.status(200).json({ ok: true, provider, mode: envelope.mode, legs: items, saved, fp: fpBefore, computed_at: computedAt });
}

export default async function handler(req, res) {
  const ctx = await gate(req, res, { methods: ['POST'], rateKey: 'routes', rateLimit: 120 });
  if (!ctx) return;
  const { supabase } = ctx;

  const requestedMode = MODES.includes(req.body?.mode) ? req.body.mode : null;
  const dayId = typeof req.body?.day_id === 'string' ? req.body.day_id.trim() : '';
  const rawLegs = Array.isArray(req.body?.legs) ? req.body.legs.slice(0, MAX_LEGS) : [];
  if (!dayId && rawLegs.length === 0) {
    return fail(res, 400, 'BAD_REQUEST', '계산할 구간이 없습니다.');
  }

  const provider = await pickProvider(supabase);
  if (!provider) {
    // 제공자 판정 실패는 OSM 강등이 아니라 503 — 프런트가 구글 지도를 그리고 있을 수 있다(교차검토 합의).
    return fail(res, 503, 'SERVICE_UNAVAILABLE', '경로 계산을 준비 중입니다.');
  }

  // 구글 호출 한도 없음(2026-09-05 쿠마님 결정): 예전의 사용자 200/10분·전역 300/일 예산은 제거했다.
  // 남용 방어는 구글 콘솔 쿼터로만 한다. 서버 키가 없으면 구글을 부르지 않고 추정치(제공자 판정은 그대로 google).
  const cfg = {
    provider,
    googleOpen: provider === 'google' && Boolean(googleServerKey()),
    // 클라이언트가 끊었으면 남은 구간에 구글 호출을 쓰지 않는다(codex 지적)
    clientGone: () => Boolean(req.aborted || res.destroyed || res.writableEnded),
  };

  if (dayId) return handleDay(req, res, supabase, ctx, provider, cfg, dayId, requestedMode);

  // 좌표 쌍 모드(옛 호환). 수단을 안 주면 도보.
  const mode = requestedMode || 'WALK';
  const out = [];
  for (const leg of rawLegs) {
    const from = validPoint(leg?.from);
    const to = validPoint(leg?.to);
    if (!from || !to) {
      // 좌표가 이상한 구간은 건너뛰지 않고 자리를 채운다 — 인덱스가 밀리면 화면이 어긋난다.
      out.push(null);
      continue;
    }
    out.push(await computeLeg(supabase, cfg, from, to, mode));
  }
  return res.status(200).json({ ok: true, provider, mode, legs: out });
}

// POST /api/planner/extract-links   body: { url }   header: Authorization: Bearer <token>
//
// 링크로 담기 (설계 §4). 네이버 블로그 글이나 구글 지도 링크에서 장소 후보를 뽑아 준다.
// 사용자는 받은 후보를 보고 체크해서 담는다 — 자동으로 여행에 넣지 않는다.
//
// 이 함수는 절대 직접 fetch 하지 않는다. 반드시 _url-guard.js 의 guardedGet 만 쓴다.
// 사용자가 준 주소를 서버가 대신 여는 경로라, 가드를 우회하는 호출이 하나라도 생기면
// 그 순간 SSRF 구멍이 된다.
//
// 응답: { ok: true, candidates: [{ name, address, lat, lng, source }] }
// 실패는 사유를 감추고 LINK_NOT_SUPPORTED 하나로 응답한다.

import { fail, gate, sha256 } from './_common.js';
import { guardedGet } from './_url-guard.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CANDIDATES = 20;

function clampLat(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= -90 && n <= 90 ? n : null;
}
function clampLng(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= -180 && n <= 180 ? n : null;
}

function pushCandidate(out, entry) {
  if (!entry?.name) return;
  const lat = clampLat(entry.lat);
  const lng = clampLng(entry.lng);
  if (lat === null || lng === null) return;
  if (lat === 0 && lng === 0) return;
  // 같은 좌표가 여러 번 나오는 글이 많다(지도 모듈 반복 삽입).
  if (out.some((c) => c.lat === lat && c.lng === lng)) return;
  out.push({
    name: String(entry.name).trim().slice(0, 120),
    address: String(entry.address || '').trim().slice(0, 300),
    lat,
    lng,
    source: entry.source,
  });
}

// 네이버 블로그: 스마트에디터 지도 모듈이 data-linkdata 에 JSON 을 그대로 담는다.
// 속성값은 HTML 이스케이프돼 있으므로 되돌린 뒤 파싱한다.
export function extractNaver(html) {
  const out = [];
  const re = /data-linkdata=(["'])(.*?)\1/gs;
  let m;
  while ((m = re.exec(html)) && out.length < MAX_CANDIDATES) {
    const raw = m[2]
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    // 지도 모듈만 고른다. 링크 카드·동영상 모듈도 같은 속성을 쓴다.
    const lat = data?.latitude ?? data?.lat ?? data?.place?.latitude;
    const lng = data?.longitude ?? data?.lng ?? data?.place?.longitude;
    if (lat === undefined || lng === undefined) continue;
    pushCandidate(out, {
      name: data?.name || data?.title || data?.place?.name,
      address: data?.address || data?.roadAddress || data?.place?.address,
      lat,
      lng,
      source: 'naver-blog',
    });
  }
  return out;
}

// 구글 지도: 최종 URL 에 좌표가 들어 있다.
//   .../@37.5665,126.9780,17z            현재 지도 중심
//   ...!3d37.5665!4d126.9780             핀 좌표(더 정확)
//   ...?q=37.5665,126.9780
export function extractGoogleFromUrl(finalUrl, html) {
  const out = [];
  const name = (() => {
    const m = /<title>([^<]{1,150})<\/title>/i.exec(html || '');
    if (!m) return '';
    return m[1].replace(/\s*[-–]\s*Google\s*(지도|Maps).*$/i, '').trim();
  })();

  const pin = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(finalUrl);
  if (pin) pushCandidate(out, { name: name || '구글 지도 장소', lat: pin[1], lng: pin[2], source: 'google-maps' });

  if (!out.length) {
    const q = /[?&]q=(-?\d+\.\d+)%2C(-?\d+\.\d+)|[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/.exec(finalUrl);
    if (q) {
      pushCandidate(out, {
        name: name || '구글 지도 장소',
        lat: q[1] ?? q[3],
        lng: q[2] ?? q[4],
        source: 'google-maps',
      });
    }
  }

  if (!out.length) {
    const center = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(finalUrl);
    if (center) {
      pushCandidate(out, { name: name || '구글 지도 위치', lat: center[1], lng: center[2], source: 'google-maps' });
    }
  }
  return out;
}

export default async function handler(req, res) {
  const ctx = await gate(req, res, { methods: ['POST'], rateKey: 'links', rateLimit: 30 });
  if (!ctx) return;
  const { supabase } = ctx;

  const raw = String(req.body?.url || '').trim();
  if (!raw || raw.length > 2048) {
    return fail(res, 400, 'LINK_NOT_SUPPORTED', '이 링크에서는 장소를 찾지 못했습니다.');
  }

  const hash = sha256(raw);
  const { data: cached } = await supabase
    .from('planner_link_cache')
    .select('result, fetched_at')
    .eq('url_hash', hash)
    .maybeSingle();
  if (cached && Date.now() - Date.parse(cached.fetched_at) < CACHE_TTL_MS) {
    return res.status(200).json({ ok: true, cached: true, candidates: cached.result || [] });
  }

  let page;
  try {
    page = await guardedGet(raw);
  } catch {
    // 사유(호스트 거부/사설 IP/타임아웃)를 구분해 알려 주면 그 자체가 탐색 도구가 된다.
    return fail(res, 400, 'LINK_NOT_SUPPORTED', '이 링크에서는 장소를 찾지 못했습니다.');
  }

  const host = (() => {
    try {
      return new URL(page.url).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();

  let candidates = [];
  if (host.endsWith('blog.naver.com')) {
    candidates = extractNaver(page.body);
  } else if (host.includes('google')) {
    candidates = extractGoogleFromUrl(page.url, page.body);
  }

  if (!candidates.length) {
    return fail(res, 404, 'LINK_NOT_SUPPORTED', '이 링크에서는 장소를 찾지 못했습니다.');
  }

  // 본문·리다이렉트 체인은 저장하지 않는다. 뽑아낸 후보만 남긴다.
  await supabase
    .from('planner_link_cache')
    .upsert({ url_hash: hash, result: candidates, fetched_at: new Date().toISOString() });

  return res.status(200).json({ ok: true, cached: false, candidates });
}

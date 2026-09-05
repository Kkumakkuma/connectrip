// 플래너 서버리스 함수 공통 관문 (설계 §9).
//
// 순서: CORS → 메서드 → 기능 플래그 → 환경변수 → 로그인 확인 → 사용자별 레이트리밋.
// 각 함수(places/routes/extract-links)는 이 관문을 통과한 뒤 자기 일만 한다.
//
// 응답 규격은 기존 api/verify-identity.js 관례를 따른다 — 실패는 고정 code + 일반 메시지.
// 사유를 자세히 알려 주면 그것 자체가 탐색 도구가 된다.

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { applyCors } from '../_cors.js';

export function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function fail(res, status, code, error) {
  res.status(status).json({ ok: false, code, error });
  return null;
}

/**
 * 공통 관문. 통과하면 { supabase, user } 를 돌려주고, 막히면 응답을 이미 보낸 뒤 null.
 *
 * @param {object} opts
 * @param {string[]} opts.methods  허용 메서드 (기본 ['POST'])
 * @param {string}   opts.rateKey  레이트리밋 키 접두사 (예: 'places')
 * @param {number}   opts.rateLimit 10분 창 허용 횟수
 */
export async function gate(req, res, { methods = ['POST'], rateKey, rateLimit = 60 } = {}) {
  if (applyCors(req, res)) return null;

  if (!methods.includes(req.method)) {
    res.setHeader('Allow', methods.join(', '));
    return fail(res, 405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청입니다.');
  }

  // 기능이 꺼져 있으면 존재 자체를 알리지 않는다(라우트가 없는 것과 같게).
  //
  // 기본값을 '열림'으로 둔다. 예전처럼 'true' 를 요구하면 Vercel 대시보드에 환경변수를
  // 넣기 전까지 장소 검색·링크로 담기가 404 로 죽는데, 그 사실이 화면에서는 그냥
  // "안 된다"로만 보여 원인을 찾기 어렵다. 끄고 싶을 때 PLANNER_ENABLED=false 를 넣으면
  // 그대로 닫힌다 — 킬 스위치는 그대로 있다.
  // 어차피 이 함수들은 로그인한 사용자만 통과하고 사용자별 레이트리밋도 건다.
  if (String(process.env.PLANNER_ENABLED || '').trim().toLowerCase() === 'false') {
    res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Not found' });
    return null;
  }

  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    return fail(res, 503, 'SERVICE_UNAVAILABLE', '서비스 준비 중입니다.');
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return fail(res, 401, 'AUTH_REQUIRED', '로그인이 필요합니다.');

  const { data: userData, error: uErr } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (uErr || !user) return fail(res, 401, 'AUTH_REQUIRED', '로그인이 필요합니다.');

  // 사용자 축 레이트리밋. 10분 창 누적이라 짧은 폭주를 잡는다.
  if (rateKey) {
    const { data: hits, error: rErr } = await supabase.rpc('planner_rate_hit', {
      p_key: `${rateKey}:${user.id}`,
      p_limit: rateLimit,
    });
    // 레이트리밋 자체가 실패하면 통과시킨다 — 검색이 죽는 것보다 낫고, 외부 호출은
    // 그 뒤의 전역 게이트가 다시 한 번 조인다.
    if (!rErr && Number(hits) > rateLimit) {
      return fail(res, 429, 'RATE_LIMITED', '요청이 너무 잦습니다. 잠시 뒤에 다시 시도해 주세요.');
    }
  }

  return { supabase, user };
}

// 제공자 선택의 단일 근거는 DB 다 (설계 §4 agy-7).
// 지도와 장소 데이터가 서로 다른 제공자로 갈라지면 구글 약관 3.2.4 위반이라 env 로 가르지 않는다.
// 제공자 판정은 DB 플래그 하나만 본다(2026-09-05 교차검토 합의). 예전엔 서버 키가 없으면 조용히 'osm' 으로
// 내려갔는데, 프런트는 같은 플래그로 이미 구글 지도를 그리고 있어서 그 위에 OSM 결과가 올라가면 제공자
// 단일 출처가 깨진다. 키 없음은 각 함수가 fail-closed 로 닫는다(places 503 / routes 추정치).
// 플래그 조회 자체가 실패하면 null — 호출자는 503 으로 닫는다(OSM 강등 금지).
export async function pickProvider(supabase) {
  try {
    const { data, error } = await supabase.rpc('planner_google_enabled');
    if (error) return null;
    return data === true ? 'google' : 'osm';
  } catch {
    return null;
  }
}

export function googleServerKey() {
  return (process.env.GOOGLE_MAPS_SERVER_KEY || '').trim();
}

// 일일 예산 예약(planner_daily_reserve, KST 일 버킷). 한도 안이면 true. RPC 오류·예외·이상값은 전부 false(fail-closed).
export async function reserveDaily(supabase, key, limit) {
  try {
    const { data, error } = await supabase.rpc('planner_daily_reserve', { p_key: key, p_limit: limit });
    return !error && data === true;
  } catch {
    return false;
  }
}

// 외부 제공자 호출 전 전역 게이트. 반환된 ms 만큼 기다린 뒤 딱 한 번 호출한다.
// -1 이면 대기 상한을 넘긴 것이라 호출을 포기한다(약관 위반 방향으로 새지 않는다).
export async function waitForSlot(supabase, provider, { intervalMs = 1100, maxWaitMs = 3000 } = {}) {
  const { data, error } = await supabase.rpc('planner_geo_slot', {
    p_provider: provider,
    p_interval_ms: intervalMs,
    p_max_wait_ms: maxWaitMs,
  });
  if (error) return false;
  const wait = Number(data);
  if (!Number.isFinite(wait) || wait < 0) return false;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return true;
}

// 타임아웃 있는 fetch. 외부 제공자가 늘어지면 서버리스 실행시간을 통째로 먹는다.
export async function fetchWithTimeout(url, { timeoutMs = 8000, ...init } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

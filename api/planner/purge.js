// 플래너 티켓 고아 파일 스위퍼 — 서버리스 진입점 (GET /api/planner/purge).
//
// 왜 서버리스인가: GitHub Actions 쪽 스위퍼는 SUPABASE_SERVICE_ROLE_KEY 시크릿이 있어야 도는데
// 그 키는 이미 Vercel 환경변수에만 있다(OTP·결제·플래너 API 가 쓴다). 같은 키를 두 곳에 두지 않고
// 여기서 돌린다. 실제 삭제 로직은 _purge_core.js 하나를 스크립트와 같이 쓴다.
//
// 인증(fail-closed): Authorization: Bearer <토큰> 이 아래 둘 중 하나와 같아야 한다.
//   1) Vercel 환경변수 CRON_SECRET — vercel.json crons 가 부를 때 Vercel 이 자동으로 붙인다.
//   2) Supabase Vault 의 ct_planner_purge_secret — service_role 전용 RPC planner_purge_secret() 로
//      읽는다. DB 의 pg_cron + pg_net 이 같은 값을 헤더에 실어 이 경로를 부른다.
// 둘 다 없으면 503 으로 닫힌다. user-agent 같은 위조 가능한 헤더는 보지 않는다(교차검토 합의).
// 토큰이 틀리면 404 — 경로의 존재를 알리지 않는다.
//
// 레이트리밋: 토큰 보유자만 오지만 10분 3회 전역 한도를 둔다(스케줄러 두 개가 겹쳐도 남는 여유).

import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { runPurge } from './_purge_core.js';
import { runCatalogRefresh } from './_refresh_core.js';
import { googleServerKey } from './_common.js';

const RATE_KEY = 'purge:cron';
const RATE_LIMIT = 3; // 10분 창
const DEADLINE_MS = 240 * 1000; // Vercel 함수 기본 300초보다 넉넉히 앞서 끊는다

function fail(res, status, code, error) {
  return res.status(status).json({ ok: false, code, error });
}

function sameToken(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function expectedTokens(supabase) {
  const tokens = [];
  const envSecret = (process.env.CRON_SECRET || '').trim();
  if (envSecret) tokens.push(envSecret);
  const { data, error } = await supabase.rpc('planner_purge_secret');
  if (!error && typeof data === 'string' && data.trim()) tokens.push(data.trim());
  return tokens;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return fail(res, 405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청입니다.');
  }

  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return fail(res, 503, 'SERVICE_UNAVAILABLE', '서비스 준비 중입니다.');

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const tokens = await expectedTokens(supabase);
  if (tokens.length === 0) {
    // 어느 쪽 비밀도 없으면 아무도 못 부른다. 스케줄러 로그에 503 이 남아 설정 누락이 보인다.
    return fail(res, 503, 'CRON_SECRET_MISSING', '호출 토큰이 설정되지 않았습니다.');
  }
  const auth = String(req.headers.authorization || '');
  const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!tokens.some((t) => sameToken(given, t))) {
    return fail(res, 404, 'NOT_FOUND', 'Not found');
  }

  // ?task=refresh : 구글 장소 카탈로그 재조회(약관 3.2.3, _refresh_core.js). Vercel Hobby 함수 12개 상한이 꽉 차서
  // 별도 함수 대신 같은 토큰·같은 관문 아래 작업만 갈라 탄다. pg_cron 'planner-catalog-refresh' 가 매일 부른다.
  const task = String(req.query?.task || 'purge');
  if (task !== 'purge' && task !== 'refresh') return fail(res, 400, 'BAD_TASK', '알 수 없는 작업입니다.');

  // 전역 레이트리밋. 사용자 축이 아니라 경로 축으로 세되, 작업별로 버킷을 나눠 한 작업의 재시도가 다른 작업을 막지 않게 한다.
  const { data: hits, error: rErr } = await supabase.rpc('planner_rate_hit', {
    p_key: `${RATE_KEY}:${task}`,
    p_limit: RATE_LIMIT,
  });
  if (rErr) return fail(res, 503, 'SERVICE_UNAVAILABLE', '서비스 준비 중입니다.');
  if (Number(hits) > RATE_LIMIT) {
    return fail(res, 429, 'RATE_LIMITED', '요청이 너무 잦습니다. 잠시 뒤에 다시 시도해 주세요.');
  }

  if (task === 'refresh') {
    const report = await runCatalogRefresh(supabase, { key: googleServerKey(), log: console, deadlineMs: DEADLINE_MS });
    if (report.failed > 0) {
      return res.status(500).json({ ok: false, code: 'REFRESH_FAILED', error: '일부 갱신이 실패했습니다.', report });
    }
    return res.status(200).json({ ok: true, task, report });
  }

  const dryRun = String(req.query?.dry || '') === '1';
  const report = await runPurge(supabase, { dryRun, log: console, deadlineMs: DEADLINE_MS });
  if (report.failed > 0) {
    return res.status(500).json({ ok: false, code: 'PURGE_FAILED', error: '일부 정리가 실패했습니다.', report });
  }
  return res.status(200).json({ ok: true, report });
}

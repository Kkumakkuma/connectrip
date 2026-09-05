// 플래너 티켓 고아 파일 스위퍼 — 수동 실행·GitHub Actions 진입점.
//
// 운영 경로는 Vercel Cron(api/planner/purge.js, 매일 02:35 KST)이다. 이 스크립트는 같은 로직
// (api/planner/_purge_core.js)을 손으로 돌리거나 dry-run 으로 큐 상태를 볼 때 쓴다.
//
// 실행: node scripts/planner_purge_orphans.mjs [--dry-run] [--no-backstop]
// 필요한 환경변수(GitHub Actions 시크릿 또는 셸에서만 주입한다. 코드·.env 에 넣지 않는다):
//   SUPABASE_URL                프로젝트 URL (VITE_SUPABASE_URL 도 받는다)
//   SUPABASE_SERVICE_ROLE_KEY   service_role 키 — 큐 테이블과 비공개 버킷에 접근하려면 필요하다
// 시크릿이 없으면 오류가 아니라 skip 으로 끝내되, Actions 로그에는 경고 주석을 남긴다
// (초록 체크만 보고 "돌고 있다"고 오해하지 않도록).

import { createClient } from '@supabase/supabase-js';
import { runPurge } from '../api/planner/_purge_core.js';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const SKIP_BACKSTOP = args.has('--no-backstop');

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!url || !key) {
  console.log('[planner-purge] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정 → skip (운영 정리는 Vercel Cron 이 맡는다)');
  if (process.env.GITHUB_ACTIONS) {
    console.log('::warning::planner-purge 는 시크릿이 없어 아무것도 하지 않았습니다. 운영 스위퍼는 Vercel Cron(api/planner/purge.js) 입니다.');
  }
  process.exit(0);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const report = await runPurge(supabase, { dryRun: DRY_RUN, skipBackstop: SKIP_BACKSTOP, log: console });
if (report.failed > 0) process.exit(1);
console.log('[planner-purge] 완료');

// 플래너 티켓 고아 파일 스위퍼.
//
// 회원 탈퇴·여행 삭제·티켓 삭제로 planner_tickets 행이 사라지면 DB 행은 CASCADE 로 정리되지만
// Storage 의 실제 파일은 남는다. planner_20260904.sql 의 AFTER DELETE 트리거가 지워진 행의
// 저장 경로를 planner_orphan_objects 큐에 넣어 두므로, 이 스크립트가 그 큐를 비운다.
//   1) purged_at IS NULL 인 행을 100개씩 읽어 Storage 에서 지우고 purged_at 을 채운다.
//      실패하면 attempts 를 올리고 last_error 를 남긴다(연속 실패한 행은 큐를 막지 않도록 건너뛴다).
//   2) 백스톱: 업로드는 됐는데 planner_tickets 행이 끝내 안 생긴 파일을 planner_ticket_orphans
//      뷰에서 찾아 지운다. 업로드 직후의 정상 파일을 지우지 않도록 24시간 이상 지난 것만 본다.
//
// 실행: node scripts/planner_purge_orphans.mjs [--dry-run] [--no-backstop]
// 필요한 환경변수(둘 다 GitHub Actions 시크릿으로만 주입한다. 코드·.env 에 넣지 않는다):
//   SUPABASE_URL                프로젝트 URL
//   SUPABASE_SERVICE_ROLE_KEY   service_role 키 — 큐 테이블과 비공개 버킷에 접근하려면 필요하다
// 시크릿이 없으면 오류가 아니라 skip 으로 끝낸다(키 등록 전 워크플로가 매일 실패하지 않도록).

import { createClient } from '@supabase/supabase-js';

const BUCKET_FALLBACK = 'planner-tickets';
const BATCH_SIZE = 100;
const MAX_BATCHES = 50;          // 한 번 실행에서 최대 5,000건
const MAX_ATTEMPTS = 5;          // 이 횟수 이상 실패한 행은 건너뛴다(사람이 볼 몫)
const BACKSTOP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const SKIP_BACKSTOP = args.has('--no-backstop');

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!url || !key) {
  console.log('[planner-purge] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정 → skip');
  process.exit(0);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failed = 0;

// 실패한 배치: attempts 를 1 올리고 사유를 남긴다.
// attempts 값이 같은 것끼리 묶어 한 번에 UPDATE 한다(행마다 요청을 보내지 않기 위해).
async function markFailure(rows, message) {
  const byAttempts = new Map();
  rows.forEach((row) => {
    const a = Number(row.attempts) || 0;
    if (!byAttempts.has(a)) byAttempts.set(a, []);
    byAttempts.get(a).push(row.id);
  });
  for (const [attempts, ids] of byAttempts) {
    const { error } = await supabase
      .from('planner_orphan_objects')
      .update({ attempts: attempts + 1, last_error: String(message).slice(0, 500) })
      .in('id', ids);
    if (error) console.error(`[planner-purge] attempts 기록 실패: ${error.message}`);
  }
}

async function purgeQueue() {
  let scanned = 0;
  let purged = 0;
  // 삭제가 한 번이라도 실패하면 같은 배치를 계속 두드리지 않고 이번 실행을 접는다.
  // (네트워크·권한 문제라면 재시도해도 같은 결과이고, attempts 를 한 번에 소진해 버리면
  //  일시적 장애 한 번으로 모든 행이 보류 상태가 된다.)
  let abort = false;

  for (let batch = 0; batch < MAX_BATCHES && !abort; batch += 1) {
    const { data: rows, error } = await supabase
      .from('planner_orphan_objects')
      .select('id, bucket_id, storage_path, attempts')
      .is('purged_at', null)
      .lt('attempts', MAX_ATTEMPTS)
      .order('queued_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      console.error(`[planner-purge] 큐 조회 실패: ${error.message}`);
      failed += 1;
      return { scanned, purged };
    }
    if (!rows || rows.length === 0) break;
    scanned += rows.length;

    // 버킷별로 나눠서 지운다(현재는 planner-tickets 하나지만 컬럼이 있으므로 그대로 따른다).
    const byBucket = new Map();
    rows.forEach((row) => {
      const bucket = row.bucket_id || BUCKET_FALLBACK;
      if (!byBucket.has(bucket)) byBucket.set(bucket, []);
      byBucket.get(bucket).push(row);
    });

    for (const [bucket, bucketRows] of byBucket) {
      const paths = bucketRows.map((r) => r.storage_path);
      if (DRY_RUN) {
        console.log(`[planner-purge] (dry-run) ${bucket}: ${paths.length}건 삭제 예정`);
        continue;
      }

      const { error: rmErr } = await supabase.storage.from(bucket).remove(paths);
      if (rmErr) {
        console.error(`[planner-purge] ${bucket} 삭제 실패(${paths.length}건): ${rmErr.message}`);
        await markFailure(bucketRows, rmErr.message);
        failed += 1;
        abort = true;
        break;
      }

      // remove 는 이미 없는 파일을 오류로 보지 않는다 → 성공한 배치는 전부 처리 완료로 본다.
      const ids = bucketRows.map((r) => r.id);
      const { error: upErr } = await supabase
        .from('planner_orphan_objects')
        .update({ purged_at: new Date().toISOString(), last_error: null })
        .in('id', ids);
      if (upErr) {
        // 파일은 지워졌는데 표시만 실패 → 같은 배치가 다시 잡히므로 이번 실행은 여기서 멈춘다.
        // 다음 실행에서 다시 시도한다(Storage remove 는 멱등이라 중복 삭제가 문제되지 않는다).
        console.error(`[planner-purge] purged_at 기록 실패: ${upErr.message}`);
        failed += 1;
        abort = true;
        break;
      }
      purged += ids.length;
    }

    if (DRY_RUN) break; // dry-run 은 같은 배치를 계속 읽으므로 한 번만 돈다
    if (rows.length < BATCH_SIZE) break;
  }

  // 손대지 못하고 남은 행(연속 실패)이 있으면 눈에 띄게 알린다.
  const { count, error: stuckErr } = await supabase
    .from('planner_orphan_objects')
    .select('id', { count: 'exact', head: true })
    .is('purged_at', null)
    .gte('attempts', MAX_ATTEMPTS);
  if (!stuckErr && count) {
    console.warn(`[planner-purge] ${MAX_ATTEMPTS}회 이상 실패해 보류된 행: ${count}건 (확인 필요)`);
  }

  return { scanned, purged };
}

// 백스톱: 큐가 잡지 못한 파일(업로드 후 메타 행이 끝내 안 생긴 경우)을 뷰에서 찾아 지운다.
async function purgeBackstop() {
  const cutoff = new Date(Date.now() - BACKSTOP_MIN_AGE_MS).toISOString();
  let removed = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const { data: rows, error } = await supabase
      .from('planner_ticket_orphans')
      .select('storage_path, created_at')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      console.error(`[planner-purge] 백스톱 조회 실패: ${error.message}`);
      failed += 1;
      return removed;
    }
    if (!rows || rows.length === 0) break;

    const paths = rows.map((r) => r.storage_path);
    if (DRY_RUN) {
      console.log(`[planner-purge] (dry-run) 백스톱 ${paths.length}건 삭제 예정`);
      break;
    }

    const { error: rmErr } = await supabase.storage.from(BUCKET_FALLBACK).remove(paths);
    if (rmErr) {
      console.error(`[planner-purge] 백스톱 삭제 실패(${paths.length}건): ${rmErr.message}`);
      failed += 1;
      return removed;
    }
    removed += paths.length;
    if (rows.length < BATCH_SIZE) break;
  }

  return removed;
}

const queueResult = await purgeQueue();
console.log(`[planner-purge] 큐: 확인 ${queueResult.scanned}건 / 삭제 ${queueResult.purged}건`);

if (SKIP_BACKSTOP) {
  console.log('[planner-purge] 백스톱 건너뜀(--no-backstop)');
} else {
  const removed = await purgeBackstop();
  console.log(`[planner-purge] 백스톱: 삭제 ${removed}건 (24시간 이상 지난 미등록 파일)`);
}

if (failed > 0) {
  console.error(`[planner-purge] 실패 ${failed}건 — 위 로그 확인`);
  process.exit(1);
}
console.log('[planner-purge] 완료');

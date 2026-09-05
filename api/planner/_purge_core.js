// 플래너 티켓 고아 파일 스위퍼 — 공용 로직.
//
// 여행·티켓 삭제, 회원 탈퇴로 planner_tickets 행이 사라지면 DB 는 CASCADE 로 정리되지만
// Storage 의 실제 파일은 남는다. planner_20260904.sql 의 AFTER DELETE 트리거가 지워진 행의
// 저장 경로를 planner_orphan_objects 큐에 넣어 두고, 이 모듈이 그 큐를 비운다.
//
// 호출처 두 곳이 같은 코드를 쓴다.
//   - api/planner/purge.js             Vercel Cron(매일 1회) — 운영 경로. Vercel env 의 service_role 키를 쓴다.
//   - scripts/planner_purge_orphans.mjs 수동 실행·GitHub Actions(시크릿이 있을 때만).
// 두 경로가 겹쳐 돌아도 안전하다: Storage remove 는 멱등이고 purged_at 은 덮어써도 같은 뜻이다.

const BUCKET_FALLBACK = 'planner-tickets';
const BATCH_SIZE = 100;
const MAX_BATCHES = 50; // 한 번 실행에서 최대 5,000건
const MAX_ATTEMPTS = 5; // 이 횟수 이상 실패한 행은 건너뛴다(사람이 볼 몫)
const BACKSTOP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

function makeReport() {
  return { scanned: 0, purged: 0, backstopRemoved: 0, stuck: 0, failed: 0, partial: false, errors: [] };
}

// 서버리스 실행 시간 한도 안에서 끝내기 위한 시계. 새 배치를 시작하기 전에만 본다
// (배치 도중에는 끊지 않는다 — 파일은 지웠는데 purged_at 을 못 찍는 상태를 만들지 않기 위해).
function makeClock(deadlineMs, now) {
  const start = now();
  return {
    expired() {
      return Number.isFinite(deadlineMs) && deadlineMs > 0 && now() - start >= deadlineMs;
    },
  };
}

function pushError(report, log, message) {
  report.failed += 1;
  report.errors.push(String(message).slice(0, 300));
  log.error(`[planner-purge] ${message}`);
}

// 실패한 배치: attempts 를 1 올리고 사유를 남긴다.
// attempts 값이 같은 것끼리 묶어 한 번에 UPDATE 한다(행마다 요청을 보내지 않기 위해).
async function markFailure(supabase, rows, message, log) {
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
    if (error) log.error(`[planner-purge] attempts 기록 실패: ${error.message}`);
  }
}

async function purgeQueue(supabase, report, { dryRun, log, clock }) {
  // 삭제가 한 번이라도 실패하면 같은 배치를 계속 두드리지 않고 이번 실행을 접는다.
  // (네트워크·권한 문제라면 재시도해도 같은 결과이고, attempts 를 한 번에 소진해 버리면
  //  일시적 장애 한 번으로 모든 행이 보류 상태가 된다.)
  let abort = false;

  for (let batch = 0; batch < MAX_BATCHES && !abort; batch += 1) {
    if (clock.expired()) {
      report.partial = true;
      log.warn('[planner-purge] 시간 한도 — 남은 큐는 다음 실행에서 이어서 처리한다');
      break;
    }
    const { data: rows, error } = await supabase
      .from('planner_orphan_objects')
      .select('id, bucket_id, storage_path, attempts')
      .is('purged_at', null)
      .lt('attempts', MAX_ATTEMPTS)
      .order('queued_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      pushError(report, log, `큐 조회 실패: ${error.message}`);
      return;
    }
    if (!rows || rows.length === 0) break;
    report.scanned += rows.length;

    // 버킷별로 나눠서 지운다(현재는 planner-tickets 하나지만 컬럼이 있으므로 그대로 따른다).
    const byBucket = new Map();
    rows.forEach((row) => {
      const bucket = row.bucket_id || BUCKET_FALLBACK;
      if (!byBucket.has(bucket)) byBucket.set(bucket, []);
      byBucket.get(bucket).push(row);
    });

    for (const [bucket, bucketRows] of byBucket) {
      const paths = bucketRows.map((r) => r.storage_path);
      if (dryRun) {
        log.info(`[planner-purge] (dry-run) ${bucket}: ${paths.length}건 삭제 예정`);
        continue;
      }

      const { error: rmErr } = await supabase.storage.from(bucket).remove(paths);
      if (rmErr) {
        pushError(report, log, `${bucket} 삭제 실패(${paths.length}건): ${rmErr.message}`);
        await markFailure(supabase, bucketRows, rmErr.message, log);
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
        pushError(report, log, `purged_at 기록 실패: ${upErr.message}`);
        abort = true;
        break;
      }
      report.purged += ids.length;
    }

    if (dryRun) break; // dry-run 은 같은 배치를 계속 읽으므로 한 번만 돈다
    if (rows.length < BATCH_SIZE) break;
  }

  // 손대지 못하고 남은 행(연속 실패)이 있으면 눈에 띄게 알린다.
  const { count, error: stuckErr } = await supabase
    .from('planner_orphan_objects')
    .select('id', { count: 'exact', head: true })
    .is('purged_at', null)
    .gte('attempts', MAX_ATTEMPTS);
  if (stuckErr) {
    // 정리 자체는 끝났으니 실패로 세지 않되, 관측이 빠졌다는 사실은 남긴다.
    report.stuck = null;
    log.warn(`[planner-purge] 보류 행 집계 실패: ${stuckErr.message}`);
  } else if (count) {
    report.stuck = count;
    log.warn(`[planner-purge] ${MAX_ATTEMPTS}회 이상 실패해 보류된 행: ${count}건 (확인 필요)`);
  }
}

// 백스톱: 큐가 잡지 못한 파일(업로드 후 메타 행이 끝내 안 생긴 경우)을 뷰에서 찾아 지운다.
// 업로드 직후의 정상 파일을 건드리지 않도록 24시간 이상 지난 것만 본다.
async function purgeBackstop(supabase, report, { dryRun, log, now, clock }) {
  const cutoff = new Date(now - BACKSTOP_MIN_AGE_MS).toISOString();

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    if (clock.expired()) {
      report.partial = true;
      log.warn('[planner-purge] 시간 한도 — 남은 백스톱은 다음 실행에서 이어서 처리한다');
      break;
    }
    const { data: rows, error } = await supabase
      .from('planner_ticket_orphans')
      .select('storage_path, created_at')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      pushError(report, log, `백스톱 조회 실패: ${error.message}`);
      return;
    }
    if (!rows || rows.length === 0) break;

    let paths = rows.map((r) => r.storage_path);
    if (dryRun) {
      log.info(`[planner-purge] (dry-run) 백스톱 ${paths.length}건 삭제 예정`);
      break;
    }

    // 조회와 삭제 사이에 티켓 행이 생겼을 수 있다(24시간 cutoff 는 확률만 낮춘다).
    // 지우기 직전에 한 번 더 참조를 확인해 등록된 파일은 빼고 지운다.
    const { data: claimed, error: claimErr } = await supabase
      .from('planner_tickets')
      .select('storage_path')
      .in('storage_path', paths);
    if (claimErr) {
      pushError(report, log, `백스톱 재확인 실패: ${claimErr.message}`);
      return;
    }
    const taken = new Set((claimed || []).map((r) => r.storage_path));
    paths = paths.filter((p) => !taken.has(p));
    if (paths.length === 0) {
      if (rows.length < BATCH_SIZE) break;
      continue;
    }

    const { error: rmErr } = await supabase.storage.from(BUCKET_FALLBACK).remove(paths);
    if (rmErr) {
      pushError(report, log, `백스톱 삭제 실패(${paths.length}건): ${rmErr.message}`);
      return;
    }
    report.backstopRemoved += paths.length;
    if (rows.length < BATCH_SIZE) break;
  }
}

// supabase 는 service_role 클라이언트여야 한다(큐 테이블·비공개 버킷·고아 뷰 모두 service_role 전용).
// deadlineMs: 이 시간이 지나면 새 배치를 시작하지 않고 partial=true 로 돌려준다(서버리스 한도 대비).
export async function runPurge(
  supabase,
  { dryRun = false, skipBackstop = false, log = console, now = Date.now(), deadlineMs = 0, clockNow = Date.now } = {}
) {
  const report = makeReport();
  report.dryRun = dryRun;
  const clock = makeClock(deadlineMs, clockNow);

  await purgeQueue(supabase, report, { dryRun, log, clock });
  log.info(`[planner-purge] 큐: 확인 ${report.scanned}건 / 삭제 ${report.purged}건`);

  if (skipBackstop) {
    log.info('[planner-purge] 백스톱 건너뜀');
  } else if (report.failed > 0) {
    // 큐 단계가 Storage·DB 장애로 실패했으면 백스톱도 같은 장애를 만난다. 오류를 두 배로 남기지 않는다.
    log.warn('[planner-purge] 큐 단계 실패 — 백스톱은 이번 실행에서 건너뛴다');
  } else {
    await purgeBackstop(supabase, report, { dryRun, log, now, clock });
    log.info(`[planner-purge] 백스톱: 삭제 ${report.backstopRemoved}건 (24시간 이상 지난 미등록 파일)`);
  }

  if (report.failed > 0) log.error(`[planner-purge] 실패 ${report.failed}건 — 위 로그 확인`);
  return report;
}

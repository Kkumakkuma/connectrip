// 게시판 사진 고아 파일 정리 — api/planner/purge.js?task=images 가 부른다(2026-09-26 쿠마님 지시:
// 올렸다가 지운 사진·쓰다 취소한 글의 사진·바꾼 프로필 사진을 서버에 계속 두지 않는다).
//
// 대상: 공개 버킷 images, 비공개 버킷 post-images. 어느 글·임시저장·프로필·칭찬매칭에도 안 쓰이고
// 올린 지 minAgeHours(기본 72시간)가 지난 파일. 유예를 두는 이유 = 글을 쓰는 도중(저장 전) 올린 사진을 지우지 않기 위해.
// DB 가 후보를 고르고(images_orphans), 지우기 직전에 한 번 더 확인한다(images_still_orphaned) — 후보를 뽑은 뒤
// 다시 글에 붙은 사진은 지우지 않는다(codex 9/26). 두 함수 모두 service_role 전용(images_private_cleanup_20260926.sql).

export const IMAGE_BUCKETS = ['images', 'post-images'];
const BATCH_SIZE = 100;
const MAX_ROUNDS = 10; // 한 번 실행에서 최대 10,000건(후보 조회 1,000건 × 10)
export const DEFAULT_MIN_AGE_HOURS = 72;

function makeReport() {
  return { scanned: 0, removed: 0, kept: 0, failed: 0, partial: false, errors: [] };
}

function pushError(report, log, message) {
  report.failed += 1;
  report.errors.push(String(message).slice(0, 300));
  log.error(`[images-purge] ${message}`);
}

export async function runImagesPurge(supabase, {
  dryRun = false, log = console, deadlineMs = 0, now = () => Date.now(), minAgeHours = DEFAULT_MIN_AGE_HOURS,
} = {}) {
  const report = makeReport();
  const start = now();
  const expired = () => Number.isFinite(deadlineMs) && deadlineMs > 0 && now() - start >= deadlineMs;
  const age = Math.max(1, Number(minAgeHours) || DEFAULT_MIN_AGE_HOURS);
  const tried = new Set();   // 이번 실행에서 지우기에 실패한 파일은 다시 후보로 잡지 않는다(무한 반복 방지)

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (expired()) { report.partial = true; log.warn('[images-purge] 시간 한도 — 다음 실행에서 이어서 정리한다'); break; }
    const { data, error } = await supabase.rpc('images_orphans', { p_min_age: `${age} hours`, p_limit: 1000 });
    if (error) { pushError(report, log, `후보 조회 실패: ${error.message}`); break; }
    const rows = (data || []).filter((r) => IMAGE_BUCKETS.includes(r.bucket_id) && r.name && !tried.has(`${r.bucket_id}/${r.name}`));
    if (!rows.length) break;
    report.scanned += rows.length;

    for (const bucket of IMAGE_BUCKETS) {
      const names = rows.filter((r) => r.bucket_id === bucket).map((r) => r.name);
      for (let i = 0; i < names.length; i += BATCH_SIZE) {
        // 배치마다 시간 한도를 본다(배치 도중엔 끊지 않는다 — 확인과 삭제 사이를 벌리지 않게, codex 9/26)
        if (expired()) { report.partial = true; break; }
        const batch = names.slice(i, i + BATCH_SIZE);
        batch.forEach((n) => tried.add(`${bucket}/${n}`));
        // 지우기 직전 다시 확인: 그 사이 글·임시저장에 다시 붙은 사진은 남긴다
        const { data: still, error: sErr } = await supabase.rpc('images_still_orphaned', { p_bucket: bucket, p_names: batch });
        if (sErr) { pushError(report, log, `${bucket} 재확인 실패: ${sErr.message}`); continue; }
        const targets = (still || []).map((r) => r.name).filter((n) => batch.includes(n));
        report.kept += batch.length - targets.length;
        if (!targets.length) continue;
        if (dryRun) {
          log.info(`[images-purge] (dry-run) ${bucket}: ${targets.length}건 삭제 예정`);
          report.removed += targets.length;
          continue;
        }
        const { error: rErr } = await supabase.storage.from(bucket).remove(targets);
        if (rErr) { pushError(report, log, `${bucket} 삭제 실패: ${rErr.message}`); continue; }
        report.removed += targets.length;
      }
    }
    if (report.partial) { log.warn('[images-purge] 시간 한도 — 다음 실행에서 이어서 정리한다'); break; }
    if (dryRun) break;            // 미리보기는 한 바퀴만(실제로 지우지 않으니 같은 후보가 다시 나온다)
    if (rows.length < 1000) break;
  }
  return report;
}

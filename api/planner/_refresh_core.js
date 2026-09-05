// 구글 장소 카탈로그 재조회 (2026-09-05, 교차검토 agy 지적 반영).
//
// 왜: 구글 약관 3.2.3 은 place ID 만 무기한 보관을 허용하고 이름·주소·좌표 같은 콘텐츠는 30일 넘게 캐시하지 못하게 한다.
//     planner_catalog 와 사용자 핀 사본(planner_places)에는 구글에서 온 문자열이 남으므로, 25일이 지난 구글 행을
//     하루 한 번 Place Details 로 다시 받아 갱신한다(= 30일 안에 항상 새로 받은 값이 되게).
// 어디서: api/planner/purge.js 의 ?task=refresh 분기가 부른다(Vercel Hobby 함수 12개 상한이 꽉 차서 별도 함수를 못 둔다).
//         pg_cron 'planner-catalog-refresh' 가 매일 KST 03:50 에 그 경로를 호출한다.
// 예산: google_place_details 100/일(Place Details Pro 월 5,000회 무료 안). 초과·RPC 오류·키 없음·플래그 off 는 모두
//       구글을 부르지 않고 끝낸다(fail-closed).
// 결과: 갱신(refreshed) / 404·형식 불량이라 fetched_at 만 올림(touched) / 실패(failed) 를 보고서로 돌려준다.

import { googleServerKey, reserveDaily } from './_common.js';
import { placeDetailsGoogle } from './_google_places.js';

export const REFRESH_BATCH = 40;
export const DETAILS_DAILY_LIMIT = 100;
export const DETAILS_BUDGET_KEY = 'google_place_details';

export async function runCatalogRefresh(
  supabase,
  {
    key = googleServerKey(),
    log = console,
    deadlineMs = 200 * 1000,
    batch = REFRESH_BATCH,
    dailyLimit = DETAILS_DAILY_LIMIT,
    fetchImpl,
    now = Date.now,
  } = {}
) {
  const report = { enabled: false, due: 0, refreshed: 0, touched: 0, failed: 0, budget_stop: false, reason: null };
  if (!key) {
    report.reason = 'no_key';
    return report;
  }

  const { data: on, error: fErr } = await supabase.rpc('planner_google_enabled');
  if (fErr || on !== true) {
    report.reason = fErr ? 'flag_lookup_failed' : 'disabled';
    return report;
  }
  report.enabled = true;

  const { data: rows, error: dErr } = await supabase.rpc('planner_catalog_refresh_due', { p_limit: batch });
  if (dErr) {
    report.failed = 1;
    report.reason = 'due_query_failed';
    log.error('[planner/refresh] due query failed', dErr.code || dErr.message || '');
    return report;
  }
  const list = Array.isArray(rows) ? rows : [];
  report.due = list.length;

  const started = now();
  for (const row of list) {
    if (now() - started > deadlineMs) {
      report.reason = 'deadline';
      break;
    }
    // 예산은 구글을 실제로 부르기 직전에 한 건씩 예약한다. 남은 행은 내일 잡이 이어서 본다.
    if (!(await reserveDaily(supabase, DETAILS_BUDGET_KEY, dailyLimit))) {
      report.budget_stop = true;
      break;
    }

    const r = await placeDetailsGoogle({ placeId: row.provider_place_id, key, fetchImpl });
    let args;
    if (r.ok) {
      args = { p_id: row.id, p_name: r.place.name, p_address: r.place.address, p_lat: r.place.lat, p_lng: r.place.lng };
    } else if (r.reason === 'not_found' || r.reason === 'schema') {
      // 사라진 장소·읽을 수 없는 응답: 값은 건드리지 않고 fetched_at 만 올려 내일 또 두드리지 않게 한다.
      args = { p_id: row.id, p_name: null, p_address: null, p_lat: null, p_lng: null };
    } else {
      report.failed += 1;
      log.error('[planner/refresh] details failed', row.id, r.reason, r.status || '');
      continue;
    }

    const { error: aErr } = await supabase.rpc('planner_catalog_refresh_apply', args);
    if (aErr) {
      report.failed += 1;
      log.error('[planner/refresh] apply failed', row.id, aErr.code || aErr.message || '');
      continue;
    }
    if (r.ok) report.refreshed += 1;
    else report.touched += 1;
  }
  return report;
}

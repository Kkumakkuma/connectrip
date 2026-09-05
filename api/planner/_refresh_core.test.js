// 구글 카탈로그 재조회 코어 테스트 (2026-09-05. 일일 예산은 쿠마님 결정으로 없음 — 배치 상한·마감만).
import { describe, it, expect, vi } from 'vitest';
import { DETAILS_FIELD_MASK } from './_google_places.js';
import { runCatalogRefresh, REFRESH_BATCH } from './_refresh_core.js';

const gPlace = (i) => ({
  id: `ChIJ${i}`,
  displayName: { text: `새 이름 ${i}` },
  formattedAddress: `새 주소 ${i}`,
  location: { latitude: 37 + i * 0.001, longitude: 127.5 },
});
const resp = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function fakeSupabase({ enabled = true, flagError = null, due = [], dueError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'planner_google_enabled') return { data: enabled, error: flagError };
      if (name === 'planner_catalog_refresh_due') return { data: due, error: dueError };
      if (name === 'planner_catalog_refresh_apply') return { data: null, error: null };
      return { data: null, error: null };
    },
  };
}
const applies = (sb) => sb.calls.filter((c) => c.name === 'planner_catalog_refresh_apply').map((c) => c.args);

describe('runCatalogRefresh', () => {
  it('정상·404·500 이 섞인 배치: 갱신 1 / touched 1 / 실패 1, apply 인자 검증, 예산 RPC 없음', async () => {
    const sb = fakeSupabase({ due: [{ id: 'a', provider_place_id: 'ChIJ1' }, { id: 'b', provider_place_id: 'gone' }, { id: 'c', provider_place_id: 'err' }] });
    const fetchImpl = vi.fn(async (url, init) => {
      expect(init.headers['X-Goog-FieldMask']).toBe(DETAILS_FIELD_MASK);
      if (url.includes('/places/ChIJ1')) return resp(gPlace(1));
      if (url.includes('/places/gone')) return resp({}, 404);
      return resp({}, 500);
    });
    const log = { error: vi.fn() };
    const report = await runCatalogRefresh(sb, { key: 'K', log, fetchImpl });
    expect(report).toMatchObject({ enabled: true, due: 3, refreshed: 1, touched: 1, failed: 1 });
    expect(applies(sb)).toEqual([
      { p_id: 'a', p_name: '새 이름 1', p_address: '새 주소 1', p_lat: 37.001, p_lng: 127.5 },
      { p_id: 'b', p_name: null, p_address: null, p_lat: null, p_lng: null },
    ]);
    expect(sb.calls.some((c) => c.name === 'planner_daily_reserve' || c.name === 'planner_daily_hit')).toBe(false);
    expect(sb.calls.find((c) => c.name === 'planner_catalog_refresh_due').args).toEqual({ p_limit: REFRESH_BATCH });
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('플래그 off·플래그 조회 실패·키 없음은 구글은 물론 due 조회도 하지 않는다', async () => {
    const fetchImpl = vi.fn();
    let sb = fakeSupabase({ enabled: false, due: [{ id: 'a', provider_place_id: 'x' }] });
    expect((await runCatalogRefresh(sb, { key: 'K', fetchImpl })).reason).toBe('disabled');
    expect(sb.calls.some((c) => c.name === 'planner_catalog_refresh_due')).toBe(false);

    sb = fakeSupabase({ flagError: { message: 'x' } });
    expect((await runCatalogRefresh(sb, { key: 'K', fetchImpl })).reason).toBe('flag_lookup_failed');

    sb = fakeSupabase();
    expect((await runCatalogRefresh(sb, { key: '', fetchImpl })).reason).toBe('no_key');
    expect(sb.calls).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('due 조회 오류는 failed=1 로 보고, 마감(deadline)이면 남은 행을 두고 멈춘다', async () => {
    let sb = fakeSupabase({ dueError: { message: 'boom' } });
    const r1 = await runCatalogRefresh(sb, { key: 'K', log: { error: vi.fn() }, fetchImpl: vi.fn() });
    expect(r1.failed).toBe(1);
    expect(r1.reason).toBe('due_query_failed');

    sb = fakeSupabase({ due: [1, 2].map((i) => ({ id: String(i), provider_place_id: `ChIJ${i}` })) });
    let t = 0;
    const now = () => { t += 500; return t; };
    const fetchImpl = vi.fn(async () => resp(gPlace(1)));
    const r2 = await runCatalogRefresh(sb, { key: 'K', fetchImpl, now, deadlineMs: 600 });
    expect(r2.refreshed).toBe(1);
    expect(r2.reason).toBe('deadline');
  });
});

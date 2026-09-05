// /api/planner/routes 핸들러 테스트 (2026-09-05, 구글 예산 직렬화 + fail-closed).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function mockRes() {
  const res = {
    statusCode: 0,
    body: null,
    headers: {},
    status(s) { res.statusCode = s; return res; },
    json(b) { res.body = b; return res; },
    setHeader(k, v) { res.headers[k] = v; },
    end() {},
  };
  return res;
}
const leg = (i) => ({ from: { lat: 37.5 + i * 0.01, lng: 127 }, to: { lat: 37.51 + i * 0.01, lng: 127.01 } });
const post = (legs, mode = 'WALK') => ({ method: 'POST', headers: {}, body: { legs, mode } });

function fakeSupabase({ rateHits = 1, rateError = null, reserve = () => true, cacheError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ type: 'rpc', name, args });
      if (name === 'planner_rate_hit') return { data: rateHits, error: rateError };
      if (name === 'planner_daily_reserve') return { data: reserve(args.p_key), error: null };
      return { data: null, error: null };
    },
    from: (table) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: cacheError }) }) }),
      upsert: async (row) => {
        calls.push({ type: 'upsert', table, row });
        return { error: null };
      },
    }),
  };
}

async function load({ provider, supabase }) {
  vi.resetModules();
  vi.doMock('./_common.js', async () => {
    const real = await vi.importActual('./_common.js');
    return {
      ...real,
      gate: async () => ({ supabase, user: { id: 'u1' } }),
      pickProvider: async () => provider,
    };
  });
  return (await import('./routes.js')).default;
}

let savedEnv;
let fetchMock;
beforeEach(() => {
  savedEnv = { ...process.env };
  process.env.GOOGLE_MAPS_SERVER_KEY = 'server-key';
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ routes: [{ duration: '120s', distanceMeters: 500 }] }) }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  process.env = savedEnv;
  vi.unstubAllGlobals();
  vi.doUnmock('./_common.js');
  vi.resetModules();
});

const rpcNames = (sb) => sb.calls.filter((c) => c.type === 'rpc').map((c) => c.name);

describe('구글 제공자', () => {
  it('구간마다 사용자(rate_hit) → 전역(reserve) 순서로 직렬 예약 뒤 한 번 호출, 결과는 캐시에 저장', async () => {
    const sb = fakeSupabase();
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post([leg(0), leg(1)]), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.legs.map((l) => l.source)).toEqual(['google', 'google']);
    expect(rpcNames(sb)).toEqual(['planner_rate_hit', 'planner_daily_reserve', 'planner_rate_hit', 'planner_daily_reserve']);
    expect(sb.calls.find((c) => c.type === 'rpc' && c.name === 'planner_daily_reserve').args).toEqual({ p_key: 'google_routes', p_limit: 300 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sb.calls.filter((c) => c.type === 'upsert' && c.table === 'planner_route_cache')).toHaveLength(2);
  });

  it('캐시 조회 오류 구간은 예약도 호출도 없이 추정치(fail-closed)', async () => {
    const sb = fakeSupabase({ cacheError: { message: 'db down' } });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post([leg(0)]), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.legs[0].source).toBe('estimate');
    expect(rpcNames(sb)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('사용자 카운터 RPC 오류 또는 초과: 전역 예약 없이 추정치', async () => {
    let sb = fakeSupabase({ rateError: { message: 'x' } });
    let handler = await load({ provider: 'google', supabase: sb });
    let res = mockRes();
    await handler(post([leg(0)]), res);
    expect(res.body.legs[0].source).toBe('estimate');
    expect(rpcNames(sb)).toEqual(['planner_rate_hit']);

    sb = fakeSupabase({ rateHits: 201 });
    handler = await load({ provider: 'google', supabase: sb });
    res = mockRes();
    await handler(post([leg(0)]), res);
    expect(res.body.legs[0].source).toBe('estimate');
    expect(rpcNames(sb)).toEqual(['planner_rate_hit']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('전역 예산이 닫히면 남은 구간도 구글 없이 간다(예약 1회만)', async () => {
    const sb = fakeSupabase({ reserve: () => false });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post([leg(0), leg(1), leg(2)]), res);
    expect(res.body.legs.map((l) => l.source)).toEqual(['estimate', 'estimate', 'estimate']);
    expect(rpcNames(sb)).toEqual(['planner_rate_hit', 'planner_daily_reserve']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('서버 키 없음: 카운터도 안 건드리고 추정치', async () => {
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    const sb = fakeSupabase();
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post([leg(0)]), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.legs[0].source).toBe('estimate');
    expect(rpcNames(sb)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('제공자 판정 실패(null)는 503', async () => {
    const handler = await load({ provider: null, supabase: fakeSupabase() });
    const res = mockRes();
    await handler(post([leg(0)]), res);
    expect(res.statusCode).toBe(503);
  });
});

describe('OSM 제공자(회귀)', () => {
  it('구글 호출·예산 없이 추정치', async () => {
    const sb = fakeSupabase();
    const handler = await load({ provider: 'osm', supabase: sb });
    const res = mockRes();
    await handler(post([leg(0)]), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.provider).toBe('osm');
    expect(res.body.legs[0].source).toBe('estimate');
    expect(rpcNames(sb)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

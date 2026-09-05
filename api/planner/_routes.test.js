// /api/planner/routes 핸들러 테스트 (2026-09-05, 구글 분기 fail-closed. 호출 한도는 쿠마님 결정으로 없음).
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

function fakeSupabase({ cacheError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ type: 'rpc', name, args });
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
  it('구간마다 한도 RPC 없이 바로 호출, 결과는 캐시에 저장', async () => {
    const sb = fakeSupabase();
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post([leg(0), leg(1)]), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.legs.map((l) => l.source)).toEqual(['google', 'google']);
    expect(res.body.legs[0]).toMatchObject({ duration_s: 120, distance_m: 500 });
    expect(rpcNames(sb)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers['X-Goog-FieldMask']).toBe('routes.duration,routes.distanceMeters');
    expect(sb.calls.filter((c) => c.type === 'upsert' && c.table === 'planner_route_cache')).toHaveLength(2);
  });

  it('캐시 조회 오류 구간은 호출 없이 추정치(fail-closed)', async () => {
    const sb = fakeSupabase({ cacheError: { message: 'db down' } });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post([leg(0)]), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.legs[0].source).toBe('estimate');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('구글이 답을 못 주면(HTTP 오류) 추정치로 떨어지고 캐시하지 않는다', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    const sb = fakeSupabase();
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post([leg(0)]), res);
    expect(res.body.legs[0].source).toBe('estimate');
    expect(sb.calls.find((c) => c.type === 'upsert')).toBeUndefined();
  });

  it('서버 키 없음: 호출 없이 추정치(OSM 으로 갈라지지 않고 provider 는 google 그대로)', async () => {
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    const sb = fakeSupabase();
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post([leg(0)]), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.provider).toBe('google');
    expect(res.body.legs[0].source).toBe('estimate');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('클라이언트가 끊었으면 남은 구간에 구글을 부르지 않는다', async () => {
    const sb = fakeSupabase();
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    const req = post([leg(0), leg(1)]);
    fetchMock.mockImplementationOnce(async () => {
      req.aborted = true; // 첫 구간 호출 도중 연결이 끊긴 상황
      return { ok: true, status: 200, json: async () => ({ routes: [{ duration: '60s', distanceMeters: 100 }] }) };
    });
    await handler(req, res);
    expect(res.body.legs.map((l) => l.source)).toEqual(['google', 'estimate']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('좌표가 이상한 구간은 null 로 자리를 채우고, 제공자 판정 실패(null)는 503', async () => {
    let handler = await load({ provider: 'google', supabase: fakeSupabase() });
    let res = mockRes();
    await handler(post([{ from: { lat: 'x' }, to: {} }, leg(1)]), res);
    expect(res.body.legs[0]).toBeNull();
    expect(res.body.legs[1].source).toBe('google');

    handler = await load({ provider: null, supabase: fakeSupabase() });
    res = mockRes();
    await handler(post([leg(0)]), res);
    expect(res.statusCode).toBe(503);
  });
});

describe('OSM 제공자(회귀)', () => {
  it('구글 호출 없이 추정치', async () => {
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

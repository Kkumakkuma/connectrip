// /api/planner/places 핸들러 테스트 (2026-09-05, 구글 분기 + fail-closed).
// _common.js 는 실제 모듈을 쓰되 gate(로그인 관문)와 pickProvider(제공자 판정)만 바꿔 끼운다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TEXT_SEARCH_FIELD_MASK, TEXT_SEARCH_URL } from './_google_places.js';

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
const post = (q) => ({ method: 'POST', headers: {}, body: { q } });

const gPlace = (i) => ({
  id: `ChIJ${i}`,
  displayName: { text: `장소 ${i}` },
  formattedAddress: `주소 ${i}`,
  location: { latitude: 37 + i * 0.001, longitude: 127.5 },
});

function fakeSupabase({ cached = null, cacheError = null, reserve = () => true, geoSlot = 0 } = {}) {
  const calls = [];
  const supabase = {
    calls,
    rpc: async (name, args) => {
      calls.push({ type: 'rpc', name, args });
      if (name === 'planner_daily_reserve') return { data: reserve(args.p_key), error: null };
      if (name === 'planner_geo_slot') return { data: geoSlot, error: null };
      return { data: null, error: null };
    },
    from: (table) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: cached, error: cacheError }) }) }),
      upsert: async (row) => {
        calls.push({ type: 'upsert', table, row });
        return { error: null };
      },
    }),
  };
  return supabase;
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
  return (await import('./places.js')).default;
}

let savedEnv;
let fetchMock;
beforeEach(() => {
  savedEnv = { ...process.env };
  process.env.GOOGLE_MAPS_SERVER_KEY = 'server-key';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  process.env = savedEnv;
  vi.unstubAllGlobals();
  vi.doUnmock('./_common.js');
  vi.resetModules();
});

const googleOk = () => ({ ok: true, status: 200, json: async () => ({ places: [gPlace(1), gPlace(2)] }) });
const reserveKeys = (sb) => sb.calls.filter((c) => c.type === 'rpc' && c.name === 'planner_daily_reserve').map((c) => c.args.p_key);

describe('구글 분기', () => {
  it('캐시 미스: 사용자 → 전역 순서로 예약한 뒤 한 번 호출, 정규화 결과 + 캐시 저장', async () => {
    const sb = fakeSupabase();
    fetchMock.mockResolvedValue(googleOk());
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post('서울  타워'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.provider).toBe('google');
    expect(res.body.cached).toBe(false);
    expect(res.body.results.map((r) => r.provider_place_id)).toEqual(['ChIJ1', 'ChIJ2']);
    expect(reserveKeys(sb)).toEqual(['google_places:user:u1', 'google_places']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TEXT_SEARCH_URL);
    expect(init.headers['X-Goog-FieldMask']).toBe(TEXT_SEARCH_FIELD_MASK);
    expect(init.headers['X-Goog-Api-Key']).toBe('server-key');
    expect(JSON.parse(init.body).textQuery).toBe('서울 타워');
    const up = sb.calls.find((c) => c.type === 'upsert');
    expect(up.table).toBe('planner_place_search_cache');
    expect(up.row.provider).toBe('google');
  });

  it('사용자 한도 초과: 429, 전역 예약도 구글 호출도 없다', async () => {
    const sb = fakeSupabase({ reserve: (key) => !key.includes(':user:') });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post('서울타워'), res);
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('BUSY');
    expect(reserveKeys(sb)).toEqual(['google_places:user:u1']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('전역 한도 초과: 429, 구글 호출 없다', async () => {
    const sb = fakeSupabase({ reserve: (key) => key !== 'google_places' });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post('서울타워'), res);
    expect(res.statusCode).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('캐시 히트: 예약도 호출도 없이 cached:true', async () => {
    const sb = fakeSupabase({ cached: { result: [{ provider: 'google', provider_place_id: 'c' }], fetched_at: new Date().toISOString() } });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post('서울타워'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(reserveKeys(sb)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('캐시 조회 오류는 미스가 아니라 503(fail-closed)', async () => {
    const sb = fakeSupabase({ cacheError: { message: 'db down' } });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post('서울타워'), res);
    expect(res.statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reserveKeys(sb)).toEqual([]);
  });

  it('서버 키 없음: OSM 강등 없이 503, 예약도 없다', async () => {
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    const sb = fakeSupabase();
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post('서울타워'), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(reserveKeys(sb)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('구글 HTTP 오류는 502, 캐시에 저장하지 않는다', async () => {
    const sb = fakeSupabase();
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post('서울타워'), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.code).toBe('PROVIDER_ERROR');
    expect(sb.calls.find((c) => c.type === 'upsert')).toBeUndefined();
  });

  it('제공자 판정 실패(null)는 503', async () => {
    const sb = fakeSupabase();
    const handler = await load({ provider: null, supabase: sb });
    const res = mockRes();
    await handler(post('서울타워'), res);
    expect(res.statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('OSM 분기(회귀)', () => {
  it('Nominatim 호출 + 전역 슬롯, provider osm, 구글 예약 없음', async () => {
    const sb = fakeSupabase();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ lat: '37.5', lon: '127.0', display_name: '남산서울타워, 용산구', name: '남산서울타워', osm_type: 'node', osm_id: 1 }],
    });
    const handler = await load({ provider: 'osm', supabase: sb });
    const res = mockRes();
    await handler(post('서울타워'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.provider).toBe('osm');
    expect(res.body.results[0]).toMatchObject({ provider: 'osm', provider_place_id: 'node1', name: '남산서울타워' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('nominatim.openstreetmap.org');
    expect(sb.calls.some((c) => c.type === 'rpc' && c.name === 'planner_geo_slot')).toBe(true);
    expect(reserveKeys(sb)).toEqual([]);
  });

  it('두 글자 미만은 400', async () => {
    const handler = await load({ provider: 'osm', supabase: fakeSupabase() });
    const res = mockRes();
    await handler(post('a'), res);
    expect(res.statusCode).toBe(400);
  });
});

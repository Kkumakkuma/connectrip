// /api/planner/places 핸들러 테스트 (2026-09-05).
//   search(엔터) : OSM 회귀 + 구글 텍스트검색 fail-closed
//   suggest      : 카탈로그 매치(0원) + 30일 캐시 + 구글 자동완성, OSM 제공자는 400
//   details      : 카탈로그에 있으면 0원, 없으면 Details Essentials(세션 토큰 포함)
// _common.js 는 실제 모듈을 쓰되 gate(로그인 관문)와 pickProvider(제공자 판정)만 바꿔 끼운다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AUTOCOMPLETE_FIELD_MASK,
  AUTOCOMPLETE_URL,
  DETAILS_ESSENTIALS_FIELD_MASK,
  PLACES_BASE,
  TEXT_SEARCH_FIELD_MASK,
  TEXT_SEARCH_URL,
} from './_google_places.js';

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
const post = (body) => ({ method: 'POST', headers: {}, body });

const gPlace = (i) => ({
  id: `ChIJ${i}`,
  displayName: { text: `장소 ${i}` },
  formattedAddress: `주소 ${i}`,
  location: { latitude: 37 + i * 0.001, longitude: 127.5 },
});
const prediction = (i) => ({
  placePrediction: {
    placeId: `ChIJ${i}`,
    text: { text: `예측 ${i}, 도쿄` },
    structuredFormat: { mainText: { text: `예측 ${i}` }, secondaryText: { text: '도쿄, 일본' } },
  },
});

// 체이닝 가능한 가짜 쿼리. 끝에서 await 하면 list 결과, maybeSingle() 이면 single 결과.
function queryOf({ list = { data: [], error: null }, single = { data: null, error: null } }) {
  const b = {};
  for (const m of ['select', 'eq', 'ilike', 'is', 'or', 'order', 'limit', 'gt']) b[m] = () => b;
  b.maybeSingle = async () => single;
  b.then = (onOk, onErr) => Promise.resolve(list).then(onOk, onErr);
  return b;
}

function fakeSupabase({ cached = null, cacheError = null, geoSlot = 0, catalogRows = [], catalogRow = null, catalogError = null } = {}) {
  const calls = [];
  const supabase = {
    calls,
    rpc: async (name, args) => {
      calls.push({ type: 'rpc', name, args });
      if (name === 'planner_geo_slot') return { data: geoSlot, error: null };
      return { data: null, error: null };
    },
    from: (table) => {
      calls.push({ type: 'from', table });
      const q =
        table === 'planner_catalog'
          ? queryOf({ list: { data: catalogRows, error: catalogError }, single: { data: catalogRow, error: catalogError } })
          : queryOf({ single: { data: cached, error: cacheError } });
      q.upsert = async (row) => {
        calls.push({ type: 'upsert', table, row });
        return { error: null };
      };
      q.update = (row) => {
        calls.push({ type: 'update', table, row });
        const u = {};
        u.eq = () => u;
        u.then = (onOk, onErr) => Promise.resolve({ error: null }).then(onOk, onErr);
        return u;
      };
      return q;
    },
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

const rpcNames = (sb) => sb.calls.filter((c) => c.type === 'rpc').map((c) => c.name);
const upserts = (sb) => sb.calls.filter((c) => c.type === 'upsert');
const fresh = () => new Date().toISOString();
const stale = () => new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

describe('search(엔터) — 구글 텍스트검색 분기(옛 번들 호환)', () => {
  it('캐시 미스: 한도 RPC 없이 한 번 호출(필드마스크 고정), 정규화 + 캐시 저장', async () => {
    const sb = fakeSupabase();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ places: [gPlace(1), gPlace(2)] }) });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post({ q: '서울  타워' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.results.map((r) => r.provider_place_id)).toEqual(['ChIJ1', 'ChIJ2']);
    expect(rpcNames(sb)).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TEXT_SEARCH_URL);
    expect(init.headers['X-Goog-FieldMask']).toBe(TEXT_SEARCH_FIELD_MASK);
    expect(upserts(sb)[0].row.provider).toBe('google');
  });

  it('캐시 히트 → 호출 없음 / 캐시 조회 오류 → 503 / 키 없음 → 503 / HTTP 오류 → 502 / 제공자 null → 503', async () => {
    let handler = await load({ provider: 'google', supabase: fakeSupabase({ cached: { result: [{ provider_place_id: 'c' }], fetched_at: fresh() } }) });
    let res = mockRes();
    await handler(post({ q: '서울타워' }), res);
    expect(res.body.cached).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    handler = await load({ provider: 'google', supabase: fakeSupabase({ cacheError: { message: 'db down' } }) });
    res = mockRes();
    await handler(post({ q: '서울타워' }), res);
    expect(res.statusCode).toBe(503);

    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    handler = await load({ provider: 'google', supabase: fakeSupabase() });
    res = mockRes();
    await handler(post({ q: '서울타워' }), res);
    expect(res.statusCode).toBe(503);
    process.env.GOOGLE_MAPS_SERVER_KEY = 'server-key';

    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    handler = await load({ provider: 'google', supabase: fakeSupabase() });
    res = mockRes();
    await handler(post({ q: '서울타워' }), res);
    expect(res.statusCode).toBe(502);

    handler = await load({ provider: null, supabase: fakeSupabase() });
    res = mockRes();
    await handler(post({ q: '서울타워' }), res);
    expect(res.statusCode).toBe(503);
  });
});

describe('suggest(자동완성)', () => {
  it('카탈로그 매치가 먼저, 구글 예측은 중복 제거 후 뒤에. 요청 형식(세션·편향·필드마스크) + 30일 캐시 저장', async () => {
    const sb = fakeSupabase({
      catalogRows: [{ provider: 'google', provider_place_id: 'ChIJ1', name: '예측 1', address: '카탈로그 주소', lat: 35.1, lng: 139.7 }],
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ suggestions: [prediction(1), prediction(2), { queryPrediction: { text: { text: 'x' } } }] }) });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post({ mode: 'suggest', q: '예측', session: '11111111-2222-3333-4444-555555555555', bias: { lat: 35.68, lng: 139.76 } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.suggestions).toEqual([
      { provider: 'google', provider_place_id: 'ChIJ1', name: '예측 1', secondary: '카탈로그 주소', known: true, address: '카탈로그 주소', lat: 35.1, lng: 139.7 },
      { provider: 'google', provider_place_id: 'ChIJ2', name: '예측 2', secondary: '도쿄, 일본', known: false },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(AUTOCOMPLETE_URL);
    expect(init.headers['X-Goog-FieldMask']).toBe(AUTOCOMPLETE_FIELD_MASK);
    expect(JSON.parse(init.body)).toEqual({
      input: '예측',
      languageCode: 'ko',
      includeQueryPredictions: false,
      sessionToken: '11111111-2222-3333-4444-555555555555',
      locationBias: { circle: { center: { latitude: 35.68, longitude: 139.76 }, radius: 50000 } },
    });
    const up = upserts(sb)[0];
    expect(up.table).toBe('planner_place_search_cache');
    expect(up.row.provider).toBe('google');
    expect(up.row.result.map((p) => p.provider_place_id)).toEqual(['ChIJ1', 'ChIJ2']); // 캐시엔 구글 예측만
  });

  it('카탈로그 매치가 4건 차면 캐시도 구글도 보지 않고 카탈로그만 돌려준다(0원)', async () => {
    const rows = [1, 2, 3, 4].map((i) => ({ provider: 'google', provider_place_id: `ChIJ${i}`, name: `타워 ${i}`, address: null, lat: 35 + i, lng: 139 }));
    const sb = fakeSupabase({ catalogRows: rows });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post({ mode: 'suggest', q: '타워' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.suggestions.map((s) => s.provider_place_id)).toEqual(['ChIJ1', 'ChIJ2', 'ChIJ3', 'ChIJ4']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sb.calls.filter((c) => c.type === 'from' && c.table === 'planner_place_search_cache')).toEqual([]);
  });

  it('캐시 히트면 구글을 부르지 않고 카탈로그 매치와 합친다', async () => {
    const sb = fakeSupabase({
      cached: { result: [{ provider: 'google', provider_place_id: 'ChIJ9', name: '캐시 9', secondary: '' }], fetched_at: fresh() },
      catalogRows: [{ provider: 'osm', provider_place_id: 'node1', name: '남산타워', address: null, lat: 37.55, lng: 126.99 }],
    });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post({ mode: 'suggest', q: '타워' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.suggestions.map((s) => [s.provider_place_id, s.known])).toEqual([['node1', true], ['ChIJ9', false]]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upserts(sb)).toEqual([]);
  });

  it('OSM 제공자는 400, 두 글자 미만 400, 키 없음 503, 캐시 오류 503, 구글 오류 502', async () => {
    let handler = await load({ provider: 'osm', supabase: fakeSupabase() });
    let res = mockRes();
    await handler(post({ mode: 'suggest', q: '타워' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('BAD_MODE');

    handler = await load({ provider: 'google', supabase: fakeSupabase() });
    res = mockRes();
    await handler(post({ mode: 'suggest', q: '타' }), res);
    expect(res.statusCode).toBe(400);

    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    handler = await load({ provider: 'google', supabase: fakeSupabase() });
    res = mockRes();
    await handler(post({ mode: 'suggest', q: '타워' }), res);
    expect(res.statusCode).toBe(503);
    process.env.GOOGLE_MAPS_SERVER_KEY = 'server-key';

    handler = await load({ provider: 'google', supabase: fakeSupabase({ cacheError: { message: 'x' } }) });
    res = mockRes();
    await handler(post({ mode: 'suggest', q: '타워' }), res);
    expect(res.statusCode).toBe(503);

    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    handler = await load({ provider: 'google', supabase: fakeSupabase() });
    res = mockRes();
    await handler(post({ mode: 'suggest', q: '타워' }), res);
    expect(res.statusCode).toBe(502);
  });
});

describe('details(고른 후보의 좌표)', () => {
  it('카탈로그에 30일 안 행이 있으면 구글을 부르지 않는다', async () => {
    const sb = fakeSupabase({ catalogRow: { name: '카탈로그 이름', address: '주소', lat: 35.1, lng: 139.7, fetched_at: fresh() } });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post({ mode: 'details', place_id: 'ChIJ1', name: '예측 1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.place).toEqual({ provider: 'google', provider_place_id: 'ChIJ1', name: '카탈로그 이름', address: '주소', lat: 35.1, lng: 139.7, opening_hours: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('없거나 오래됐으면 Details Essentials 를 세션 토큰과 함께 한 번 부른다(이름은 예측문)', async () => {
    const sb = fakeSupabase({ catalogRow: { name: '옛 이름', address: null, lat: 1, lng: 1, fetched_at: stale() } });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'ChIJ1', location: { latitude: 35.2, longitude: 139.8 }, formattedAddress: '새 주소' }) });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post({ mode: 'details', place_id: 'ChIJ1', name: '  예측  1 ', session: 'abcdefgh-1234' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.place).toEqual({ provider: 'google', provider_place_id: 'ChIJ1', name: '예측 1', address: '새 주소', lat: 35.2, lng: 139.8, opening_hours: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${PLACES_BASE}/places/ChIJ1?languageCode=ko&sessionToken=abcdefgh-1234`);
    expect(init.headers['X-Goog-FieldMask']).toBe(DETAILS_ESSENTIALS_FIELD_MASK);
    // 오래된 행은 방금 받은 값으로 갱신해 다음부터 0원이 되게 한다(codex 지적)
    const upd = sb.calls.find((c) => c.type === 'update' && c.table === 'planner_catalog');
    expect(upd.row).toMatchObject({ address: '새 주소', lat: 35.2, lng: 139.8 });
    expect(typeof upd.row.fetched_at).toBe('string');
  });

  it('카탈로그에 없던 장소는 갱신 UPDATE 를 하지 않는다(담을 때 화면이 upsert 한다)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'ChIJ7', location: { latitude: 1, longitude: 2 } }) });
    const sb = fakeSupabase({ catalogRow: null });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post({ mode: 'details', place_id: 'ChIJ7', name: '새 곳' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.place.address).toBeNull();
    expect(sb.calls.find((c) => c.type === 'update')).toBeUndefined();
  });

  it('404 는 NOT_FOUND, 잘못된 입력 400, OSM 제공자 400, 카탈로그 조회 오류 503', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    let handler = await load({ provider: 'google', supabase: fakeSupabase() });
    let res = mockRes();
    await handler(post({ mode: 'details', place_id: 'gone', name: '사라진 곳' }), res);
    expect(res.statusCode).toBe(404);

    res = mockRes();
    await handler(post({ mode: 'details', place_id: '', name: 'x' }), res);
    expect(res.statusCode).toBe(400);

    handler = await load({ provider: 'osm', supabase: fakeSupabase() });
    res = mockRes();
    await handler(post({ mode: 'details', place_id: 'ChIJ1', name: 'x' }), res);
    expect(res.statusCode).toBe(400);

    handler = await load({ provider: 'google', supabase: fakeSupabase({ catalogError: { message: 'x' } }) });
    res = mockRes();
    await handler(post({ mode: 'details', place_id: 'ChIJ1', name: 'x' }), res);
    expect(res.statusCode).toBe(503);
  });
});

describe('OSM 분기(회귀)', () => {
  it('Nominatim 호출 + 전역 슬롯, provider osm', async () => {
    const sb = fakeSupabase();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ lat: '37.5', lon: '127.0', display_name: '남산서울타워, 용산구', name: '남산서울타워', osm_type: 'node', osm_id: 1 }],
    });
    const handler = await load({ provider: 'osm', supabase: sb });
    const res = mockRes();
    await handler(post({ q: '서울타워' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.provider).toBe('osm');
    expect(res.body.results[0]).toMatchObject({ provider: 'osm', provider_place_id: 'node1', name: '남산서울타워' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('nominatim.openstreetmap.org');
    expect(rpcNames(sb)).toEqual(['planner_geo_slot']);
  });

  it('두 글자 미만은 400', async () => {
    const handler = await load({ provider: 'osm', supabase: fakeSupabase() });
    const res = mockRes();
    await handler(post({ q: 'a' }), res);
    expect(res.statusCode).toBe(400);
  });
});

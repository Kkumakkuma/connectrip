// /api/planner/routes 핸들러 테스트 (2026-09-05). 호출 한도는 쿠마님 결정으로 없음.
//   날짜 모드(day_id): 핀을 DB 에서 읽어 계산하고 planner_save_day_legs(원자 저장, 지문 대조)로 저장. 좌표 쌍 모드: 옛 호환.
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
const post = (body) => ({ method: 'POST', headers: {}, body });
const DAY = '11111111-2222-4333-8444-555555555555';
// 서울 시청 근처 3개 핀: 1→2 는 약 0.8km(도보), 2→3 은 약 3km(대중교통)
const PINS = [
  { id: 'p1', lat: 37.5663, lng: 126.9779, sort_order: 0, created_at: '2026-09-05T00:00:00Z' },
  { id: 'p2', lat: 37.5720, lng: 126.9830, sort_order: 1, created_at: '2026-09-05T00:00:01Z' },
  { id: 'p3', lat: 37.5980, lng: 126.9850, sort_order: 2, created_at: '2026-09-05T00:00:02Z' },
];

function queryOf({ list = { data: [], error: null }, single = { data: null, error: null } }) {
  const b = {};
  for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
  b.maybeSingle = async () => single;
  b.then = (onOk, onErr) => Promise.resolve(list).then(onOk, onErr);
  return b;
}

function fakeSupabase({ cacheError = null, day = { id: DAY, user_id: 'u1' }, pins = PINS, fp = 'fp1', saveResult = true, saveError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ type: 'rpc', name, args });
      if (name === 'planner_day_places_fp') return fp === null ? { data: null, error: { message: 'x' } } : { data: fp, error: null };
      if (name === 'planner_save_day_legs') return { data: saveError ? null : saveResult, error: saveError };
      return { data: null, error: null };
    },
    from: (table) => {
      calls.push({ type: 'from', table });
      let q;
      if (table === 'planner_days') q = queryOf({ single: { data: day, error: null } });
      else if (table === 'planner_places') q = queryOf({ list: { data: pins, error: null } });
      else q = queryOf({ single: { data: null, error: cacheError } });
      q.upsert = async (row) => {
        calls.push({ type: 'upsert', table, row });
        return { error: null };
      };
      return q;
    },
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

const rpcCalls = (sb, name) => sb.calls.filter((c) => c.type === 'rpc' && (!name || c.name === name));

describe('날짜 모드(day_id)', () => {
  it('핀을 DB 순서로 읽어 구간별 수단(도보/대중교통)을 정하고 구글로 계산한 뒤 지문과 함께 원자 저장', async () => {
    const sb = fakeSupabase();
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post({ day_id: DAY }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ saved: true, mode: 'AUTO', fp: 'fp1' });
    expect(typeof res.body.computed_at).toBe('string');
    expect(res.body.legs.map((l) => [l.from, l.to, l.mode, l.source])).toEqual([[0, 1, 'WALK', 'google'], [1, 2, 'TRANSIT', 'google']]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).travelMode).toBe('TRANSIT');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).departureTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/); // 대중교통은 현지 10시 출발로 묻는다
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).departureTime).toBeUndefined(); // 도보·자동차는 없음
    expect(rpcCalls(sb, 'planner_day_places_fp')).toHaveLength(1);
    const save = rpcCalls(sb, 'planner_save_day_legs')[0].args;
    expect(save).toMatchObject({ p_day_id: DAY, p_user_id: 'u1', p_fp: 'fp1' });
    expect(save.p_legs).toMatchObject({ mode: 'AUTO', fp: 'fp1' });
    expect(save.p_legs.items).toHaveLength(2);
    expect(save.p_legs.items[1]).toMatchObject({ from: 1, to: 2 });
  });

  it('mode 를 주면 전 구간 그 수단, DB 함수가 지문 불일치로 거부하면 saved:false', async () => {
    const sb = fakeSupabase({ saveResult: false });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post({ day_id: DAY, mode: 'DRIVE' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.saved).toBe(false);
    expect(res.body.mode).toBe('DRIVE');
    expect(res.body.legs.every((l) => l.mode === 'DRIVE')).toBe(true);
    expect(rpcCalls(sb, 'planner_save_day_legs')[0].args.p_legs.mode).toBe('DRIVE');
  });

  it('저장 RPC 오류는 200 + saved:false 로 답한다(계산 결과는 화면에 쓰이게)', async () => {
    const sb = fakeSupabase({ saveError: { message: 'boom' } });
    const handler = await load({ provider: 'osm', supabase: sb });
    const res = mockRes();
    await handler(post({ day_id: DAY }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.saved).toBe(false);
    expect(res.body.legs).toHaveLength(2);
  });

  it('OSM 제공자: 구글 없이 추정치를 계산해 저장(공유·스냅샷에 "예상"으로 보이게)', async () => {
    const sb = fakeSupabase();
    const handler = await load({ provider: 'osm', supabase: sb });
    const res = mockRes();
    await handler(post({ day_id: DAY }), res);
    expect(res.body.legs.map((l) => l.source)).toEqual(['estimate', 'estimate']);
    expect(res.body.saved).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('남의 날짜·없는 날짜는 404, 잘못된 id 는 400, 지문 조회 실패는 503, 핀 1개는 빈 legs 저장', async () => {
    let handler = await load({ provider: 'osm', supabase: fakeSupabase({ day: { id: DAY, user_id: 'someone-else' } }) });
    let res = mockRes();
    await handler(post({ day_id: DAY }), res);
    expect(res.statusCode).toBe(404);

    handler = await load({ provider: 'osm', supabase: fakeSupabase({ day: null }) });
    res = mockRes();
    await handler(post({ day_id: DAY }), res);
    expect(res.statusCode).toBe(404);

    handler = await load({ provider: 'osm', supabase: fakeSupabase() });
    res = mockRes();
    await handler(post({ day_id: 'not-a-uuid' }), res);
    expect(res.statusCode).toBe(400);

    handler = await load({ provider: 'osm', supabase: fakeSupabase({ fp: null }) });
    res = mockRes();
    await handler(post({ day_id: DAY }), res);
    expect(res.statusCode).toBe(503);

    const sb = fakeSupabase({ pins: [PINS[0]] });
    handler = await load({ provider: 'osm', supabase: sb });
    res = mockRes();
    await handler(post({ day_id: DAY }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.legs).toEqual([]);
    expect(rpcCalls(sb, 'planner_save_day_legs')[0].args.p_legs.items).toEqual([]);
  });

  it('좌표가 빈 핀이 있어도 구간 인덱스를 비우지 않는다(0 추정치로 채움)', async () => {
    const sb = fakeSupabase({ pins: [PINS[0], { ...PINS[1], lat: null }, PINS[2]] });
    const handler = await load({ provider: 'osm', supabase: sb });
    const res = mockRes();
    await handler(post({ day_id: DAY }), res);
    expect(res.body.legs.map((l) => [l.from, l.to, l.duration_s])).toEqual([[0, 1, 0], [1, 2, 0]]);
  });
});

describe('좌표 쌍 모드(옛 호환) — 구글 제공자', () => {
  it('구간마다 한도 RPC 없이 바로 호출, 결과는 캐시에 저장', async () => {
    const sb = fakeSupabase();
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post({ legs: [leg(0), leg(1)], mode: 'WALK' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.legs.map((l) => l.source)).toEqual(['google', 'google']);
    expect(res.body.legs[0]).toMatchObject({ duration_s: 120, distance_m: 500 });
    expect(rpcCalls(sb)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers['X-Goog-FieldMask']).toBe('routes.duration,routes.distanceMeters');
    expect(sb.calls.filter((c) => c.type === 'upsert' && c.table === 'planner_route_cache')).toHaveLength(2);
  });

  it('캐시 조회 오류 구간은 호출 없이 추정치(fail-closed)', async () => {
    const sb = fakeSupabase({ cacheError: { message: 'db down' } });
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post({ legs: [leg(0)], mode: 'WALK' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.legs[0].source).toBe('estimate');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('구글이 답을 못 주면(HTTP 오류) 추정치로 떨어지고 캐시하지 않는다', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    const sb = fakeSupabase();
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post({ legs: [leg(0)], mode: 'WALK' }), res);
    expect(res.body.legs[0].source).toBe('estimate');
    expect(sb.calls.find((c) => c.type === 'upsert')).toBeUndefined();
  });

  it('서버 키 없음: 호출 없이 추정치(OSM 으로 갈라지지 않고 provider 는 google 그대로)', async () => {
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    const sb = fakeSupabase();
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    await handler(post({ legs: [leg(0)], mode: 'WALK' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.provider).toBe('google');
    expect(res.body.legs[0].source).toBe('estimate');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('클라이언트가 끊었으면 남은 구간에 구글을 부르지 않는다', async () => {
    const sb = fakeSupabase();
    const handler = await load({ provider: 'google', supabase: sb });
    const res = mockRes();
    const req = post({ legs: [leg(0), leg(1)], mode: 'WALK' });
    fetchMock.mockImplementationOnce(async () => {
      req.aborted = true; // 첫 구간 호출 도중 연결이 끊긴 상황
      return { ok: true, status: 200, json: async () => ({ routes: [{ duration: '60s', distanceMeters: 100 }] }) };
    });
    await handler(req, res);
    expect(res.body.legs.map((l) => l.source)).toEqual(['google', 'estimate']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('좌표가 이상한 구간은 null 로 자리를 채우고, 제공자 판정 실패(null)는 503, 빈 요청은 400', async () => {
    let handler = await load({ provider: 'google', supabase: fakeSupabase() });
    let res = mockRes();
    await handler(post({ legs: [{ from: { lat: 'x' }, to: {} }, leg(1)], mode: 'WALK' }), res);
    expect(res.body.legs[0]).toBeNull();
    expect(res.body.legs[1].source).toBe('google');

    handler = await load({ provider: null, supabase: fakeSupabase() });
    res = mockRes();
    await handler(post({ legs: [leg(0)] }), res);
    expect(res.statusCode).toBe(503);

    handler = await load({ provider: 'osm', supabase: fakeSupabase() });
    res = mockRes();
    await handler(post({}), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('OSM 제공자(회귀)', () => {
  it('좌표 쌍 모드: 구글 호출 없이 추정치', async () => {
    const sb = fakeSupabase();
    const handler = await load({ provider: 'osm', supabase: sb });
    const res = mockRes();
    await handler(post({ legs: [leg(0)], mode: 'WALK' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.provider).toBe('osm');
    expect(res.body.legs[0].source).toBe('estimate');
    expect(rpcCalls(sb)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});


describe('transitDepartureTime', () => {
  const now = Date.parse('2026-09-05T15:00:00Z'); // 한국·일본 00:00
  const fn = async () => (await import('./routes.js')).transitDepartureTime;
  it('여행 날짜의 현지 10시(경도 근사)로 묻는다', async () => {
    const f = await fn();
    expect(f('2026-10-01', 139.77, now)).toBe('2026-10-01T01:00:00.000Z'); // 도쿄 +9
    expect(f('2026-10-01', -73.98, now)).toBe('2026-10-01T15:00:00.000Z'); // 뉴욕 -5
  });
  it('날짜가 없거나 창 밖(지난 날·100일 뒤)이면 다음 현지 10시', async () => {
    const f = await fn();
    expect(f(null, 139.77, now)).toBe('2026-09-06T01:00:00.000Z');
    expect(f('2026-01-01', 139.77, now)).toBe('2026-09-06T01:00:00.000Z');
    expect(f('2027-06-01', 139.77, now)).toBe('2026-09-06T01:00:00.000Z');
    expect(f('bad', 2.35, now)).toBe('2026-09-06T10:00:00.000Z'); // 파리 +0 근사(2.35/15=0)
  });
  it('현지 10시가 이미 지났으면 다음 날', async () => {
    const f = await fn();
    const noon = Date.parse('2026-09-05T03:00:00Z'); // 도쿄 12:00
    expect(f(null, 139.77, noon)).toBe('2026-09-06T01:00:00.000Z');
  });
});

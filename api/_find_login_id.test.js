// 아이디 찾기 서버리스 함수 단위 테스트 (2026-09-05). PASS 증빙 토큰 → RPC find_login_id_by_identity → 아이디만 응답.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function mockRes() {
  const res = { statusCode: 0, body: null, headers: {}, status(s) { res.statusCode = s; return res; }, json(b) { res.body = b; return res; }, setHeader(k, v) { res.headers[k] = v; }, end() {} };
  return res;
}
const post = (body) => ({ method: 'POST', headers: {}, body });

function fakeSupabase(calls, { rows = [], rpcError = null } = {}) {
  return {
    rpc(name, args) {
      calls.push({ name, args });
      if (name === 'planner_rate_hit') return Promise.resolve({ data: 1, error: null });
      if (name === 'find_login_id_by_identity') return Promise.resolve({ data: rpcError ? null : rows, error: rpcError });
      return Promise.resolve({ data: null, error: null });
    },
  };
}
async function load(supabase) {
  vi.resetModules();
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => supabase }));
  return (await import('./_account_find_login_id.js')).default;
}
let savedEnv;
beforeEach(() => { savedEnv = { ...process.env }; Object.assign(process.env, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sk' }); });
afterEach(() => { process.env = savedEnv; vi.doUnmock('@supabase/supabase-js'); vi.resetModules(); });

describe('POST /api/find-login-id', () => {
  it('증빙이 맞으면 아이디만 돌려준다(이메일·전화 등 다른 개인정보 없음)', async () => {
    const calls = [];
    const handler = await load(fakeSupabase(calls, { rows: [{ login_id: 'kuma_01', user_type: 'traveler', created_at: '2026-09-05T00:00:00Z', email: 'leak@x.com' }] }));
    const res = mockRes();
    await handler(post({ identity_token: 'tok' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, login_id: 'kuma_01', user_type: 'traveler', created_at: '2026-09-05T00:00:00Z' });
    expect(JSON.stringify(res.body)).not.toContain('leak@x.com');
    expect(calls.find((c) => c.name === 'find_login_id_by_identity').args).toEqual({ p_identity_token: 'tok' });
  });

  it('일치 계정 없음 404, 증빙 만료 401, 증빙 누락 401(RPC 호출 없음)', async () => {
    let calls = []; let handler = await load(fakeSupabase(calls, { rows: [] }));
    let res = mockRes(); await handler(post({ identity_token: 'tok' }), res);
    expect(res.statusCode).toBe(404); expect(res.body.code).toBe('NO_ACCOUNT');

    calls = []; handler = await load(fakeSupabase(calls, { rpcError: { message: 'ERROR: IDENTITY_PROOF_INVALID at pl/pgsql' } }));
    res = mockRes(); await handler(post({ identity_token: 'tok' }), res);
    expect(res.statusCode).toBe(401); expect(res.body.code).toBe('IDENTITY_PROOF_INVALID');
    expect(JSON.stringify(res.body)).not.toContain('pl/pgsql');

    calls = []; handler = await load(fakeSupabase(calls));
    res = mockRes(); await handler(post({}), res);
    expect(res.statusCode).toBe(401); expect(res.body.code).toBe('IDENTITY_REQUIRED');
    expect(calls.find((c) => c.name === 'find_login_id_by_identity')).toBeUndefined();
  });

  it('그 외 RPC 오류는 500 + 일반 문구', async () => {
    const handler = await load(fakeSupabase([], { rpcError: { message: 'connection refused 10.0.0.3' } }));
    const res = mockRes(); await handler(post({ identity_token: 'tok' }), res);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.3');
  });
});

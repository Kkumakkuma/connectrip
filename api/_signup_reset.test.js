// 아이디 가입·비밀번호 찾기 서버리스 함수 단위 테스트 (2026-09-05 아이디 로그인 전환).
// 지키려는 것
//   · 가입은 서버가 auth.admin.createUser 로 만들고, 완료 RPC 가 실패하면 그 계정을 지운다(고아 없음).
//   · 아이디 규칙·예약어·비밀번호 규칙은 서버가 먼저 거른다. RPC 예외 문구는 고정 code 로 매핑되고 내부 원문은 새지 않는다.
//   · 비밀번호 찾기 요청은 없는 아이디에도 200(열거 방지), 확인은 원자 소비 RPC 결과대로 응답하고 성공 시 세션을 폐기한다.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeLoginId, isReservedLoginId, synthEmail, isSyntheticEmail, passwordWeak } from './_login_id.js';

const SECRET = 'test-otp-hash-secret-0123456789abcdef';

function mockRes() {
  const res = {
    statusCode: 0, body: null, headers: {},
    status(s) { res.statusCode = s; return res; },
    json(b) { res.body = b; return res; },
    setHeader(k, v) { res.headers[k] = v; },
    end() {},
  };
  return res;
}
const post = (body, headers = {}) => ({ method: 'POST', headers, body });

/** 가짜 supabase: rpc 이름별 응답 + auth.admin 호출 기록. */
function fakeSupabase(calls, opts = {}) {
  const {
    taken = false, createError = null, rpcErrors = {}, contact = undefined, issue = 'ok', consume = 'ok',
    secret = SECRET, updateError = null,
  } = opts;
  return {
    rpc(name, args) {
      calls.rpcs.push({ name, args });
      if (name === 'otp_hash_secret') return Promise.resolve({ data: secret, error: null });
      if (name === 'planner_rate_hit') return Promise.resolve({ data: 1, error: null });
      if (name === 'check_login_id_taken') return Promise.resolve({ data: taken, error: null });
      if (name === 'login_id_contact') return Promise.resolve({ data: contact === undefined ? [] : [contact], error: null });
      if (name === 'password_reset_issue') return Promise.resolve({ data: issue, error: null });
      if (name === 'password_reset_consume') return Promise.resolve({ data: consume, error: null });
      if (name === 'revoke_user_sessions') return Promise.resolve({ data: 1, error: null });
      if (rpcErrors[name]) return Promise.resolve({ data: null, error: { message: rpcErrors[name] } });
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      admin: {
        createUser: async (payload) => {
          calls.created.push(payload);
          if (createError) return { data: null, error: { message: createError } };
          return { data: { user: { id: 'user-uuid-1' } }, error: null };
        },
        deleteUser: async (id) => { calls.deleted.push(id); return { error: null }; },
        updateUserById: async (id, patch) => { calls.updated.push({ id, patch }); return { error: updateError }; },
      },
    },
  };
}
const newCalls = () => ({ rpcs: [], created: [], deleted: [], updated: [] });

async function load(path, supabase) {
  vi.resetModules();
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => supabase }));
  return (await import(path)).default;
}

let savedEnv;
beforeEach(() => {
  savedEnv = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sk', RESEND_API_KEY: 'rk', OTP_HASH_SECRET: SECRET });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'em' }) })));
});
afterEach(() => { process.env = savedEnv; vi.unstubAllGlobals(); vi.doUnmock('@supabase/supabase-js'); vi.resetModules(); });

const TRAVELER = {
  login_id: 'Kuma_01', password: 'passw0rd!', user_type: 'traveler', identity_token: 'idtok',
  email: 'Me@Gmail.com', email_otp_token: 'emtok', name: '홍길동', nickname: '쿠마', birthdate: '1990-01-01',
  phone: '01012345678', zipcode: '16000', road: '수원시', detail: '101호', referred_by: null,
  terms_agreed_at: '2026-09-05T00:00:00Z', privacy_agreed_at: '2026-09-05T00:00:00Z',
};

describe('아이디 규칙(_login_id.js)', () => {
  it('정규화·예약어·합성 주소·비밀번호 규칙', () => {
    expect(normalizeLoginId('  Kuma_01 ')).toBe('kuma_01');
    expect(normalizeLoginId('ab')).toBe('');
    expect(normalizeLoginId('has-dash')).toBe('');
    expect(normalizeLoginId('a'.repeat(21))).toBe('');
    expect(isReservedLoginId('admin')).toBe(true);
    expect(isReservedLoginId('kuma_01')).toBe(false);
    expect(synthEmail('kuma_01')).toBe('kuma_01@id.connecttrip.co.kr');
    expect(isSyntheticEmail('KUMA_01@ID.connecttrip.co.kr')).toBe(true);
    expect(isSyntheticEmail('me@gmail.com')).toBe(false);
    expect(passwordWeak('short1')).toBe(true);
    expect(passwordWeak('onlyletters')).toBe(true);
    expect(passwordWeak('12345678')).toBe(true);
    expect(passwordWeak('passw0rd')).toBe(false);
  });
});

describe('POST /api/signup', () => {
  it('여행자 가입: 합성 주소로 createUser → complete_signup_profile_admin (소문자 아이디·이메일)', async () => {
    const calls = newCalls();
    const handler = await load('./signup.js', fakeSupabase(calls));
    const res = mockRes();
    await handler(post(TRAVELER), res);
    expect(res.statusCode).toBe(200);
    expect(calls.created[0].email).toBe('kuma_01@id.connecttrip.co.kr');
    expect(calls.created[0].email_confirm).toBe(true);
    const rpc = calls.rpcs.find((r) => r.name === 'complete_signup_profile_admin');
    expect(rpc.args.p_user).toBe('user-uuid-1');
    expect(rpc.args.p_login_id).toBe('kuma_01');
    expect(rpc.args.p_email).toBe('me@gmail.com');
    expect(rpc.args.p_email_otp_token).toBe('emtok');
    expect(rpc.args.p_identity_token).toBe('idtok');
    expect(rpc.args.p_airline_email).toBeNull();
    expect(rpc.args).not.toHaveProperty('p_phone_otp_token');
    expect(calls.deleted).toHaveLength(0);
  });

  it('승무원 가입: 회사 메일·토큰만, 개인 이메일 인자는 null', async () => {
    const calls = newCalls();
    const handler = await load('./signup.js', fakeSupabase(calls));
    const res = mockRes();
    await handler(post({ ...TRAVELER, user_type: 'crew', email: undefined, email_otp_token: undefined,
      airline_email: 'Crew@KoreanAir.com', airline_name: '대한항공', airline_otp_token: 'airtok' }), res);
    expect(res.statusCode).toBe(200);
    const rpc = calls.rpcs.find((r) => r.name === 'complete_signup_profile_admin');
    expect(rpc.args.p_email).toBeNull();
    expect(rpc.args.p_airline_email).toBe('crew@koreanair.com');
    expect(rpc.args.p_airline_otp_token).toBe('airtok');
  });

  it('RPC 가 실패하면 방금 만든 계정을 지우고 고정 code 로 답한다(원문 비노출)', async () => {
    const calls = newCalls();
    const handler = await load('./signup.js', fakeSupabase(calls, { rpcErrors: { complete_signup_profile_admin: 'ERROR: IDENTITY_PROOF_INVALID (SQLSTATE P0001) at pl/pgsql line 44' } }));
    const res = mockRes();
    await handler(post(TRAVELER), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('IDENTITY_PROOF_INVALID');
    expect(JSON.stringify(res.body)).not.toContain('pl/pgsql');
    expect(calls.deleted).toEqual(['user-uuid-1']);
  });

  it('알 수 없는 RPC 오류는 500 + 일반 문구, 계정은 지운다', async () => {
    const calls = newCalls();
    const handler = await load('./signup.js', fakeSupabase(calls, { rpcErrors: { complete_signup_profile_admin: 'connection to server at 10.0.0.9 failed' } }));
    const res = mockRes();
    await handler(post(TRAVELER), res);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.9');
    expect(calls.deleted).toEqual(['user-uuid-1']);
  });

  it('서버 선검사: 아이디 형식·예약어·약한 비밀번호·증빙 누락은 계정을 만들지 않는다', async () => {
    const cases = [
      [{ ...TRAVELER, login_id: 'ab' }, 400, 'LOGIN_ID_INVALID'],
      [{ ...TRAVELER, login_id: 'admin' }, 400, 'LOGIN_ID_RESERVED'],
      [{ ...TRAVELER, password: 'weak' }, 400, 'PASSWORD_WEAK'],
      [{ ...TRAVELER, identity_token: '' }, 401, 'IDENTITY_REQUIRED'],
      [{ ...TRAVELER, email_otp_token: '' }, 401, 'OTP_PROOF_REQUIRED_EMAIL'],
      [{ ...TRAVELER, user_type: 'crew', airline_otp_token: '' }, 401, 'OTP_PROOF_REQUIRED_AIRLINE'],
      [{ ...TRAVELER, terms_agreed_at: null }, 400, 'CONSENT_REQUIRED'],
    ];
    for (const [body, status, code] of cases) {
      const calls = newCalls();
      const handler = await load('./signup.js', fakeSupabase(calls));
      const res = mockRes();
      await handler(post(body), res);
      expect(res.statusCode, code).toBe(status);
      expect(res.body.code, code).toBe(code);
      expect(calls.created, code).toHaveLength(0);
    }
  });

  it('이미 있는 아이디는 409 (선검사 또는 createUser 중복)', async () => {
    let calls = newCalls();
    let handler = await load('./signup.js', fakeSupabase(calls, { taken: true }));
    let res = mockRes();
    await handler(post(TRAVELER), res);
    expect(res.statusCode).toBe(409);
    expect(calls.created).toHaveLength(0);

    calls = newCalls();
    handler = await load('./signup.js', fakeSupabase(calls, { createError: 'A user with this email address has already been registered' }));
    res = mockRes();
    await handler(post(TRAVELER), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('LOGIN_ID_TAKEN');
  });
});

describe('POST /api/reset-password-request', () => {
  it('아이디가 있으면 챌린지 발급 + 메일 발송, 없어도 같은 200', async () => {
    let calls = newCalls();
    let handler = await load('./reset-password-request.js', fakeSupabase(calls, { contact: { user_id: 'u1', email: 'me@gmail.com' } }));
    let res = mockRes();
    await handler(post({ login_id: 'Kuma_01' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const issue = calls.rpcs.find((r) => r.name === 'password_reset_issue');
    expect(issue.args.p_user).toBe('u1');
    expect(issue.args.p_code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body).to).toEqual(['me@gmail.com']);

    calls = newCalls();
    vi.mocked(fetch).mockClear();
    handler = await load('./reset-password-request.js', fakeSupabase(calls, { contact: undefined }));
    res = mockRes();
    await handler(post({ login_id: 'nobody_99' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(calls.rpcs.find((r) => r.name === 'password_reset_issue')).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('쿨다운이면 메일을 다시 보내지 않고 200', async () => {
    const calls = newCalls();
    const handler = await load('./reset-password-request.js', fakeSupabase(calls, { contact: { user_id: 'u1', email: 'me@gmail.com' }, issue: 'cooldown' }));
    const res = mockRes();
    await handler(post({ login_id: 'kuma_01' }), res);
    expect(res.statusCode).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('형식이 틀린 아이디는 400', async () => {
    const handler = await load('./reset-password-request.js', fakeSupabase(newCalls()));
    const res = mockRes();
    await handler(post({ login_id: 'a b' }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/reset-password-confirm', () => {
  const body = { login_id: 'kuma_01', code: '123456', new_password: 'newpassw0rd' };

  it('원자 소비 ok → 비밀번호 변경 + 세션 폐기', async () => {
    const calls = newCalls();
    const handler = await load('./reset-password-confirm.js', fakeSupabase(calls, { contact: { user_id: 'u1', email: 'me@gmail.com' }, consume: 'ok' }));
    const res = mockRes();
    await handler(post(body), res);
    expect(res.statusCode).toBe(200);
    expect(calls.updated).toEqual([{ id: 'u1', patch: { password: 'newpassw0rd' } }]);
    expect(calls.rpcs.find((r) => r.name === 'revoke_user_sessions').args.p_user).toBe('u1');
    const consume = calls.rpcs.find((r) => r.name === 'password_reset_consume');
    expect(consume.args.p_code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('불일치·만료·없는 아이디는 같은 문구 400, 시도 초과는 429, 비밀번호는 바뀌지 않는다', async () => {
    for (const [opts, status, code] of [
      [{ contact: { user_id: 'u1', email: 'x@y.com' }, consume: 'mismatch' }, 400, 'OTP_INVALID'],
      [{ contact: { user_id: 'u1', email: 'x@y.com' }, consume: 'not_found' }, 400, 'OTP_INVALID'],
      [{ contact: undefined }, 400, 'OTP_INVALID'],
      [{ contact: { user_id: 'u1', email: 'x@y.com' }, consume: 'too_many_attempts' }, 429, 'TOO_MANY_ATTEMPTS'],
    ]) {
      const calls = newCalls();
      const handler = await load('./reset-password-confirm.js', fakeSupabase(calls, opts));
      const res = mockRes();
      await handler(post(body), res);
      expect(res.statusCode, code).toBe(status);
      expect(res.body.code, code).toBe(code);
      expect(calls.updated, code).toHaveLength(0);
    }
  });

  it('약한 새 비밀번호는 400 PASSWORD_WEAK (RPC 호출 없음)', async () => {
    const calls = newCalls();
    const handler = await load('./reset-password-confirm.js', fakeSupabase(calls, { contact: { user_id: 'u1', email: 'x@y.com' } }));
    const res = mockRes();
    await handler(post({ ...body, new_password: 'weak' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('PASSWORD_WEAK');
    expect(calls.rpcs.find((r) => r.name === 'password_reset_consume')).toBeUndefined();
  });
});

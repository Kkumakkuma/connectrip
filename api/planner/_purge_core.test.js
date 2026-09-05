import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runPurge } from './_purge_core.js';

// 가짜 supabase 클라이언트. 큐 테이블·고아 뷰·티켓 테이블·Storage 만 흉내 낸다.
// 실제와 같게 "Storage 에서 지워진 파일"만 고아 뷰에서 사라진다(조회만으로는 사라지지 않는다).
function fakeSupabase({
  queue = [],
  orphans = [],
  tickets = [],
  removeError = null,
  updateError = null,
  onRemove = null,
} = {}) {
  const removed = [];
  const updates = [];
  const state = {
    queue: queue.map((r) => ({ attempts: 0, purged_at: null, ...r })),
    orphans: [...orphans],
    tickets: [...tickets],
  };

  function fromQueue() {
    let filters = [];
    const chain = {
      select(cols, opts) {
        chain._head = Boolean(opts?.head);
        return chain;
      },
      is(col, val) { filters.push((r) => r[col] === val); return chain; },
      lt(col, val) { filters.push((r) => r[col] < val); return chain; },
      gte(col, val) { filters.push((r) => r[col] >= val); return chain; },
      order() { return chain; },
      limit(n) { chain._limit = n; return chain; },
      update(patch) {
        return {
          in(col, ids) {
            if (updateError) return Promise.resolve({ error: updateError });
            updates.push({ patch, ids });
            state.queue.forEach((r) => { if (ids.includes(r[col])) Object.assign(r, patch); });
            return Promise.resolve({ error: null });
          },
        };
      },
      then(resolve) {
        let rows = state.queue.filter((r) => filters.every((f) => f(r)));
        filters = [];
        if (chain._head) return resolve({ count: rows.length, error: null });
        rows = rows.slice(0, chain._limit || rows.length);
        return resolve({ data: rows, error: null });
      },
    };
    return chain;
  }

  function fromOrphans() {
    let cutoff = null;
    const chain = {
      select() { return chain; },
      lt(col, val) { cutoff = val; return chain; },
      order() { return chain; },
      limit(n) { chain._limit = n; return chain; },
      then(resolve) {
        const rows = state.orphans.filter((r) => r.created_at < cutoff).slice(0, chain._limit);
        return resolve({ data: rows, error: null });
      },
    };
    return chain;
  }

  function fromTickets() {
    return {
      select() {
        return {
          in(col, paths) {
            return Promise.resolve({ data: state.tickets.filter((t) => paths.includes(t[col])), error: null });
          },
        };
      },
    };
  }

  return {
    removed,
    updates,
    state,
    from(table) {
      if (table === 'planner_orphan_objects') return fromQueue();
      if (table === 'planner_ticket_orphans') return fromOrphans();
      if (table === 'planner_tickets') return fromTickets();
      throw new Error(`unexpected table ${table}`);
    },
    storage: {
      from(bucket) {
        return {
          remove(paths) {
            if (onRemove) onRemove(paths);
            if (removeError) return Promise.resolve({ error: removeError });
            removed.push({ bucket, paths });
            state.orphans = state.orphans.filter((o) => !paths.includes(o.storage_path));
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };
}

const silent = { info() {}, warn() {}, error() {} };
const NOW = Date.parse('2026-09-05T10:00:00Z');
const OLD = '2026-09-01T00:00:00Z'; // 24시간보다 오래된 미등록 파일
const FRESH = '2026-09-05T09:30:00Z'; // 방금 올린 파일 — 건드리면 안 된다

describe('runPurge 큐', () => {
  it('대기 행을 버킷별로 지우고 purged_at 을 찍는다', async () => {
    const sb = fakeSupabase({
      queue: [
        { id: 1, bucket_id: 'planner-tickets', storage_path: 'u/t/a.png' },
        { id: 2, bucket_id: null, storage_path: 'u/t/b.png' },
        { id: 3, bucket_id: 'planner-tickets', storage_path: 'u/t/done.png', purged_at: '2026-09-01T00:00:00Z' },
      ],
    });
    const r = await runPurge(sb, { log: silent, now: NOW });
    expect(r.failed).toBe(0);
    expect(r.partial).toBe(false);
    expect(r.scanned).toBe(2);
    expect(r.purged).toBe(2);
    // bucket_id 가 비면 기본 버킷으로 간다.
    expect(sb.removed).toEqual([{ bucket: 'planner-tickets', paths: ['u/t/a.png', 'u/t/b.png'] }]);
    expect(sb.state.queue.filter((q) => q.purged_at).map((q) => q.id)).toEqual([1, 2, 3]);
  });

  it('100건 넘는 큐는 여러 배치로 나눠 전부 처리한다', async () => {
    const queue = Array.from({ length: 101 }, (_, i) => ({ id: i + 1, storage_path: `u/t/${i}.png` }));
    const sb = fakeSupabase({ queue });
    const r = await runPurge(sb, { log: silent, now: NOW, skipBackstop: true });
    expect(r.purged).toBe(101);
    expect(sb.removed.map((b) => b.paths.length)).toEqual([100, 1]);
  });

  it('dry-run 은 아무것도 지우지 않고 큐 상태만 센다', async () => {
    const sb = fakeSupabase({
      queue: [{ id: 1, storage_path: 'u/t/a.png' }],
      orphans: [{ storage_path: 'u/t/x.png', created_at: OLD }],
    });
    const r = await runPurge(sb, { dryRun: true, log: silent, now: NOW });
    expect(r.dryRun).toBe(true);
    expect(sb.removed).toEqual([]);
    expect(sb.updates).toEqual([]);
    expect(r.purged).toBe(0);
    expect(r.backstopRemoved).toBe(0);
  });

  it('Storage 삭제 실패 시 attempts 를 올리고 이번 실행을 접는다(purged_at 없음, 백스톱도 생략)', async () => {
    const sb = fakeSupabase({
      queue: [{ id: 1, storage_path: 'u/t/a.png' }, { id: 2, storage_path: 'u/t/b.png' }],
      orphans: [{ storage_path: 'u/t/old.png', created_at: OLD }],
      removeError: { message: 'boom' },
    });
    const r = await runPurge(sb, { log: silent, now: NOW });
    expect(r.failed).toBe(1);
    expect(r.purged).toBe(0);
    expect(r.backstopRemoved).toBe(0);
    expect(r.errors[0]).toContain('boom');
    expect(sb.state.queue.every((q) => q.attempts === 1 && q.last_error === 'boom' && !q.purged_at)).toBe(true);
  });

  it('5회 이상 실패한 행은 건너뛰고 stuck 으로 보고한다', async () => {
    const sb = fakeSupabase({
      queue: [{ id: 1, storage_path: 'u/t/stuck.png', attempts: 5 }, { id: 2, storage_path: 'u/t/ok.png' }],
    });
    const r = await runPurge(sb, { log: silent, now: NOW, skipBackstop: true });
    expect(r.purged).toBe(1);
    expect(r.stuck).toBe(1);
    expect(sb.removed[0].paths).toEqual(['u/t/ok.png']);
  });

  it('purged_at 기록 실패는 failed 로 세고 멈춘다(파일은 이미 지워졌으므로 다음 실행이 다시 잡는다)', async () => {
    const sb = fakeSupabase({
      queue: [{ id: 1, storage_path: 'u/t/a.png' }],
      updateError: { message: 'db down' },
    });
    const r = await runPurge(sb, { log: silent, now: NOW, skipBackstop: true });
    expect(r.failed).toBe(1);
    expect(r.purged).toBe(0);
    expect(sb.removed.length).toBe(1);
  });

  it('시간 한도가 지나면 새 배치를 시작하지 않고 partial 로 돌려준다', async () => {
    const queue = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, storage_path: `u/t/${i}.png` }));
    const sb = fakeSupabase({ queue });
    let t = 0;
    const clockNow = () => t;
    // 첫 배치를 지우는 순간 시계를 한도 너머로 돌린다.
    const sb2 = { ...sb, storage: { from: (b) => ({ remove: (p) => { t = 10_000; return sb.storage.from(b).remove(p); } }) } };
    const r = await runPurge(sb2, { log: silent, now: NOW, deadlineMs: 5_000, clockNow, skipBackstop: true });
    expect(r.partial).toBe(true);
    expect(r.purged).toBe(100);
    expect(r.failed).toBe(0);
  });
});

describe('runPurge 백스톱', () => {
  it('24시간 넘은 미등록 파일만 지운다', async () => {
    const sb = fakeSupabase({
      orphans: [
        { storage_path: 'u/t/old.png', created_at: OLD },
        { storage_path: 'u/t/fresh.png', created_at: FRESH },
      ],
    });
    const r = await runPurge(sb, { log: silent, now: NOW });
    expect(r.backstopRemoved).toBe(1);
    expect(sb.removed).toEqual([{ bucket: 'planner-tickets', paths: ['u/t/old.png'] }]);
    expect(sb.state.orphans.map((o) => o.storage_path)).toEqual(['u/t/fresh.png']);
  });

  it('지우기 직전에 티켓 행이 생긴 파일은 건드리지 않는다', async () => {
    const sb = fakeSupabase({
      orphans: [
        { storage_path: 'u/t/old.png', created_at: OLD },
        { storage_path: 'u/t/late.png', created_at: OLD },
      ],
      tickets: [{ storage_path: 'u/t/late.png' }],
    });
    const r = await runPurge(sb, { log: silent, now: NOW });
    expect(r.backstopRemoved).toBe(1);
    expect(sb.removed).toEqual([{ bucket: 'planner-tickets', paths: ['u/t/old.png'] }]);
  });

  it('백스톱 삭제 실패는 failed 로 세고 뷰의 행은 그대로 남는다', async () => {
    const sb = fakeSupabase({
      orphans: [{ storage_path: 'u/t/old.png', created_at: OLD }],
      removeError: { message: 'storage down' },
    });
    const r = await runPurge(sb, { log: silent, now: NOW });
    expect(r.failed).toBe(1);
    expect(r.backstopRemoved).toBe(0);
    expect(sb.state.orphans.length).toBe(1);
  });
});

describe('purge handler', () => {
  let handler;
  let rpc;
  let purgeCalls;
  let purgeResult;

  beforeEach(async () => {
    vi.resetModules();
    purgeCalls = [];
    purgeResult = { scanned: 0, purged: 0, backstopRemoved: 0, stuck: 0, failed: 0, partial: false, errors: [] };
    rpc = {
      planner_rate_hit: { data: 1, error: null },
      planner_purge_secret: { data: 'db-secret-token', error: null },
    };
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({ rpc: async (name) => rpc[name] || { data: null, error: { message: `no rpc ${name}` } } }),
    }));
    vi.doMock('./_purge_core.js', () => ({
      runPurge: async (sb, opts) => {
        purgeCalls.push(opts);
        return { ...purgeResult, dryRun: !!opts.dryRun };
      },
    }));
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    delete process.env.CRON_SECRET;
    handler = (await import('./purge.js')).default;
  });

  afterEach(() => {
    vi.doUnmock('@supabase/supabase-js');
    vi.doUnmock('./_purge_core.js');
    delete process.env.CRON_SECRET;
  });

  function call({ method = 'GET', headers = {}, query = {} } = {}) {
    const res = {
      headers: {},
      statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
    return handler({ method, headers, query }, res).then(() => res);
  }

  it('GET 외 메서드는 405', async () => {
    const res = await call({ method: 'POST', headers: { authorization: 'Bearer db-secret-token' } });
    expect(res.statusCode).toBe(405);
    expect(res.body.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('Vault 토큰(RPC)으로 통과한다', async () => {
    const ok = await call({ headers: { authorization: 'Bearer db-secret-token' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.report.purged).toBe(0);
    expect(purgeCalls.length).toBe(1);
    expect(purgeCalls[0].deadlineMs).toBeGreaterThan(0);
  });

  it('토큰이 틀리거나 없으면 404, user-agent 는 보지 않는다', async () => {
    const none = await call({ headers: { 'user-agent': 'vercel-cron/1.0' } });
    expect(none.statusCode).toBe(404);
    const wrong = await call({ headers: { authorization: 'Bearer nope' } });
    expect(wrong.statusCode).toBe(404);
    // 길이만 같은 틀린 토큰도 막힌다.
    const sameLen = await call({ headers: { authorization: `Bearer ${'x'.repeat('db-secret-token'.length)}` } });
    expect(sameLen.statusCode).toBe(404);
    expect(purgeCalls.length).toBe(0);
  });

  it('CRON_SECRET 환경변수도 토큰으로 받는다(Vercel Cron 경로)', async () => {
    process.env.CRON_SECRET = 's3cret';
    const ok = await call({ headers: { authorization: 'Bearer s3cret' } });
    expect(ok.statusCode).toBe(200);
    const alsoDb = await call({ headers: { authorization: 'Bearer db-secret-token' } });
    expect(alsoDb.statusCode).toBe(200);
  });

  it('어느 쪽 토큰도 설정돼 있지 않으면 503 으로 닫힌다', async () => {
    rpc.planner_purge_secret = { data: null, error: { message: 'not found' } };
    const res = await call({ headers: { authorization: 'Bearer anything' } });
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('CRON_SECRET_MISSING');
    expect(purgeCalls.length).toBe(0);
  });

  it('레이트리밋 초과는 429', async () => {
    rpc.planner_rate_hit = { data: 4, error: null };
    const res = await call({ headers: { authorization: 'Bearer db-secret-token' } });
    expect(res.statusCode).toBe(429);
    expect(purgeCalls.length).toBe(0);
  });

  it('레이트리밋 RPC 오류는 503', async () => {
    rpc.planner_rate_hit = { data: null, error: { message: 'rpc down' } };
    const res = await call({ headers: { authorization: 'Bearer db-secret-token' } });
    expect(res.statusCode).toBe(503);
    expect(purgeCalls.length).toBe(0);
  });

  it('dry=1 은 dryRun 으로 넘긴다', async () => {
    const res = await call({ headers: { authorization: 'Bearer db-secret-token' }, query: { dry: '1' } });
    expect(res.statusCode).toBe(200);
    expect(purgeCalls[0].dryRun).toBe(true);
  });

  it('정리 실패는 500 + PURGE_FAILED + report', async () => {
    purgeResult = { ...purgeResult, failed: 1, errors: ['boom'] };
    const res = await call({ headers: { authorization: 'Bearer db-secret-token' } });
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('PURGE_FAILED');
    expect(res.body.report.errors).toEqual(['boom']);
  });

  it('환경변수가 없으면 503', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await call({ headers: { authorization: 'Bearer db-secret-token' } });
    expect(res.statusCode).toBe(503);
  });
});

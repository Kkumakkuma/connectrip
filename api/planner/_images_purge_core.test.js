import { describe, it, expect } from 'vitest';
import { runImagesPurge } from './_images_purge_core.js';

const silent = { info() {}, warn() {}, error() {} };

// 가짜 supabase: images_orphans 는 아직 저장소에 남은 후보를, images_still_orphaned 는 그중 참조 없는 것을 돌려준다.
function fake({ objects = [], referenced = new Set(), removeError = null, reRefOnCheck = new Set() } = {}) {
  const store = objects.map((o) => ({ ...o }));
  const removed = [];
  return {
    removed,
    store,
    rpc(name, args) {
      if (name === 'images_orphans') {
        const rows = store.filter((o) => !referenced.has(o.name)).slice(0, args.p_limit);
        return Promise.resolve({ data: rows.map(({ bucket_id: b, name: n }) => ({ bucket_id: b, name: n })), error: null });
      }
      if (name === 'images_still_orphaned') {
        // 후보를 뽑은 뒤 다시 참조가 붙은 경우를 흉내 낸다
        reRefOnCheck.forEach((n) => referenced.add(n));
        const rows = store.filter((o) => o.bucket_id === args.p_bucket && args.p_names.includes(o.name) && !referenced.has(o.name));
        return Promise.resolve({ data: rows.map((o) => ({ name: o.name })), error: null });
      }
      return Promise.resolve({ data: null, error: { message: 'unknown rpc' } });
    },
    storage: {
      from(bucket) {
        return {
          remove(names) {
            if (removeError) return Promise.resolve({ error: removeError });
            names.forEach((n) => {
              const i = store.findIndex((o) => o.bucket_id === bucket && o.name === n);
              if (i >= 0) store.splice(i, 1);
              removed.push(`${bucket}/${n}`);
            });
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };
}

describe('runImagesPurge', () => {
  it('참조 없는 사진만 두 버킷에서 지운다', async () => {
    const sb = fake({
      objects: [
        { bucket_id: 'images', name: 'u_1_a.jpg' },
        { bucket_id: 'images', name: 'u_1_b.jpg' },
        { bucket_id: 'post-images', name: 'u_1_c.jpg' },
      ],
      referenced: new Set(['u_1_b.jpg']),
    });
    const r = await runImagesPurge(sb, { log: silent });
    expect(sb.removed.sort()).toEqual(['images/u_1_a.jpg', 'post-images/u_1_c.jpg']);
    expect(r.removed).toBe(2);
    expect(r.failed).toBe(0);
  });

  it('후보를 뽑은 뒤 다시 참조된 사진은 지우지 않는다', async () => {
    const sb = fake({
      objects: [{ bucket_id: 'images', name: 'u_1_a.jpg' }, { bucket_id: 'images', name: 'u_1_b.jpg' }],
      reRefOnCheck: new Set(['u_1_a.jpg']),
    });
    const r = await runImagesPurge(sb, { log: silent });
    expect(sb.removed).toEqual(['images/u_1_b.jpg']);
    expect(r.kept).toBe(1);
  });

  it('미리보기(dry)는 아무것도 지우지 않는다', async () => {
    const sb = fake({ objects: [{ bucket_id: 'images', name: 'u_1_a.jpg' }] });
    const r = await runImagesPurge(sb, { log: silent, dryRun: true });
    expect(sb.removed).toEqual([]);
    expect(r.removed).toBe(1);
  });

  it('삭제 실패는 보고하고 같은 파일을 무한히 다시 잡지 않는다', async () => {
    const sb = fake({ objects: [{ bucket_id: 'images', name: 'u_1_a.jpg' }], removeError: { message: 'boom' } });
    const r = await runImagesPurge(sb, { log: silent });
    expect(r.failed).toBe(1);
    expect(r.errors[0]).toContain('boom');
    expect(sb.store).toHaveLength(1);
  });

  it('유예 시간은 1시간 밑으로 내려가지 않는다', async () => {
    let seen;
    const sb = { rpc(name, args) { seen = args; return Promise.resolve({ data: [], error: null }); } };
    await runImagesPurge(sb, { log: silent, minAgeHours: 0 });
    expect(seen.p_min_age).toBe('72 hours');
    await runImagesPurge(sb, { log: silent, minAgeHours: 0.5 });
    expect(seen.p_min_age).toBe('1 hours');
  });
});

describe('runImagesPurge 시간 한도', () => {
  it('배치마다 시간 한도를 보고 넘으면 멈춘다', async () => {
    let t = 0;
    const objects = Array.from({ length: 350 }, (_, i) => ({ bucket_id: 'images', name: `u_1_${i}.jpg` }));
    const sb = fake({ objects });
    const origRpc = sb.rpc.bind(sb);
    sb.rpc = (name, args) => { t += 60; return origRpc(name, args); };   // 요청마다 60ms 걸린다고 친다
    const r = await runImagesPurge(sb, { log: silent, deadlineMs: 100, now: () => t });
    expect(r.partial).toBe(true);
    expect(r.removed).toBeLessThan(350);
  });
});

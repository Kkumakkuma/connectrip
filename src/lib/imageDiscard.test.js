// 사람이 버린 사진 즉시 삭제(2026-09-27) — 어떤 이름을 어느 버킷에 remove 요청하는지.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = [];
let removeImpl = async () => ({ data: [], error: null });
let sessionUid = null;
vi.mock('./supabase', () => ({
    supabase: {
        auth: { getSession: async () => ({ data: { session: sessionUid ? { user: { id: sessionUid } } : null } }) },
        storage: {
            from: (bucket) => ({
                remove: async (names) => { calls.push({ bucket, names: [...names] }); return removeImpl(bucket, names); },
                download: async () => ({ data: null, error: { message: 'x' } }),
            }),
        },
    },
}));

const { diffRemoved, discardImages, discardRemoved, imageObjectsIn, objectsRemoved, storageObjectOf } = await import('./imageDiscard');
const { PUBLIC_IMAGE_PREFIX } = await import('./rich/schema');

const ME = '04cfb914-d208-4377-8604-732b25862018';
const OTHER = '16937867-3d9d-4638-ad13-936154697d99';
const nm = (uid, n, ext = 'jpg') => `${uid}_17904${String(n).padStart(8, '0')}_${'a'.repeat(32)}.${ext}`;
const PUB = 'https://owhtldabzcvavsazdufy.supabase.co/storage/v1/object/public/images/';
const pub = (name) => `${PUB}${name}`;
const priv = (name) => `sb://post-images/${name}`;

beforeEach(() => {
    calls.length = 0;
    removeImpl = async () => ({ data: [], error: null });
    sessionUid = null;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('storageObjectOf — 사진 값 → 버킷·이름', () => {
    it('비공개 참조', () => {
        expect(storageObjectOf(priv(nm(ME, 1)))).toEqual({ bucket: 'post-images', name: nm(ME, 1) });
    });
    it('우리 공개 주소(주소 앞부분은 VITE_SUPABASE_URL 기준)', () => {
        expect(storageObjectOf(`${PUBLIC_IMAGE_PREFIX}${nm(ME, 2)}`)).toEqual({ bucket: 'images', name: nm(ME, 2) });
        expect(storageObjectOf(pub(nm(ME, 2)), PUB)).toEqual({ bucket: 'images', name: nm(ME, 2) });
    });
    it('다른 사이트 주소·쿼리 붙은 주소·폴더·이름 규칙 밖·문자열 아님 → null', () => {
        expect(storageObjectOf(`https://evil.example/storage/v1/object/public/images/${nm(ME, 3)}`, PUB)).toBeNull();
        expect(storageObjectOf(`${pub(nm(ME, 3))}?t=1`, PUB)).toBeNull();
        expect(storageObjectOf(priv(`a/${nm(ME, 3)}`))).toBeNull();
        expect(storageObjectOf(priv('../etc/passwd'))).toBeNull();
        expect(storageObjectOf(priv(`${ME}.jpg`))).toBeNull();
        expect(storageObjectOf({ pendingImage: true })).toBeNull();
        expect(storageObjectOf(null)).toBeNull();
        // 공개 접두사를 모르면(빌드 설정 누락) 공개 주소는 건드리지 않는다
        expect(storageObjectOf(pub(nm(ME, 3)), '')).toBeNull();
    });
});

describe('diffRemoved / objectsRemoved / imageObjectsIn', () => {
    it('diffRemoved: 원래 있던 것 중 새 값에 없는 참조만, 순서 유지·중복 제거, 대기 사진은 무시', () => {
        const a = priv(nm(ME, 1)); const b = priv(nm(ME, 2)); const c = pub(nm(ME, 3));
        expect(diffRemoved([a, b, c, a], [b, { pendingImage: true, file: {} }])).toEqual([a, c]);
        expect(diffRemoved(a, '')).toEqual([a]);
        expect(diffRemoved([], [a])).toEqual([]);
        expect(diffRemoved(null, null)).toEqual([]);
    });
    it('imageObjectsIn: 행 전체(사진 칸·서식 문서 안)에서 찾는다', () => {
        const row = {
            id: 'r1', image_url: priv(nm(ME, 1)), image_urls: [priv(nm(ME, 1)), priv(nm(ME, 2))],
            description_doc: { v: 1, doc: { type: 'doc', content: [{ type: 'image', attrs: { src: priv(nm(ME, 5)) } }] } },
            note: `본문에 붙인 주소 ${pub(nm(ME, 6))} 끝`,
        };
        const got = imageObjectsIn([row]).map((o) => `${o.bucket}/${o.name}`);
        expect(got).toEqual(expect.arrayContaining([
            `post-images/${nm(ME, 1)}`, `post-images/${nm(ME, 2)}`, `post-images/${nm(ME, 5)}`, `images/${nm(ME, 6)}`,
        ]));
        expect(imageObjectsIn(null)).toEqual([]);
    });
    it('objectsRemoved: 원고에서 빠진 사진만(버킷까지 같아야 같은 사진)', () => {
        const prev = { image_urls: [priv(nm(ME, 1)), priv(nm(ME, 2))], image_url: priv(nm(ME, 1)) };
        const next = { image_urls: [priv(nm(ME, 2))] };
        expect(objectsRemoved(prev, next)).toEqual([{ bucket: 'post-images', name: nm(ME, 1) }]);
        expect(objectsRemoved(prev, prev)).toEqual([]);
        expect(objectsRemoved(null, next)).toEqual([]);
    });
});

describe('discardImages — remove 요청', () => {
    it('내 이름만, 버킷별로, 중복 없이', async () => {
        await discardImages([priv(nm(ME, 1)), priv(nm(ME, 1)), `${PUBLIC_IMAGE_PREFIX}${nm(ME, 2)}`, priv(nm(OTHER, 3)), 'https://kakao.example/p.jpg'], ME);
        expect(calls).toEqual([
            { bucket: 'post-images', names: [nm(ME, 1)] },
            { bucket: 'images', names: [nm(ME, 2)] },
        ]);
    });
    it('{ bucket, name } 도 받는다(글 삭제 행에서 모은 것). 모르는 버킷은 건너뛴다', async () => {
        await discardImages([{ bucket: 'images', name: nm(ME, 4) }, { bucket: 'planner-tickets', name: nm(ME, 5) }], ME);
        expect(calls).toEqual([{ bucket: 'images', names: [nm(ME, 4)] }]);
    });
    it('빈 목록·내 것 없음·로그인 없음 → 요청 없음', async () => {
        await discardImages([], ME);
        await discardImages([priv(nm(OTHER, 1))], ME);
        await discardImages([priv(nm(ME, 1))]);          // userId 없음 + 세션 없음
        expect(calls).toEqual([]);
    });
    it('userId 를 안 넘기면 로그인한 사람 기준', async () => {
        sessionUid = ME;
        await discardImages([priv(nm(ME, 1)), priv(nm(OTHER, 2))]);
        expect(calls).toEqual([{ bucket: 'post-images', names: [nm(ME, 1)] }]);
    });
    it('한 번에 100개씩 나눠 보낸다', async () => {
        const many = Array.from({ length: 205 }, (_, i) => priv(nm(ME, i + 1)));
        await discardImages(many, ME);
        expect(calls.map((c) => c.names.length)).toEqual([100, 100, 5]);
    });
    it('실패(오류 응답·예외)는 삼키고 다음 묶음을 계속 보낸다', async () => {
        let n = 0;
        removeImpl = async () => { n += 1; if (n === 1) throw new Error('network'); return { data: null, error: { message: 'denied' } }; };
        await expect(discardImages([priv(nm(ME, 1)), pub(nm(ME, 2)), `${PUBLIC_IMAGE_PREFIX}${nm(ME, 3)}`], ME)).resolves.toBeUndefined();
        expect(calls.length).toBe(2);
    });
    it('discardRemoved: 수정 저장 성공 뒤 뺀 사진만', async () => {
        await discardRemoved([priv(nm(ME, 1)), priv(nm(ME, 2))], [priv(nm(ME, 2)), priv(nm(ME, 9))], ME);
        expect(calls).toEqual([{ bucket: 'post-images', names: [nm(ME, 1)] }]);
    });
});

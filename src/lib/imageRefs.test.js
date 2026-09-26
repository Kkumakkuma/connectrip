import { describe, it, expect, vi, beforeEach } from 'vitest';

const downloads = [];
let denied = new Set();
vi.mock('./supabase', () => ({
    supabase: {
        storage: {
            from: (bucket) => ({
                download: async (name) => {
                    downloads.push(`${bucket}/${name}`);
                    if (denied.has(name)) return { data: null, error: { message: 'Object not found' } };
                    return { data: new Blob([name], { type: 'image/jpeg' }), error: null };
                },
            }),
        },
    },
}));

import { isImageRef, isPrivateRef, resolveImages, rememberUploadedImage, __resetImageRefsForTest } from './imageRefs';

let seq = 0;
beforeEach(() => {
    downloads.length = 0;
    denied = new Set();
    __resetImageRefsForTest();
    globalThis.URL.createObjectURL = vi.fn(() => `blob:test/${++seq}`);
    globalThis.URL.revokeObjectURL = vi.fn();
});

const P = (n) => `sb://post-images/${n}`;

describe('imageRefs', () => {
    it('참조 형식 판별', () => {
        expect(isPrivateRef(P('u_1_a.jpg'))).toBe(true);
        expect(isPrivateRef(P('../x'))).toBe(false);
        expect(isPrivateRef(P('a b.jpg'))).toBe(false);
        expect(isPrivateRef('https://x/a.jpg')).toBe(false);
        expect(isImageRef('https://x/a.jpg')).toBe(true);
        expect(isImageRef(P('u_1_a.jpg'))).toBe(true);
        expect(isImageRef('blob:abc')).toBe(false);
        expect(isImageRef('javascript:alert(1)')).toBe(false);
    });

    it('공개 주소는 그대로, 비공개는 로그인 권한으로 받아 메모리 주소로', async () => {
        const out = await resolveImages(['https://x/a.jpg', P('u_1_b.jpg')], 'u');
        expect(out[0]).toBe('https://x/a.jpg');
        expect(out[1]).toMatch(/^blob:/);
        expect(downloads).toEqual(['post-images/u_1_b.jpg']);
    });

    it('볼 권한이 없으면 null(빈 칸) — 서명 주소를 만들지 않는다', async () => {
        denied.add('v_1_c.jpg');
        const out = await resolveImages([P('v_1_c.jpg')], 'u');
        expect(out).toEqual([null]);
    });

    it('같은 사람은 다시 받지 않고, 계정이 바뀌면 처음부터 다시 받는다', async () => {
        await resolveImages([P('u_1_d.jpg')], 'u');
        await resolveImages([P('u_1_d.jpg')], 'u');
        expect(downloads).toHaveLength(1);
        await resolveImages([P('u_1_d.jpg')], 'other');
        expect(downloads).toHaveLength(2);
        expect(URL.revokeObjectURL).toHaveBeenCalled();
    });

    it('방금 올린 사진은 받지 않고 올린 파일로 보여준다', async () => {
        rememberUploadedImage(P('u_1_e.jpg'), new Blob(['x']), 'u');
        const out = await resolveImages([P('u_1_e.jpg')], 'u');
        expect(out[0]).toMatch(/^blob:/);
        expect(downloads).toHaveLength(0);
    });
});

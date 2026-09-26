// 지연 업로드(2026-09-27 쿠마님 "글 등록 누른 것과 임시저장 누른 것 말고는 저장하지 말라") —
// 고르기만 한 사진은 저장 버튼을 누를 때만 올라가고, 실패하면 이번에 올린 것을 바로 지운다.
import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: { storage: { from: () => ({}) }, auth: { getSession: async () => ({ data: {} }) } } }));

const {
    imageItemKey, isImageUploadError, isPendingImage, isSaveCancelled, makePendingImage, notifySaveError, pendingIn, pendingSignature,
    replacePending, replacePendingInForm, saveErrorMessage, saveWithImages, uploadPendingImages, PHOTO_UPLOAD_MESSAGE,
} = await import('./pendingImages');
const { DRAFT_SPECS } = await import('./draftForms');

const file = (name) => ({ name, type: 'image/jpeg', size: 10 });
const REF = (n) => `sb://post-images/u_${n}.jpg`;

describe('대기 사진 값', () => {
    it('만들기·판별·키', () => {
        const a = makePendingImage(file('a'), 'post-images');
        const b = makePendingImage(file('b'));
        expect(isPendingImage(a)).toBe(true);
        expect(a.bucket).toBe('post-images');
        expect(b.bucket).toBe('images');
        expect(a.key).not.toBe(b.key);
        expect(imageItemKey(a)).toBe(a.key);
        expect(imageItemKey(REF(1))).toBe(REF(1));
        expect(isPendingImage(REF(1))).toBe(false);
        expect(isPendingImage({ pendingImage: true })).toBe(false);   // 파일 없는 객체는 아니다
        expect(isPendingImage(null)).toBe(false);
    });
    it('pendingIn: 칸 순서·목록 순서대로, 한 장 칸도', () => {
        const a = makePendingImage(file('a')); const b = makePendingImage(file('b')); const c = makePendingImage(file('c'));
        const form = { image_urls: [REF(1), a, REF(2), b], image_url: c, title: 'x' };
        expect(pendingIn(form, ['image_urls', 'image_url'])).toEqual([a, b, c]);
        expect(pendingIn(form, [])).toEqual([]);
        expect(pendingSignature(form, ['image_urls'])).toBe(`${a.key},${b.key}`);
        expect(pendingSignature({ image_urls: [REF(1)] }, ['image_urls'])).toBe('');
    });
    it('replacePending: 순서 유지, map 에 없는 대기 사진은 그대로', () => {
        const a = makePendingImage(file('a')); const b = makePendingImage(file('b'));
        const map = new Map([[a.key, REF(9)]]);
        expect(replacePending([REF(1), a, b], map)).toEqual([REF(1), REF(9), b]);
        expect(replacePending(a, map)).toBe(REF(9));
        expect(replacePending('', map)).toBe('');
        const form = { image_urls: [a], title: 't' };
        const next = replacePendingInForm(form, ['image_urls', 'nope'], map);
        expect(next).toEqual({ image_urls: [REF(9)], title: 't' });
        expect(form.image_urls[0]).toBe(a);                                // 원래 폼은 그대로
        expect(replacePendingInForm(form, ['image_urls'], new Map())).toBe(form);
    });
    it('임시저장 데이터에는 대기 사진이 들어가지 않는다(참조만)', () => {
        const a = makePendingImage(file('a'), 'post-images');
        const data = DRAFT_SPECS.qna.toData({ title: 't', content: 'c', image_urls: [REF(1), a], region_id: 'asia', is_private: false });
        expect(data.image_urls).toEqual([REF(1)]);
        expect(JSON.stringify(data)).not.toContain('pending');
        expect(DRAFT_SPECS.qna.imageKeys).toEqual(['image_urls']);
        expect(DRAFT_SPECS.promo.imageKeys).toEqual(['image_url']);
        expect(DRAFT_SPECS.market.imageKeys).toEqual(['image_url']);
        expect(DRAFT_SPECS.listing.imageKeys).toEqual(['images']);
        expect(DRAFT_SPECS.crew.imageKeys).toEqual(['image_urls']);
        expect(DRAFT_SPECS.destination.imageKeys).toEqual(['image_urls']);
        expect(DRAFT_SPECS.companion.imageKeys).toEqual([]);
        expect(DRAFT_SPECS.promo.toData({ title: 't', content: '', image_url: a, is_private: false }).image_url).toBe('');
    });
});

describe('uploadPendingImages', () => {
    it('순서대로 올리고 진행을 알린다', async () => {
        const a = makePendingImage(file('a'), 'post-images'); const b = makePendingImage(file('b'), 'images');
        const upload = vi.fn(async (f, { bucket }) => `${bucket}:${f.name}`);
        const progress = [];
        const out = await uploadPendingImages([a, b], { userId: 'u', upload, onProgress: (p) => progress.push(p), discard: vi.fn() });
        expect(upload.mock.calls.map((c) => [c[0].name, c[1]])).toEqual([['a', { userId: 'u', bucket: 'post-images' }], ['b', { userId: 'u', bucket: 'images' }]]);
        expect(out.uploaded).toEqual(['post-images:a', 'images:b']);
        expect(out.map.get(a.key)).toBe('post-images:a');
        expect(progress).toEqual([{ done: 0, total: 2 }, { done: 1, total: 2 }, { done: 2, total: 2 }]);
    });
    it('중간에 실패하면 이번에 올린 것을 지우고 IMAGE_UPLOAD_FAILED', async () => {
        const list = [makePendingImage(file('a')), makePendingImage(file('b')), makePendingImage(file('c'))];
        const upload = vi.fn(async (f) => { if (f.name === 'c') throw new Error('net'); return `ref:${f.name}`; });
        const discard = vi.fn();
        const err = await uploadPendingImages(list, { userId: 'u', upload, discard }).catch((e) => e);
        expect(isImageUploadError(err)).toBe(true);
        expect(discard).toHaveBeenCalledWith(['ref:a', 'ref:b'], 'u');
        expect(saveErrorMessage(err, '기본')).toBe(PHOTO_UPLOAD_MESSAGE);
        expect(saveErrorMessage(new Error('db'), '기본')).toBe('기본');
    });
    it('첫 장부터 실패하면 지울 것도 없다', async () => {
        const discard = vi.fn();
        const err = await uploadPendingImages([makePendingImage(file('a'))], { userId: 'u', upload: async () => { throw new Error('x'); }, discard }).catch((e) => e);
        expect(isImageUploadError(err)).toBe(true);
        expect(discard).not.toHaveBeenCalled();
    });
});

describe('saveWithImages — 저장 한 번', () => {
    it('대기 사진을 올린 참조로 바꾼 폼을 save 에 넘긴다', async () => {
        const a = makePendingImage(file('a'), 'post-images');
        const form = { title: 't', image_urls: [REF(1), a] };
        const save = vi.fn(async (f) => ({ id: 'p1', imgs: f.image_urls }));
        const discard = vi.fn();
        const out = await saveWithImages({ form, keys: ['image_urls'], userId: 'u', upload: async () => REF(7), discard }, save);
        expect(save).toHaveBeenCalledWith({ title: 't', image_urls: [REF(1), REF(7)] });
        expect(out.result).toEqual({ id: 'p1', imgs: [REF(1), REF(7)] });
        expect(out.form.image_urls).toEqual([REF(1), REF(7)]);
        expect(out.uploaded).toEqual([REF(7)]);
        expect(discard).not.toHaveBeenCalled();
    });
    it('글 저장이 실패하면 이번에 올린 사진을 바로 지우고 오류를 그대로 던진다', async () => {
        const form = { image_urls: [makePendingImage(file('a')), REF(1)] };
        const discard = vi.fn();
        const boom = new Error('insert failed');
        const err = await saveWithImages({ form, keys: ['image_urls'], userId: 'u', upload: async () => REF(8), discard }, async () => { throw boom; }).catch((e) => e);
        expect(err).toBe(boom);
        expect(discard).toHaveBeenCalledWith([REF(8)], 'u');       // 원래 있던 REF(1) 은 건드리지 않는다
    });
    it('업로드가 실패하면 save 를 부르지 않는다', async () => {
        const save = vi.fn();
        const err = await saveWithImages({ form: { image_urls: [makePendingImage(file('a'))] }, keys: ['image_urls'], userId: 'u', upload: async () => { throw new Error('x'); }, discard: vi.fn() }, save).catch((e) => e);
        expect(isImageUploadError(err)).toBe(true);
        expect(save).not.toHaveBeenCalled();
    });
    it('대기 사진이 없으면 올리지 않고, 실패해도 지울 것이 없다', async () => {
        const upload = vi.fn(); const discard = vi.fn();
        const form = { image_urls: [REF(1)] };
        const out = await saveWithImages({ form, keys: ['image_urls'], userId: 'u', upload, discard }, async (f) => f);
        expect(out.form).toBe(form);
        expect(upload).not.toHaveBeenCalled();
        await saveWithImages({ form, keys: ['image_urls'], userId: 'u', upload, discard }, async () => { throw new Error('x'); }).catch(() => {});
        expect(discard).not.toHaveBeenCalled();
    });
});

describe('창을 닫으면 멈춘다(isCancelled) — "창을 끈 것도 사람이 끈 거다"', () => {
    it('올리는 도중 닫히면 남은 사진은 올리지 않고, 올린 것을 지우고, 저장하지 않는다', async () => {
        let closed = false;
        const upload = vi.fn(async (f) => { closed = true; return `ref:${f.name}`; });   // 첫 장을 올리는 사이 창이 닫힘
        const discard = vi.fn();
        const save = vi.fn();
        const form = { image_urls: [makePendingImage(file('a')), makePendingImage(file('b'))] };
        const err = await saveWithImages({ form, keys: ['image_urls'], userId: 'u', upload, discard, isCancelled: () => closed }, save).catch((e) => e);
        expect(isSaveCancelled(err)).toBe(true);
        expect(upload).toHaveBeenCalledTimes(1);
        expect(discard).toHaveBeenCalledWith(['ref:a'], 'u');
        expect(save).not.toHaveBeenCalled();
    });
    it('사진이 없어도 저장 요청 전에 닫혔으면 저장하지 않는다', async () => {
        const save = vi.fn();
        const discard = vi.fn();
        const err = await saveWithImages({ form: { image_urls: [REF(1)] }, keys: ['image_urls'], userId: 'u', discard, isCancelled: () => true }, save).catch((e) => e);
        expect(isSaveCancelled(err)).toBe(true);
        expect(save).not.toHaveBeenCalled();
        expect(discard).not.toHaveBeenCalled();
    });
    it('취소는 알리지 않고, 다른 실패는 알린다', () => {
        const alert = vi.fn();
        vi.stubGlobal('alert', alert);
        const cancelled = Object.assign(new Error('IMAGE_SAVE_CANCELLED'), { code: 'IMAGE_SAVE_CANCELLED' });
        notifySaveError(cancelled, '기본');
        expect(alert).not.toHaveBeenCalled();
        notifySaveError(new Error('db'), '기본');
        expect(alert).toHaveBeenCalledWith('기본');
        vi.unstubAllGlobals();
    });
});

import { describe, expect, it } from 'vitest';
import { BODY_MAX, IMAGES_MAX, TIP_MAX, TITLE_MAX, bodyMaxOf, imagesOf, imagesPatch } from './postLimits';
import { BOARDS } from './boards';

describe('postLimits', () => {
    it('게시판별 본문 한도(2026-09-26)', () => {
        expect(TITLE_MAX).toBe(100);
        expect(bodyMaxOf('review')).toBe(20000);
        expect(bodyMaxOf('qna')).toBe(20000);
        expect(bodyMaxOf('free')).toBe(20000);
        expect(bodyMaxOf('crew')).toBe(20000);
        expect(bodyMaxOf('companion')).toBe(5000);
        expect(bodyMaxOf('destination')).toBe(200);
        expect(TIP_MAX).toBe(20000);
        expect(IMAGES_MAX).toBe(20);
    });
    it('모든 게시판 키에 한도가 있다(새 게시판을 추가하면 여기서 걸린다)', () => {
        for (const key of Object.keys(BOARDS)) expect(BODY_MAX[key], key).toBeGreaterThan(0);
    });
    it('imagesOf: image_urls 우선, 비면 옛 image_url 한 장, 둘 다 없으면 빈 배열', () => {
        expect(imagesOf({ image_urls: ['https://a/1', 'https://a/2'], image_url: 'https://a/1' })).toEqual(['https://a/1', 'https://a/2']);
        expect(imagesOf({ image_urls: [], image_url: 'https://a/old' })).toEqual(['https://a/old']);
        expect(imagesOf({ image_url: 'https://a/old' })).toEqual(['https://a/old']);
        expect(imagesOf({ image_urls: null, image_url: null })).toEqual([]);
        expect(imagesOf(null)).toEqual([]);
        expect(imagesOf({ image_urls: ['https://a/1', '', null, 'https://a/1'] })).toEqual(['https://a/1']);
    });
    it('imagesPatch: 대표 = 첫 장, 20장까지, 사진 없으면 image_url 도 비운다', () => {
        expect(imagesPatch(['https://a/1', 'https://a/2'])).toEqual({ image_urls: ['https://a/1', 'https://a/2'], image_url: 'https://a/1' });
        expect(imagesPatch([])).toEqual({ image_urls: [], image_url: null });
        expect(imagesPatch(undefined)).toEqual({ image_urls: [], image_url: null });
        const many = Array.from({ length: 30 }, (_, i) => `https://a/${i}`);
        expect(imagesPatch(many).image_urls).toHaveLength(20);
    });
    it('사진 여러 장 게시판 = 후기·CREW·추천지', () => {
        expect(Object.values(BOARDS).filter((b) => b.imagesField).map((b) => b.key).sort()).toEqual(['crew', 'destination', 'review']);
    });
});

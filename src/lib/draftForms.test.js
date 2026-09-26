import { describe, expect, it } from 'vitest';
import { DRAFT_SPECS } from './draftForms';
import { draftErrorMessage, draftTitle } from './postDrafts';

describe('DRAFT_SPECS', () => {
    it('저장은 허용한 칸만, 타입을 맞춰 옮긴다', () => {
        const d = DRAFT_SPECS.qna.toData({ title: '제목', content: 7, image_urls: ['blob:abc', 'https://a/1.jpg'], region_id: 'asia', is_private: 'yes', hacker: 'x' });
        expect(d).toEqual({ title: '제목', content: '7', image_urls: ['https://a/1.jpg'], region_id: 'asia', is_private: true, image_url: 'https://a/1.jpg' });
    });
    it('불러오기는 폼 전체를 기본값 포함으로 돌려준다(이전 원고 값이 섞이지 않게)', () => {
        expect(DRAFT_SPECS.qna.fromData({ title: 'B' })).toEqual({ title: 'B', content: '', image_urls: [], region_id: '', is_private: false });
        expect(DRAFT_SPECS.listing.fromData(null)).toEqual(DRAFT_SPECS.listing.empty);
    });
    it('장터: 가격은 숫자만, 거래 유형은 둘 중 하나, 사진은 http 주소 5장까지', () => {
        const d = DRAFT_SPECS.listing.fromData({
            price: '12,000원', transactionType: 'evil',
            images: ['https://a/1.jpg', 'blob:x', 3, 'https://a/2.jpg', 'https://a/3', 'https://a/4', 'https://a/5', 'https://a/6'],
        });
        expect(d.price).toBe('12000');
        expect(d.transactionType).toBe('direct');
        expect(d.images).toEqual(['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3', 'https://a/4', 'https://a/5']);
    });
    it('사진 여러 장(2026-09-26): 20장까지, 중복 제거, 옛 원고의 image_url 한 장은 목록으로 옮긴다', () => {
        const many = Array.from({ length: 25 }, (_, i) => `https://a/${i}.jpg`);
        expect(DRAFT_SPECS.qna.fromData({ image_urls: many }).image_urls).toHaveLength(20);
        expect(DRAFT_SPECS.crew.fromData({ image_urls: ['https://a/1', 'https://a/1', 'https://a/2'] }).image_urls).toEqual(['https://a/1', 'https://a/2']);
        expect(DRAFT_SPECS.qna.fromData({ title: '옛 원고', image_url: 'https://a/old.jpg' }).image_urls).toEqual(['https://a/old.jpg']);
        expect(DRAFT_SPECS.destination.fromData({ name: '옛 추천지', image_url: 'https://a/old.jpg' }).image_urls).toEqual(['https://a/old.jpg']);
        // 새 형식이 있으면 옛 칸은 무시하고, 옛 칸 자체는 폼에 남기지 않는다
        const d = DRAFT_SPECS.qna.fromData({ image_urls: [], image_url: 'https://a/old.jpg' });
        expect(d.image_urls).toEqual([]);
        expect('image_url' in d).toBe(false);
        expect(DRAFT_SPECS.crew.isBlank({ ...DRAFT_SPECS.crew.empty, image_urls: ['https://a/1'] })).toBe(false);
    });
    it('저장 데이터에는 대표(첫 장)를 image_url 로도 남긴다 — 전환 전 화면이 열어도 대표 사진 유지', () => {
        expect(DRAFT_SPECS.destination.toData({ ...DRAFT_SPECS.destination.empty, image_urls: ['https://a/2', 'https://a/3'] }).image_url).toBe('https://a/2');
        expect(DRAFT_SPECS.qna.toData(DRAFT_SPECS.qna.empty).image_url).toBe('');
        // 새 원고를 다시 불러오면 image_urls 가 그대로 쓰이고 폼에 image_url 칸은 생기지 않는다
        const saved = DRAFT_SPECS.qna.toData({ ...DRAFT_SPECS.qna.empty, image_urls: ['https://a/2', 'https://a/3'] });
        const back = DRAFT_SPECS.qna.fromData(saved);
        expect(back.image_urls).toEqual(['https://a/2', 'https://a/3']);
        expect('image_url' in back).toBe(false);
    });
    it('동행: 날짜 형식이 아니면 비운다', () => {
        expect(DRAFT_SPECS.companion.fromData({ date: '내일' }).date).toBe('');
        expect(DRAFT_SPECS.companion.fromData({ date: '2026-10-01' }).date).toBe('2026-10-01');
    });
    it('같은 편: 1000자까지', () => {
        expect(DRAFT_SPECS.flight.fromData({ content: 'a'.repeat(1200) }).content.length).toBe(1000);
    });
    it('빈 원고 판정: 말머리·분류·공개 설정만 고른 건 빈 원고', () => {
        expect(DRAFT_SPECS.qna.isBlank({ ...DRAFT_SPECS.qna.empty, region_id: 'asia', is_private: true })).toBe(true);
        expect(DRAFT_SPECS.crew.isBlank({ ...DRAFT_SPECS.crew.empty, category: 'hotel' })).toBe(true);
        expect(DRAFT_SPECS.listing.isBlank({ ...DRAFT_SPECS.listing.empty, images: ['https://a/1'] })).toBe(false);
        expect(DRAFT_SPECS.companion.isBlank({ ...DRAFT_SPECS.companion.empty, members: '3' })).toBe(false);
    });
});

describe('draftTitle / draftErrorMessage', () => {
    it('제목 → 장소명 → 본문 앞 30자 → 제목 없음', () => {
        expect(draftTitle({ title: '  오사카  동행 ' })).toBe('오사카 동행');
        expect(draftTitle({ name: '숨은 카페' })).toBe('숨은 카페');
        expect(draftTitle({ content: '가'.repeat(40) })).toBe('가'.repeat(30));
        expect(draftTitle({})).toBe('제목 없음');
    });
    it('한도·용량·그 밖의 오류를 나눠 안내한다', () => {
        expect(draftErrorMessage({ message: 'draft limit board' })).toContain('20개');
        expect(draftErrorMessage({ message: 'draft limit total' })).toContain('너무 많아요');
        expect(draftErrorMessage({ message: 'new row violates check constraint "post_drafts_data_check"' })).toContain('너무 길어');
        expect(draftErrorMessage(new Error('Failed to fetch'))).toContain('잠시 뒤');
    });
});

import { describe, expect, it } from 'vitest';
import { DRAFT_SPECS, isRichDraftData } from './draftForms';
import { draftErrorMessage, draftTitle } from './postDrafts';
import { validateDoc } from './rich/doc';

const UID = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-2222-3333-4444-555555555555';
const REF = (n, uid = UID) => `sb://post-images/${uid}_17000000000${n}_abc${n}.jpg`;

describe('DRAFT_SPECS', () => {
    it('저장은 허용한 칸만, 타입을 맞춰 옮긴다', () => {
        const d = DRAFT_SPECS.crew.toData({ title: '제목', content: 7, image_urls: ['blob:abc', 'https://a/1.jpg'], category: 'hotel', airline_id: 'KE', hacker: 'x' });
        expect(d).toEqual({ title: '제목', content: '7', image_urls: ['https://a/1.jpg'], category: 'hotel', airline_id: 'KE' });
    });
    it('불러오기는 폼 전체를 기본값 포함으로 돌려준다(이전 원고 값이 섞이지 않게)', () => {
        expect(DRAFT_SPECS.promo.fromData({ title: 'B' })).toEqual({ title: 'B', content: '', image_url: '', is_private: false });
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
        expect(DRAFT_SPECS.crew.fromData({ image_urls: many }).image_urls).toHaveLength(20);
        expect(DRAFT_SPECS.crew.fromData({ image_urls: ['https://a/1', 'https://a/1', 'https://a/2'] }).image_urls).toEqual(['https://a/1', 'https://a/2']);
        expect(DRAFT_SPECS.destination.fromData({ name: '옛 추천지', image_url: 'https://a/old.jpg' }).image_urls).toEqual(['https://a/old.jpg']);
        // 새 형식이 있으면 옛 칸은 무시하고, 옛 칸 자체는 폼에 남기지 않는다
        const d = DRAFT_SPECS.destination.fromData({ image_urls: [], image_url: 'https://a/old.jpg' });
        expect(d.image_urls).toEqual([]);
        expect('image_url' in d).toBe(false);
        expect(DRAFT_SPECS.crew.isBlank({ ...DRAFT_SPECS.crew.empty, image_urls: ['https://a/1'] })).toBe(false);
    });
    it('추천지 저장 데이터에는 대표(첫 장)를 image_url 로도 남긴다 — 전환 전 화면이 열어도 대표 사진 유지', () => {
        expect(DRAFT_SPECS.destination.toData({ ...DRAFT_SPECS.destination.empty, image_urls: ['https://a/2', 'https://a/3'] }).image_url).toBe('https://a/2');
        const saved = DRAFT_SPECS.destination.toData({ ...DRAFT_SPECS.destination.empty, image_urls: ['https://a/2', 'https://a/3'] });
        const back = DRAFT_SPECS.destination.fromData(saved);
        expect(back.image_urls).toEqual(['https://a/2', 'https://a/3']);
        expect('image_url' in back).toBe(false);
    });
    it('비공개 사진 참조(후기·CREW)는 남기고, 이상한 값은 버린다(2026-09-26)', () => {
        const d = DRAFT_SPECS.crew.fromData({ image_urls: ['sb://post-images/u_1_a.jpg', 'sb://post-images/../x', 'blob:y', 'javascript:1', 'https://a/1'] });
        expect(d.image_urls).toEqual(['sb://post-images/u_1_a.jpg', 'https://a/1']);
    });
    it('동행: 날짜 형식이 아니면 비운다', () => {
        expect(DRAFT_SPECS.companion.fromData({ date: '내일' }).date).toBe('');
        expect(DRAFT_SPECS.companion.fromData({ date: '2026-10-01' }).date).toBe('2026-10-01');
    });
    it('같은 편: 1000자까지', () => {
        expect(DRAFT_SPECS.flight.fromData({ content: 'a'.repeat(1200) }).content.length).toBe(1000);
    });
    it('빈 원고 판정: 말머리·분류·공개 설정만 고른 건 빈 원고', () => {
        expect(DRAFT_SPECS.crew.isBlank({ ...DRAFT_SPECS.crew.empty, category: 'hotel' })).toBe(true);
        expect(DRAFT_SPECS.listing.isBlank({ ...DRAFT_SPECS.listing.empty, images: ['https://a/1'] })).toBe(false);
        expect(DRAFT_SPECS.companion.isBlank({ ...DRAFT_SPECS.companion.empty, members: '3' })).toBe(false);
    });
});

describe('서식 원고(후기·Q&A·자유, 2026-09-27 서식 편집기 2단계)', () => {
    const spec = DRAFT_SPECS.qna;
    const env = {
        v: 1,
        doc: {
            type: 'doc',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: '첫 줄' }] },
                { type: 'image', attrs: { src: REF(1) } },
                { type: 'paragraph', content: [{ type: 'text', text: '둘째 줄' }] },
            ],
        },
    };
    it('저장 데이터 = { fmt: 2, 문서 외 칸, doc } — 평문·사진 칸(content·image_urls·image_url)을 적지 않는다', () => {
        const d = spec.toData({ title: '제목', region_id: 'asia', is_private: 'yes', content: '옛 칸', image_urls: [REF(2)], hacker: 1 }, env);
        expect(d).toEqual({ fmt: 2, title: '제목', region_id: 'asia', is_private: true, doc: env });
        expect('content' in d || 'image_urls' in d || 'image_url' in d).toBe(false);
        expect(isRichDraftData(d)).toBe(true);
        expect(isRichDraftData({ fmt: '2' })).toBe(true);
        expect(isRichDraftData({})).toBe(false);
        expect(spec.rich).toBe(true);
        expect(spec.imageKeys).toEqual([]);
    });
    it('서식 원고 불러오기: 문서를 정리해서(남의 사진·대기 키는 빠진다) 돌려준다', () => {
        const dirty = {
            fmt: 2, title: 'T', region_id: 'europe', is_private: false,
            doc: {
                v: 1,
                doc: {
                    type: 'doc',
                    content: [
                        { type: 'paragraph', content: [{ type: 'text', text: '글' }] },
                        { type: 'image', attrs: { src: REF(1) } },
                        { type: 'image', attrs: { src: REF(2, OTHER) } },          // 남의 사진
                        { type: 'image', attrs: { src: 'pending:abc:1' } },          // 올리지 않은 대기 키
                        { type: 'gallery', attrs: { layout: 'strip', images: [REF(3), REF(4)] } },
                        { type: 'video', attrs: { provider: 'youtube', id: 'dQw4w9WgXcQ' } },
                    ],
                },
            },
        };
        const { form, doc } = spec.fromData(dirty, { boardKey: 'review', ownerId: UID });
        expect(form).toEqual({ title: 'T', region_id: 'europe', is_private: false });
        expect(validateDoc(doc, { mode: 'private', ownerId: UID }).ok).toBe(true);
        const types = doc.doc.content.map((n) => n.type);
        expect(types).toEqual(['paragraph', 'image', 'gallery', 'video']);
        expect(JSON.stringify(doc)).not.toContain('pending:');
        expect(JSON.stringify(doc)).not.toContain(OTHER);
    });
    it('옛 원고(fmt 없음)는 평문 → 문단, 사진 → 맨 아래 단일 사진 칸(옛 image_url 한 장도)', () => {
        const old = { title: '옛', content: '가\n\n나', image_urls: [REF(1), REF(2)], region_id: 'asia', is_private: true };
        const { form, doc } = spec.fromData(old, { boardKey: 'review', ownerId: UID });
        expect(form).toEqual({ title: '옛', region_id: 'asia', is_private: true });
        expect(doc.doc.content).toEqual([
            { type: 'paragraph', content: [{ type: 'text', text: '가' }] },
            { type: 'paragraph' },
            { type: 'paragraph', content: [{ type: 'text', text: '나' }] },
            { type: 'image', attrs: { src: REF(1) } },
            { type: 'image', attrs: { src: REF(2) } },
        ]);
        const legacyOne = spec.fromData({ content: '글', image_url: REF(3) }, { boardKey: 'review', ownerId: UID });
        expect(legacyOne.doc.doc.content.at(-1)).toEqual({ type: 'image', attrs: { src: REF(3) } });
        // Q&A·자유(사진 없는 게시판)는 사진을 버리고 그 수를 알려 준다
        const qna = spec.fromData({ content: '질문', image_urls: [REF(1)] }, { boardKey: 'qna', ownerId: UID });
        expect(qna.doc.doc.content).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: '질문' }] }]);
        expect(qna.skipped).toBe(1);
        // 21장이면 20장까지만
        const many = Array.from({ length: 21 }, (_, i) => `sb://post-images/${UID}_1700000000${String(i).padStart(3, '0')}_x.jpg`);
        const big = spec.fromData({ content: '', image_urls: many }, { boardKey: 'review', ownerId: UID });
        expect(big.doc.doc.content.filter((n) => n.type === 'image')).toHaveLength(20);
        expect(big.skipped).toBe(1);
    });
    it('비교값(sigOf)은 문서 외 칸만 — 순서·여분 칸과 무관', () => {
        expect(spec.sigOf({ title: 'a', region_id: '', is_private: false, extra: 1 })).toBe(spec.sigOf({ is_private: false, title: 'a' }));
        expect(spec.sigOf({ title: 'a' })).not.toBe(spec.sigOf({ title: 'b' }));
    });
    it('빈 원고 = 제목이 비었고 편집기 문서도 빔(말머리·공개 설정만은 빈 원고)', () => {
        expect(spec.isBlank({ ...spec.empty, region_id: 'asia', is_private: true }, true)).toBe(true);
        expect(spec.isBlank({ ...spec.empty, title: ' 제목 ' }, true)).toBe(false);
        expect(spec.isBlank(spec.empty, false)).toBe(false);
    });
});

describe('draftTitle / draftErrorMessage', () => {
    it('제목 → 장소명 → 본문 앞 30자(서식 원고는 문서 평문) → 제목 없음', () => {
        expect(draftTitle({ title: '  오사카  동행 ' })).toBe('오사카 동행');
        expect(draftTitle({ name: '숨은 카페' })).toBe('숨은 카페');
        expect(draftTitle({ content: '가'.repeat(40) })).toBe('가'.repeat(30));
        expect(draftTitle({ fmt: 2, doc: { v: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '나'.repeat(40) }] }] } } })).toBe('나'.repeat(30));
        expect(draftTitle({})).toBe('제목 없음');
    });
    it('한도·용량·그 밖의 오류를 나눠 안내한다', () => {
        expect(draftErrorMessage({ message: 'draft limit board' })).toContain('20개');
        expect(draftErrorMessage({ message: 'draft limit total' })).toContain('너무 많아요');
        expect(draftErrorMessage({ message: 'new row violates check constraint "post_drafts_data_check"' })).toContain('너무 길어');
        expect(draftErrorMessage(new Error('Failed to fetch'))).toContain('잠시 뒤');
    });
});

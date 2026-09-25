import { describe, expect, it } from 'vitest';
import { DRAFT_TTL_MS, draftKey, isBlankDraft, loadDraft, pruneDrafts, removeDraft, removeUserDrafts, saveDraft } from './draftStore';

const memStorage = () => {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: (k) => { m.delete(k); },
        key: (i) => [...m.keys()][i] ?? null,
        get length() { return m.size; },
        _m: m,
    };
};

describe('draftKey', () => {
    it('계정이 없으면 null(임시저장 끔)', () => {
        expect(draftKey(null, 'companion')).toBe(null);
        expect(draftKey(undefined, 'qna', 'review')).toBe(null);
    });
    it('계정·게시판·탭을 이어 붙이고 빈 조각은 뺀다', () => {
        expect(draftKey('u1', 'qna', 'review')).toBe('u1:qna:review');
        expect(draftKey('u1', 'crew', null)).toBe('u1:crew');
        expect(draftKey('u1', 'market', '')).toBe('u1:market');
    });
});

describe('save / load / remove', () => {
    it('저장한 원고를 그대로 돌려준다', () => {
        const s = memStorage();
        const t = saveDraft('u1:companion', { title: '제목', content: '본문' }, { storage: s, now: 1000 });
        expect(t).toBe(1000);
        expect(loadDraft('u1:companion', { storage: s, now: 2000 })).toEqual({ savedAt: 1000, data: { title: '제목', content: '본문' } });
    });
    it('계정이 다르면 못 읽는다', () => {
        const s = memStorage();
        saveDraft('u1:companion', { title: 'a' }, { storage: s, now: 1 });
        expect(loadDraft('u2:companion', { storage: s, now: 2 })).toBe(null);
    });
    it('14일이 지나면 읽을 때 지운다', () => {
        const s = memStorage();
        saveDraft('u1:qna', { title: 'a' }, { storage: s, now: 0 });
        expect(loadDraft('u1:qna', { storage: s, now: DRAFT_TTL_MS + 1 })).toBe(null);
        expect(s._m.size).toBe(0);
    });
    it('깨진 값·형식이 다른 값은 지우고 null', () => {
        const s = memStorage();
        s.setItem('ct:draft:v1:u1:x', '{not json');
        expect(loadDraft('u1:x', { storage: s, now: 1 })).toBe(null);
        expect(s._m.has('ct:draft:v1:u1:x')).toBe(false);
        s.setItem('ct:draft:v1:u1:y', JSON.stringify({ savedAt: 'x', data: {} }));
        expect(loadDraft('u1:y', { storage: s, now: 1 })).toBe(null);
        expect(s._m.has('ct:draft:v1:u1:y')).toBe(false);
    });
    it('미래 시각(시계가 돌아간 기기) 저장본은 버린다', () => {
        const s = memStorage();
        saveDraft('u1:q', { title: 'a' }, { storage: s, now: 10 * 60 * 1000 });
        expect(loadDraft('u1:q', { storage: s, now: 0 })).toBe(null);
    });
    it('remove 로 지운다', () => {
        const s = memStorage();
        saveDraft('u1:q', { title: 'a' }, { storage: s, now: 1 });
        removeDraft('u1:q', { storage: s });
        expect(loadDraft('u1:q', { storage: s, now: 2 })).toBe(null);
    });
    it('저장소가 막혀 있어도 예외 없이 null', () => {
        const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
        expect(saveDraft('u1:q', { title: 'a' }, { storage: broken, now: 1 })).toBe(null);
        expect(loadDraft('u1:q', { storage: broken, now: 1 })).toBe(null);
        expect(() => removeDraft('u1:q', { storage: broken })).not.toThrow();
        expect(saveDraft('u1:q', { title: 'a' }, { storage: null })).toBe(null);
        expect(loadDraft(null, { storage: memStorage() })).toBe(null);
    });
});

describe('isBlankDraft', () => {
    const F = ['title', 'content', 'images'];
    it('입력한 글자가 없으면 빈 원고', () => {
        expect(isBlankDraft({ title: '', content: '   ', images: [] }, F)).toBe(true);
        expect(isBlankDraft(null, F)).toBe(true);
        expect(isBlankDraft({ region_id: 'europe', title: '' }, ['title'])).toBe(true);
    });
    it('한 칸이라도 있으면 빈 원고가 아니다', () => {
        expect(isBlankDraft({ title: '', content: 'a', images: [] }, F)).toBe(false);
        expect(isBlankDraft({ title: '', content: '', images: ['u'] }, F)).toBe(false);
    });
});

describe('removeUserDrafts / pruneDrafts', () => {
    it('직접 로그아웃: 그 계정 저장본만 지운다', () => {
        const s = memStorage();
        saveDraft('u1:qna:review', { title: 'a' }, { storage: s, now: 1 });
        saveDraft('u1:companion', { title: 'b' }, { storage: s, now: 1 });
        saveDraft('u10:companion', { title: 'c' }, { storage: s, now: 1 });   // 접두사가 겹치는 다른 계정
        s.setItem('other-app-key', 'x');
        expect(removeUserDrafts('u1', { storage: s })).toBe(2);
        expect(loadDraft('u10:companion', { storage: s, now: 2 })).not.toBe(null);
        expect(s.getItem('other-app-key')).toBe('x');
        expect(removeUserDrafts(null, { storage: s })).toBe(0);
    });
    it('만료·깨진 저장본을 한꺼번에 지우고 살아 있는 건 둔다', () => {
        const s = memStorage();
        saveDraft('u1:a', { title: 'old' }, { storage: s, now: 0 });
        saveDraft('u1:b', { title: 'new' }, { storage: s, now: DRAFT_TTL_MS });
        s.setItem('ct:draft:v1:u1:c', 'broken');
        expect(pruneDrafts({ storage: s, now: DRAFT_TTL_MS + 10 })).toBe(2);
        expect(loadDraft('u1:b', { storage: s, now: DRAFT_TTL_MS + 10 })).not.toBe(null);
        expect(s._m.size).toBe(1);
    });
});

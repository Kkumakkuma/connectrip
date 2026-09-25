import { describe, expect, it } from 'vitest';
import { canSetPrivate, visibilityPatch } from './postVisibility';
import { BOARDS } from './boards';

describe('canSetPrivate', () => {
    it('후기 게시판 새 글에는 선택지를 보인다', () => {
        expect(canSetPrivate(BOARDS.review, null)).toBe(true);
    });
    it('후기 글이면 보인다', () => {
        expect(canSetPrivate(BOARDS.review, { type: 'review' })).toBe(true);
    });
    it('같은 테이블의 홍보 글에는 보이지 않는다(DB CHECK 와 같은 규칙)', () => {
        expect(canSetPrivate(BOARDS.review, { type: 'promotion' })).toBe(false);
    });
    it('다른 게시판에는 보이지 않는다', () => {
        for (const key of ['companion', 'qna', 'free', 'crew', 'destination']) {
            expect(canSetPrivate(BOARDS[key], {})).toBe(false);
        }
        expect(canSetPrivate(undefined, {})).toBe(false);
    });
});

describe('visibilityPatch', () => {
    it('바꾸지 않았으면 아무것도 보내지 않는다', () => {
        expect(visibilityPatch(false, false)).toEqual({});
        expect(visibilityPatch(true, true)).toEqual({});
        expect(visibilityPatch(undefined, false)).toEqual({});
        expect(visibilityPatch(null, false)).toEqual({});
    });
    it('바꿨으면 새 값을 보낸다', () => {
        expect(visibilityPatch(false, true)).toEqual({ is_private: true });
        expect(visibilityPatch(true, false)).toEqual({ is_private: false });
        expect(visibilityPatch(undefined, true)).toEqual({ is_private: true });
    });
});

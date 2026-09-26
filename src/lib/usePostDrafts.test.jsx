// 1단계 화면은 서식 원고(data.fmt = 2)를 불러오지 않는다 — 불러오면 본문이 비어 보이고, 등록 뒤 정리(removeIf → 서버 함수)로
// 원고가 지워질 수 있어서다(codex 9/26). 불러오기(= 등록 뒤 정리 대상 기록)보다 먼저 거르는지 본다.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

const { useDraftActions } = await import('./usePostDrafts');
const { DRAFT_SPECS } = await import('./draftForms');
const { RICH_DRAFT_MESSAGE, draftErrorMessage, isRichDraft } = await import('./postDrafts');

const fakeDrafts = () => ({ enabled: true, session: 1, busy: false, current: null, load: vi.fn((item) => item.data), save: vi.fn(), remove: vi.fn() });

function capture(drafts, setForm) {
    let actions;
    const H = () => { actions = useDraftActions({ drafts, spec: DRAFT_SPECS.destination, form: DRAFT_SPECS.destination.empty, setForm }); return null; };
    renderToStaticMarkup(<H />);
    return actions;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('서식 원고 불러오기 거부(1단계)', () => {
    it('isRichDraft: fmt 2(숫자·문자)만', () => {
        expect(isRichDraft({ fmt: 2 })).toBe(true);
        expect(isRichDraft({ fmt: '2' })).toBe(true);
        expect(isRichDraft({ fmt: 1 })).toBe(false);
        expect(isRichDraft({ content: 'x' })).toBe(false);
        expect(isRichDraft(null)).toBe(false);
    });
    it('fmt 2 원고는 drafts.load(등록 뒤 정리 대상 기록)도 폼 교체도 하지 않고 안내만 띄운다', () => {
        const alert = vi.fn();
        vi.stubGlobal('alert', alert);
        const drafts = fakeDrafts();
        const setForm = vi.fn();
        const actions = capture(drafts, setForm);
        actions.loadDraft({ id: 'd1', revision: 3, data: { fmt: 2, crewCommentDoc: { v: 1, doc: { type: 'doc', content: [] } }, name: 'n' } });
        expect(alert).toHaveBeenCalledWith(RICH_DRAFT_MESSAGE);
        expect(drafts.load).not.toHaveBeenCalled();
        expect(setForm).not.toHaveBeenCalled();
    });
    it('옛 원고는 지금처럼 불러온다', () => {
        vi.stubGlobal('alert', vi.fn());
        const drafts = fakeDrafts();
        const setForm = vi.fn();
        const actions = capture(drafts, setForm);
        try {
            actions.loadDraft({ id: 'd2', revision: 1, data: { name: '장소', crewComment: '꿀팁' } });
        } catch {
            /* 서버 렌더 밖에서 부른 상태 갱신(setSnap)은 무시한다 — 여기서는 load·setForm 호출만 본다 */
        }
        expect(drafts.load).toHaveBeenCalledTimes(1);
    });
    it('서버 원고 가드 오류는 알아볼 수 있는 안내로', () => {
        expect(draftErrorMessage({ message: 'DRAFT_APP_UPDATE_REQUIRED' })).toContain('새 글쓰기 화면');
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const from = vi.fn(() => { throw new Error('원고 삭제는 테이블 직접 DELETE 를 쓰지 않는다'); });
vi.mock('./supabase', () => ({ supabase: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) } }));

const { draftsApi } = await import('./postDrafts');

beforeEach(() => { rpc.mockReset(); from.mockClear(); });

describe('draftsApi 삭제 — 서버 함수 post_draft_delete 로만(2026-09-26 서식 원고 가드)', () => {
    it('remove: 버전과 무관하게(p_rev null)', async () => {
        rpc.mockResolvedValue({ data: 'id-1', error: null });
        await draftsApi.remove('id-1');
        expect(rpc).toHaveBeenCalledWith('post_draft_delete', { p_id: 'id-1', p_rev: null });
        expect(from).not.toHaveBeenCalled();
    });
    it('removeIf: 불러온 revision 일 때만', async () => {
        rpc.mockResolvedValue({ data: null, error: null });
        await draftsApi.removeIf('id-2', 3);
        expect(rpc).toHaveBeenCalledWith('post_draft_delete', { p_id: 'id-2', p_rev: 3 });
        await draftsApi.removeIf('id-2', 0);
        expect(rpc).toHaveBeenLastCalledWith('post_draft_delete', { p_id: 'id-2', p_rev: 0 });
    });
    it('id·revision 이 없으면 부르지 않는다, 서버 오류는 던진다', async () => {
        await draftsApi.remove(null);
        await draftsApi.removeIf('id-3', null);
        await draftsApi.removeIf(null, 1);
        expect(rpc).not.toHaveBeenCalled();
        rpc.mockResolvedValue({ data: null, error: { message: 'DRAFT_APP_UPDATE_REQUIRED' } });
        await expect(draftsApi.remove('id-4')).rejects.toEqual({ message: 'DRAFT_APP_UPDATE_REQUIRED' });
    });
});

// 글쓰기 임시저장 v2(2026-09-25 쿠마님 지시) — 서버(public.post_drafts)에 저장하고 어느 기기에서든 "불러오기"로 고른다.
// 자동 저장·자동 복원은 하지 않는다. DB 규칙은 src/lib/post_drafts_20260925.sql, 폼 변환은 draftForms.js.
import { supabase } from './supabase';

export const DRAFT_PER_BOARD = 20;

// 목록에 보일 이름: 제목(추천지는 장소명) → 없으면 본문 앞부분 → 둘 다 없으면 '제목 없음'.
export const draftTitle = (data) => {
    const pick = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
    const t = pick(data?.title) || pick(data?.name);
    if (t) return t.slice(0, 120);
    const body = pick(data?.content) || pick(data?.desc) || pick(data?.crewComment);
    return body ? body.slice(0, 30) : '제목 없음';
};

// 서식 원고(data.fmt = 2) — 서식 편집기(2단계부터) 화면이 저장한 원고. 이 판(1단계) 화면은 서식 문서를 읽지 못해
// 불러오면 본문이 비어 보이고, 그대로 등록하면 등록 뒤 정리(removeIf, 서버 함수라 원고 가드를 지난다)로 원고가 지워진다
// (codex 9/26). 그래서 이 화면에서는 불러오지 않는다(목록의 삭제 버튼은 본인이 고른 것이라 그대로 둔다).
// 서버는 data->>'fmt' = '2' 로 본다 — 숫자 2·문자 '2' 둘 다.
export const isRichDraft = (data) => String(data?.fmt ?? '') === '2';
export const RICH_DRAFT_MESSAGE = '새 글쓰기 화면에서 저장한 원고예요. 페이지를 새로 고친 뒤(앱은 업데이트한 뒤) 다시 불러와 주세요.';

export const draftErrorMessage = (err) => {
    const m = String(err?.message || '');
    // 서버 원고 가드: 다른 기기의 새 화면이 서식 원고로 저장한 것을 이 화면이 덮어쓰려 한 경우
    if (m.includes('DRAFT_APP_UPDATE_REQUIRED')) return '새 글쓰기 화면에서 고친 원고라 여기서는 저장할 수 없어요. 페이지를 새로 고친 뒤 다시 시도해 주세요.';
    if (m.includes('draft limit board')) return `임시저장은 게시판마다 ${DRAFT_PER_BOARD}개까지 둘 수 있어요. 불러오기 목록에서 지운 뒤 다시 저장해 주세요.`;
    if (m.includes('draft limit total')) return '임시저장이 너무 많아요. 다른 게시판의 불러오기 목록에서 지운 뒤 다시 저장해 주세요.';
    if (m.includes('check constraint')) return '글이 너무 길어 임시저장하지 못했습니다.';
    return '임시저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
};

const SELECT = 'id, title, data, revision, updated_at';

export const draftsApi = {
    async list(board, scope = '') {
        const { data, error } = await supabase
            .from('post_drafts')
            .select(SELECT)
            .eq('board', board)
            .eq('scope', scope)
            .order('updated_at', { ascending: false })
            .limit(DRAFT_PER_BOARD);
        if (error) throw error;
        return data || [];
    },

    // 저장. 반환 { row, mode: 'updated' | 'created' }.
    //  - id 가 있으면(불러왔거나 이미 저장한 원고) 그 건을 지금 내용으로 덮어쓴다 — 다른 기기에서 먼저 고쳤어도
    //    마지막 임시저장이 이긴다(2026-09-25 쿠마님 결정: "다시 임시저장하는 거니까 덮어씌워야지").
    //    그사이 다른 곳에서 지웠으면(0행) 지금 내용을 새 원고로 저장한다.
    //  - newId 는 부르는 쪽이 한 번 만들어 저장이 성공할 때까지 유지한다 — 응답이 끊겨 다시 눌러도
    //    같은 id 라 두 건이 생기지 않는다(23505 면 이미 들어간 그 건을 지금 내용으로 고친다).
    async save({ id = null, newId, board, scope = '', title, data }) {
        if (id) {
            const { data: row, error } = await supabase
                .from('post_drafts')
                .update({ title, data })
                .eq('id', id)
                .select(SELECT)
                .maybeSingle();
            if (error) throw error;
            if (row) return { row, mode: 'updated' };
        }
        const ins = await supabase
            .from('post_drafts')
            .insert({ id: newId, board, scope, title, data })
            .select(SELECT)
            .single();
        if (!ins.error) return { row: ins.data, mode: 'created' };
        if (ins.error.code === '23505') {
            const { data: row, error } = await supabase
                .from('post_drafts')
                .update({ title, data })
                .eq('id', newId)
                .select(SELECT)
                .maybeSingle();
            if (error) throw error;
            if (row) return { row, mode: 'created' };
        }
        throw ins.error;
    },

    // 삭제는 서버 함수 post_draft_delete 로만 한다(2026-09-26 서식 편집기 1단계, SQL rich_body_20260926.sql).
    // 서식 원고(data.fmt = 2)는 이 함수로만 지워진다 — 서식을 모르는 옛 화면의 직접 DELETE 는 서버가 막는다
    // (옛 화면이 서식 원고를 빈 본문으로 불러와 등록한 뒤 지워 버리는 경로 차단). 본인 원고만(RLS + user_id 조건).

    // 목록의 삭제 버튼(본인이 고른 것 — 버전과 무관하게 지운다)
    async remove(id) {
        if (!id) return;
        const { error } = await supabase.rpc('post_draft_delete', { p_id: id, p_rev: null });
        if (error) throw error;
    },

    // 등록 성공 뒤 정리: 불러온 그 버전일 때만 지운다(다른 기기에서 더 고친 원고는 남긴다, codex 9/25).
    async removeIf(id, rev) {
        if (!id || rev == null) return;
        const { error } = await supabase.rpc('post_draft_delete', { p_id: id, p_rev: rev });
        if (error) throw error;
    },
};

export const newDraftId = () => {
    try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch { /* 아래 대체 */ }
    // crypto.randomUUID 가 없는 옛 웹뷰: v4 형식으로 만든다
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
};

// v1(같은 날 약 1시간 배포된 이 기기 저장 방식)이 남긴 localStorage 키를 지운다. 앱 시작 때 한 번.
export function purgeLegacyLocalDrafts() {
    try {
        const ls = window.localStorage;
        const ks = [];
        for (let i = 0; i < ls.length; i += 1) {
            const k = ls.key(i);
            if (k && k.startsWith('ct:draft:v1:')) ks.push(k);
        }
        ks.forEach((k) => ls.removeItem(k));
    } catch {
        /* 저장소 차단 — 지울 것도 없다 */
    }
}

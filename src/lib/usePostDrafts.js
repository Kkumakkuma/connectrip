import { useCallback, useEffect, useRef, useState } from 'react';
import { DRAFT_FORKED_MESSAGE, draftErrorMessage, draftsApi, draftTitle, newDraftId } from './postDrafts';

// 글쓰기 임시저장 v2 훅(2026-09-25). 서버 저장 + 불러오기. 자동 저장·자동 복원은 없다.
//
//   const drafts = usePostDrafts({ board: 'qna:review', open: showModal, userId: user?.id });
//   - open 이 켜질 때마다(=글쓰기 창을 열 때마다) 빈 새 글 상태로 시작하고 그 게시판 임시저장 목록만 읽어 둔다.
//   - drafts.save(data) = "임시저장" 버튼. 불러왔거나 이미 저장한 원고면 그 건을 고치고, 새 글이면 새 건.
//   - drafts.load(item) = 목록에서 고른 원고의 data 를 돌려준다(폼 채우기는 부르는 쪽).
//   - 등록: 요청 전에 const t = drafts.ticket() 로 잡아 두고, 성공하면 drafts.consume(t) — 불러온 그 버전만 지운다.
//   - 창을 닫거나(open=false) 계정·게시판이 바뀌면 늦게 온 응답은 버린다(세대 번호).
export function usePostDrafts({ board, scope = '', open, userId }) {
    const enabled = !!(open && board && userId);
    const [items, setItems] = useState([]);
    const [status, setStatus] = useState('idle');     // idle | loading | ready | error
    const [showList, setShowList] = useState(false);
    const [current, setCurrent] = useState(null);     // { id, rev } — 이 창에서 불러왔거나 저장한 원고
    const [savedAt, setSavedAt] = useState(null);
    const [busy, setBusy] = useState(false);
    const gen = useRef(0);
    const ctx = useRef({ board, scope });
    const currentRef = useRef(null);
    const pendingId = useRef(null);                   // 새 원고 저장이 성공할 때까지 같은 id 로 재시도
    const busyRef = useRef(false);                    // 저장·삭제를 한 번에 하나만(codex 9/25)
    const listReq = useRef(0);                        // 목록은 마지막으로 요청한 응답만 반영

    const refresh = useCallback(async () => {
        const g = gen.current;
        const req = ++listReq.current;
        const { board: b, scope: s } = ctx.current;
        setStatus('loading');
        try {
            const rows = await draftsApi.list(b, s);
            if (g !== gen.current || req !== listReq.current) return;
            setItems(rows);
            setStatus('ready');
        } catch (err) {
            if (g !== gen.current || req !== listReq.current) return;
            console.error('임시저장 목록 조회 실패:', err);
            setStatus('error');
        }
    }, []);

    useEffect(() => {
        if (!enabled) return undefined;
        gen.current += 1;
        ctx.current = { board, scope };
        currentRef.current = null;
        pendingId.current = null;
        busyRef.current = false;
        let alive = true;
        // effect 안에서 곧바로 setState 하지 않는다(react-hooks/set-state-in-effect) — 마이크로태스크로 넘긴다
        Promise.resolve().then(() => {
            if (!alive) return;
            setItems([]);
            setShowList(false);
            setCurrent(null);
            setSavedAt(null);
            setBusy(false);
            refresh();
        });
        return () => { alive = false; gen.current += 1; };
    }, [enabled, board, scope, userId, refresh]);

    const save = useCallback(async (data) => {
        if (busyRef.current || !enabled) return null;
        busyRef.current = true;
        setBusy(true);
        const g = gen.current;
        const { board: b, scope: s } = ctx.current;
        const cur = currentRef.current;
        if (!pendingId.current) pendingId.current = newDraftId();
        try {
            const res = await draftsApi.save({ id: cur?.id, rev: cur?.rev, newId: pendingId.current, board: b, scope: s, title: draftTitle(data), data });
            if (g !== gen.current) return null;
            currentRef.current = { id: res.row.id, rev: res.row.revision };
            setCurrent(currentRef.current);
            pendingId.current = null;
            setSavedAt(Date.parse(res.row.updated_at) || Date.now());
            refresh();
            return res;
        } finally {
            if (g === gen.current) {
                busyRef.current = false;
                setBusy(false);
            }
        }
    }, [enabled, refresh]);

    const load = useCallback((item) => {
        currentRef.current = { id: item.id, rev: item.revision };
        setCurrent(currentRef.current);
        pendingId.current = null;
        setSavedAt(null);
        setShowList(false);
        return item.data;
    }, []);

    // 목록의 삭제. 저장과 같은 잠금을 써서 "저장 중에 지워져 방금 저장한 게 사라지는" 경합을 막는다.
    const remove = useCallback(async (id) => {
        if (busyRef.current) return false;
        busyRef.current = true;
        setBusy(true);
        const g = gen.current;
        try {
            await draftsApi.remove(id);
            if (g !== gen.current) return true;
            setItems((xs) => xs.filter((x) => x.id !== id));
            if (currentRef.current?.id === id) {
                currentRef.current = null;
                setCurrent(null);
                setSavedAt(null);
            }
            return true;
        } finally {
            if (g === gen.current) {
                busyRef.current = false;
                setBusy(false);
            }
        }
    }, []);

    const ticket = useCallback(() => currentRef.current, []);

    // 등록 성공 뒤. 실패해도 등록은 성공이다 — 로그만 남긴다(원고가 남으면 목록에서 지우면 된다).
    // 다른 기기에서 더 고친 원고는 서버가 남기므로(조건부 삭제 0행) 목록은 서버에서 다시 읽는다(codex 9/25).
    const consume = useCallback((t) => {
        if (currentRef.current && t && currentRef.current.id === t.id) {
            currentRef.current = null;
            setCurrent(null);
            setSavedAt(null);
        }
        if (!t) return;
        const g = gen.current;
        draftsApi.removeIf(t.id, t.rev)
            .catch((err) => console.error('임시저장 정리 실패:', err))
            .finally(() => { if (g === gen.current) refresh(); });
    }, [refresh]);

    return { enabled, items, status, showList, setShowList, current, savedAt, busy, refresh, save, load, remove, ticket, consume };
}

// 게시판 쪽 공통 동작(저장·불러오기·삭제 + 안내). spec = draftForms.js 의 DRAFT_SPECS.x
//   blocked: 사진을 올리는 중·등록 중에는 저장·불러오기를 막는다(업로드가 끝나며 다른 원고에 사진이 붙지 않게).
export function useDraftActions({ drafts, spec, form, setForm, blocked = false }) {
    const saveDraft = async () => {
        if (blocked) return null;
        if (spec.isBlank(form)) { alert('임시저장할 내용이 없어요.'); return null; }
        try {
            const res = await drafts.save(spec.toData(form));
            if (res?.mode === 'forked') alert(DRAFT_FORKED_MESSAGE);
            return res;
        } catch (err) {
            console.error('임시저장 실패:', err);
            alert(draftErrorMessage(err));
            return null;
        }
    };
    const loadDraft = (item) => {
        if (blocked || drafts.busy) return;
        if (!spec.isBlank(form) && !window.confirm('작성 중인 내용 대신 불러올까요?')) return;
        setForm(spec.fromData(drafts.load(item)));
    };
    const removeDraft = async (item) => {
        if (drafts.busy) return;
        if (!window.confirm('이 임시저장 글을 지울까요?')) return;
        try {
            await drafts.remove(item.id);
        } catch (err) {
            console.error('임시저장 삭제 실패:', err);
            alert('지우지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
        }
    };
    return { saveDraft, loadDraft, removeDraft };
}

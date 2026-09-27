import { useCallback, useEffect, useRef, useState } from 'react';
import { RICH_DRAFT_MESSAGE, draftErrorMessage, draftsApi, draftTitle, isRichDraft, newDraftId } from './postDrafts';
import { PHOTO_UPLOAD_MESSAGE, isDocInvalid, isImageUploadError, isSaveCancelled, pendingSignature, replacePendingInForm } from './pendingImages';
import { discardImages, imageObjectsIn, objectsRemoved } from './imageDiscard';
import { richSaveMessage } from './rich/messages';

// 글쓰기 임시저장 v2 훅(2026-09-25). 서버 저장 + 불러오기. 자동 저장·자동 복원은 없다.
//
//   const drafts = usePostDrafts({ board: 'qna:review', open: showModal, userId: user?.id });
//   - open 이 켜질 때마다(=글쓰기 창을 열 때마다) 빈 새 글 상태로 시작하고 그 게시판 임시저장 목록만 읽어 둔다.
//   - drafts.save(data) = "임시저장" 버튼. 불러왔거나 이미 저장한 원고면 그 건을 덮어쓰고(다른 기기에서 먼저
//     고쳤어도 마지막 저장이 이긴다 — 쿠마님 결정), 새 글이면 새 건.
//   - drafts.load(item) = 목록에서 고른 원고의 data 를 돌려준다(폼 채우기는 부르는 쪽).
//   - 등록: 요청 전에 const t = drafts.ticket() 로 잡아 두고, 성공하면 drafts.consume(t) — 불러온 그 버전만 지운다.
//     (게시판 폼은 useDraftActions 의 takeTicket/consumeDraft 로 부른다 — 원고에서 뺀 사진 정리까지 한다)
//   - 창을 닫거나(open=false) 계정·게시판이 바뀌면 늦게 온 응답은 버린다(세대 번호).
export function usePostDrafts({ board, scope = '', open, userId }) {
    const enabled = !!(open && board && userId);
    const [items, setItems] = useState([]);
    const [status, setStatus] = useState('idle');     // idle | loading | ready | error
    const [showList, setShowList] = useState(false);
    const [current, setCurrent] = useState(null);     // { id, rev } — 이 창에서 불러왔거나 저장한 원고
    const [savedAt, setSavedAt] = useState(null);
    const [busy, setBusy] = useState(false);
    const [session, setSession] = useState(0);        // 창을 열 때마다 +1 — useDraftActions 가 "마지막 저장본" 기준을 새로 잡는다
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
            setSession((n) => n + 1);
            refresh();
        });
        return () => { alive = false; gen.current += 1; };
    }, [enabled, board, scope, userId, refresh]);

    // expectGen: 저장을 시작한 창의 세대(generation()). 사진을 올리는 사이 창을 닫았다 새로 열었으면 저장하지 않는다 —
    // 안 그러면 이전 창의 원고가 새 창의 게시판·원고 자리로 저장된다(codex 9/27).
    const save = useCallback(async (data, expectGen) => {
        if (busyRef.current || !enabled) return null;
        if (expectGen !== undefined && expectGen !== gen.current) return null;
        busyRef.current = true;
        setBusy(true);
        const g = gen.current;
        const { board: b, scope: s } = ctx.current;
        const cur = currentRef.current;
        if (!pendingId.current) pendingId.current = newDraftId();
        try {
            const res = await draftsApi.save({ id: cur?.id, newId: pendingId.current, board: b, scope: s, title: draftTitle(data), data });
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
    // 지금 창의 세대 번호(창을 열고 닫을 때마다 바뀐다) — 오래 걸리는 저장이 시작한 창에 그대로 있는지 확인용
    const generation = useCallback(() => gen.current, []);

    // 등록 성공 뒤. 실패해도 등록은 성공이다 — 로그만 남긴다(원고가 남으면 목록에서 지우면 된다).
    // 다른 기기에서 더 고친 원고는 서버가 남기므로(조건부 삭제 0행) 목록은 서버에서 다시 읽는다(codex 9/25).
    // 반환: 정리가 끝나면(성공·실패 무관) 풀리는 Promise — 원고에서 뺀 사진 정리는 그 뒤에 한다(useDraftActions).
    const consume = useCallback((t) => {
        if (currentRef.current && t && currentRef.current.id === t.id) {
            currentRef.current = null;
            setCurrent(null);
            setSavedAt(null);
        }
        if (!t) return Promise.resolve();
        const g = gen.current;
        return draftsApi.removeIf(t.id, t.rev)
            .catch((err) => console.error('임시저장 정리 실패:', err))
            .finally(() => { if (g === gen.current) refresh(); });
    }, [refresh]);

    return { enabled, userId, session, items, status, showList, setShowList, current, savedAt, busy, refresh, save, load, remove, ticket, consume, generation };
}

// 게시판 쪽 공통 동작(저장·불러오기·삭제·닫기 확인). spec = draftForms.js 의 DRAFT_SPECS.x
//   blocked: 사진을 준비하는 중·등록 중에는 저장·불러오기를 막는다(준비가 끝나며 다른 원고에 사진이 붙지 않게).
//   photos: useImageSave 결과(2026-09-27 지연 업로드). 임시저장을 누르면 spec.imageKeys 칸의 대기 사진을 먼저 올리고
//     참조로 바꿔 저장한다. 올리기·원고 저장이 실패하면 이번에 올린 사진은 바로 지운다(pendingImages.js).
//   사진 정리(imageDiscard.js, 다른 곳에서 쓰는 사진은 서버가 남긴다):
//     - 불러온(또는 이 창에서 저장한) 원고를 다시 임시저장 → 그 원고에서 빠진 사진
//     - 목록에서 원고 삭제 → 그 원고의 사진(지금 폼에 들어 있는 사진은 뺀다)
//     - 등록 성공(consumeDraft) → 원고가 지워진 뒤, 원고에는 있었는데 등록한 글에는 없는 사진
//   requestClose(close): 창 닫기(X·취소·바깥·Esc) 대신 부른다. 임시저장 안 한 내용이 있으면
//     "임시저장하시겠습니까?" 창(closeDialog)을 띄운다 — 2026-09-25 쿠마님 지시. 등록 성공 뒤 닫기는 그냥 닫는다.
//   dirty 인 동안은 브라우저 창·탭 닫기·새로고침에도 브라우저 기본 확인창을 띄운다(beforeunload).
//
//   rich(서식 편집기 게시판, spec.rich — 2026-09-27 2단계, plan_stage2 F·J장): 본문 문서는 편집기가 쥔다.
//     { handle: () => RichEditor 손잡이, version, blank, boardKey, ownerId, loadDoc(env) → 새 편집기의 version }
//     - "저장 안 한 내용" = 문서 외 칸(spec.sigOf) 또는 편집기 version 이 마지막 저장·불러오기 때와 다름(8-4).
//       사진 정리 비교는 실제로 서버에 저장한 원고 data(json)로 한다(codex B4 — 비교값과 저장본 분리).
//     - 임시저장: 편집기 prepareSave(조합 확정·잠금) → runDoc(대기 사진 업로드·치환·최종 검증·원고 저장) →
//       finishSave(성공이면 화면 문서를 저장본과 맞춤) → 빠진 사진 정리 + 편집기에 "지워진 사진" 알림(markDiscarded).
export function useDraftActions({ drafts, spec, form, setForm, blocked = false, photos = null, rich = null }) {
    const isRich = !!(spec.rich && rich);
    // 닫기 확인 요청. 창을 연 세션에 묶어 둔다 — 등록이 끝나 창이 닫히면(세션 종료) 남은 요청은 무효(codex 9/25).
    const [ask, setAsk] = useState(null);                                      // { session, close }
    const askRef = useRef(null);                                               // 저장 도중 취소하면 무효화
    // 마지막으로 저장·불러온 내용. 그 원고(id)가 지금 창의 원고일 때만 기준이 된다 — 목록에서 지우거나
    // 등록해 원고가 사라지면 다시 "저장 안 한 내용"으로 본다(codex 9/25).
    //   json = 서버 원고 data(사진 정리 비교용), sig·version = 서식 게시판의 "저장 안 한 내용" 비교값
    const [snap, setSnap] = useState({ session: -1, id: null, json: null, sig: null, version: null });
    const [saving, setSaving] = useState(false);                               // 사진 올리기부터 원고 저장까지
    const savingRef = useRef(false);
    const formRef = useRef(form);
    useEffect(() => { formRef.current = form; });
    // 목록에서 지운 원고의 사진 중 지금 폼에 들어 있어 남겨 둔 것(창 세션별). 창을 그냥 닫거나 등록하면 쓰지 않은 것만 지운다
    // — 서버는 다른 글·원고가 쓰는 사진은 지우지 않으므로 넉넉히 불러도 안전하다(imageDiscard.js).
    const keptRef = useRef({ session: -1, list: [] });
    const flushKept = (exceptValues) => {
        const { session, list } = keptRef.current;
        keptRef.current = { session: -1, list: [] };
        if (session !== drafts.session || !list.length) return;
        const skip = new Set(imageObjectsIn(exceptValues).map((o) => `${o.bucket}/${o.name}`));
        const gone = list.filter((o) => !skip.has(`${o.bucket}/${o.name}`));
        if (gone.length) void discardImages(gone, drafts.userId);
    };
    const keys = spec.imageKeys || [];
    const live = snap.session === drafts.session && !!snap.id && snap.id === drafts.current?.id;
    const saved = live ? snap.json : null;
    const blank = isRich ? spec.isBlank(form, rich.blank) : spec.isBlank(form);
    let changed;
    if (isRich) {
        changed = !live || spec.sigOf(form) !== snap.sig || rich.version !== snap.version;
    } else {
        const json = JSON.stringify(spec.toData(form));
        // 고르기만 한 사진이 있으면 늘 "저장 안 한 내용"이다(원고 데이터에는 참조만 들어간다)
        changed = json !== saved || pendingSignature(form, keys) !== '';
    }
    const dirty = !!drafts.enabled && !blank && changed;
    // 닫기·새로고침 순간의 판정. 서식 게시판은 편집기에 지금 값을 물어본다 — 편집기 알림(version·blank)은 최대 150ms 늦어
    // 방금 고친 내용을 "저장한 것"으로 보고 확인 없이 닫을 수 있었다(codex B3).
    const isDirtyNow = () => {
        if (!isRich) return dirty;
        if (!drafts.enabled) return false;
        const h = rich.handle();
        const f = formRef.current;
        const docBlank = h?.isBlank ? h.isBlank() : rich.blank;
        if (spec.isBlank(f, docBlank)) return false;
        const version = h?.version ? h.version() : rich.version;
        return !live || spec.sigOf(f) !== snap.sig || version !== snap.version;
    };
    const dirtyNowRef = useRef(isDirtyNow);
    useEffect(() => { dirtyNowRef.current = isDirtyNow; });

    // 새로고침·창 닫기 경고. 일반 게시판은 예전처럼 "저장 안 한 내용"이 있을 때만 건다. 서식 게시판은 알림이 늦을 수 있어
    // 글쓰기 창이 열려 있는 동안 걸어 두고 그 순간 판정한다 — 리스너가 있으면 Firefox 는 뒤로가기 캐시를 쓰지 않으므로
    // 범위를 글쓰기 창으로만 좁힌다(codex 9/27).
    const unloadGuard = isRich ? !!drafts.enabled : dirty;
    useEffect(() => {
        if (!unloadGuard) return undefined;
        const onBeforeUnload = (e) => {
            if (!dirtyNowRef.current()) return;
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [unloadGuard]);

    // 덮어쓴 원고에서 빠진 사진 정리(서식 게시판은 편집기에도 "지워진 사진"으로 알린다)
    const discardGone = (prevJson, data) => {
        if (!prevJson) return;
        let prev = null;
        try { prev = JSON.parse(prevJson); } catch { prev = null; }
        const gone = objectsRemoved(prev, data);
        if (!gone.length) return;
        void discardImages(gone, drafts.userId);
        if (isRich) rich.handle()?.markDiscarded(gone);
    };

    const saveDraftRich = async () => {
        const h = rich.handle();
        if (!h) return null;
        const session = drafts.session;
        const g0 = drafts.generation?.();
        const prevJson = saved;
        const formAtSave = formRef.current;
        const notSaved = new Error('draft-not-saved');
        savingRef.current = true;
        setSaving(true);
        let s = null;
        try {
            s = await h.prepareSave();
            if (s.error) {
                const msg = richSaveMessage(s);
                if (msg) alert(msg);
                s = null;
                return null;
            }
            if (spec.isBlank(formAtSave, s.blank)) { alert('임시저장할 내용이 없어요.'); return null; }
            const out = await photos.runDoc('draft', { env: s.env, pending: s.pending, boardKey: rich.boardKey }, async (finalEnv) => {
                const data = spec.toData(formAtSave, finalEnv);
                const res = await drafts.save(data, g0);
                // 저장이 안 됐으면(다른 저장 중·창 닫힘) 이번에 올린 사진을 지우게 실패로 넘긴다
                if (!res) throw notSaved;
                return { res, data };
            });
            const { res, data } = out.result;
            h.finishSave(s.token, { savedEnv: out.env, map: out.map });
            s = null;
            setSnap({ session, id: res.row.id, json: JSON.stringify(data), sig: spec.sigOf(formAtSave), version: h.version() });
            discardGone(prevJson, data);
            return res;
        } catch (err) {
            if (err === notSaved || isSaveCancelled(err)) return null;
            console.error('임시저장 실패:', err);
            alert(isImageUploadError(err) ? PHOTO_UPLOAD_MESSAGE
                : isDocInvalid(err) ? '글을 저장하지 못했어요. 새로 고친 뒤 다시 시도해 주세요.'
                    : draftErrorMessage(err));
            return null;
        } finally {
            if (s?.token) h.finishSave(s.token, null);
            savingRef.current = false;
            setSaving(false);
        }
    };

    const saveDraft = async () => {
        if (blocked || savingRef.current) return null;
        if (isRich) return saveDraftRich();
        if (spec.isBlank(form)) { alert('임시저장할 내용이 없어요.'); return null; }
        const session = drafts.session;
        const g0 = drafts.generation?.();                                       // 이 창에서 시작한 저장 — 창이 바뀌면 원고를 저장하지 않는다
        const prevJson = saved;                                                // 덮어쓰기 전 원고(빠진 사진 정리용)
        const notSaved = new Error('draft-not-saved');
        const store = async (f) => {
            const data = spec.toData(f);
            const res = await drafts.save(data, g0);
            // 저장이 안 됐으면(다른 저장 중·창 닫힘) 이번에 올린 사진을 지우게 실패로 넘긴다 — 실제로는 저장됐다면 서버가 남긴다
            if (!res) throw notSaved;
            return { res, data };
        };
        savingRef.current = true;
        setSaving(true);
        try {
            const out = photos && keys.length
                ? await photos.run('draft', form, keys, store)
                : { result: await store(form), map: new Map() };
            const { res, data } = out.result;
            if (out.map.size) setForm(replacePendingInForm(formRef.current, keys, out.map));
            setSnap({ session, id: res.row.id, json: JSON.stringify(data), sig: null, version: null });
            discardGone(prevJson, data);
            return res;
        } catch (err) {
            if (err === notSaved || isSaveCancelled(err)) return null;         // 창을 닫아 취소된 저장 — 올린 사진은 이미 지웠다
            console.error('임시저장 실패:', err);
            alert(isImageUploadError(err) ? PHOTO_UPLOAD_MESSAGE : draftErrorMessage(err));
            return null;
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };
    const loadDraft = (item) => {
        if (blocked || drafts.busy || savingRef.current) return;
        if (isRich) {
            if (!blank && !window.confirm('작성 중인 내용 대신 불러올까요?')) return;
            const data = drafts.load(item);
            const { form: next, doc, skipped } = spec.fromData(data, { boardKey: rich.boardKey, ownerId: rich.ownerId });
            const version = rich.loadDoc(doc);
            setSnap({ session: drafts.session, id: item.id, json: JSON.stringify(data ?? null), sig: spec.sigOf(next), version });
            setForm(next);
            if (skipped > 0) alert(`옮기지 못한 사진 ${skipped}장은 빠졌어요.`);
            return;
        }
        // 서식 원고는 이 화면(아직 서식 편집기가 아닌 게시판)에서 불러오지 않는다 — 불러오기(ticket)보다 먼저 거른다
        if (isRichDraft(item?.data)) { alert(RICH_DRAFT_MESSAGE); return; }
        if (!spec.isBlank(form) && !window.confirm('작성 중인 내용 대신 불러올까요?')) return;
        const next = spec.fromData(drafts.load(item));
        setSnap({ session: drafts.session, id: item.id, json: JSON.stringify(spec.toData(next)), sig: null, version: null });
        setForm(next);
    };
    const removeDraft = async (item) => {
        if (drafts.busy || savingRef.current) return;
        if (!window.confirm('이 임시저장 글을 지울까요?')) return;
        let removed = false;
        try {
            removed = await drafts.remove(item.id);
        } catch (err) {
            console.error('임시저장 삭제 실패:', err);
            alert('지우지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
        }
        // 원고의 사진을 지운다. 지금 폼(서식 게시판은 편집기 문서까지)에 들어 있는 사진은 남긴다(그대로 등록할 수 있다).
        if (removed) {
            const current = isRich ? { form: formRef.current, doc: rich.handle()?.getDocJSON() ?? null } : formRef.current;
            const gone = objectsRemoved(item?.data, current);
            if (gone.length) {
                void discardImages(gone, drafts.userId);
                if (isRich) rich.handle()?.markDiscarded(gone);
            }
            const goneIds = new Set(gone.map((o) => `${o.bucket}/${o.name}`));
            const kept = objectsRemoved(item?.data, null).filter((o) => !goneIds.has(`${o.bucket}/${o.name}`));
            if (kept.length) {
                if (keptRef.current.session !== drafts.session) keptRef.current = { session: drafts.session, list: [] };
                keptRef.current.list.push(...kept);
            }
        }
    };
    // 등록 요청 직전에 잡는다: 불러온 원고(버전)와 그 원고 내용. 등록이 성공하면 consumeDraft(ticket, 등록한 값).
    const takeTicket = () => ({ t: drafts.ticket(), prevJson: saved });
    const consumeDraft = (ticket, savedValues) => {
        flushKept(savedValues);                              // 지운 원고에서 남겨 둔 사진 중 등록한 글에 없는 것
        const done = drafts.consume(ticket?.t);
        if (!ticket?.t || !ticket.prevJson) return;
        let prev = null;
        try { prev = JSON.parse(ticket.prevJson); } catch { return; }
        const gone = objectsRemoved(prev, savedValues);
        if (!gone.length) return;
        // 원고가 지워진 뒤에 부른다 — 먼저 부르면 서버가 "원고에서 쓰는 사진"으로 보고 남긴다
        Promise.resolve(done).then(() => discardImages(gone, drafts.userId));
    };
    const requestClose = (close0) => {
        // 창을 닫으면(저장 안 함·그냥 닫기) 지운 원고에서 남겨 둔 사진도 버린 것이다 — 서버가 쓰는 곳을 확인하고 지운다
        const close = () => { flushKept(null); close0(); };
        if (!isDirtyNow()) { close(); return; }
        const req = { session: drafts.session, close };
        askRef.current = req;
        setAsk(req);
    };
    const dismiss = () => { askRef.current = null; setAsk(null); };
    const liveAsk = !!ask && ask.session === drafts.session && !!drafts.enabled;
    const closeDialog = {
        open: liveAsk,
        saving: drafts.busy || saving,
        onSave: async () => {
            const req = askRef.current;
            const res = await saveDraft();
            if (!res) return;                      // 저장 실패면 창을 그대로 둔다(안내는 saveDraft 가 띄움)
            if (askRef.current !== req || !req) return;   // 저장 도중 취소했으면 닫지 않는다
            dismiss();
            req.close();
        },
        onDiscard: () => {
            const req = askRef.current;
            dismiss();
            req?.close();
        },
        onCancel: dismiss,
    };
    // 임시저장 버튼 문구: 사진 올리는 중이면 '사진 올리는 중 n/N', 원고 저장 중이면 '저장 중...'
    const draftBusyLabel = (photos?.label('draft')) || (saving ? '저장 중...' : '');
    return { saveDraft, loadDraft, removeDraft, requestClose, closeDialog, dirty, takeTicket, consumeDraft, draftSaving: saving, draftBusyLabel };
}

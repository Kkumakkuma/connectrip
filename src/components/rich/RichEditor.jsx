// 게시판 서식 편집기(2026-09-27 서식 편집기 2단계, 설계 plan_v3 6장 + plan_stage2). React.lazy 로만 불러온다(TipTap 은 이 청크에만).
//
// 쓰는 쪽(글쓰기·수정 폼) 계약:
//   <RichEditor handleRef={ref} boardKey="review" userId={uid} initialDoc={env|null} maxChars={20000}
//               instanceKey={n} onState={(s) => …} ariaLabel="후기 내용" placeholder="…" />
//   - 문서는 편집기가 쥔다. 폼에는 onState 로 받은 { version, blank, plainLength, images, dead, preparing, locked } 만 둔다(8-4).
//     version 은 편집기 인스턴스(instanceKey)마다 다른 문자열 — "저장 안 한 내용" 비교에 쓴다.
//   - 저장(등록·수정·임시저장): const s = await ref.current.prepareSave()
//       → s.error 가 있으면 안내하고 멈춘다(ref.current.finishSave(s.token) 불필요 — 이미 풀려 있다).
//       → 아니면 s.env(대기 키가 든 정리된 문서)·s.pending(문서 순서 대기 사진)으로 업로드·저장(useImageSave.runDoc).
//       → 끝나면 반드시 ref.current.finishSave(s.token, 성공이면 { savedEnv, map } | 실패면 null).
//     prepareSave 는 조합 중인 글자를 확정하고(6-3) 편집기를 잠근다(codex B3 — 도구막대·시트·사진 준비 완료 삽입도 막힌다).
//   - 원고 덮어쓰기·삭제로 서버에서 지운 사진: ref.current.markDiscarded(objectsRemoved 결과)(agy B2).
//   - 원고 불러오기는 쓰는 쪽이 instanceKey 를 바꿔 새 편집기로 연다(되돌리기 기록도 새로 시작).
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { buildExtensions } from './editor/extensions';
import Toolbar from './editor/Toolbar';
import { LinkSheet, MapInsertSheet, VideoInsertSheet } from './editor/sheets';
import { imageCount } from './editor/shared';
import { commitSaved, mediaSignature } from './editor/commit';
import { docImages, docToPlain, isDocEmpty, sanitizeDoc } from '../../lib/rich/doc';
import { LIMITS, mediaOf } from '../../lib/rich/schema';
import { IMAGES_MAX } from '../../lib/postLimits';
import { ALLOWED_TYPES, MAX_FILE_SIZE, TYPE_ERROR, prepareImageFile } from '../../lib/imageUpload';
import { makePendingImage } from '../../lib/pendingImages';
import { flushComposition } from '../../lib/rich/composition';

const REPORT_MS = 150;

// 살아 있는 편집기의 사진 저장소(파괴된 편집기는 null). TipTap 의 isDestroyed 는 아직 화면에 붙기 전(EditorContent 가
// 붙이기 전)에도 참이라 쓰지 않는다 — destroy() 는 저장소를 비우므로(@tiptap/core 실측) 저장소 유무로 가른다.
const storeOf = (ed) => (ed && ed.storage && ed.storage.ctMedia ? ed.storage.ctMedia : null);

const countType = (doc, name) => {
    let n = 0;
    doc.forEach((c) => { if (c.type.name === name) n += 1; });
    return n;
};

// 선택 위치를 기억해 두고 이후 변경을 따라 옮긴다(사진을 고르는 사이 글이 바뀌어도 누른 자리에 넣는다)
function trackInsertPoint(editor, useEnd) {
    let bm = editor.state.selection.getBookmark();
    const onTr = ({ transaction }) => { bm = bm.map(transaction.mapping); };
    editor.on('transaction', onTr);
    let stopped = false;
    return {
        stop: () => { if (!stopped) { stopped = true; editor.off('transaction', onTr); } },
        // 선택된 칸(사진 등)을 덮어쓰지 않게 선택 끝에 넣는다. 한 번도 쓰지 않은 편집기는 글 끝.
        pos: () => (useEnd ? editor.state.doc.content.size : bm.resolve(editor.state.doc).to),
        // 누를 때의 선택 범위(링크 시트 — 입력칸으로 포커스가 옮겨가도 고른 글자에 링크를 건다, agy)
        range: () => {
            const sel = bm.resolve(editor.state.doc);
            return { from: sel.from, to: sel.to };
        },
    };
}

// 문서 안 첫 번째 "지워진 사진" 칸의 위치(없으면 -1)
function findDead(doc, store) {
    let at = -1;
    doc.forEach((n, offset) => {
        if (at >= 0) return;
        const refs = n.type.name === 'image' ? [n.attrs.src] : n.type.name === 'gallery' ? (n.attrs.images || []) : [];
        if (refs.some((r) => store.isDead(r))) at = offset;
    });
    return at;
}

const RichEditor = ({ handleRef, boardKey, userId, initialDoc = null, maxChars, instanceKey = 0, onState, ariaLabel = '내용', ariaDescribedBy, placeholder = '내용을 입력해 주세요' }) => {
    const mode = mediaOf(boardKey);
    const photos = mode === 'private' || mode === 'public';
    const bucket = mode === 'private' ? 'post-images' : 'images';
    const versionRef = useRef(0);
    const plainLenRef = useRef(0);
    const focusedOnceRef = useRef(false);
    const aliveRef = useRef(true);
    const onStateRef = useRef(onState);
    useEffect(() => { onStateRef.current = onState; });
    const [sheet, setSheet] = useState(null);          // { kind: 'link'|'map'|'video', tracker? }
    const sheetRef = useRef(null);
    useEffect(() => { sheetRef.current = sheet; });
    const [notice, setNotice] = useState('');
    const [counts, setCounts] = useState({ plainLength: 0, images: 0 });
    const noticeTimer = useRef(null);
    const fileRef = useRef(null);
    const pickRef = useRef(null);                       // { max, onStart, resolve }
    const timerRef = useRef(null);

    // 확장은 편집기마다 한 번(쓰는 쪽이 새 편집기가 필요하면 instanceKey 로 다시 만든다)
    const extensions = useMemo(
        () => buildExtensions({ boardKey, userId, maxChars, placeholder, plainLength: () => plainLenRef.current }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );

    const say = useCallback((text) => {
        if (!aliveRef.current) return;
        setNotice(text);
        clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => { if (aliveRef.current) setNotice(''); }, 5000);
    }, []);

    const editorRef = useRef(null);
    const report = useCallback(() => {
        timerRef.current = null;
        const ed = editorRef.current;
        const store = storeOf(ed);
        if (!store || !aliveRef.current) return;
        const json = ed.getJSON();
        const plain = docToPlain(json);
        plainLenRef.current = plain.length;
        const images = imageCount(ed.state.doc);
        setCounts((c) => (c.plainLength === plain.length && c.images === images ? c : { plainLength: plain.length, images }));
        onStateRef.current?.({
            version: `${instanceKey}:${versionRef.current}`,
            blank: isDocEmpty(json),
            plainLength: plain.length,
            images,
            dead: findDead(ed.state.doc, store) >= 0,
            preparing: store.getPreparing() > 0,
            locked: store.isLocked(),
        });
    }, [instanceKey]);
    const schedule = useCallback(() => {
        if (timerRef.current) return;
        timerRef.current = setTimeout(report, REPORT_MS);
    }, [report]);

    const editor = useEditor({
        extensions,
        content: initialDoc && initialDoc.doc ? initialDoc.doc : undefined,
        immediatelyRender: true,
        shouldRerenderOnTransaction: false,
        editorProps: {
            attributes: {
                lang: 'ko',
                role: 'textbox',
                'aria-multiline': 'true',
                'aria-label': ariaLabel,
                ...(ariaDescribedBy ? { 'aria-describedby': ariaDescribedBy } : {}),
                class: 'ct-editor-body',
            },
        },
        onUpdate: ({ transaction }) => {
            // 글이 바뀐 트랜잭션만 센다. 저장 반영(키 → 참조, ctCommit)은 사용자가 바꾼 것이 아니라 빼고(codex B4),
            // 되돌리기·다시 하기는 센다.
            if (transaction.docChanged && !transaction.getMeta('ctCommit')) versionRef.current += 1;
            schedule();
        },
        onFocus: () => { focusedOnceRef.current = true; },
    }, []);
    useEffect(() => { editorRef.current = editor; }, [editor]);

    // 저장소 연결: 안내 한 줄·사진 고르기·잠금/준비 변화 알림
    // 개발 모드(StrictMode)에서는 TipTap 이 편집기를 한 번 파괴·재생성한다 — 파괴된 편집기는 저장소가 비어 있으므로 건너뛰고,
    // 새 편집기가 오면(useEditor 가 다시 그림) 그때 연결한다(2026-09-27 로컬 E2E 실측).
    useEffect(() => {
        aliveRef.current = true;
        const store = storeOf(editor);
        if (!store) return undefined;
        store.setNotice(say);
        store.setPicker((opts) => pickFiles(opts));
        const off = store.subscribe(schedule);
        schedule();                      // 첫 상태 알림(효과 안에서 곧바로 상태를 바꾸지 않게 다음 틱에)
        return () => {
            aliveRef.current = false;
            off();
            store.setNotice(null);
            store.setPicker(null);
            // 열려 있던 시트의 위치 추적·기다리던 사진 고르기를 정리한다(agy)
            sheetRef.current?.tracker?.stop();
            pickRef.current?.resolve([]);
            pickRef.current = null;
            clearTimeout(timerRef.current);
            clearTimeout(noticeTimer.current);
            timerRef.current = null;
        };
        // pickFiles 는 ref 만 쓰는 안정 함수
    }, [editor, say, schedule]);

    // ── 사진 고르기(서버에 올리지 않는다 — 리사이즈만 해서 대기 사진 표에) ──────────────
    function pickFiles({ max, onStart } = {}) {
        return new Promise((resolve) => {
            if (!fileRef.current || max <= 0) { resolve([]); return; }
            pickRef.current?.resolve([]);                   // 앞서 열고 고르지 않은 요청은 끝낸다
            pickRef.current = { max, onStart, resolve };
            fileRef.current.value = '';
            fileRef.current.click();
        });
    }
    // 사진 고르기 창을 취소하면 change 가 오지 않는다 — cancel 이벤트로 기다림을 끝낸다(agy: 위치 추적이 남지 않게)
    useEffect(() => {
        const el = fileRef.current;
        if (!el) return undefined;
        const onCancel = () => {
            const req = pickRef.current;
            pickRef.current = null;
            req?.resolve([]);
        };
        el.addEventListener('cancel', onCancel);
        return () => el.removeEventListener('cancel', onCancel);
    }, [photos]);
    const onFiles = async (e) => {
        const req = pickRef.current;
        pickRef.current = null;
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (!req) return;
        const ed = editorRef.current;
        const store = storeOf(ed);
        if (!files.length || !store) { req.resolve([]); return; }
        const notes = [];
        const valid = files.filter((f) => {
            if (!ALLOWED_TYPES.has(f.type)) { notes.push(`${TYPE_ERROR} 다른 파일은 뺐어요.`); return false; }
            if (f.size > MAX_FILE_SIZE) { notes.push('5MB가 넘는 사진은 뺐어요.'); return false; }
            return true;
        });
        const picked = valid.slice(0, req.max);
        if (valid.length > req.max) notes.push(`사진은 ${req.max}장만 더 넣을 수 있어 나머지는 뺐어요.`);
        if (!picked.length) { if (notes.length) say([...new Set(notes)].join(' ')); req.resolve([]); return; }
        req.onStart?.();
        store.setPreparing(1);
        const keys = [];
        try {
            for (const f of picked) {
                if (!aliveRef.current || ed.isDestroyed) break;
                const prepared = await prepareImageFile(f);         // 리사이즈·압축(실패하면 원본) — 서버 호출 없음
                if (!aliveRef.current || ed.isDestroyed) break;
                const item = makePendingImage(prepared, bucket);
                store.addPending(item);
                keys.push(item.key);
            }
        } finally {
            store.setPreparing(-1);
        }
        if (notes.length) say([...new Set(notes)].join(' '));
        req.resolve(aliveRef.current ? keys : []);
    };

    // 도구막대 사진·사진 묶음
    const onPhoto = async (kind) => {
        const ed = editorRef.current;
        const store = storeOf(ed);
        if (!store || store.isLocked()) return;
        await flushComposition(ed.view);                  // 조합 중이던 글자를 먼저 확정(agy)
        if (!storeOf(ed) || store.isLocked()) return;
        const room = IMAGES_MAX - imageCount(ed.state.doc);
        if (room <= 0) { say(`사진은 글 하나에 ${IMAGES_MAX}장까지 넣을 수 있어요.`); return; }
        if (kind === 'gallery' && room < 2) { say('사진 묶음은 2장부터예요. 남은 자리가 모자라요.'); return; }
        const max = kind === 'gallery' ? Math.min(LIMITS.galleryMax, room) : room;
        const tracker = trackInsertPoint(ed, !focusedOnceRef.current);
        const keys = await pickFiles({ max });
        tracker.stop();
        if (!keys.length || ed.isDestroyed || !aliveRef.current) return;
        if (store.isLocked()) return;
        const pos = tracker.pos();
        let content;
        if (kind === 'gallery' && keys.length >= 2) {
            store.setAutoOpen(keys[0]);
            content = [{ type: 'gallery', attrs: { layout: 'grid', images: keys } }];
        } else {
            if (kind === 'gallery') say('1장만 골라 사진 한 장으로 넣었어요.');
            content = keys.map((k) => ({ type: 'image', attrs: { src: k } }));
        }
        ed.chain().focus().insertContentAt(pos, content).run();
    };

    // 지도·영상·링크 시트
    const openSheet = async (kind) => {
        const ed = editorRef.current;
        if (!storeOf(ed) || ed.storage.ctMedia.isLocked()) return;
        await flushComposition(ed.view);                  // 조합 중이던 글자를 먼저 확정(agy)
        if (!storeOf(ed) || ed.storage.ctMedia.isLocked()) return;
        if (kind === 'map' && countType(ed.state.doc, 'map') >= LIMITS.maps) { say(`지도는 글 하나에 ${LIMITS.maps}개까지 넣을 수 있어요.`); return; }
        if (kind === 'video' && countType(ed.state.doc, 'video') >= LIMITS.videos) { say(`영상은 글 하나에 ${LIMITS.videos}개까지 넣을 수 있어요.`); return; }
        setSheet({ kind, tracker: trackInsertPoint(ed, !focusedOnceRef.current), href: ed.getAttributes('link').href || '' });
    };
    const closeSheet = () => {
        sheetRef.current?.tracker?.stop();
        setSheet(null);
    };
    const insertNode = (node) => {
        const ed = editorRef.current;
        const s = sheet;
        closeSheet();
        if (!ed || ed.isDestroyed || !s || ed.storage.ctMedia.isLocked()) return;
        ed.chain().focus().insertContentAt(s.tracker.pos(), [node]).run();
    };
    // 링크 시트를 열 때의 선택 범위로 되돌린 뒤 건다(모바일에서 입력칸으로 포커스가 옮겨가도 — agy)
    const restoreRange = (ed, s) => {
        const r = s?.tracker?.range();
        if (r) ed.commands.setTextSelection(r);
    };
    const applyLink = (href) => {
        const ed = editorRef.current;
        const s = sheetRef.current;
        if (!ed || ed.isDestroyed || ed.storage.ctMedia.isLocked()) { closeSheet(); return; }
        restoreRange(ed, s);
        closeSheet();
        const { empty } = ed.state.selection;
        if (empty && !ed.isActive('link')) {
            ed.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
        } else {
            ed.chain().focus().extendMarkRange('link').setLink({ href }).run();
        }
    };
    const removeLink = () => {
        const ed = editorRef.current;
        const s = sheetRef.current;
        if (!ed || ed.isDestroyed || ed.storage.ctMedia.isLocked()) { closeSheet(); return; }
        restoreRange(ed, s);
        closeSheet();
        ed.chain().focus().extendMarkRange('link').unsetLink().run();
    };

    // ── 쓰는 쪽에 주는 손잡이 ────────────────────────────────────────
    useImperativeHandle(handleRef, () => {
        // 잠금은 그 토큰의 주인만 푼다(늦게 끝난 다른 저장이 새 저장의 잠금을 풀지 못하게 — codex m1)
        const release = (token) => {
            const ed = editorRef.current;
            const store = storeOf(ed);
            if (!store || ed.isDestroyed || !store.ownsLock(token)) return;
            ed.setEditable(true, false);
            store.unlock(token);
            report();
        };
        // 저장 성공 뒤: 화면 문서를 실제 저장한 문서와 맞춘다(키 → 참조, 다르면 문서째 — editor/commit.js)
        const commit = (savedEnv, map) => commitSaved(editorRef.current, savedEnv, map);
        return {
            async prepareSave() {
                const ed = editorRef.current;
                if (!ed || ed.isDestroyed) return { error: 'GONE' };
                const store = ed.storage.ctMedia;
                if (store.getPreparing() > 0) return { error: 'PREPARING' };
                await flushComposition(ed.view);
                if (ed.isDestroyed) return { error: 'GONE' };
                const token = store.lock();
                if (!token) return { error: 'BUSY' };
                // 잠근 뒤 어떤 예외가 나도 잠금을 풀고 던진다(쓰는 쪽은 토큰을 받기 전이라 풀 수 없다 — agy)
                try {
                    ed.setEditable(false, false);
                    const deadAt = findDead(ed.state.doc, store);
                    if (deadAt >= 0) {
                        release(token);
                        ed.chain().focus().setNodeSelection(deadAt).scrollIntoView().run();
                        return { error: 'DEAD_IMAGES' };
                    }
                    const raw = ed.getJSON();
                    const env = sanitizeDoc(raw, boardKey, userId, { pendingOk: store.isPendingKey });
                    // 정리에서 사진·지도·영상 칸이 빠지면(개수 한도 초과 등) 조용히 빼지 않고 저장을 멈춘다(codex B1)
                    if (mediaSignature(raw) !== mediaSignature(env.doc)) { release(token); return { error: 'DROPPED' }; }
                    const plain = docToPlain(env);
                    if (plain.length > maxChars) { release(token); return { error: 'TOO_LONG', plainLength: plain.length }; }
                    const pending = docImages(env).filter((r) => store.isPendingKey(r)).map((k) => store.pending.get(k));
                    return {
                        token, env, pending,
                        plainLength: plain.length,
                        blank: isDocEmpty(env),
                        version: `${instanceKey}:${versionRef.current}`,
                    };
                } catch (err) {
                    release(token);
                    throw err;
                }
            },
            finishSave(token, result = null) {
                const ed = editorRef.current;
                const store = storeOf(ed);
                if (!store || ed.isDestroyed || !store.ownsLock(token)) return;
                if (result?.savedEnv) commit(result.savedEnv, result.map);
                release(token);
            },
            markDiscarded(list) {
                const ed = editorRef.current;
                if (!ed || ed.isDestroyed) return;
                ed.storage.ctMedia.markDead(list);
            },
            getDocJSON() {
                const ed = editorRef.current;
                return ed && !ed.isDestroyed ? ed.getJSON() : null;
            },
            version: () => `${instanceKey}:${versionRef.current}`,
            // 지금 문서가 빈 글인가(닫기 확인 판정용 — 150ms 늦은 알림값이 아니라 지금 값, codex B3)
            isBlank() {
                const ed = editorRef.current;
                return ed && !ed.isDestroyed ? isDocEmpty(ed.getJSON()) : true;
            },
            focus() {
                const ed = editorRef.current;
                if (ed && !ed.isDestroyed) ed.commands.focus();
            },
        };
    }, [boardKey, userId, maxChars, instanceKey, report]);

    const over = counts.plainLength > maxChars;
    const left = IMAGES_MAX - counts.images;
    return (
        <div className="ct-editor rounded-md border border-hairline" data-ct-editor="">
            {storeOf(editor) && (
                <Toolbar
                    editor={editor}
                    photos={photos}
                    imagesLeft={left}
                    onPhoto={onPhoto}
                    onMap={() => openSheet('map')}
                    onVideo={() => openSheet('video')}
                    onLink={() => openSheet('link')}
                />
            )}
            {notice && <p className="border-b border-hairline-soft bg-surface-soft px-3 py-2 text-[13px] text-body" role="status" aria-live="polite">{notice}</p>}
            <EditorContent editor={editor} className="px-3 py-3" />
            <p className={`border-t border-hairline-soft px-3 py-1.5 text-right text-[12px] tabular-nums ${over ? 'font-bold text-error' : 'text-muted'}`} aria-live={over ? 'polite' : undefined}>
                {counts.plainLength.toLocaleString()} / {maxChars.toLocaleString()}자
                {over && <span className="ml-1">{'\u2060'}· 글자 수를 넘었어요</span>}
            </p>
            {photos && (
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onFiles} tabIndex={-1} aria-hidden="true" />
            )}
            {sheet?.kind === 'link' && (
                <LinkSheet initial={sheet.href} hasLink={!!sheet.href} onApply={applyLink} onRemove={removeLink} onClose={closeSheet} />
            )}
            {sheet?.kind === 'map' && (
                <MapInsertSheet onInsert={(attrs) => insertNode({ type: 'map', attrs })} onClose={closeSheet} />
            )}
            {sheet?.kind === 'video' && (
                <VideoInsertSheet onInsert={(v) => insertNode({ type: 'video', attrs: v })} onClose={closeSheet} />
            )}
        </div>
    );
};

export default RichEditor;

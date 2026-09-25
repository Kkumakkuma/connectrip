import { useCallback, useEffect, useRef, useState } from 'react';
import { loadDraft, pruneDrafts, removeDraft, saveDraft } from './draftStore';

// 글쓰기 폼 임시저장 훅(2026-09-25). 저장소 규칙은 draftStore.js.
//
//   const draft = useDraft({ key, open, value: form, isEmpty, onRestore: (data) => setForm((f) => ({ ...f, ...data })) });
//   - open 이 켜지는 순간 저장된 원고가 있으면 onRestore 로 폼에 채우고 draft.restoredAt 을 세운다.
//   - 폼이 열려 있는 동안 값이 바뀌면 잠깐(delay) 뒤 저장한다. 창을 닫거나(open → false) 화면을 떠나거나
//     페이지가 숨겨질 때(탭 전환·앱 백그라운드·새로고침)는 기다리지 않고 바로 저장한다.
//   - 사용자가 연 뒤 한 번도 고치지 않았으면 저장하지 않는다. 열자마자 닫았을 때 빈 폼이 저장본을 지우지 않게,
//     불러오기만 하고 안 고친 원고를 다시 쓰지 않게(다른 탭에서 등록해 지운 원고가 되살아나지 않게, codex·agy 9/25).
//     개발 모드 StrictMode 의 effect 이중 실행도 같은 경로다.
//   - 글자가 하나도 없으면(isEmpty) 저장 대신 지운다(다 지우고 닫으면 저장본도 없어진다).
//   - 등록할 때: 요청 보내기 전에 const k = draft.key 로 잡아 두고, 성공하면 draft.clear(k).
//     응답이 늦게 와서 그사이 다른 탭(=다른 키)으로 옮겨 갔어도 등록한 원고만 지운다(codex 9/25).
//     바로 이어지는 창 닫기에서 다시 저장하지 않는다. 창을 닫지 않는 폼(같은 편 게시판 입력칸)은 그 뒤 새로 입력하면 다시 저장한다.
//   - draft.discard() 는 저장본만 지운다(폼 비우기는 부르는 쪽이 한다).
//   - draft.saveNow() 는 "임시저장" 버튼용 — 저장 시각(ms)을 돌려준다.
// value 는 값이 바뀔 때만 새 객체여야 한다(렌더마다 새로 만들면 useMemo 로 감쌀 것).
export function useDraft({ key, open, value, isEmpty, onRestore, delay = 600 }) {
    const [restoredAt, setRestoredAt] = useState(null);
    const [savedAt, setSavedAt] = useState(null);
    const timer = useRef(null);
    const latest = useRef(value);
    const openedWith = useRef(value);   // 사용자가 고치기 전 값(연 순간 또는 불러온 직후)
    const restoring = useRef(false);    // 다음 값 변화는 불러오기 때문 — 편집으로 치지 않는다
    const dirty = useRef(false);        // 사용자가 고쳤는가
    const skip = useRef(false);         // clear() 뒤 닫힐 때 다시 저장하지 않게
    const clearedWith = useRef(null);   // clear() 순간의 값 — 그 뒤 새로 입력하면(창을 안 닫는 폼) 다시 저장한다
    const keyRef = useRef(key);
    const isEmptyRef = useRef(isEmpty);
    const onRestoreRef = useRef(onRestore);
    useEffect(() => {
        latest.current = value;
        keyRef.current = key;
        isEmptyRef.current = isEmpty;
        onRestoreRef.current = onRestore;
    });

    const flush = useCallback(() => {
        clearTimeout(timer.current);
        timer.current = null;
        const k = keyRef.current;
        if (skip.current || !k || !dirty.current) return null;
        const v = latest.current;
        if (isEmptyRef.current(v)) {
            removeDraft(k);
            setSavedAt(null);
            return null;
        }
        const t = saveDraft(k, v);
        if (t) setSavedAt(t);
        return t;
    }, []);

    // 열릴 때 저장본 불러오기 — 저장 effect 보다 먼저 선언해야 빈 폼이 저장본을 덮지 않는다.
    // 상태 반영은 마이크로태스크에서 한다(effect 안에서 곧바로 setState 하면 렌더가 연쇄된다 —
    // react-hooks/set-state-in-effect, SuggestedPlaces.jsx 와 같은 방식). 닫히거나 키가 바뀌면 취소한다.
    useEffect(() => {
        if (!open || !key) return undefined;
        skip.current = false;
        dirty.current = false;
        restoring.current = false;
        openedWith.current = latest.current;
        pruneDrafts();
        const d = loadDraft(key);
        let alive = true;
        Promise.resolve().then(() => {
            if (!alive) return;
            setSavedAt(null);
            if (d && !isEmptyRef.current(d.data)) {
                restoring.current = true;
                onRestoreRef.current?.(d.data);
                setRestoredAt(d.savedAt);
            } else {
                setRestoredAt(null);
            }
        });
        return () => { alive = false; };
    }, [open, key]);

    // 값이 바뀌면 잠깐 뒤 저장
    useEffect(() => {
        if (!open || !key) return undefined;
        latest.current = value;
        if (restoring.current) {
            restoring.current = false;
            openedWith.current = value;           // 불러온 값이 새 기준 — 여기서부터 고친 것만 저장
        } else if (value !== openedWith.current) {
            dirty.current = true;
        }
        if (skip.current && value !== clearedWith.current) skip.current = false;
        clearTimeout(timer.current);
        timer.current = setTimeout(flush, delay);
        return () => clearTimeout(timer.current);
    }, [open, key, value, delay, flush]);

    // 닫히거나 화면을 떠날 때 바로 저장 + 페이지가 숨겨질 때(탭 전환·앱 백그라운드·새로고침) 바로 저장
    useEffect(() => {
        if (!open || !key) return undefined;
        const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', onHide);
        return () => {
            window.removeEventListener('pagehide', flush);
            document.removeEventListener('visibilitychange', onHide);
            flush();
        };
    }, [open, key, flush]);

    // k = 등록 요청을 보낼 때의 키. 지금 키와 다르면(그사이 다른 탭으로 옮김) 그 원고만 지우고 지금 폼은 건드리지 않는다.
    const clear = useCallback((k = keyRef.current) => {
        removeDraft(k);
        if (k !== keyRef.current) return;
        clearTimeout(timer.current);
        timer.current = null;
        skip.current = true;
        clearedWith.current = latest.current;
        setRestoredAt(null);
        setSavedAt(null);
    }, []);

    const discard = useCallback(() => {
        clearTimeout(timer.current);
        timer.current = null;
        removeDraft(keyRef.current);
        setRestoredAt(null);
        setSavedAt(null);
    }, []);

    const saveNow = useCallback(() => {
        dirty.current = true;
        return flush();
    }, [flush]);

    return { key, restoredAt, savedAt, clear, discard, saveNow };
}

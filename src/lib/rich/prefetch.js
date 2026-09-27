// 서식 편집기 청크 미리 받기(2026-09-27, 설계 plan_v3 6-1). TipTap 은 편집기 청크에만 있다.
// 게시판 목록이 뜬 뒤 한가할 때(requestIdleCallback, 없으면 2초 뒤)와 글쓰기 단추에 손이 갈 때 받아 둔다.
let loading = null;

export function loadRichEditor() {
    if (!loading) {
        loading = import('../../components/rich/RichEditor').catch((err) => {
            loading = null;           // 다음에 다시 시도(네트워크 끊김 등)
            throw err;
        });
    }
    return loading;
}

export function prefetchRichEditor() {
    loadRichEditor().catch(() => {});
}

export function prefetchRichEditorWhenIdle() {
    if (typeof window === 'undefined') return () => {};
    if (typeof window.requestIdleCallback === 'function') {
        const id = window.requestIdleCallback(prefetchRichEditor, { timeout: 4000 });
        return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(prefetchRichEditor, 2000);
    return () => clearTimeout(t);
}

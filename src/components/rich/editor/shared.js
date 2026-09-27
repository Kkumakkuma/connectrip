// 서식 편집기 조각들이 함께 쓰는 도구(2026-09-27 서식 편집기 2단계).
import { useSyncExternalStore } from 'react';
import { NodeSelection } from '@tiptap/pm/state';
import { IMAGES_MAX } from '../../../lib/postLimits';
import { LIMITS } from '../../../lib/rich/schema';

export const LAYOUT_LABEL = Object.freeze({ grid: '콜라주', slide: '한 장씩', strip: '옆으로 나열' });

// 편집기 사진 저장소(mediaStore)를 구독한다 — 지워진 사진·잠금·준비 상태가 바뀌면 다시 그린다.
export function useMediaStore(editor) {
    const store = editor.storage.ctMedia;
    useSyncExternalStore(store.subscribe, store.getRev, store.getRev);
    return store;
}

// 문서 최상위 칸 하나를 위(-1)·아래(+1)로 한 칸 옮긴다(모바일에서 끌기 대신 — "원하는 위치로")
export function moveBlock(editor, getPos, dir) {
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (typeof pos !== 'number' || editor.storage.ctMedia.isLocked()) return;
    const { state } = editor;
    const node = state.doc.nodeAt(pos);
    if (!node) return;
    const $pos = state.doc.resolve(pos);
    if ($pos.depth !== 0) return;
    const index = $pos.index();
    const parent = $pos.parent;
    const tr = state.tr;
    if (dir < 0) {
        if (index === 0) return;
        const prevStart = pos - parent.child(index - 1).nodeSize;
        tr.delete(pos, pos + node.nodeSize).insert(prevStart, node);
        tr.setSelection(NodeSelection.create(tr.doc, prevStart));
    } else {
        if (index >= parent.childCount - 1) return;
        const afterNext = pos + node.nodeSize + parent.child(index + 1).nodeSize;
        tr.insert(afterNext, node).delete(pos, pos + node.nodeSize);
        tr.setSelection(NodeSelection.create(tr.doc, afterNext - node.nodeSize));
    }
    editor.view.dispatch(tr.scrollIntoView());
}

// 문서 안 서로 다른 사진 수(단일 사진 + 묶음, 대기 키 포함)
export function imageCount(doc) {
    const set = new Set();
    doc.forEach((n) => {
        if (n.type.name === 'image' && typeof n.attrs.src === 'string') set.add(n.attrs.src);
        else if (n.type.name === 'gallery') for (const r of n.attrs.images || []) if (typeof r === 'string') set.add(r);
    });
    return set.size;
}

// 묶음 편집 시트에서 이 묶음에 둘 수 있는 최대 장수 — 묶음 한도(10장)와 글 전체 한도(20장)에서 이 묶음 밖 사진을 뺀 값 중
// 작은 쪽. 시트 안에서 사진을 빼면 그만큼 다시 넣을 수 있어야 한다(codex B2 — 예전에는 글 전체 남은 자리만 봐서 못 넣었다).
export function galleryLimit(doc, images) {
    const outside = imageCount(doc) - new Set(Array.isArray(images) ? images : []).size;
    return Math.max(0, Math.min(LIMITS.galleryMax, IMAGES_MAX - outside));
}

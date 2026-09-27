// 저장 전후에 편집기 문서와 저장본을 맞추는 순수 함수(2026-09-27 서식 편집기 2단계, codex B1). editor.test.js 가 실제 편집기로 확인한다.
import { replaceDocImages } from '../../../lib/rich/doc';

// 두 문서가 같은가 — 같은 스키마 노드로 바꿔 비교한다(기본 속성·마크 순서·이웃 글자 합치기 차이는 같게 본다)
export function sameDoc(schema, a, b) {
    try {
        return JSON.stringify(schema.nodeFromJSON(a).toJSON()) === JSON.stringify(schema.nodeFromJSON(b).toJSON());
    } catch {
        return false;
    }
}

// 문서의 사진·지도·영상 칸 요약(순서 포함). 저장 전 정리(sanitizeDoc)에서 칸이 빠지는지(개수 한도 초과 등) 본다 —
// 빠지면 조용히 빼고 저장하지 않고 저장을 멈춘다.
export function mediaSignature(doc) {
    const out = [];
    for (const n of Array.isArray(doc?.content) ? doc.content : []) {
        const a = n && n.attrs ? n.attrs : {};
        if (n?.type === 'image') out.push(`i:${a.src}`);
        else if (n?.type === 'gallery') out.push(`g:${(a.images || []).join(',')}`);
        else if (n?.type === 'map') out.push(`m:${a.placeId || ''}:${a.lat ?? ''}:${a.lng ?? ''}`);
        else if (n?.type === 'video') out.push(`v:${a.provider}:${a.id}`);
    }
    return out.join('|');
}

// 저장 성공 뒤 화면 문서를 실제 저장한 문서(savedEnv)와 맞춘다. map = 대기 키 → 올린 사진 참조.
//   키만 바꾼 화면 문서가 저장본과 같으면 사진 칸 속성만 바꾼다(커서·되돌리기 기록 유지).
//   다르면(정리에서 달라진 것) 문서째 저장본으로 바꾼다 — 비교는 정리 전 원문으로 한다(정리한 값끼리 비교하면
//   정리에서 빠진 것이 화면에만 남는다). 어느 쪽이든 사용자가 바꾼 것이 아니라 되돌리기·"고친 내용"에서 뺀다(ctCommit).
export function commitSaved(ed, savedEnv, map) {
    if (!ed || ed.isDestroyed || !savedEnv) return false;
    const m = map || new Map();
    const replaced = replaceDocImages({ v: 1, doc: ed.getJSON() }, m);
    if (sameDoc(ed.schema, replaced.doc, savedEnv.doc)) {
        const tr = ed.state.tr;
        ed.state.doc.forEach((node, offset) => {
            if (node.type.name === 'image' && m.has(node.attrs.src)) {
                tr.setNodeMarkup(offset, undefined, { ...node.attrs, src: m.get(node.attrs.src) });
            } else if (node.type.name === 'gallery' && (node.attrs.images || []).some((r) => m.has(r))) {
                tr.setNodeMarkup(offset, undefined, { ...node.attrs, images: node.attrs.images.map((r) => (m.has(r) ? m.get(r) : r)) });
            }
        });
        if (tr.docChanged) {
            tr.setMeta('ctCommit', true).setMeta('addToHistory', false);
            ed.view.dispatch(tr);
        }
        return true;
    }
    ed.chain()
        .command(({ tr }) => { tr.setMeta('ctCommit', true).setMeta('addToHistory', false); return true; })
        .setContent(savedEnv.doc)
        .run();
    return true;
}

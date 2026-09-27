// 편집기 안의 사진·묶음·지도·영상 칸(2026-09-27 서식 편집기 2단계, 설계 plan_v3 6-1·6-6·6-7, plan_stage2).
// - 편집기(contenteditable) 안에는 iframe 을 두지 않는다 — 지도·영상은 카드로만 보인다(실제 지도·재생은 글 보기 화면).
// - 사진 값이 대기 키면 브라우저 메모리의 파일로(화면에 떠 있는 동안만 blob 주소), 저장된 참조면 로그인 권한으로 받아 그린다.
// - 칸을 누르면(선택) 위·아래로 옮기기·지우기 단추가 뜬다. 모바일에서 끌기 대신 쓴다("원하는 위치로").
// - 서버에서 지운 사진(되돌리기로 되살아난 참조)은 빨간 테두리 + 안내 — 저장은 편집기가 막는다(agy B2).
import { useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { ArrowDown, ArrowUp, Images, MapPin, Pencil, PlaySquare, Trash2 } from 'lucide-react';
import { VIDEO_LABEL } from '../../../lib/rich/videoLink';
import { GalleryEditSheet } from './sheets';
import { LAYOUT_LABEL, galleryLimit, moveBlock, useMediaStore } from './shared';
import Thumb from './Thumb';

const EMPTY = [];

const keep = (e) => e.preventDefault();       // 단추를 눌러도 편집기 선택이 풀리지 않게

// 선택된 칸 위에 뜨는 단추 줄. 아이콘은 누름 대상이 되지 않게(pointer-events none) — 눌린 대상이 늘 button 이어야
// TipTap NodeView.stopEvent 가 편집기(ProseMirror)로 넘기지 않아 선택이 풀리지 않는다(agy — 터치에서 단추가 사라지는 문제).
function Controls({ editor, getPos, deleteNode, onEdit, editLabel, locked }) {
    return (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-white/95 p-1 shadow-md" contentEditable={false}>
            {onEdit && (
                <button type="button" onMouseDown={keep} onClick={onEdit} disabled={locked} aria-label={editLabel}
                    className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-bold text-ink hover:bg-surface-soft disabled:opacity-40">
                    <Pencil size={14} aria-hidden="true" className="pointer-events-none" /> 편집
                </button>
            )}
            <button type="button" onMouseDown={keep} onClick={() => moveBlock(editor, getPos, -1)} disabled={locked} aria-label="위로 옮기기"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-surface-soft disabled:opacity-40">
                <ArrowUp size={16} aria-hidden="true" className="pointer-events-none" />
            </button>
            <button type="button" onMouseDown={keep} onClick={() => moveBlock(editor, getPos, 1)} disabled={locked} aria-label="아래로 옮기기"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-surface-soft disabled:opacity-40">
                <ArrowDown size={16} aria-hidden="true" className="pointer-events-none" />
            </button>
            <button type="button" onMouseDown={keep} onClick={() => { if (!editor.storage.ctMedia.isLocked()) deleteNode(); }} disabled={locked} aria-label="지우기"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-rausch hover:bg-surface-soft disabled:opacity-40">
                <Trash2 size={16} aria-hidden="true" className="pointer-events-none" />
            </button>
        </div>
    );
}

function Frame({ selected, dead, children, className = '' }) {
    const ring = dead ? 'ring-2 ring-rausch' : selected ? 'ring-2 ring-ink' : 'ring-1 ring-hairline';
    return <div className={`relative my-3 overflow-hidden rounded-md ${ring} ${className}`}>{children}</div>;
}

const DEAD_TEXT = '지워진 사진이에요. 이 칸을 지우고 사진을 다시 넣어 주세요.';

export function ImageView({ node, editor, selected, getPos, deleteNode }) {
    const store = useMediaStore(editor);
    const src = node.attrs.src;
    const dead = store.isDead(src);
    return (
        <NodeViewWrapper data-ct-view="image">
            <Frame selected={selected} dead={dead}>
                <Thumb store={store} value={src} alt="글 안 사진" className="max-h-[60vh] min-h-[6rem] w-full bg-surface-soft object-contain" />
                {dead && <p className="bg-rausch-soft px-3 py-2 text-[13px] font-bold text-rausch" role="alert">{DEAD_TEXT}</p>}
                {selected && <Controls editor={editor} getPos={getPos} deleteNode={deleteNode} locked={store.isLocked()} />}
            </Frame>
        </NodeViewWrapper>
    );
}

export function GalleryView({ node, editor, selected, getPos, deleteNode, updateAttributes }) {
    const store = useMediaStore(editor);
    const images = Array.isArray(node.attrs.images) ? node.attrs.images : EMPTY;
    // 막 넣은 묶음이면 편집 시트를 바로 연다(보여 주는 방식을 고르게)
    const [open, setOpen] = useState(() => store.takeAutoOpen(images[0]));
    const dead = images.some((r) => store.isDead(r));
    const layout = node.attrs.layout;
    const apply = ({ layout: nextLayout, images: next }) => {
        setOpen(false);
        if (store.isLocked()) return;
        if (next.length >= 2) {
            updateAttributes({ layout: nextLayout, images: next });
        } else if (next.length === 1) {
            const pos = getPos();
            if (typeof pos !== 'number') return;
            const img = editor.schema.nodes.image.create({ src: next[0] });
            editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, img));
            store.notice('사진이 1장만 남아 사진 한 장으로 바꿨어요.');
        } else {
            deleteNode();
        }
    };
    const shown = images.slice(0, 6);
    return (
        <NodeViewWrapper data-ct-view="gallery">
            <Frame selected={selected} dead={dead} className="bg-surface-soft p-2">
                <div className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-ink" contentEditable={false}>
                    <Images size={15} aria-hidden="true" /> 사진 묶음 · {LAYOUT_LABEL[layout] || LAYOUT_LABEL.grid} · {images.length}장
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                    {shown.map((r) => (
                        <div key={r} className={`aspect-square overflow-hidden rounded ${store.isDead(r) ? 'ring-2 ring-rausch' : ''}`}>
                            <Thumb store={store} value={r} className="h-full w-full object-cover" />
                        </div>
                    ))}
                </div>
                {images.length > shown.length && <p className="mt-1 text-[12px] text-muted">외 {images.length - shown.length}장</p>}
                {dead && <p className="mt-2 text-[13px] font-bold text-rausch" role="alert">{DEAD_TEXT}</p>}
                {selected && (
                    <Controls editor={editor} getPos={getPos} deleteNode={deleteNode} locked={store.isLocked()}
                        onEdit={() => setOpen(true)} editLabel="사진 묶음 편집" />
                )}
            </Frame>
            {open && (
                <GalleryEditSheet store={store} layout={layout} images={images}
                    limit={galleryLimit(editor.state.doc, images)}
                    onApply={apply} onClose={() => setOpen(false)} />
            )}
        </NodeViewWrapper>
    );
}

export function MapView({ node, editor, selected, getPos, deleteNode }) {
    const store = useMediaStore(editor);
    const a = node.attrs;
    return (
        <NodeViewWrapper data-ct-view="map">
            <Frame selected={selected} className="flex items-start gap-3 px-3.5 py-3">
                <MapPin size={18} className="mt-0.5 flex-shrink-0 text-muted" aria-hidden="true" />
                <div className="min-w-0 flex-1" contentEditable={false}>
                    <p className="truncate font-bold text-ink">{a.name}</p>
                    {a.address && <p className="truncate text-[13px] text-muted">{a.address}</p>}
                    <p className="mt-0.5 text-[11px] text-muted">Google Maps · 글에서는 지도로 보여요</p>
                </div>
                {selected && <Controls editor={editor} getPos={getPos} deleteNode={deleteNode} locked={store.isLocked()} />}
            </Frame>
        </NodeViewWrapper>
    );
}

export function VideoView({ node, editor, selected, getPos, deleteNode }) {
    const store = useMediaStore(editor);
    const { provider, id } = node.attrs;
    return (
        <NodeViewWrapper data-ct-view="video">
            <Frame selected={selected} className="flex items-center gap-3 px-3.5 py-3">
                <PlaySquare size={20} className="flex-shrink-0 text-muted" aria-hidden="true" />
                <div className="min-w-0 flex-1" contentEditable={false}>
                    <p className="font-bold text-ink">{VIDEO_LABEL[provider] || '영상'} {provider === 'instagram' ? '게시물' : '영상'}</p>
                    <p className="truncate text-[12px] text-muted">{id} · 글에서는 바로 재생돼요</p>
                </div>
                {selected && <Controls editor={editor} getPos={getPos} deleteNode={deleteNode} locked={store.isLocked()} />}
            </Frame>
        </NodeViewWrapper>
    );
}

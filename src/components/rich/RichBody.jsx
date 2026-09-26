import { Fragment } from 'react';
import { useResolvedImages } from '../../lib/imageRefs';
import { isPreparedDoc, safeHref } from '../../lib/rich/doc';
import { ALIGNS, BG_COLORS, COLORS, FONT_FAMILIES, FONT_SIZES } from '../../lib/rich/schema';
import RichGallery from './RichGallery';
import RichMap from './RichMap';

// 서식 글 본문 읽기 전용 렌더러(2026-09-26 서식 편집기 1단계, 설계 plan_v3 5장).
// - prepareRichDoc(src/lib/rich/doc.js)이 검증하고 표식을 단 값만 그린다. 표식이 없거나(검증 안 된 원본) 검증에
//   실패한 문서면 평문 칸(fallback)을 지금처럼 whitespace-pre-wrap 으로 그린다.
// - 노드·마크는 대응표에 있는 것만 React 요소로 만든다. innerHTML·dangerouslySetInnerHTML 을 쓰지 않는다(ESLint 로 금지).
// - style 값은 토큰 대응표에서만 나온다(글꼴·크기·색·배경색·정렬). 링크는 new URL 로 한 번 더 확인한다.
// - 사진은 문서의 사진 목록 전체를 useResolvedImages 한 번으로 푼다(비공개 사진은 로그인 권한으로 받는다).

const EMPTY = [];

const alignStyle = (attrs) => (attrs && ALIGNS.includes(attrs.textAlign) ? { textAlign: attrs.textAlign } : undefined);

function textStyleCss(a) {
    if (!a || typeof a !== 'object') return undefined;
    const s = {};
    if (FONT_FAMILIES[a.fontFamily]) s.fontFamily = FONT_FAMILIES[a.fontFamily];
    if (FONT_SIZES.includes(a.fontSize)) s.fontSize = `${a.fontSize}px`;
    if (COLORS.includes(a.color)) s.color = a.color;
    if (BG_COLORS.includes(a.backgroundColor)) s.backgroundColor = a.backgroundColor;
    return s;
}

// 글자 하나(text 노드)를 마크로 감싼다: 안쪽부터 글자 모양 → 굵게·기울임·밑줄·취소선 → 링크(바깥)
function renderText(node, key) {
    const marks = Array.isArray(node.marks) ? node.marks : EMPTY;
    const has = (t) => marks.some((m) => m.type === t);
    let el = node.text;
    const ts = marks.find((m) => m.type === 'textStyle');
    if (ts) el = <span style={textStyleCss(ts.attrs)}>{el}</span>;
    if (has('bold')) el = <strong>{el}</strong>;
    if (has('italic')) el = <em>{el}</em>;
    if (has('underline')) el = <u>{el}</u>;
    if (has('strike')) el = <s>{el}</s>;
    const link = marks.find((m) => m.type === 'link');
    const href = link ? safeHref(link.attrs?.href) : null;
    if (href) {
        el = <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-ink underline underline-offset-2">{el}</a>;
    }
    return <Fragment key={key}>{el}</Fragment>;
}

function renderInline(nodes) {
    const list = Array.isArray(nodes) ? nodes : EMPTY;
    if (!list.length) return <br />;
    return list.map((n, i) => {
        if (n.type === 'text') return renderText(n, i);
        if (n.type === 'hardBreak') return <br key={i} />;
        return null;
    });
}

function renderBlocks(nodes, ctx) {
    return (Array.isArray(nodes) ? nodes : EMPTY).map((n, i) => renderBlock(n, i, ctx));
}

function renderBlock(n, key, ctx) {
    switch (n.type) {
        case 'paragraph':
            return <p key={key} style={alignStyle(n.attrs)} className="whitespace-pre-wrap">{renderInline(n.content)}</p>;
        case 'heading':
            return (
                <h2 key={key} style={alignStyle(n.attrs)} className="mb-1 mt-5 whitespace-pre-wrap text-[19px] font-bold leading-snug text-ink sm:text-[20px]">
                    {renderInline(n.content)}
                </h2>
            );
        case 'blockquote':
            return <blockquote key={key} className="my-3 border-l-4 border-hairline pl-4 text-muted">{renderBlocks(n.content, ctx)}</blockquote>;
        case 'bulletList':
            return <ul key={key} className="my-2 list-disc pl-6">{renderBlocks(n.content, ctx)}</ul>;
        case 'orderedList':
            return <ol key={key} start={n.attrs?.start ?? undefined} className="my-2 list-decimal pl-6">{renderBlocks(n.content, ctx)}</ol>;
        case 'listItem':
            return <li key={key}>{renderBlocks(n.content, ctx)}</li>;
        case 'horizontalRule':
            return <hr key={key} className="my-5 border-hairline" />;
        case 'image': {
            const url = ctx.urlOf(n.attrs.src);
            return (
                <figure key={key} className="my-4">
                    {url
                        ? <img src={url} alt={ctx.altOf(n.attrs.src)} loading="lazy" decoding="async" className="max-h-[80vh] w-full rounded-md bg-surface-soft object-contain" />
                        : <div className="aspect-[4/3] w-full rounded-md bg-surface-soft" aria-hidden="true" />}
                </figure>
            );
        }
        case 'gallery':
            return (
                <RichGallery
                    key={key}
                    layout={n.attrs.layout}
                    items={n.attrs.images.map((ref) => ({ ref, url: ctx.urlOf(ref), alt: ctx.altOf(ref) }))}
                    altBase={ctx.altBase}
                />
            );
        case 'map':
            return <RichMap key={key} attrs={n.attrs} />;
        default:
            return null;      // file 등 — 검증을 통과했다면 오지 않는다
    }
}

// prepared: prepareRichDoc 결과 / fallback: 평문 칸(검증 실패·표식 없음일 때) / userId: 비공개 사진 권한 / altBase: 사진 대체 글
const RichBody = ({ prepared, fallback = '', userId, altBase = '' }) => {
    const ok = isPreparedDoc(prepared) && prepared.ok;
    const refs = ok ? prepared.images : EMPTY;
    const urls = useResolvedImages(refs, userId);
    if (!ok) {
        return <p className="whitespace-pre-wrap text-[15px] leading-[1.8] text-body break-keep sm:text-[16px]">{fallback}</p>;
    }
    const byRef = new Map(refs.map((r, i) => [r, urls[i] ?? null]));
    const ctx = {
        urlOf: (ref) => byRef.get(ref) ?? null,
        altOf: (ref) => `${altBase} 사진 ${refs.indexOf(ref) + 1}`,
        altBase,
    };
    return (
        <div className="text-[15px] leading-[1.8] text-body break-keep [overflow-wrap:anywhere] sm:text-[16px]">
            {renderBlocks(prepared.doc.content, ctx)}
        </div>
    );
};

export default RichBody;

// 서식 편집기 도구막대(2026-09-27 서식 편집기 2단계, 설계 plan_v3 6-2·6-3).
// - 한 줄, 좁으면 가로로 밀어서 본다. 글쓰기 창 본문 맨 위에 붙어 있다(sticky). -top-5 = 글쓰기 창 본문의 위 여백(py-5)만큼
//   올려 붙여, 스크롤할 때 도구막대 위로 글이 비치지 않게 한다(9/27 캡처 실측).
// - 단추를 눌러도 편집기 선택·키보드가 유지되게 mousedown 기본 동작을 막는다(6-3). 단추 44px.
// - 글꼴·크기·색·배경색·정렬은 도구막대 아래 서랍(한 줄)에서 고른다 — 모바일·넓은 화면 공통, 위치 계산이 없다.
// - 조합(한글 입력) 중에 누른 서식 명령은 조합이 끝난 뒤 실행한다(runWhenNotComposing).
// - 저장 중(잠금)에는 모두 비활성.
import { useState } from 'react';
import { useEditorState } from '@tiptap/react';
import {
    ALargeSmall, AlignCenter, AlignLeft, AlignRight, Baseline, Bold, Clapperboard, Heading2, Highlighter, ImagePlus,
    Images, Italic, Link, List, ListOrdered, MapPin, Minus, Redo2, Strikethrough, TextQuote, Type, Underline, Undo2,
} from 'lucide-react';
import { BG_COLORS, COLORS, DEFAULT_FONT_SIZE, FONT_FAMILIES, FONT_SIZES } from '../../../lib/rich/schema';
import { runWhenNotComposing } from '../../../lib/rich/composition';
import { useMediaStore } from './shared';

const keep = (e) => e.preventDefault();

const FONT_OPTIONS = [
    { token: null, label: '기본', family: 'inherit' },
    { token: 'myeongjo', label: '나눔명조', family: FONT_FAMILIES.myeongjo },
    { token: 'pen', label: '나눔손글씨 펜', family: FONT_FAMILIES.pen },
    { token: 'dodum', label: '고운돋움', family: FONT_FAMILIES.dodum },
];
const SIZE_LABEL = { 13: '작게', 15: '보통', 19: '크게', 24: '더 크게', 28: '가장 크게' };
const ALIGN_OPTIONS = [
    { value: null, label: '왼쪽', Icon: AlignLeft },
    { value: 'center', label: '가운데', Icon: AlignCenter },
    { value: 'right', label: '오른쪽', Icon: AlignRight },
];

function Btn({ label, active = false, disabled = false, onClick, children, expanded }) {
    return (
        <button
            type="button"
            onMouseDown={keep}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            aria-pressed={expanded === undefined ? active : undefined}
            aria-expanded={expanded}
            className={`inline-flex h-11 min-w-[44px] flex-shrink-0 items-center justify-center rounded-md px-2 text-ink [touch-action:manipulation] disabled:opacity-35 ${active ? 'bg-surface-strong' : 'hover:bg-surface-soft'}`}
        >
            {children}
        </button>
    );
}

const Sep = () => <span className="mx-0.5 h-6 w-px flex-shrink-0 bg-hairline" aria-hidden="true" />;

// photos: 사진 칸이 있는 게시판(후기)인가. onPhoto(kind), onMap, onVideo, onLink: 편집기가 넘긴다.
export default function Toolbar({ editor, photos, onPhoto, onMap, onVideo, onLink, imagesLeft }) {
    const store = useMediaStore(editor);      // 잠금(저장 중)이 바뀌면 다시 그린다
    const [tray, setTray] = useState(null);      // 'font' | 'size' | 'color' | 'bg' | 'align' | null
    const st = useEditorState({
        editor,
        selector: ({ editor: e }) => {
            const ts = e.getAttributes('textStyle');
            const para = e.getAttributes('paragraph');
            const head = e.getAttributes('heading');
            return {
                bold: e.isActive('bold'),
                italic: e.isActive('italic'),
                underline: e.isActive('underline'),
                strike: e.isActive('strike'),
                heading: e.isActive('heading'),
                quote: e.isActive('blockquote'),
                bullet: e.isActive('bulletList'),
                ordered: e.isActive('orderedList'),
                link: e.isActive('link'),
                font: ts.fontFamily || null,
                size: ts.fontSize || null,
                color: ts.color || null,
                bg: ts.backgroundColor || null,
                align: head.textAlign || para.textAlign || null,
                canUndo: e.can().undo(),
                canRedo: e.can().redo(),
            };
        },
    });
    const locked = store.isLocked();
    const view = editor.view;
    // 서식 명령: 잠금이면 무시, 조합 중이면 조합이 끝난 뒤
    const run = (fn) => () => {
        if (store.isLocked()) return;
        runWhenNotComposing(view, () => {
            if (store.isLocked() || editor.isDestroyed) return;
            fn(editor.chain().focus()).run();
        });
    };
    const toggleTray = (name) => () => setTray((t) => (t === name ? null : name));
    const pick = (fn) => () => { run(fn)(); setTray(null); };

    return (
        <div className="sticky -top-5 z-20 rounded-t-md border-b border-hairline bg-white" data-ct-toolbar="">
            <div className="flex items-center overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="toolbar" aria-label="글 서식">
                <Btn label="되돌리기" disabled={locked || !st.canUndo} onClick={run((c) => c.undo())}><Undo2 size={18} /></Btn>
                <Btn label="다시 하기" disabled={locked || !st.canRedo} onClick={run((c) => c.redo())}><Redo2 size={18} /></Btn>
                <Sep />
                {photos && (
                    <>
                        <Btn label="사진" disabled={locked || imagesLeft <= 0} onClick={() => onPhoto('image')}><ImagePlus size={18} /></Btn>
                        <Btn label="사진 묶음" disabled={locked || imagesLeft < 2} onClick={() => onPhoto('gallery')}><Images size={18} /></Btn>
                    </>
                )}
                <Btn label="지도" disabled={locked} onClick={onMap}><MapPin size={18} /></Btn>
                <Btn label="영상" disabled={locked} onClick={onVideo}><Clapperboard size={18} /></Btn>
                <Sep />
                <Btn label="굵게" active={st.bold} disabled={locked} onClick={run((c) => c.toggleBold())}><Bold size={18} /></Btn>
                <Btn label="기울임" active={st.italic} disabled={locked} onClick={run((c) => c.toggleItalic())}><Italic size={18} /></Btn>
                <Btn label="밑줄" active={st.underline} disabled={locked} onClick={run((c) => c.toggleUnderline())}><Underline size={18} /></Btn>
                <Btn label="취소선" active={st.strike} disabled={locked} onClick={run((c) => c.toggleStrike())}><Strikethrough size={18} /></Btn>
                <Sep />
                <Btn label="글꼴" expanded={tray === 'font'} active={!!st.font} disabled={locked} onClick={toggleTray('font')}><Type size={18} /></Btn>
                <Btn label="글자 크기" expanded={tray === 'size'} active={!!st.size} disabled={locked} onClick={toggleTray('size')}><ALargeSmall size={18} /></Btn>
                <Btn label="글자색" expanded={tray === 'color'} active={!!st.color} disabled={locked} onClick={toggleTray('color')}>
                    <Baseline size={18} style={st.color ? { color: st.color } : undefined} />
                </Btn>
                <Btn label="배경색" expanded={tray === 'bg'} active={!!st.bg} disabled={locked} onClick={toggleTray('bg')}><Highlighter size={18} /></Btn>
                <Btn label="정렬" expanded={tray === 'align'} active={!!st.align} disabled={locked} onClick={toggleTray('align')}>
                    {st.align === 'center' ? <AlignCenter size={18} /> : st.align === 'right' ? <AlignRight size={18} /> : <AlignLeft size={18} />}
                </Btn>
                <Sep />
                <Btn label="소제목" active={st.heading} disabled={locked} onClick={run((c) => c.toggleHeading({ level: 2 }))}><Heading2 size={18} /></Btn>
                <Btn label="인용구" active={st.quote} disabled={locked} onClick={run((c) => c.toggleBlockquote())}><TextQuote size={18} /></Btn>
                <Btn label="구분선" disabled={locked} onClick={run((c) => c.setHorizontalRule())}><Minus size={18} /></Btn>
                <Sep />
                <Btn label="기호 목록" active={st.bullet} disabled={locked} onClick={run((c) => c.toggleBulletList())}><List size={18} /></Btn>
                <Btn label="숫자 목록" active={st.ordered} disabled={locked} onClick={run((c) => c.toggleOrderedList())}><ListOrdered size={18} /></Btn>
                <Btn label="링크" active={st.link} disabled={locked} onClick={onLink}><Link size={18} /></Btn>
            </div>
            {tray && !locked && (
                <div className="flex items-center gap-1.5 overflow-x-auto border-t border-hairline-soft px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {tray === 'font' && FONT_OPTIONS.map((o) => (
                        <button key={o.label} type="button" onMouseDown={keep} onClick={pick((c) => c.setTextToken('fontFamily', o.token))}
                            aria-pressed={(st.font || null) === o.token}
                            className={`h-10 flex-shrink-0 rounded-md border px-3 text-[15px] ${(st.font || null) === o.token ? 'border-ink bg-surface-soft' : 'border-hairline'}`}
                            style={{ fontFamily: o.family }}>
                            {o.label}
                        </button>
                    ))}
                    {tray === 'size' && FONT_SIZES.map((n) => (
                        <button key={n} type="button" onMouseDown={keep} onClick={pick((c) => c.setTextToken('fontSize', n === DEFAULT_FONT_SIZE ? null : n))}
                            aria-pressed={(st.size || DEFAULT_FONT_SIZE) === n}
                            className={`h-10 flex-shrink-0 rounded-md border px-3 ${(st.size || DEFAULT_FONT_SIZE) === n ? 'border-ink bg-surface-soft' : 'border-hairline'}`}>
                            <span style={{ fontSize: `${Math.min(n, 22)}px` }}>{SIZE_LABEL[n]}</span>
                        </button>
                    ))}
                    {tray === 'color' && (
                        <>
                            <button type="button" onMouseDown={keep} onClick={pick((c) => c.setTextToken('color', null))}
                                className={`h-10 flex-shrink-0 rounded-md border px-3 text-[13px] ${!st.color ? 'border-ink bg-surface-soft' : 'border-hairline'}`}>기본</button>
                            {COLORS.map((c) => (
                                <button key={c} type="button" onMouseDown={keep} onClick={pick((ch) => ch.setTextToken('color', c))}
                                    aria-label={`글자색 ${c}`} aria-pressed={st.color === c}
                                    className={`h-9 w-9 flex-shrink-0 rounded-full border-2 ${st.color === c ? 'border-ink' : 'border-white ring-1 ring-hairline'}`}
                                    style={{ backgroundColor: c }} />
                            ))}
                        </>
                    )}
                    {tray === 'bg' && (
                        <>
                            <button type="button" onMouseDown={keep} onClick={pick((c) => c.setTextToken('backgroundColor', null))}
                                className={`h-10 flex-shrink-0 rounded-md border px-3 text-[13px] ${!st.bg ? 'border-ink bg-surface-soft' : 'border-hairline'}`}>없음</button>
                            {BG_COLORS.map((c) => (
                                <button key={c} type="button" onMouseDown={keep} onClick={pick((ch) => ch.setTextToken('backgroundColor', c))}
                                    aria-label={`배경색 ${c}`} aria-pressed={st.bg === c}
                                    className={`h-9 w-9 flex-shrink-0 rounded-md border-2 ${st.bg === c ? 'border-ink' : 'border-white ring-1 ring-hairline'}`}
                                    style={{ backgroundColor: c }} />
                            ))}
                        </>
                    )}
                    {tray === 'align' && ALIGN_OPTIONS.map((o) => {
                        const AlignIcon = o.Icon;
                        return (
                            <button key={o.label} type="button" onMouseDown={keep} onClick={pick((c) => c.setCtAlign(o.value))}
                                aria-pressed={(st.align || null) === o.value}
                                className={`inline-flex h-10 flex-shrink-0 items-center gap-1 rounded-md border px-3 text-[13px] ${(st.align || null) === o.value ? 'border-ink bg-surface-soft' : 'border-hairline'}`}>
                                <AlignIcon size={16} aria-hidden="true" /> {o.label}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// 서식 편집기의 시트(2026-09-27 서식 편집기 2단계, 설계 plan_v3 6-2·6-7, plan_v3_1 9장, plan_stage2 D·E장).
// 모바일은 아래에서 올라오는 시트, 넓은 화면은 가운데 창. 글쓰기 창(z-70)·지도 크게 보기(z-80) 위(z-100).
// Esc 는 이 시트만 닫는다(캡처 단계에서 받아 글쓰기 창의 닫기 요청으로 번지지 않게 — DraftCloseDialog 와 같은 방식).
// 시트 안 미리보기 iframe(지도·영상)은 편집 영역(contenteditable) 밖이라 괜찮다 — 편집기 칸은 카드만 그린다.
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { apiUrl } from '../../../lib/api';
import { LIMITS } from '../../../lib/rich/schema';
import { normalizeHref } from '../../../lib/rich/doc';
import { candidateCoordKind, coordOf, mapAttrsError, mapEmbedUrl, parseGoogleMapsUrl } from '../../../lib/rich/mapLink';
import { VIDEO_LABEL, parseVideoUrl, videoEmbedUrl } from '../../../lib/rich/videoLink';
import { LAYOUT_LABEL } from './shared';
import { pushBack } from '../../../lib/backStack';
import Thumb from './Thumb';

const MAP_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY || '').trim();
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({ title, onClose, children, footer }) {
    const boxRef = useRef(null);
    const closeRef = useRef(onClose);
    useEffect(() => { closeRef.current = onClose; });
    useEffect(() => pushBack(() => closeRef.current?.()), []);      // 앱 뒤로가기 = 이 시트 닫기
    useEffect(() => {
        const prev = document.activeElement;
        // 첫 초점: 입력 칸이 있으면 거기로(링크 붙여넣기), 없으면 시트 자체로 — 단추에 주면 사진을 고른 뒤 자동으로 열린
        // 묶음 시트의 닫기 단추에 초점 테두리가 떠 보였다(2026-09-27 캡처). 키보드 사용자는 Tab 으로 단추에 간다.
        const t = setTimeout(() => {
            const input = boxRef.current?.querySelector('input:not([disabled])');
            (input || boxRef.current)?.focus();
        }, 0);
        const onKey = (e) => {
            if (e.key === 'Escape' && !e.isComposing && e.keyCode !== 229) {
                e.stopPropagation();
                e.preventDefault();
                closeRef.current?.();
                return;
            }
            if (e.key !== 'Tab' || !boxRef.current) return;
            const nodes = [...boxRef.current.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
            if (!nodes.length) return;
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            // 시트 밖이거나 시트 자체에 초점이 있으면 안쪽 처음(Shift+Tab 이면 마지막)으로 — 시트 자체에서 Shift+Tab 이 밖으로 새지 않게
            if (!boxRef.current.contains(document.activeElement) || document.activeElement === boxRef.current) {
                e.preventDefault();
                (e.shiftKey ? last : first).focus();
                e.stopPropagation();
                return;
            }
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            e.stopPropagation();
        };
        window.addEventListener('keydown', onKey, true);
        return () => {
            clearTimeout(t);
            window.removeEventListener('keydown', onKey, true);
            if (prev && prev.isConnected && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
        };
    }, []);
    // ⚠ 포털이라도 React 이벤트는 React 부모(글쓰기 폼)로 올라간다 — 시트 안 폼 제출(확인·Enter)이 바깥 글쓰기 폼의
    //   등록으로 번지지 않게 여기서 멈춘다(2026-09-27 E2E 실측: 지도 "확인"이 글을 등록해 버렸다).
    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center" onClick={() => closeRef.current?.()}
            onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            <div
                ref={boxRef}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
                className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl outline-none sm:max-w-lg sm:rounded-2xl"
            >
                <div className="relative flex h-12 flex-shrink-0 items-center justify-center border-b border-hairline">
                    <button type="button" onClick={() => closeRef.current?.()} aria-label="닫기" className="absolute left-2 rounded-full p-2 text-ink hover:bg-surface-soft">
                        <X size={18} />
                    </button>
                    <h3 className="text-[15px] font-bold text-ink">{title}</h3>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
                {footer && <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-hairline px-4 py-3">{footer}</div>}
            </div>
        </div>,
        document.body,
    );
}

// ── 링크 ───────────────────────────────────────────────────────────
export function LinkSheet({ initial = '', hasLink, onApply, onRemove, onClose }) {
    const id = useId();
    const [value, setValue] = useState(initial);
    const [error, setError] = useState('');
    const apply = (e) => {
        e?.preventDefault();
        e?.stopPropagation();
        const href = normalizeHref(value);
        if (!href) { setError('http 또는 https 로 시작하는 주소만 넣을 수 있어요.'); return; }
        onApply(href);
    };
    return (
        <Sheet
            title="링크"
            onClose={onClose}
            footer={(
                <>
                    {hasLink && <button type="button" onClick={onRemove} className="btn-air-secondary mr-auto">링크 없애기</button>}
                    <button type="button" onClick={onClose} className="btn-air-secondary">취소</button>
                    <button type="button" onClick={apply} className="btn-air-primary">적용</button>
                </>
            )}
        >
            <form onSubmit={apply}>
                <label htmlFor={`${id}-url`} className="mb-1.5 block text-sm font-bold text-ink">주소</label>
                <input id={`${id}-url`} type="url" inputMode="url" value={value} onChange={(e) => { setValue(e.target.value); setError(''); }}
                    placeholder="https://" className="input-air" maxLength={LIMITS.hrefMax} autoComplete="off" />
                {error && <p className="mt-2 text-[13px] text-error">{error}</p>}
            </form>
        </Sheet>
    );
}

// ── 지도(구글 지도 링크 붙여넣기) ────────────────────────────────────
// 단축 주소·좌표 없는 링크는 서버(extract-links, 플래너와 같은 SSRF 가드·캐시)로 해석한다.
async function extractLink(url) {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error('로그인이 필요합니다.');
    let resp;
    try {
        resp = await fetch(apiUrl('/api/planner/extract-links'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ url }),
        });
    } catch {
        throw new Error('network');
    }
    let payload = null;
    try { payload = await resp.json(); } catch { payload = null; }
    if (!resp.ok || !payload?.ok) throw new Error(payload?.code || `http ${resp.status}`);
    return (payload.candidates || []).filter((c) => c && c.source === 'google-maps');
}

const GENERIC_NAMES = new Set(['구글 지도 장소', '구글 지도 위치']);

export function MapInsertSheet({ onInsert, onClose }) {
    const id = useId();
    const [link, setLink] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [target, setTarget] = useState(null);        // { placeId?, lat?, lng?, url, kind: 'place'|'pin'|'query'|'center' }
    const [name, setName] = useState('');
    const reqRef = useRef(0);
    useEffect(() => () => { reqRef.current += 1; }, []);       // 닫히면 늦게 온 응답을 버린다

    const lookup = async (e) => {
        e?.preventDefault();
        e?.stopPropagation();
        const req = ++reqRef.current;
        setError('');
        setTarget(null);
        const parsed = parseGoogleMapsUrl(link);
        if (!parsed) { setError('구글 지도 링크가 아니에요. 구글 지도에서 공유 → 링크 복사로 받은 주소를 붙여 넣어 주세요.'); return; }
        let t = null;
        let guess = parsed.name;
        if (parsed.placeId) {
            const c = parsed.pin || parsed.query;
            t = { placeId: parsed.placeId, ...(c || {}), url: parsed.url, kind: 'place' };
        } else if (parsed.pin) t = { ...parsed.pin, url: parsed.url, kind: 'pin' };
        else if (parsed.query) t = { ...parsed.query, url: parsed.url, kind: 'query' };
        if (!t && parsed.needsServer) {
            setBusy(true);
            try {
                const cands = await extractLink(parsed.url);
                if (req !== reqRef.current) return;
                const c = cands[0];
                const xy = c ? coordOf(c.lat, c.lng) : null;
                if (xy) {
                    t = { ...xy, url: parsed.url, kind: candidateCoordKind(c) };
                    if (!guess && c.name && !GENERIC_NAMES.has(c.name)) guess = c.name;
                }
            } catch {
                if (req !== reqRef.current) return;
            } finally {
                if (req === reqRef.current) setBusy(false);
            }
        }
        if (!t && parsed.center) t = { ...parsed.center, url: parsed.url, kind: 'center' };
        if (!t) {
            setError('이 링크에서 장소를 찾지 못했어요. 구글 지도에서 장소를 연 뒤 공유 → 링크 복사로 받은 주소인지 확인해 주세요.');
            return;
        }
        setTarget(t);
        setName((guess || '').slice(0, LIMITS.mapNameMax));
    };

    const attrs = target ? {
        name: name.trim(),
        ...(target.placeId ? { placeId: target.placeId } : {}),
        ...(typeof target.lat === 'number' ? { lat: target.lat, lng: target.lng } : {}),
        url: target.url,
    } : null;
    const previewAttrs = target ? { ...attrs, name: attrs.name || '미리보기' } : null;
    const embed = previewAttrs ? mapEmbedUrl(previewAttrs, MAP_KEY) : null;
    const insert = () => {
        if (!attrs) return;
        if (!attrs.name) { setError('장소 이름을 적어 주세요.'); return; }
        const bad = mapAttrsError(attrs);
        if (bad) { setError('이 장소는 넣을 수 없어요. 다른 링크로 해 주세요.'); return; }
        onInsert(attrs);
    };

    return (
        <Sheet
            title="지도 넣기"
            onClose={onClose}
            footer={(
                <>
                    <button type="button" onClick={onClose} className="btn-air-secondary">취소</button>
                    <button type="button" onClick={insert} disabled={!target || busy} className="btn-air-primary">넣기</button>
                </>
            )}
        >
            <form onSubmit={lookup} className="space-y-2">
                <label htmlFor={`${id}-link`} className="block text-sm font-bold text-ink">구글 지도 링크</label>
                <div className="flex gap-2">
                    <input id={`${id}-link`} type="url" inputMode="url" value={link}
                        onChange={(e) => { reqRef.current += 1; setLink(e.target.value); setError(''); setTarget(null); setBusy(false); }}
                        placeholder="https://maps.app.goo.gl/…" className="input-air min-w-0 flex-1" autoComplete="off" maxLength={LIMITS.mapUrlMax} />
                    <button type="submit" disabled={busy || !link.trim()} className="btn-air-secondary flex-shrink-0">
                        {busy ? <Loader2 size={16} className="animate-spin" aria-label="찾는 중" /> : '확인'}
                    </button>
                </div>
                <p className="text-[12px] text-muted">구글 지도 앱·사이트에서 장소를 열고 공유 → 링크 복사한 주소를 붙여 넣어 주세요.</p>
                {error && <p className="text-[13px] text-error" role="alert">{error}</p>}
            </form>
            {target && (
                <div className="mt-4 space-y-3">
                    {target.kind === 'center' && (
                        <p className="rounded-md bg-surface-soft px-3 py-2 text-[13px] text-body">이 링크는 장소가 아니라 지도 화면 위치예요. 가운데 위치로 넣어요.</p>
                    )}
                    {embed ? (
                        <iframe
                            src={embed}
                            title="지도 미리보기"
                            referrerPolicy="strict-origin-when-cross-origin"
                            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                            loading="lazy"
                            className="h-56 w-full rounded-md border border-hairline"
                        />
                    ) : (
                        <p className="text-[13px] text-muted">지도 미리보기를 불러올 수 없어요. 넣으면 글에서는 지도로 보여요.</p>
                    )}
                    <div>
                        <label htmlFor={`${id}-name`} className="mb-1.5 block text-sm font-bold text-ink">장소 이름</label>
                        <input id={`${id}-name`} type="text" value={name} onChange={(e) => { setName(e.target.value); setError(''); }}
                            className="input-air" maxLength={LIMITS.mapNameMax} placeholder="예: 오사카성" />
                    </div>
                </div>
            )}
        </Sheet>
    );
}

// ── 영상(유튜브·인스타그램 링크) ─────────────────────────────────────
export function VideoInsertSheet({ onInsert, onClose }) {
    const id = useId();
    const [link, setLink] = useState('');
    const [video, setVideo] = useState(null);
    const [error, setError] = useState('');
    const check = (e) => {
        e?.preventDefault();
        e?.stopPropagation();
        const v = parseVideoUrl(link);
        if (!v) { setVideo(null); setError('유튜브·인스타그램 영상 링크만 넣을 수 있어요.'); return; }
        setError('');
        setVideo(v);
    };
    const embed = video ? videoEmbedUrl(video) : null;
    return (
        <Sheet
            title="영상 넣기"
            onClose={onClose}
            footer={(
                <>
                    <button type="button" onClick={onClose} className="btn-air-secondary">취소</button>
                    <button type="button" onClick={() => video && onInsert(video)} disabled={!video} className="btn-air-primary">넣기</button>
                </>
            )}
        >
            <form onSubmit={check} className="space-y-2">
                <label htmlFor={`${id}-link`} className="block text-sm font-bold text-ink">영상 링크</label>
                <div className="flex gap-2">
                    <input id={`${id}-link`} type="url" inputMode="url" value={link} onChange={(e) => { setLink(e.target.value); setError(''); setVideo(null); }}
                        placeholder="https://youtu.be/…" className="input-air min-w-0 flex-1" autoComplete="off" maxLength={2048} />
                    <button type="submit" disabled={!link.trim()} className="btn-air-secondary flex-shrink-0">확인</button>
                </div>
                <p className="text-[12px] text-muted">유튜브(쇼츠 포함)·인스타그램 게시물·릴스 링크를 붙여 넣어 주세요.</p>
                {error && <p className="text-[13px] text-error" role="alert">{error}</p>}
            </form>
            {video && embed && (
                <div className="mt-4">
                    <p className="mb-2 text-[13px] font-bold text-ink">{VIDEO_LABEL[video.provider]} 미리보기</p>
                    <iframe
                        src={embed}
                        title="영상 미리보기"
                        referrerPolicy="strict-origin-when-cross-origin"
                        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
                        allow="encrypted-media; picture-in-picture; fullscreen"
                        loading="lazy"
                        className={`w-full rounded-md border border-hairline ${video.provider === 'youtube' ? 'aspect-video min-h-[200px]' : 'h-[420px]'}`}
                    />
                </div>
            )}
        </Sheet>
    );
}

// ── 사진 묶음 편집(v3.1 9장: 콜라주 / 한 장씩 / 옆으로 나열, 기본 콜라주) ─────────────
// 배치 모양은 작은 그림으로 보여 준다. 순서 바꾸기·빼기·더 넣기(최대 10장). 적용하면 1장 = 사진 한 장, 0장 = 묶음 삭제.
function LayoutPicture({ layout }) {
    const box = 'rounded-[3px] bg-muted-soft';
    if (layout === 'slide') {
        return (
            <span className="relative flex h-10 w-14 items-center justify-center" aria-hidden="true">
                <span className={`${box} h-9 w-12`} />
                <span className="absolute left-0 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-b-2 border-l-2 border-ink" />
                <span className="absolute right-0 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-r-2 border-t-2 border-ink" />
            </span>
        );
    }
    if (layout === 'strip') {
        return (
            <span className="flex h-10 w-14 items-center gap-0.5 overflow-hidden" aria-hidden="true">
                <span className={`${box} h-6 w-5 flex-shrink-0`} /><span className={`${box} h-6 w-5 flex-shrink-0`} /><span className={`${box} h-6 w-5 flex-shrink-0`} />
            </span>
        );
    }
    return (
        <span className="grid h-10 w-14 grid-cols-2 gap-0.5" aria-hidden="true">
            <span className={box} /><span className={box} /><span className={box} /><span className={box} />
        </span>
    );
}

// limit = 이 묶음에 둘 수 있는 최대 장수(묶음 10장·글 전체 20장 중 작은 쪽 — 쓰는 쪽이 이 묶음 밖 사진 수를 빼서 넘긴다, codex B2)
export function GalleryEditSheet({ store, layout: layout0, images: images0, limit = LIMITS.galleryMax, onApply, onClose }) {
    const [layout, setLayout] = useState(layout0 || 'grid');
    const [list, setList] = useState(images0 || []);
    const [adding, setAdding] = useState(false);
    const move = (i, d) => setList((xs) => {
        const j = i + d;
        if (j < 0 || j >= xs.length) return xs;
        const next = [...xs];
        [next[i], next[j]] = [next[j], next[i]];
        return next;
    });
    const remove = (i) => setList((xs) => xs.filter((_, k) => k !== i));
    const max = Math.max(0, Math.min(LIMITS.galleryMax, limit));
    const canAdd = list.length < max;
    const add = async () => {
        if (!canAdd || adding) return;
        setAdding(true);
        try {
            const keys = await store.pick({ max: max - list.length });
            if (keys.length) setList((xs) => [...xs, ...keys.filter((k) => !xs.includes(k))].slice(0, max));
        } finally {
            setAdding(false);
        }
    };
    return (
        <Sheet
            title="사진 묶음"
            onClose={onClose}
            footer={(
                <>
                    <button type="button" onClick={onClose} className="btn-air-secondary">취소</button>
                    <button type="button" onClick={() => onApply({ layout, images: list })} disabled={adding} className="btn-air-primary">적용</button>
                </>
            )}
        >
            <p className="mb-2 text-sm font-bold text-ink">보여 주는 방식</p>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="보여 주는 방식">
                {['grid', 'slide', 'strip'].map((l) => (
                    <button
                        key={l}
                        type="button"
                        role="radio"
                        aria-checked={layout === l}
                        onClick={() => setLayout(l)}
                        className={`flex flex-col items-center gap-1.5 rounded-md border px-2 py-2.5 text-[13px] font-bold ${layout === l ? 'border-ink bg-surface-soft text-ink' : 'border-hairline text-muted'}`}
                    >
                        <LayoutPicture layout={l} />
                        {LAYOUT_LABEL[l]}
                    </button>
                ))}
            </div>
            <p className="mb-2 mt-5 text-sm font-bold text-ink">사진 {list.length}장 <span className="font-normal text-muted">(2~{LIMITS.galleryMax}장)</span></p>
            <ul className="grid grid-cols-3 gap-2">
                {list.map((r, i) => (
                    <li key={r} className="relative aspect-square overflow-hidden rounded-md bg-surface-soft">
                        <Thumb store={store} value={r} className="h-full w-full object-cover" />
                        <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 text-[11px] font-bold text-white">{i + 1}</span>
                        <button type="button" onClick={() => remove(i)} aria-label={`${i + 1}번째 사진 빼기`} className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white">
                            <X size={12} aria-hidden="true" />
                        </button>
                        <div className="absolute inset-x-1 bottom-1 flex justify-between">
                            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${i + 1}번째 사진 앞으로`} className="rounded-full bg-black/60 p-1 text-white disabled:opacity-30">
                                <ArrowLeft size={12} aria-hidden="true" />
                            </button>
                            <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`${i + 1}번째 사진 뒤로`} className="rounded-full bg-black/60 p-1 text-white disabled:opacity-30">
                                <ArrowRight size={12} aria-hidden="true" />
                            </button>
                        </div>
                    </li>
                ))}
                {canAdd && (
                    <li>
                        <button type="button" onClick={add} disabled={adding} className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-hairline text-[12px] font-bold text-muted hover:bg-surface-soft">
                            {adding ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={18} aria-hidden="true" />}
                            사진 추가
                        </button>
                    </li>
                )}
            </ul>
            {list.length < 2 && <p className="mt-2 text-[12px] text-muted">{list.length === 1 ? '1장이면 사진 한 장으로 넣어요.' : '사진이 없으면 묶음이 지워져요.'}</p>}
        </Sheet>
    );
}

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, MapPin, Maximize2, X } from 'lucide-react';
import { MAP_EMBED_IN_APP, mapEmbedUrl, mapOpenUrl } from '../../lib/rich/mapLink';
import { isNativeApp } from '../../lib/native';

// 서식 글 안의 지도(2026-09-26 서식 편집기 1단계, 설계 plan_v3 5-3 + plan_v3_1 0장 1번·8장 MINOR).
// 모든 기기 공통 한 가지 경로:
//  - 본문: Maps Embed iframe 을 보여 주되 조작은 막는다(tabIndex -1·aria-hidden·pointer-events none).
//    그 위에 투명 덮개 버튼("크게 보기" 배지 + 포커스 링). 덮개는 touch-action·preventDefault 를 건드리지 않아
//    본문 스크롤·휠·핀치가 지도에 먹히지 않고 페이지가 그대로 움직인다.
//  - 덮개를 누르면 전체 화면 시트에 조작 가능한 지도 + "Google 지도에서 열기". 닫으면 덮개로 포커스가 돌아간다.
//  - iframe 은 화면에 가까워질 때(200px 앞) 붙이고 loading="lazy" 도 준다.
//  - 키가 없거나 속성이 규칙 밖이면(또는 앱에서 MAP_EMBED_IN_APP=false) 지도 대신 카드(장소명·주소·열기 링크·출처 표기).
// iframe 주소는 mapEmbedUrl(new URL + URLSearchParams)로만 만든다 — 작성자가 적은 이름·주소는 주소에 들어가지 않는다.

const BROWSER_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY || '').trim();
// 지도가 우리 화면을 다른 곳으로 옮기지 못하게(allow-top-navigation 없음). 1단계 운영 E2E 에서 구글 Embed 가
// 이 조합에서 깨지면 sandbox 를 빼고, 그 보장도 철회한다(설계 5-3).
const SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox';
// 시트 안 Tab 순서 = 닫기 ↔ "Google 지도에서 열기". 지도 iframe(다른 출처 문서)은 Tab 순서에서 뺀다 — 포커스가 그 안에
// 들어가면 Esc 가 우리 화면에 오지 않아 시트를 키보드로 닫을 수 없다(9/26 브라우저 실측). 지도 조작은 마우스·터치로.
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

const embedAllowed = () => MAP_EMBED_IN_APP || !isNativeApp();

function MapSheet({ attrs, embed, openUrl, onClose }) {
    const boxRef = useRef(null);
    const closeRef = useRef(null);
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; });

    useEffect(() => {
        // 여는 순간의 포커스(덮개 버튼)를 기억했다가 닫힐 때 돌려준다(WriteModal 과 같은 방식)
        const prevActive = document.activeElement;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        closeRef.current?.focus();
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current?.(); return; }
            if (e.key !== 'Tab' || !boxRef.current) return;
            const nodes = [...boxRef.current.querySelectorAll(FOCUSABLE)];
            if (!nodes.length) return;
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            if (!boxRef.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKey);
        // 지도 안을 누르면 포커스가 지도(다른 출처 문서)로 넘어가 Esc 가 이 화면에 오지 않는다(codex 9/26) →
        // 곧바로 시트로 되돌린다. 끌기·휠·버튼 누르기는 포커스와 무관하게 지도에 그대로 간다.
        let t;
        const onWindowBlur = () => {
            clearTimeout(t);
            t = setTimeout(() => {
                const a = document.activeElement;
                if (a && a.tagName === 'IFRAME' && boxRef.current?.contains(a)) boxRef.current.focus();
            }, 0);
        };
        window.addEventListener('blur', onWindowBlur);
        return () => {
            clearTimeout(t);
            window.removeEventListener('blur', onWindowBlur);
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
            if (prevActive && prevActive.isConnected && typeof prevActive.focus === 'function') prevActive.focus();
        };
    }, []);

    return createPortal(
        <div ref={boxRef} role="dialog" aria-modal="true" aria-label={`${attrs.name} 지도`} tabIndex={-1} className="fixed inset-0 z-[80] flex flex-col bg-white outline-none">
            <div className="relative flex h-14 flex-shrink-0 items-center justify-center border-b border-hairline px-14">
                <button ref={closeRef} type="button" onClick={() => onCloseRef.current?.()} aria-label="닫기" className="absolute left-3 rounded-full p-2 text-ink hover:bg-surface-soft">
                    <X size={18} />
                </button>
                <h2 className="truncate text-[16px] font-bold text-ink">{attrs.name}</h2>
            </div>
            <iframe
                src={embed}
                title={`${attrs.name} 지도`}
                referrerPolicy="strict-origin-when-cross-origin"
                sandbox={SANDBOX}
                allowFullScreen
                tabIndex={-1}
                className="w-full flex-1 border-0"
            />
            {openUrl && (
                <div className="flex-shrink-0 border-t border-hairline px-4 py-3">
                    <a href={openUrl} target="_blank" rel="noopener noreferrer" className="btn-air-secondary btn-air-lg inline-flex w-full items-center justify-center gap-1.5">
                        Google 지도에서 열기 <ExternalLink size={14} aria-hidden="true" />
                    </a>
                </div>
            )}
        </div>,
        document.body,
    );
}

const RichMap = ({ attrs }) => {
    const embed = embedAllowed() ? mapEmbedUrl(attrs, BROWSER_KEY) : null;
    const open = mapOpenUrl(attrs);
    const boxRef = useRef(null);
    // IntersectionObserver 가 없는 옛 브라우저는 처음부터 붙인다(iframe 에 loading="lazy" 가 있다)
    const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
    const [sheet, setSheet] = useState(false);

    useEffect(() => {
        if (!embed || near || !boxRef.current) return undefined;
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); }
        }, { rootMargin: '200px' });
        io.observe(boxRef.current);
        return () => io.disconnect();
    }, [embed, near]);

    if (!embed) {
        return (
            <figure className="my-4 flex items-start gap-3 rounded-md border border-hairline px-3.5 py-3">
                <MapPin size={18} className="mt-0.5 flex-shrink-0 text-muted" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <figcaption className="font-bold text-ink">{attrs.name}</figcaption>
                    {attrs.address && <p className="text-[13px] text-muted">{attrs.address}</p>}
                    {open && (
                        <a href={open} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[13px] text-muted underline underline-offset-2 hover:text-ink">
                            Google 지도에서 열기 <ExternalLink size={12} aria-hidden="true" />
                        </a>
                    )}
                    <p className="mt-1 text-[11px] text-muted">Google Maps</p>
                </div>
            </figure>
        );
    }

    return (
        <figure className="my-4 overflow-hidden rounded-md border border-hairline">
            <div ref={boxRef} className="relative h-[240px] bg-surface-soft">
                {near && (
                    <iframe
                        src={embed}
                        title={`${attrs.name} 지도`}
                        loading="lazy"
                        referrerPolicy="strict-origin-when-cross-origin"
                        sandbox={SANDBOX}
                        tabIndex={-1}
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 h-full w-full border-0"
                    />
                )}
                <button
                    type="button"
                    onClick={() => setSheet(true)}
                    aria-label={`${attrs.name} 지도 크게 보기`}
                    className="absolute inset-0 h-full w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink"
                >
                    <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[12px] font-bold text-ink shadow">
                        <Maximize2 size={12} aria-hidden="true" /> 크게 보기
                    </span>
                </button>
            </div>
            <figcaption className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                <span className="min-w-0 truncate">
                    <span className="font-bold text-ink">{attrs.name}</span>
                    {attrs.address && <span className="ml-1.5 text-muted">{attrs.address}</span>}
                </span>
                {open && (
                    <a href={open} target="_blank" rel="noopener noreferrer" className="inline-flex flex-shrink-0 items-center gap-1 text-muted underline underline-offset-2 hover:text-ink">
                        Google 지도에서 열기 <ExternalLink size={12} aria-hidden="true" />
                    </a>
                )}
            </figcaption>
            {sheet && <MapSheet attrs={attrs} embed={embed} openUrl={open} onClose={() => setSheet(false)} />}
        </figure>
    );
};

export default RichMap;

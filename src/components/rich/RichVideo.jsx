import { useEffect, useRef, useState } from 'react';
import { ExternalLink, PlaySquare } from 'lucide-react';
import { VIDEO_EMBED_IN_APP, VIDEO_LABEL, videoEmbedUrl, videoOpenUrl } from '../../lib/rich/videoLink';
import { isNativeApp } from '../../lib/native';

// 서식 글 안의 영상(2026-09-27 서식 편집기 2단계, plan_stage2 D장·J장).
// - 유튜브(youtube-nocookie)·인스타그램 공식 임베드를 글 안에서 바로 재생한다. 지도와 달리 덮개를 씌우지 않는다(재생이 목적).
// - 주소는 검증한 제공자·ID 로만 조립한다(videoLink.js). 화면에 가까워질 때(200px 앞) iframe 을 붙이고 loading="lazy" 도 준다.
// - 임베드가 막힌 영상(외부 재생 금지 등)도 볼 수 있게 아래에 항상 원 링크(YouTube·Instagram 에서 보기)를 둔다.
// - 유튜브는 리퍼러가 없으면 재생 오류가 나므로 strict-origin-when-cross-origin, 플레이어 최소 높이 200px(유튜브 요구사항).
// - 앱에서 임베드가 안 되면(에뮬레이터 실측) VIDEO_EMBED_IN_APP=false 로 앱에서만 카드 + 원 링크.
// - 인스타그램 임베드는 게시물마다 높이가 다르다. 임베드 문서가 부모에게 보내는 높이 알림(MEASURE, 9/27 실측:
//   {"type":"MEASURE","details":{"height":608}})을 받아 칸 높이를 맞춘다 — 안쪽에 스크롤이 생기지 않아 페이지 스크롤이
//   임베드에 갇히지 않는다(agy). 출처(instagram.com)·보낸 창(그 iframe)을 확인한 값만 쓴다.
const SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation';
const IG_ORIGIN = 'https://www.instagram.com';

const embedAllowed = () => VIDEO_EMBED_IN_APP || !isNativeApp();

const RichVideo = ({ attrs }) => {
    const embed = embedAllowed() ? videoEmbedUrl(attrs) : null;
    const open = videoOpenUrl(attrs);
    const label = VIDEO_LABEL[attrs.provider] || '영상';
    const boxRef = useRef(null);
    const frameRef = useRef(null);
    const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
    const [igHeight, setIgHeight] = useState(null);

    useEffect(() => {
        if (!embed || near || !boxRef.current) return undefined;
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); }
        }, { rootMargin: '200px' });
        io.observe(boxRef.current);
        return () => io.disconnect();
    }, [embed, near]);

    const youtube = attrs.provider === 'youtube';
    useEffect(() => {
        if (youtube || !embed || !near) return undefined;
        const onMsg = (e) => {
            if (e.origin !== IG_ORIGIN || !frameRef.current || e.source !== frameRef.current.contentWindow) return;
            let d = null;
            try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
            const h = Number(d?.details?.height);
            if (d?.type === 'MEASURE' && Number.isFinite(h) && h >= 200 && h <= 2000) setIgHeight(Math.round(h));
        };
        window.addEventListener('message', onMsg);
        return () => window.removeEventListener('message', onMsg);
    }, [youtube, embed, near]);
    return (
        <figure className="my-4">
            {embed ? (
                <div
                    ref={boxRef}
                    className={youtube
                        ? 'aspect-video min-h-[200px] w-full overflow-hidden rounded-md bg-surface-soft'
                        : 'mx-auto h-[560px] w-full max-w-[540px] overflow-hidden rounded-md border border-hairline bg-surface-soft'}
                    style={!youtube && igHeight ? { height: `${igHeight}px` } : undefined}
                >
                    {near && (
                        <iframe
                            ref={frameRef}
                            src={embed}
                            title={`${label} 영상`}
                            loading="lazy"
                            referrerPolicy="strict-origin-when-cross-origin"
                            sandbox={SANDBOX}
                            allow="encrypted-media; picture-in-picture; fullscreen"
                            allowFullScreen
                            className="h-full w-full border-0"
                        />
                    )}
                </div>
            ) : (
                <div className="flex items-center gap-3 rounded-md border border-hairline px-3.5 py-3">
                    <PlaySquare size={20} className="flex-shrink-0 text-muted" aria-hidden="true" />
                    <span className="font-bold text-ink">{label} {youtube ? '영상' : '게시물'}</span>
                </div>
            )}
            {open && (
                <figcaption className={`mt-1.5 text-[13px] ${youtube ? '' : 'mx-auto max-w-[540px]'}`}>
                    <a href={open} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted underline underline-offset-2 hover:text-ink">
                        {label}에서 보기 <ExternalLink size={12} aria-hidden="true" />
                    </a>
                </figcaption>
            )}
        </figure>
    );
};

export default RichVideo;

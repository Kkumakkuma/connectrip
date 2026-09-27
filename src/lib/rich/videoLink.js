// 서식 문서의 영상 노드(2026-09-27 서식 편집기 2단계, 설계 plan_stage2 D장 / plan_v3_1 10장).
// - 영상 속성 검증(서버 rich_doc_check 의 video 분기와 같은 규칙)
// - 링크 해석: 유튜브(watch·youtu.be·shorts·embed·live)·인스타그램(p·reel·reels·tv) 링크 → { provider, id }
// - 표시: 공식 임베드 주소를 고정 출처 + 검증한 ID 로만 조립한다(작성자가 붙인 주소를 그대로 쓰지 않는다).
// 원 주소·제목은 저장하지 않는다(지도 노드와 같은 원칙). 직접 올리는 영상 파일은 비용 때문에 보류(v3.1 10장).
import { RE, VIDEO_PROVIDERS } from './schema';

// 앱(WebView)에서 임베드가 리퍼러 문제로 재생되지 않으면(5단계 에뮬레이터 실측) false 로 바꿔 앱에서만 카드 + 열기 링크로.
export const VIDEO_EMBED_IN_APP = true;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const idOk = (provider, id) => typeof id === 'string'
    && ((provider === 'youtube' && RE.youtubeId.test(id)) || (provider === 'instagram' && RE.instagramId.test(id)));

// 영상 속성이 규칙에 맞으면 null, 아니면 사유 코드(서버 DETAIL 과 같은 이름)
export function videoAttrsError(attrs) {
    if (!isObj(attrs)) return 'VIDEO';
    for (const k of Object.keys(attrs)) {
        if (attrs[k] !== undefined && k !== 'provider' && k !== 'id') return 'VIDEO';
    }
    if (typeof attrs.provider !== 'string' || !VIDEO_PROVIDERS.includes(attrs.provider)) return 'VIDEO';
    if (!idOk(attrs.provider, attrs.id)) return 'VIDEO_ID';
    return null;
}

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const IG_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);
const IG_KINDS = new Set(['p', 'reel', 'reels', 'tv']);

// 사용자가 붙인 글 → URL. 앞뒤 공백·앞의 "http(s)://" 없음(www.youtube.com/…)까지 받아 준다.
function toUrl(input) {
    if (typeof input !== 'string') return null;
    let s = input.trim();
    if (!s || s.length > 2048 || /\s/.test(s)) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
    try {
        const u = new URL(s);
        if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.port) return null;
        return u;
    } catch {
        return null;
    }
}

// 영상 링크 → { provider, id } 또는 null(지원하지 않는 링크)
export function parseVideoUrl(input) {
    const u = toUrl(input);
    if (!u) return null;
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean);
    let provider = null;
    let id = null;
    if (host === 'youtu.be' || host === 'www.youtu.be') {
        provider = 'youtube';
        id = parts[0] || null;
    } else if (YT_HOSTS.has(host)) {
        provider = 'youtube';
        if (parts[0] === 'watch') id = u.searchParams.get('v');
        else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1] || null;
    } else if (IG_HOSTS.has(host)) {
        provider = 'instagram';
        // /p/<코드>/ · /reel/<코드>/ · /tv/<코드>/ 또는 계정 이름이 앞에 붙은 /<계정>/p/<코드>/
        const at = IG_KINDS.has(parts[0]) ? 0 : (IG_KINDS.has(parts[1]) ? 1 : -1);
        if (at >= 0) id = parts[at + 1] || null;
    }
    if (!provider || !idOk(provider, id)) return null;
    return { provider, id };
}

// 글 안에서 재생하는 임베드 주소(고정 출처). 속성이 규칙 밖이면 null.
//  - 유튜브: 쿠키를 덜 쓰는 youtube-nocookie 도메인. playsinline = 아이폰에서 전체 화면으로 튀지 않게.
//  - 인스타그램: 게시물 임베드(/p/<코드>/embed/) — 릴스 코드도 같은 주소로 열린다.
export function videoEmbedUrl(attrs) {
    if (videoAttrsError(attrs)) return null;
    if (attrs.provider === 'youtube') {
        const u = new URL(`https://www.youtube-nocookie.com/embed/${attrs.id}`);
        u.searchParams.set('playsinline', '1');
        u.searchParams.set('rel', '0');
        return u.toString();
    }
    return new URL(`https://www.instagram.com/p/${attrs.id}/embed/`).toString();
}

// "YouTube 에서 보기 / Instagram 에서 보기" 주소
export function videoOpenUrl(attrs) {
    if (videoAttrsError(attrs)) return null;
    if (attrs.provider === 'youtube') {
        const u = new URL('https://www.youtube.com/watch');
        u.searchParams.set('v', attrs.id);
        return u.toString();
    }
    return new URL(`https://www.instagram.com/p/${attrs.id}/`).toString();
}

export const VIDEO_LABEL = Object.freeze({ youtube: 'YouTube', instagram: 'Instagram' });

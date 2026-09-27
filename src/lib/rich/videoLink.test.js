import { describe, expect, it } from 'vitest';
import { parseVideoUrl, videoAttrsError, videoEmbedUrl, videoOpenUrl } from './videoLink';

const YT = 'dQw4w9WgXcQ';

describe('parseVideoUrl — 유튜브·인스타그램 링크만', () => {
    it('유튜브 링크 모양들', () => {
        for (const u of [
            `https://www.youtube.com/watch?v=${YT}`,
            `https://youtube.com/watch?v=${YT}&t=42s&list=PL123`,
            `https://m.youtube.com/watch?v=${YT}`,
            `https://youtu.be/${YT}`,
            `https://youtu.be/${YT}?si=abcdef`,
            `https://www.youtube.com/shorts/${YT}`,
            `https://www.youtube.com/embed/${YT}`,
            `https://www.youtube.com/live/${YT}`,
            `https://www.youtube-nocookie.com/embed/${YT}`,
            `www.youtube.com/watch?v=${YT}`,
            `  youtu.be/${YT}  `,
            `http://youtu.be/${YT}`,
        ]) {
            expect(parseVideoUrl(u), u).toEqual({ provider: 'youtube', id: YT });
        }
    });
    it('인스타그램 게시물·릴스(계정 이름이 앞에 붙은 새 주소 포함)', () => {
        for (const u of [
            'https://www.instagram.com/p/C8m9K1dPZ2x/',
            'https://instagram.com/p/C8m9K1dPZ2x',
            'https://www.instagram.com/reel/C8m9K1dPZ2x/?igsh=abc',
            'https://www.instagram.com/reels/C8m9K1dPZ2x/',
            'https://www.instagram.com/tv/C8m9K1dPZ2x/',
            'https://www.instagram.com/some.user/p/C8m9K1dPZ2x/',
            'https://m.instagram.com/p/C8m9K1dPZ2x/',
        ]) {
            expect(parseVideoUrl(u), u).toEqual({ provider: 'instagram', id: 'C8m9K1dPZ2x' });
        }
    });
    it('그 밖은 거부(위장 호스트·스킴·ID 모양·계정 페이지·빈 값)', () => {
        for (const u of [
            `https://youtube.com.evil.com/watch?v=${YT}`,
            `https://evil.com/youtu.be/${YT}`,
            `javascript:alert(1)//youtu.be/${YT}`,
            `ftp://youtu.be/${YT}`,
            'https://www.youtube.com/watch?v=short',
            `https://www.youtube.com/watch?v=${YT}x`,
            'https://www.youtube.com/@channel',
            'https://www.youtube.com/playlist?list=PL123',
            'https://www.instagram.com/some.user/',
            'https://www.instagram.com/p/abc/',
            'https://www.instagram.com/stories/user/123/',
            `https://user:pw@youtu.be/${YT}`,
            `https://youtu.be:8443/${YT}`,
            '',
            null,
            'https://vimeo.com/123456',
        ]) {
            expect(parseVideoUrl(u), String(u)).toBeNull();
        }
    });
});

describe('videoAttrsError — 서버 video 분기와 같은 규칙', () => {
    it('통과·거부 사유', () => {
        expect(videoAttrsError({ provider: 'youtube', id: YT })).toBeNull();
        expect(videoAttrsError({ provider: 'instagram', id: 'C8m9K1dPZ2x' })).toBeNull();
        expect(videoAttrsError(null)).toBe('VIDEO');
        expect(videoAttrsError({ provider: 'vimeo', id: YT })).toBe('VIDEO');
        expect(videoAttrsError({ provider: 'youtube', id: YT, url: 'x' })).toBe('VIDEO');
        expect(videoAttrsError({ provider: 'youtube' })).toBe('VIDEO_ID');
        expect(videoAttrsError({ provider: 'youtube', id: 'abc' })).toBe('VIDEO_ID');
        expect(videoAttrsError({ provider: 'instagram', id: 'abcd' })).toBe('VIDEO_ID');
        expect(videoAttrsError({ provider: 'instagram', id: 'a'.repeat(65) })).toBe('VIDEO_ID');
        expect(videoAttrsError({ provider: 'youtube', id: `${YT}"` })).toBe('VIDEO_ID');
    });
});

describe('임베드·열기 주소 — 고정 출처 + 검증한 ID 만', () => {
    it('유튜브는 youtube-nocookie 임베드, 인스타는 게시물 임베드', () => {
        const y = new URL(videoEmbedUrl({ provider: 'youtube', id: YT }));
        expect(y.origin + y.pathname).toBe(`https://www.youtube-nocookie.com/embed/${YT}`);
        expect(y.searchParams.get('playsinline')).toBe('1');
        expect(videoEmbedUrl({ provider: 'instagram', id: 'C8m9K1dPZ2x' })).toBe('https://www.instagram.com/p/C8m9K1dPZ2x/embed/');
        expect(videoOpenUrl({ provider: 'youtube', id: YT })).toBe(`https://www.youtube.com/watch?v=${YT}`);
        expect(videoOpenUrl({ provider: 'instagram', id: 'C8m9K1dPZ2x' })).toBe('https://www.instagram.com/p/C8m9K1dPZ2x/');
    });
    it('규칙 밖 속성이면 주소를 만들지 않는다', () => {
        expect(videoEmbedUrl({ provider: 'youtube', id: '../../x' })).toBeNull();
        expect(videoEmbedUrl({ provider: 'evil', id: YT })).toBeNull();
        expect(videoOpenUrl({ provider: 'instagram', id: '../x' })).toBeNull();
    });
});

// 링크로 담기 — 구글 지도 후보의 좌표 종류(coord, 2026-09-27 게시판 지도 붙여넣기).
import { describe, expect, it } from 'vitest';
import { extractGoogleFromUrl, extractNaver } from './extract-links.js';

describe('extractGoogleFromUrl — coord 로 핀·좌표 질의·지도 중심을 구분', () => {
    it('핀(!3d!4d)이 있으면 pin(중심은 쓰지 않는다)', () => {
        const out = extractGoogleFromUrl('https://www.google.com/maps/place/X/@34.68,135.52,17z/data=!3m1!4b1!8m2!3d34.6873153!4d135.5262013', '<title>오사카성 - Google 지도</title>');
        expect(out).toEqual([{ name: '오사카성', address: '', lat: 34.6873153, lng: 135.5262013, source: 'google-maps', coord: 'pin' }]);
    });
    it('?q=lat,lng 는 query', () => {
        const out = extractGoogleFromUrl('https://maps.google.com/maps?q=37.5665,126.978', '');
        expect(out[0].coord).toBe('query');
        expect(out[0].name).toBe('구글 지도 장소');
    });
    it('@lat,lng 만 있으면 center', () => {
        const out = extractGoogleFromUrl('https://www.google.com/maps/@37.5665,126.978,15z', '');
        expect(out[0]).toMatchObject({ lat: 37.5665, lng: 126.978, coord: 'center', name: '구글 지도 위치' });
    });
    it('네이버 블로그 후보에는 coord 가 없다(플래너 응답 모양 그대로)', () => {
        const html = `<div data-linkdata='{"name":"카페","latitude":37.1,"longitude":127.1}'></div>`;
        const out = extractNaver(html);
        expect(out).toEqual([{ name: '카페', address: '', lat: 37.1, lng: 127.1, source: 'naver-blog' }]);
        expect('coord' in out[0]).toBe(false);
    });
});

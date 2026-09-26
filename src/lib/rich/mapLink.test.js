import { describe, expect, it } from 'vitest';
import { mapAttrsError, mapEmbedUrl, mapOpenUrl, placeIdOk } from './mapLink';

const PID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

describe('mapAttrsError — 지도 속성 검증(서버 rich_doc_check map 분기와 같다)', () => {
    it('place ID: 영문·숫자·_·- 10~300자만', () => {
        expect(placeIdOk(PID)).toBe(true);
        expect(placeIdOk('A'.repeat(300))).toBe(true);
        for (const bad of ['abc&key=zzzzzz', `${PID}"`, `${PID} x`, 'A'.repeat(301), 'ChIJ12345', '', null, 12]) {
            // null = 없음(대상이 없어 MAP_TARGET), 빈 문자열은 값이 있는데 규칙 밖(서버도 char_length 0 < 10 으로 MAP_PLACE)
            expect(mapAttrsError({ name: 'x', placeId: bad }), String(bad)).toBe(bad === null ? 'MAP_TARGET' : 'MAP_PLACE');
        }
    });
    it('좌표: 둘 다, 범위 안, (0,0) 금지, 소수 6자리까지, 숫자만', () => {
        expect(mapAttrsError({ name: 'x', lat: 37.5665, lng: 126.978 })).toBeNull();
        expect(mapAttrsError({ name: 'x', lat: -33.856784, lng: 151.215297 })).toBeNull();
        for (const [lat, lng] of [[91, 1], [1, 181], [-91, 1], [0, 0], ['37.1', 127], [NaN, 1], [Infinity, 1], [37.1234567, 127]]) {
            expect(mapAttrsError({ name: 'x', lat, lng }), `${lat},${lng}`).toBe('MAP_COORD');
        }
        expect(mapAttrsError({ name: 'x', lat: 37.1 })).toBe('MAP_COORD');
        expect(mapAttrsError({ name: 'x', lng: 127.1 })).toBe('MAP_COORD');
    });
    it('원 링크: 구글 지도 호스트·경로(https)만 — 위장 호스트·다른 경로·http 거부', () => {
        const ok = (url) => mapAttrsError({ name: 'x', placeId: PID, url });
        expect(ok('https://maps.app.goo.gl/abcdEFGH')).toBeNull();
        expect(ok('https://www.google.com/maps/place/x/@37.5,127,15z')).toBeNull();
        expect(ok('https://www.google.co.kr/maps?q=1,2')).toBeNull();
        expect(ok('https://goo.gl/maps/xyz')).toBeNull();
        for (const bad of ['https://maps.google.com.evil.com/', 'http://maps.google.com/', 'https://www.google.com/url?q=https://evil.com',
            'https://www.google.com/mapsx', 'https://goo.gl/abc', 'https://evil.com/maps', 'https://www.google.com:8443/maps', 'https://user@maps.google.com/']) {
            expect(ok(bad), bad).toBe('MAP_URL');
        }
    });
    it('이름 필수·120자·한 줄, 주소 300자, 여분 키 거부, 대상(placeId 또는 좌표) 필수', () => {
        expect(mapAttrsError({ placeId: PID })).toBe('MAP_NAME');
        expect(mapAttrsError({ name: '', placeId: PID })).toBe('MAP_NAME');
        expect(mapAttrsError({ name: 'a\nb', placeId: PID })).toBe('MAP_NAME');
        expect(mapAttrsError({ name: '가'.repeat(121), placeId: PID })).toBe('MAP_NAME');
        expect(mapAttrsError({ name: '가'.repeat(120), placeId: PID })).toBeNull();
        expect(mapAttrsError({ name: 'x', placeId: PID, address: '가'.repeat(301) })).toBe('MAP_ADDRESS');
        expect(mapAttrsError({ name: 'x', placeId: PID, onclick: 'x' })).toBe('MAP');
        expect(mapAttrsError({ name: 'x' })).toBe('MAP_TARGET');
        expect(mapAttrsError(null)).toBe('MAP');
    });
});

describe('mapEmbedUrl — Maps Embed 주소(new URL + URLSearchParams)', () => {
    it('placeId → place 모드 q=place_id:<id>', () => {
        const u = new URL(mapEmbedUrl({ name: '오페라하우스', placeId: PID, lat: -33.856784, lng: 151.215297 }, 'KEY'));
        expect(u.origin + u.pathname).toBe('https://www.google.com/maps/embed/v1/place');
        expect(u.searchParams.get('q')).toBe(`place_id:${PID}`);
        expect(u.searchParams.get('key')).toBe('KEY');
        expect(u.searchParams.get('language')).toBe('ko');
    });
    it('좌표만 → 문서화된 view 모드 center·zoom (place?q=lat,lng 를 쓰지 않는다)', () => {
        const s = mapEmbedUrl({ name: '시청', lat: 37.5665, lng: 126.978 }, 'KEY');
        const u = new URL(s);
        expect(u.origin + u.pathname).toBe('https://www.google.com/maps/embed/v1/view');
        expect(u.searchParams.get('center')).toBe('37.566500,126.978000');
        expect(u.searchParams.get('zoom')).toBe('16');
        expect(u.searchParams.has('q')).toBe(false);
    });
    it('작성자가 적은 이름·주소·원 링크는 iframe 주소에 들어가지 않는다', () => {
        const attrs = { name: '<script>alert(1)</script>이름', address: '"주소"&key=x', lat: 37.5, lng: 127, url: 'https://maps.app.goo.gl/zzz' };
        const s = mapEmbedUrl(attrs, 'KEY');
        expect(s).not.toContain('script');
        expect(s).not.toContain(encodeURIComponent('이름'));
        expect(s).not.toContain('maps.app.goo.gl');
        expect(new URL(s).searchParams.getAll('key')).toEqual(['KEY']);
    });
    it('키가 없거나 속성이 규칙 밖이면 null(카드로 대신)', () => {
        expect(mapEmbedUrl({ name: 'x', lat: 37.5, lng: 127 }, '')).toBeNull();
        expect(mapEmbedUrl({ name: 'x', lat: 0, lng: 0 }, 'KEY')).toBeNull();
        expect(mapEmbedUrl({ name: 'x', placeId: 'bad&id' }, 'KEY')).toBeNull();
    });
});

describe('mapOpenUrl — Google 지도에서 열기(Maps URLs)', () => {
    it('좌표만 → query=<lat>,<lng>(이름을 쓰지 않는다)', () => {
        const u = new URL(mapOpenUrl({ name: '시청', lat: 37.5665, lng: 126.978 }));
        expect(u.origin + u.pathname).toBe('https://www.google.com/maps/search/');
        expect(u.searchParams.get('api')).toBe('1');
        expect(u.searchParams.get('query')).toBe('37.566500,126.978000');
        expect(u.searchParams.has('query_place_id')).toBe(false);
    });
    it('placeId + 좌표 → query=좌표 & query_place_id, placeId 만 → query=이름', () => {
        const a = new URL(mapOpenUrl({ name: '오페라하우스', placeId: PID, lat: -33.856784, lng: 151.215297 }));
        expect(a.searchParams.get('query')).toBe('-33.856784,151.215297');
        expect(a.searchParams.get('query_place_id')).toBe(PID);
        const b = new URL(mapOpenUrl({ name: '오페라하우스', placeId: PID }));
        expect(b.searchParams.get('query')).toBe('오페라하우스');
        expect(b.searchParams.get('query_place_id')).toBe(PID);
        expect(mapOpenUrl({ name: 'x' })).toBeNull();
    });
});

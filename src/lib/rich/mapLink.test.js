import { describe, expect, it } from 'vitest';
import { candidateCoordKind, coordOf, mapAttrsError, mapEmbedUrl, mapOpenUrl, parseGoogleMapsUrl, placeIdOk } from './mapLink';

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

describe('parseGoogleMapsUrl — 붙인 구글 지도 링크를 종류별로(설계 6-7)', () => {
    it('핀 좌표(!3d!4d)와 장소 이름, 지도 중심(@)은 따로', () => {
        const r = parseGoogleMapsUrl('https://www.google.com/maps/place/%EC%98%A4%EC%82%AC%EC%B9%B4%EC%84%B1/@34.6873153,135.5262013,17z/data=!3m1!4b1!4m6!3m5!1s0x6000e0ce!8m2!3d34.6873153!4d135.5262013!16zL20vMDFtc2R2');
        expect(r.pin).toEqual({ lat: 34.687315, lng: 135.526201 });
        expect(r.center).toEqual({ lat: 34.687315, lng: 135.526201 });
        expect(r.name).toBe('오사카성');
        expect(r.placeId).toBeNull();
        expect(r.needsServer).toBe(false);
    });
    it('좌표 질의(?q=lat,lng · api=1&query=lat,lng)와 글자 질의', () => {
        expect(parseGoogleMapsUrl('https://maps.google.com/?q=37.5665,126.978').query).toEqual({ lat: 37.5665, lng: 126.978 });
        expect(parseGoogleMapsUrl('https://www.google.com/maps/search/?api=1&query=37.5665%2C126.978').query).toEqual({ lat: 37.5665, lng: 126.978 });
        const t = parseGoogleMapsUrl('https://www.google.com/maps/search/?api=1&query=%EC%84%9C%EC%9A%B8%EC%8B%9C%EC%B2%AD');
        expect(t.query).toBeNull();
        expect(t.name).toBe('서울시청');
        expect(t.needsServer).toBe(true);                // 대상(좌표·ID)이 없어 서버가 확인
    });
    it('query_place_id 는 링크 자체의 장소 ID', () => {
        const r = parseGoogleMapsUrl(`https://www.google.com/maps/search/?api=1&query=37.5,127&query_place_id=${PID}`);
        expect(r.placeId).toBe(PID);
        expect(r.query).toEqual({ lat: 37.5, lng: 127 });
        expect(parseGoogleMapsUrl('https://www.google.com/maps/search/?api=1&query=x&query_place_id=bad%20id').placeId).toBeNull();
    });
    it('중심(@)만 있으면 장소가 아니다 — 핀으로 쓰지 않는다', () => {
        const r = parseGoogleMapsUrl('https://www.google.com/maps/@37.5665,126.978,15z');
        expect(r.pin).toBeNull();
        expect(r.query).toBeNull();
        expect(r.center).toEqual({ lat: 37.5665, lng: 126.978 });
        expect(r.needsServer).toBe(false);
    });
    it('단축 주소는 서버로, 스킴 없는 주소·http 는 https 로 받아 준다', () => {
        expect(parseGoogleMapsUrl('https://maps.app.goo.gl/abcdEFGH123').needsServer).toBe(true);
        expect(parseGoogleMapsUrl('maps.app.goo.gl/abcdEFGH123').url).toBe('https://maps.app.goo.gl/abcdEFGH123');
        expect(parseGoogleMapsUrl('http://maps.google.com/?q=37.5,127').url).toBe('https://maps.google.com/?q=37.5,127');
    });
    it('구글 지도가 아니면 null(위장 호스트·다른 경로·포트·계정 정보·범위 밖 좌표는 좌표 없음)', () => {
        for (const u of ['https://maps.google.com.evil.com/?q=1,2', 'https://evil.com/maps?q=1,2', 'https://www.google.com/search?q=1,2',
            'https://www.google.com:8443/maps?q=1,2', 'https://u@maps.google.com/?q=1,2', 'javascript:alert(1)', '', null]) {
            expect(parseGoogleMapsUrl(u), String(u)).toBeNull();
        }
        expect(parseGoogleMapsUrl('https://maps.google.com/?q=91,127').query).toBeNull();
        expect(parseGoogleMapsUrl('https://maps.google.com/?q=0,0').query).toBeNull();
    });
    it('서버 후보의 좌표 종류: coord 없는 옛 캐시 결과는 지도 중심으로 본다', () => {
        expect(candidateCoordKind({ coord: 'pin' })).toBe('pin');
        expect(candidateCoordKind({ coord: 'query' })).toBe('query');
        expect(candidateCoordKind({ coord: 'center' })).toBe('center');
        expect(candidateCoordKind({})).toBe('center');
        expect(candidateCoordKind(null)).toBe('center');
        expect(coordOf('37.12345678', '127.1')).toEqual({ lat: 37.123457, lng: 127.1 });
    });
});

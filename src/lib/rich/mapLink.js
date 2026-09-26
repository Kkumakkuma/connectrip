// 서식 문서의 지도 노드(설계 plan_v3 4-9·5-3, v3.1 0장 1번).
// - 지도 속성 검증(서버 rich_doc_check 의 map 분기와 같은 규칙)
// - 표시: Maps Embed API(무료) — placeId 가 있으면 place 모드, 좌표만 있으면 문서화된 view 모드(center)
// - 열기: Maps URLs(키 불필요)
// 주소는 new URL + URLSearchParams 로만 조립한다. 작성자가 적은 이름·주소·원 링크는 iframe 주소에 넣지 않는다.
// 링크 붙여넣기 해석(parseGoogleMapsUrl)은 2단계(편집기)에서 이 파일에 더한다.
import { LIMITS, RE } from './schema';

const EMBED_BASE = 'https://www.google.com/maps/embed/v1/';
const OPEN_BASE = 'https://www.google.com/maps/search/';

// 앱(WebView)에서 Embed 가 리퍼러 문제로 뜨지 않으면(5단계 에뮬레이터 실측) false 로 바꿔 앱에서만 지도 대신 카드를 보인다.
export const MAP_EMBED_IN_APP = true;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const present = (o, k) => o[k] !== undefined && o[k] !== null;
const cpOver = (s, max) => {
    if (s.length <= max) return false;
    let n = 0;
    for (const _ of s) { if (++n > max) return true; }
    return false;
};
const sixDecimals = (x) => Math.round(x * 1e6) / 1e6 === x;

// 구글 place ID: 영문·숫자·_·- 10~300자(서버 c_re_place_id + 길이 검사와 같다)
export const placeIdOk = (v) => typeof v === 'string' && v.length >= LIMITS.placeIdMin && v.length <= LIMITS.placeIdMax && RE.placeId.test(v);

// 지도 속성이 규칙에 맞으면 null, 아니면 사유 코드(서버 DETAIL 과 같은 이름).
export function mapAttrsError(attrs) {
    if (!isObj(attrs)) return 'MAP';
    for (const k of Object.keys(attrs)) {
        if (attrs[k] !== undefined && !['placeId', 'name', 'address', 'lat', 'lng', 'url'].includes(k)) return 'MAP';
    }
    const { name } = attrs;
    if (typeof name !== 'string' || name === '' || cpOver(name, LIMITS.mapNameMax) || RE.ctrlLine.test(name)) return 'MAP_NAME';
    let hasPlace = false;
    if (present(attrs, 'placeId')) {
        if (!placeIdOk(attrs.placeId)) return 'MAP_PLACE';
        hasPlace = true;
    }
    if (present(attrs, 'address')) {
        const a = attrs.address;
        if (typeof a !== 'string' || cpOver(a, LIMITS.mapAddressMax) || RE.ctrlLine.test(a)) return 'MAP_ADDRESS';
    }
    const hasLat = present(attrs, 'lat');
    const hasLng = present(attrs, 'lng');
    if (hasLat !== hasLng) return 'MAP_COORD';
    if (hasLat) {
        const { lat, lng } = attrs;
        if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return 'MAP_COORD';
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) return 'MAP_COORD';
        if (!sixDecimals(lat) || !sixDecimals(lng)) return 'MAP_COORD';
    }
    if (present(attrs, 'url')) {
        const u = attrs.url;
        if (typeof u !== 'string' || cpOver(u, LIMITS.mapUrlMax) || !RE.mapUrl.test(u)) return 'MAP_URL';
    }
    if (!hasPlace && !hasLat) return 'MAP_TARGET';
    return null;
}

const coordText = (attrs) => `${attrs.lat.toFixed(6)},${attrs.lng.toFixed(6)}`;

// 본문·전체 화면 지도 iframe 주소. 키가 없거나 속성이 규칙 밖이면 null(지도 대신 카드).
export function mapEmbedUrl(attrs, key) {
    const k = String(key || '').trim();
    if (!k || mapAttrsError(attrs)) return null;
    const hasPlace = typeof attrs.placeId === 'string';
    const u = new URL(hasPlace ? 'place' : 'view', EMBED_BASE);
    u.searchParams.set('key', k);
    if (hasPlace) {
        u.searchParams.set('q', `place_id:${attrs.placeId}`);
    } else {
        u.searchParams.set('center', coordText(attrs));
        u.searchParams.set('zoom', '16');
    }
    u.searchParams.set('language', 'ko');
    return u.toString();
}

// "Google 지도에서 열기" 주소. placeId 가 있으면 query_place_id(구글이 ID 를 못 찾을 때만 query 를 쓴다 —
// 그때도 이름보다 정확한 저장 좌표를 먼저 쓴다), 좌표만 있으면 좌표 질의(이름을 쓰면 저장 좌표를 잃는다).
export function mapOpenUrl(attrs) {
    if (mapAttrsError(attrs)) return null;
    const hasPlace = typeof attrs.placeId === 'string';
    const hasCoord = typeof attrs.lat === 'number';
    const u = new URL(OPEN_BASE);
    u.searchParams.set('api', '1');
    u.searchParams.set('query', hasCoord ? coordText(attrs) : attrs.name);
    if (hasPlace) u.searchParams.set('query_place_id', attrs.placeId);
    return u.toString();
}

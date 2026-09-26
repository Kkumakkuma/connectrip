// 임시저장 v2(2026-09-25): 게시판별 폼 ↔ 저장 데이터 변환. 저장·불러오기 모두 허용한 칸만, 정해진 타입으로 옮긴다.
// 불러오기는 폼을 통째로 바꾼다(기본값 포함) — 이전 원고의 말머리·사진이 섞이지 않게(codex 9/25).

import { IMAGES_MAX } from './postLimits';
import { isImageRef } from './imageRefs';

const str = (v) => (v == null ? '' : String(v));
// 사진 값: 공개 주소(http/https) 또는 비공개 참조(sb://post-images/…, 후기·CREW 2026-09-26). blob:·data: 등은 버린다.
const httpUrl = (v) => (isImageRef(v) ? v : '');

// migrate: 불러오기 전에 옛 형식 원고를 새 칸으로 옮긴다(저장된 data 는 그대로 두고 읽을 때만).
const makeSpec = ({ empty, content, urls = [], lists = [], bools = [], fix = (o) => o, maxList = 5, migrate = (d) => d }) => {
    const clean = (src) => {
        const out = {};
        for (const k of Object.keys(empty)) {
            const v = src?.[k];
            if (bools.includes(k)) out[k] = !!v;
            else if (urls.includes(k)) out[k] = httpUrl(v);
            else if (lists.includes(k)) out[k] = Array.isArray(v) ? [...new Set(v.map(httpUrl).filter(Boolean))].slice(0, maxList) : [];
            else out[k] = v == null ? empty[k] : str(v);
        }
        return fix(out);
    };
    return {
        empty,
        toData: (form) => clean(form),
        fromData: (data) => clean({ ...empty, ...migrate(data && typeof data === 'object' ? data : {}) }),
        isBlank: (form) => !form || content.every((k) => {
            const v = form[k];
            return Array.isArray(v) ? v.length === 0 : str(v).trim() === '';
        }),
    };
};

const digits = (v, n = 9) => str(v).replace(/[^0-9]/g, '').slice(0, n);

// 사진 여러 장 전환(2026-09-26) 전에 저장한 원고는 image_url 한 장만 있다 → image_urls 로 옮긴다
const legacyImage = (d) => (
    !Array.isArray(d.image_urls) && typeof d.image_url === 'string' && d.image_url ? { ...d, image_urls: [d.image_url] } : d
);
// 저장할 때는 대표(첫 장)를 image_url 로도 적어 둔다 — 전환 전 화면(캐시된 웹)이 이 원고를 열어도 대표 사진은 남게(codex 9/26).
// 폼에는 image_urls 만 쓰고, 이 칸은 저장 데이터에만 붙는다.
const withCover = (spec) => ({
    ...spec,
    toData: (form) => {
        const d = spec.toData(form);
        return { ...d, image_url: d.image_urls[0] || '' };
    },
});

export const DRAFT_SPECS = {
    // 여행후기 및 Q&A(후기·Q&A·자유) — TravelQnA
    qna: withCover(makeSpec({
        empty: { title: '', content: '', image_urls: [], region_id: '', is_private: false },
        content: ['title', 'content', 'image_urls'],
        lists: ['image_urls'], maxList: IMAGES_MAX, bools: ['is_private'],
        migrate: legacyImage,
    })),
    // 여행상품 홍보 및 후기 — Promotions
    promo: makeSpec({
        empty: { title: '', content: '', image_url: '', is_private: false },
        content: ['title', 'content', 'image_url'],
        urls: ['image_url'], bools: ['is_private'],
    }),
    companion: makeSpec({
        empty: { region_id: '', title: '', country: '', date: '', members: '', content: '' },
        content: ['title', 'country', 'date', 'members', 'content'],
        fix: (o) => ({ ...o, date: /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : '' }),
    }),
    crew: makeSpec({
        empty: { title: '', content: '', category: 'restaurant', airline_id: '', image_urls: [] },
        content: ['title', 'content', 'image_urls'],
        lists: ['image_urls'], maxList: IMAGES_MAX,
    }),
    destination: withCover(makeSpec({
        empty: { region_id: '', name: '', desc: '', crewComment: '', image_urls: [] },
        content: ['name', 'desc', 'crewComment', 'image_urls'],
        lists: ['image_urls'], maxList: IMAGES_MAX,
        migrate: legacyImage,
    })),
    // 물품 구해요·공동구매 — MarketBoard
    market: makeSpec({
        empty: { title: '', price: '', location: '', content: '', image_url: '' },
        content: ['title', 'price', 'location', 'content', 'image_url'],
        urls: ['image_url'],
        fix: (o) => ({ ...o, price: digits(o.price) }),
    }),
    // 물품 팔아요·무료 나눔 — MarketListingForm
    listing: makeSpec({
        empty: { title: '', price: '', location: '', transactionType: 'direct', country: '', regionId: '', content: '', images: [] },
        content: ['title', 'price', 'location', 'country', 'content', 'images'],
        lists: ['images'],
        fix: (o) => ({ ...o, price: digits(o.price), transactionType: o.transactionType === 'delivery' ? 'delivery' : 'direct' }),
    }),
    // 같은 편 게시판 입력칸
    flight: makeSpec({
        empty: { content: '' },
        content: ['content'],
        fix: (o) => ({ ...o, content: o.content.slice(0, 1000) }),
    }),
};

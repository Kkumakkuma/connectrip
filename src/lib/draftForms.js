// 임시저장 v2(2026-09-25): 게시판별 폼 ↔ 저장 데이터 변환. 저장·불러오기 모두 허용한 칸만, 정해진 타입으로 옮긴다.
// 불러오기는 폼을 통째로 바꾼다(기본값 포함) — 이전 원고의 말머리·사진이 섞이지 않게(codex 9/25).

const str = (v) => (v == null ? '' : String(v));
const httpUrl = (v) => (typeof v === 'string' && /^https?:\/\//.test(v) ? v : '');

const makeSpec = ({ empty, content, urls = [], lists = [], bools = [], fix = (o) => o, maxList = 5 }) => {
    const clean = (src) => {
        const out = {};
        for (const k of Object.keys(empty)) {
            const v = src?.[k];
            if (bools.includes(k)) out[k] = !!v;
            else if (urls.includes(k)) out[k] = httpUrl(v);
            else if (lists.includes(k)) out[k] = Array.isArray(v) ? v.map(httpUrl).filter(Boolean).slice(0, maxList) : [];
            else out[k] = v == null ? empty[k] : str(v);
        }
        return fix(out);
    };
    return {
        empty,
        toData: (form) => clean(form),
        fromData: (data) => clean({ ...empty, ...(data && typeof data === 'object' ? data : {}) }),
        isBlank: (form) => !form || content.every((k) => {
            const v = form[k];
            return Array.isArray(v) ? v.length === 0 : str(v).trim() === '';
        }),
    };
};

const digits = (v, n = 9) => str(v).replace(/[^0-9]/g, '').slice(0, n);

export const DRAFT_SPECS = {
    // 여행후기 및 Q&A(후기·Q&A·자유) — TravelQnA
    qna: makeSpec({
        empty: { title: '', content: '', image_url: '', region_id: '', is_private: false },
        content: ['title', 'content', 'image_url'],
        urls: ['image_url'], bools: ['is_private'],
    }),
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
        empty: { title: '', content: '', category: 'restaurant', airline_id: '' },
        content: ['title', 'content'],
    }),
    destination: makeSpec({
        empty: { region_id: '', name: '', desc: '', crewComment: '', image_url: '' },
        content: ['name', 'desc', 'crewComment', 'image_url'],
        urls: ['image_url'],
    }),
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

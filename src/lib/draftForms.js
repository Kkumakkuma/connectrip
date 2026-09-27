// 임시저장 v2(2026-09-25): 게시판별 폼 ↔ 저장 데이터 변환. 저장·불러오기 모두 허용한 칸만, 정해진 타입으로 옮긴다.
// 불러오기는 폼을 통째로 바꾼다(기본값 포함) — 이전 원고의 말머리·사진이 섞이지 않게(codex 9/25).

import { IMAGES_MAX } from './postLimits';
import { isImageRef } from './imageRefs';
import { legacyToDoc, sanitizeDoc } from './rich/doc';

const str = (v) => (v == null ? '' : String(v));
// 사진 값: 공개 주소(http/https) 또는 비공개 참조(sb://post-images/…, 후기·CREW 2026-09-26). blob:·data:·아직 안 올린 대기 사진은 버린다.
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
        // 사진 칸(한 장 칸 + 목록 칸). 임시저장 때 이 칸의 대기 사진을 먼저 올린다(2026-09-27 지연 업로드, pendingImages.js)
        imageKeys: [...urls, ...lists],
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

// 서식 원고(2026-09-27 서식 편집기 2단계, 설계 plan_v3 8-1 · v3.1 5장 · plan_stage2 F장).
// 본문은 편집기가 쥔 서식 문서다(폼에는 문서 외 칸만). 저장 데이터 = { fmt: 2, 문서 외 칸, doc: 최종 문서 }.
// 평문(content)·사진 칸(image_urls·image_url)은 적지 않는다 — 서식을 모르는 옛 화면의 덮어쓰기는 서버 원고 가드가 막는다.
//  - toData(form, doc): 저장할 데이터. doc = 대기 사진이 올라가 참조로 바뀐 최종 문서(useImageSave.runDoc 결과).
//  - sigOf(form): "저장 안 한 내용" 비교값 중 문서 외 칸 부분(문서는 편집기 version 으로 비교 — 8-4).
//  - fromData(data, { boardKey, ownerId }): { form, doc }. 서식 원고면 그 문서를 정리해서(남의 사진·대기 키는 빠진다),
//    옛 원고(fmt 없음)면 legacy.migrate → 평문을 문단으로 + 사진을 맨 아래 사진 노드로(게시판 규칙 통과분만).
//  - isBlank(form, docBlank): 문서 외 content 칸이 비었고 편집기 문서도 비었으면 빈 원고.
export const isRichDraftData = (data) => String(data?.fmt ?? '') === '2';

const makeRichSpec = ({ empty, content = ['title'], bools = [], legacy }) => {
    const cleanForm = (src) => {
        const out = {};
        for (const k of Object.keys(empty)) {
            const v = src?.[k];
            out[k] = bools.includes(k) ? !!v : v == null ? empty[k] : str(v);
        }
        return out;
    };
    return {
        rich: true,
        empty,
        imageKeys: [],
        toData: (form, doc) => ({ fmt: 2, ...cleanForm(form), doc: doc ?? null }),
        sigOf: (form) => JSON.stringify(cleanForm(form)),
        fromData: (data, { boardKey, ownerId } = {}) => {
            const d = data && typeof data === 'object' ? data : {};
            const form = cleanForm({ ...empty, ...d });
            if (isRichDraftData(d) && d.doc && typeof d.doc === 'object') {
                return { form, doc: sanitizeDoc(d.doc, boardKey, ownerId), skipped: 0 };
            }
            const m = legacy.migrate(d);
            const { env, skipped } = legacyToDoc(str(m[legacy.content]), m[legacy.images], boardKey, ownerId);
            return { form, doc: env, skipped };
        },
        isBlank: (form, docBlank) => docBlank !== false && content.every((k) => str(form?.[k]).trim() === ''),
    };
};

export const DRAFT_SPECS = {
    // 여행후기 및 Q&A(후기·Q&A·자유) — TravelQnA. 서식 편집기(2단계). 후기만 사진(boards.js media private).
    qna: makeRichSpec({
        empty: { title: '', region_id: '', is_private: false },
        content: ['title'],
        bools: ['is_private'],
        legacy: { content: 'content', images: 'image_urls', migrate: legacyImage },
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

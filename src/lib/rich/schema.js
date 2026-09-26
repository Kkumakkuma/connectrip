// 게시판 서식 문서 규칙의 단일 원천(2026-09-26 서식 편집기 1단계, 설계 memory/connectrip_rich_editor/plan_v3.md 4장).
//
// 서버 검증(src/lib/rich_body_20260926.sql 의 rich_doc_check)이 같은 값을 갖고, schema.test.js 가 두 파일을 대조한다.
// 숫자·팔레트·정규식을 바꾸면 SQL 도 같이 바꿔야 한다(한쪽만 바꾸면 테스트가 깨진다).
//
// 문서 모양(봉투): { "v": 1, "doc": { "type": "doc", "content": [ 블록 1개 이상 ] } }
// 노드 문법은 4-3, 마크는 4-4, 토큰 값은 4-5 표 그대로다.
import { IMAGES_MAX } from '../postLimits';

export const DOC_VERSION = 1;

// 한도(4-2). 검사 순서: 바이트 → 노드 수·깊이(자식을 스택에 넣기 전) → 문법·토큰 → 사진·지도 개수
export const LIMITS = Object.freeze({
    docBytes: 524288,        // jsonb 텍스트(octet_length(doc::text)) 기준
    nodes: 10000,            // doc 포함
    depth: 16,               // doc = 0
    textChars: 20000,        // 텍스트 노드 한 개(코드포인트 = SQL char_length)
    marks: 6,                // 텍스트 노드당, 같은 종류 중복 금지
    images: IMAGES_MAX,      // 단일 사진 + 묶음 안 사진(서로 다른 참조)
    galleryMin: 2,
    galleryMax: 10,
    files: 5,                // 4단계 PDF 에서 사용
    maps: 10,
    hrefMax: 2048,
    refMax: 2048,
    mapNameMax: 120,
    mapAddressMax: 300,
    mapUrlMax: 2048,
    placeIdMin: 10,          // 구글 place ID 길이(정규식 반복 상한이 PostgreSQL 은 255 라 길이는 따로 본다)
    placeIdMax: 300,
    orderedStartMax: 999,
    fontCharsMax: 2000,      // 글꼴 미리 받기에 넘기는 서로 다른 글자 수(10장)
});

// 글꼴 토큰 → CSS font-family. 기본(Pretendard)은 토큰 없음.
export const FONT_FAMILIES = Object.freeze({
    myeongjo: "'Nanum Myeongjo', serif",
    pen: "'Nanum Pen Script', cursive",
    dodum: "'Gowun Dodum', sans-serif",
});
export const FONT_TOKENS = Object.freeze(Object.keys(FONT_FAMILIES));
export const FONT_SIZES = Object.freeze([13, 15, 19, 24, 28]);
export const DEFAULT_FONT_SIZE = 15;      // 편집기는 15 를 지워 저장한다(서버는 15 도 받는다)
export const COLORS = Object.freeze([
    '#000000', '#555555', '#777777', '#ba0000', '#b85c00', '#36851e', '#00756a', '#0078cb', '#004e82', '#aa1f91', '#bb005c',
]);
export const BG_COLORS = Object.freeze([
    '#fff8b2', '#ffe3c8', '#ffcdc0', '#e3fdc8', '#c2f4db', '#b0f1ff', '#fdd5f5', '#e2e2e2',
]);
export const ALIGNS = Object.freeze(['center', 'right']);     // 왼쪽 = 속성 없음
export const GALLERY_LAYOUTS = Object.freeze(['grid', 'slide', 'strip']);   // 콜라주 · 한 장씩(슬라이드) · 옆으로 나열

// 노드 분류
export const CONTAINER_NODES = Object.freeze(['doc', 'blockquote', 'bulletList', 'orderedList', 'listItem']);
export const TEXT_BLOCK_NODES = Object.freeze(['paragraph', 'heading']);
export const MEDIA_NODES = Object.freeze(['image', 'gallery', 'file', 'map']);

// 스키마에 정의된 노드 전부(4-3). file 은 자리만 있다 — PDF 첨부(4단계) 스위치 전까지 허용 목록 밖이라
// 화면 검증(validateDoc)과 서버 검증(rich_doc_check) 모두 거부한다.
export const NODE_TYPES = Object.freeze([
    'doc', 'paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem',
    'horizontalRule', 'hardBreak', 'text', 'image', 'gallery', 'file', 'map',
]);
export const FILES_ENABLED = false;
export const ALLOWED_NODES = Object.freeze(NODE_TYPES.filter((t) => FILES_ENABLED || t !== 'file'));

// 노드 객체에 올 수 있는 키
export const NODE_KEYS = Object.freeze({
    doc: ['type', 'content'],
    paragraph: ['type', 'attrs', 'content'],
    heading: ['type', 'attrs', 'content'],
    blockquote: ['type', 'content'],
    bulletList: ['type', 'content'],
    orderedList: ['type', 'attrs', 'content'],
    listItem: ['type', 'content'],
    horizontalRule: ['type'],
    hardBreak: ['type'],
    text: ['type', 'text', 'marks'],
    image: ['type', 'attrs'],
    gallery: ['type', 'attrs'],
    file: ['type', 'attrs'],
    map: ['type', 'attrs'],
});
export const ATTR_KEYS = Object.freeze({
    paragraph: ['textAlign'],
    heading: ['level', 'textAlign'],
    orderedList: ['start', 'type'],
    image: ['src'],
    gallery: ['layout', 'images'],
    file: ['src', 'name', 'size'],
    map: ['placeId', 'name', 'address', 'lat', 'lng', 'url'],
});

export const MARK_TYPES = Object.freeze(['bold', 'italic', 'underline', 'strike', 'link', 'textStyle']);
export const PLAIN_MARKS = Object.freeze(['bold', 'italic', 'underline', 'strike']);
export const TEXT_STYLE_KEYS = Object.freeze(['fontFamily', 'fontSize', 'color', 'backgroundColor']);

// 게시판별 사진 규칙(4-7). boards.js 의 key 기준 / 테이블 기준(SQL post_body_guard 와 대조).
//   private = 비공개 버킷 참조 sb://post-images/<작성자>_… (후기·CREW)
//   public  = 우리 공개 버킷 주소 …/storage/v1/object/public/images/<작성자>_… (추천지)
//   none    = 사진·묶음 노드 거부(Q&A·자유·동행)
export const BOARD_MEDIA = Object.freeze({
    review: 'private', crew: 'private', destination: 'public', qna: 'none', free: 'none', companion: 'none',
});
export const TABLE_MEDIA = Object.freeze({
    reviews: 'private', crew_posts: 'private', destinations: 'public', qna_posts: 'none', companion_posts: 'none',
});
export const mediaOf = (boardKey) => BOARD_MEDIA[boardKey] || 'none';

// 빈 글 판정 공백 문자 = JS \s 와 같은 집합(탭·줄바꿈·세로 탭·폼 피드·CR·공백·NBSP·U+1680·U+2000~200A·LS·PS·U+202F·U+205F·U+3000·BOM).
// 서버 post_body_guard 는 같은 목록을 chr(코드) 로 갖고 평문에서 모두 지워 빈 문자열인지 본다(schema.test.js 가 대조).
export const WS_CODEPOINTS = Object.freeze([
    9, 10, 11, 12, 13, 32, 160, 5760,
    8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202,
    8232, 8233, 8239, 8287, 12288, 65279,
]);

// 정규식 원문 — SQL 의 c_re_* 상수와 글자까지 같다(schema.test.js). JS·PostgreSQL 정규식이 똑같이 읽는 문법만 쓴다.
// 제어문자 범위가 \x01 부터인 이유: PostgreSQL 문자열·jsonb 는 NUL(\u0000)을 담을 수 없다. JS 쪽은 NUL 을
// 바이트 계산 단계(jsonbTextBytes)에서 따로 거부한다.
export const RE_SRC = Object.freeze({
    // 텍스트 노드 금지 제어문자(\t \n 은 허용)
    ctrl: '[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]',
    // 한 줄 값(지도 이름·주소) 금지 제어문자
    ctrlLine: '[\\x01-\\x1F\\x7F]',
    // 링크: http/https + 호스트(userinfo 없음) + 선택 포트·경로. 공백·제어문자 없음.
    href: '^https?://[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*(:[0-9]{1,5})?([/?#][^\\x01-\\x20\\x7F]*)?$',
    // 지도 원 링크(기록용): api/planner/_url-guard.js 의 구글 호스트·경로 규칙(https·포트 없음·/maps 경로 제한)
    mapUrl: '^https://((maps\\.app\\.goo\\.gl|maps\\.google\\.com)(/[^?#\\x01-\\x20\\x7F]*)?|(goo\\.gl|www\\.google\\.com|google\\.com|www\\.google\\.co\\.kr|google\\.co\\.kr)/maps(/[^?#\\x01-\\x20\\x7F]*)?)([?#][^\\x01-\\x20\\x7F]*)?$',
    placeId: '^[A-Za-z0-9_-]+$',             // 길이는 LIMITS.placeIdMin~Max
    privateRef: '^sb://post-images/[A-Za-z0-9_.-]+$',
    fileName: '^[A-Za-z0-9_.-]+$',
    // 빈 글 판정: 평문이 WS_CODEPOINTS 문자들뿐이면 빈 글(JS \s 와 같은 집합). 아래에서 코드포인트 목록으로 만든다.
    wsOnly: `^[${WS_CODEPOINTS.map((cp) => `\\u${cp.toString(16).padStart(4, '0')}`).join('')}]*$`,
});
export const RE = Object.freeze(Object.fromEntries(Object.entries(RE_SRC).map(([k, v]) => [k, new RegExp(v)])));

export const PRIVATE_REF_PREFIX = 'sb://post-images/';
// 추천지 사진: 우리 Supabase 공개 버킷 주소만(쿼리·조각 없음). SQL 은 같은 주소를 상수로 갖는다.
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
export const PUBLIC_IMAGE_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/images/`;

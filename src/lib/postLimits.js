// 게시판 글 한도(2026-09-26 쿠마님 지시 — 블로그·카페처럼 사진 넣어 길게 쓰게).
// 작성 폼·수정 폼(PostDetail)·임시저장·서버 CHECK(post_limits_images_20260926.sql)가 모두 이 값을 따른다.
// 숫자를 바꾸면 SQL 의 CHECK·트리거 인자도 같이 바꿔야 한다(화면만 올리면 서버가 막는다).
//
// 글자 수는 textarea maxLength 와 같은 단위(String.length = UTF-16)로 센다.
// 서버는 char_length(코드포인트)로 재므로 화면을 통과한 글이 서버에서 막히는 일은 없다.

export const TITLE_MAX = 100;

// 본문(boards.js 의 bodyField) 한도
export const BODY_MAX = {
    review: 20000,
    qna: 20000,
    free: 20000,
    crew: 20000,
    companion: 5000,
    destination: 200,       // 추천지 '간단한 설명' — 카드에 보이는 한 줄 소개
};

// 추천지 '승무원 꿀팁'(crew_comment) — 추천지의 긴 본문 역할
export const TIP_MAX = 20000;

// 후기·추천지·CREW 글 한 개에 넣는 사진 수(첫 장 = 대표 사진)
export const IMAGES_MAX = 20;

export const bodyMaxOf = (boardKey) => BODY_MAX[boardKey] ?? 5000;

// 글 한 개의 사진 목록. image_urls 가 비었으면 옛 글·옛 앱이 쓴 image_url 한 장으로 대신한다.
const cleanList = (v) => [...new Set((Array.isArray(v) ? v : []).filter((u) => typeof u === 'string' && u))];

export const imagesOf = (post) => {
    const list = cleanList(post?.image_urls);
    if (list.length) return list;
    return post?.image_url ? [post.image_url] : [];
};

// 저장할 때 쓰는 두 칸: image_urls(전체) + image_url(대표 = 첫 장, 목록 썸네일·옛 앱 호환)
export const imagesPatch = (images) => {
    const list = cleanList(images).slice(0, IMAGES_MAX);
    return { image_urls: list, image_url: list[0] || null };
};

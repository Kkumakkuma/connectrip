// 후기 "나만 보기"(2026-09-25 쿠마님 지시). DB 규칙은 src/lib/reviews_private_20260925.sql.
//   - 나만 보기 글은 RLS 로 작성자에게만 내려온다(관리자 예외 없음).
//   - 나만 보기로 만들 수 있는 글은 reviews 테이블의 후기(type='review')뿐이다. 홍보 글(type='promotion')은
//     DB CHECK(reviews_private_only_review)가 막으므로 화면에서도 선택지를 보이지 않는다.

// 이 게시판·이 글에 공개 설정 선택지를 보여 줄지. post 가 없으면(새 글) 게시판 설정만 본다.
export const canSetPrivate = (config, post) => {
    if (!config?.hasVisibility) return false;
    const type = post?.type ?? 'review';
    return type === 'review';
};

// 수정 저장 때 보낼 공개 설정. 바꿨을 때만 보낸다 — 오래 열어 둔 수정 창이 다른 창에서 바꾼
// 설정을 되돌리지 않게 한다(codex 검토 2026-09-25).
export const visibilityPatch = (original, next) => (!!original === !!next ? {} : { is_private: !!next });

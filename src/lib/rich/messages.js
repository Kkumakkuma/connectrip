// 서식 글 저장 안내 문구(2026-09-27 서식 편집기 2단계). 문구는 기능 이름·오류 안내뿐 — 최종 캡처로 쿠마님 확인.
import { isDocInvalid } from '../pendingImages';

// 편집기 prepareSave 가 멈춘 이유
export const richSaveMessage = (s) => {
    if (s?.error === 'DEAD_IMAGES') return '지워진 사진이 있어요. 빨간 테두리 칸을 지우고 사진을 다시 넣어 주세요.';
    if (s?.error === 'TOO_LONG') return '글자 수를 넘었어요. 조금 줄인 뒤 다시 시도해 주세요.';
    if (s?.error === 'PREPARING') return '사진을 준비하는 중이에요. 잠시 뒤 다시 눌러 주세요.';
    if (s?.error === 'DROPPED') return '한도를 넘었거나 저장할 수 없는 칸이 있어요. 사진은 20장, 지도·영상은 각각 10개까지 넣을 수 있어요.';
    return '';
};

// 글 등록·수정 실패(서버 post_body_guard 의 거부 코드 포함) → 안내. 모르는 오류는 fallback.
export function richPostErrorMessage(err, fallback) {
    const m = String(err?.message || '');
    if (m.includes('EMPTY_BODY')) return '내용을 입력해 주세요.';
    if (isDocInvalid(err) || m.includes('BAD_BODY_DOC') || m.includes('RICH_DOC_')) return '글을 저장하지 못했어요. 새로 고친 뒤 다시 시도해 주세요.';
    if (m.includes('check constraint')) return '글이 너무 길어 저장하지 못했어요.';
    return fallback;
}

// 앱(안드로이드) 뒤로가기 단추를 열린 창이 먼저 받게 하는 스택(2026-09-27 서식 편집기 2단계, agy 검토).
// 글쓰기 창·시트·확인창은 열릴 때 pushBack(닫기 함수)으로 올리고 닫힐 때 내린다. 뒤로가기를 누르면 맨 위(가장 최근에 연)
// 창의 닫기만 부른다 — 글쓰기 창의 닫기는 "임시저장하시겠습니까?"를 거치므로 쓰던 글이 확인 없이 사라지지 않는다.
// 스택이 비어 있으면 App.jsx 가 지금처럼 이전 화면으로 간다.
const stack = [];

export function pushBack(close) {
    const entry = { close };
    stack.push(entry);
    return () => {
        const i = stack.lastIndexOf(entry);
        if (i >= 0) stack.splice(i, 1);
    };
}

// 뒤로가기를 열린 창이 받았으면 true
export function handleBack() {
    const top = stack[stack.length - 1];
    if (!top) return false;
    try { top.close(); } catch (err) { console.error('뒤로가기 닫기 실패:', err); }
    return true;
}

export const __backStackSizeForTest = () => stack.length;

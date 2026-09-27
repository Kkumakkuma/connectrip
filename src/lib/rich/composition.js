// 한글 입력(IME) 조합 보조(2026-09-27 서식 편집기 2단계, 설계 plan_v3 6-3).
// - 조합 중에 서식 명령·붙여넣기를 바로 실행하면 조합이 깨진다 → 조합이 끝난 뒤 한 번 실행(runWhenNotComposing).
// - 저장 직전에는 조합 중인 글자를 확정한다(flushComposition) — 편집 영역에서 포커스를 빼면 브라우저가 조합을 끝낸다.
// ProseMirror 는 compositionend 뒤에도 짧게(수십 ms) composing 상태를 유지하므로 끝날 때까지 짧게 다시 확인한다.

const isComposing = (view) => !!view && !view.isDestroyed && view.composing === true;

// fn 을 조합이 끝난 뒤 한 번 실행한다. 조합 중이 아니면 바로. 반환: 취소 함수.
// 최대 maxWaitMs(기본 3초) 기다렸는데도 조합 중이면 실행하지 않는다(서식 명령 — 조합을 깨느니 버린다).
// force: true 면 기다린 끝에 그래도 실행한다(붙여넣기 — 사용자가 누른 내용을 버리지 않는다, agy).
export function runWhenNotComposing(view, fn, { maxWaitMs = 3000, force = false } = {}) {
    if (!isComposing(view)) { fn(); return () => {}; }
    let done = false;
    let timer = null;
    const start = Date.now();
    const cleanup = () => {
        done = true;
        clearTimeout(timer);
        view.dom?.removeEventListener?.('compositionend', onEnd);
    };
    const tryRun = () => {
        if (done) return;
        if (!view || view.isDestroyed) { cleanup(); return; }
        if (!isComposing(view)) { cleanup(); fn(); return; }
        if (Date.now() - start > maxWaitMs) { cleanup(); if (force) fn(); return; }
        timer = setTimeout(tryRun, 30);
    };
    function onEnd() { clearTimeout(timer); timer = setTimeout(tryRun, 30); }
    view.dom?.addEventListener?.('compositionend', onEnd);
    timer = setTimeout(tryRun, 250);      // compositionend 가 안 오는 입력기 대비 확인
    return cleanup;
}

// 조합 중인 글자를 확정하고 끝날 때까지 기다린다(최대 maxWaitMs). 조합 중이 아니면 바로 끝난다.
export async function flushComposition(view, { maxWaitMs = 600 } = {}) {
    if (!isComposing(view)) return;
    try { view.dom?.blur?.(); } catch { /* 이미 사라진 편집기 */ }
    const start = Date.now();
    while (isComposing(view) && Date.now() - start < maxWaitMs) {
        await new Promise((r) => { setTimeout(r, 20); });
    }
}

// ProseMirror 와 같은 판정: 안드로이드는 조합 중에도 ProseMirror 가 붙여넣기를 직접 처리한다.
export const isAndroidUA = () => typeof navigator !== 'undefined' && /Android \d/.test(navigator.userAgent || '');

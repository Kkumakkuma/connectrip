// 편집기 한 개가 갖는 사진·잠금 상태(2026-09-27 서식 편집기 2단계, plan_stage2 B·J장).
// TipTap 확장 저장소(editor.storage.ctMedia)로 편집기마다 하나씩 만들어진다 — 창을 닫으면(편집기 파괴) 함께 사라진다.
// ⚠ TipTap 은 addStorage() 결과를 얕은 복사({ ...obj })해서 쓴다(@tiptap/core Extension.storage 실측). 그래서 바뀌는
//   값은 전부 클로저 안(s)에 두고 함수로만 읽고 쓴다 — 복사본의 속성을 직접 읽으면 옛 값이 보인다.
//
// - pending : 대기 사진 표 Map<키, 대기 사진>. 사진을 고르면 서버에 올리지 않고 여기(브라우저 메모리)에만 둔다.
//             문서에는 키 문자열('pending:…')이 들어간다. 등록·임시저장 때 이 표의 파일을 올린다.
//             창이 닫힐 때까지 지우지 않는다 — 되돌리기로 키가 되살아나면 다시 올릴 수 있게.
// - dead    : 원고 덮어쓰기·원고 삭제로 서버에 지우라고 한 사진 참조. 되돌리기로 문서에 되살아나면 저장을 막는다(agy B2).
// - lock    : 저장(등록·수정·임시저장) 중 잠금. 모든 문서 변경 진입점(도구막대·시트·사진 준비 완료)이 확인한다(codex B3).
// - 구독    : 사진 칸(NodeView)·도구막대가 dead·잠금·준비 상태 변화를 다시 그리게 알린다.
import { PRIVATE_REF_PREFIX } from '../../../lib/imageRefs';
import { PUBLIC_IMAGE_PREFIX } from '../../../lib/rich/schema';

export const PENDING_KEY_RE = /^pending:[a-z0-9]+:[0-9]+$/;

export function createMediaStore({ boardKey = 'qna', userId = null } = {}) {
    const s = { lockToken: null, preparing: 0, rev: 0, notice: null, picker: null, autoOpen: null };
    const listeners = new Set();
    const pending = new Map();
    const dead = new Set();
    const emit = () => {
        s.rev += 1;
        for (const fn of [...listeners]) fn();
    };
    return {
        pending,
        dead,
        getBoardKey: () => boardKey,
        getUserId: () => userId,
        // 사진 고르기(편집기가 등록): pick({ max }) → 고르고 준비한 대기 사진 키 목록(Promise). 묶음 편집 시트가 쓴다.
        setPicker(fn) { s.picker = typeof fn === 'function' ? fn : null; },
        pick(opts) { return s.picker ? s.picker(opts) : Promise.resolve([]); },
        subscribe(fn) {
            listeners.add(fn);
            return () => { listeners.delete(fn); };
        },
        getRev: () => s.rev,
        emit,
        setNotice(fn) { s.notice = typeof fn === 'function' ? fn : null; },
        notice(text) { s.notice?.(text); },
        isPendingKey: (v) => typeof v === 'string' && PENDING_KEY_RE.test(v) && pending.has(v),
        addPending(item) { pending.set(item.key, item); },
        isLocked: () => s.lockToken !== null,
        ownsLock: (token) => !!token && s.lockToken === token,
        // 잠금: 이미 잠겨 있으면 null. 풀 때는 받은 토큰이 같아야 한다(늦게 끝난 다른 저장이 풀지 못하게).
        lock() {
            if (s.lockToken !== null) return null;
            s.lockToken = Symbol('ct-save');
            emit();
            return s.lockToken;
        },
        unlock(token) {
            if (token && s.lockToken === token) {
                s.lockToken = null;
                emit();
            }
        },
        isDead: (ref) => dead.has(ref),
        // {bucket, name}(imageDiscard.objectsRemoved) 또는 참조 문자열 목록
        markDead(list) {
            let changed = false;
            for (const o of list || []) {
                const ref = typeof o === 'string' ? o
                    : o && o.bucket === 'post-images' ? `${PRIVATE_REF_PREFIX}${o.name}`
                        : o && o.bucket === 'images' && PUBLIC_IMAGE_PREFIX.startsWith('https://') ? `${PUBLIC_IMAGE_PREFIX}${o.name}` : null;
                if (ref && !dead.has(ref)) { dead.add(ref); changed = true; }
            }
            if (changed) emit();
        },
        // 사진 묶음을 막 넣었을 때 그 묶음의 편집 시트를 바로 연다(보여 주는 방식 고르기 — v3.1 9장). 첫 사진 키로 가리킨다.
        setAutoOpen(key) { s.autoOpen = key || null; },
        takeAutoOpen(key) {
            if (!key || s.autoOpen !== key) return false;
            s.autoOpen = null;
            return true;
        },
        getPreparing: () => s.preparing,
        setPreparing(delta) {
            s.preparing = Math.max(0, s.preparing + delta);
            emit();
        },
    };
}

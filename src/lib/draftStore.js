// 글쓰기 임시저장(2026-09-25 쿠마님 지시: "글 쓰다가 중간에 멈춘 거는 임시저장해서 처음부터 안 쓰게").
// 이 기기 브라우저(localStorage)에 계정·게시판별로 한 건씩 둔다. 서버에 올리지 않는다 — 등록 전 원고라 남에게
// 보일 일이 없고, 로그인 풀림·새로고침·창 닫기·앱 종료로 날아가는 것만 막으면 된다.
// 키: ct:draft:v1:<userId>:<게시판>[:<탭>]. 14일이 지나면 읽을 때 지운다.
// 저장이 안 되는 환경(사생활 보호 모드·용량 초과·저장소 차단)에서는 조용히 아무것도 안 한다 — 글쓰기는 그대로 된다.

const PREFIX = 'ct:draft:v1:';
export const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const browserStorage = () => {
    try {
        return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
    } catch {
        return null;   // 저장소 접근 자체가 막힌 브라우저
    }
};

// 계정이 없으면(로그아웃) null — 임시저장을 끈다.
export const draftKey = (userId, ...parts) => (userId ? [userId, ...parts.filter((p) => p != null && p !== '')].join(':') : null);

export function loadDraft(key, { storage = browserStorage(), now = Date.now() } = {}) {
    if (!key || !storage) return null;
    try {
        const raw = storage.getItem(PREFIX + key);
        if (!raw) return null;
        let d = null;
        try { d = JSON.parse(raw); } catch { d = null; }   // 깨진 값도 아래에서 지운다
        const valid = d && typeof d === 'object' && typeof d.savedAt === 'number' && d.data && typeof d.data === 'object';
        if (!valid || now - d.savedAt > DRAFT_TTL_MS || d.savedAt > now + 60 * 1000) {
            storage.removeItem(PREFIX + key);
            return null;
        }
        return { savedAt: d.savedAt, data: d.data };
    } catch {
        return null;
    }
}

// 저장한 시각(ms)을 돌려준다. 실패하면 null.
export function saveDraft(key, data, { storage = browserStorage(), now = Date.now() } = {}) {
    if (!key || !storage || !data) return null;
    try {
        storage.setItem(PREFIX + key, JSON.stringify({ savedAt: now, data }));
        return now;
    } catch {
        return null;
    }
}

export function removeDraft(key, { storage = browserStorage() } = {}) {
    if (!key || !storage) return;
    try {
        storage.removeItem(PREFIX + key);
    } catch {
        /* 저장소 차단 — 지울 것도 없다 */
    }
}

const keysWithPrefix = (storage, prefix) => {
    const out = [];
    for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i);
        if (k && k.startsWith(prefix)) out.push(k);
    }
    return out;
};

// 사용자가 직접 로그아웃하면 그 계정의 임시저장본을 모두 지운다(공용 PC). 비활동 자동 로그아웃에서는 부르지 않는다
// — 쓰던 글을 지키는 게 이 기능의 목적이다.
export function removeUserDrafts(userId, { storage = browserStorage() } = {}) {
    if (!userId || !storage) return 0;
    try {
        const ks = keysWithPrefix(storage, `${PREFIX}${userId}:`);
        ks.forEach((k) => storage.removeItem(k));
        return ks.length;
    } catch {
        return 0;
    }
}

// 만료·깨진 저장본을 한 번에 지운다(읽을 때만 지우면 안 여는 게시판 원고가 계속 남는다, codex 9/25).
export function pruneDrafts({ storage = browserStorage(), now = Date.now() } = {}) {
    if (!storage) return 0;
    try {
        let n = 0;
        for (const k of keysWithPrefix(storage, PREFIX)) {
            if (loadDraft(k.slice(PREFIX.length), { storage, now }) === null && storage.getItem(k) === null) n += 1;
        }
        return n;
    } catch {
        return 0;
    }
}

// 입력한 글자가 하나도 없으면 빈 원고로 본다(말머리·분류처럼 기본값으로 채워지는 칸은 fields 에서 뺀다).
export const isBlankDraft = (value, fields) =>
    !value || fields.every((f) => {
        const v = value[f];
        if (Array.isArray(v)) return v.length === 0;
        return v == null || String(v).trim() === '';
    });

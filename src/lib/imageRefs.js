// 글 사진 주소 해석(2026-09-26 쿠마님 지시 — 나만 보기·CREW 사진은 주소를 알아도 남이 못 보게).
//
// 후기·CREW 사진은 비공개 버킷 post-images 에 올리고, 글에는 공개 주소 대신 'sb://post-images/<파일이름>' 참조를 저장한다.
// 화면은 로그인 토큰으로 파일을 직접 받아(storage download) 브라우저 메모리 주소(blob:)로 그린다. 남에게 줄 수 있는
// 주소(공개 주소·서명 주소)를 만들지 않으므로, 글을 볼 권한이 없는 사람은 무엇을 알아도 못 연다. 받을 때마다 서버가
// storage.objects SELECT 규칙(can_view_post_image = 글 읽기 권한과 같음)으로 다시 확인한다(codex 9/26: 서명 주소는 가진 사람 누구나 열린다).
// 추천지·장터·프로필 사진은 지금처럼 공개 버킷 images 의 공개 주소(https)다. 두 형식이 한 목록에 섞여도 된다.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export const PRIVATE_BUCKET = 'post-images';
export const PRIVATE_REF_PREFIX = 'sb://post-images/';
const SAFE_NAME = /^[A-Za-z0-9_.-]{1,200}$/;
const RETRY_MS = 30 * 1000;         // 실패·거부는 30초 뒤 다시 시도(받은 사진은 파일이 바뀌지 않으므로 다시 받지 않는다)
const MAX_RETRIES = 2;              // 화면이 떠 있는 동안 실패한 사진을 자동으로 다시 받는 횟수
const MAX_ENTRIES = 150;            // 메모리 주소 보관 상한 — 화면에 안 쓰이는 오래된 것부터 해제
const PARALLEL = 4;

export const isPrivateRef = (v) => (
    typeof v === 'string' && v.startsWith(PRIVATE_REF_PREFIX) && SAFE_NAME.test(v.slice(PRIVATE_REF_PREFIX.length))
);
// 글·임시저장에 넣을 수 있는 사진 값: http(s) 공개 주소 또는 비공개 참조
export const isImageRef = (v) => typeof v === 'string' && (/^https?:\/\//.test(v) || isPrivateRef(v));
export const privateName = (ref) => ref.slice(PRIVATE_REF_PREFIX.length);

// ref -> { url, until }. url 이 null 이면 거부·실패(그림 대신 빈 칸, until 뒤 다시 시도). 받은 사진은 until = 무한.
// 로그인한 사람이 바뀌거나 로그아웃하면 통째로 비운다 — 앞사람 권한으로 받은 사진을 다음 사람에게 보여주지 않게.
// inUse: 지금 화면에 그려진 참조별 개수 — 쓰이는 메모리 주소는 해제하지 않는다(codex 9/26).
const cache = new Map();
const inflight = new Map();
const inUse = new Map();
let cacheOwner;
let generation = 0;                 // 계정이 바뀐 뒤 도착한 이전 계정의 다운로드 결과는 버린다

const revoke = (entry) => {
    if (entry?.url && entry.url.startsWith('blob:') && typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(entry.url);
};

const clearAll = () => {
    cache.forEach(revoke);
    cache.clear(); inflight.clear();
    generation += 1;
};

const setOwner = (userId) => {
    if (cacheOwner === userId) return;
    clearAll();
    cacheOwner = userId;
};

// 로그아웃·계정 전환은 사진 화면이 없어도 바로 비운다
if (typeof window !== 'undefined' && supabase?.auth?.onAuthStateChange) {
    supabase.auth.onAuthStateChange((event, session) => {
        const uid = session?.user?.id;
        if (event === 'SIGNED_OUT' || (cacheOwner !== undefined && uid !== cacheOwner)) { clearAll(); cacheOwner = uid; }
    });
}

const touch = (ref) => {                                   // 최근에 쓴 것을 맨 뒤로(LRU)
    const hit = cache.get(ref);
    if (hit) { cache.delete(ref); cache.set(ref, hit); }
    return hit;
};

const remember = (ref, entry) => {
    cache.delete(ref);
    cache.set(ref, entry);
    if (cache.size <= MAX_ENTRIES) return;
    for (const [oldRef, oldEntry] of cache) {
        if (cache.size <= MAX_ENTRIES) break;
        if (inUse.get(oldRef)) continue;                   // 화면에 떠 있는 사진은 해제하지 않는다
        cache.delete(oldRef);
        revoke(oldEntry);
    }
};

const fresh = (ref) => {
    const hit = cache.get(ref);
    return hit && hit.until > Date.now() ? hit : null;
};

async function fetchOne(ref, gen) {
    let url = null;
    try {
        const { data, error } = await supabase.storage.from(PRIVATE_BUCKET).download(privateName(ref));
        if (!error && data && typeof URL !== 'undefined' && URL.createObjectURL) url = URL.createObjectURL(data);
    } catch {
        url = null;
    }
    if (gen !== generation) { revoke({ url }); return; }
    remember(ref, { url, until: url ? Infinity : Date.now() + RETRY_MS });
}

async function fetchAll(refs, gen) {
    const queue = [...refs];
    const worker = async () => {
        while (queue.length) {
            const ref = queue.shift();
            await fetchOne(ref, gen);
        }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
}

// 방금 올린 사진은 다시 받지 않고 올린 파일로 바로 보여준다(작성 중 썸네일).
export function rememberUploadedImage(ref, file, userId) {
    if (!isPrivateRef(ref) || !file || typeof URL === 'undefined' || !URL.createObjectURL) return;
    setOwner(userId);
    remember(ref, { url: URL.createObjectURL(file), until: Infinity });
}

// refs 순서 그대로 화면에 쓸 주소 배열(볼 수 없는 사진은 null).
export async function resolveImages(refs, userId) {
    setOwner(userId);
    const gen = generation;
    const list = (refs || []).filter((r) => typeof r === 'string' && r);
    list.forEach((r) => { if (isPrivateRef(r)) touch(r); });
    const need = [...new Set(list.filter((r) => isPrivateRef(r) && !fresh(r) && !inflight.has(r)))];
    if (need.length) {
        const job = fetchAll(need, gen).finally(() => need.forEach((r) => { if (inflight.get(r) === job) inflight.delete(r); }));
        need.forEach((r) => inflight.set(r, job));
    }
    const waits = [...new Set(list.filter(isPrivateRef).map((r) => inflight.get(r)).filter(Boolean))];
    await Promise.all(waits);
    if (gen !== generation) return list.map((r) => (isPrivateRef(r) ? null : r));
    return list.map((r) => (isPrivateRef(r) ? fresh(r)?.url ?? cache.get(r)?.url ?? null : r));
}

export const __resetImageRefsForTest = () => { cache.clear(); inflight.clear(); inUse.clear(); cacheOwner = undefined; generation += 1; };
export const __cacheSizeForTest = () => cache.size;

const acquire = (refs) => refs.forEach((r) => inUse.set(r, (inUse.get(r) || 0) + 1));
const release = (refs) => refs.forEach((r) => {
    const n = (inUse.get(r) || 0) - 1;
    if (n > 0) inUse.set(r, n); else inUse.delete(r);
});

// 화면용 훅. 공개 주소는 바로, 비공개 참조는 받은 뒤(그 전엔 null) 돌려준다.
const SEP = '\n';
export function useResolvedImages(refs, userId) {
    const list = (refs || []).filter((r) => typeof r === 'string' && r);
    const key = list.join(SEP);
    const hasPrivate = list.some(isPrivateRef);
    const [state, setState] = useState({ key: '', owner: undefined, urls: [] });
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        if (!hasPrivate) return undefined;
        const refsNow = key.split(SEP);
        const mine = refsNow.filter(isPrivateRef);
        acquire(mine);
        let alive = true;
        let timer;
        resolveImages(refsNow, userId).then((urls) => {
            if (!alive) return;
            setState({ key, owner: userId, urls });
            // 일시적 실패는 화면이 떠 있는 동안 몇 번 더 받아 본다(권한 없음도 같은 모양이라 횟수를 제한한다)
            if (urls.some((u, i) => u === null && isPrivateRef(refsNow[i])) && retry < MAX_RETRIES) {
                timer = setTimeout(() => { if (alive) setRetry((n) => n + 1); }, RETRY_MS + 500);
            }
        });
        return () => { alive = false; clearTimeout(timer); release(mine); };
    }, [key, hasPrivate, userId, retry]);
    if (!hasPrivate) return list;
    if (state.key === key && state.owner === userId) return state.urls;
    // 아직 받는 중: 같은 사람이 받아 둔 것만 쓴다(다른 계정이 받아 둔 사진을 보여주지 않게)
    return list.map((r) => (isPrivateRef(r) ? (cacheOwner === userId ? cache.get(r)?.url ?? null : null) : r));
}

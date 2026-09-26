// 사람이 버린 사진을 그 자리에서 서버에서 지운다(2026-09-27 쿠마님 지시 "필요 없어서 지운 사진을 왜 72시간이나 보관하냐").
//
// 부르는 곳: 글 수정 저장으로 뺀 사진, 글 삭제, 임시저장 원고에서 뺀 사진·원고 삭제, 프로필 사진 교체·되돌리기,
// 사진은 올렸는데 글·원고 저장이 실패한 경우(src/lib/pendingImages.js). 사진은 등록·임시저장 버튼을 누를 때만 올라간다.
//
// 지워도 되는지는 서버가 정한다(images_discard_20260927.sql): 내가 올린 사진이고 다른 글·임시저장·프로필·칭찬매칭·
// 롤백 백업 어디에도 안 쓰일 때만 지워진다. 쓰이고 있으면 조용히 남는다. 실패도 조용히 넘긴다 — 올린 지 72시간 지난
// 안 쓰는 사진은 매일 정리(images-purge)가 지운다. 그래서 이 함수는 절대 예외를 던지지 않는다.
import { supabase } from './supabase';
import { PRIVATE_BUCKET, PRIVATE_REF_PREFIX } from './imageRefs';
import { PUBLIC_IMAGE_PREFIX } from './rich/schema';

export const PUBLIC_BUCKET = 'images';
const BATCH = 100;
// 저장소 이름 규칙(image_name_ok 과 같은 모양): <회원 id>_<밀리초>[_<난수>].<확장자>. 회원 id 확인은 discardImages 가 한다.
const NAME_RE = /^[0-9a-f-]{36}_[0-9]{10,16}(_[A-Za-z0-9]{1,64})?\.[a-z0-9]{2,5}$/;
// 글 행·원고에 적힌 사진 참조(서버 images_referenced_names 와 같은 정규식)
const REF_IN_TEXT = /(\/storage\/v1\/object\/public\/images\/|sb:\/\/post-images\/)([A-Za-z0-9_.-]+)/g;

// 사진 값 하나 → { bucket, name } (우리 저장소 사진이 아니면 null)
//   공개 주소: <우리 Supabase>/storage/v1/object/public/images/<이름> (쿼리·조각 없음 — 화면이 만드는 모양 그대로)
//   비공개 참조: sb://post-images/<이름>
export function storageObjectOf(ref, publicPrefix = PUBLIC_IMAGE_PREFIX) {
    if (typeof ref !== 'string') return null;
    let bucket = null;
    let name = '';
    if (ref.startsWith(PRIVATE_REF_PREFIX)) {
        bucket = PRIVATE_BUCKET;
        name = ref.slice(PRIVATE_REF_PREFIX.length);
    } else if (publicPrefix && publicPrefix.startsWith('https://') && ref.startsWith(publicPrefix)) {
        bucket = PUBLIC_BUCKET;
        name = ref.slice(publicPrefix.length);
    }
    if (!bucket || !NAME_RE.test(name)) return null;
    return { bucket, name };
}

// 행·원고(아무 모양의 값)에 적힌 사진을 전부 { bucket, name } 으로. 글을 지울 때 그 글의 사진을 모으는 데 쓴다 —
// image_url·image_urls·서식 문서 안 사진을 칸 이름과 상관없이 다 찾는다(서버 참조 확인과 같은 방식).
export function imageObjectsIn(value) {
    let text = '';
    try { text = typeof value === 'string' ? value : JSON.stringify(value ?? null); } catch { return []; }
    const out = [];
    for (const m of text.matchAll(REF_IN_TEXT)) {
        const bucket = m[1].startsWith('sb:') ? PRIVATE_BUCKET : PUBLIC_BUCKET;
        if (NAME_RE.test(m[2])) out.push({ bucket, name: m[2] });
    }
    return out;
}

// before(원고·행 등 아무 값)에 적힌 사진 중 after 에는 없는 것 — 임시저장 원고를 덮어쓰거나 지울 때
export function objectsRemoved(before, after) {
    const id = (o) => `${o.bucket}/${o.name}`;
    const keep = new Set(imageObjectsIn(after).map(id));
    const seen = new Set();
    return imageObjectsIn(before).filter((o) => {
        const k = id(o);
        if (keep.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

// 값(배열·문자열·객체)에 든 사진 참조 문자열 목록 — 비교용(diffRemoved)
const refsOf = (v) => {
    if (typeof v === 'string') return v ? [v] : [];
    if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x);
    return [];
};

// before 에는 있고 after 에는 없는 사진 참조(순서 유지·중복 제거). 고르기만 한 사진(문자열이 아닌 값)은 보지 않는다.
export function diffRemoved(before, after) {
    const keep = new Set(refsOf(after));
    return [...new Set(refsOf(before))].filter((r) => !keep.has(r));
}

async function currentUserId() {
    try {
        const { data } = await supabase.auth.getSession();
        return data?.session?.user?.id || null;
    } catch {
        return null;
    }
}

// refs: 사진 참조 문자열 또는 { bucket, name } 의 배열. userId 를 안 넘기면 로그인한 사람으로.
// 내 이름('<userId>_…')만 버킷별로 최대 100개씩 remove 한다. 결과는 기다리지 않아도 된다(예외 없음).
export async function discardImages(refs, userId) {
    try {
        const items = Array.isArray(refs) ? refs : [refs];
        if (!items.length) return;
        const uid = userId || await currentUserId();
        if (!uid) return;
        const mine = `${uid}_`;
        const byBucket = new Map();
        for (const it of items) {
            const obj = typeof it === 'string' ? storageObjectOf(it) : it;
            if (!obj || (obj.bucket !== PUBLIC_BUCKET && obj.bucket !== PRIVATE_BUCKET)) continue;
            if (typeof obj.name !== 'string' || !NAME_RE.test(obj.name) || !obj.name.startsWith(mine)) continue;
            if (!byBucket.has(obj.bucket)) byBucket.set(obj.bucket, new Set());
            byBucket.get(obj.bucket).add(obj.name);
        }
        for (const [bucket, set] of byBucket) {
            const names = [...set];
            for (let i = 0; i < names.length; i += BATCH) {
                try {
                    const { error } = await supabase.storage.from(bucket).remove(names.slice(i, i + BATCH));
                    if (error) console.warn('사진 정리 실패(72시간 자동 정리로 넘어감):', error.message || error);
                } catch (err) {
                    console.warn('사진 정리 실패(72시간 자동 정리로 넘어감):', err?.message || err);
                }
            }
        }
    } catch (err) {
        console.warn('사진 정리 건너뜀:', err?.message || err);
    }
}

// 수정 저장 성공 뒤: 원래 있던 사진 중 저장된 새 값에 없는 것만 지운다.
export const discardRemoved = (before, after, userId) => discardImages(diffRemoved(before, after), userId);

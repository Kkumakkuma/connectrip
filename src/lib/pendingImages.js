// 고르기만 한 사진(대기 사진) — 2026-09-27 쿠마님 지시 "글 등록 누른 것과 임시저장 누른 것 말고는 저장하지 말라.
// 창을 끈 것도 사람이 끈 거다."
//
// 사진을 고르면 서버에 올리지 않고 브라우저에만 둔다(리사이즈한 파일 + 미리보기). 폼의 사진 목록에는 저장된 참조(문자열)와
// 대기 사진(아래 객체)이 순서대로 섞일 수 있다. 등록·수정 저장·임시저장을 누르면 대기 사진을 순서대로 올리고,
// 받은 참조로 바꾼 값으로 글·원고를 저장한다(saveWithImages).
//   - 올리다가 하나라도 실패 → 저장하지 않고, 이번에 올린 사진은 바로 지운다.
//   - 글·원고 저장이 실패 → 이번에 올린 사진은 바로 지운다(이미 저장돼 쓰이고 있으면 서버가 지우지 않는다).
// X·취소·창 닫기·"저장 안 함"은 대기 사진을 메모리에서 버리기만 한다(서버 호출 없음).
// 올리는 도중에 창을 닫으면(isCancelled) 남은 사진은 올리지 않고 글·원고도 저장하지 않으며, 이미 올린 사진은 바로 지운다
// ("창을 끈 것도 사람이 끈 거다"). 글·원고 저장 요청이 이미 나간 뒤에는 되돌릴 수 없다.
import { uploadPreparedImage } from './imageUpload';
import { discardImages } from './imageDiscard';

let seq = 0;

// file: prepareImageFile 로 준비한 파일, bucket: 올릴 버킷('images' 공개 | 'post-images' 비공개)
export const makePendingImage = (file, bucket = 'images') => ({
    pendingImage: true,
    key: `pending:${Date.now().toString(36)}:${(seq += 1)}`,
    file,
    bucket,
});

export const isPendingImage = (v) => !!v && typeof v === 'object' && v.pendingImage === true && !!v.file;

// 목록 안에서 사진 하나를 가리키는 값(React key·중복 확인)
export const imageItemKey = (v) => (isPendingImage(v) ? v.key : String(v));

const valuesOf = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// form 의 keys 칸(배열 칸이든 한 장 칸이든)에 든 대기 사진, 칸 순서·목록 순서대로
export const pendingIn = (form, keys) => (keys || []).flatMap((k) => valuesOf(form?.[k]).filter(isPendingImage));

// 임시저장의 "저장 안 한 내용" 비교에 더한다 — 대기 사진은 아직 어디에도 저장되지 않았다
export const pendingSignature = (form, keys) => pendingIn(form, keys).map((p) => p.key).join(',');

// 대기 사진을 map(key → 참조)대로 바꾼 값. map 에 없는 대기 사진은 그대로 둔다.
export const replacePending = (value, map) => {
    const swap = (v) => (isPendingImage(v) && map.has(v.key) ? map.get(v.key) : v);
    return Array.isArray(value) ? value.map(swap) : swap(value);
};

export const replacePendingInForm = (form, keys, map) => {
    if (!form || !map || map.size === 0) return form;
    const next = { ...form };
    for (const k of keys || []) {
        if (k in next) next[k] = replacePending(next[k], map);
    }
    return next;
};

export const IMAGE_UPLOAD_FAILED = 'IMAGE_UPLOAD_FAILED';
export const IMAGE_SAVE_CANCELLED = 'IMAGE_SAVE_CANCELLED';
export const PHOTO_UPLOAD_MESSAGE = '사진을 올리지 못해 저장하지 않았어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
export const isImageUploadError = (err) => err?.code === IMAGE_UPLOAD_FAILED;
export const isSaveCancelled = (err) => err?.code === IMAGE_SAVE_CANCELLED;
// 저장 실패 안내: 사진 업로드 실패면 그 안내, 아니면 fallback
export const saveErrorMessage = (err, fallback) => (isImageUploadError(err) ? PHOTO_UPLOAD_MESSAGE : fallback);
// 폼의 저장 실패 알림. 창을 닫아 취소된 저장은 알리지 않는다.
export const notifySaveError = (err, fallback) => {
    if (isSaveCancelled(err)) return;
    alert(saveErrorMessage(err, fallback));
};

const cancelledError = () => {
    const err = new Error(IMAGE_SAVE_CANCELLED);
    err.code = IMAGE_SAVE_CANCELLED;
    return err;
};

// 대기 사진을 순서대로 올린다. 반환 { map: key → 참조, uploaded: 참조 목록 }.
// 하나라도 실패하면 이번에 올린 것을 지우고 IMAGE_UPLOAD_FAILED 오류를 던진다.
// isCancelled 가 참이 되면(창 닫힘) 남은 사진은 올리지 않고, 올린 것을 지우고 IMAGE_SAVE_CANCELLED 를 던진다.
export async function uploadPendingImages(pending, { userId, onProgress, upload = uploadPreparedImage, discard = discardImages, isCancelled = () => false } = {}) {
    const map = new Map();
    const uploaded = [];
    const list = pending || [];
    const stop = () => {
        if (uploaded.length) void discard(uploaded, userId);
        return cancelledError();
    };
    for (let i = 0; i < list.length; i += 1) {
        const p = list[i];
        if (map.has(p.key)) continue;
        if (isCancelled()) throw stop();
        onProgress?.({ done: i, total: list.length });
        try {
            const ref = await upload(p.file, { userId, bucket: p.bucket });
            map.set(p.key, ref);
            uploaded.push(ref);
        } catch (cause) {
            if (uploaded.length) void discard(uploaded, userId);
            const err = new Error(IMAGE_UPLOAD_FAILED);
            err.code = IMAGE_UPLOAD_FAILED;
            err.cause = cause;
            throw err;
        }
    }
    if (isCancelled()) throw stop();
    onProgress?.({ done: list.length, total: list.length });
    return { map, uploaded };
}

// 저장 한 번: 대기 사진 업로드 → save(참조로 바꾼 form) → save 가 실패하면 이번에 올린 사진을 바로 지운다.
// 반환 { result: save 의 반환값, form: 참조로 바꾼 form, map, uploaded }.
export async function saveWithImages({ form, keys, userId, onProgress, upload, discard = discardImages, isCancelled = () => false }, save) {
    const pending = pendingIn(form, keys);
    const { map, uploaded } = pending.length
        ? await uploadPendingImages(pending, { userId, onProgress, upload, discard, isCancelled })
        : { map: new Map(), uploaded: [] };
    const next = replacePendingInForm(form, keys, map);
    // 올리는 사이 창을 닫았으면 글·원고를 저장하지 않는다(사진이 없던 저장도 같다 — 저장 요청 전이면 멈춘다)
    if (isCancelled()) {
        if (uploaded.length) void discard(uploaded, userId);
        throw cancelledError();
    }
    try {
        const result = await save(next);
        return { result, form: next, map, uploaded };
    } catch (err) {
        if (uploaded.length) void discard(uploaded, userId);
        throw err;
    }
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveWithImages } from './pendingImages';

// 글쓰기 폼의 "사진 올리고 저장" 한 번(2026-09-27 지연 업로드, 규칙은 pendingImages.js).
//   const photos = useImageSave(user?.id);
//   const { result } = await photos.run('submit', form, ['image_urls'], (f) => api.create({ ...imagesPatch(f.image_urls) }));
//   버튼 문구: photos.label('submit') → '사진 올리는 중 3/20'(올리는 동안만, 아니면 '').
//   photos.busy: 올리기부터 저장까지 진행 중 — 이때는 등록·임시저장·불러오기를 막는다.
// tag 는 어느 버튼이 부른 것인지('submit' | 'draft') — 그 버튼에만 진행 문구를 보인다.
// open: 글쓰기 창이 열려 있는지. 사진을 올리는 도중 창이 닫히면(false 가 되거나 폼이 사라지면) 남은 업로드와
//   글·원고 저장을 멈추고 올린 사진을 지운다 — 오류는 IMAGE_SAVE_CANCELLED(알림 없음, notifySaveError).
export function useImageSave(userId, open = true) {
    const [state, setState] = useState(null);      // { tag, done, total } — 진행 중일 때만
    const busyRef = useRef(false);
    const cancelRef = useRef(false);
    useEffect(() => { if (!open) cancelRef.current = true; }, [open]);
    useEffect(() => () => { cancelRef.current = true; }, []);

    const run = useCallback(async (tag, form, keys, save) => {
        if (busyRef.current) throw new Error('image-save-busy');
        busyRef.current = true;
        cancelRef.current = false;
        setState({ tag, done: 0, total: 0 });
        try {
            return await saveWithImages(
                {
                    form, keys, userId,
                    onProgress: ({ done, total }) => setState({ tag, done, total }),
                    isCancelled: () => cancelRef.current,
                },
                save,
            );
        } finally {
            busyRef.current = false;
            setState(null);
        }
    }, [userId]);

    const label = (tag) => (
        state && state.tag === tag && state.total > 0 && state.done < state.total
            ? `사진 올리는 중 ${state.done + 1}/${state.total}`
            : ''
    );

    return { run, busy: state !== null, label };
}

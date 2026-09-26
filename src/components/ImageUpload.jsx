import { useEffect, useState, useRef } from 'react';
import { X, Loader2, ImageIcon } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { ALLOWED_TYPES, MAX_FILE_SIZE, TYPE_ERROR, imageFileError, prepareImageFile } from '../lib/imageUpload';
import { isPendingImage, makePendingImage } from '../lib/pendingImages';
import { useResolvedImages } from '../lib/imageRefs';
import PendingImg from './board/PendingImg';

// 사진 고르기 칸(2026-09-27 지연 업로드 — 쿠마님 "글 등록 누른 것과 임시저장 누른 것 말고는 저장하지 말라").
// 고른 사진은 서버에 올리지 않는다. 형식·크기를 검사하고 리사이즈만 해서 onPick(대기 사진)으로 넘긴다.
// 실제 업로드는 폼의 등록·수정 저장·임시저장 버튼이 한다(src/lib/pendingImages.js, useImageSave).
// X·취소·창 닫기는 서버를 부르지 않는다(대기 사진은 메모리에서 사라질 뿐).
//
// bucket: 올릴 버킷('images' 공개 | 'post-images' 비공개) — 대기 사진에 적어 두고 올릴 때 쓴다.
// onPreparingChange: 준비(리사이즈) 중 여부를 부모에 알림(준비가 끝나기 전 저장 방지)
// label: 컴포넌트가 직접 그리는 제목. 쓰는 쪽에서 이미 '사진 (…)' 같은 제목을 달았으면 null 을 넘겨 끈다
// (안 그러면 '사진 (0/5)' 바로 아래 '이미지 첨부'가 또 나온다 — 2026-09-07 모바일 실측).
// value(한 장 모드): 폼의 사진 값 — 저장된 참조(공개 주소·sb:// 비공개 참조)·대기 사진·''. 이 값으로 미리보기를 그리고,
//   X 를 누르면 onPick('').
// multiple + maxFiles: 여러 장을 한 번에 고르면 한 장씩 준비해서 장마다 onPick. maxFiles 를 넘는 파일은 빼고 안내한다.
//   미리보기는 부모(MultiImageField 등)가 그린다.
const ImageUpload = ({ bucket = 'images', onPick, className = '', onPreparingChange, label = '이미지 첨부', value, multiple = false, maxFiles }) => {
  const { user } = useAuth();
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState(null);   // 여러 장 준비 중 { done, total }
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  // 한 장 모드 미리보기: 대기 사진은 파일로, 저장된 비공개 참조는 로그인 권한으로 받아서, 공개 주소는 그대로
  const single = !multiple;
  const pending = single && isPendingImage(value) ? value : null;
  const savedRef = single && typeof value === 'string' && value ? value : '';
  const [savedSrc] = useResolvedImages(savedRef ? [savedRef] : [], user?.id);
  const hasPreview = single && (pending || savedRef);

  // 준비는 이 컴포넌트가 떠 있는 동안만 유효하다(2026-09-26 codex 지적). 글쓰기 창을 닫으면(=언마운트)
  // 남은 파일은 준비하지 않고, 늦게 끝난 준비도 부모 폼에 사진을 붙이지 않는다 — 안 그러면 창을 다시 열어
  // 쓰는 새 글에 이전 글 사진이 섞인다. 부모의 '준비 중' 표시는 닫힐 때 한 번 풀어 준다.
  const aliveRef = useRef(true);
  const busyRef = useRef(false);
  const notifyRef = useRef(onPreparingChange);
  useEffect(() => { notifyRef.current = onPreparingChange; }, [onPreparingChange]);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (busyRef.current) { busyRef.current = false; notifyRef.current?.(false); }
    };
  }, []);
  const setBusy = (v) => {
    if (!aliveRef.current) return;
    busyRef.current = v;
    setPreparing(v);
    notifyRef.current?.(v);
  };

  const resetInput = () => { if (fileInputRef.current) fileInputRef.current.value = ''; };

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setError('');
    if (!user) { setError('로그인이 필요합니다.'); resetInput(); return; }
    const notes = [];
    let picked;
    if (single) {
      const bad = imageFileError(files[0]);
      if (bad) { setError(bad); resetInput(); return; }
      picked = [files[0]];
    } else {
      const valid = files.filter((f) => {
        if (!ALLOWED_TYPES.has(f.type)) { notes.push(`${TYPE_ERROR} 다른 파일은 뺐습니다.`); return false; }
        if (f.size > MAX_FILE_SIZE) { notes.push('5MB가 넘는 사진은 뺐습니다.'); return false; }
        return true;
      });
      const room = Math.max(0, maxFiles ?? valid.length);
      picked = valid.slice(0, room);
      if (valid.length > room) notes.push(`사진은 ${room}장만 더 넣을 수 있어 나머지는 뺐습니다.`);
      if (!picked.length) { setError([...new Set(notes)].join(' ')); resetInput(); return; }
    }
    setBusy(true);
    try {
      for (let i = 0; i < picked.length; i += 1) {
        if (!aliveRef.current) return;          // 창을 닫았으면 남은 사진은 준비하지 않는다
        if (picked.length > 1) setProgress({ done: i, total: picked.length });
        // 리사이즈·압축(실패하면 원본). 서버에는 보내지 않는다.
        const prepared = await prepareImageFile(picked[i]);
        if (!aliveRef.current) return;
        onPick?.(makePendingImage(prepared, bucket));
      }
    } finally {
      if (aliveRef.current) {
        setProgress(null);
        setBusy(false);
        resetInput();
      }
    }
    if (notes.length) setError([...new Set(notes)].join(' '));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (preparing) return;
    handleFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleRemove = () => {
    setError('');
    onPick?.('');
    resetInput();
  };

  return (
    <div className={className}>
      {label && <label className="block text-sm font-bold text-gray-700 mb-2">{label}</label>}

      {preparing ? (
        <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center" role="status" aria-live="polite">
          <Loader2 size={28} className="mx-auto text-gray-500 animate-spin mb-3" aria-hidden="true" />
          <p className="text-sm text-gray-600 font-medium">
            사진 준비 중{progress ? ` (${progress.done + 1}/${progress.total})` : ''}
          </p>
        </div>
      ) : hasPreview ? (
        <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
          {pending ? (
            <PendingImg file={pending.file} alt="미리보기" decoding="async" className="w-full h-48 object-cover" />
          ) : savedSrc ? (
            <img src={savedSrc} alt="미리보기" loading="lazy" decoding="async" className="w-full h-48 object-cover" />
          ) : (
            <div className="w-full h-48" aria-hidden="true" />
          )}
          <button
            type="button"
            onClick={handleRemove}
            className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors"
            aria-label="이미지 제거"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-all"
        >
          <ImageIcon size={32} className="mx-auto text-gray-400 mb-3" />
          <p className="text-sm text-gray-500 font-medium">
            {multiple ? '클릭하거나 사진을 끌어다 놓으세요' : '클릭하거나 이미지를 드래그하세요'}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {multiple ? `여러 장을 한 번에 고를 수 있어요 · 한 장 최대 5MB` : '최대 5MB, 이미지 파일만 가능'}
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {error && (
        <p className="text-red-500 text-sm mt-2">{error}</p>
      )}
    </div>
  );
};

export default ImageUpload;

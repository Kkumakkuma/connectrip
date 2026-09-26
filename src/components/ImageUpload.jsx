import { useEffect, useState, useRef } from 'react';
import { X, Loader2, ImageIcon } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { ALLOWED_TYPES, MAX_FILE_SIZE, TYPE_ERROR, UPLOAD_CLOSED, imageFileError, uploadImageFile } from '../lib/imageUpload';

// resetAfterUpload: 업로드 성공 후 미리보기를 비워 다음 파일을 바로 고를 수 있게(여러 장 첨부용)
// onUploadingChange: 업로드 중 여부를 부모에 알림(업로드 끝나기 전 저장 방지)
// label: 컴포넌트가 직접 그리는 제목. 쓰는 쪽에서 이미 '사진 (…)' 같은 제목을 달았으면 null 을 넘겨 끈다
// (안 그러면 '사진 (0/5)' 바로 아래 '이미지 첨부'가 또 나온다 — 2026-09-07 모바일 실측).
// currentUrl: 폼이 들고 있는 사진 주소(임시저장 복원 등, 2026-09-25). 넘기면 그 사진을 미리보기로 보이고
// 폼 값이 바뀌면 따라간다. 넘기지 않으면(undefined) 예전처럼 이 컴포넌트가 올린 사진만 보인다.
// multiple + maxFiles(2026-09-26): 여러 장을 한 번에 고르면 한 장씩 차례로 올리고 장마다 onUpload(url) 을 부른다.
// maxFiles 를 넘는 파일은 빼고 안내한다. 미리보기는 부모(MultiImageField)가 그린다.
const ImageUpload = ({ bucket = 'images', onUpload, className = '', resetAfterUpload = false, onUploadingChange, label = '이미지 첨부', currentUrl, multiple = false, maxFiles }) => {
  const { user } = useAuth();
  const [preview, setPreview] = useState(currentUrl || null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null);   // 여러 장 올리는 중 { done, total }
  useEffect(() => {
    if (currentUrl === undefined || uploading) return;
    setPreview(currentUrl || null);
  }, [currentUrl, uploading]);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  // 업로드는 이 컴포넌트가 떠 있는 동안만 유효하다(2026-09-26 codex 지적). 글쓰기 창을 닫으면(=언마운트)
  // 남은 파일은 올리지 않고, 이미 날아간 요청이 늦게 끝나도 부모 폼에 사진을 붙이지 않는다 — 안 그러면
  // 창을 다시 열어 쓰는 새 글에 이전 글 사진이 섞인다. 부모의 '올리는 중' 표시는 닫힐 때 한 번 풀어 준다.
  const aliveRef = useRef(true);
  const busyRef = useRef(false);
  const notifyRef = useRef(onUploadingChange);
  useEffect(() => { notifyRef.current = onUploadingChange; }, [onUploadingChange]);
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
    setUploading(v);
    notifyRef.current?.(v);
  };

  // 한 장 올리기(리사이즈·파일 이름 규칙은 lib/imageUpload.js). 창이 닫혔으면 보내지 않는다.
  const uploadOne = (file) => uploadImageFile(file, { userId: user.id, bucket, isAlive: () => aliveRef.current });

  const resetInput = () => { if (fileInputRef.current) fileInputRef.current.value = ''; };

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (!multiple) { handleFileSelect(files[0]); return; }
    setError('');
    if (!user) { setError('로그인이 필요합니다.'); resetInput(); return; }
    const notes = [];
    const valid = files.filter((f) => {
      if (!ALLOWED_TYPES.has(f.type)) { notes.push(`${TYPE_ERROR} 다른 파일은 뺐습니다.`); return false; }
      if (f.size > MAX_FILE_SIZE) { notes.push('5MB가 넘는 사진은 뺐습니다.'); return false; }
      return true;
    });
    const room = Math.max(0, maxFiles ?? valid.length);
    const picked = valid.slice(0, room);
    if (valid.length > room) notes.push(`사진은 ${room}장만 더 넣을 수 있어 나머지는 뺐습니다.`);
    if (!picked.length) { setError([...new Set(notes)].join(' ')); resetInput(); return; }
    setBusy(true);
    let failed = 0;
    try {
      for (let i = 0; i < picked.length; i += 1) {
        if (!aliveRef.current) return;          // 창을 닫았으면 남은 사진은 올리지 않는다
        setProgress({ done: i, total: picked.length });
        try {
          const url = await uploadOne(picked[i]);
          if (!aliveRef.current) return;
          onUpload?.(url);
        } catch (err) {
          if (err?.message === UPLOAD_CLOSED) return;
          console.error('이미지 업로드 실패:', err);
          failed += 1;
        }
      }
    } finally {
      if (aliveRef.current) {
        setProgress(null);
        setBusy(false);
        resetInput();
      }
    }
    if (failed) notes.push(`${failed}장은 올리지 못했습니다. 다시 시도해 주세요.`);
    setError([...new Set(notes)].join(' '));
  };

  const handleFileSelect = (file) => {
    setError('');
    if (!file) return;

    const bad = imageFileError(file);
    if (bad) {
      setError(bad);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(file);

    handleUpload(file);
  };

  const handleUpload = async (file) => {
    if (!user) {
      setError('로그인이 필요합니다.');
      return;
    }

    setBusy(true);
    try {
      // 클라이언트 리사이즈/압축 시도. 실패하거나 미지원 포맷이면 원본 그대로 업로드.
      const publicUrl = await uploadOne(file);
      if (!aliveRef.current) return;
      onUpload?.(publicUrl);
      if (resetAfterUpload) {
        setPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch (err) {
      if (!aliveRef.current) return;
      console.error('이미지 업로드 실패:', err);
      setError('업로드에 실패했습니다. 다시 시도해주세요.');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (uploading) return;
    handleFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleRemove = () => {
    setPreview(null);
    setError('');
    onUpload?.('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className={className}>
      {label && <label className="block text-sm font-bold text-gray-700 mb-2">{label}</label>}

      {multiple && uploading ? (
        <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center" role="status" aria-live="polite">
          <Loader2 size={28} className="mx-auto text-gray-500 animate-spin mb-3" aria-hidden="true" />
          <p className="text-sm text-gray-600 font-medium">
            사진 올리는 중{progress ? ` (${progress.done + 1}/${progress.total})` : ''}
          </p>
        </div>
      ) : preview && !multiple ? (
        <div className="relative rounded-xl overflow-hidden border border-gray-200">
          <img src={preview} alt="미리보기" loading="lazy" decoding="async" className="w-full h-48 object-cover" />
          {uploading && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <Loader2 size={32} className="text-white animate-spin" />
            </div>
          )}
          {!uploading && (
            <button
              type="button"
              onClick={handleRemove}
              className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors"
              aria-label="이미지 제거"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
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

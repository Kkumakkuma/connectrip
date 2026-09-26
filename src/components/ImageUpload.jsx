import { useEffect, useState, useRef } from 'react';
import { Upload, X, Loader2, ImageIcon } from 'lucide-react';
import { storageApi } from '../lib/db';
import { useAuth } from '../lib/AuthContext';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_DIMENSION = 1280; // 리사이즈 시 최대 변(px)
const JPEG_QUALITY = 0.8;

// 클라이언트 리사이즈/압축 대상 MIME (canvas 로 안전하게 다룰 수 있는 래스터 포맷만)
// HEIC/HEIF/SVG/GIF(애니메이션) 등은 원본 그대로 업로드한다.
const RESIZABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// 저장소(images 버킷)가 받는 형식 — post_limits_images_20260926.sql 의 allowed_mime_types 와 같게 둔다.
// SVG 는 스크립트를 담을 수 있어 받지 않는다.
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);
const TYPE_ERROR = 'JPG·PNG·WEBP·GIF·HEIC 사진만 올릴 수 있습니다.';

const CLOSED = 'image-upload-closed';

// 파일 이름 뒷부분. 공개 버킷이라 주소를 알면 열리므로 추측할 수 없게 길게 만든다(버킷 목록 조회는 막혀 있다).
const randomPart = () => (
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
);

/**
 * 이미지를 canvas 로 리사이즈/압축한다.
 * - 최대 변을 MAX_DIMENSION 으로 축소 (원본이 더 작으면 건드리지 않음)
 * - 투명 PNG 는 PNG 로 유지(투명도 보존), 그 외는 JPEG(q0.8)로 압축
 * - EXIF 회전: createImageBitmap({imageOrientation:'from-image'}) 로 보정
 * - 어떤 단계에서든 실패하면 null 을 반환 → 호출부는 원본 업로드로 폴백
 * @returns {Promise<File|null>}
 */
async function resizeImage(file) {
  try {
    if (!RESIZABLE_TYPES.has(file.type)) return null; // HEIC 등 미지원 → 원본
    if (typeof document === 'undefined') return null;

    // 비트맵 디코딩 (EXIF 회전 보정 포함)
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // createImageBitmap 미지원/실패 → Image 폴백
      bitmap = await loadImageElement(file);
    }
    if (!bitmap) return null;

    const srcW = bitmap.width;
    const srcH = bitmap.height;
    if (!srcW || !srcH) return null;

    const longest = Math.max(srcW, srcH);
    const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
    const targetW = Math.round(srcW * scale);
    const targetH = Math.round(srcH * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    if (bitmap.close) bitmap.close();

    // 투명도 보존: PNG/WebP 는 알파 채널이 있을 수 있으므로 원본 포맷을 유지하고,
    // 불투명 포맷(JPEG 등)만 JPEG 로 압축한다.
    // (투명 WebP 를 JPEG 로 변환하면 투명 영역이 검은 배경으로 채워진다 — codex 지적)
    const outType =
      file.type === 'image/png' ? 'image/png'
      : file.type === 'image/webp' ? 'image/webp'
      : 'image/jpeg';
    const outExt = outType === 'image/png' ? 'png' : outType === 'image/webp' ? 'webp' : 'jpg';
    // PNG 는 무손실(quality 무시), WebP/JPEG 는 손실 압축 품질 지정.
    const quality = outType === 'image/png' ? undefined : (outType === 'image/webp' ? 0.85 : JPEG_QUALITY);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, outType, quality);
    });
    if (!blob) return null;

    // 재인코딩 결과가 원본보다 크면(이미 최적화된 파일 등) 원본 사용.
    // 축소 여부(scale)와 무관하게 항상 비교한다 — 안 하면 더 큰 파일을 업로드할 수 있음.
    if (blob.size >= file.size) return null;

    const baseName = (file.name || 'image').replace(/\.[^./\\]+$/, '');
    return new File([blob], `${baseName}.${outExt}`, { type: outType });
  } catch (err) {
    console.error('이미지 리사이즈 실패(원본 업로드로 폴백):', err);
    return null;
  }
}

// createImageBitmap 폴백용 Image 로더
function loadImageElement(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

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

  // 한 장 리사이즈 → 업로드 → 공개 주소. 실패하면 예외.
  // 파일 이름: 저장소 규칙(storage.objects 'images' 정책)이 '<내 user id>_' 로 시작하는 이름만 받는다.
  // 여러 장을 연달아 올려도 겹치지 않게 뒤에 임의 문자열을 붙인다.
  const uploadOne = async (file) => {
    let uploadFile = file;
    const resized = await resizeImage(file);
    if (resized) uploadFile = resized;
    // 리사이즈하는 사이 창을 닫았으면 보내지 않는다(codex 9/26 재검토)
    if (!aliveRef.current) throw new Error(CLOSED);
    const ext = (uploadFile.name.split('.').pop() || 'jpg').toLowerCase();
    const filePath = `${user.id}_${Date.now()}_${randomPart()}.${ext}`;
    await storageApi.upload(bucket, filePath, uploadFile);
    return storageApi.getPublicUrl(bucket, filePath);
  };

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
          if (err?.message === CLOSED) return;
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

    if (!ALLOWED_TYPES.has(file.type)) {
      setError(TYPE_ERROR);
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError('파일 크기는 5MB 이하만 가능합니다.');
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

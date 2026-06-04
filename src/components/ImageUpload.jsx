import { useState, useRef } from 'react';
import { Upload, X, Loader2, ImageIcon } from 'lucide-react';
import { storageApi } from '../lib/db';
import { useAuth } from '../lib/AuthContext';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_DIMENSION = 1280; // 리사이즈 시 최대 변(px)
const JPEG_QUALITY = 0.8;

// 클라이언트 리사이즈/압축 대상 MIME (canvas 로 안전하게 다룰 수 있는 래스터 포맷만)
// HEIC/HEIF/SVG/GIF(애니메이션) 등은 원본 그대로 업로드한다.
const RESIZABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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

const ImageUpload = ({ bucket = 'images', onUpload, className = '' }) => {
  const { user } = useAuth();
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const handleFileSelect = (file) => {
    setError('');
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('이미지 파일만 업로드할 수 있습니다.');
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

    setUploading(true);
    try {
      // 클라이언트 리사이즈/압축 시도. 실패하거나 미지원 포맷이면 원본 그대로 업로드.
      let uploadFile = file;
      const resized = await resizeImage(file);
      if (resized) uploadFile = resized;

      const ext = (uploadFile.name.split('.').pop() || 'jpg').toLowerCase();
      const filePath = `${user.id}_${Date.now()}.${ext}`;
      await storageApi.upload(bucket, filePath, uploadFile);
      const publicUrl = storageApi.getPublicUrl(bucket, filePath);
      onUpload?.(publicUrl);
    } catch (err) {
      console.error('이미지 업로드 실패:', err);
      setError('업로드에 실패했습니다. 다시 시도해주세요.');
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
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
      <label className="block text-sm font-bold text-gray-700 mb-2">이미지 첨부</label>

      {preview ? (
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
            클릭하거나 이미지를 드래그하세요
          </p>
          <p className="text-xs text-gray-400 mt-1">최대 5MB, 이미지 파일만 가능</p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files[0])}
      />

      {error && (
        <p className="text-red-500 text-sm mt-2">{error}</p>
      )}
    </div>
  );
};

export default ImageUpload;

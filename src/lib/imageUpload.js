// 사진 올리기 공용 도구(2026-09-26, ImageUpload.jsx 에서 분리 — 프로필 사진도 같은 경로를 쓴다).
// 형식·크기 검사 → 캔버스 리사이즈 → 저장소 업로드 → 글에 저장할 주소(또는 비공개 참조) 반환.
import { storageApi } from './db';
import { PRIVATE_BUCKET, PRIVATE_REF_PREFIX, rememberUploadedImage } from './imageRefs';

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_DIMENSION = 1280; // 리사이즈 시 최대 변(px) 기본값
const JPEG_QUALITY = 0.8;

// 클라이언트 리사이즈/압축 대상 MIME (canvas 로 안전하게 다룰 수 있는 래스터 포맷만)
// HEIC/HEIF/SVG/GIF(애니메이션) 등은 원본 그대로 업로드한다.
const RESIZABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// 저장소(images 버킷)가 받는 형식 — post_limits_images_20260926.sql 의 allowed_mime_types 와 같게 둔다.
// SVG 는 스크립트를 담을 수 있어 받지 않는다.
export const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);
export const TYPE_ERROR = 'JPG·PNG·WEBP·GIF·HEIC 사진만 올릴 수 있습니다.';

export const UPLOAD_CLOSED = 'image-upload-closed';

// 파일 이름 뒷부분. 공개 버킷이라 주소를 알면 열리므로 추측할 수 없게 길게 만든다(버킷 목록 조회는 막혀 있다).
const randomPart = () => (
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
);

/**
 * 이미지를 canvas 로 리사이즈/압축한다.
 * - 최대 변을 maxDimension(기본 1280)으로 축소 (원본이 더 작으면 건드리지 않음)
 * - 투명 PNG 는 PNG 로 유지(투명도 보존), 그 외는 JPEG(q0.8)로 압축
 * - EXIF 회전: createImageBitmap({imageOrientation:'from-image'}) 로 보정
 * - 어떤 단계에서든 실패하면 null 을 반환 → 호출부는 원본 업로드로 폴백
 * @returns {Promise<File|null>}
 */
async function resizeImage(file, maxDimension = MAX_DIMENSION) {
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
    const scale = longest > maxDimension ? maxDimension / longest : 1;
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

// 형식·크기 검사. 문제가 있으면 안내 문구, 없으면 ''.
export const imageFileError = (file) => {
  if (!file || !ALLOWED_TYPES.has(file.type)) return TYPE_ERROR;
  if (file.size > MAX_FILE_SIZE) return '파일 크기는 5MB 이하만 가능합니다.';
  return '';
};

// 확장자는 파일 이름이 아니라 형식에서 정한다 — 이름에 확장자가 없거나 이상해도 저장소 이름 규칙(image_name_ok)에 맞게.
const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif' };

// 한 장 리사이즈 → 업로드. 파일 이름은 저장소 규칙(storage.objects 정책)이 받는 '<내 user id>_<밀리초>_<난수>.<확장자>'(폴더 없음).
// 여러 장을 연달아 올려도 겹치지 않게 뒤에 임의 문자열을 붙인다.
// isAlive: 리사이즈하는 사이 창이 닫혔으면 보내지 않도록 호출부가 넘기는 확인 함수(codex 9/26).
// 반환: 공개 버킷(images)이면 공개 주소, 비공개 버킷(post-images)이면 'sb://post-images/<이름>' 참조.
export async function uploadImageFile(file, { userId, bucket = 'images', maxDimension = MAX_DIMENSION, isAlive = () => true } = {}) {
  let uploadFile = file;
  const resized = await resizeImage(file, maxDimension);
  if (resized) uploadFile = resized;
  if (!isAlive()) throw new Error(UPLOAD_CLOSED);
  const ext = EXT_BY_TYPE[uploadFile.type] || 'jpg';
  const filePath = `${userId}_${Date.now()}_${randomPart()}.${ext}`;
  await storageApi.upload(bucket, filePath, uploadFile);
  if (bucket === PRIVATE_BUCKET) {
    const ref = `${PRIVATE_REF_PREFIX}${filePath}`;
    rememberUploadedImage(ref, uploadFile, userId);
    return ref;
  }
  return storageApi.getPublicUrl(bucket, filePath);
}

import { useState, useRef } from 'react';
import { Upload, X, Loader2, ImageIcon } from 'lucide-react';
import { storageApi } from '../lib/db';
import { useAuth } from '../lib/AuthContext';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

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
      const ext = file.name.split('.').pop();
      const filePath = `${user.id}_${Date.now()}.${ext}`;
      await storageApi.upload(bucket, filePath, file);
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
          <img src={preview} alt="미리보기" className="w-full h-48 object-cover" />
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
            >
              <X size={16} />
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

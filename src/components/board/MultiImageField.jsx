import { X } from 'lucide-react';
import ImageUpload from '../ImageUpload';

// 글쓰기·수정 폼의 사진 칸(2026-09-26). 여러 장을 한 번에 골라 올리고, 첫 장이 대표 사진이다.
// images: 사진 주소 배열, onChange(next | (prev) => next), max: 최대 장수(postLimits.IMAGES_MAX).
// 업로드는 한 장씩 끝날 때마다 onChange 로 붙는다 — 함수형 갱신이라 연달아 와도 앞 장이 사라지지 않는다.
const MultiImageField = ({ images, onChange, max, onUploadingChange, label = '사진 (선택)' }) => {
    const list = images || [];
    const remove = (idx) => onChange((prev) => prev.filter((_, i) => i !== idx));
    const makeCover = (idx) => onChange((prev) => [prev[idx], ...prev.filter((_, i) => i !== idx)]);
    const add = (url) => {
        if (!url) return;
        onChange((prev) => (prev.length < max && !prev.includes(url) ? [...prev, url] : prev));
    };

    return (
        <div>
            <span className="block text-sm font-bold text-ink mb-1.5">
                {label} <span className="font-normal text-muted tabular-nums">{list.length}/{max}</span>
            </span>
            {list.length > 0 && (
                <ul className="flex gap-2 flex-wrap mb-2">
                    {list.map((url, idx) => (
                        <li key={url} className="relative w-20 h-20 rounded-md overflow-hidden bg-surface-strong">
                            <img src={url} alt="" decoding="async" className="w-full h-full object-cover" />
                            {idx === 0 ? (
                                <span className="absolute bottom-0 left-0 right-0 bg-black/55 text-white text-[10px] text-center py-0.5">대표</span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => makeCover(idx)}
                                    className="absolute bottom-0 left-0 right-0 bg-black/40 hover:bg-black/60 text-white text-[10px] text-center py-0.5"
                                    aria-label={`${idx + 1}번째 사진을 대표 사진으로`}
                                >
                                    대표로
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => remove(idx)}
                                className="absolute top-1 right-1 p-0.5 rounded-full bg-black/60 text-white"
                                aria-label={`${idx + 1}번째 사진 삭제`}
                            >
                                <X size={12} aria-hidden="true" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {/* 다 채우면 업로더가 사라지면서 "나머지는 뺐습니다" 안내도 함께 사라진다 — 여기서 한도를 알려 준다 */}
            {list.length >= max && (
                <p className="text-[13px] text-muted">사진은 {max}장까지 넣을 수 있어요. 더 넣으려면 먼저 한 장을 지워 주세요.</p>
            )}
            {list.length < max && (
                <ImageUpload
                    label={null}
                    bucket="images"
                    multiple
                    maxFiles={max - list.length}
                    resetAfterUpload
                    onUploadingChange={onUploadingChange}
                    onUpload={add}
                />
            )}
        </div>
    );
};

export default MultiImageField;

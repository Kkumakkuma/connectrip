import { X } from 'lucide-react';
import ImageUpload from '../ImageUpload';
import PendingImg from './PendingImg';
import { useAuth } from '../../lib/AuthContext';
import { useResolvedImages } from '../../lib/imageRefs';
import { imageItemKey, isPendingImage } from '../../lib/pendingImages';

// 글쓰기·수정 폼의 사진 칸(2026-09-26). 여러 장을 한 번에 고르고, 첫 장이 대표 사진이다.
// images: 사진 목록 — 저장된 참조(문자열)와 고르기만 한 대기 사진(pendingImages.js)이 순서대로 섞인다(2026-09-27 지연 업로드).
//   대기 사진은 등록·수정 저장·임시저장을 누를 때 올라간다. X 는 목록에서 빼기만 한다(서버 호출 없음 — 저장된 글의 사진은
//   수정 저장이 성공한 뒤에 정리된다).
// onChange(next | (prev) => next), max: 최대 장수(postLimits.IMAGES_MAX).
// 고른 사진은 한 장씩 준비될 때마다 onChange 로 붙는다 — 함수형 갱신이라 연달아 와도 앞 장이 사라지지 않는다.
// bucket: 'images'(공개 — 추천지) | 'post-images'(비공개 — 후기·CREW, 값은 sb:// 참조. src/lib/imageRefs.js)
const MultiImageField = ({ images, onChange, max, onPreparingChange, label = '사진 (선택)', bucket = 'images' }) => {
    const { user } = useAuth();
    const list = images || [];
    // 저장된 참조만 받아서 그린다(비공개 사진은 로그인 권한으로). 대기 사진은 파일로 바로 그린다.
    const refs = list.filter((v) => typeof v === 'string' && v);
    const srcs = useResolvedImages(refs, user?.id);
    const srcOf = new Map(refs.map((r, i) => [r, srcs[i]]));
    const remove = (idx) => onChange((prev) => prev.filter((_, i) => i !== idx));
    const makeCover = (idx) => onChange((prev) => [prev[idx], ...prev.filter((_, i) => i !== idx)]);
    const add = (item) => {
        if (!item) return;
        const key = imageItemKey(item);
        onChange((prev) => (prev.length < max && !prev.some((v) => imageItemKey(v) === key) ? [...prev, item] : prev));
    };

    return (
        <div>
            <span className="block text-sm font-bold text-ink mb-1.5">
                {label} <span className="font-normal text-muted tabular-nums">{list.length}/{max}</span>
            </span>
            {list.length > 0 && (
                <ul className="flex gap-2 flex-wrap mb-2">
                    {list.map((item, idx) => (
                        <li key={imageItemKey(item)} className="relative w-20 h-20 rounded-md overflow-hidden bg-surface-strong">
                            {isPendingImage(item)
                                ? <PendingImg file={item.file} decoding="async" className="w-full h-full object-cover" />
                                : srcOf.get(item) ? <img src={srcOf.get(item)} alt="" decoding="async" className="w-full h-full object-cover" /> : null}
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
                    bucket={bucket}
                    multiple
                    maxFiles={max - list.length}
                    onPreparingChange={onPreparingChange}
                    onPick={add}
                />
            )}
        </div>
    );
};

export default MultiImageField;

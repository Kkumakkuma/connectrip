import { useId, useState } from 'react';
import { X } from 'lucide-react';
import ImageUpload from './ImageUpload';
import ContinentPicker from './board/ContinentPicker';
import { marketApi } from '../lib/db';
import { useAuth } from '../lib/AuthContext';
import { continentOf } from '../lib/continents';

const MAX_IMAGES = 5;

// 당근식 등록/수정 폼(판매 sell · 나눔 share, 2026-09-07 에어비앤비 톤). 사진 최대 5장.
// 나눔은 대륙 말머리(ContinentPicker) 필수. initial 이 있으면 수정 모드(marketApi.update), 없으면 등록(marketApi.create).
const MarketListingForm = ({ mode, initial = null, defaultRegion = null, onDone, onCancel }) => {
    const { user, profile } = useAuth();
    const formId = useId();
    const isShare = mode === 'share';
    const [title, setTitle] = useState(initial?.title || '');
    const [price, setPrice] = useState(initial?.price != null ? String(initial.price) : '');
    const [location, setLocation] = useState(initial?.location || '');
    const [transactionType, setTransactionType] = useState(initial?.transaction_type || 'direct');
    const [country, setCountry] = useState(initial?.country || '');
    const [regionId, setRegionId] = useState(initial?.region_id || defaultRegion || '');
    const [content, setContent] = useState(initial?.content || '');
    const [images, setImages] = useState(initial?.image_urls?.length ? initial.image_urls : (initial?.image_url ? [initial.image_url] : []));
    const [submitting, setSubmitting] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [pickerError, setPickerError] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        if (submitting || uploading) return;
        if (isShare && !continentOf(regionId)) { setPickerError('말머리를 선택해 주세요.'); return; }
        setSubmitting(true);
        try {
            const digits = String(price || '').replace(/[^0-9]/g, '');
            const patch = {
                title: title.trim(),
                content: content.trim(),
                location: location.trim() || null,
                image_urls: images.slice(0, MAX_IMAGES),
                image_url: images[0] || null,
            };
            if (isShare) {
                patch.price = 0;
                patch.country = country.trim();
                patch.region_id = regionId;
            } else {
                patch.price = digits ? Number(digits) : null;
                patch.transaction_type = transactionType;
            }
            let item;
            if (initial?.id) {
                item = await marketApi.update(initial.id, patch);
            } else {
                item = await marketApi.create({ ...patch, type: isShare ? 'share' : 'sell', author: profile?.nickname || profile?.name || '익명', user_id: user.id });
            }
            onDone?.(item);
        } catch (err) {
            console.error('장터 저장 실패:', err);
            alert('저장하지 못했습니다. 다시 시도해 주세요.');
        } finally {
            setSubmitting(false);
        }
    };

    const removeImage = (idx) => setImages((prev) => prev.filter((_, i) => i !== idx));

    return (
        <form onSubmit={submit} className="space-y-5">
            {isShare && <ContinentPicker name={`${formId}-continent`} value={regionId} error={pickerError} onChange={(id) => { setPickerError(''); setRegionId(id); }} />}

            <div>
                <label htmlFor={`${formId}-title`} className="block text-sm font-bold text-ink mb-1.5">제목</label>
                <input id={`${formId}-title`} type="text" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80} className="input-air" />
            </div>

            <div>
                <span className="block text-sm font-bold text-ink mb-1.5">사진 ({images.length}/{MAX_IMAGES})</span>
                {images.length > 0 && (
                    <div className="flex gap-2 flex-wrap mb-2">
                        {images.map((url, idx) => (
                            <span key={url + idx} className="relative w-20 h-20 rounded-md overflow-hidden bg-surface-strong">
                                <img src={url} alt="" className="w-full h-full object-cover" />
                                {idx === 0 && <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] text-center py-0.5">대표</span>}
                                <button type="button" onClick={() => removeImage(idx)} className="absolute top-1 right-1 p-0.5 rounded-full bg-black/60 text-white" aria-label="사진 삭제"><X size={12} /></button>
                            </span>
                        ))}
                    </div>
                )}
                {images.length < MAX_IMAGES && (
                    <ImageUpload
                        bucket="images"
                        resetAfterUpload
                        onUploadingChange={setUploading}
                        onUpload={(url) => { if (!url) return; setImages((prev) => (prev.length < MAX_IMAGES && !prev.includes(url) ? [...prev, url] : prev)); }}
                    />
                )}
            </div>

            {isShare ? (
                <div>
                    <label htmlFor={`${formId}-country`} className="block text-sm font-bold text-ink mb-1.5">국가/도시</label>
                    <input id={`${formId}-country`} type="text" value={country} onChange={(e) => setCountry(e.target.value)} required maxLength={40} className="input-air" />
                </div>
            ) : (
                <>
                    <div role="group" aria-labelledby={`${formId}-tt`}>
                        <span id={`${formId}-tt`} className="block text-sm font-bold text-ink mb-1.5">거래 유형</span>
                        <div className="flex gap-2">
                            {[['direct', '직거래'], ['delivery', '택배거래']].map(([v, label]) => (
                                <label key={v} className={`flex-1 flex items-center justify-center gap-2 h-11 rounded-md border cursor-pointer text-[14px] font-bold ${transactionType === v ? 'border-ink ring-1 ring-ink text-ink' : 'border-hairline text-muted hover:border-ink'}`}>
                                    <input type="radio" name={`${formId}-tt`} value={v} checked={transactionType === v} onChange={() => setTransactionType(v)} className="sr-only" />
                                    {label}
                                </label>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label htmlFor={`${formId}-price`} className="block text-sm font-bold text-ink mb-1.5">가격(원)</label>
                        <input id={`${formId}-price`} type="text" inputMode="numeric" maxLength={9} value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, '').slice(0, 9))} required className="input-air" />
                    </div>
                </>
            )}

            <div>
                <label htmlFor={`${formId}-location`} className="block text-sm font-bold text-ink mb-1.5">{!isShare && transactionType === 'delivery' ? '배송비' : '거래 장소'}</label>
                <input id={`${formId}-location`} type="text" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={60} className="input-air" />
            </div>

            <div>
                <label htmlFor={`${formId}-content`} className="block text-sm font-bold text-ink mb-1.5">설명</label>
                <textarea id={`${formId}-content`} value={content} onChange={(e) => setContent(e.target.value)} rows={6} required maxLength={2000} className="input-air resize-none" />
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
                <button type="button" onClick={onCancel} className="btn-air-link">취소</button>
                <button type="submit" disabled={submitting || uploading} className="btn-air-primary">
                    {submitting ? '저장 중...' : uploading ? '사진 올리는 중...' : initial?.id ? '수정' : '등록'}
                </button>
            </div>
        </form>
    );
};

export default MarketListingForm;

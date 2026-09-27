import PendingImg from '../../board/PendingImg';
import { useResolvedImages } from '../../../lib/imageRefs';

const EMPTY = [];

// 편집기 안 사진 한 장: 대기 사진 키면 브라우저 메모리의 파일로(화면에 있는 동안만 blob 주소),
// 저장된 참조면 로그인 권한으로 받아 그린다(비공개 사진). 못 받으면 빈 칸.
const Thumb = ({ store, value, className, alt = '' }) => {
    const item = store.pending.get(value);
    const [url] = useResolvedImages(item || !value ? EMPTY : [value], store.getUserId());
    if (item) return <PendingImg file={item.file} alt={alt} decoding="async" className={className} />;
    if (url) return <img src={url} alt={alt} decoding="async" draggable={false} className={className} />;
    return <div className={`bg-surface-soft ${className}`} aria-hidden="true" />;
};

export default Thumb;

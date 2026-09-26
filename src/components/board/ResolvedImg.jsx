import { useAuth } from '../../lib/AuthContext';
import { useResolvedImages } from '../../lib/imageRefs';

// 사진 한 장 그리기. src 가 공개 주소면 그대로, 비공개 참조(sb://post-images/…)면 로그인 권한으로 받아서 그린다.
// 받는 중이거나 볼 권한이 없으면 같은 크기의 빈 칸(placeholderClassName, 없으면 className)을 둔다.
const ResolvedImg = ({ src, alt = '', className = '', placeholderClassName, ...rest }) => {
    const { user } = useAuth();
    const [url] = useResolvedImages(src ? [src] : [], user?.id);
    if (!url) return <span className={`block ${placeholderClassName ?? className}`} aria-hidden="true" />;
    return <img src={url} alt={alt} className={className} {...rest} />;
};

export default ResolvedImg;

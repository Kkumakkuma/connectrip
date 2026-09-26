import { useState } from 'react';

// 프로필 사진(2026-09-26 쿠마님 지시). 사진이 없거나 못 불러오면 흔히 쓰는 회색 사람 모양 기본 그림.
// size: 지름(px). 사진 주소는 profiles.avatar_url(공개 버킷 images 또는 소셜 가입 때 받은 https 주소).
export const DefaultAvatar = ({ size = 40, className = '' }) => (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="기본 프로필 사진">
        <circle cx="32" cy="32" r="32" fill="#E5E7EB" />
        <circle cx="32" cy="25" r="11" fill="#9CA3AF" />
        <path d="M12 54c2.6-10 10.6-16 20-16s17.4 6 20 16a31.8 31.8 0 0 1-40 0Z" fill="#9CA3AF" />
    </svg>
);

const Avatar = ({ src, size = 40, alt = '', className = '' }) => {
    // 주소가 바뀌면 다시 시도한다(깨진 주소를 기억해 두는 것은 그 주소에 한해서만)
    const [broken, setBroken] = useState(null);
    if (!src || broken === src) return <DefaultAvatar size={size} className={`rounded-full flex-shrink-0 ${className}`} />;
    return (
        <img
            src={src}
            alt={alt}
            width={size}
            height={size}
            decoding="async"
            onError={() => setBroken(src)}
            className={`rounded-full object-cover bg-surface-strong flex-shrink-0 ${className}`}
            style={{ width: size, height: size }}
        />
    );
};

export default Avatar;

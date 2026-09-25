import { Lock } from 'lucide-react';

// "나만 보기" 글 표시(2026-09-25). 비공개 글은 RLS 로 작성자에게만 내려오므로(관리자 예외 없음,
// src/lib/reviews_private_20260925.sql) 이 배지를 보는 사람은 작성자뿐이다. 공개 글이면 아무것도 그리지 않는다.
const PrivateBadge = ({ isPrivate, className = '' }) => {
    if (!isPrivate) return null;
    return (
        <span className={`inline-flex items-center gap-1 rounded-full bg-surface-strong px-2 py-0.5 text-[11px] font-bold text-ink whitespace-nowrap ${className}`}>
            <Lock size={11} aria-hidden="true" />
            <span>나만 보기</span>
        </span>
    );
};

export default PrivateBadge;

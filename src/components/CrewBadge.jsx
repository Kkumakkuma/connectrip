import { ShieldCheck } from 'lucide-react';

// 인증 승무원(user_type='crew' + crew_verified) 작성자 이름 옆에 붙는 공용 배지.
// profile = 글/댓글 행에 임베드된 profiles. 조건 미충족이면 렌더하지 않는다.
// PostgREST 임베드는 관계 추론에 따라 객체 대신 1건짜리 배열로 올 수 있어 양쪽을 받는다.
const CrewBadge = ({ profile, className = '' }) => {
    // 배열이면서 원소가 2개 이상이면 어느 쪽이 작성자인지 단정할 수 없으므로 표시하지 않는다.
    const p = Array.isArray(profile) ? (profile.length === 1 ? profile[0] : null) : profile;
    if (!p || p.user_type !== 'crew' || !p.crew_verified) return null;
    return (
        <span
            className={`inline-flex items-center gap-0.5 align-middle whitespace-nowrap flex-shrink-0 bg-purple-100 text-purple-700 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${className}`}
            title="인증된 현직 승무원"
        >
            <ShieldCheck size={11} strokeWidth={2.5} className="flex-shrink-0" />
            CREW
        </span>
    );
};

export default CrewBadge;

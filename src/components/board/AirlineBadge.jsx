import { airlineTagOf } from '../../lib/airlineTags';

// 글 앞 항공사 말머리. 글이 다루는 항공사이지 글쓴이 소속이 아니다(2026-09-17).
// 모르는 값이면 아무것도 그리지 않는다.
const AirlineBadge = ({ airlineId, size = 'sm', className = '' }) => {
    const a = airlineTagOf(airlineId);
    if (!a) return null;
    const sz = size === 'md' ? 'text-[13px] px-2.5 py-1' : 'text-[11px] px-2 py-0.5';
    return (
        <span className={`inline-flex items-center rounded-full font-bold whitespace-nowrap ${sz} ${a.bg} ${a.text} ${className}`} title={a.name}>
            {a.name}
        </span>
    );
};

export default AirlineBadge;

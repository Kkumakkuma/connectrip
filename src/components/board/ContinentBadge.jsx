import { continentOf } from '../../lib/continents';

// 글 앞 말머리: 대륙 아이콘 + 이름, 대륙마다 다른 글색·연한 배경. 모르는 값이면 아무것도 그리지 않는다.
const ContinentBadge = ({ regionId, size = 'sm', className = '' }) => {
    const c = continentOf(regionId);
    if (!c) return null;
    const sz = size === 'md' ? 'text-[13px] px-2.5 py-1 gap-1.5' : 'text-[11px] px-2 py-0.5 gap-1';
    return (
        <span className={`inline-flex items-center rounded-full font-bold whitespace-nowrap ${sz} ${c.bg} ${c.text} ${className}`} title={c.name}>
            <span aria-hidden="true">{c.icon}</span>
            <span>{c.name}</span>
        </span>
    );
};

export default ContinentBadge;

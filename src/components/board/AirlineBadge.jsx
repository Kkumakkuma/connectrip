import { airlineTagOf } from '../../lib/airlineTags';

// 글 앞 항공사 말머리. 글이 다루는 항공사이지 글쓴이 소속이 아니다(2026-09-17).
// 표기는 게시판 말머리 방식대로 [대한항공] 처럼 대괄호로 두고 항공사마다 색을 달리한다
// (알약 배지가 작아 눈에 안 띈다는 쿠마님 9902·9903). 모르는 값이면 아무것도 그리지 않는다.
const AirlineBadge = ({ airlineId, size = 'sm', className = '' }) => {
    const a = airlineTagOf(airlineId);
    if (!a) return null;
    const sz = size === 'md' ? 'text-[17px]' : 'text-[15px] sm:text-[16px]';
    return (
        <span className={`font-extrabold whitespace-nowrap tracking-[-0.01em] ${sz} ${a.text} ${className}`} title={a.name}>
            [{a.name}]
        </span>
    );
};

export default AirlineBadge;

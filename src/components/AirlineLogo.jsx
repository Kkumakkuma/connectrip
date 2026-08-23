import { useState } from 'react';

// 항공사 로고 이미지. 파일이 없거나 로드에 실패하면 기존 이모지로 폴백한다.
// airline = AIRLINE_DOMAINS 항목 (getAirlineInfo / getAirlineList 결과)
const AirlineLogo = ({ airline, height = 16, maxWidth = 92, style }) => {
    const [failed, setFailed] = useState(false);
    if (!airline) return null;
    if (failed || !airline.logoSrc) {
        return <span style={{ fontSize: height, lineHeight: 1, ...style }}>{airline.logo}</span>;
    }
    return (
        <img
            src={airline.logoSrc}
            alt={airline.name}
            title={airline.name}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            style={{ height, width: 'auto', maxWidth, objectFit: 'contain', verticalAlign: 'middle', flexShrink: 0, ...style }}
        />
    );
};

export default AirlineLogo;

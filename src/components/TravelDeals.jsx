// 여행 제휴(어필리에이트) CTA 카드 — Travelpayouts 파트너 링크 (marker=738928)
// 순수 anchor 링크만 사용. 외부 트래킹 스크립트/위젯 미사용.
const AVIASALES_URL = 'https://www.aviasales.com/?marker=738928';
const HOTELLOOK_URL = 'https://search.hotellook.com/?marker=738928';

const TravelDeals = ({ title = '여행 준비 — 항공권·호텔 특가 찾기', className = '' }) => {
    return (
        <div className={`bg-white rounded-2xl border border-gray-100 shadow-md p-6 ${className}`}>
            <h3 className="text-lg font-bold text-gray-900 mb-1">{title}</h3>
            <p className="text-sm text-gray-500 mb-4">항공권과 호텔 가격을 미리 비교하고 떠나세요.</p>
            <div className="flex flex-col sm:flex-row gap-3">
                <a
                    href={AVIASALES_URL}
                    target="_blank"
                    rel="noopener sponsored nofollow"
                    className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 transition-colors"
                >
                    <span aria-hidden="true">✈️</span> 항공권 가격 비교
                </a>
                <a
                    href={HOTELLOOK_URL}
                    target="_blank"
                    rel="noopener sponsored nofollow"
                    className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-sky-50 text-sky-700 font-bold border border-sky-100 hover:bg-sky-100 transition-colors"
                >
                    <span aria-hidden="true">🏨</span> 호텔 가격 비교
                </a>
            </div>
            <p className="text-xs text-gray-400 mt-3">
                제휴 링크입니다 · 예약 시 일부 수수료를 받을 수 있어요(추가 비용 없음)
            </p>
        </div>
    );
};

export default TravelDeals;

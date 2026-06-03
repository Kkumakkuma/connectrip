import { Loader2, AlertCircle, RefreshCw, Inbox } from 'lucide-react';

/**
 * 목록 영역 공용 상태 컴포넌트.
 * - loading: 스피너 + 안내 문구
 * - error:   에러 아이콘 + 메시지 + (onRetry 가 있으면) 다시 시도 버튼
 * - empty:   빈 상태 안내 (커스텀 emptyIcon / emptyTitle / emptyDesc 지원)
 *
 * 우선순위: loading > error > empty.
 * 셋 다 해당 없으면 null 을 반환하므로, 실제 목록은 호출부에서 별도로 렌더한다.
 *
 * 기존 인라인 로더(Loader2 size=48 animate-spin) / 점선 빈 상태 카드 톤과 맞춘다.
 *
 * @param {boolean}  loading      로딩 여부
 * @param {string}   [error]      에러 메시지 (truthy 면 에러 표시)
 * @param {boolean}  [empty]      빈 상태 여부 (loading/error 아닐 때만 적용)
 * @param {Function} [onRetry]    재시도 핸들러. 있으면 에러 화면에 "다시 시도" 버튼 노출
 * @param {string}   [color]      포인트 색상 (blue|green|purple|pink). 기본 blue
 * @param {string}   [loadingText] 로딩 문구
 * @param {React.ReactNode} [emptyIcon] 빈 상태 아이콘 (기본 Inbox)
 * @param {string}   [emptyTitle] 빈 상태 제목
 * @param {string}   [emptyDesc]  빈 상태 설명
 */
const COLOR_MAP = {
    blue: 'text-blue-500',
    green: 'text-green-500',
    purple: 'text-purple-500',
    pink: 'text-pink-500',
};

const ListState = ({
    loading = false,
    error = null,
    empty = false,
    onRetry,
    color = 'blue',
    loadingText = '불러오는 중...',
    emptyIcon = null,
    emptyTitle = '아직 등록된 글이 없습니다.',
    emptyDesc = '첫 번째 글을 작성해보세요!',
}) => {
    const accent = COLOR_MAP[color] || COLOR_MAP.blue;

    if (loading) {
        return (
            <div className="py-20 text-center">
                <Loader2 size={48} className={`mx-auto ${accent} animate-spin mb-4`} />
                <p className="text-gray-500 text-lg">{loadingText}</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="py-20 text-center bg-white rounded-3xl border border-dashed border-red-200">
                <AlertCircle size={48} className="mx-auto text-red-400 mb-4" />
                <p className="text-gray-700 text-lg font-semibold mb-1">{error}</p>
                <p className="text-gray-400 text-sm mb-6">잠시 후 다시 시도해주세요.</p>
                {onRetry && (
                    <button
                        onClick={onRetry}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors"
                    >
                        <RefreshCw size={18} /> 다시 시도
                    </button>
                )}
            </div>
        );
    }

    if (empty) {
        return (
            <div className="py-20 text-center bg-white rounded-3xl border border-dashed border-gray-200">
                {emptyIcon || <Inbox size={48} className="mx-auto text-gray-300 mb-4" />}
                <p className="text-gray-500 text-lg">{emptyTitle}</p>
                {emptyDesc && <p className="text-gray-400 mt-1">{emptyDesc}</p>}
            </div>
        );
    }

    return null;
};

export default ListState;

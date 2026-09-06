import { Loader2, AlertCircle, RefreshCw, Inbox } from 'lucide-react';

/**
 * 목록 영역 공용 상태 컴포넌트(2026-09-07 에어비앤비 톤으로 정리).
 * - loading: 스피너 + 안내 문구
 * - error:   에러 아이콘 + 메시지 + (onRetry 가 있으면) 다시 시도 버튼
 * - empty:   빈 상태 안내 (커스텀 emptyIcon / emptyTitle / emptyDesc 지원)
 *
 * 우선순위: loading > error > empty. 셋 다 해당 없으면 null.
 *
 * @param {boolean}  loading      로딩 여부
 * @param {string}   [error]      에러 메시지 (truthy 면 에러 표시)
 * @param {boolean}  [empty]      빈 상태 여부 (loading/error 아닐 때만 적용)
 * @param {Function} [onRetry]    재시도 핸들러
 * @param {string}   [color]      포인트 색상 (ink|blue|green|purple|pink). 기본 ink
 * @param {string}   [loadingText] 로딩 문구
 * @param {React.ReactNode} [emptyIcon] 빈 상태 아이콘 (기본 Inbox)
 * @param {string}   [emptyTitle] 빈 상태 제목
 * @param {string}   [emptyDesc]  빈 상태 설명 (null 이면 생략)
 */
const COLOR_MAP = {
    ink: 'text-ink',
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
    color = 'ink',
    loadingText = '불러오는 중...',
    emptyIcon = null,
    emptyTitle = '아직 등록된 글이 없습니다.',
    emptyDesc = '첫 번째 글을 작성해보세요!',
}) => {
    const accent = COLOR_MAP[color] || COLOR_MAP.ink;

    if (loading) {
        return (
            <div className="py-20 text-center">
                <Loader2 size={36} className={`mx-auto ${accent} animate-spin mb-3`} />
                <p className="text-muted text-[15px]">{loadingText}</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="py-16 text-center rounded-md border border-hairline">
                <AlertCircle size={36} className="mx-auto text-error mb-3" />
                <p className="text-ink text-[15px] font-bold mb-1">{error}</p>
                <p className="text-muted text-sm mb-5">잠시 후 다시 시도해주세요.</p>
                {onRetry && (
                    <button onClick={onRetry} className="btn-air-secondary">
                        <RefreshCw size={16} /> 다시 시도
                    </button>
                )}
            </div>
        );
    }

    if (empty) {
        return (
            <div className="py-16 text-center rounded-md border border-dashed border-hairline">
                {emptyIcon || <Inbox size={36} className="mx-auto text-muted-soft mb-3" />}
                <p className="text-ink text-[15px] font-semibold">{emptyTitle}</p>
                {emptyDesc && <p className="text-muted text-sm mt-1">{emptyDesc}</p>}
            </div>
        );
    }

    return null;
};

export default ListState;

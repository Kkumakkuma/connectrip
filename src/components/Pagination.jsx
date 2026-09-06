import { ChevronLeft, ChevronRight } from 'lucide-react';

// 페이지 번호(에어비앤비 톤, 2026-09-07): 활성은 ink 채움, 나머지는 텍스트. color 는 호환용으로 남긴다.
const Pagination = ({ currentPage, totalPages, onPageChange, color = 'ink' }) => {
    const getPageNumbers = () => {
        const pages = [];
        const maxVisible = 5;

        if (totalPages <= maxVisible) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
        } else if (currentPage <= 3) {
            for (let i = 1; i <= 4; i++) pages.push(i);
            pages.push('...');
            pages.push(totalPages);
        } else if (currentPage >= totalPages - 2) {
            pages.push(1);
            pages.push('...');
            for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
        } else {
            pages.push(1);
            pages.push('...');
            for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
            pages.push('...');
            pages.push(totalPages);
        }
        return pages;
    };

    const active = {
        ink: 'bg-ink text-white',
        blue: 'bg-blue-600 text-white',
        green: 'bg-green-600 text-white',
        pink: 'bg-pink-500 text-white',
    }[color] || 'bg-ink text-white';

    if (!totalPages || totalPages <= 1) return null;

    return (
        <nav aria-label="페이지" className="flex items-center justify-center gap-1 mt-8">
            <button
                type="button"
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 1}
                aria-label="이전 페이지"
                className="p-2 rounded-full text-ink hover:bg-surface-soft disabled:text-muted-soft disabled:hover:bg-transparent disabled:cursor-not-allowed"
            >
                <ChevronLeft size={18} />
            </button>

            {getPageNumbers().map((page, index) => (
                page === '...' ? (
                    <span key={`ellipsis-${index}`} className="px-2 text-muted">…</span>
                ) : (
                    <button
                        key={page}
                        type="button"
                        onClick={() => onPageChange(page)}
                        aria-current={currentPage === page ? 'page' : undefined}
                        className={`min-w-[36px] h-9 px-2 rounded-full text-[14px] font-semibold transition-colors ${currentPage === page ? active : 'text-ink hover:bg-surface-soft'}`}
                    >
                        {page}
                    </button>
                )
            ))}

            <button
                type="button"
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                aria-label="다음 페이지"
                className="p-2 rounded-full text-ink hover:bg-surface-soft disabled:text-muted-soft disabled:hover:bg-transparent disabled:cursor-not-allowed"
            >
                <ChevronRight size={18} />
            </button>
        </nav>
    );
};

export default Pagination;

import { ChevronLeft, ChevronRight } from 'lucide-react';

const Pagination = ({ currentPage, totalPages, onPageChange, color = 'blue' }) => {
    const getPageNumbers = () => {
        const pages = [];
        const maxVisible = 5;

        if (totalPages <= maxVisible) {
            for (let i = 1; i <= totalPages; i++) {
                pages.push(i);
            }
        } else {
            if (currentPage <= 3) {
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
        }

        return pages;
    };

    const colorClasses = {
        blue: {
            active: 'bg-blue-600 text-white',
            hover: 'hover:bg-blue-50 hover:text-blue-600',
            border: 'border-blue-600'
        },
        green: {
            active: 'bg-green-600 text-white',
            hover: 'hover:bg-green-50 hover:text-green-600',
            border: 'border-green-600'
        },
        pink: {
            active: 'bg-pink-500 text-white',
            hover: 'hover:bg-pink-50 hover:text-pink-500',
            border: 'border-pink-500'
        }
    };

    const colors = colorClasses[color] || colorClasses.blue;

    return (
        <div className="flex items-center justify-center gap-2 mt-8">
            {/* Previous Button */}
            <button
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className={`p-2 rounded-lg border transition-all ${currentPage === 1
                        ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                        : `border-gray-300 text-gray-700 ${colors.hover}`
                    }`}
            >
                <ChevronLeft size={20} />
            </button>

            {/* Page Numbers */}
            {getPageNumbers().map((page, index) => (
                page === '...' ? (
                    <span key={`ellipsis-${index}`} className="px-3 py-2 text-gray-400">
                        ...
                    </span>
                ) : (
                    <button
                        key={page}
                        onClick={() => onPageChange(page)}
                        className={`min-w-[40px] px-3 py-2 rounded-lg font-semibold transition-all ${currentPage === page
                                ? `${colors.active} shadow-md`
                                : `border border-gray-300 text-gray-700 ${colors.hover}`
                            }`}
                    >
                        {page}
                    </button>
                )
            ))}

            {/* Next Button */}
            <button
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className={`p-2 rounded-lg border transition-all ${currentPage === totalPages
                        ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                        : `border-gray-300 text-gray-700 ${colors.hover}`
                    }`}
            >
                <ChevronRight size={20} />
            </button>
        </div>
    );
};

export default Pagination;

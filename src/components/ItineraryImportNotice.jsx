import { CheckCircle, AlertCircle, X, ExternalLink } from 'lucide-react';

// 가져오기 결과 안내. 목록·상세가 같은 모양을 쓴다.
// notice = { kind: 'saved' | 'error', text, url? } (useItineraryImport 가 만든다)
const ItineraryImportNotice = ({ notice, onClose }) => {
  if (!notice) return null;

  const saved = notice.kind === 'saved';

  return (
    <div
      role="status"
      className={`mb-6 flex items-start gap-3 rounded-2xl border p-4 ${
        saved ? 'border-blue-100 bg-blue-50' : 'border-red-100 bg-red-50'
      }`}
    >
      {saved ? (
        <CheckCircle size={20} className="mt-0.5 flex-shrink-0 text-blue-600" aria-hidden="true" />
      ) : (
        <AlertCircle size={20} className="mt-0.5 flex-shrink-0 text-red-500" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${saved ? 'text-blue-800' : 'text-red-700'}`}>{notice.text}</p>
        {notice.url && (
          <a
            href={notice.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-sm font-semibold text-blue-600 underline"
          >
            브라우저에서 열기
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>
      <button
        onClick={onClose}
        className="flex-shrink-0 rounded-lg p-1 text-gray-400 transition-colors hover:bg-white/60 hover:text-gray-600"
        aria-label="안내 닫기"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
};

export default ItineraryImportNotice;

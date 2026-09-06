import { useEffect, useRef } from 'react';
import { Loader2, X } from 'lucide-react';

// 전체화면 보기. 흰 배경 + 원본 그대로 — 바코드를 다시 그리지 않는다(설계 §5).
// 지갑(Tickets.jsx)과 일정판(TripBoard 의 장소 시트)이 함께 쓴다.
export default function FullScreenTicket({ ticket, url, onClose }) {
  // 부모가 인라인 화살표를 넘겨도 키 리스너·화면 켜둠(wakeLock)을 렌더마다 다시 걸지 않게 ref 로 받는다.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    // 화면을 켜 둔다. 게이트 앞에서 화면이 꺼지면 곤란하다. 지원하지 않는 브라우저는 그냥 넘어간다.
    let lock = null;
    navigator.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    return () => {
      document.removeEventListener('keydown', onKey);
      lock?.release?.().catch(() => {});
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-white">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="truncate text-sm font-semibold text-gray-900">{ticket?.title || '티켓'}</span>
        <button type="button" onClick={() => closeRef.current?.()} aria-label="닫기" className="rounded-sm p-2 text-gray-500">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-2">
        {url ? (
          <img src={url} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <Loader2 size={22} className="animate-spin text-gray-400" aria-hidden="true" />
        )}
      </div>
      <p className="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-1 text-center text-xs text-gray-500">
        화면 밝기를 최대로 올리면 잘 읽힙니다. 손가락으로 벌리면 확대됩니다.
      </p>
    </div>
  );
}

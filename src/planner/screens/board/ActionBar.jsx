import { Link2, MoreHorizontal, Search, Ticket } from 'lucide-react';

// 일정판 하단 액션바 (설계 §1.1).
// 장소 검색·링크로 담기·티켓 지갑은 서버리스 함수와 판독기가 붙어야 동작하므로 이번 범위 밖이다.
// 버튼 자리는 만들되 누르면 준비 중이라고만 알린다 — 자리를 비워 두면 나중에 배치가 흔들린다.
function ActionButton({ icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 flex-col items-center gap-1 rounded-sm px-1 py-1.5 text-xs text-body transition-colors hover:bg-surface-soft"
    >
      {Icon && <Icon size={18} aria-hidden="true" />}
      {label}
    </button>
  );
}

export default function ActionBar({ onSearch, onAddByLink, onTickets, onMore }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] border-t border-hairline bg-canvas pb-[env(safe-area-inset-bottom)]">
      <nav aria-label="일정판 도구" className="mx-auto flex max-w-content gap-1 px-2 py-1.5">
        <ActionButton icon={Search} label="장소 검색" onClick={onSearch} />
        <ActionButton icon={Link2} label="링크로 담기" onClick={onAddByLink} />
        <ActionButton icon={Ticket} label="티켓 지갑" onClick={onTickets} />
        <ActionButton icon={MoreHorizontal} label="더보기" onClick={onMore} />
      </nav>
    </div>
  );
}

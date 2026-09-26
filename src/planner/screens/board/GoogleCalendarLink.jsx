import { CalendarPlus } from 'lucide-react';

// "구글 캘린더에 추가" 링크 (2026-09-27).
// 구글 캘린더 안드로이드 앱은 .ics 파일을 직접 가져오지 못하는 경우가 있어, 일정 하나씩 구글 캘린더
// 웹 "일정 만들기" 화면으로 보내는 길을 따로 둔다. 외부 링크는 사이트의 다른 외부 링크와 같이
// <a target="_blank"> 로 연다 — 웹은 새 탭, 앱(Capacitor)은 허용 목록(allowNavigation) 밖 주소라
// 시스템 브라우저로 넘어간다.

const BOX = {
  text: 'inline-flex h-9 items-center justify-center gap-2 rounded-sm border border-hairline bg-canvas px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-soft',
  icon: 'inline-flex shrink-0 items-center justify-center rounded-sm p-2 text-muted transition-colors hover:bg-surface-soft',
};

export default function GoogleCalendarLink({ url, variant = 'text', className = '' }) {
  if (!url) return null;
  const label = '구글 캘린더에 추가';
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={variant === 'icon' ? label : undefined}
      title={variant === 'icon' ? label : undefined}
      className={[BOX[variant] || BOX.text, 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', className].join(' ')}
    >
      <CalendarPlus size={16} aria-hidden="true" />
      {variant === 'icon' ? null : label}
    </a>
  );
}

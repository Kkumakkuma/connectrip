// 플래너 공용 카드 (설계 §8: rounded-md border border-hairline, 호버는 그림자만 바뀐다).
// interactive=true 는 "누를 수 있는 카드"에만 쓴다 — 호버 그림자가 클릭 가능성의 신호다.
export default function Card({ interactive = false, className = '', children, ...rest }) {
  return (
    <div
      className={[
        'rounded-md border border-hairline bg-canvas',
        interactive ? 'transition-shadow hover:shadow-card' : '',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}

import useScrollHint from '../../lib/useScrollHint';

// 밑줄 탭(에어비앤비식). items: [{ id, label, icon? }] — icon 은 lucide 컴포넌트.
//
// 2026-09-20 (쿠마님 캡처: '물품팔아요' 선택인데 밑줄이 없음): 진짜 원인은 index.css 의 전역
// button{border:none} 이 유틸리티를 덮어 border-b-2 가 0px 로 계산되던 것 — index.css 에서 @layer base 로 옮겨 고쳤다.
// 여기서는 구조도 손봤다: 밑줄 버튼이 overflow-x-auto 컨테이너 안에서 -mb-px 로 튀어나오면 1px 이 잘리므로,
// hairline 은 overflow 가 없는 바깥 래퍼에 두고 스크롤 줄만 안쪽에서 -mb-px 로 겹친다(2px 이 온전히 보인다).
const BoardTabs = ({ items, value, onChange, className = '' }) => {
    // 장터 탭 4개는 390/360px 에서 '공동구매'가 화면 밖으로 나간다 — 페이드로 스크롤 단서를 준다.
    const [scrollRef, hintStyle] = useScrollHint();
    return (
    <div className={`border-b border-hairline mb-4 ${className}`}>
        <div ref={scrollRef} style={hintStyle} role="tablist" className="flex gap-4 sm:gap-6 overflow-x-auto no-scrollbar -mb-px">
            {items.map(({ id, label, icon: Icon }) => {
                const active = value === id;
                return (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onChange(id)}
                        className={`flex items-center gap-1.5 pb-3 pt-1 px-0.5 text-[15px] whitespace-nowrap border-b-2 rounded-t-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${active ? 'text-ink font-bold border-ink' : 'text-muted font-semibold border-transparent hover:text-ink'}`}
                    >
                        {Icon && <Icon size={16} strokeWidth={active ? 2.5 : 2} aria-hidden="true" />}
                        {label}
                    </button>
                );
            })}
        </div>
    </div>
    );
};

export default BoardTabs;

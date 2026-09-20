import useScrollHint from '../../lib/useScrollHint';
import MenuIcon from '../MenuIcon';

// 밑줄 탭(에어비앤비식). items: [{ id, label, icon? }] — icon 은 MenuIcon 의 id 문자열(컬러 Fluent Emoji).
// 네비 드롭다운(Navbar)과 같은 표를 쓰므로 메뉴에서 본 아이콘과 탭 아이콘이 같은 그림이다(2026-09-20 쿠마님 지시).
// (옛 호출부 호환: icon 이 컴포넌트면 그대로 그린다.)
//
// 2026-09-20 (쿠마님 캡처: '물품팔아요' 선택인데 밑줄이 없음): 진짜 원인은 index.css 의 전역
// button{border:none} 이 유틸리티를 덮어 border-b-2 가 0px 로 계산되던 것 — index.css 에서 border-width:0 으로 고쳤다.
// 여기서는 구조도 손봤다: 밑줄 버튼이 overflow-x-auto 컨테이너 안에서 -mb-px 로 튀어나오면 1px 이 잘리므로,
// hairline 은 overflow 가 없는 바깥 래퍼에 두고 스크롤 줄만 안쪽에서 -mb-px 로 겹친다(2px 이 온전히 보인다).
const BoardTabs = ({ items, value, onChange, className = '' }) => {
    // 장터 탭 4개는 390/360px 에서 '공동구매'가 화면 밖으로 나간다 — 페이드로 스크롤 단서를 준다.
    const [scrollRef, hintStyle] = useScrollHint();
    return (
    <div className={`border-b border-hairline mb-4 ${className}`}>
        <div ref={scrollRef} style={hintStyle} role="tablist" className="flex gap-4 sm:gap-6 overflow-x-auto no-scrollbar -mb-px">
            {items.map(({ id, label, icon }) => {
                const active = value === id;
                // forwardRef/memo 로 감싼 컴포넌트는 typeof 가 'object' 다(agy 검토) — 문자열이 아니면 전부 컴포넌트로 본다.
                const Icon = icon && typeof icon !== 'string' ? icon : null;
                return (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onChange(id)}
                        className={`flex items-center gap-1.5 pb-3 pt-1 px-0.5 text-[15px] whitespace-nowrap border-b-2 rounded-t-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${active ? 'text-ink font-bold border-ink' : 'text-muted font-semibold border-transparent hover:text-ink'}`}
                    >
                        {typeof icon === 'string' && <MenuIcon id={icon} size={18} className={active ? '' : 'opacity-80'} />}
                        {Icon && <Icon size={16} aria-hidden="true" />}
                        {label}
                    </button>
                );
            })}
        </div>
    </div>
    );
};

export default BoardTabs;

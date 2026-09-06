// 게시판 공용 셸(에어비앤비 톤, 2026-09-07): 흰 캔버스는 이 안에만 한정한다(전역 body 배경은 그대로).
// title 은 h1 하나, 우측 action(주 버튼), 아래로 tabs → bar(대륙) → search → children(목록) 순서.
const BoardShell = ({ title, subtitle, action, tabs, bar, search, children, id }) => (
    <section id={id} className="bg-white text-ink min-h-screen pt-24 sm:pt-28 pb-20">
        <div className="max-w-content mx-auto px-4 sm:px-6">
            <header className="flex items-start justify-between gap-4 mb-5">
                <div className="min-w-0">
                    <h1 className="text-[26px] sm:text-[32px] font-extrabold tracking-[-0.02em] leading-tight text-ink">{title}</h1>
                    {subtitle && <p className="text-[15px] text-muted mt-1">{subtitle}</p>}
                </div>
                {action && <div className="flex-shrink-0 pt-1">{action}</div>}
            </header>
            {tabs}
            {bar}
            {search && <div className="mb-5">{search}</div>}
            {children}
        </div>
    </section>
);

export default BoardShell;

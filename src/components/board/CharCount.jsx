// 입력칸 아래 글자 수 표시 "1,234/20,000"(2026-09-26). 한도에 닿으면 입력이 멈추는데 이유를 몰랐다.
// value.length 로 센다 — textarea maxLength 와 같은 단위라 표시와 실제로 막히는 지점이 어긋나지 않는다.
const CharCount = ({ value, max, id }) => {
    const n = String(value ?? '').length;
    const tone = n >= max ? 'text-error font-bold' : n >= max * 0.9 ? 'text-ink font-bold' : 'text-muted';
    return (
        <p id={id} className={`mt-1 text-right text-[12px] tabular-nums ${tone}`}>
            {n.toLocaleString()}/{max.toLocaleString()}
        </p>
    );
};

export default CharCount;

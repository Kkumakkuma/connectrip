import { Globe, Lock } from 'lucide-react';

// 글쓰기·수정 폼의 공개 설정(2026-09-25 쿠마님 지시: 후기 게시판 "나만 보기").
// ContinentPicker 와 같은 방식 — 네이티브 radio(sr-only)를 label 로 감싸 키보드·스크린리더가 그대로 동작하고,
// 포커스 링은 키보드 탐색 때만 뜬다. value 는 is_private(boolean).
const OPTIONS = [
    { id: 'public', label: '공개', Icon: Globe, value: false },
    { id: 'private', label: '나만 보기', Icon: Lock, value: true },
];

const VisibilityPicker = ({ value, onChange, name = 'visibility', label = '공개 설정' }) => (
    <fieldset>
        <legend className="block text-sm font-bold text-ink mb-2">{label}</legend>
        <div className="grid grid-cols-2 gap-2">
            {OPTIONS.map((opt) => {
                const { id, label: text, value: v } = opt;
                const Icon = opt.Icon;
                const on = !!value === v;
                return (
                    <label
                        key={id}
                        className={`min-h-[48px] flex items-center justify-center gap-1.5 rounded-md border-2 cursor-pointer select-none transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink has-[:focus-visible]:ring-offset-2 ${on ? 'border-ink bg-surface-soft' : 'border-hairline hover:border-ink'}`}
                    >
                        <input
                            type="radio"
                            name={name}
                            value={id}
                            checked={on}
                            onChange={() => onChange(v)}
                            className="sr-only"
                        />
                        <Icon size={16} aria-hidden="true" className={on ? 'text-ink' : 'text-muted'} />
                        <span className={`text-[14px] font-bold ${on ? 'text-ink' : 'text-muted'}`}>{text}</span>
                    </label>
                );
            })}
        </div>
    </fieldset>
);

export default VisibilityPicker;

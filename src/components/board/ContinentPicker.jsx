import { CONTINENTS } from '../../lib/continents';

// 글쓰기 폼의 말머리 선택. 네이티브 radio(sr-only)를 label 로 감싸 키보드·스크린리더가 그대로 동작한다.
const ContinentPicker = ({ value, onChange, name = 'continent', required = true, label = '말머리' }) => (
    <fieldset>
        <legend className="block text-sm font-bold text-ink mb-2">{label}</legend>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {CONTINENTS.map((c) => {
                const on = value === c.id;
                return (
                    <label
                        key={c.id}
                        className={`min-h-[56px] flex flex-col items-center justify-center gap-0.5 rounded-md border cursor-pointer select-none transition-colors ${on ? `border-ink ring-1 ring-ink ${c.bg}` : 'border-hairline hover:border-ink'}`}
                    >
                        <input
                            type="radio"
                            name={name}
                            value={c.id}
                            checked={on}
                            onChange={() => onChange(c.id)}
                            required={required}
                            className="sr-only"
                        />
                        <span className="text-xl leading-none" aria-hidden="true">{c.icon}</span>
                        <span className={`text-[12px] font-bold ${on ? c.text : 'text-ink'}`}>{c.name}</span>
                    </label>
                );
            })}
        </div>
    </fieldset>
);

export default ContinentPicker;

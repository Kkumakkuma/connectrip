import { useId } from 'react';
import { CONTINENTS } from '../../lib/continents';

// 글쓰기 폼의 말머리 선택. 네이티브 radio(sr-only)를 label 로 감싸 키보드·스크린리더가 그대로 동작한다.
// 네이티브 required 는 쓰지 않는다(숨긴 radio 의 브라우저 검증 말풍선이 안 보임) — 폼이 검사해 error 로 넘기면 아래에 표시한다.
const ContinentPicker = ({ value, onChange, name = 'continent', label = '말머리', error = '' }) => {
    const errId = useId();
    return (
        <fieldset aria-describedby={error ? errId : undefined} aria-invalid={error ? 'true' : undefined}>
            <legend className="block text-sm font-bold text-ink mb-2">{label}</legend>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {CONTINENTS.map((c) => {
                    const on = value === c.id;
                    return (
                        <label
                            key={c.id}
                            className={`min-h-[56px] flex flex-col items-center justify-center gap-0.5 rounded-md border cursor-pointer select-none transition-colors focus-within:ring-2 focus-within:ring-ink focus-within:ring-offset-2 ${on ? `border-ink ring-1 ring-ink ${c.bg}` : error ? 'border-error hover:border-ink' : 'border-hairline hover:border-ink'}`}
                        >
                            <input
                                type="radio"
                                name={name}
                                value={c.id}
                                checked={on}
                                onChange={() => onChange(c.id)}
                                className="sr-only"
                            />
                            <span className="text-xl leading-none" aria-hidden="true">{c.icon}</span>
                            <span className={`text-[12px] font-bold ${on ? c.text : 'text-ink'}`}>{c.name}</span>
                        </label>
                    );
                })}
            </div>
            {error && <p id={errId} role="alert" className="mt-1.5 text-[13px] font-semibold text-error">{error}</p>}
        </fieldset>
    );
};

export default ContinentPicker;

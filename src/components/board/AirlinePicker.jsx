import { useId } from 'react';
import { AIRLINE_TAGS } from '../../lib/airlineTags';

// 글쓰기 폼의 항공사 말머리 선택. 대륙 말머리(ContinentPicker)와 같은 방식 —
// sr-only radio 를 label 로 감싸 키보드·스크린리더가 그대로 동작한다.
// 기본값을 미리 채우지 않는다: 소속이 자동으로 붙으면 글쓴이가 드러난다(쿠마님 9890).
const AirlinePicker = ({ value, onChange, name = 'airline', label = '말머리', error = '' }) => {
    const errId = useId();
    return (
        <fieldset aria-describedby={error ? errId : undefined} aria-invalid={error ? 'true' : undefined}>
            <legend className="block text-sm font-bold text-ink mb-1">{label}</legend>
            <p className="text-[12px] text-muted mb-2">글이 다루는 항공사를 고르세요. 특정 항공사와 상관없는 글이면 공통입니다.</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {AIRLINE_TAGS.map((a) => {
                    const on = value === a.id;
                    return (
                        <label
                            key={a.id}
                            className={`min-h-[44px] flex items-center justify-center rounded-md border cursor-pointer select-none transition-colors focus-within:ring-2 focus-within:ring-ink focus-within:ring-offset-2 ${on ? `border-ink ring-1 ring-ink ${a.bg}` : error ? 'border-error hover:border-ink' : 'border-hairline hover:border-ink'}`}
                        >
                            <input
                                type="radio"
                                name={name}
                                value={a.id}
                                checked={on}
                                onChange={() => onChange(a.id)}
                                className="sr-only"
                            />
                            <span className={`text-[12px] font-bold px-1 text-center ${on ? a.text : 'text-ink'}`}>{a.name}</span>
                        </label>
                    );
                })}
            </div>
            {error && <p id={errId} role="alert" className="mt-1.5 text-[13px] font-semibold text-error">{error}</p>}
        </fieldset>
    );
};

export default AirlinePicker;

import { useId } from 'react';
import { CONTINENTS } from '../../lib/continents';

// 글쓰기 폼의 말머리 선택. 네이티브 radio(sr-only)를 label 로 감싸 키보드·스크린리더가 그대로 동작한다.
// 네이티브 required 는 쓰지 않는다(숨긴 radio 의 브라우저 검증 말풍선이 안 보임) — 폼이 검사해 error 로 넘기면 아래에 표시한다.
//
// 2026-09-20 (쿠마님 캡처: 오세아니아를 골랐는데 유럽에도 검은 네모가 쳐져 두 개 고른 것처럼 보였다):
// - 원인은 focus-within 링. 모달이 열리며 첫 radio(유럽)에 포커스를 주는데 그 링이 '선택' 스타일(검은 테두리)과
//   같은 검정이라 구별이 안 됐다. 링은 키보드 탐색 때만(has-[:focus-visible]) 뜨게 하고,
// - 선택은 대륙색 테두리(border-2, continents.js 의 hex) + 연한 배경으로 바꿔 검은 링과 겹쳐도 다르게 보인다.
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
                            className={`min-h-[56px] flex flex-col items-center justify-center gap-0.5 rounded-md border-2 cursor-pointer select-none transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink has-[:focus-visible]:ring-offset-2 ${on ? c.bg : error ? 'border-error hover:border-ink' : 'border-hairline hover:border-ink'}`}
                            style={on ? { borderColor: c.hex } : undefined}
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

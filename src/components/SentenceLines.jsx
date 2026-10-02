import { Fragment } from 'react';

// 두 문장 이상인 짧은 안내·오류 문구를 문장 경계에서 줄바꿈해 그린다(2026-09-27 줄바꿈 정리).
// 둘째 문장이 윗줄 끝에서 시작해 중간에 꺾이지 않게 한다(문구 규칙: 짧은 UI 문단은 문장 단위로 줄을 나눈다).
// 문장 끝 = . ! ? 뒤 공백. 약칭(Inc. 등)이 섞인 긴 본문·약관에는 쓰지 않는다.
//
// 정규식 lookbehind 는 쓰지 않는다(2026-10-02 R2): iOS 16.3 이하 사파리는 lookbehind 를 몰라 SyntaxError 를
// 던지고 앱 전체가 오류 화면이 됐다(빌드가 리터럴을 new RegExp(…) 로 바꿔 둬서 이 컴포넌트를 그리는 순간 터졌다).
// 옛 lookbehind split 정규식(문장부호 뒤 공백에서 나누던 것)과 똑같이 나눈다 — 문장부호는 앞 조각에 남기고 사이 공백은 버리며,
// 마지막 조각은 비어도 넣는다(빈 문자열 → ['']). 같은 결과인지는 SentenceLines.test.jsx 가 옛 정규식과 대조하고,
// 새 lookbehind 는 ESLint 가 막는다(eslint.config.js no-restricted-syntax).
function splitSentences(t) {
    const re = /[.!?]\s+(?=\S)/g; // 호출마다 새로 만든다 — g 정규식의 lastIndex 상태를 호출끼리 나누지 않게
    const out = [];
    let start = 0;
    let m;
    while ((m = re.exec(t)) !== null) {
        out.push(t.slice(start, m.index + 1));
        start = m.index + m[0].length; // 일치는 늘 2글자 이상(부호+공백)이라 제자리를 돌지 않는다
    }
    out.push(t.slice(start));
    return out;
}

export default function SentenceLines({ text }) {
    const parts = splitSentences(String(text ?? ''));
    return parts.map((s, i) => (
        <Fragment key={i}>
            {i > 0 && <br />}
            {s}
        </Fragment>
    ));
}

import { Fragment } from 'react';

// 두 문장 이상인 짧은 안내·오류 문구를 문장 경계에서 줄바꿈해 그린다(2026-09-27 줄바꿈 정리).
// 둘째 문장이 윗줄 끝에서 시작해 중간에 꺾이지 않게 한다(문구 규칙: 짧은 UI 문단은 문장 단위로 줄을 나눈다).
// 문장 끝 = . ! ? 뒤 공백. 약칭(Inc. 등)이 섞인 긴 본문·약관에는 쓰지 않는다.
export default function SentenceLines({ text }) {
    const parts = String(text ?? '').split(/(?<=[.!?])\s+(?=\S)/);
    return parts.map((s, i) => (
        <Fragment key={i}>
            {i > 0 && <br />}
            {s}
        </Fragment>
    ));
}

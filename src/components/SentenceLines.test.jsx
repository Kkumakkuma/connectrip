// 문장 줄바꿈(2026-10-02 R2): lookbehind 를 뺀 exec 루프가 예전 split(/(?<=[.!?])\s+(?=\S)/) 과 똑같이 나누는지 대조한다.
// iOS 16.3 이하 사파리는 lookbehind 에서 SyntaxError 라 앱 코드에서는 금지(eslint.config.js). 옛 정규식은 노드에서만 도는
// 이 테스트에서 오라클로만 쓴다. 그리기는 서버 렌더(renderToStaticMarkup)로 본다(RichBody.test.jsx 와 같은 방식).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SentenceLines from './SentenceLines';

// 오라클 = 바꾸기 전 코드 그대로(노드는 lookbehind 를 안다)
// eslint-disable-next-line no-restricted-syntax
const OLD_RE = /(?<=[.!?])\s+(?=\S)/;
const oracle = (text) => String(text ?? '').split(OLD_RE);

// 컴포넌트가 실제로 쓰는 조각 배열 = 각 <Fragment>{i > 0 && <br />}{조각}</Fragment> 의 둘째 자식.
// 나누는 함수를 컴포넌트 파일에서 따로 내보내면 fast refresh 가 깨지므로(react-refresh/only-export-components)
// 훅 없는 컴포넌트를 함수로 불러 꺼낸다. 빈 배열과 [''] 도 구별된다.
const partsOf = (text) => SentenceLines({ text }).map((el) => el.props.children[1]);

// 시드 고정 의사난수(mulberry32) — 실패하면 같은 문자열이 다시 나온다
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('SentenceLines — 옛 lookbehind split 과 같은 조각', () => {
    it('경계 사례: 소수점·물음표·연속 부호·끝/앞 공백·빈 값·줄바꿈·한글 여러 문장', () => {
        const want = [
            ['1.5', ['1.5']],
            ['Q&A?', ['Q&A?']],
            ['a.. b', ['a..', 'b']],
            ['끝 공백 ', ['끝 공백 ']],
            ['', ['']],
            ['  앞 공백', ['  앞 공백']],
            ['줄\n바꿈. 다음', ['줄\n바꿈.', '다음']],
            ['저장했어요. 잠시 뒤 다시 시도해 주세요! 계속 안 되면 문의해 주세요? 감사합니다.',
                ['저장했어요.', '잠시 뒤 다시 시도해 주세요!', '계속 안 되면 문의해 주세요?', '감사합니다.']],
        ];
        for (const [t, parts] of want) {
            expect(oracle(t), JSON.stringify(t)).toEqual(parts); // 기대값이 옛 동작과 같은지부터
            expect(partsOf(t), JSON.stringify(t)).toEqual(parts);
        }
    });

    it('그 밖의 사례도 옛 결과와 같다(공백 종류·부호만·숫자·null)', () => {
        const cases = [
            '인증이 끝났어요.  창을 닫아도 돼요.\n\n다음 단계로 넘어가요!', 'a. ', 'a.\tb', 'a.\r\nb', 'a. b', 'a.　b',
            'a. b', 'a.​b', 'a. . b', '...', '. a', 'a .b', '?! 끝', '버전 1.5. 다음', '끝.   ', '😀. 다음', ' . ',
            null, undefined, 0, 1.5,
        ];
        for (const t of cases) expect(partsOf(t), `${JSON.stringify(t)}`).toEqual(oracle(t));
    });

    it('무작위 문자열 2,000개(. ! ? 공백 \\n \\t 가 a, 시드 고정)', () => {
        const rand = mulberry32(20261002);
        const ABC = ['.', '!', '?', ' ', '\n', '\t', '가', 'a'];
        let split = 0;
        let empty = 0;
        for (let n = 0; n < 2000; n++) {
            const len = Math.floor(rand() * 25);
            let t = '';
            for (let k = 0; k < len; k++) t += ABC[Math.floor(rand() * ABC.length)];
            const want = oracle(t);
            if (want.length > 1) split++;
            if (!t) empty++;
            expect(partsOf(t), JSON.stringify(t)).toEqual(want);
        }
        // 대조가 실제로 '나뉘는' 경우와 빈 문자열을 충분히 지나갔는지(이 시드로 1,336개·89개 — 2026-10-02 실측)
        expect(split).toBeGreaterThan(1000);
        expect(empty).toBeGreaterThan(0);
    });

    it('그리기: 조각 사이에만 <br /> 가 들어간다', () => {
        expect(renderToStaticMarkup(<SentenceLines text={'저장했어요.  잠시 뒤 다시 시도해 주세요!\n계속 안 되면 Q&A 를 보세요.'} />))
            .toBe('저장했어요.<br/>잠시 뒤 다시 시도해 주세요!<br/>계속 안 되면 Q&amp;A 를 보세요.');
        expect(renderToStaticMarkup(<SentenceLines text="한 문장뿐이에요." />)).toBe('한 문장뿐이에요.');
        expect(renderToStaticMarkup(<SentenceLines text="" />)).toBe('');
    });
});

// @vitest-environment jsdom
// 붙여넣기 정리기(설계 plan_v3 6-5). 출력 문자열에 자원을 부르는 속성·요소가 하나도 없어야 한다.
// (실제 브라우저에서 "붙이는 순간 외부 요청 0"은 E2E 가 엔진별로 따로 잰다.)
import { describe, expect, it } from 'vitest';
import { cleanPastedHtml, cssColorHex, cssFontSizeToken, cssFontToken, pasteRefOk } from './pasteFilter';

const OWNER = '04cfb914-d208-4377-8604-732b25862018';
const OTHER = '16937867-3d9d-4638-ad13-936154697d99';
const priv = (n, o = OWNER) => `sb://post-images/${o}_17000000000${n}_a.jpg`;
const refOk = pasteRefOk({ mode: 'private', ownerId: OWNER, pendingOk: (r) => r === 'pending:abc:1' });
const clean = (html, ok = refOk) => cleanPastedHtml(html, { refOk: ok });

const FORBIDDEN = [/\ssrc=/i, /srcset=/i, /poster=/i, /background=/i, /\sstyle=/i, /<img/i, /<link/i, /<iframe/i, /<video/i,
    /<audio/i, /<svg/i, /<object/i, /<embed/i, /<input/i, /<source/i, /<picture/i, /<style/i, /<script/i, /onclick/i, /onerror/i,
    /javascript:/i, /\sclass=/i, /\sid=/i, /data-foo/i, /data-pm-slice/i, /xlink:href/i, /\shref="(?!https?:\/\/)/i, /<table/i, /<form/i];

describe('자원을 부르는 것은 한 글자도 나가지 않는다', () => {
    const EVIL = [
        '<img src="https://pixel.ct-test.example/1.gif" onerror="alert(1)">',
        '<img srcset="https://pixel.ct-test.example/2.gif 1x">',
        '<picture><source srcset="https://pixel.ct-test.example/3.gif"><img src="https://pixel.ct-test.example/4.gif"></picture>',
        '<video poster="https://pixel.ct-test.example/5.gif" src="https://pixel.ct-test.example/v.mp4"></video>',
        '<link rel="stylesheet" href="https://pixel.ct-test.example/6.css">',
        '<style>@import url(https://pixel.ct-test.example/7.css); p{background:url(https://pixel.ct-test.example/8.gif)}</style>',
        '<div style="background:url(https://pixel.ct-test.example/9.gif)">배경 글</div>',
        '<svg><image href="https://pixel.ct-test.example/10.gif"/><image xlink:href="https://pixel.ct-test.example/11.gif"/></svg>',
        '<iframe src="https://pixel.ct-test.example/12.html"></iframe>',
        '<object data="https://pixel.ct-test.example/13.swf"></object><embed src="https://pixel.ct-test.example/14.swf">',
        '<input type="image" src="https://pixel.ct-test.example/15.gif">',
        '<table background="https://pixel.ct-test.example/16.gif"><tr><td>칸1</td><td>칸2</td></tr></table>',
        '<a href="javascript:alert(1)">나쁜 링크</a> <a href="https://ok.example/a?b=1">좋은 링크</a>',
        '<p onclick="x()" class="c" id="i" data-foo="z">속성</p>',
        '<div data-pm-slice="1 1 []"><p>조각</p></div>',
        '<script>alert(1)</script><form action="https://pixel.ct-test.example/f"><button formaction="x">b</button></form>',
    ].join('');
    it('출력 문자열 검사', () => {
        const { html, droppedImages } = clean(EVIL);
        for (const re of FORBIDDEN) expect(html, String(re)).not.toMatch(re);
        expect(html).toContain('배경 글');
        expect(html).toContain('칸1');
        expect(html).toContain('<a href="https://ok.example/a?b=1">좋은 링크</a>');
        expect(html).toContain('나쁜 링크');                 // 글자는 남고 링크는 없다
        expect(html).not.toContain('alert');
        expect(droppedImages).toBeGreaterThanOrEqual(3);
    });
});

describe('글자 모양은 토큰으로만', () => {
    it('네이버 블로그식: 팔레트 색·가장 가까운 크기·글꼴·가운데 정렬', () => {
        const { html } = clean('<div class="se-component"><p class="se-text-paragraph" style="text-align:center"><span style="color:rgb(186, 0, 0);font-size:23px;font-family:\'Nanum Myeongjo\', serif">빨강 큰 글자</span></p></div>');
        expect(html).toBe('<div><p data-ct-align="center"><span data-ct-font="myeongjo" data-ct-size="24" data-ct-color="#ba0000">빨강 큰 글자</span></p></div>');
    });
    it('팔레트에 없는 색·기본 크기는 버린다', () => {
        expect(clean('<p><span style="color:#123456;font-size:15px">글</span></p>').html).toBe('<p>글</p>');
        expect(clean('<p><span style="background-color:#fff8b2">형광</span></p>').html).toBe('<p><span data-ct-bg="#fff8b2">형광</span></p>');
    });
    it('MS 워드식: pt 크기·굵게 태그·조건부 주석', () => {
        const { html } = clean('<!--[if gte mso 9]><xml></xml><![endif]--><p class=MsoNormal><b><span style="font-size:14.0pt;color:#BA0000">굵은 글</span></b><o:p></o:p></p>');
        expect(html).toBe('<p><strong><span data-ct-size="19" data-ct-color="#ba0000">굵은 글</span></strong></p>');
    });
    it('구글 문서식: 전체를 감싼 <b style="font-weight:normal"> 은 굵게가 아니다, span 의 굵기·기울임은 태그로', () => {
        const { html } = clean('<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr" style="line-height:1.38;"><span style="font-size:11pt;font-family:Arial;color:#000000;font-weight:700;">굵게</span><span style="font-style:italic;text-decoration:underline line-through;">기울임</span></p></b>');
        expect(html).toBe('<p><strong><span data-ct-color="#000000">굵게</span></strong><em><u><s>기울임</s></u></em></p>');
    });
    it('부모(묶음 div·span)의 정렬·모양은 안쪽 문단·글자로 물려준다 — 겹친 span 은 한 벌로 합친다', () => {
        expect(clean('<div style="text-align:center;color:#ba0000"><p>가</p><p>나</p></div>').html)
            .toBe('<div><p data-ct-align="center"><span data-ct-color="#ba0000">가</span></p><p data-ct-align="center"><span data-ct-color="#ba0000">나</span></p></div>');
        expect(clean('<p><span style="color:#ba0000">빨강 <span style="font-size:24px">큰</span></span></p>').html)
            .toBe('<p><span data-ct-color="#ba0000">빨강 </span><span data-ct-size="24" data-ct-color="#ba0000">큰</span></p>');
        // 안쪽이 굵게를 끄면(font-weight:normal) 그 조각만 굵지 않다
        expect(clean('<p><b>굵<span style="font-weight:400">보통</span></b></p>').html).toBe('<p><strong>굵</strong>보통</p>');
    });
    it('제목은 소제목(h2) 하나로, 번호 목록 시작 번호, pre 줄바꿈', () => {
        expect(clean('<h1>큰 제목</h1><h3>작은 제목</h3>').html).toBe('<h2>큰 제목</h2><h2>작은 제목</h2>');
        expect(clean('<ol start="3"><li>셋</li></ol><ol start="abc"><li>x</li></ol>').html).toBe('<ol start="3"><li>셋</li></ol><ol><li>x</li></ol>');
        expect(clean('<pre>한 줄\n두 줄</pre>').html).toBe('<p>한 줄<br>두 줄</p>');
    });
    it('도우미: 색·크기·글꼴 변환', () => {
        expect(cssColorHex('#ABC')).toBe('#aabbcc');
        expect(cssColorHex('rgba(0, 0, 0, 0.5)')).toBeNull();
        expect(cssFontSizeToken('12pt')).toBeNull();          // 12pt = 16px → 가장 가까운 15 = 기본 → 토큰 없음
        expect(cssFontSizeToken('30px')).toBe(28);
        expect(cssFontSizeToken('1.2em')).toBeNull();
        expect(cssFontToken('나눔손글씨 펜')).toBe('pen');
        expect(cssFontToken('"Gowun Dodum"')).toBe('dodum');
        expect(cssFontToken('Arial')).toBeNull();
    });
});

describe('사진·묶음·지도·영상 칸(data-ct-node)은 규칙을 다시 통과해야 남는다', () => {
    it('내 사진 참조·등록된 대기 키만 사진 칸으로, 남의 사진·외부 주소는 버린다', () => {
        const { html, droppedImages } = clean(
            `<div data-ct-node="image" data-ct-src="${priv(1)}"></div>`
            + `<div data-ct-node="image" data-ct-src="${priv(2, OTHER)}"></div>`
            + '<div data-ct-node="image" data-ct-src="pending:abc:1"></div>'
            + '<div data-ct-node="image" data-ct-src="pending:zzz:9"></div>'
            + `<img src="${priv(3)}">`,
        );
        expect(html).toBe(`<div data-ct-node="image" data-ct-src="${priv(1)}"></div><div data-ct-node="image" data-ct-src="pending:abc:1"></div><div data-ct-node="image" data-ct-src="${priv(3)}"></div>`);
        expect(droppedImages).toBe(2);
    });
    it('묶음: 중복·규칙 밖 사진을 빼고 2장↑ 묶음 / 1장 단일 사진 / 0장 버림', () => {
        const g = (layout, refs) => `<div data-ct-node="gallery" data-ct-layout="${layout}" data-ct-images='${JSON.stringify(refs)}'></div>`;
        expect(clean(g('strip', [priv(1), priv(1), priv(2)])).html)
            .toBe(`<div data-ct-node="gallery" data-ct-layout="strip" data-ct-images="${JSON.stringify([priv(1), priv(2)]).replace(/"/g, '&quot;')}"></div>`);
        expect(clean(g('slide', [priv(1), priv(2, OTHER)])).html).toBe(`<div data-ct-node="image" data-ct-src="${priv(1)}"></div>`);
        expect(clean(g('grid', [priv(2, OTHER)])).html).toBe('');
        expect(clean(g('masonry', [priv(1), priv(2)])).html).toContain('data-ct-layout="grid"');
    });
    it('지도·영상: 속성 검증을 통과해야 남는다(지도 JSON 의 여분 키·주입 거부)', () => {
        const map = (a) => `<div data-ct-node="map" data-ct-map='${JSON.stringify(a)}'></div>`;
        expect(clean(map({ name: '시청', lat: 37.5665, lng: 126.978 })).html).toContain('data-ct-node="map"');
        expect(clean(map({ name: '시청', lat: 37.5665, lng: 126.978, onclick: 'x' })).html).toBe('');
        expect(clean(map({ name: 'x', placeId: 'abc&key=zzzzzz' })).html).toBe('');
        expect(clean('<div data-ct-node="video" data-ct-provider="youtube" data-ct-id="dQw4w9WgXcQ"></div>').html)
            .toBe('<div data-ct-node="video" data-ct-provider="youtube" data-ct-id="dQw4w9WgXcQ"></div>');
        expect(clean('<div data-ct-node="video" data-ct-provider="youtube" data-ct-id="bad"></div>').html).toBe('');
    });
    it('사진 없는 게시판은 사진 칸이 전부 빠진다', () => {
        const none = pasteRefOk({ mode: 'none', ownerId: OWNER, pendingOk: () => true });
        const { html, droppedImages } = clean(`<p>글</p><div data-ct-node="image" data-ct-src="${priv(1)}"></div><img src="${priv(2)}">`, none);
        expect(html).toBe('<p>글</p>');
        expect(droppedImages).toBe(2);
    });
});

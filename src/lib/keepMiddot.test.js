// @vitest-environment jsdom
// 가운뎃점 앞 이음 문자(U+2060): 화면 글자엔 넣고, 입력칸·편집기엔 안 넣고, 나중에 붙는 글자도 고치고, 복사할 땐 뺀다.
import { afterEach, describe, expect, it } from 'vitest';
import { startKeepMiddot } from './keepMiddot';

const WJ = '\u2060';
let stop = () => {};
afterEach(() => { stop(); document.body.innerHTML = ''; });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('keepMiddot', () => {
  it('화면 글자의 · 앞에만 넣고(공백 뒤·이미 들어간 곳은 그대로), 편집기·입력칸은 건드리지 않는다', () => {
    document.body.innerHTML = `
      <p id="a">회원·운영자의 권리·의무 · 끝</p>
      <div contenteditable="true"><p id="b">편집기·글자</p></div>
      <textarea id="c">입력·칸</textarea>
      <div data-keep-text><span id="d">그대로·두기</span></div>`;
    stop = startKeepMiddot(document.body);
    expect(document.getElementById('a').textContent).toBe(`회원${WJ}·운영자의 권리${WJ}·의무 · 끝`);
    expect(document.getElementById('b').textContent).toBe('편집기·글자');
    expect(document.getElementById('c').value).toBe('입력·칸');
    expect(document.getElementById('d').textContent).toBe('그대로·두기');
  });

  it('나중에 붙거나 바뀐 글자도 고친다(한 번만)', async () => {
    stop = startKeepMiddot(document.body);
    const p = document.createElement('p');
    p.textContent = '도보·차량·대중교통';
    document.body.appendChild(p);
    await tick();
    expect(p.textContent).toBe(`도보${WJ}·차량${WJ}·대중교통`);
    p.firstChild.data = '후기·Q&A';
    await tick();
    expect(p.textContent).toBe(`후기${WJ}·Q&A`);
    await tick();
    expect(p.textContent.split(WJ).length - 1).toBe(1);   // 두 번 넣지 않는다
  });

  it('복사하면 이음 문자를 빼고 넣는다', () => {
    document.body.innerHTML = '<p id="a">권리·의무</p>';
    stop = startKeepMiddot(document.body);
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('a'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    let copied = null;
    const ev = new Event('copy', { bubbles: true, cancelable: true });
    ev.clipboardData = { setData: (type, v) => { copied = [type, v]; } };
    document.dispatchEvent(ev);
    expect(copied).toEqual(['text/plain', '권리·의무']);
    expect(ev.defaultPrevented).toBe(true);
  });
});

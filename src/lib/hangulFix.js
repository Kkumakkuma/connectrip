// 한/영 전환을 잊고 영문 자판 상태로 친 한글("elwhdrhksrhkdwl" → "디종관광지")을 되살린다.
//
// 배경(2026-09-06): 플래너 장소 추가 칸에서 매번 한/영을 눌러야 한다는 불편. 키보드 입력 모드(한글/영문)는
// 윈도우가 창 단위로 쥐고 있어 웹페이지가 바꿀 수 없다(실측: 크롬에서 어떤 입력칸을 눌러도 모드가 안 바뀜).
// 그래서 대신 "영문 자판으로 친 한글" 을 알아보고 한 번 눌러 한글로 바꿔 주는 길을 둔다.
//
// 두벌식 자판 기준. 변환 결과가 전부 완성 음절(받침 없는 낱자 없음)일 때만 제안한다 —
// 영어 단어(Louvre, Paris, Shibuya)는 낱자가 남아 제안이 뜨지 않는다.

const KEY_TO_JAMO = {
  q: 'ㅂ', w: 'ㅈ', e: 'ㄷ', r: 'ㄱ', t: 'ㅅ', y: 'ㅛ', u: 'ㅕ', i: 'ㅑ', o: 'ㅐ', p: 'ㅔ',
  a: 'ㅁ', s: 'ㄴ', d: 'ㅇ', f: 'ㄹ', g: 'ㅎ', h: 'ㅗ', j: 'ㅓ', k: 'ㅏ', l: 'ㅣ',
  z: 'ㅋ', x: 'ㅌ', c: 'ㅊ', v: 'ㅍ', b: 'ㅠ', n: 'ㅜ', m: 'ㅡ',
  Q: 'ㅃ', W: 'ㅉ', E: 'ㄸ', R: 'ㄲ', T: 'ㅆ', O: 'ㅒ', P: 'ㅖ',
};

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const COMPOUND_VOWEL = { 'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ', 'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ', 'ㅡㅣ': 'ㅢ' };
const COMPOUND_FINAL = {
  'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ', 'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ',
  // 같은 자음 연타로 만드는 쌍받침(MS IME 동작: ㅅ+ㅅ → ㅆ, ㄱ+ㄱ → ㄲ). 뒤에 모음이 오면 통째로 다음 초성이 된다(이써)
  'ㅅㅅ': 'ㅆ', 'ㄱㄱ': 'ㄲ',
};
// 겹받침을 다시 두 낱자로(다음 음절 초성으로 넘길 때). ㅆ·ㄲ 은 초성이 될 수 있어 쪼개지 않고 통째로 넘긴다
const SPLIT_FINAL = Object.fromEntries(
  Object.entries(COMPOUND_FINAL).filter(([, v]) => !CHO.includes(v)).map(([k, v]) => [v, k]),
);

const isVowel = (j) => JUNG.includes(j);

/** 두벌식 자판 낱자 열 → 한글 문자열(완성 음절 + 남는 낱자 그대로). */
export function composeJamo(jamos) {
  let out = '';
  let cho = null;
  let jung = null;
  let jong = null;

  const flush = () => {
    if (cho && jung) {
      const code = 0xac00 + (CHO.indexOf(cho) * 21 + JUNG.indexOf(jung)) * 28 + JONG.indexOf(jong || '');
      out += String.fromCharCode(code);
    } else {
      out += (cho || '') + (jung || '') + (jong || '');
    }
    cho = null;
    jung = null;
    jong = null;
  };

  for (const j of jamos) {
    if (!isVowel(j)) {
      // 자음
      if (!cho && !jung) {
        cho = j;
      } else if (!jung || !cho) {
        // 초성이 없이 모음만 있는 상태(ㅏ)에서 자음이 오면 받침이 아니라 새 초성이다(codex 9/6: krt → ㅏㄱㅅ, ㅏㄳ 아님)
        flush();
        cho = j;
      } else if (!jong) {
        if (JONG.includes(j)) jong = j;
        else { flush(); cho = j; }
      } else {
        const compound = COMPOUND_FINAL[jong + j];
        if (compound) jong = compound;
        else { flush(); cho = j; }
      }
    } else if (!cho && !jung) {
      // 모음 단독(앞에 자음 없음) — 겹모음 여부만 보고 낱자로 둔다
      jung = j;
    } else if (!jung) {
      jung = j;
    } else if (!jong) {
      const compound = COMPOUND_VOWEL[jung + j];
      if (compound) jung = compound;
      else { flush(); jung = j; }
    } else {
      // 받침이 있는데 모음이 오면 받침(겹받침이면 뒷낱자)이 다음 음절 초성으로 넘어간다
      const split = SPLIT_FINAL[jong];
      let carry;
      if (split) { jong = split[0]; carry = split[1]; }
      else { carry = jong; jong = null; }
      if (!CHO.includes(carry)) { flush(); jung = j; continue; }
      flush();
      cho = carry;
      jung = j;
    }
  }
  flush();
  return out;
}

/** 영문 자판 문자열을 두벌식으로 읽어 한글로. 자판에 없는 글자(공백·숫자·기호)는 그대로 둔다. */
export function qwertyToHangul(text) {
  let out = '';
  let run = [];
  const flushRun = () => {
    if (run.length) out += composeJamo(run);
    run = [];
  };
  for (const ch of String(text || '')) {
    const j = KEY_TO_JAMO[ch] || KEY_TO_JAMO[ch.toLowerCase()];
    if (j && /[a-zA-Z]/.test(ch)) {
      run.push(j);
    } else {
      flushRun();
      out += ch;
    }
  }
  flushRun();
  return out;
}

const SYLLABLE = /[가-힣]/;
const LONE_JAMO = /[ㄱ-ㆎ]/;
// 완성 음절만으로 바뀌어 버리는 실제 영어 낱말(codex·agy 9/6 실측: wifi→쟈랴, go→해, sofa→넒 …). 여행 앱에서 그대로 쓸 만한 것들.
const ENGLISH_WORDS = new Set([
  'wifi', 'go', 'gogo', 'sofa', 'hi', 'ha', 'he', 'so', 'do', 'no', 'to', 'oh', 'ok', 'my', 'we', 'me', 'ago', 'hey', 'yes',
  'you', 'joy', 'boy', 'toy', 'few', 'new', 'now', 'how', 'who', 'why', 'way', 'day', 'say', 'may', 'pay', 'bay', 'gay',
  'sea', 'tea', 'pie', 'die', 'tie', 'lie', 'via', 'zoo', 'spa', 'gym', 'bar', 'car', 'bus', 'taxi', 'tour', 'visa', 'menu',
  'wine', 'cafe', 'cake', 'sake', 'ramen', 'sushi', 'pizza', 'pasta', 'hotel', 'motel', 'hostel', 'lounge', 'gate', 'exit',
  'open', 'close', 'free', 'sale', 'shop', 'mall', 'park', 'view', 'tower', 'plaza', 'beach', 'lake', 'river', 'zone', 'town',
  'city', 'east', 'west', 'north', 'south', 'up', 'down', 'in', 'out', 'on', 'off', 'love', 'happy', 'good', 'nice', 'best',
]);

/**
 * 영문 자판으로 친 한글로 보이면 한글 변환 결과를, 아니면 null.
 * 조건: 영문자가 4자 이상 있고, 전부 대문자(코드·약어)가 아니고, 흔한 영어 낱말이 아니며,
 * 변환 결과에 완성 음절이 있고 낱자(ㄱ, ㅏ 같은 조각)가 하나도 남지 않는다.
 */
export function suggestHangul(text) {
  const raw = String(text || '');
  const letters = raw.match(/[a-zA-Z]/g);
  if (!letters || letters.length < 4) return null;
  if (/[가-힣ㄱ-ㆎ]/.test(raw)) return null;   // 이미 한글이 섞여 있으면 정상 입력으로 본다
  const words = raw.match(/[a-zA-Z]+/g) || [];
  if (words.every((w) => w === w.toUpperCase())) return null;          // JFK, KE081, DPS 같은 코드
  if (words.some((w) => ENGLISH_WORDS.has(w.toLowerCase()))) return null;
  const fixed = qwertyToHangul(raw);
  if (fixed === raw) return null;
  if (!SYLLABLE.test(fixed) || LONE_JAMO.test(fixed)) return null;
  return fixed;
}

/**
 * 입력 요소의 값을 실제 DOM 경로로 바꾼다 — 네이티브 value setter + input 이벤트 → React onChange 가 진짜 이벤트로 받는다
 * (가짜 {target:{value}} 객체를 넘기면 e.preventDefault/e.target.name 을 쓰는 부모가 깨진다, agy 9/6). 끝나면 포커스를 돌려준다.
 */
export function applyToInput(el, value) {
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  try {
    el.focus();
    const end = String(value).length;
    if (typeof el.setSelectionRange === 'function') el.setSelectionRange(end, end);
  } catch { /* 일부 input type 은 selection 을 지원하지 않는다 */ }
  return true;
}

// 한국어 문장을 조립할 때 쓰는 것들.

// 판정에서 무시할 꼬리 — 괄호·따옴표·구두점·공백. "서울)" 의 받침은 '울' 이 정한다.
const TAIL = /[\s.,!?~"'`)\]}>·:;/-]+$/;

/**
 * 은/는, 이/가, 을/를 처럼 받침에 따라 갈리는 조사를 고른다.
 * 이름을 그대로 붙이면 "부산는", "유럽를" 이 된다.
 * 한글이 아닌 글자로 끝나면 받침이 없다고 본다(Paris는, Tokyo는).
 */
export function josa(word, withBatchim, withoutBatchim) {
  const s = String(word || '').replace(TAIL, '');
  if (!s) return withoutBatchim;
  // 서로게이트 페어(이모지)를 반쪽만 읽지 않도록 코드 포인트 단위로 마지막 글자를 잡는다.
  const last = Array.from(s).at(-1).codePointAt(0);
  const hangul = last >= 0xac00 && last <= 0xd7a3;
  return hangul && (last - 0xac00) % 28 !== 0 ? withBatchim : withoutBatchim;
}

// 티켓 이미지에서 바코드(QR·PDF417·Aztec)를 읽는다 (설계 §5.1).
//
// 읽은 값의 용도는 하나뿐이다: **날짜·편명 자동 채우기**.
// 화면에 다시 그리는 용도가 아니다 — 탑승권(PDF417)을 다시 그렸다가 게이트에서 안 읽히면
// 탑승 실패로 이어진다. 전체화면 보기는 언제나 업로드한 원본을 그대로 띄운다(§5.3).
//
// zxing 도 무겁다. 이 모듈 전체를 동적 import 로 부른다.

let readerPromise = null;

async function loadReader() {
  if (!readerPromise) {
    readerPromise = (async () => {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      return new BrowserMultiFormatReader();
    })();
  }
  return readerPromise;
}

/**
 * 이미지 파일에서 바코드를 읽는다.
 * @returns {{text: string, format: string}|null} 못 읽으면 null (예외를 던지지 않는다)
 */
export async function readBarcodeFromImage(file) {
  let url = null;
  try {
    const reader = await loadReader();
    url = URL.createObjectURL(file);
    const result = await reader.decodeFromImageUrl(url);
    const text = result?.getText?.() ?? '';
    const format = result?.getBarcodeFormat?.();
    if (!text) return null;
    // 바이너리 Aztec 페이로드에는 NUL 이 섞일 수 있다. Postgres text 에 담기지 않으므로
    // 저장하지 않는다(설계 §5.3). 여기서 걸러 낸다.
    if (text.indexOf(String.fromCharCode(0)) !== -1) return null;
    return { text, format: formatName(format) };
  } catch {
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

// zxing 의 BarcodeFormat 은 숫자 enum 이다. DB CHECK 가 받는 이름 문자열로 바꾼다.
// 이름을 못 알아내면 null — 'qr' 같은 제멋대로 값이 들어가면 QR 인데 버튼이 안 뜨는
// 조용한 버그가 된다.
const FORMAT_NAMES = [
  'AZTEC', 'CODABAR', 'CODE_39', 'CODE_93', 'CODE_128', 'DATA_MATRIX', 'EAN_8', 'EAN_13',
  'ITF', 'MAXICODE', 'PDF_417', 'QR_CODE', 'RSS_14', 'RSS_EXPANDED', 'UPC_A', 'UPC_E',
  'UPC_EAN_EXTENSION',
];

function formatName(value) {
  if (typeof value === 'string') return FORMAT_NAMES.includes(value) ? value : null;
  if (typeof value === 'number') return FORMAT_NAMES[value] || null;
  return null;
}

// 다시 그려도 되는 포맷인지. QR 만 허용한다.
// PDF417 은 zxing 에 인코더 자체가 없고, Aztec 은 모듈 배수가 아닌 크기에서 예외로 죽는다.
// 무엇보다 탑승권을 다시 그리는 건 고피해 경로다.
export function canRedraw(format) {
  return format === 'QR_CODE';
}

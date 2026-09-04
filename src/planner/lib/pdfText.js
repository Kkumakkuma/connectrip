// PDF 에서 글자만 뽑는다 (설계 §5.2).
//
// pdf.js 는 무겁다(워커 + cMap). 티켓을 올리는 순간에만 필요하므로 이 모듈 전체를
// 동적 import 로 부른다 — 플래너 첫 화면에는 실리지 않는다.
//
// 반드시 지정해야 하는 것 두 가지
//   · workerSrc: pdf.js v4+ 는 워커 주소가 없으면 런타임에서 그냥 죽는다.
//   · cMapUrl / standardFontDataUrl: 대한항공·아시아나 e티켓처럼 CID-keyed 한글 폰트를 쓰는
//     PDF 는 cMap 없이 textContent 를 뽑으면 글자가 깨진다. 그러면 "10월 3일" 정규식이
//     아예 무력화된다. 자산은 scripts/copy-pdfjs-assets.mjs 가 public/pdfjs 로 복사한다.

import { apiUrl } from '../../lib/api';

const MAX_PAGES = 3;

// 앱 빌드는 public/pdfjs 를 싣지 않는다(APK 가 2MB 이상 커진다). 앱에서는 사이트에서 받아온다.
// 웹에서는 API_BASE 가 빈 문자열이라 지금과 똑같은 상대경로다.
const CMAP_URL = apiUrl('/pdfjs/cmaps/');
const FONT_URL = apiUrl('/pdfjs/standard_fonts/');

let pdfjsPromise = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/**
 * PDF 앞쪽 몇 쪽에서 글자를 이어 붙여 돌려준다. 실패하면 빈 문자열 — 던지지 않는다.
 * 판독은 어디까지나 "사람이 확인할 후보"를 만드는 보조 단계라, 여기서 죽으면 안 된다.
 */
export async function extractPdfText(file) {
  let doc = null;
  try {
    const pdfjs = await loadPdfjs();
    const buf = await file.arrayBuffer();
    doc = await pdfjs.getDocument({
      data: buf,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: FONT_URL,
      isEvalSupported: false,
      // 티켓 PDF 는 대개 암호가 없다. 있으면 조용히 포기한다(암호를 물어보지 않는다).
      password: '',
    }).promise;

    const pages = Math.min(doc.numPages || 0, MAX_PAGES);
    const chunks = [];
    for (let i = 1; i <= pages; i += 1) {
      const page = await doc.getPage(i);
      try {
        const content = await page.getTextContent();
        chunks.push(content.items.map((it) => it.str || '').join(' '));
      } finally {
        page.cleanup();
      }
    }
    return chunks.join('\n');
  } catch {
    return '';
  } finally {
    try {
      await doc?.destroy();
    } catch {
      /* 이미 닫힌 문서 — 무시 */
    }
  }
}

/** PDF 첫 쪽을 캔버스에 그려 미리보기 이미지를 만든다. 실패하면 null. */
export async function renderPdfFirstPage(file, { maxWidth = 1200 } = {}) {
  let doc = null;
  try {
    const pdfjs = await loadPdfjs();
    const buf = await file.arrayBuffer();
    doc = await pdfjs.getDocument({
      data: buf,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: FONT_URL,
      isEvalSupported: false,
    }).promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    // 화면 밀도를 반영해 그린다 — 티켓은 확대해서 보는 화면이라 흐리면 못 쓴다.
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const scale = Math.min((maxWidth * dpr) / base.width, 4);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    try {
      await doc?.destroy();
    } catch {
      /* 무시 */
    }
  }
}

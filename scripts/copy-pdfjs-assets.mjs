// pdf.js 가 CJK PDF 를 읽으려면 cMap 이, 표준 폰트가 없는 PDF 를 그리려면 standard_fonts 가 필요하다.
// 둘 다 없으면 대한항공·아시아나 e티켓처럼 CID-keyed 한글 폰트를 쓰는 PDF 에서 글자가 깨져
// "10월 3일" 같은 날짜를 아예 못 읽는다(설계 §5.2).
//
// node_modules 는 배포에 올라가지 않으므로 빌드 전에 public/ 으로 복사한다.
// public/pdfjs 는 .gitignore 에 넣어 두고 매 빌드에 다시 만든다.
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// 앱 빌드는 플래너를 싣지 않는다. 자산을 두면 public/ 이 통째로 APK 에 들어가 2MB 넘게 낭비된다.
const cleanOnly = process.argv.includes('--clean');
const src = join(root, 'node_modules', 'pdfjs-dist');
const out = join(root, 'public', 'pdfjs');

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// 서비스워커도 public/ 에 있어 앱 빌드에 딸려 간다. 플래너 전용이라 앱에는 필요 없다.
const SW_SRC = join(root, 'scripts', 'planner-sw.js');
const SW_OUT = join(root, 'public', 'planner-sw.js');

if (cleanOnly) {
  await rm(join(root, 'public', 'pdfjs'), { recursive: true, force: true });
  await rm(SW_OUT, { force: true });
  console.log('[planner-assets] 앱 빌드 — public/pdfjs · planner-sw.js 제거');
  process.exit(0);
}

if (await exists(SW_SRC)) {
  // 서비스워커 버전을 빌드마다 새 값으로 박는다. 고정값이면 옛 캐시가 안 지워진다.
  const src = await readFile(SW_SRC, 'utf8');
  const buildId = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  await writeFile(SW_OUT, src.replace('__BUILD_ID__', buildId), 'utf8');
}

if (!(await exists(src))) {
  // 플래너를 끈 환경에서 의존성을 안 깔았을 수 있다. 빌드를 세우지 않고 넘어간다.
  console.log('[pdfjs-assets] pdfjs-dist 가 없어 건너뜁니다.');
  process.exit(0);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

let copied = 0;
for (const name of ['cmaps', 'standard_fonts']) {
  const from = join(src, name);
  if (!(await exists(from))) continue;
  await cp(from, join(out, name), { recursive: true });
  copied += 1;
}

console.log(`[pdfjs-assets] public/pdfjs 에 ${copied}개 디렉터리 복사`);

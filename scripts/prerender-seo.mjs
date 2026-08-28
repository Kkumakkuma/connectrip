// 빌드 후처리: 경로별 SEO 메타를 박은 정적 HTML 사본을 만든다.
//
// 배경:
// index.html 에는 canonical·og:url·title 이 홈 주소로 하드코딩돼 있고, vercel.json 의
// 리라이트가 모든 경로를 그 index.html 로 돌려준다. SEOHead.jsx 가 라우트별로 값을 고치지만
// 그건 브라우저가 JS 를 실행한 뒤의 일이라, 렌더링을 하지 않는 크롤러(네이버 Yeti, Bingbot)는
// 사이트맵의 URL 전부를 "홈의 중복" 으로 본다.
//
// 이 스크립트는 dist/index.html 을 읽어 canonical·og:url·title·description(+ robots)만
// 경로별로 바꾼 사본을 dist/<경로>/index.html 로 쓴다. React 앱은 그대로 부팅되므로
// 화면 동작은 달라지지 않고, 크롤러가 처음 받는 HTML 의 메타만 정확해진다.
//
// 하지 않는 것:
// 본문(게시글 목록)은 Supabase fetch 결과라 여기서 굽지 못한다. 그건 별도 작업이다.
//
// 실행: node scripts/prerender-seo.mjs  (package.json 의 build 에서 vite build 다음에 호출)
// app:build(Capacitor) 에는 붙이지 않는다 — 앱 번들에 웹 전용 정적 사본이 섞이면 안 된다.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE_URL, getRouteMeta, isPrerenderExcluded, normalizeRoutePath } from '../src/lib/routeMeta.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITEMAP_PATH = path.join(projectRoot, 'public', 'sitemap.xml');
const DIST_DIR = path.join(projectRoot, 'dist');
const DIST_INDEX = path.join(DIST_DIR, 'index.html');

const escapeAttr = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const escapeText = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 사이트맵의 <loc> 에서 경로만 뽑는다. 대상 목록을 코드에 또 적어 두면 사이트맵과 갈라지므로
// public/sitemap.xml 을 그대로 진실의 출처로 쓴다.
function readSitemapPaths(xml) {
  const locs = xml.match(/<loc>\s*([^<]+?)\s*<\/loc>/g) || [];
  const paths = [];
  for (const loc of locs) {
    const raw = loc.replace(/<\/?loc>/g, '').trim();
    let pathname;
    try {
      pathname = new URL(raw, BASE_URL).pathname;
    } catch {
      console.warn(`[prerender-seo] 사이트맵의 URL 을 해석하지 못해 건너뜀: ${raw}`);
      continue;
    }
    const normalized = normalizeRoutePath(pathname);
    if (!paths.includes(normalized)) paths.push(normalized);
  }
  return paths;
}

// 태그를 바꾸거나, 없으면 </head> 앞에 새로 넣는다.
// insertIfMissing 을 두는 이유: index.html 쪽에서 canonical 태그를 지우는 변경이 들어와도
// 하위 경로 문서가 canonical 없는 채로 배포되지 않게 하려는 것이다.
function upsertTag(html, pattern, replacement, fullTag, label, insertIfMissing) {
  if (pattern.test(html)) return html.replace(pattern, replacement);
  if (!insertIfMissing) return html;
  const headClose = html.indexOf('</head>');
  if (headClose === -1) throw new Error(`[prerender-seo] </head> 가 없어 ${label} 태그를 넣지 못했다.`);
  return `${html.slice(0, headClose)}  ${fullTag}\n${html.slice(headClose)}`;
}

function buildRouteHtml(baseHtml, routePath, meta) {
  const url = `${BASE_URL}${routePath}`;
  const title = escapeText(meta.title);
  const titleAttr = escapeAttr(meta.title);
  const descAttr = escapeAttr(meta.description);

  let html = baseHtml;

  // 여기부터 4개는 문서의 신원 그 자체라, 원본에 없으면 만들어서라도 넣는다.
  html = upsertTag(
    html,
    /<title>[\s\S]*?<\/title>/,
    `<title>${title}</title>`,
    `<title>${title}</title>`,
    'title',
    true
  );
  html = upsertTag(
    html,
    /<link rel="canonical" href="[^"]*"/,
    `<link rel="canonical" href="${url}"`,
    `<link rel="canonical" href="${url}" />`,
    'canonical',
    true
  );
  html = upsertTag(
    html,
    /<meta property="og:url" content="[^"]*"/,
    `<meta property="og:url" content="${url}"`,
    `<meta property="og:url" content="${url}" />`,
    'og:url',
    true
  );
  html = upsertTag(
    html,
    /<meta name="description" content="[^"]*"/,
    `<meta name="description" content="${descAttr}"`,
    `<meta name="description" content="${descAttr}" />`,
    'description',
    true
  );

  // 아래 og / twitter 는 SEOHead 가 클라이언트에서 갱신하는 항목과 같은 집합이다.
  // 원본에 없으면 사이트가 안 쓰기로 한 태그이므로 새로 만들지 않는다(원본 태그 구성을 따른다).
  const mirrored = [
    [/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${titleAttr}"`],
    [/<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${descAttr}"`],
    [/<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${titleAttr}"`],
    [/<meta name="twitter:description" content="[^"]*"/, `<meta name="twitter:description" content="${descAttr}"`],
  ];
  for (const [pattern, replacement] of mirrored) {
    html = upsertTag(html, pattern, replacement, '', 'og/twitter', false);
  }

  // robots 는 화면이 SEOHead 에 명시한 경로(/search = noindex)에만 값이 있다.
  // 지정이 없으면 index.html 의 기본값(index, follow)을 그대로 둔다.
  if (meta.robots) {
    const robotsAttr = escapeAttr(meta.robots);
    html = upsertTag(
      html,
      /<meta name="robots" content="[^"]*"/,
      `<meta name="robots" content="${robotsAttr}"`,
      `<meta name="robots" content="${robotsAttr}" />`,
      'robots',
      true
    );
  }
  return html;
}

async function main() {
  let baseHtml;
  try {
    baseHtml = await readFile(DIST_INDEX, 'utf8');
  } catch {
    throw new Error(`[prerender-seo] dist/index.html 이 없다. vite build 를 먼저 실행해야 한다. (${DIST_INDEX})`);
  }

  const sitemapXml = await readFile(SITEMAP_PATH, 'utf8');
  const sitemapPaths = readSitemapPaths(sitemapXml);

  const written = [];
  const skipped = [];

  for (const routePath of sitemapPaths) {
    // 루트는 dist/index.html 자체다. 이미 홈 canonical 을 선언하고 있고, 프리렌더하지 않은
    // 나머지 경로의 SPA 폴백으로도 쓰이므로 덮어쓰지 않는다.
    if (routePath === '/') {
      skipped.push(`/ (dist/index.html 원본 유지)`);
      continue;
    }
    if (isPrerenderExcluded(routePath)) {
      skipped.push(`${routePath} (로그인·개인화 화면)`);
      continue;
    }
    const meta = getRouteMeta(routePath);
    if (!meta) {
      // 문구를 지어내지 않는다. 사이트맵에 새 경로가 늘면 routeMeta.js 에 실제 화면 값을 추가한다.
      skipped.push(`${routePath} (routeMeta.js 에 문구 없음)`);
      continue;
    }

    // HTML 을 먼저 만든다. 필수 태그 누락으로 던질 때 빈 디렉터리가 남지 않게.
    const routeHtml = buildRouteHtml(baseHtml, routePath, meta);
    const outDir = path.join(DIST_DIR, ...routePath.split('/').filter(Boolean));
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'index.html'), routeHtml, 'utf8');
    written.push(routePath);
  }

  console.log(`[prerender-seo] 정적 HTML ${written.length}개 생성: ${written.join(', ')}`);
  if (skipped.length) console.log(`[prerender-seo] 건너뜀 ${skipped.length}개: ${skipped.join(', ')}`);
}

main().catch((error) => {
  // 조용히 통과시키면 홈 canonical 이 그대로 배포된다. 빌드를 실패로 끝내 눈에 띄게 한다.
  console.error(error.message || error);
  process.exitCode = 1;
});

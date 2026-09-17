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
// 공개 안내 페이지(/guide/*, 2026-09-15): 메타에 더해 본문(h1·h2·문단·목록·내부 링크)을 #root 안에 굽는다.
// 출처는 저장소 안의 정적 원고(src/content/guide/*.md)이고 Supabase 는 조회하지 않는다.
// 같은 원고·같은 파서(src/lib/guide.js)를 GuidePage.jsx 도 쓰므로, createRoot 가 부팅하며 #root 를
// 대체해도 사람이 보는 문구와 크롤러가 받은 문구가 같다. 사람·봇을 가르지 않는다(UA 분기 없음).
//
// 하지 않는 것:
// 게시판 본문(게시글 목록)은 Supabase fetch 결과라 여기서 굽지 않는다.
//
// 대상 경로: 사이트맵(public/sitemap.xml 인덱스 → 하위 sitemap-*.xml)의 <loc> + routeMeta 의 PRERENDER_EXTRA_PATHS.
//
// 실행: node scripts/prerender-seo.mjs  (package.json 의 build 에서 vite build 다음에 호출)
// app:build(Capacitor) 에는 붙이지 않는다 — 앱 번들에 웹 전용 정적 사본이 섞이면 안 된다
// (앱 빌드 산출물의 사이트맵·키 파일 제거는 vite.config.js 의 stripWebOnlyFromAppBuild 가 맡는다).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BASE_URL,
  PRERENDER_EXTRA_PATHS,
  getRouteMeta,
  isPrerenderExcluded,
  normalizeRoutePath,
} from '../src/lib/routeMeta.js';
import { guideFileForPath, isGuidePath, parseGuideMarkdown, renderGuideHtml } from '../src/lib/guide.js';
import {
  BRAND_TAGLINE_LINES,
  HERO_BADGE,
  HERO_DESCRIPTION,
  HERO_TITLE_LINES,
  HOME_CATEGORIES,
  SITE_NAME,
  isPublicHomeCategory,
} from '../src/lib/homeContent.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(projectRoot, 'public');
const SITEMAP_PATH = path.join(PUBLIC_DIR, 'sitemap.xml');
const GUIDE_DIR = path.join(projectRoot, 'src', 'content', 'guide');
const DIST_DIR = path.join(projectRoot, 'dist');
const DIST_INDEX = path.join(DIST_DIR, 'index.html');
const DIST_APP_FALLBACK = path.join(DIST_DIR, 'app.html');
const FEATURE_FLAGS_PATH = path.join(projectRoot, 'src', 'lib', 'featureFlags.js');
// 홈 noscript 블록 표지. 이미 구운 index.html 을 다시 입력으로 받는 사고(프리렌더 단독 재실행)를 잡는다.
const HOME_BODY_MARKER = '<noscript data-home-body="1">';

// index.html 인라인 서비스워커 정리 스크립트의 표지. 사본에서 빠지면 옛 sw.js 캐시가 되살아난다(설계 §3.5).
const SW_CLEANUP_MARKER = 'navigator.serviceWorker.getRegistrations';
const ROOT_PLACEHOLDER = '<div id="root"></div>';

const escapeAttr = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const escapeText = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const extractLocs = (xml) =>
  (xml.match(/<loc>\s*([^<]+?)\s*<\/loc>/g) || []).map((loc) => loc.replace(/<\/?loc>/g, '').trim());

// 사이트맵의 <loc> 에서 경로만 뽑는다. 대상 목록을 코드에 또 적어 두면 사이트맵과 갈라지므로
// public/ 의 사이트맵 파일을 그대로 진실의 출처로 쓴다.
// sitemap.xml 이 인덱스(<sitemapindex>)면 하위 파일을 public/ 에서 읽고, 옛 형식(<urlset>)이면 그대로 읽는다.
async function readSitemapPaths() {
  const rootXml = await readFile(SITEMAP_PATH, 'utf8');
  const urlsets = [];
  if (/<sitemapindex[\s>]/.test(rootXml)) {
    for (const loc of extractLocs(rootXml)) {
      const url = new URL(loc);
      const name = url.pathname.replace(/^\//, '');
      if (url.origin !== BASE_URL || !/^[a-z0-9-]+\.xml$/.test(name)) {
        throw new Error(`[prerender-seo] 사이트맵 인덱스의 하위 주소가 이 사이트의 public 파일이 아니다: ${loc}`);
      }
      let childXml;
      try {
        childXml = await readFile(path.join(PUBLIC_DIR, name), 'utf8');
      } catch {
        throw new Error(`[prerender-seo] 사이트맵 인덱스가 가리키는 public/${name} 이 없다.`);
      }
      if (!/<urlset[\s>]/.test(childXml)) {
        throw new Error(`[prerender-seo] public/${name} 은 <urlset> 이어야 한다(인덱스 중첩 금지).`);
      }
      urlsets.push(childXml);
    }
  } else if (/<urlset[\s>]/.test(rootXml)) {
    urlsets.push(rootXml);
  } else {
    throw new Error('[prerender-seo] public/sitemap.xml 이 <sitemapindex> 도 <urlset> 도 아니다.');
  }

  const paths = [];
  for (const raw of urlsets.flatMap(extractLocs)) {
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
// 치환은 함수형으로 한다 — 문구에 `$&` 같은 치환 패턴 문자가 들어가도 그대로 박히게.
function upsertTag(html, pattern, replacement, fullTag, label, insertIfMissing) {
  if (pattern.test(html)) return html.replace(pattern, () => replacement);
  if (!insertIfMissing) return html;
  const headClose = html.indexOf('</head>');
  if (headClose === -1) throw new Error(`[prerender-seo] </head> 가 없어 ${label} 태그를 넣지 못했다.`);
  return `${html.slice(0, headClose)}  ${fullTag}\n${html.slice(headClose)}`;
}

function buildRouteHtml(baseHtml, routePath, meta, bodyHtml) {
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

  // 안내 페이지 본문. 빈 #root 를 못 찾으면 본문 없는 사본이 조용히 배포되므로 빌드를 세운다.
  if (bodyHtml) {
    if (!html.includes(ROOT_PLACEHOLDER)) {
      throw new Error(`[prerender-seo] dist/index.html 에서 ${ROOT_PLACEHOLDER} 를 찾지 못해 ${routePath} 본문을 넣지 못했다.`);
    }
    html = html.replace(ROOT_PLACEHOLDER, () => `<div id="root">${bodyHtml}</div>`);
  }

  if (!html.includes(SW_CLEANUP_MARKER)) {
    throw new Error(`[prerender-seo] ${routePath} 사본에 서비스워커 정리 스크립트가 없다.`);
  }
  return html;
}

// 홈 <noscript> 본문. 화면 문구(Navbar·Hero·CategoryBoard·Footer)와 같은 src/lib/homeContent.js 를 읽는다.
//
// 왜 noscript 인가 (2026-09-17):
// 안내 페이지처럼 #root 안에 구우면 React 가 부팅하기 전 잠깐 스타일 없는 본문이 비쳤다가 사라진다.
// 홈은 첫인상 화면이라 그 깜빡임을 받아들일 수 없어서, JS 를 실행하지 못한 크롤러가 읽는 noscript 로 넣는다.
// 숨김 텍스트가 아니라 JS 없는 환경에서 실제로 보이는 폴백이고, 사람·봇을 UA 로 가르지 않는다.
// (네이버 Yeti 도 JS 렌더링을 한다고 공식 문서에 적혀 있다. 다만 2026-09-17 실측에서 우리 홈의
//  네이버 색인 스냅샷에는 렌더링된 본문이 없었다 — 렌더링이 지연되거나 실패하는 경우의 보험이다.)
// 문구·링크는 화면에 있는 것만 넣는다(안내 페이지는 화면 어디에도 링크가 없어 넣지 않는다).
async function homeNoscriptHtml() {
  // 화면의 기능 플래그와 어긋나면 크롤러만 보는 카드가 생긴다. featureFlags.js 는 import.meta.env 를 써서
  // node 가 import 할 수 없으므로 값을 읽어서 판정에 넘긴다.
  const flagsSrc = await readFile(FEATURE_FLAGS_PATH, 'utf8');
  const flagMatch = flagsSrc.match(/export const PROMO_REVIEWS_ENABLED = (true|false);/);
  if (!flagMatch) {
    throw new Error('[prerender-seo] featureFlags.js 에서 PROMO_REVIEWS_ENABLED 를 읽지 못했다.');
  }
  const promoReviewsEnabled = flagMatch[1] === 'true';

  const cards = HOME_CATEGORIES.filter((cat) => isPublicHomeCategory(cat, { promoReviewsEnabled }))
    .map(
      (cat) =>
        `<li><a href="${escapeAttr(cat.path)}">${escapeText(cat.name)}</a> ${escapeText(cat.desc)}</li>`
    )
    .join('');
  return (
    HOME_BODY_MARKER +
    '<p>' + escapeText(SITE_NAME) + '</p>' +
    '<p>' + escapeText(HERO_BADGE) + '</p>' +
    '<h1>' + escapeText(HERO_TITLE_LINES.join(' ')) + '</h1>' +
    '<p>' + escapeText(HERO_DESCRIPTION) + '</p>' +
    '<h2>게시판</h2>' +
    '<ul>' + cards + '</ul>' +
    '<p>' + escapeText(BRAND_TAGLINE_LINES.join(' ')) + '</p>' +
    '</noscript>'
  );
}

async function guideBodyHtml(routePath) {
  const file = guideFileForPath(routePath);
  let source;
  try {
    source = await readFile(path.join(GUIDE_DIR, file), 'utf8');
  } catch {
    throw new Error(`[prerender-seo] ${routePath} 의 원고 src/content/guide/${file} 이 없다.`);
  }
  return renderGuideHtml(parseGuideMarkdown(source));
}

async function main() {
  let baseHtml;
  try {
    baseHtml = await readFile(DIST_INDEX, 'utf8');
  } catch {
    throw new Error(`[prerender-seo] dist/index.html 이 없다. vite build 를 먼저 실행해야 한다. (${DIST_INDEX})`);
  }
  if (!baseHtml.includes(SW_CLEANUP_MARKER)) {
    throw new Error('[prerender-seo] dist/index.html 에 서비스워커 정리 스크립트가 없다. index.html 을 확인할 것.');
  }
  // 이미 홈 본문이 박힌 사본을 입력으로 받으면(vite build 없이 이 스크립트만 다시 돌린 경우)
  // 그 본문이 경로별 사본과 app.html 로 번져 나간다. 덮어쓰지 말고 세운다.
  if (baseHtml.includes(HOME_BODY_MARKER)) {
    throw new Error('[prerender-seo] dist/index.html 에 이미 홈 본문이 있다. vite build 부터 다시 실행할 것.');
  }

  const routePaths = await readSitemapPaths();
  for (const extra of PRERENDER_EXTRA_PATHS) {
    const normalized = normalizeRoutePath(extra);
    if (!routePaths.includes(normalized)) routePaths.push(normalized);
  }

  const written = [];
  const skipped = [];

  for (const routePath of routePaths) {
    // 루트는 dist/index.html 자체라 사본을 만들지 않는다. 메타는 이미 홈 값이고,
    // 크롤러용 본문은 아래에서 noscript 로 덧댄다(2026-09-17).
    if (routePath === '/') {
      skipped.push(`/ (dist/index.html 본체에 noscript 본문 추가)`);
      continue;
    }
    if (routePath.startsWith('/guide/') && !isGuidePath(routePath)) {
      throw new Error(`[prerender-seo] 사이트맵의 ${routePath} 는 src/lib/guide.js GUIDE_PATHS 에 없다.`);
    }
    if (isPrerenderExcluded(routePath)) {
      skipped.push(`${routePath} (로그인·개인화 화면)`);
      continue;
    }
    const meta = getRouteMeta(routePath);
    if (!meta) {
      if (isGuidePath(routePath)) {
        throw new Error(`[prerender-seo] 안내 페이지 ${routePath} 의 문구가 routeMeta.js 에 없다.`);
      }
      // 문구를 지어내지 않는다. 사이트맵에 새 경로가 늘면 routeMeta.js 에 실제 화면 값을 추가한다.
      skipped.push(`${routePath} (routeMeta.js 에 문구 없음)`);
      continue;
    }

    // HTML 을 먼저 만든다. 필수 태그 누락으로 던질 때 빈 디렉터리가 남지 않게.
    const bodyHtml = isGuidePath(routePath) ? await guideBodyHtml(routePath) : null;
    const routeHtml = buildRouteHtml(baseHtml, routePath, meta, bodyHtml);
    const outDir = path.join(DIST_DIR, ...routePath.split('/').filter(Boolean));
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'index.html'), routeHtml, 'utf8');
    written.push(bodyHtml ? `${routePath}(본문)` : routePath);
  }

  // SPA 폴백 사본(본문 없음). vercel.json 의 rewrites 가 프리렌더하지 않은 경로를 이 파일로 보낸다.
  // dist/index.html 에 홈 본문을 넣는 순간 그 파일이 모든 경로의 폴백이 되어 /companion 같은 화면까지
  // 홈 본문을 받는다(크롤러 눈에는 중복 본문). 그래서 본문 없는 원본을 따로 남긴다.
  await writeFile(DIST_APP_FALLBACK, baseHtml, 'utf8');

  // 홈 본문. 빈 #root 를 못 찾으면 본문 없는 홈이 조용히 배포되므로 빌드를 세운다.
  if (!baseHtml.includes(ROOT_PLACEHOLDER)) {
    throw new Error(`[prerender-seo] dist/index.html 에서 ${ROOT_PLACEHOLDER} 를 찾지 못해 홈 본문을 넣지 못했다.`);
  }
  const homeBody = await homeNoscriptHtml();
  const homeHtml = baseHtml.replace(ROOT_PLACEHOLDER, () => `${ROOT_PLACEHOLDER}${homeBody}`);
  await writeFile(DIST_INDEX, homeHtml, 'utf8');

  console.log(`[prerender-seo] 홈 noscript 본문 ${homeHtml.length - baseHtml.length}자 추가, SPA 폴백 app.html 생성`);
  console.log(`[prerender-seo] 정적 HTML ${written.length}개 생성: ${written.join(', ')}`);
  if (skipped.length) console.log(`[prerender-seo] 건너뜀 ${skipped.length}개: ${skipped.join(', ')}`);
}

main().catch((error) => {
  // 조용히 통과시키면 홈 canonical 이 그대로 배포된다. 빌드를 실패로 끝내 눈에 띄게 한다.
  console.error(error.message || error);
  process.exitCode = 1;
});

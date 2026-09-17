// SEO 표면 드리프트 검사 (설계 §1.3(d) codex-22).
//
// 왜 필요한가
//   사이트맵·robots.txt·routeMeta·프리렌더 제외 목록이 서로 다른 파일에 흩어져 있다.
//   하나만 고치면 "막았다고 생각한 경로가 안 막혀 있는" 상태가 조용히 생긴다.
//   실제로 그런 드리프트가 있었다 — 제외 목록엔 /crew 가 있는데 robots 엔 없었고,
//   robots 엔 /points 가 있는데 목록엔 없었다.
//
// 2026-09-15 (SEO 설계 S2·S3): 사이트맵이 인덱스(public/sitemap.xml) + 하위 파일(sitemap-*.xml)로 나뉘었고,
//   공개 안내 페이지(/guide/*)·IndexNow 키 파일이 생겼다. 아래 ⑤~⑨ 가 그 짝을 맞춘다.
//
// 빌드 앞에서 돌리고, 어긋나면 빌드를 세운다.
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GUIDE_PATHS,
  collectGuideLinks,
  guideFileForPath,
  guideLinkProblem,
  parseGuideMarkdown,
} from '../src/lib/guide.js';
// 예전에는 이 파일들을 문자열로 읽어 쉼표로 잘라 배열을 흉내 냈다. 배열 안 주석의 쉼표 하나에
// 바로 뒤 항목이 통째로 사라지는 파서였다(2026-09-17 실측 — /app.html 이 없는 것으로 읽혔다).
// prerender-seo.mjs 가 이미 같은 모듈을 node 로 import 하므로 여기서도 그대로 읽는다.
import {
  BASE_URL as ROUTE_BASE_URL,
  PRERENDER_EXCLUDED_PATHS,
  PRERENDER_EXTRA_PATHS,
  ROBOTS_DISALLOW,
} from '../src/lib/routeMeta.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const problems = [];
const warnings = [];

const readText = (path) => readFile(path, 'utf8').catch(() => null);

const robots = await readFile(join(publicDir, 'robots.txt'), 'utf8');
const sitemapIndex = await readFile(join(publicDir, 'sitemap.xml'), 'utf8');
const routeMetaSrc = await readFile(join(root, 'src', 'lib', 'routeMeta.js'), 'utf8');
const indexHtml = await readFile(join(root, 'index.html'), 'utf8');
const vercelJson = await readFile(join(root, 'vercel.json'), 'utf8');

const BASE = ROUTE_BASE_URL;
if (!BASE) problems.push('routeMeta.js 에서 BASE_URL 을 찾지 못했습니다.');

const disallow = ROBOTS_DISALLOW;
const excluded = PRERENDER_EXCLUDED_PATHS;
const extraPaths = PRERENDER_EXTRA_PATHS;

const robotsDisallow = Array.from(robots.matchAll(/^Disallow:\s*(\S+)\s*$/gm)).map((m) => m[1]);

// ⑤ 사이트맵 구조: sitemap.xml = 인덱스, 하위 = 이 사이트 public/ 의 sitemap-*.xml(<urlset>)
//   URL 규칙: https + www 호스트, 소문자, 끝 슬래시 없음(루트 제외), 쿼리·해시 없음, 파일 사이 중복 없음.
//   토큰·가져오기·티켓 경로는 사이트맵에 절대 넣지 않는다(설계 §3.4-8).
const FORBIDDEN_IN_SITEMAP = ['/planner/s/', '/planner/t/', '/planner/import', 'token='];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const tagValues = (xml, tag) =>
  Array.from(xml.matchAll(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`, 'g'))).map((m) => m[1]);

const entries = []; // { file, path }
const childFiles = [];
if (!/<sitemapindex[\s>]/.test(sitemapIndex)) {
  problems.push('public/sitemap.xml 은 사이트맵 인덱스(<sitemapindex>)여야 합니다.');
} else if (BASE) {
  const blocks = Array.from(sitemapIndex.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/g)).map((m) => m[1]);
  if (!blocks.length) problems.push('사이트맵 인덱스에 하위 사이트맵이 없습니다.');
  for (const block of blocks) {
    const [loc] = tagValues(block, 'loc');
    const lastmod = tagValues(block, 'lastmod')[0];
    if (lastmod !== undefined && !DATE_RE.test(lastmod)) problems.push(`사이트맵 인덱스 lastmod 형식 오류: ${lastmod}`);
    const name = loc && loc.startsWith(`${BASE}/`) ? loc.slice(BASE.length + 1) : null;
    if (!name || !/^sitemap-[a-z0-9-]+\.xml$/.test(name)) {
      problems.push(`사이트맵 인덱스의 하위 주소가 규칙(${BASE}/sitemap-*.xml)에 맞지 않습니다: ${loc}`);
      continue;
    }
    const xml = await readText(join(publicDir, name));
    if (xml === null) {
      problems.push(`사이트맵 인덱스가 가리키는 public/${name} 이 없습니다.`);
      continue;
    }
    if (!/<urlset[\s>]/.test(xml)) {
      problems.push(`public/${name} 은 <urlset> 이어야 합니다(인덱스 중첩 금지).`);
      continue;
    }
    childFiles.push(name);
    if (!vercelJson.includes(name)) warnings.push(`vercel.json 사이트맵 캐시 헤더에 ${name} 이 없습니다.`);
    const urls = Array.from(xml.matchAll(/<url>([\s\S]*?)<\/url>/g)).map((m) => m[1]);
    if (urls.length !== tagValues(xml, 'loc').length) problems.push(`public/${name} 의 <url>·<loc> 개수가 맞지 않습니다.`);
    for (const url of urls) {
      const [urlLoc] = tagValues(url, 'loc');
      const urlLastmod = tagValues(url, 'lastmod')[0];
      if (!urlLoc) {
        problems.push(`public/${name} 에 <loc> 없는 <url> 이 있습니다.`);
        continue;
      }
      if (urlLastmod !== undefined && !DATE_RE.test(urlLastmod)) {
        problems.push(`public/${name} lastmod 형식 오류: ${urlLoc} → ${urlLastmod}`);
      }
      if (urlLoc !== `${BASE}/` && !urlLoc.startsWith(`${BASE}/`)) {
        problems.push(`사이트맵 URL 호스트가 ${BASE} 가 아닙니다: ${urlLoc}`);
        continue;
      }
      const path = urlLoc.slice(BASE.length);
      if (/[?#]/.test(path)) problems.push(`사이트맵 URL 에 쿼리·해시가 있습니다: ${urlLoc}`);
      if (path !== path.toLowerCase()) problems.push(`사이트맵 URL 은 소문자여야 합니다: ${urlLoc}`);
      if (path !== '/' && path.endsWith('/')) problems.push(`사이트맵 URL 끝에 슬래시가 있습니다: ${urlLoc}`);
      FORBIDDEN_IN_SITEMAP.filter((bad) => path.toLowerCase().includes(bad))
        .forEach((bad) => problems.push(`사이트맵에 금지 패턴(${bad})이 있습니다: ${urlLoc}`));
      if (entries.some((e) => e.path === path)) problems.push(`사이트맵 URL 중복: ${urlLoc}`);
      entries.push({ file: name, path });
    }
  }
}
// 인덱스에 안 실린 하위 파일은 검색엔진이 못 찾는다.
for (const name of (await readdir(publicDir)).filter((n) => /^sitemap-.+\.xml$/.test(n))) {
  if (!childFiles.includes(name)) problems.push(`public/${name} 이 사이트맵 인덱스에 없습니다.`);
}
const sitemapPaths = entries.map((e) => e.path);

// ① robots.txt ↔ ROBOTS_DISALLOW 문자열 일치
if (disallow) {
  disallow.filter((p) => !robotsDisallow.includes(p))
    .forEach((p) => problems.push(`robots.txt 에 없음: Disallow: ${p}`));
  robotsDisallow.filter((p) => !disallow.includes(p))
    .forEach((p) => problems.push(`ROBOTS_DISALLOW 에 없음: ${p} (robots.txt 에만 있음)`));
}

// 접두사만 보면 /plan 차단이 /planet 까지 잡는다. 경로 구분자까지 맞춘다.
const isDisallowed = (path) => (disallow || []).some((d) => path === d
  || path.startsWith(d.endsWith('/') ? d : d + '/'));

// ② 사이트맵과 차단 목록이 충돌하지 않을 것
sitemapPaths.filter(isDisallowed)
  .forEach((path) => problems.push(`사이트맵에 색인 차단 경로가 있습니다: ${path}`));

// ③ 사이트맵 경로에 화면 문구(routeMeta)가 있을 것 — 없으면 프리렌더가 기본 문구로 굽는다
sitemapPaths
  .filter((path) => path !== '/' && !path.startsWith('/guide/') && !routeMetaSrc.includes(`'${path}'`))
  .forEach((path) => warnings.push(`routeMeta 문구 없음: ${path}`));

// ④ 사이트맵에 없는 프리렌더 제외 항목은 아무 일도 안 한다
if (excluded) {
  excluded.filter((p) => !sitemapPaths.includes(p))
    .forEach((p) => warnings.push(`PRERENDER_EXCLUDED_PATHS 의 ${p} 는 사이트맵에 없어 무의미합니다(차단은 ROBOTS_DISALLOW 로).`));
}

// ⑥ 사이트맵 밖에서 굽는 경로: 문구가 있어야 하고, 차단 경로면 안 된다
for (const p of extraPaths || []) {
  if (!routeMetaSrc.includes(`'${p}': {`)) problems.push(`PRERENDER_EXTRA_PATHS 의 ${p} 에 routeMeta 문구가 없습니다.`);
  if (isDisallowed(p)) problems.push(`PRERENDER_EXTRA_PATHS 의 ${p} 는 색인 차단 경로입니다.`);
  if (sitemapPaths.includes(p)) warnings.push(`PRERENDER_EXTRA_PATHS 의 ${p} 는 이미 사이트맵에 있어 중복입니다.`);
}

// ⑦ 안내 페이지: GUIDE_PATHS ↔ sitemap-guide.xml ↔ routeMeta ↔ 원고 파일이 한 벌로 맞을 것 + 원고 링크가 실제 화면을 가리킬 것
const guideEntries = entries.filter((e) => e.path.startsWith('/guide/'));
guideEntries.filter((e) => e.file !== 'sitemap-guide.xml')
  .forEach((e) => problems.push(`안내 페이지 ${e.path} 는 sitemap-guide.xml 에 있어야 합니다(현재 ${e.file}).`));
guideEntries.filter((e) => !GUIDE_PATHS.includes(e.path))
  .forEach((e) => problems.push(`사이트맵의 ${e.path} 는 src/lib/guide.js GUIDE_PATHS 에 없습니다.`));
const guideDir = join(root, 'src', 'content', 'guide');
const guideFiles = (await readdir(guideDir).catch(() => [])).filter((n) => n.endsWith('.md'));
for (const path of GUIDE_PATHS) {
  if (!guideEntries.some((e) => e.path === path)) problems.push(`안내 페이지 ${path} 가 sitemap-guide.xml 에 없습니다.`);
  if (!routeMetaSrc.includes(`'${path}': {`)) problems.push(`안내 페이지 ${path} 의 title·description 이 routeMeta.js 에 없습니다.`);
  const file = guideFileForPath(path);
  const source = await readText(join(guideDir, file));
  if (source === null) {
    problems.push(`안내 페이지 ${path} 의 원고 src/content/guide/${file} 이 없습니다.`);
    continue;
  }
  try {
    for (const link of collectGuideLinks(parseGuideMarkdown(source))) {
      const why = guideLinkProblem(link.href);
      if (why) problems.push(`원고 ${file}: ${why}`);
    }
  } catch (error) {
    problems.push(`원고 ${file}: ${error.message}`);
  }
}
guideFiles.filter((name) => !GUIDE_PATHS.some((p) => guideFileForPath(p) === name))
  .forEach((name) => problems.push(`src/content/guide/${name} 에 해당하는 GUIDE_PATHS 경로가 없습니다.`));

// ⑧ IndexNow 키 파일: public/<키>.txt 하나, 내용 = 키 (설계 §4)
const keyFiles = (await readdir(publicDir)).filter((n) => /^[a-f0-9-]{8,128}\.txt$/.test(n));
if (keyFiles.length !== 1) {
  problems.push(`IndexNow 키 파일(public/<키>.txt)은 정확히 1개여야 합니다(현재 ${keyFiles.length}개).`);
} else {
  const key = keyFiles[0].slice(0, -4);
  const content = await readFile(join(publicDir, keyFiles[0]), 'utf8');
  if (content.trim() !== key) problems.push(`IndexNow 키 파일 내용이 파일 이름과 다릅니다: ${keyFiles[0]}`);
}

// ⑨ 프리렌더 사본은 index.html 에서 파생된다. 인라인 서비스워커 정리 스크립트가 원본에 있어야 사본에도 있다.
if (!indexHtml.includes('navigator.serviceWorker.getRegistrations')) {
  problems.push('index.html 에서 서비스워커 정리 스크립트를 찾지 못했습니다.');
}

warnings.forEach((w) => console.log(`[seo-surfaces] 참고: ${w}`));
if (problems.length) {
  problems.forEach((p) => console.error(`[seo-surfaces] 오류: ${p}`));
  process.exit(1);
}
console.log(`[seo-surfaces] 통과 — 사이트맵 파일 ${childFiles.length}개·URL ${sitemapPaths.length}개, 안내 페이지 ${GUIDE_PATHS.length}개, 차단 ${robotsDisallow.length}개, IndexNow 키 1개`);

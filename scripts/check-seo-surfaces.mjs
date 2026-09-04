// SEO 표면 드리프트 검사 (설계 §1.3(d) codex-22).
//
// 왜 필요한가
//   사이트맵·robots.txt·routeMeta·프리렌더 제외 목록이 서로 다른 파일에 흩어져 있다.
//   하나만 고치면 "막았다고 생각한 경로가 안 막혀 있는" 상태가 조용히 생긴다.
//   실제로 그런 드리프트가 있었다 — 제외 목록엔 /crew 가 있는데 robots 엔 없었고,
//   robots 엔 /points 가 있는데 목록엔 없었다.
//
// 빌드 앞에서 돌리고, 어긋나면 빌드를 세운다.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const warnings = [];

const robots = await readFile(join(root, 'public', 'robots.txt'), 'utf8');
const sitemap = await readFile(join(root, 'public', 'sitemap.xml'), 'utf8');
const routeMetaSrc = await readFile(join(root, 'src', 'lib', 'routeMeta.js'), 'utf8');

// routeMeta 는 JSX 를 import 하지 않는 순수 모듈이지만, 빌드 전 단계라 그냥 문자열로 읽는다.
function arrayLiteral(name) {
  const head = 'export const ' + name + ' = [';
  const at = routeMetaSrc.indexOf(head);
  if (at === -1) return null;
  const end = routeMetaSrc.indexOf('];', at);
  if (end === -1) return null;
  const body = routeMetaSrc.slice(at + head.length, end);
  return body.split(',').map((x) => x.trim()).filter((x) => x.startsWith(String.fromCharCode(39)))
    .map((x) => x.slice(1, x.lastIndexOf(String.fromCharCode(39))));
}

const disallow = arrayLiteral('ROBOTS_DISALLOW');
const excluded = arrayLiteral('PRERENDER_EXCLUDED_PATHS');
if (!disallow) problems.push('routeMeta.js 에서 ROBOTS_DISALLOW 를 찾지 못했습니다.');
if (!excluded) problems.push('routeMeta.js 에서 PRERENDER_EXCLUDED_PATHS 를 찾지 못했습니다.');

const robotsDisallow = Array.from(robots.matchAll(/^Disallow:\s*(\S+)\s*$/gm)).map((m) => m[1]);
const sitemapPaths = Array.from(sitemap.matchAll(/<loc>https?:\/\/[^/]+([^<]*)<\/loc>/g))
  .map((m) => m[1] || '/');

// ① robots.txt ↔ ROBOTS_DISALLOW 문자열 일치
if (disallow) {
  disallow.filter((p) => !robotsDisallow.includes(p))
    .forEach((p) => problems.push(`robots.txt 에 없음: Disallow: ${p}`));
  robotsDisallow.filter((p) => !disallow.includes(p))
    .forEach((p) => problems.push(`ROBOTS_DISALLOW 에 없음: ${p} (robots.txt 에만 있음)`));
}

// ② 사이트맵과 차단 목록이 충돌하지 않을 것
if (disallow) {
  sitemapPaths
    // 접두사만 보면 /plan 차단이 /planet 까지 잡는다. 경로 구분자까지 맞춘다.
    .filter((path) => disallow.some((d) => path === d
      || path.startsWith(d.endsWith('/') ? d : d + '/')))
    .forEach((path) => problems.push(`사이트맵에 색인 차단 경로가 있습니다: ${path}`));
}

// ③ 사이트맵 경로에 화면 문구(routeMeta)가 있을 것 — 없으면 프리렌더가 기본 문구로 굽는다
sitemapPaths
  .filter((path) => path !== '/' && !routeMetaSrc.includes(`'${path}'`))
  .forEach((path) => warnings.push(`routeMeta 문구 없음: ${path}`));

// ④ 사이트맵에 없는 프리렌더 제외 항목은 아무 일도 안 한다
if (excluded) {
  excluded.filter((p) => !sitemapPaths.includes(p))
    .forEach((p) => warnings.push(`PRERENDER_EXCLUDED_PATHS 의 ${p} 는 사이트맵에 없어 무의미합니다(차단은 ROBOTS_DISALLOW 로).`));
}

warnings.forEach((w) => console.log(`[seo-surfaces] 참고: ${w}`));
if (problems.length) {
  problems.forEach((p) => console.error(`[seo-surfaces] 오류: ${p}`));
  process.exit(1);
}
console.log(`[seo-surfaces] 통과 — 사이트맵 ${sitemapPaths.length}개, 차단 ${robotsDisallow.length}개`);

// 공개 안내 페이지(/guide/*) 공용 모듈 (2026-09-15, SEO 설계 S3).
//
// 원고는 src/content/guide/*.md 에 있다(첫 줄 `# 제목`, 이어서 `## 소제목`·문단·`- 목록`·[링크](/경로)).
// title·description 은 여기 두지 않는다 — src/lib/routeMeta.js 가 단일 출처다.
//
// 이 파일은 JSX·Vite 전용 문법(import.meta.glob 등)을 쓰지 않는 순수 모듈이어야 한다.
// 브라우저(GuidePage.jsx)와 Node(scripts/prerender-seo.mjs·check-seo-surfaces.mjs)가 같은 파서를 써야
// 크롤러가 받는 초기 HTML 과 사람이 보는 화면의 문구가 갈라지지 않는다.
//
// 새 npm 의존성을 늘리지 않으려고 원고에 실제로 쓰는 문법만 지원한다.
// 모르는 문법(### · ** · 번호 목록 · 표 · 코드 · 외부 링크)이 들어오면 조용히 깨진 채 나가지 않도록 예외를 던진다.

import { CONTINENT_IDS } from './continents.js';

export const GUIDE_SLUGS = ['companion', 'travel-qna', 'destinations', 'market', 'planner'];

// 대륙 페이지는 continents.js 의 6개만 둔다(나라별 페이지는 얇은 콘텐츠라 만들지 않음).
export const GUIDE_PATHS = [
  ...GUIDE_SLUGS.map((slug) => `/guide/${slug}`),
  ...CONTINENT_IDS.map((id) => `/guide/region/${id}`),
];

// 원고 안 링크가 가리켜도 되는 사이트 안 화면. 안내 페이지끼리는 GUIDE_PATHS 로 따로 허용한다.
export const GUIDE_LINK_TARGETS = ['/companion', '/qna', '/market', '/recommend', '/planner'];

export const isGuidePath = (path) => GUIDE_PATHS.includes(path);

// /guide/companion → companion.md, /guide/region/europe → region-europe.md
export function guideFileForPath(path) {
  if (!isGuidePath(path)) return null;
  return `${path.replace(/^\/guide\//, '').replace('/', '-')}.md`;
}

// 사전렌더 HTML 과 React 화면이 같은 클래스를 쓴다. Tailwind 가 이 파일(src/**/*.js)을 스캔하므로
// 클래스명은 반드시 조립하지 않은 완전한 문자열로 둔다.
export const GUIDE_CLASSES = {
  section: 'bg-white text-ink min-h-screen pt-24 sm:pt-28 pb-20',
  container: 'max-w-3xl mx-auto px-4 sm:px-6',
  h1: 'text-[26px] sm:text-[32px] font-extrabold tracking-[-0.02em] leading-tight text-ink',
  h2: 'mt-10 text-[20px] sm:text-[22px] font-bold tracking-[-0.01em] leading-snug text-ink',
  p: 'mt-4 text-[16px] leading-[1.75] text-body',
  ul: 'mt-4 space-y-2 list-disc pl-5 text-[16px] leading-[1.75] text-body',
  link: 'font-semibold text-ink underline underline-offset-4 decoration-hairline hover:decoration-ink',
};

const LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function parseInline(text, lineNo) {
  const nodes = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    if (m.index > last) nodes.push({ type: 'text', text: text.slice(last, m.index) });
    nodes.push({ type: 'link', text: m[1], href: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
  nodes.forEach((n, idx) => {
    if (n.type !== 'link') return;
    // 2026-09-16 codex 검토: ![x](/a) 이미지 문법이 '!' + 링크로, [**굵게**](/a) 가 별표째 조용히 렌더되던 것 → 예외
    const prev = nodes[idx - 1];
    if (prev && prev.type === 'text' && prev.text.endsWith('!')) {
      throw new Error(`[guide] ${lineNo}행: 이미지 문법은 지원하지 않는다 — ${n.text.slice(0, 40)}`);
    }
    if (/\*\*|`|\[|<[a-z/!]/i.test(n.text)) {
      throw new Error(`[guide] ${lineNo}행: 링크 글자 안의 미지원 문법 — ${n.text.slice(0, 40)}`);
    }
    // 링크 대상 검증을 빌드 검사(check-seo-surfaces)에만 맡기지 않는다 — 파서·렌더러를 다른 곳에서 써도 javascript: 등이 못 들어가게
    const why = guideLinkProblem(n.href);
    if (why) throw new Error(`[guide] ${lineNo}행: ${why}`);
  });
  for (const n of nodes) {
    if (n.type === 'text' && /\*\*|`|\]\(|\[|\]|<[a-z/!]/i.test(n.text)) {
      throw new Error(`[guide] ${lineNo}행: 지원하지 않는 인라인 문법 — ${n.text.slice(0, 40)}`);
    }
  }
  return nodes;
}

// 블록 목록: { type: 'h1'|'h2'|'p', inlines } | { type: 'ul', items: inlines[] }
export function parseGuideMarkdown(source) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let list = null;
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trimEnd();
    if (line.trim() === '') {
      list = null;
      return;
    }
    if (/^#{3,}/.test(line) || /^\d+\.\s/.test(line) || /^[>|*]/.test(line) || /^\s/.test(line)) {
      throw new Error(`[guide] ${lineNo}행: 지원하지 않는 블록 문법 — ${line.slice(0, 40)}`);
    }
    const heading = line.match(/^(#{1,2})\s+(.+)$/);
    if (heading) {
      list = null;
      blocks.push({ type: heading[1].length === 1 ? 'h1' : 'h2', inlines: parseInline(heading[2], lineNo) });
      return;
    }
    const item = line.match(/^-\s+(.+)$/);
    if (item) {
      if (!list) {
        list = { type: 'ul', items: [] };
        blocks.push(list);
      }
      list.items.push(parseInline(item[1], lineNo));
      return;
    }
    list = null;
    blocks.push({ type: 'p', inlines: parseInline(line, lineNo) });
  });
  if (blocks[0]?.type !== 'h1' || blocks.filter((b) => b.type === 'h1').length !== 1) {
    throw new Error('[guide] 원고는 첫 블록에 `# 제목` 하나만 있어야 한다.');
  }
  return blocks;
}

export function collectGuideLinks(blocks) {
  const links = [];
  const walk = (inlines) => inlines.forEach((n) => n.type === 'link' && links.push(n));
  for (const b of blocks) {
    if (b.type === 'ul') b.items.forEach(walk);
    else walk(b.inlines);
  }
  return links;
}

// 링크가 실제로 있는 화면을 가리키는지. 문제가 없으면 null, 있으면 사유 문자열.
export function guideLinkProblem(href) {
  if (!href.startsWith('/') || href.startsWith('//')) return `사이트 밖 링크는 쓰지 않는다: ${href}`;
  if (href.includes('#')) return `해시 링크는 쓰지 않는다: ${href}`;
  const [pathPart, query = ''] = href.split('?');
  if (isGuidePath(pathPart)) return query ? `안내 페이지 링크에 쿼리를 붙이지 않는다: ${href}` : null;
  if (!GUIDE_LINK_TARGETS.includes(pathPart)) return `없는 화면으로 가는 링크: ${href}`;
  if (query) {
    const params = new URLSearchParams(query);
    const keys = [...params.keys()];
    if (keys.some((k) => k !== 'region') || !CONTINENT_IDS.includes(params.get('region'))) {
      return `허용하지 않는 쿼리: ${href}`;
    }
  }
  return null;
}

const escapeHtml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlineHtml(inlines) {
  return inlines
    .map((n) =>
      n.type === 'link'
        ? `<a href="${escapeHtml(n.href)}" class="${GUIDE_CLASSES.link}">${escapeHtml(n.text)}</a>`
        : escapeHtml(n.text)
    )
    .join('');
}

// 사전렌더용. GuidePage.jsx 가 그리는 구조(section > div > article)와 같게 유지한다.
export function renderGuideHtml(blocks) {
  const body = blocks
    .map((b) => {
      if (b.type === 'ul') {
        return `<ul class="${GUIDE_CLASSES.ul}">${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join('')}</ul>`;
      }
      return `<${b.type} class="${GUIDE_CLASSES[b.type]}">${inlineHtml(b.inlines)}</${b.type}>`;
    })
    .join('');
  return `<section class="${GUIDE_CLASSES.section}"><div class="${GUIDE_CLASSES.container}"><article>${body}</article></div></section>`;
}

import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  GUIDE_PATHS,
  collectGuideLinks,
  guideFileForPath,
  guideLinkProblem,
  parseGuideMarkdown,
  renderGuideHtml,
} from './guide.js';
import { PRERENDER_EXTRA_PATHS, ROUTE_META } from './routeMeta.js';
import { CONTINENT_IDS } from './continents.js';

const contentDir = new URL('../content/guide/', import.meta.url);
const publicDir = new URL('../../public/', import.meta.url);
const read = (dir, name) => readFile(new URL(name, dir), 'utf8');
const BASE = 'https://www.connecttrip.co.kr';

const blockText = (blocks) =>
  blocks
    .flatMap((b) => (b.type === 'ul' ? b.items : [b.inlines]))
    .map((inlines) => inlines.map((n) => n.text).join(''))
    .join('');

const htmlText = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

describe('parseGuideMarkdown', () => {
  it('제목·소제목·문단·목록·링크를 블록으로 나눈다', () => {
    const blocks = parseGuideMarkdown('# 제목\n\n첫 문단 [동행](/companion) 끝\n\n## 소제목\n\n- 하나\n- 둘\n\n마지막');
    expect(blocks.map((b) => b.type)).toEqual(['h1', 'p', 'h2', 'ul', 'p']);
    expect(blocks[1].inlines).toEqual([
      { type: 'text', text: '첫 문단 ' },
      { type: 'link', text: '동행', href: '/companion' },
      { type: 'text', text: ' 끝' },
    ]);
    expect(blocks[3].items).toHaveLength(2);
  });

  it('지원하지 않는 문법은 조용히 넘기지 않고 예외를 던진다', () => {
    expect(() => parseGuideMarkdown('# 제목\n\n### 작은 제목')).toThrow();
    expect(() => parseGuideMarkdown('# 제목\n\n**굵게**')).toThrow();
    expect(() => parseGuideMarkdown('# 제목\n\n1. 번호')).toThrow();
    expect(() => parseGuideMarkdown('# 제목\n\n| 표 |')).toThrow();
    expect(() => parseGuideMarkdown('제목 없음')).toThrow();
    expect(() => parseGuideMarkdown('# 하나\n\n# 둘')).toThrow();
  });

  it('CRLF 원고도 같은 결과를 낸다', () => {
    expect(parseGuideMarkdown('# 제목\r\n\r\n문단')).toEqual(parseGuideMarkdown('# 제목\n\n문단'));
  });
});

describe('renderGuideHtml', () => {
  it('글자를 이스케이프하고 링크는 사이트 안 경로 그대로 쓴다', () => {
    const html = renderGuideHtml(parseGuideMarkdown('# A & B\n\n"오사카" 1 < 2 > 0 [동행](/companion?region=asia)'));
    expect(html).toContain('A &amp; B');
    expect(html).toContain('&quot;오사카&quot; 1 &lt; 2 &gt; 0');
    expect(html).toContain('href="/companion?region=asia"');
  });

  it('원고에 HTML 태그가 섞이면 굽지 않고 예외를 던진다', () => {
    expect(() => parseGuideMarkdown('# 제목\n\n<script>alert(1)</script>')).toThrow();
    expect(() => parseGuideMarkdown('# 제목\n\n본문 <b>굵게</b>')).toThrow();
  });
});

describe('guideLinkProblem', () => {
  it('실제 화면·안내 페이지·유효한 대륙 쿼리만 허용한다', () => {
    expect(guideLinkProblem('/guide/planner')).toBeNull();
    expect(guideLinkProblem('/companion?region=southeast-asia')).toBeNull();
    expect(guideLinkProblem('/guide/safety')).not.toBeNull();
    expect(guideLinkProblem('/companion?region=mars')).not.toBeNull();
    expect(guideLinkProblem('/companion?q=x')).not.toBeNull();
    expect(guideLinkProblem('https://example.com')).not.toBeNull();
    expect(guideLinkProblem('//example.com')).not.toBeNull();
    expect(guideLinkProblem('/mypage')).not.toBeNull();
  });
});

describe('안내 페이지 11종', () => {
  it('경로는 5종 + continents.js 의 6대륙이다', () => {
    expect(GUIDE_PATHS).toHaveLength(11);
    CONTINENT_IDS.forEach((id) => expect(GUIDE_PATHS).toContain(`/guide/region/${id}`));
    expect(guideFileForPath('/guide/region/southeast-asia')).toBe('region-southeast-asia.md');
    expect(guideFileForPath('/guide/safety')).toBeNull();
  });

  it('원고 파일과 경로가 1:1 로 맞는다', async () => {
    const files = (await readdir(contentDir)).filter((n) => n.endsWith('.md')).sort();
    expect(files).toEqual(GUIDE_PATHS.map(guideFileForPath).sort());
  });

  it.each(GUIDE_PATHS)('%s — 원고가 파싱되고 링크가 모두 살아 있으며 메타가 있다', async (path) => {
    const source = await read(contentDir, guideFileForPath(path));
    expect(source).not.toMatch(/^(title|description|h1):/m);
    const blocks = parseGuideMarkdown(source);
    expect(blocks.filter((b) => b.type === 'h2').length).toBeGreaterThan(0);
    const links = collectGuideLinks(blocks);
    expect(links.length).toBeGreaterThan(0);
    links.forEach((l) => expect(guideLinkProblem(l.href), l.href).toBeNull());
    expect(ROUTE_META[path]?.title).toMatch(/\| ConnectTrip$/);
    expect(ROUTE_META[path]?.description?.length).toBeGreaterThan(20);
    // 사전렌더 HTML 에 원고 글자가 빠짐없이 들어간다
    expect(htmlText(renderGuideHtml(blocks))).toBe(blockText(blocks));
  });
});

describe('사이트맵', () => {
  const locs = (xml) => Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);

  it('sitemap.xml 은 static·guide 두 하위 파일을 가리키는 인덱스다', async () => {
    const xml = await read(publicDir, 'sitemap.xml');
    expect(xml).toContain('<sitemapindex');
    expect(locs(xml)).toEqual([`${BASE}/sitemap-static.xml`, `${BASE}/sitemap-guide.xml`]);
  });

  it('sitemap-guide.xml 은 GUIDE_PATHS 와 같다', async () => {
    const xml = await read(publicDir, 'sitemap-guide.xml');
    expect(locs(xml)).toEqual(GUIDE_PATHS.map((p) => `${BASE}${p}`));
  });

  it('sitemap-static.xml 에서 /signup 은 빠졌지만 사본은 계속 굽는다', async () => {
    const xml = await read(publicDir, 'sitemap-static.xml');
    expect(locs(xml)).toEqual([`${BASE}/`, `${BASE}/terms`, `${BASE}/privacy`]);
    expect(PRERENDER_EXTRA_PATHS).toContain('/signup');
    expect(ROUTE_META['/signup']).toBeTruthy();
  });
});

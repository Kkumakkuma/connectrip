import { Fragment, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SEOHead from '../components/SEOHead';
import NotFound from './NotFound';
import { getRouteMeta, normalizeRoutePath } from '../lib/routeMeta';
import { GUIDE_CLASSES, guideFileForPath, parseGuideMarkdown } from '../lib/guide';

// 공개 안내 페이지(/guide/*, 2026-09-15). 로그인 없이 열린다 — 회원 글·개인정보는 싣지 않고
// 저장소 안의 정적 원고(src/content/guide/*.md)만 보여 준다.
// 같은 원고를 scripts/prerender-seo.mjs 가 빌드 때 #root 안에 미리 굽고, 이 컴포넌트가 부팅 후 같은 구조로 대체한다.
// App.jsx 에서 lazy 라우트라 원고 11개는 안내 페이지를 열 때만 받는다(앱 빌드에는 라우트·청크 모두 없음).
const SOURCES = import.meta.glob('../content/guide/*.md', { query: '?raw', import: 'default', eager: true });

function Inlines({ nodes }) {
  return nodes.map((n, i) =>
    n.type === 'link' ? (
      <Link key={i} to={n.href} className={GUIDE_CLASSES.link}>
        {n.text}
      </Link>
    ) : (
      <Fragment key={i}>{n.text}</Fragment>
    )
  );
}

export default function GuidePage() {
  const { pathname } = useLocation();
  const path = normalizeRoutePath(pathname);
  const file = guideFileForPath(path);
  const source = file ? SOURCES[`../content/guide/${file}`] : undefined;
  const meta = getRouteMeta(path);
  const blocks = useMemo(() => (source ? parseGuideMarkdown(source) : null), [source]);

  if (!blocks || !meta) return <NotFound />;

  return (
    <section className={GUIDE_CLASSES.section}>
      <SEOHead title={meta.title} description={meta.description} path={path} />
      <div className={GUIDE_CLASSES.container}>
        <article>
          {blocks.map((b, i) => {
            if (b.type === 'ul') {
              return (
                <ul key={i} className={GUIDE_CLASSES.ul}>
                  {b.items.map((item, j) => (
                    <li key={j}>
                      <Inlines nodes={item} />
                    </li>
                  ))}
                </ul>
              );
            }
            const Tag = b.type;
            return (
              <Tag key={i} className={GUIDE_CLASSES[b.type]}>
                <Inlines nodes={b.inlines} />
              </Tag>
            );
          })}
        </article>
      </div>
    </section>
  );
}

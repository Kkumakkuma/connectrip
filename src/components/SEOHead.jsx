import { useEffect } from 'react';
import { BASE_URL, ROUTE_META } from '../lib/routeMeta';

// 홈 문구는 routeMeta.js 의 '/' 가 단일 출처다(프리렌더가 같은 표를 읽는다). 여기서 따로 적지 않는다.
const DEFAULTS = ROUTE_META['/'];

const DEFAULT_ROBOTS = 'index, follow';

const SEOHead = ({ title, description, path, robots }) => {
  useEffect(() => {
    const pageTitle = title || DEFAULTS.title;
    const pageDesc = description || DEFAULTS.description;
    const canonicalUrl = `${BASE_URL}${path || window.location.pathname}`;
    const robotsValue = robots || DEFAULT_ROBOTS;

    document.title = pageTitle;

    const updates = {
      'meta[name="description"]': pageDesc,
      'meta[name="robots"]': robotsValue,
      'meta[property="og:title"]': pageTitle,
      'meta[property="og:description"]': pageDesc,
      'meta[property="og:url"]': canonicalUrl,
      'meta[name="twitter:title"]': pageTitle,
      'meta[name="twitter:description"]': pageDesc,
    };

    Object.entries(updates).forEach(([selector, content]) => {
      const el = document.querySelector(selector);
      if (el) el.setAttribute('content', content);
    });

    let canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      canonical.setAttribute('href', canonicalUrl);
    }

    return () => {
      document.title = DEFAULTS.title;
      const ogUrl = document.querySelector('meta[property="og:url"]');
      if (ogUrl) ogUrl.setAttribute('content', BASE_URL);
      if (canonical) canonical.setAttribute('href', `${BASE_URL}/`);
      const robotsEl = document.querySelector('meta[name="robots"]');
      if (robotsEl) robotsEl.setAttribute('content', DEFAULT_ROBOTS);
    };
  }, [title, description, path, robots]);

  return null;
};

export default SEOHead;

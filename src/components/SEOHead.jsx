import { useEffect } from 'react';

const BASE_URL = 'https://connecttrip.co.kr';
const DEFAULTS = {
  title: 'ConnectTrip - 여행자부터 승무원까지 모두를 연결하는 여행 플랫폼',
  description: '동행 찾기, 여행 Q&A, 물품거래, 승무원 추천까지. 여행자를 위한 모든 것.',
};

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

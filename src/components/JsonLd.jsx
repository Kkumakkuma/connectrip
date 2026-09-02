import { useEffect } from 'react';

// <head> 에 JSON-LD(schema.org) 스크립트를 넣고 화면을 떠나면 제거한다.
// SEOHead 와 같은 방식(직접 DOM 갱신) — 라이브러리 없이 동작.
const JsonLd = ({ id, data }) => {
  useEffect(() => {
    if (!data) return undefined;
    const scriptId = `jsonld-${id || 'page'}`;
    let el = document.getElementById(scriptId);
    if (!el) {
      el = document.createElement('script');
      el.type = 'application/ld+json';
      el.id = scriptId;
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(data);
    return () => { el?.remove(); };
  }, [id, data]);
  return null;
};

export default JsonLd;

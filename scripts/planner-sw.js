/* 여행 플래너 전용 서비스워커 (설계 §7.1). 라이브러리 없이 직접 쓴다.
 *
 * 왜 필요한가
 *   티켓 지갑의 주 시나리오는 "해외 공항, 로밍 끔"이다. 그런데 앱 셸 캐시가 없으면
 *   새로고침하거나 주소로 직접 들어갈 때 문서를 못 받아 번들이 아예 실행되지 않는다.
 *   IndexedDB 에 티켓을 저장해 둬도 그 화면까지 도달할 수 없다.
 *
 * 범위
 *   · 스코프는 /planner 뿐이다. 사이트 전체를 캐시하지 않는다.
 *   · 셸(HTML)은 network-first — 온라인이면 항상 최신 index.html 을 받는다. 스테일 번들 위험 없음.
 *   · /assets/* 는 cache-first — Vite 내용 해시라 배포마다 키가 바뀐다.
 *   · 교차 출처는 캐시하지 않는다(지도 타일·외부 API — 약관과 신선도 문제).
 *   · 오프라인 편집은 지원하지 않는다. 읽기 전용이다.
 */

// 배포마다 바뀌어야 한다. 고정값이면 activate 의 옛 캐시 정리가 돌지 않아
// 지워진 자산이 계속 남고, 오프라인 사용자는 낡은 셸을 계속 쓴다(교차검토 지적).
// scripts/copy-pdfjs-assets.mjs 가 복사할 때 이 토큰을 빌드 시각으로 바꾼다.
const VERSION = '__BUILD_ID__';
const SHELL_CACHE = `ct-planner-shell-${VERSION}`;
const ASSET_CACHE = `ct-planner-assets-${VERSION}`;
const KEEP = [SHELL_CACHE, ASSET_CACHE];

self.addEventListener('install', (event) => {
  // 셸을 미리 받아 둔다. 런타임 캐시만 두면 "온라인에서 /planner 를 한 번도 안 열고
  // 비행기에 탄" 경우 문서 자체를 못 받아 아무것도 못 연다(2026-09-04 교차검토 지적).
  // 실패해도 설치는 진행한다 — 캐시가 없다고 워커가 안 깔릴 이유는 없다.
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        await cache.add(new Request('/index.html', { cache: 'reload' }));
      } catch {
        /* 무시 */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('ct-planner-') && !KEEP.includes(n))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

function isAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith('/assets/');
}

function isPlannerDocument(request, url) {
  return (
    request.mode === 'navigate' &&
    url.origin === self.location.origin &&
    // 접두사만 보면 /plannerfoo 같은 경로까지 들어온다. 경계를 명시한다.
    (url.pathname === '/planner' || url.pathname.startsWith('/planner/'))
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 교차 출처는 손대지 않는다. 지도 타일을 캐시하면 제공자 약관에 걸린다.
  if (url.origin !== self.location.origin) return;

  if (isPlannerDocument(request, url)) {
    // 셸은 network-first. 실패하면 저장해 둔 문서로 화면이라도 띄운다.
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          // await 하지 않으면 응답을 돌려준 직후 워커가 종료돼 캐시 기록이 날아갈 수 있다.
          await cache.put('/index.html', fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match('/index.html', { cacheName: SHELL_CACHE });
          if (cached) return cached;
          return new Response(
            '<!doctype html><meta charset="utf-8"><p>오프라인이라 일정을 열 수 없습니다.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
          );
        }
      })(),
    );
    return;
  }

  if (isAsset(url)) {
    // 자산은 cache-first. 파일명에 내용 해시가 붙어 있어 낡은 것을 내줄 위험이 없다.
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, { cacheName: ASSET_CACHE });
        if (cached) return cached;
        const fresh = await fetch(request);
        if (fresh.ok) {
          const cache = await caches.open(ASSET_CACHE);
          await cache.put(request, fresh.clone());
        }
        return fresh;
      })(),
    );
  }
});

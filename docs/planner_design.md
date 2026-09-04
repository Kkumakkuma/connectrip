# 커넥트립 플래너 — 화면 흐름·DB 설계 v2 (2026-09-04)

v1(2026-09-03 밤) 개정판. 교차검토 41건(agy 15 + codex 26)을 실측 판정한 결과를 반영했다. 각 항목 끝의 `(id)` 는 판정 근거 id 다. `scope=sql` 판정은 SQL 파일에서 처리하고 여기에는 결론만 한 줄씩 남긴다. 반려한 지적은 문서 말미 §12 에 근거와 함께 남겼다.

---

## 0. 확정 전제 (변경 금지)
- 형태: 플래너 웹 `connecttrip.co.kr/planner`(PC+모바일 브라우저) + 나중에 별도 안드로이드 앱 "커넥트립 플래너". **커넥트립 앱·사이트에는 플래너 화면 없음** — "여행 일정" 게시판 + 가져오기 버튼만.
- 로그인: 커넥트립 계정 그대로(같은 Supabase 프로젝트, 같은 profiles). 별도 가입 없음.
- 게시판: 게시판 선택 단계 없음. 플래너에서 버튼 1번 → "여행 일정" 게시판에 자동 게시. 글마다 "가져오기" 버튼 → 내 플래너에 통째로 복사.
- 디자인: 가전딜과 같은 에어비앤비풍(단일 액센트 #1A56DB, 헤어라인 #ddd, 그림자 1종 shadow-card, 무게 500~600). 커넥트립 쪽 신규 UI(게시판·가져오기 버튼)는 커넥트립 관례(bg-blue-600 rounded-xl font-bold) 유지.
- 구글 결제 계정은 보류. 키 없이 전부 만들고 검증. 지도는 **제공자 어댑터**: 키 있으면 구글, 없으면 오픈스트리트맵(OSM). 구글 약관상 구글 장소 데이터는 구글 지도에만 표시하므로 폴백은 OSM 데이터만 사용.
- 수익화 언급 없음. '무료' 단어 UI 0건. 첫 화면 임의 CTA 없음. 문구는 korean-copywriter 검수.
- 1차 범위에서 '내 위치' 기능 **제외**. 위치 권한 미사용. vercel.json geolocation 헤더 미사용.

---

## 1. 화면 흐름 (라우트)

### 1.1 플래너 (`/planner/*`)
| 경로 | 화면 | 로그인 |
|---|---|---|
| `/planner` | 내 여행 목록. 카드(제목·기간·핀 수·게시 여부·**게시글 미반영 배지**). 상단 "여행 만들기". 비로그인 = 소개 3줄 + 로그인 버튼(LoginPrompt 재사용). 진입 시 대기 가져오기 항목 확인(§1.1 가져오기) (agy-13, agy-14) | 선택 |
| `/planner/new` | 여행 만들기: 이름(1~80), 시작·종료일, 통화(KRW 기본), **타임존(선택, IANA)** → 생성 후 일정판 이동 (codex-11) | 필수 |
| `/planner/t/:tripId` | **일정판**(핵심). 헤더(제목·기간·예산 합·이동시간 합·**"하루 08:00–23:00 기준 · 공휴일 미반영" 가정값 칩**·**게시글 미반영 배지+"게시글 갱신"**) / 날짜 탭(1일차…N일차 + 보관함) / 지도(모바일 상단 42dvh, 데스크톱 좌 64%) / 핀 목록(드래그 정렬 + **키보드 위/아래 이동 버튼**, 핀 사이 이동시간 칩, 경고 배지) / 하단 액션바(장소 검색·링크로 담기·티켓 지갑·더보기: 공유·게시판에 올리기·내보내기) (codex-17, agy-13, codex-26 D5) | 필수(소유자) |
| `/planner/t/:tripId/tickets` | 티켓 지갑: 업로드(사진·PDF, **원본 무리사이즈**), **업로드 직후 날짜 확인 시트 필수**, 날짜별 목록, "오늘" 섹션, 전체화면 보기(흰 배경·**원본 확대**), 여행별 **"티켓 오프라인 저장" 토글(기본 꺼짐)** (codex-15, codex-16, codex-18) | 필수 |
| `/planner/t/:tripId/export` | 내보내기: JSON / ICS / 인쇄(PDF) + 오프라인 저장 상태(스냅샷/티켓 각각 표시) (agy-2, codex-18) | 필수 |
| `/planner/s/:token` | 공유 보기(읽기 전용, 비로그인 허용). 티켓·비공개 메모 제외. "내 플래너로 가져오기". **SEOHead 에 `robots="noindex, nofollow"`** — 토큰 URL 이 색인되면 비공개 일정이 검색에 노출된다 (codex-22 곁가지) | 선택(가져오기는 필수) |
| `/planner/import?post=<id>` 또는 `?token=` | 가져오기 처리: 로그인 확인 → RPC 복사 → `/planner/t/<newId>` 이동. **비로그인이면 대기 항목(30분 TTL) 저장 + `/signup?mode=login&next=/planner/import…` 로 이동, 로그인 성공 시 next 로 자동 복귀.** 폴백으로 `/planner` 진입 시 대기 항목 이어서 처리 (agy-14) | 필수 |
| `/planner/__kit` | 개발 플래그 전용 컴포넌트 킷(버튼·카드·시트·입력·빈 상태 한 화면, 캡처 확인용) | dev |

**로그인 후 복귀(신규, agy-14).** 커넥트립에는 복귀 장치가 아예 없다(LoginPrompt→`/signup`, Signup/SignupEmail 성공 시 `navigate('/')` 하드코딩). 아래를 추가한다.
- `src/planner/importPending.js` — `ct_planner_pending_import_v1` 키, `{v,post,token,ts}`, TTL 30분. 공유 토큰이 localStorage 에 무기한 남지 않게 한다.
- `src/planner/safeNext.js` — `v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\')` 만 통과시키는 오픈 리다이렉트 차단.
- `src/pages/Signup.jsx`(:25, :47)·`src/pages/SignupEmail.jsx`(:130, :534) 의 `navigate('/')` → `navigate(safeNext(searchParams.get('next')) || '/')`. Signup → SignupEmail 이동 시 `next` 전달. `stripIdentityParams`(SignupEmail:252)는 identity 키만 지우므로 next 는 보존된다(확인 완료).
- `src/components/LoginPrompt.jsx` — 선택적 `next` prop 추가. 미전달 시 기존 URL 그대로라 기존 6개 호출부 회귀 없음.

핀 상세는 페이지가 아니라 **바텀시트**(모바일)/우측 패널(데스크톱): 이름·주소, 시각, 체류 시간, 예상 비용, 메모(+"공유 시 포함" 토글), 방문 완료 토글, 후기(평점·추천 메뉴·한 줄) 보기/쓰기, 다른 날로 이동, 삭제. 바텀시트는 focus trap + Esc 닫기 (codex-26 D5).

장소 추가 방식 3가지: ① 검색(구글 자동완성 / OSM은 Enter 검색 — Nominatim 정책상 자동완성 금지) ② 지도 롱프레스(수동 핀, 이름 입력) ③ 링크로 담기(네이버 블로그·구글 지도 링크 → 후보 목록 → 체크해서 담기).

**기간 변경 시 확인(agy-12).** `planner_set_dates` 가 4-arg(`p_confirm_detach`)로 바뀌고 보관함으로 옮겨질 핀 수를 반환한다. 프런트는 먼저 `p_confirm_detach` 없이 호출 → 에러 메시지 `confirm_detach:N` 이 오면 `window.confirm("일정이 짧아지면서 핀 N개가 보관함으로 이동합니다. 계속할까요?")` → 확인 시 `p_confirm_detach:true` 로 재호출 → 성공 시 `핀 N개를 보관함으로 옮겼습니다.` 토스트.

**게시글 동기화 배지(agy-13).** 일정판 진입 시 `planner_board_sync_state(p_trip_id)` 1회, 목록 진입 시 `planner_board_sync_list()` 1회. `stale=true` 면 `text-warning` 한 줄 "고친 내용이 게시글에 아직 반영되지 않았습니다." + secondary 버튼 "게시글 갱신"(기존 `planner_publish_to_board` 재호출, 멱등 upsert). 비교는 `updated_at` 이 아니라 스냅샷 md5 — 자식 행 변경이 부모 `updated_at` 을 올리지 않고, `budget_total` 처럼 스냅샷에 없는 값 변경에는 반응하면 안 되기 때문이다.

### 1.2 커넥트립 쪽 (`/itinerary`)
| 경로 | 화면 |
|---|---|
| `/itinerary` | 여행 일정 게시판 목록(RegionalBoard 카드 관례). 카드 = 미니맵(핀으로 그린 SVG, 키 불필요)·`[국가] 제목`·기간·핀 N개·N일·작성자+CrewBadge·좋아요·**가져오기** 버튼. 글쓰기 버튼 없음(빈 상태: "아직 올라온 여행 일정이 없습니다." 한 줄). 1차는 '더보기' 없이 첫 페이지 고정 20건(created_at DESC, id DESC) |
| `/itinerary/:postId` | 글 상세(코드베이스 첫 글 단위 라우트): 미니맵 크게, 날짜별 동선 요약, 가져오기·좋아요·공유·신고 |

**가져오기 버튼 동작 (agy-9 — v1 에서 변경).** v1 의 "앱은 외부 브라우저로 연다"는 세션이 끊긴다. 실측: `supabase.js` 는 옵션 없이 `createClient` 라 auth-js 기본값(persistSession, localStorage)을 쓰고, Capacitor WebView origin 은 `https://localhost`, 외부 브라우저는 `https://www.connecttrip.co.kr` — origin 이 달라 localStorage 가 완전히 분리된다. 토큰 전달·웹뷰 핸드오프는 둘 다 반려(§12). **브라우저를 경유하지 않는다.**
```js
const handleImport = async () => {
  if (!user) { setShowLogin(true); return; }
  if (busy) return;
  setBusy(true);
  const { data: newTripId, error } = await supabase.rpc('planner_import', { p_post_id: post.id });
  setBusy(false);
  if (error) { setMsg(mapImportError(error.message)); return; }
  if (isNativeApp()) setSavedTripId(newTripId);          // 앱: 안내 + 링크
  else navigate(`/planner/t/${newTripId}`);              // 웹: 바로 일정판
};
```
앱에서는 "내 플래너에 저장했습니다. [브라우저에서 열기](https://www.connecttrip.co.kr/planner/t/<newId>)" 한 줄만 노출한다. `www.connecttrip.co.kr` 은 `capacitor.config.json` 의 `allowNavigation` 에 없으므로 기본 동작으로 시스템 브라우저가 열린다 — `@capacitor/browser` 추가 불필요. 브라우저에서 재로그인이 필요해도 **가져오기는 이미 서버에 반영돼 있어 유실 0건**이다. `/planner/import` 라우트는 웹 유입·공유 토큰 경로 전용으로 유지한다.

**목록 스크롤 복원 (agy-15).** `RouteResetGuard` 는 `[location.key]` 의존이라 뒤로가기(POP)로 `/itinerary` 목록에 돌아와도 top 으로 리셋된다. 기존 게시판은 상세를 모달로 처리해 이 패턴이 없었고, `/itinerary/:postId` 가 코드베이스 첫 글 단위 라우트다. 가드에 `RESTORE_PATHS = ['/itinerary']` 화이트리스트 + `useNavigationType() === 'POP'` 분기를 추가하고, 위치는 `location.key → scrollY` Map(세션 메모리, 최대 50엔트리)에 저장한다. 실제 복원은 데이터 로드가 끝나는 목록 컴포넌트가 `requestAnimationFrame` 안에서 수행한다. 화이트리스트 밖 29개 라우트는 분기 조건이 항상 false 라 동작 불변.

**키워드 폴링 (codex-20 + agy-8 — v1 지시가 그대로면 무효).** v1 의 "KEYWORD_BOARDS 에 `select` 필드 추가"만 하면 **그 필드는 어디서도 읽히지 않는다** — `db.js:463~468` 은 `.select('*')` 리터럴 고정이다. 쿼리 코드를 같이 고쳐야 한다.
```js
// db.js 429~431행 주석 교체(기존 '*' 근거가 거짓이 되므로)
// 기본은 select('*') 로 받아 모든 문자열 컬럼을 매칭 대상으로 삼는다 → 보드별 컬럼명 차이에 영향받지 않는다.
// 단 큰 비텍스트 컬럼(itinerary_posts.snapshot jsonb = 여행 전체)을 가진 보드는 board.select 로 좁힌다.
// 폴링이 1분 주기 × 보드당 최대 20행이라 전송량이 그대로 Supabase egress 비용이 된다.

// db.js 432~438행
{ table: 'itinerary_posts', path: '/itinerary', type: 'itinerary',
  select: 'id,created_at,title,content,author_name,country' },

// db.js 463~468행
.select(board.select || '*')
```
`author_name` 포함은 의도적이다 — 기존 5개 보드 전부 `author_name` 을 갖고 `KEYWORD_SKIP_FIELDS` 에도 없어 현재 매칭 대상이므로, 빼면 보드별 매칭 범위가 달라진다(codex-20). agy-8 은 사람 이름 오탐을 이유로 제외를 권했으나, 오탐이 실제로 관측되면 그때 `KEYWORD_SKIP_FIELDS` 에 전역으로 넣는 편이 일관된다(P3 후속). `KEYWORD_SKIP_FIELDS` 자체는 수정 불필요 — snapshot 이 애초에 안 오고, 와도 `typeof row[k] === 'string'` 가드가 jsonb·숫자를 거른다.

**등록 지점 체크리스트(누락 시 컴파일 에러 없음).** App.jsx 라우트 / Navbar navLinks / CategoryBoard categories / Search BOARDS(+colorMap teal) / **db.js KEYWORD_BOARDS + 쿼리 `.select(board.select || '*')`** / add_keyword_notification CASE 'itinerary' / post_likes CHECK + toggle_post_like 화이트리스트 'itinerary_posts' / routeMeta + sitemap + robots + SEOHead / adminApi.getStats + Admin 라벨 / ReportButton boardType 'itinerary'.

### 1.3 앱 셸 변경

#### (a) 플래너 진입점 — 앱 번들 오염 차단 (codex-19 + agy-11)
v1 의 "App.jsx에 lazy 1줄 … VITE_PLANNER_ENABLED 미설정 → 상수 false → 청크 미생성"은 **사실이 아니다.** 실측: `PAYMENTS_ENABLED=false` 빌드의 `dist/assets/index-*.js` 안에서 `path:"/points",element:em`(NotFound 로 폴딩)인데도 `dist/assets/Points-CitH4ET9.js`(4,616 B)가 그대로 남아 있다. `featureFlags.js` 말미 주석("플래그가 꺼져 있어도 Points 페이지 청크·products.js 는 번들에 남는다")이 같은 현상의 사내 선례다. 반대로 정적 import 인 PayTest 는 `dist`·`android/.../public/assets` 전역에서 `"__paytest"` 0건 = 완전 제거.

동시에, 정적 import + 트리셰이킹(PayTest 패턴)도 플래너에는 부적합하다 — 덩치가 커서 웹 빌드에서 초기 번들에 통째로 붙는다. **lazy 는 유지하되 "무엇을 lazy 하는지"를 빌드가 결정**하게 한다. 3중으로 잠근다.

1) **App.jsx — lazy 호출식 자체를 삼항으로 가드**(라우트만 `&&` 로 가리면 청크가 남는다).
```jsx
import { PLANNER_ENABLED } from './lib/featureFlags';

// 플래너 진입점. lazy() 호출식이 삼항 안에 들어가야 Vite 가 import.meta.env 를 상수 폴딩해
// dynamic import 를 통째로 제거한다. `{PLANNER_ENABLED && <Route …/>}` 로 라우트만 가리는
// 형태는 청크를 dist 에 남긴다(Points 선례 = featureFlags.js 말미 주석).
// 실제 대상 모듈은 vite alias '@planner' 가 빌드 시점에 고른다.
const PlannerRoutes = PLANNER_ENABLED ? lazy(() => import('@planner')) : null;

// 라우트(‘/points’ 부근)
{PLANNER_ENABLED && PlannerRoutes && (
  <Route path="/planner/*" element={<PlannerRoutes />} />
)}
```
2) **vite.config.js — 함수형 config + `@planner` alias 스텁 + 조건부 manualChunks.** 웹·앱이 같은 `vite.config.js`·같은 `package.json` 을 쓰므로(`app:build = vite build --mode app`, `webDir: "dist"`) 무조건형 설정은 앱 빌드도 오염시킨다.
```js
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
const r = (p) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const plannerOn = env.VITE_PLANNER_ENABLED === 'true'
  return {
    plugins: [react()],
    resolve: {
      alias: {
        // OFF 면 스텁이 붙어 플래너 소스·leaflet/pdfjs/zxing 이 모듈 그래프에 못 들어온다.
        '@planner': plannerOn ? r('./src/planner/PlannerRoutes.jsx')
                              : r('./src/planner/planner.disabled.jsx'),
      },
    },
    server: { port: 5173, host: true, allowedHosts: true },
    preview: { host: true, allowedHosts: true },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
            ui: ['framer-motion', 'lucide-react'],
            // ★ 반드시 조건부. 객체형 값은 Rollup 이 '엔트리 모듈'로 해석하므로
            //   무조건 넣으면 앱 코드가 import 하지 않아도 번들에 끌려온다.
            ...(plannerOn ? { 'planner-vendor': ['leaflet', 'idb', 'ics'] } : {}),
          },
        },
      },
    },
    appType: 'spa',
  }
})
```
3) **`src/planner/planner.disabled.jsx`** — `export default function PlannerDisabled() { return null; }` 한 줄 스텁.
4) **`.env.app`** 에 `VITE_PLANNER_ENABLED=false` 추가. Vite 는 `.env` → `.env.app` 순으로 읽고 뒤가 이기므로, 로컬 `.env` 에 true 가 있어도 `npm run app:sync` 가 플래너를 켠 APK 를 만들지 못한다.
5) `featureFlags.js` 에 `export const PLANNER_ENABLED = import.meta.env.VITE_PLANNER_ENABLED === 'true';` + "이 상수는 라우트 표시 담당이고, 코드 제거는 alias 가 담당한다"는 주석.

#### (b) manualChunks 패키지 id 정정 (codex-23)
v1 의 `planner-vendor(leaflet, zxing, pdfjs, idb, ics)` 는 **빌드를 깨뜨린다.** `zxing`·`pdfjs` 는 실존 패키지 id 가 아니고, 격리 빌드 재현 결과 경고가 아니라 하드 실패였다 — `Could not resolve entry module "zxing"` / `✗ Build failed`. (`pdfjs` 는 npm 에 v2.5.4 로 실존하는 **다른** 패키지라 오인 소지도 실재한다.)
- `planner-vendor` 는 **`['leaflet', 'idb', 'ics']`** 만. 셋 다 `package.json` 에 설치된 뒤에 넣는다(미설치 패키지가 목록에 있으면 하드 실패).
- **`pdfjs-dist`·`@zxing/browser` 는 manualChunks 에 넣지 않는다.** 티켓 지갑 라우트에서 `await import()` 로만 부르고 Rollup 자동 분할에 맡긴다 — 일정판 진입에 1MB+ 를 선로딩하지 않기 위해서다 (codex-15).
- 의존성 정정: `@zxing/browser@0.2.1` 은 dependencies 가 없고 `@zxing/library ^0.23.0` 이 **peerDependency** 다. `@zxing/library@^0.23.0` 을 `package.json` 에 **명시적으로 함께 설치**한다(직접 쓰지 않아도 런타임에 필요, CI 재현성). `@vis.gl/react-google-maps@^1.9.0` 의 peer 는 react `>=16.8.0 || ^19.0` 이라 React 19.2.0 과 충돌 없음 — 별도 CI 검증 불필요. `framer-motion@12.27.0` 의 `Reorder` export 는 실측 확인(§8 드래그 정렬 유효).

#### (c) 플래너 CSS 와 전역·preflight 충돌 (codex-25)
v1 의 `.ct-planner button { border-style: solid }` 한 줄은 **결함을 더 눈에 띄게 만든다.** 실측 캐스케이드: `src/index.css:84-88` 의 `button { border: none }`(0,0,1)이 Tailwind preflight(0,0,0)를 이기는데, `border` 는 단축 속성이라 `border-style:none` 뿐 아니라 **`border-width:medium`(≈2.67px)까지** 재설정한다. style 만 solid 로 되돌리면 medium 이 살아나 플래너 안 모든 버튼에 약 3px currentColor 테두리가 생기고 높이가 +5.33px 늘어난다(Chromium DPR1.5 실측: 26.67px vs 21.33px).
```css
/* src/planner/planner.css */
/* 전역 index.css:86 의 `button { border: none }` 은 단축 속성이라 border-width:medium 까지
   재설정한다. style 만 solid 로 되돌리면 medium 이 살아나 모든 버튼에 3px 테두리가 생긴다.
   → preflight 와 동일한 3개 롱핸드를 한 번에 복구한다.
   :where() 로 명시도를 0 으로 만들어 (0,0,1) 유지 — 전역 button(0,0,1)은 소스 순서로 이기고,
   Tailwind .border(0,1,0) 유틸리티에는 정상적으로 진다. */
:where(.ct-planner) button { border: 0 solid currentColor; }
```
검증 실측: 유틸리티 없는 버튼 → `style:solid width:0px`, `border border-red` 버튼 → `style:solid width:1px color:red`. **금지 형태**: `.ct-planner button { border-width: 0; border-style: solid; }` — (0,1,1)이라 `.border`(0,1,0)를 눌러 테두리 유틸리티가 죽는다(실측). `:where(.ct-planner) button` 은 전역 `button` 과 명시도 동률(0,0,1)이라 **planner.css 가 index.css 보다 뒤에 주입돼야** 하는데, Vite 가 지연 로드 청크 CSS 를 `<head>` 뒤쪽에 붙이므로 기본 동작으로 충족된다. `/planner/__kit` 캡처에서 버튼 테두리 0px 를 눈으로 확인한다.
나머지 `.ct-planner` 스코프 3줄(배경 흰색·h1~h3 600/1.25·overflow-wrap anywhere)은 v1 그대로.
※ 근본 원인인 `index.css:86 border:none` 삭제는 **플래너 1차에 묶지 않는다**(전역 변경 → 기존 화면 회귀 캡처 필요). 별건으로 올린다. 현재 이 줄 때문에 `CommendationMatching.jsx:451/:486` 의 테두리가 안 보이는 상태다.

#### (d) SEO 표면 드리프트 방지 (codex-22)
v1 의 "PRERENDER_EXCLUDED 에 `/planner/t`, `/planner/s`, `/planner/import` 추가"는 **아무 효과가 없다.** `scripts/prerender-seo.mjs:145,150` 은 `public/sitemap.xml` 의 `<loc>` 만 순회하므로 sitemap 에 없는 경로는 애초에 루프에 들어오지 않는다(현재 `PRERENDER_EXCLUDED_PATHS = ['/mypage','/admin','/crew']` 는 전부 sitemap 에 없어 **완전한 no-op**). 안전장치가 있다는 착시만 만든다. 이미 드리프트도 존재한다 — `PRERENDER_EXCLUDED_PATHS` 에는 `/crew` 가 있는데 robots 에는 없고, robots 에는 `/points` 가 있는데 목록에는 없다.
- **단일 출처를 `src/lib/routeMeta.js` 로 올린다**: `export const ROBOTS_DISALLOW = ['/admin','/mypage','/points','/api/payment/','/crew','/planner/t/','/planner/import','/api/planner/'];`
- `PRERENDER_EXCLUDED_PATHS` 주석을 "사이트맵에 실린 경로 중 정적 HTML 을 굽지 않을 것. **사이트맵에 없는 경로를 여기 적어도 아무 일도 하지 않는다** — 색인 차단은 `ROBOTS_DISALLOW` 로" 로 고쳐 오해를 코드에 못박는다.
- 신규 `scripts/check-seo-surfaces.mjs` — ① sitemap 경로에 routeMeta 문구 존재 ② robots Disallow 와 sitemap 충돌 없음 ③ `robots.txt` ↔ `ROBOTS_DISALLOW` 문자열 일치 ④ sitemap 에 없는 PRERENDER 제외 항목 경고. `package.json` 의 `"build": "node scripts/check-seo-surfaces.mjs && vite build && node scripts/prerender-seo.mjs"`(app:build 는 정적 SEO 대상이 아니라 그대로).
- sitemap 에는 `/planner`(랜딩)·`/itinerary` 만 추가하고 routeMeta 에 두 경로 메타를 넣는다(sitemap 에 없으면 문구만 있고 프리렌더가 안 된다 — 현재 `/search` 가 그 상태).
- `/planner/s/`(공유 토큰)는 robots Allow 로 두되 화면 자체를 `noindex, nofollow` 로 낸다(§1.1).

#### (e) 기타 셸
- Footer 는 `/planner` 경로에서 숨김(ShellChrome 소형 컴포넌트, useLocation). RouteResetGuard 는 `/planner` 하위에서 pathname 동일하면 스크롤 리셋 생략.
- `tailwind.config.js` theme.extend 에 가전딜 토큰 **추가 키만**(colors primary/canvas/surface-*/hairline/ink/body/muted/on-primary/success/warning/error, boxShadow.card, maxWidth.content/listing, borderRadius.sm 8px·md 14px). `rounded-xl` 등 기존 키 재정의 금지(148곳 사용).
- `vercel.json` 은 §7(SW)·§5(pdfjs 자산) 헤더 2블록만 추가하고 그 외는 손대지 않는다.

---

## 2. 데이터 모델 (Supabase, 접두사 `planner_`, 게시판만 `itinerary_posts`)

공통 규칙은 v1 그대로: `id uuid PK`, `user_id → profiles CASCADE`, `created_at/updated_at` + `planner_touch_updated_at` 트리거, RLS `TO authenticated` own-only, `REVOKE ALL FROM PUBLIC, anon, authenticated` 후 필요한 동사만 GRANT, 가드 bypass 판정은 `COALESCE` 필수, 모든 함수 `SET search_path = public, pg_temp`.

테이블 구성(planner_trips / planner_days / planner_catalog / planner_places / planner_tickets / planner_place_reviews / planner_shares / itinerary_posts / 서버 전용 캐시 2종 / 레이트 버킷)은 v1 유지. SQL 판정 반영분은 아래와 같고, 실제 DDL 은 `patches_sql.md` 와 `planner_20260904.sql` 에서 처리한다.

| 판정 | 결론(설계 반영 한 줄) |
|---|---|
| codex-2 (P0) | `planner_catalog` 의 anon 직접 SELECT 폐지. `GRANT SELECT TO authenticated` + 정책은 "내 핀 또는 내 후기가 참조하는 행"만. 권한·정책 블록은 참조 테이블 생성 이후(§6 뒤)로 이동해야 적용이 죽지 않는다. 죽은 컬럼 `rating`·`user_rating_count` 삭제. 인덱스 `(user_id, catalog_id) WHERE catalog_id IS NOT NULL` 추가. **§2 검증 기준 변경: "anon catalog SELECT 가능" → "anon SELECT 42501 + 타인 핀만 연결된 행 0건"** |
| codex-8 (P0) | `planner_days.date` 를 `trips.start_date + day_index` 파생값으로 가드에서 강제(직접 PATCH 로 임의 날짜 주입 차단) |
| agy-4 (P0) | 탈퇴·여행 삭제 시 `planner_tickets` 행만 CASCADE 되고 Storage 실파일은 남는다 → `planner_orphan_objects` 대기 큐 + AFTER DELETE 트리거로 세 경로(탈퇴/여행삭제/개별삭제)를 한 번에 잡는다 |
| agy-5 (P0) | 같은 장소가 google/osm 로 2행이 되는 문제는 별도 canonical 테이블 대신 **자기참조 `canonical_id`** 로 자리만 열어둔다. 실제 매칭·백필은 구글 키가 생길 때(P2) |
| agy-6 (P0) | 외부 제공자 전역 페이싱(§4) — 단일 행 `FOR UPDATE` 로 "다음 허용 시각"을 예약하는 방식. 기존 `planner_rate_hit` 은 10분 단위 카운터라 초 단위 페이싱 불가 |
| codex-5 (P1) | `planner_owner_guard` 의 bypass GUC 를 전역 `app.allow_sensitive` 가 아닌 **플래너 전용 이름**으로 좁힌다. `toggle_post_like` 의 `set_config('app.allow_sensitive')` 는 `profiles_guard` 가 읽으므로 **절대 건드리지 않는다** |
| codex-7 (P1) | `planner_tickets.storage_path` 를 `<user_id>/<trip_id>/<파일명>` 3조각으로 테이블 CHECK 강제(가드보다 강하고 bypass 경로에도 적용) + INSERT 정책 강화 |
| codex-4 (P1) | `planner_days.day_index` 상한 추가(직접 INSERT 로 무제한 날짜 생성 차단). 나머지 3건은 이미 구현돼 있어 반려 |
| codex-9 (P1) | `itinerary_posts` 에 `end_date >= start_date` CHECK 추가(나머지 4건은 이미 존재) |
| codex-21 (P1) | `toggle_post_like` 의 insert 경로에 대상 글 EXISTS 확인 추가(삭제된 글에 좋아요가 꽂히는 문제). 취소(delete) 경로는 그대로 둬 해제는 계속 가능 |
| codex-6 (P1) | `planner_get_shared` 레이트리밋 키를 토큰 해시가 아니라 **해석된 trip_id** 로. `STABLE` 제거 필수(PL/pgSQL 은 STABLE 을 read-only 로 실행해 카운터 INSERT 가 거부된다) |
| codex-10 (P0) | `legs` 는 배열 순번 기반이라 정렬 변경 후 낡은 값이 남는다 → `planner_day_places_fp(day_id)` 지문으로 "어느 핀 구성으로 계산됐는지" 식별, 스냅샷 빌더에서 검증 |
| codex-11 (P1) | `planner_trips` 에 `timezone text`(IANA 패턴 CHECK) + 생성시각 컬럼 추가. 나머지 7건은 SQL 이 이미 해결(스냅샷 v 버전·보관함 포함 등) |
| codex-12 (P1) | 후기는 대표 카탈로그 행(`canonical_id`)에 모으고 읽기는 그룹 전체를 훑는다. 후기 행 이동은 가드가 무조건 차단하므로 불가 |
| codex-13 (P1) | Nominatim "앱 합계 1 req/s" 를 DB 한 행에 다음 호출 시각을 예약하는 전역 게이트 + 검색 캐시로 보장(서버리스는 인스턴스가 여러 개라 함수 내부 직렬화로는 불가) |
| agy-7 (P1) | 활성 지도 제공자를 `planner_settings` 단일행에 잠근다(SSOT). 프런트 `providers/index.js` 는 env 가 아니라 이 값을 읽어 지도를 고른다 → 지도 제공자와 장소 데이터 제공자가 갈라질 수 없다(구글 ToS 3.2.4) |
| agy-12 (P1) | `planner_set_dates` 4-arg 화 + 보관함 이동 핀 수 반환(§1.1) |
| agy-13 (P2) | `planner_board_sync_state(uuid)` / `planner_board_sync_list()` 신규. 스냅샷 md5 비교(§1.1) |

스토리지: 버킷 `planner-tickets`(public=false, file_size_limit 15MB, allowed_mime 4종). 읽기는 `createSignedUrl(120초)`만. **삭제 순서는 스토리지 먼저 → 행**(트리거 큐가 폴백, agy-4·codex-7). 기존 `images` 버킷 정책 부재는 이번 범위 밖(별도 보고).

RPC 목록은 v1 유지 + `planner_board_sync_state`·`planner_board_sync_list`·`planner_day_places_fp` 신규, `planner_set_dates` 시그니처 변경. 파일은 `src/lib/planner_20260904.sql`(멱등, 헤더에 적용 방법·롤백). 적용은 MCP `execute_sql`(`apply_migration` 차단 시).

---

## 3. 스냅샷 형식 v1 (게시판·공유·가져오기·오프라인·내보내기 공용)
```json
{ "v":1, "title":"", "start_date":"2026-10-01", "end_date":"2026-10-04", "currency":"KRW",
  "country":"일본", "timezone":"Asia/Tokyo",
  "days":[{ "index":0, "date":"2026-10-01",
     "places":[{ "order":0, "name":"", "address":"", "lat":0, "lng":0, "provider":"google|osm|null",
                 "provider_place_id":"", "catalog_id":"uuid|null",
                 "planned_time":"10:30", "stay_min":60, "cost":12000, "note":"공개 메모만" }],
     "legs":{ "fp":"<planner_day_places_fp>", "items":[{ "from":0, "to":1, "mode":"WALK",
              "duration_s":900, "distance_m":1100, "source":"google|estimate" }] } }],
  "unassigned":[ ... 보관함 핀 ... ],
  "summary":{ "days_count":4, "places_count":12, "cost_total":0 } }
```
- `timezone` 추가 (codex-11). ICS 내보내기와 표시용이며, §6 동선 검사는 타임존 변환을 하지 않는다.
- `legs` 에 `fp`(핀 구성 지문) 추가 (codex-10). 지문이 현재 구성과 다르면 화면은 이동시간을 "재계산 필요"로 표시하고 저장값을 쓰지 않는다.
- 서버 RPC 가 조립하므로 클라이언트 위조 불가. 가져오기는 이 형식만 신뢰(필드 화이트리스트·길이·범위 재검증). 스냅샷 `v` 가 올라가면 `planner_board_sync_state` 는 비교를 건너뛴다(전량 stale 로 보이지 않게, agy-13).

---

## 4. 지도·장소·경로 제공자 어댑터
`src/planner/providers/` — `index.js` 는 **env 가 아니라 `planner_settings.google_maps_enabled` 를 읽어** 제공자를 고른다 (agy-7). 지도와 장소 데이터가 서로 다른 제공자로 갈라지면 구글 ToS 3.2.4("No Use With Non-Google Maps") 위반이므로 선택지를 DB 단일행에 잠근다.

- **map**: Google(`@vis.gl/react-google-maps`, 동적 로드) / OSM(`leaflet` + OSM 타일, 저작권 표기). 공통 인터페이스 `<MapView center pins route onLongPress onPinClick />`. 지도 로드 실패 시에도 목록만으로 전 기능 조작 가능해야 한다 (codex-26 D5).
- **places**(`api/planner/places.js`): Google Places(New) autocomplete(세션 토큰)+details(필드마스크 최소) / OSM Nominatim search(Enter 시 1회, User-Agent 명시). 둘 다 `{provider, provider_place_id, name, address, lat, lng, opening_hours?}` 로 정규화 → `planner_upsert_catalog`.
  - `opening_hours` 는 **§6 정규화 형식 v1** 로만 저장한다 (codex-17). 구글 `periods` → 분 구간 변환, OSM `extratags.opening_hours` 문자열은 파싱하지 않고 `unknown:true` 로 보존. 정규화 책임은 어댑터에 있다 — `planner_upsert_catalog` 는 기존 행을 덮어쓰지 않으므로(회원 경로에서 갱신 불가) **1차 저장 전에 형식을 확정**해야 한다.
  - **Nominatim 1 req/s 는 DB 전역 게이트로 보장** (agy-6, codex-13). 서버리스는 인스턴스가 수평 확장돼 프로세스 내부 큐로는 앱 합계를 못 지킨다. 단일 행 `FOR UPDATE` 로 "다음 허용 시각"을 예약하고 호출자는 반환된 ms 만큼 대기 후 1회 호출한다. 검색 결과는 24h 캐시.
- **routes**(`api/planner/routes.js`): Google Routes computeRoutes(WALK/DRIVE/TRANSIT, 필드마스크 최소, route_cache 30일) / 폴백 = 하버사인 × 보정계수(도보 4.5km/h ×1.3, 차량 도심 28km/h ×1.3, 대중교통 20km/h) `source:'estimate'` 로 "예상" 표시. 한국은 구글 자동차·도보 미지원이라 키가 있어도 estimate 폴백.
- **links**(`api/planner/extract-links.js`) — **SSRF 방어를 홉마다 재검증하는 형태로 재설계** (codex-14). 이 함수는 리포지토리 최초의 "사용자 입력 URL 서버 fetch" 라 재사용할 가드가 없다(기존 `api/*.js` 6개는 전부 고정 호스트만 호출). 허용 호스트에 `goo.gl/maps`·`maps.app.goo.gl` 단축 URL 이 있고 302 Location 추적이 설계상 필수라, 홉별 재검증 부재는 실제로 열린 구멍이다.

  신규 `api/planner/_url-guard.js` 에 파싱·IP 판정·핀닝을 모으고 `extract-links.js` 는 `guardedGet()` 만 쓴다(직접 `fetch` 금지).
  - **정적 검사**: https 전용 / `userinfo(@)` 거부(`https://blog.naver.com@evil.io`) / 비표준 포트 거부 / IPv4·IPv6 literal 거부 / 호스트 화이트리스트 + **경로 화이트리스트**(`google.com` 은 `/maps` 만 — `/url` 오픈 리다이렉트 차단) / 트레일링 닷·혼합 인코딩 거부.
  - **DNS**: `dns.lookup(host, {all:true})` 로 A/AAAA 전부 확인해 **하나라도 사설이면 전체 거부**. 차단 대역 = 0/8, 10/8, 127/8, 100.64/10(CGNAT), 169.254/16(메타데이터), 172.16/12, 192.168·192.0·192.88, 198.18·198.19·198.51, 203.0, 224+ / `::`, `::1`, `fe80::/10`, `fc00::/7`, `2002::`, `64:ff9b::`, `100::`, IPv4-mapped 는 재귀 판정.
  - **핀닝**: 해석된 IP 로만 접속(`lookup` 옵션으로 재조회 차단 = DNS rebinding 차단), Host/SNI 는 원 호스트 유지.
  - **홉마다 전 검사 재실행**: 리다이렉트 3회, 매 홉에서 `parseTarget` + `resolvePublic` 을 다시 통과해야 한다.
  - **응답**: content-type 화이트리스트(text/html·xhtml·text/plain·json), `Accept-Encoding: identity`(압축 폭탄 차단), 본문 1MB 스트리밍 중단, 전체 8초 데드라인.
  - 실패는 사유를 감추고 고정 코드만 응답(`LINK_NOT_SUPPORTED`, 기존 `verify-identity.js` RESULT_MAP 패턴). `body`·`chain` 은 로그·DB 에 남기지 않는다.

  추출 규칙은 v1 유지: 네이버 블로그 = m.blog PostView 의 `div.se-module-map[data-linkdata]` JSON, 구글 지도 = 최종 URL 의 `!3d/!4d`·`q=`, 유튜브·인스타그램 1차 미지원. 결과 24h 캐시(정규화된 최초 URL sha256).
- 구글 약관 준수: Place ID 영구, 좌표·기타 필드 30일(`catalog.fetched_at` 기준 재조회), 구글 장소는 구글 지도에만, 목록 표시 시 "Google" 출처 표기. OSM 은 ODbL 표기. ※ `fetched_at` 30일 만료·재조회 로직은 현재 SQL 에 없고 `planner_upsert_catalog` 가 오히려 갱신을 막는다 — **구글 키 도입 전 별건**으로 남긴다 (codex-2 §7).

---

## 5. 티켓 지갑 (전부 클라이언트, 무료)

### 5.1 판독 — 결과는 항상 draft, 사용자 확인 필수 (codex-15)
v1 은 판독 성공 시 자동 확정이고 실패 시에만 수동 선택이었다. **판독 성공 여부와 무관하게 확인 시트를 1회 거친다.**
- 이미지: `@zxing/browser` 로 QR·PDF417·Aztec 판독. IATA BCBP(`M1` 시작)면 편명·출발지·도착지·연중일자(3자리) 파싱. 연중일자에 연도가 없는 건 결함이 아니다 — 여행 기간이 최대 61일(SQL CHECK)이라 그 창 안에서 날짜가 유일하게 결정된다(연말 넘김·윤년 포함).
- PDF: `pdfjs-dist` 텍스트 추출 → 날짜 정규식. **"기간 안 첫 날짜 무조건 채택" 금지** — 왕복 e티켓(가는 편/오는 편)·호텔 확인서(체크인/체크아웃)는 두 날짜가 모두 기간 안이라 텍스트 순서로 결정돼 버린다. 후보를 전부 모아 라벨 근접도로 점수화한다(앞 30자에 `출발|탑승|Departure|Check-?in|입장|공연` +3 / `발권|예약일|결제|Issued|Booking|Check-?out|도착|Arrival` −3).
- `DD/MM/YYYY` vs `MM/DD/YYYY` 는 12일 이하에서 조용히 뒤집힌다 → 슬래시 2자리 패턴은 후보 2개를 모두 만들고 `sure:false`(`ambiguous`)로 표시.
- 반환값은 `{ candidates, best, ambiguous }` 이며 **절대 자동 저장하지 않는다.**
- `src/planner/tickets/TicketDateConfirm.jsx` — 업로드 직후 항상 노출. 제목 "이 날짜가 맞나요?", 본문에 판독 근거 원문 한 줄(`…10월 3일…`)을 그대로 보여준다. 후보 2개 이상이면 라디오, `ambiguous` 이거나 후보 0개면 날짜 입력을 빈 상태로 연다. **확인 전에는 `event_date`/`event_time` 에 쓰지 않는다**(파일 업로드와 메타 행 생성은 먼저 하되 날짜는 NULL). BCBP 판독분도 예외 없이 같은 경로.
- OCR(`tesseract.js`, 한+영 22MB)은 "글자 읽기" 버튼을 눌렀을 때만 지연 로드(옵션).

### 5.2 pdf.js 자산·워커 (codex-15)
v1 에 `workerSrc`·cMap·standardFont 지정이 0건이었다. `GlobalWorkerOptions.workerSrc` 미지정은 pdf.js v4+ 런타임 실패이고, CMap 미지정은 대한항공·아시아나 e티켓처럼 CID-keyed CJK 폰트를 쓰는 PDF 에서 `textContent` 가 깨져 "10월 3일" 정규식 자체가 무력화된다.
- 신규 `scripts/copy-pdfjs-assets.mjs` — `pdfjs-dist` 의 `cmaps`·`standard_fonts` 를 `public/pdfjs/` 로 복사. `prebuild`·`postinstall` 훅에 등록, `.gitignore` 에 `public/pdfjs/` 추가.
- `vercel.json` headers 에 `/pdfjs/(.*)` → `Cache-Control: public, max-age=31536000, immutable`.
- 신규 `src/planner/lib/pdfText.js` — `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'` 로 Vite 가 워커를 별도 에셋으로 emit. `getDocument({ cMapUrl:'/pdfjs/cmaps/', cMapPacked:true, standardFontDataUrl:'/pdfjs/standard_fonts/', isEvalSupported:false })`, 최대 3쪽, `page.cleanup()` + `doc.destroy()`.
- CSP 는 현재 `vercel.json`·`index.html` 어디에도 없어 worker/blob 를 막을 정책 자체가 없다 → 이번 범위에서 다루지 않는다.

### 5.3 전체화면 보기 — 원본이 기본, 재생성은 QR 한정 (codex-16)
v1 은 `barcode_text` 가 있으면 포맷 무관하게 재생성이었다. **불가능하다.** 실측(@zxing/library 0.23.0): `core/pdf417/` 에 encoder 디렉터리가 없어 `PDF417Writer` 가 존재하지 않고, `MultiFormatWriter` 는 QR_CODE 외 전부 `No encoder available for format N` 을 던진다. `AztecCodeWriter` 는 export 되지만 모듈 수의 정수배가 아닌 픽셀 크기에서 `The region must fit inside the matrix` 로 죽는다(400·200·303 전부 실패, 151만 성공) — "화면 폭으로 다시 그림"은 Aztec 에서 사실상 매번 예외다.
- **기본 = 원본 표시.** 흰 배경 위에 업로드 원본을 `object-fit:contain` 으로 렌더(이미지 `<img>`, PDF `pdfjs-dist` 1쪽 캔버스 devicePixelRatio 배율). 핀치 줌·더블탭 확대 허용, Wake Lock API(지원 시), "화면 밝기를 최대로 올려 주세요" 한 줄 안내.
- **재생성은 `barcode_format === 'QR_CODE'` 일 때만** 보조 버튼("코드 크게 보기")으로 제공하고 그 외 포맷은 버튼 자체를 숨긴다. 토글이 열려도 원본은 언마운트하지 않는다(재생성 코드가 안 읽히면 즉시 되돌릴 수 있어야 한다). `BrowserQRCodeSvgWriter` 기본 ECC 는 L 이라 화면 촬영·저조도에 취약 → 힌트로 `ERROR_CORRECTION:'M'`, `MARGIN:2`, 변 최대 720px.
- **탑승권(IATA BCBP)은 PDF417 이므로 절대 재생성하지 않는다.** 게이트 거절 = 탑승 실패인 고피해 경로다. `barcode_text` 는 표시용이 아니라 **BCBP 파싱 → 날짜·편명 자동 채우기 전용**이다.
- 원본 확대가 선명하려면 **업로드 시 리사이즈 금지, 원본 그대로 저장**(15MB 상한은 그대로).
- `barcode_text` 에 `U+0000` 이 포함되면(바이너리 Aztec 페이로드) Postgres `text` 에 담기지 않아 INSERT 가 실패한다 → 클라에서 감지하면 저장하지 않고 null 로 넘긴다.
- SQL 부수: `barcode_format` 에 ZXing `BarcodeFormat` 이름 집합 CHECK 를 건다(길이 30 제한만으로는 `qr`·`QR`·`qrcode` 가 통과해 QR 인데 버튼이 안 뜨는 조용한 버그가 난다).

### 5.4 IndexedDB 저장 정책 (codex-18 + agy-2)
v1 은 "여행 열 때마다 스냅샷 + 티켓 blob 저장, 로그아웃 시 삭제" 한 줄이었다. 계정 키·보관 기간·quota·삭제 트리거가 전부 없었고, 명시된 "로그아웃 시 삭제"조차 붙을 자리가 없다(`AuthContext.jsx:285-298 signOut()` 과 241-247 세션 소실 분기 둘 다 로컬 데이터를 지우는 코드가 없다). 티켓은 실제로 민감하다 — BCBP 페이로드는 승객 성 + PNR 조합이라 다수 항공사에서 예약 조회·변경이 가능한 자격증명이다.

**단일 게이트 모듈 `src/planner/lib/offlineStore.js`.** 플래너 코드는 `idb` 를 직접 import 하지 않고 반드시 이 모듈만 쓴다.
- **단일 DB `ct-planner`, 모든 레코드 키에 소유자 uid**(`keyPath: ['owner','tripId']` / `['owner','ticketId']`). 계정별 DB 분리는 반려 — Firefox 가 `indexedDB.databases()` 를 지원하지 않아 로그아웃이 한 번이라도 실패한 계정의 DB 가 영구 고아가 된다. 읽기는 항상 현재 uid 로만 하므로 계정 간 혼입이 구조적으로 불가능하다.
- **스냅샷은 자동 저장, 티켓 blob 은 여행별 opt-in(기본 꺼짐).** 켤 때 안내 한 줄: "기기에 티켓 사본이 저장됩니다. 여행이 끝나면 자동으로 지워집니다."
- **만료** = `min(저장 후 30일, 여행 종료 +3일)`. (`identity.js` 의 `IDENTITY_PROOF_TTL_MS` + `clearIdentityProof()` 관례를 따른다.)
- **quota**: 저장 전 `navigator.storage.estimate()` 로 사용률 90% 미만 확인 + 기기당 티켓 총량 60MB 상한. 실패 시 조용히 넘기지 않고 "오프라인 저장 안 됨(저장 공간 부족)" 배지로 표시.
- **삭제 트리거 4종**: ① 세션 소실 = `AuthContext` `onAuthStateChange` else 분기(로그아웃·토큰 만료·갱신 실패 전부) → `purgeAll()`(DB 삭제) ② 로그인 성공 분기 → `sweep(uid)`(이전 계정 잔재 + 만료분 청소) ③ 여행 삭제 → `purgeTrip` ④ 티켓 삭제 → `purgeTicket`. AuthContext 에서는 **동적 import** 로 부른다 — 앱 번들에 플래너 코드가 정적으로 끌려오면 §1.3(a)가 무너진다.
- 회원 탈퇴 이벤트 훅은 1차 제외(클라이언트 탈퇴 플로우가 코드에 없음, `grep` 0건). 탈퇴는 세션 소실을 동반하므로 `purgeAll` 이 사실상 덮는다.
- **암호화는 1차 미적용.** 같은 브라우저에 키가 남는 이상 동일 출처 JS 에는 무의미하고, 실효 있는 형태(WebCrypto AES-GCM + `extractable:false` CryptoKey)는 opt-in·TTL·purge 가 자리잡은 뒤 얹을 P2 항목이다. 1차 방어선은 "덜 저장하고 빨리 지운다".

---

## 6. 동선 현실성 검사 (순수 함수 `src/planner/lib/feasibility.js`, vitest) (codex-17)

**시간 기준.** 모든 시각은 목적지 현지 벽시계다. `planned_time` = `time`(무TZ), `planner_days.date` = `date`, 영업시간도 현지 기준이라 **타임존 변환을 하지 않는다**. 요일은 문자열을 직접 쪼개 계산한다 — `new Date('2026-10-03').getDay()` **금지**(UTC 파싱이라 UTC− 지역 사용자에게 하루 밀린다). `const [y,m,d] = s.split('-').map(Number); new Date(y, m-1, d).getDay()`.

**정규화 영업시간 = `planner_catalog.opening_hours` 에 저장하는 유일한 형식.** places 어댑터(§4)가 이 형식으로만 쓴다. 카탈로그 행은 회원 경로에서 덮어쓸 수 없으므로 1차 저장 전에 확정한다.
```
{ v:1, src:'google'|'osm', days:{ '0':Interval[], … '6':Interval[] }, unknown:boolean, raw?:any }
Interval = { from:number, to:number }   // 자정 기준 분
```
- 자정 넘김은 `to > 1440` 으로 편다(18:00~02:00 → `{from:1080,to:1560}`).
- 24시간 영업 → `{from:0,to:1440}` 한 구간.
- 휴게시간은 같은 요일에 구간 2개 이상(11–14 + 17–21 → `[{660,840},{1020,1260}]`).
- 구글 `regularOpeningHours.periods`: `close` 없으면 24시간, `close.day !== open.day` 면 자정 넘김(to 에 1440 가산).
- OSM `extratags.opening_hours` 는 OSM 문법 문자열이라 1차에서 파싱하지 않는다 → `{v:1, src:'osm', days:{}, unknown:true, raw:<원문>}` 저장 + 검사 제외.
- **공휴일·임시휴업·시즌 변동은 반영하지 않는다.** 여행 계획 시점(수개월 전)의 데이터를 구글에서도 OSM 에서도 얻을 수 없다. 반영하지 않는다는 사실을 화면에 고지한다.

**상수(전부 가정값, 화면에 노출).** `DAY_START=08:00`, `DAY_END=23:00`, `LAST_ENTRY_BUFFER_MIN=30`. `FEASIBILITY_DEFAULTS` 한 곳에 모으고 하드코딩 금지.

**경고 코드(전부 "확정"이 아니라 "추정").**
- `TIME_ORDER` — 핀 시각 순서가 정렬과 다름. 영업시간 불필요, 항상 검사.
- `CLOSED_DAY` — 그 요일 구간 배열이 비어 있음. `unknown:true` 이거나 요일 키가 없으면 **검사 생략(무표시)**.
- `ARRIVE_AFTER_CLOSE` — 도착 예정 분이 그날 어느 구간에도 속하지 않음. 전날 구간의 자정 넘김 꼬리(`to > 1440`)도 함께 본다. 구간 끝은 `to − 30분` 으로 보되 `{0,1440}`(24시간)에는 버퍼를 적용하지 않는다. 휴게시간에 걸리면 `reason:'break'`, 폐점 이후면 `reason:'closed'`.
- `OVER_DAY` — 첫 핀 시각(없으면 `DAY_START`)부터 이동+체류 누적이 `DAY_END` 초과. **영업시간과 무관하게 발동하므로 반드시 가정값을 함께 표시**한다.

**표시 규칙 — 데이터가 없으면 경고를 내지 않고, 가정값은 화면에 명시한다.**
- 배지 문구는 단정하지 않는다. "문 닫았어요" ✕ → "폐점 30분 전 기준으로는 늦을 수 있어요" ○.
- 배지를 누르면 판정 근거(사용한 영업시간 구간·출처 Google/OSM·적용한 가정값)를 그대로 보여준다.
- 일정판 헤더에 **"하루 08:00–23:00 기준 · 공휴일 미반영" 칩을 상시 노출**하고, 칩을 눌러 그 여행의 `DAY_START`/`DAY_END` 를 바꾼다(1차는 localStorage, 스키마 변경 없음).
- 영업시간이 없거나 `unknown:true` 면 영업시간 기반 2종은 아무 표시도 하지 않고, 필요 시 회색 "영업시간 정보 없음"만 둔다.

**vitest 최소 8케이스.** ① 자정 넘김 18:00~02:00 에 23:30 도착 = 무경고 ② 24시간에 03:00 도착 = 무경고·버퍼 미적용 ③ 휴게시간 11–14/17–21 에 15:00 도착 = `ARRIVE_AFTER_CLOSE reason:'break'` ④ 버퍼 경계 21:00 폐점에 20:29 무경고 / 20:31 경고 ⑤ `TZ=America/New_York` 로 실행해도 '2026-10-03' 이 토요일 ⑥ `unknown:true` = 무경고 ⑦ 가정값 변경(06:00~24:00) 반영 ⑧ 영업시간 0건 + 과밀 일정 = `OVER_DAY` 만.

---

## 7. 오프라인·내보내기

### 7.1 오프라인 범위와 서비스워커 (agy-2)
실측: `index.html:104-115` 가 Capacitor 가 아닌 **모든 웹 로드에서** `getRegistrations()` 전체를 `unregister` 하고 `caches.keys()` 전체를 `delete` 한다(스테일 번들 방지 목적, `pushNotifications.js:28-30` 주석이 의도임을 확인). `public/sw.js` 는 `register` 호출이 0건인 죽은 코드이고 workbox·vite-plugin-pwa 도 없다. 따라서 **앱 셸 캐시가 존재하지 않아 오프라인 콜드스타트가 불가능하다** — 새로고침하거나 `/planner/t/:tripId` 로 직접 진입하면 문서를 못 받아 번들이 실행되지 않고 IndexedDB 에도 접근할 수 없다. 티켓 지갑의 주 시나리오(해외 공항, 로밍 끔)가 정확히 이 케이스라 SW 없이는 §5.4 의 가치가 대부분 사라진다.

**`/planner` 스코프 전용 서비스워커를 도입한다**(범위 축소만 하면 티켓 지갑이 죽는다).
- `index.html` 의 전면 제거 로직을 **스코프 필터로 교체**: 스코프에 `/planner` 가 없는 등록만 `unregister`, 이름이 `ct-planner-` 로 시작하지 않는 캐시만 `delete`. 인라인 classic script 가 defer module 보다 먼저 실행되므로 필터가 없으면 매 로드마다 unregister→재등록이 반복되고 캐시가 계속 날아간다.
- 신규 `public/planner-sw.js` — 라이브러리 없이 직접 작성(workbox·vite-plugin-pwa 미도입). 런타임 캐싱만. **셸은 network-first**(온라인이면 항상 최신 index.html → 스테일 번들 위험 없음), **`/assets/*` 는 cache-first**(Vite 내용 해시라 배포마다 키가 바뀜). **교차 출처는 캐시 금지**(지도 타일·외부 API — 약관·신선도).
- 신규 `src/planner/registerOfflineSW.js` — `/planner` 진입 시 1회. `PLANNER_ENABLED` / Capacitor 네이티브 / `serviceWorker` 지원 / `pathname.startsWith('/planner')` 4중 가드. **scope 는 `'/planner/'` 가 아니라 `'/planner'`** — 트레일링 슬래시를 붙이면 랜딩 `/planner` 자신이 스코프 밖으로 빠진다.
- `vercel.json` headers 에 `/planner-sw.js` → `Cache-Control: public, max-age=0, must-revalidate`.
- **오프라인 편집은 지원하지 않는다(읽기 전용).** 네트워크 실패 시 목록 모드 + "오프라인 저장본" 배지.
- 부수 확인(별건): `public/sw.js` 는 죽은 코드인데 dist·android assets 에 계속 실려 나가고, `index.html:9` 이 `manifest.json` 을 링크해 PWA 설치를 광고하지만 활성 SW 가 없어 설치 프롬프트 조건을 못 채운다.

### 7.2 내보내기
JSON(스냅샷 그대로) / ICS(`ics` 패키지, 핀=이벤트) / 인쇄용 화면(@media print, 브라우저 PDF 저장). '무료' 표기 없음.
- **ICS 타임존 주의** (codex-23 별건): `ics@3.12.0` 은 기본 출력이 local→UTC 라 여행 타임존과 어긋난다. `start` 를 UTC 배열로 넘기거나 `startInputType:'local'` 을 지정하고, **시차 있는 여행 1건으로 vitest 케이스를 둔다**(§3 `timezone` 사용).

---

## 8. 디자인 규격 (가전딜 실측 토큰)
버튼 primary `rounded-sm bg-primary text-on-primary font-medium hover:bg-primary-active` / secondary `border border-hairline hover:bg-surface-soft` / 카드 `rounded-md border border-hairline hover:shadow-card` / 입력 `rounded-sm border-hairline focus:border-ink` / 바텀시트 `rounded-t-[14px] shadow-card` z-70, 모달 z-80 / 빈 상태 한 줄 "…이 없습니다." / 배지 `rounded-full text-xs font-semibold` / 별점은 잉크색 / 이모지 금지, lucide만 / 호버는 색·그림자 전환만. 모바일 하단 액션바 `pb-[env(safe-area-inset-bottom)]`.
- 드래그 정렬은 framer-motion `Reorder`(12.27.0 export 실측 확인). **키보드 대안(위/아래 이동 버튼)을 함께 제공**한다 (codex-26 D5).
- 버튼 테두리는 §1.3(c) 의 `:where(.ct-planner) button { border: 0 solid currentColor }` 로 잡는다. 플래너 안에서 `border-*` 유틸리티가 정상 동작해야 한다.

---

## 9. 서버리스·환경변수
- `api/planner/_common.js`(applyCors → 405 → PLANNER_ENABLED 404 → env → JWT getUser → 사용자별 레이트리밋 RPC → 응답 규격). 함수 3개: `places.js`, `routes.js`, `extract-links.js`. **URL 가드는 `_url-guard.js` 로 분리**하고 `extract-links.js` 는 `guardedGet()` 만 쓴다 (codex-14).
- 외부 제공자 페이싱은 함수 내부가 아니라 **DB 전역 게이트**를 통과한다 (agy-6, codex-13).
- env: 서버 `GOOGLE_MAPS_SERVER_KEY`(없으면 OSM), `PLANNER_ENABLED`; 클라 `VITE_PLANNER_ENABLED`, `VITE_GOOGLE_MAPS_BROWSER_KEY`. 단 **제공자 선택의 SSOT 는 `planner_settings.google_maps_enabled`** 이고 env 는 키 공급 역할만 한다 (agy-7). `.env.app` 에는 `VITE_PLANNER_ENABLED=false` 고정.
- 의존성 추가(전부 무료): `leaflet`, `@vis.gl/react-google-maps`(키 있을 때만 로드), `@zxing/browser` **+ `@zxing/library@^0.23.0`(peer, 명시 설치)**, `pdfjs-dist`, `idb`, `ics`, `vitest`(dev). `tesseract.js` 는 지연 로드. manualChunks 에 넣는 건 `leaflet`·`idb`·`ics` 셋뿐 (codex-23, codex-15).
- 서비스워커는 라이브러리 없이 직접 작성(workbox·vite-plugin-pwa 미도입) (agy-2).

---

## 10. 법무·문서 동시 수정
Privacy 1조 수집항목(티켓 파일·장소 검색어), 3조 위탁·4조 국외이전(Google LLC 미국: 지도·장소·경로 / OpenStreetMap Foundation: 지도·장소 검색), 6조 보유(탈퇴 시 삭제 + **기기 로컬 사본은 세션 종료·만료 시 자동 삭제** §5.4). Terms 2조에 "여행 일정 작성·공유". ConsentBox 불릿 + policy_version 날짜. 위치정보는 수집하지 않으므로 위치기반서비스 신고 불필요(1차).

---

## 11. 구현 순서·검증

### 11.1 구현 순서
| # | 작업 | 완료 판정 |
|---|---|---|
| 1 | SQL 적용(`planner_20260904.sql` + `patches_sql.md` 반영본) | 게이트 A 통과 |
| 2 | 셸 배선: `featureFlags.PLANNER_ENABLED` / `vite.config.js` 함수형+alias / `planner.disabled.jsx` / `.env.app` / App.jsx 삼항 lazy / `planner.css` / tailwind 토큰 | `npm run build`·`npm run app:build` 양쪽 성공 + 게이트 D1 통과 |
| 3 | `/planner/__kit` 컴포넌트 킷 | 390/1280 캡처 2장, 버튼 테두리 0px 육안 확인 (codex-25) |
| 4 | 여행 목록·만들기·일정판(OSM)·핀 시트·정렬·이동시간(estimate)·기간변경 확인 다이얼로그 | agy-12 왕복 1회, `legs` 지문 불일치 시 "재계산 필요" 표시 (codex-10) |
| 5 | 티켓 지갑: 업로드 → pdf.js 자산·워커 → 판독 draft → 확인 시트 → 전체화면(원본) | 게이트 D2·D3, codex-15 vitest 4케이스 |
| 6 | 후기(`planner_submit_review`) | 방문 미인증 거부 1회 |
| 7 | 링크로 담기 + `_url-guard.js` | 게이트 B4, codex-14 vitest 케이스 전량 |
| 8 | 동선 검사(정규화 파서 + 경고 4종 + 가정값 칩) | vitest 8케이스 (codex-17) |
| 9 | 공유·오프라인(SW + offlineStore)·내보내기(ICS 타임존) | 게이트 B2·C1·D4, agy-2 오프라인 새로고침 |
| 10 | 게시판 `/itinerary` + 가져오기(앱은 RPC 직호출) + 등록 지점 11곳 + `next` 복귀 + 스크롤 복원 | 게이트 E 전량 |
| 11 | SEO 표면(`ROBOTS_DISALLOW` SSOT + `check-seo-surfaces.mjs`) + 법무 문구 | `npm run build` 가 검사 통과 (codex-22) |
| 12 | 게이트 A~F 전량 통과 → 쿠마님 push → Vercel 확인 → 라이브 E2E(테스트 계정 3종) → 보고 | — |

### 11.2 검증 게이트 (전부 통과해야 12단계 진입) (codex-26)

**게이트 A — DB 권한 회귀 (1단계 직후, SQL 적용 전/후 각 1회)**
- A1. 적용 전/후 권한 덤프 diff = 0(신규 `planner_*` 만 증가). 이 SQL 은 운영 함수 `toggle_post_like`·`add_keyword_notification` 을 `CREATE OR REPLACE` 하고 `post_likes` CHECK 를 DROP 후 재정의하므로 필수다.
  `SELECT p.proname, p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1;`
  `SELECT relname, relrowsecurity, relacl FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY 1;`
  `SELECT schemaname, tablename, policyname, roles, cmd FROM pg_policies WHERE schemaname IN ('public','storage') ORDER BY 1,2,3;`
- A2. 기존 좋아요 5종(destinations/reviews/qna_posts/companion_posts/crew_posts) toggle 왕복 정상 + **crew_posts 포인트 적립만** 발생. 삭제된 글 id 로 좋아요 시도 → 거부 (codex-21).
- A3. 타 사용자 FK 교차: A 의 trip_id 로 B 가 days/places/tickets/shares/itinerary_posts INSERT → 전부 `trip owner mismatch`. A 의 day_id 를 B 의 trip 에 물린 place → `day not in trip`. 타 trip 의 place_id 를 물린 ticket → `place not in trip`.
- A4. `storage_path` 위조: `<타인uid>/…`, `…/../…`, 접두 없는 경로, **3조각이 아닌 경로** INSERT → 전부 거부 (codex-7).
- A5. 롤백 트랜잭션 시나리오(§2 개정): 타인 trip SELECT 0건 / **anon catalog SELECT 42501 + 타인 핀만 연결된 카탈로그 행 SELECT 0건**(codex-2) / `visited_at` 없는 후기 거부 / 토큰 오입력 NULL / 스냅샷에 티켓·비공개 메모 없음 / 가져오기 후 원본 무변경 / `planner_days.date` 임의 PATCH 거부(codex-8) / `day_index` 상한 초과 INSERT 거부(codex-4).

**게이트 B — 자원·남용 (anon 경로 우선)**
- B1. `planner_get_shared`·`planner_bump_post_view` 는 anon GRANT 다. anon 토큰으로 각 200회 연속 호출해 응답시간·DB CPU 기록. `get_shared` 는 호출마다 `planner_build_snapshot` 전체를 재조립하므로 증폭 배수를 측정한다. `planner_rate_hit` 은 service_role 전용이라 이 두 경로에 안 걸린다는 사실을 문서에 명시하고, 초과 시 codex-6 의 trip_id 키 인-DB 리밋 또는 서버리스 프록시 경유로 전환한다.
- B2. 공유 토큰 회전·폐기: `create_share` 2회 → 1차 토큰 `get_shared` NULL, 2차만 정상. revoke 후 NULL. 만료(`expires_at`) 없음이 의도된 상태임을 문서에 한 줄 남긴다.
- B3. Nominatim 전역 페이싱: 동시 10요청을 서로 다른 서버리스 인스턴스로 유도해 **실제 초당 요청 수를 측정**. 1 req/s 를 못 지키면 캐시 우선·큐잉으로 바꾼다 (agy-6, codex-13).
- B4. SSRF: IPv6 사설(`[::1]`,`[fd00::1]`), IPv4-mapped(`::ffff:127.0.0.1`), 링크로컬 `169.254.169.254`, DNS rebinding(공인→사설 재해석), **허용 호스트 → 사설IP 리다이렉트 체인**(2번째 홉에서 차단되는지), `https://blog.naver.com@evil.example`, `https://blog.naver.com:8443`, `http://blog.naver.com`, `https://www.google.com/url?q=`, `https://evil.tistory.com.attacker.io`, 200MB 응답 스트림 → 전부 차단 (codex-14).

**게이트 C — 데이터 수명·정리**
- C1. 티켓 삭제 / 여행 삭제 / 회원 탈퇴 3경로 각각에서 `planner_tickets` 행과 `storage.objects` 객체가 **둘 다** 사라지는지. 프런트 삭제 순서(스토리지 먼저 → 행) + `planner_orphan_objects` 큐 소비 확인 (agy-4).
- C2. 카탈로그 계보: google 행과 osm 행이 같은 장소여도 별도 행 유지, `canonical_id` 로 후기가 대표 행에 모이는지, 구글 필드가 OSM 지도에 표시되지 않는지 (agy-5, codex-12, agy-7).
- C3. 링크·경로 캐시 24h/30일 만료 후 재조회. `fetched_at` 30일 재조회 미구현은 별건으로 기록 (codex-2 §7).

**게이트 D — 클라이언트 실환경**
- D1. **앱 번들 청크 부재.** `npm run app:build` 후 `ls dist/assets | grep -i planner` → 스텁 외 0건, `grep -ril "leaflet\|pdfjs\|zxing" dist/assets` → 0건. 반대로 `VITE_PLANNER_ENABLED=true npm run build` → planner 청크·`planner-vendor` 청크 존재. **삼항 lazy 가드 + alias 스텁 + `.env.app` 3개가 모두 들어갔는지 코드로 확인**한다 — 라우트만 `&&` 로 가리면 청크가 남는다(Points 선례) (codex-19, agy-11).
- D2. 티켓 판독: 암호화 PDF / 손상 PDF / 100쪽 PDF / 3MB 사진 5장 연속을 저사양 안드로이드(2GB급)에서 → 크래시 없이 "날짜 수동 선택" 폴백.
- D3. BCBP·날짜: 연중일자 3자리로 12/31 출발·1/1 도착, 윤년 366일, 해를 넘기는 여행 → 날짜가 기간 밖으로 튀지 않음. 왕복 e티켓 → 후보 2개·자동확정 없음. `03/04/2026` → `ambiguous=true`. 한국어 e티켓 CJK 텍스트 추출이 빈 문자열이 아님(CMap 자산 없으면 실패하도록) (codex-15).
- D4. IndexedDB: quota 초과 시 앱 정상 + "저장 공간 부족" 배지 / 같은 브라우저에서 계정 2개 전환 시 A 스냅샷이 B 에 안 보임 / 로그아웃·**토큰 만료** 후 잔여 레코드 0 / 여행·티켓 삭제 시 해당 레코드만 사라짐 / 티켓 토글 기본 꺼짐 (codex-18).
- D5. 오프라인 콜드스타트: DevTools Network offline 에서 `/planner/t/<id>` **새로고침** → 일정판·티켓 원본 렌더. 온라인 복귀 후 재배포 → 새 번들 즉시 반영(스테일 회귀 검사) (agy-2).
- D6. 접근성: 드래그 정렬의 키보드 대안 동작, 바텀시트 focus trap + Esc, 지도 로드 실패 시 목록만으로 전 기능 조작.

**게이트 E — 기존 기능 회귀**
- E1. 키워드 알림: DevTools Network 에서 폴링 URL 이 `itinerary_posts?select=id,created_at,title,content,author_name,country` 로 찍히고 **응답 본문에 `snapshot` 문자열 0건**. `.select('*')` 잔존 금지. 다른 5개 보드 결과 수 불변. 제목/본문 키워드 → 토스트 + 종 알림 + 링크가 `/itinerary/<id>` (codex-20, agy-8).
- E2. 등록 지점 11곳(§1.2)을 각각 화면에서 1회씩 눌러 확인 — 누락해도 컴파일 에러가 안 난다.
- E3. 전역 CSS 회귀: 기존 3페이지 + 로그인·마이페이지 캡처 비교, `.ct-planner` 밖 h1/button 스타일 무변화.
- E4. 로그인 복귀: `next` 로 복귀 1회 / 앱 외부 브라우저(세션 없음) 1회 / `next=//evil.com`·`https://evil.com` → 홈으로 / 기존 LoginPrompt 6개 호출부는 여전히 `/` (agy-14).
- E5. 앱 가져오기: 앱 게시판 → 가져오기 → 안내 토스트 → 다른 기기 웹에서 로그인 → `/planner` 목록에 이미 있음(유실 0건) (agy-9).
- E6. 스크롤 복원: `/itinerary` 목록 스크롤 → 상세 진입 → 뒤로 = 위치 복원. 화이트리스트 밖 라우트는 종전대로 top 리셋 (agy-15).
- E7. SEO 표면: `npm run build` 가 `check-seo-surfaces.mjs` 를 통과. robots ↔ `ROBOTS_DISALLOW` 일치, sitemap 에 `/planner`·`/itinerary` 존재, 공유 보기 `noindex` (codex-22).

**게이트 F — 공통**
lint · build(웹/앱 양쪽) · vitest 전량 · Playwright 390/1280 캡처 · `grep -rn "무료" src/ api/` 0건 · 기존 3페이지 회귀 캡처.

---

## 12. 반려 목록 (반영하지 않음)

| id | 지적 | 반려 근거 |
|---|---|---|
| agy-1 | `likes_count` 컬럼이 없다 | 전제가 거짓. 코드베이스는 그 컬럼을 쓰지 않는다 |
| agy-3 | 카탈로그 오염(임의 upsert) | 이미 방어됨 — `planner_upsert_catalog` 가 값 검증·길이 제한·필드 화이트리스트를 건다 |
| agy-10 | 블라인드 컬럼 부재 | 기존 게시판에도 없다. 플래너만 다른 정책을 두면 일관성이 깨진다 |
| agy-11(원인 진단) | 조건부 manualChunks 로 앱 번들 오염을 막아야 한다 | 인과가 실측과 다름 — 객체형 manualChunks 에 미사용 패키지를 넣으면 **1바이트 빈 청크 + 경고**일 뿐 라이브러리가 딸려오지 않는다. **단 이 판정이 발견한 진짜 결함(최상위 lazy → 청크 잔존)은 §1.3(a)에 반영** |
| codex-1 | 교차 소유권 검증 없음 | 이미 트리거로 해결 |
| codex-3 | 게시물 CASCADE 를 바꿔야 한다 | 설계 의도 오독. 제안대로 하면 삭제가 예외로 실패한다 |
| codex-24 | 트리거 대상이 명시돼 있지 않다 | 이미 명시돼 있다 |
| codex-15(일부) | BCBP 에 연도가 없어 날짜 확정 불가 | 여행 기간 최대 61일 CHECK 로 연중일자가 창 안에서 유일하게 결정된다(v1 이미 해결) |
| codex-15(일부) | CSP 설계 누락 | `vercel.json`·`index.html` 어디에도 CSP 자체가 없어 worker/blob 를 막을 정책이 없다. 이 기능의 위험 요인이 아님 |
| codex-16(일부) | PDF417/Aztec writer 를 **모두** 안 준다 | Aztec 은 `AztecCodeWriter` 가 실재한다. 다만 임의 픽셀 크기에서 예외가 나 실무상 못 쓰므로 **결론(QR 한정)은 채택** |
| codex-17(일부) | 여행 타임존을 표현하지 못한다 | 비교가 전부 현지 벽시계끼리라 변환이 필요 없다. 실재 위험은 `new Date('YYYY-MM-DD').getDay()` 하나뿐이며 §6 에 명시 |
| codex-17(일부) | 공휴일 반영 | 계획 시점 데이터를 어느 제공자에서도 못 얻는다. 반영 대상이 아니라 **고지 대상**(§6 칩) |
| codex-18(일부) | 계정별 IndexedDB 분리 | Firefox 가 `indexedDB.databases()` 미지원이라 고아 DB 회수가 불가능해진다. 단일 DB + 소유자 복합키가 안전 |
| codex-18(일부) | 1차 로컬 암호화 | 키가 같은 브라우저에 남는 이상 동일 출처 JS 에는 무의미. opt-in·TTL·purge 정착 후 P2 |
| codex-18(일부) | 탈퇴 이벤트에서 삭제 | 클라이언트 탈퇴 플로우가 코드에 없다(`grep` 0건). 탈퇴는 세션 소실을 동반하므로 `purgeAll` 이 덮는다 |
| codex-23(일부) | `@zxing/library` 를 따로 넣지 말라 | 반대다 — peerDependency 라 반드시 명시 설치해야 한다(v1 표기가 정확) |
| codex-23(일부) | `@vis.gl/react-google-maps` React 19 peer CI 검증 | peer 가 `>=16.8.0 || ^19.0` 이라 충돌 없음 |
| codex-14(일부) | 응답 크기 제한·IP 대역 차단이 없다 | v1 에 "본문 1MB"·"DNS 사설대역 거부"가 이미 있다. **실제 갭(홉별 재검증·IP 핀닝·content-type·포트/literal/userinfo)만 §4 에 반영** |
| codex-8/9/4/11(일부) | 파생 컬럼·상한·스냅샷 버전 등 다수 | SQL 초안이 이미 해결(60일 CHECK, 200개 상한, 스냅샷 `v`, 보관함 포함, `c=c+1` 원자 UPDATE 등) |
| agy-5/codex-12(일부) | 별도 canonical 테이블 + 좌표 유사도 매칭 | 후기 행 이동을 가드가 무조건 차단하고 되돌리기도 어렵다. **자기참조 `canonical_id` 로 축소 채택** |
| agy-8(일부) | 폴링 `select` 에서 `author_name` 제외 | 기존 5개 보드가 전부 `author_name` 을 매칭 대상으로 삼고 있어 제외하면 보드별 범위가 갈라진다. 오탐이 관측되면 `KEYWORD_SKIP_FIELDS` 에 전역 추가(P3) |
| agy-8(일부) | `snapshot` 을 별도 테이블로 분리 | Postgres 가 큰 jsonb 를 이미 TOAST 로 행 밖에 저장한다. 컬럼 지정만으로 전송 비용이 사라지고, 상세 페이지는 어차피 조인이 강제된다 |
| agy-9(일부) | 앱→브라우저 토큰 전달 / 웹뷰 세션 핸드오프 | refresh 토큰이 URL·히스토리·서버 로그에 남는 계정 탈취 경로. Custom Tabs 는 앱 WebView(`https://localhost`) 저장소를 물려받지 않고, `allowNavigation` 에 자사 도메인을 넣으면 origin 이 섞여 더 나쁘다. **브라우저 경유 자체를 없애는 쪽으로 해결**(§1.2) |
| codex-26(일부) | 16종 검증 항목 전량 | view/import count 동시성(원자 UPDATE), 1MB 제한, 61일 상한, reorder 수천 건(200개 상한)은 이미 방어됨 |
| codex-26(일부) | §1.3 을 정적 import 로 고치라 | 플래너는 덩치가 커서 정적 import 시 웹 초기 번들에 통째로 붙는다. **삼항 lazy 가드 + alias 스텁**이 두 요구를 모두 만족(§1.3(a)) |
| codex-25(일부) | `.ct-planner` 스코프를 좁히면 된다 | 스코프를 좁혀도 `border-width:medium` 이 살아난다. 3개 롱핸드를 `:where()` 로 복구해야 한다 |

### 별건으로 뺀 것 (플래너 1차에 묶지 않음)
- `src/index.css:86 button { border: none }` 삭제 — 전역 CSS 라 회귀 캡처 필요. 고치면 현재 깨져 있는 `CommendationMatching.jsx:451/:486` 도 함께 정상화된다 (codex-25).
- `public/sw.js` 죽은 코드 제거 + `manifest.json` PWA 설치 프롬프트 불가 상태 (agy-2).
- `images` 버킷 정책 부재 (v1 §2 각주).
- `planner_catalog.fetched_at` 30일 만료·재조회 미구현 — 구글 키 도입 전 별건 (codex-2).

import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { sep } from 'node:path'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))

// planner-vendor 청크에 넣을 패키지.
// ⚠ 객체형 manualChunks 의 값은 Rollup 이 "엔트리 모듈"로 해석한다. 아직 설치하지 않은 패키지를
//   여기 적으면 경고가 아니라 하드 실패다(Could not resolve entry module "…").
//   지도(leaflet)·오프라인(idb)·내보내기(ics)를 실제로 package.json 에 넣은 뒤 그때 채운다.
//   pdfjs-dist·@zxing/browser 는 여기 넣지 않는다 — 티켓 지갑에서 await import() 로만 부르고
//   Rollup 자동 분할에 맡겨야 일정판 진입에 1MB+ 를 선로딩하지 않는다.
const PLANNER_VENDOR = []

// https://vite.dev/config/
// 함수형 config 인 이유: 웹 빌드와 앱 빌드(vite build --mode app)가 같은 파일을 공유하므로
// 모드별 env 를 읽어 플래너 포함 여부를 빌드 시점에 갈라야 한다.
export default defineConfig(({ mode }) => {
  // loadEnv 는 .env → .env.[mode] 순으로 읽고(뒤가 이김), 인라인 process.env 의 VITE_* 가 최우선이다.
  // envDir 은 실행 위치(cwd)가 아니라 이 설정 파일이 있는 폴더로 고정한다 —
  // 어느 디렉터리에서 실행해도 같은 .env 를 읽고, 브라우저 전역만 허용하는 eslint 설정에
  // process 전역을 새로 열지 않아도 된다.
  const env = loadEnv(mode, r('./'), 'VITE_')
  const plannerOn = env.VITE_PLANNER_ENABLED === 'true'

  return {
    plugins: [react()],
    resolve: {
      alias: {
        // 플래너 진입점을 빌드가 고른다.
        // OFF 면 스텁이 붙어 플래너 소스가 모듈 그래프에 아예 들어오지 못한다
        // (App.jsx 의 삼항 lazy 가드와 짝 — 라우트만 && 로 가리면 청크가 dist 에 남는다).
        '@planner': plannerOn
          ? r('./src/planner/index.jsx')
          : r('./src/planner/planner.disabled.jsx'),
        // 오프라인 저장 정리만 따로 가른다. AuthContext(앱 셸)가 부르는데, 플래너 진입점을
        // 통째로 물리면 웹에서도 로그인할 때마다 플래너 청크가 딸려 온다.
        '@planner-offline': plannerOn
          ? r('./src/planner/lib/offlineStore.js')
          : r('./src/planner/offline.disabled.js'),
      },
    },
    server: {
      port: 5173,
      host: true,
      allowedHosts: true
    },
    preview: {
      host: true,
      allowedHosts: true
    },
    build: {
      rollupOptions: {
        output: {
          // 플래너에서 갈라져 나온 dynamic import 청크는 파일명에 planner 를 박는다.
          // 진입 파일이 src/planner/index.jsx 라 그냥 두면 청크 이름이 index 가 되어
          // 앱 본체 index-*.js 와 섞이고, 번들 격리 검증 grep(ls dist/assets | grep planner)이 헛돈다.
          // ⚠ 이름만 바꾼다. manualChunks 에 플래너 진입점을 넣는 방식은 쓰지 않는다 —
          //   객체형 manualChunks 는 그 모듈의 의존 subtree(AuthContext·LoginPrompt·SEOHead)까지
          //   같은 청크로 끌고 와서, 앱 본체가 planner 청크를 정적 import 하게 된다(실측).
          //   앱 본체(entryFileNames)와 나머지 청크 이름 규칙은 그대로 둔다.
          //   청크에서 갈라져 나온 CSS 는 청크 이름을 따라가 index-*.css 로 나온다
          //   (assetFileNames 로는 출처를 가려낼 수 없다 — 실측).
          chunkFileNames: (chunk) => {
            const id = (chunk.facadeModuleId || '').split(sep).join('/');
            return id.includes('/src/planner/')
              ? 'assets/planner-[hash].js'
              : 'assets/[name]-[hash].js';
          },
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
            ui: ['framer-motion', 'lucide-react'],
            // 반드시 조건부. 무조건형으로 두면 플래너를 빼기로 한 앱 빌드까지 오염된다.
            ...(plannerOn && PLANNER_VENDOR.length > 0
              ? { 'planner-vendor': PLANNER_VENDOR }
              : {}),
          },
        },
      },
    },
    appType: 'spa'
  }
})

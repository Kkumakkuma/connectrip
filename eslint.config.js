import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // android = Capacitor 네이티브 산출물(웹 번들 사본 포함) — 린트 대상 아님
  globalIgnores(['dist', 'android']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // motion: framer-motion이 <motion.div>로 JSX에서 실사용되지만 react 플러그인(jsx-uses-vars)
      // 없이는 core no-unused-vars가 오탐 — import 제거 시 런타임 크래시이므로 예외 처리
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]|^motion$' }],
      // 게시판 서식 글(2026-09-26 서식 편집기 1단계, 설계 plan_v3 5-1·6-5·12-4):
      //  - HTML 문자열을 화면에 꽂지 않는다(서식 글은 RichBody 가 대응표로만 React 요소를 만든다).
      //  - DOMParser 는 쓰지 않는다 — 비활성 문서라도 iframe·img 자원을 내려받을 수 있다(MDN). 붙여넣기 HTML 해석은
      //    <template> 조각에서만 한다.
      //  - PDF 안 자바스크립트는 pdf.js 의 뷰어 계층(web/*, pdf.sandbox)에서만 실행된다 — 그 계층을 들여오지 않는다.
      'no-restricted-syntax': ['error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'dangerouslySetInnerHTML 금지 — 서식 글은 RichBody 로 그린다.' },
        { selector: "NewExpression[callee.name='DOMParser']", message: 'DOMParser 금지 — 자원을 내려받을 수 있다. <template> 조각을 쓴다.' },
        { selector: "NewExpression[callee.property.name='DOMParser']", message: 'DOMParser 금지 — 자원을 내려받을 수 있다. <template> 조각을 쓴다.' },
        { selector: "CallExpression[callee.property.name='parseFromString']", message: 'DOMParser.parseFromString 금지 — <template> 조각을 쓴다.' },
        // 동적 import() 는 no-restricted-imports 가 보지 않는다 — 같은 경로를 여기서 막는다(정규식의 . = 경로 구분자 /)
        { selector: 'ImportExpression[source.value=/pdfjs-dist.(legacy.)?web.|pdf\\.sandbox/]', message: 'pdf.js 뷰어·샌드박스 계층 금지 — 표시 API 만 쓴다.' },
      ],
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['pdfjs-dist/web/*', 'pdfjs-dist/legacy/web/*', 'pdfjs-dist/**/pdf.sandbox*', '**/pdf.sandbox*'], message: 'pdf.js 뷰어·샌드박스 계층 금지 — 표시 API(getDocument → page.render)만 쓴다. 주석 계층이 필요하면 enableScripting: false.' },
        ],
      }],
    },
  },
  {
    // Vercel Serverless 함수는 Node 환경 (process 등)
    files: ['api/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Service Worker 전역 (clients, self 등)
    files: ['public/sw.js'],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
])

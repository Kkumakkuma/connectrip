/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Pretendard Variable', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'Roboto', 'Apple SD Gothic Neo', 'Malgun Gothic', 'sans-serif'],
            },
            // ── 플래너(/planner) 디자인 토큰 ──────────────────────────────────────────
            // 가전딜 tailwind.config.js 의 값을 그대로 가져왔다(에어비앤비풍 단일 액센트).
            // ⚠ 추가 키만 넣는다. 기존 커넥트림 화면이 쓰는 키(rounded-xl 148곳 등)를 재정의하면
            //   플래너와 무관한 화면이 통째로 틀어진다. rounded-sm·rounded-md 는 현재 사용처가
            //   0건이라 재정의해도 회귀가 없다(실측). 색 이름은 전부 Tailwind 기본에 없는 신규 키다.
            colors: {
                // 단일 브랜드 액센트
                primary: {
                    DEFAULT: '#1A56DB',
                    active: '#1542A8',
                    disabled: '#BBD0F5',
                },
                canvas: '#ffffff',
                'surface-soft': '#f7f7f7',
                'surface-strong': '#f2f2f2',
                hairline: {
                    DEFAULT: '#dddddd',
                    soft: '#ebebeb',
                },
                ink: '#222222',
                body: '#3f3f3f',
                muted: {
                    DEFAULT: '#6a6a6a',
                    soft: '#929292',
                },
                'on-primary': '#ffffff',
                success: '#1A8754',
                warning: '#B45309',
                error: {
                    DEFAULT: '#C13515',
                    hover: '#B32505',
                },
            },
            borderRadius: {
                // {rounded.sm}=8px, {rounded.md}=14px. xl(32px)은 가져오지 않는다 — 커넥트립이 이미 쓴다.
                sm: '8px',
                md: '14px',
            },
            boxShadow: {
                // 시스템 유일 그림자 1단계
                card: 'rgba(0,0,0,0.02) 0 0 0 1px, rgba(0,0,0,0.04) 0 2px 6px 0, rgba(0,0,0,0.1) 0 4px 8px 0',
            },
            maxWidth: {
                content: '1120px',
                listing: '1080px',
            },
        },
    },
    plugins: [],
}

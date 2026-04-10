---
description: Start development server with public access (localtunnel)
---
1. 포트 충돌 방지를 위해 기존 Node 프로세스를 정리합니다.
    ```powershell
    Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
    ```

2. 개발 서버를 실행합니다. (로컬 5173 포트 고정)
    ```powershell
    npm run dev
    ```

3. 접속 정보를 확인합니다.
    - 로컬 접속: http://localhost:5173


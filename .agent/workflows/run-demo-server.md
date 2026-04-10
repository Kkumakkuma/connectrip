---
description: Build and start external demo server with Cloudflare tunnel
---
1. 포트 충돌 방지를 위해 기존 Node 및 Cloudflare 프로세스를 정리합니다.
   ```powershell
   Get-Process node, cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
   ```

2. 프로젝트를 최적화하여 빌드합니다.
   ```powershell
   npm run build
   ```

3. 미리보기 서버를 실행합니다. (127.0.0.1 바인딩으로 안정성 확보)
   ```powershell
   npm run preview -- --port 4173 --host 127.0.0.1
   ```

4. 외부 접속을 위한 터널링을 실행합니다. (Cloudflare Tunnel 사용)
   // Wait 5000ms
   ```powershell
   npx cloudflared tunnel --url http://127.0.0.1:4173
   ```


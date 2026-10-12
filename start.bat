@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js fehlt. Bitte von https://nodejs.org installieren ^(LTS^) und nochmals starten.
  pause
  exit /b 1
)
if not exist dist\server.cjs (
  echo dist\server.cjs fehlt. Bitte zuerst "pnpm install" und "pnpm build" ausfuehren.
  pause
  exit /b 1
)
node dist\server.cjs
pause

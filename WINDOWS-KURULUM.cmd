@echo off
setlocal
cd /d "%~dp0"
echo Afilli - dependency installation and TypeScript checks
echo No Android build or GitHub upload will be started.
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js LTS and try again.
  pause
  exit /b 1
)
where npx >nul 2>nul
if errorlevel 1 (
  echo npx was not found. Check your Node.js installation.
  pause
  exit /b 1
)
call npx --yes pnpm@10.26.1 install --frozen-lockfile
if errorlevel 1 goto failed
call npx --yes pnpm@10.26.1 run typecheck
if errorlevel 1 goto failed
call npx --yes pnpm@10.26.1 --filter @workspace/api-server run typecheck
if errorlevel 1 goto failed
echo.
echo Installation and TypeScript checks completed.
echo This does not create an AAB or APK file.
pause
exit /b 0
:failed
echo.
echo The operation failed. Keep this window open and share the error above.
pause
exit /b 1

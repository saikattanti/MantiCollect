@echo off
setlocal

:: Check if node is available in PATH
where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
  node "%~dp0manticollect_host.js" %*
  exit /b %ERRORLEVEL%
)

:: Node is not in PATH. Fall back to MantiCollect's bundled Electron runtime.
set "ELECTRON_RUN_AS_NODE=1"

:: Check packaged app installation paths
if exist "%~dp0..\MantiCollect.exe" (
  "%~dp0..\MantiCollect.exe" "%~dp0manticollect_host.js" %*
  exit /b %ERRORLEVEL%
)
if exist "%~dp0..\..\MantiCollect.exe" (
  "%~dp0..\..\MantiCollect.exe" "%~dp0manticollect_host.js" %*
  exit /b %ERRORLEVEL%
)
if exist "%LOCALAPPDATA%\Programs\MantiCollect\MantiCollect.exe" (
  "%LOCALAPPDATA%\Programs\MantiCollect\MantiCollect.exe" "%~dp0manticollect_host.js" %*
  exit /b %ERRORLEVEL%
)

:: Check development fallback
if exist "%~dp0..\node_modules\electron\dist\electron.exe" (
  "%~dp0..\node_modules\electron\dist\electron.exe" "%~dp0manticollect_host.js" %*
  exit /b %ERRORLEVEL%
)

echo [MantiCollect Host] Error: Neither Node.js nor MantiCollect executable was found. >&2
exit /b 1


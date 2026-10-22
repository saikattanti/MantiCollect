@echo off
setlocal
set "HOST_DIR=%~dp0"
set "CHROME_MANIFEST=%HOST_DIR%com.mantitup.manticollect.json"
set "EDGE_MANIFEST=%HOST_DIR%com.mantitup.manticollect.edge.json"

if not "%~1"=="" (
  echo Configuring extension origin for ID: %~1
  powershell -NoProfile -ExecutionPolicy Bypass -File "%HOST_DIR%register-host-windows.ps1" -ExtensionId "%~1"
  goto :done
)

echo Registering MantiCollect Native Messaging Host for Google Chrome...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.mantitup.manticollect" /ve /t REG_SZ /d "%CHROME_MANIFEST%" /f
if %ERRORLEVEL% equ 0 (
  echo Chrome registration: OK
) else (
  echo Chrome registration: FAILED
)

echo Registering MantiCollect Native Messaging Host for Microsoft Edge...
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.mantitup.manticollect" /ve /t REG_SZ /d "%EDGE_MANIFEST%" /f
if %ERRORLEVEL% equ 0 (
  echo Edge registration: OK
) else (
  echo Edge registration: FAILED
)

:done
echo Done.
endlocal


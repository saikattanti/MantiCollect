@echo off
setlocal
set "HOST_DIR=%~dp0"
set "CHROME_MANIFEST=%HOST_DIR%com.mantitup.manticollect.json"
set "EDGE_MANIFEST=%HOST_DIR%com.mantitup.manticollect.edge.json"

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

echo Done.
endlocal

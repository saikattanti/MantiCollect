@echo off
setlocal
echo Unregistering MantiCollect Native Messaging Host...
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.mantitup.manticollect" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.mantitup.manticollect" /f >nul 2>&1
echo Done.
endlocal

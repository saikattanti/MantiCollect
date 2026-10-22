# MantiCollect Native Messaging Host Unregistration for Windows PowerShell
$ErrorActionPreference = "Continue"

Write-Host "Unregistering MantiCollect Native Host..." -ForegroundColor Cyan

$chromeKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.mantitup.manticollect"
if (Test-Path $chromeKey) {
    Remove-Item -Path $chromeKey -Recurse -Force
    Write-Host "  Chrome key removed." -ForegroundColor Green
} else {
    Write-Host "  Chrome key not found (already clean)." -ForegroundColor Gray
}

$edgeKey = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.mantitup.manticollect"
if (Test-Path $edgeKey) {
    Remove-Item -Path $edgeKey -Recurse -Force
    Write-Host "  Edge key removed." -ForegroundColor Green
} else {
    Write-Host "  Edge key not found (already clean)." -ForegroundColor Gray
}

Write-Host "Unregistration completed." -ForegroundColor Cyan

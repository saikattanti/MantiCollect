# MantiCollect Native Messaging Host Registration for Windows PowerShell
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$chromeManifest = Join-Path $scriptDir "com.mantitup.manticollect.json"
$edgeManifest = Join-Path $scriptDir "com.mantitup.manticollect.edge.json"

Write-Host "Registering MantiCollect Native Host..." -ForegroundColor Cyan

# Chrome Key
$chromeKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.mantitup.manticollect"
if (-not (Test-Path $chromeKey)) {
    New-Item -Path $chromeKey -Force | Out-Null
}
Set-ItemProperty -Path $chromeKey -Name "(Default)" -Value $chromeManifest
Write-Host "  Chrome registration: OK ($chromeManifest)" -ForegroundColor Green

# Edge Key
$edgeKey = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.mantitup.manticollect"
if (-not (Test-Path $edgeKey)) {
    New-Item -Path $edgeKey -Force | Out-Null
}
Set-ItemProperty -Path $edgeKey -Name "(Default)" -Value $edgeManifest
Write-Host "  Edge registration: OK ($edgeManifest)" -ForegroundColor Green

Write-Host "Registration completed successfully." -ForegroundColor Cyan

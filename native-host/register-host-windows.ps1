param(
    [Parameter(Mandatory=$false)]
    [string]$ExtensionId
)

# MantiCollect Native Messaging Host Registration for Windows PowerShell
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$chromeManifest = Join-Path $scriptDir "com.mantitup.manticollect.json"
$edgeManifest = Join-Path $scriptDir "com.mantitup.manticollect.edge.json"

Write-Host "Registering MantiCollect Native Host..." -ForegroundColor Cyan

# Update allowed_origins in manifests if an extension ID was passed
if ($ExtensionId -and $ExtensionId.Trim() -ne "") {
    $cleanId = $ExtensionId.Trim()
    if ($cleanId -match '^[a-zA-Z0-9_-]{16,64}$') {
        Write-Host "Configuring extension origin for ID: $cleanId" -ForegroundColor Yellow

        if (Test-Path $chromeManifest) {
            $chromeJson = Get-Content $chromeManifest -Raw | ConvertFrom-Json
            $chromeJson.allowed_origins = @("chrome-extension://$cleanId/")
            $chromeJson | ConvertTo-Json -Depth 5 | Set-Content $chromeManifest -Encoding UTF8
            Write-Host "  Updated Chrome manifest allowed_origins: chrome-extension://$cleanId/" -ForegroundColor Green
        }

        if (Test-Path $edgeManifest) {
            $edgeJson = Get-Content $edgeManifest -Raw | ConvertFrom-Json
            $edgeJson.allowed_origins = @("extension://$cleanId/")
            $edgeJson | ConvertTo-Json -Depth 5 | Set-Content $edgeManifest -Encoding UTF8
            Write-Host "  Updated Edge manifest allowed_origins: extension://$cleanId/" -ForegroundColor Green
        }
    } else {
        Write-Warning "Supplied extension ID '$ExtensionId' did not match expected format. Proceeding with existing manifest origins."
    }
} else {
    Write-Host "Tip: To automatically register your specific browser extension ID, run:" -ForegroundColor Gray
    Write-Host "     .\register-host-windows.ps1 -ExtensionId <YOUR_EXTENSION_ID>" -ForegroundColor Gray
}

# Chrome Key (HKCU - no elevation required)
$chromeKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.mantitup.manticollect"
if (-not (Test-Path $chromeKey)) {
    New-Item -Path $chromeKey -Force | Out-Null
}
Set-ItemProperty -Path $chromeKey -Name "(Default)" -Value $chromeManifest
Write-Host "  Chrome registration: OK ($chromeManifest)" -ForegroundColor Green

# Edge Key (HKCU - no elevation required)
$edgeKey = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.mantitup.manticollect"
if (-not (Test-Path $edgeKey)) {
    New-Item -Path $edgeKey -Force | Out-Null
}
Set-ItemProperty -Path $edgeKey -Name "(Default)" -Value $edgeManifest
Write-Host "  Edge registration: OK ($edgeManifest)" -ForegroundColor Green

Write-Host "Registration completed successfully." -ForegroundColor Cyan


# Listing Lens installer for Windows (PowerShell).
# Downloads the latest packaged extension from GitHub Releases, unpacks it to a stable folder and opens
# Chrome's extensions page. Chrome does not allow silent installs outside the Web Store, so the last
# step (Developer mode + Load unpacked) is done by the user; the script prints exactly what to click.
# Usage: irm https://raw.githubusercontent.com/cryptotweezer/Microburbs_Hackathon/main/install/install.ps1 | iex
$ErrorActionPreference = "Stop"
$url = "https://github.com/cryptotweezer/Microburbs_Hackathon/releases/latest/download/listing-lens.zip"
$dest = Join-Path $env:LOCALAPPDATA "ListingLens"
$zip = Join-Path $env:TEMP "listing-lens.zip"

Write-Host "Downloading Listing Lens..."
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
Expand-Archive -Path $zip -DestinationPath $dest -Force
Remove-Item $zip
if (-not (Test-Path (Join-Path $dest "manifest.json"))) { throw "Download looks incomplete: manifest.json not found in $dest" }

Set-Clipboard -Value $dest
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chrome) { Start-Process $chrome "chrome://extensions" }
Start-Process explorer.exe $dest

Write-Host ""
Write-Host "Listing Lens is ready in $dest (path copied to your clipboard)." -ForegroundColor Green
Write-Host "In the Chrome tab that just opened:"
Write-Host "  1. Turn on 'Developer mode' (top right)."
Write-Host "  2. Click 'Load unpacked' and paste the path, or drag the folder onto the page."
Write-Host "Then open any City of Sydney listing on domain.com.au or realestate.com.au and click the Listing Lens icon."

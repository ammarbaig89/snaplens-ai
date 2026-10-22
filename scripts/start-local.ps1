$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$python = Join-Path $repo ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  throw "SnapLens virtual environment not found at $python. Create it and install the backend requirements first."
}

$runner = Join-Path $PSScriptRoot "run-local-service.ps1"
$shell = (Get-Process -Id $PID).Path

# Keep the Expo client's public URL aligned with this PC's current LAN address.
try {
  $lanAddress = Get-NetIPConfiguration -ErrorAction Stop |
    Where-Object { $_.NetAdapter.Status -eq "Up" -and $_.IPv4DefaultGateway } |
    ForEach-Object { $_.IPv4Address } |
    Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } |
    Select-Object -First 1 -ExpandProperty IPAddress
} catch {
  $lanAddress = $null
}
if ($lanAddress) {
  $mobileEnv = Join-Path $repo "mobile-app\.env"
  $apiUrl = "EXPO_PUBLIC_API_BASE_URL=http://${lanAddress}:8000"
  if (Test-Path $mobileEnv) {
    $lines = @(Get-Content $mobileEnv)
    if ($lines -match '^EXPO_PUBLIC_API_BASE_URL=') {
      $lines = @($lines | ForEach-Object { if ($_ -match '^EXPO_PUBLIC_API_BASE_URL=') { $apiUrl } else { $_ } })
    } else {
      $lines += $apiUrl
    }
    Set-Content -Path $mobileEnv -Value $lines -Encoding utf8
  } else {
    Set-Content -Path $mobileEnv -Value $apiUrl -Encoding utf8
  }
  Write-Host "Mobile Gateway address set to http://${lanAddress}:8000. Restart Expo after this script if it was already running."
} else {
  Write-Warning "Could not detect this PC's Wi-Fi/LAN IPv4 address. Check mobile-app/.env and set EXPO_PUBLIC_API_BASE_URL manually."
}

$services = @("vision", "retrieval", "orchestrator", "gateway")
foreach ($service in $services) {
  $quotedRunner = '"' + $runner + '"'
  Start-Process -FilePath $shell -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-File", $quotedRunner,
    "-Service", $service
  ) | Out-Null
  Start-Sleep -Milliseconds 500
}

Write-Host "Started the four SnapLens backend services in separate PowerShell windows."
Write-Host "Wait for startup, then check http://127.0.0.1:8000/health/ready on this PC."
Write-Host "Keep these service windows open while testing the mobile app."

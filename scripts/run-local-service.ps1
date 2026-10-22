param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("orchestrator", "vision", "retrieval", "gateway")]
  [string]$Service
)

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$python = Join-Path $repo ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  throw "SnapLens virtual environment not found at $python. Create it and install the backend requirements first."
}

$env:PYTHONPATH = $repo
switch ($Service) {
  "orchestrator" {
    $folder = "diagnostic-orchestrator"
    $port = 8001
    $env:VISION_SERVICE_URL = "http://127.0.0.1:8002"
    $env:RETRIEVAL_SERVICE_URL = "http://127.0.0.1:8003"
    $hostAddress = "127.0.0.1"
  }
  "vision" {
    $folder = "vision-service"
    $port = 8002
    $hostAddress = "127.0.0.1"
  }
  "retrieval" {
    $folder = "retrieval-service"
    $port = 8003
    $hostAddress = "127.0.0.1"
  }
  "gateway" {
    $folder = "api-gateway"
    $port = 8000
    $env:ORCHESTRATOR_URL = "http://127.0.0.1:8001"
    $hostAddress = "0.0.0.0"
  }
}

Set-Location (Join-Path $repo "services\$folder")
& $python -m uvicorn main:app --host $hostAddress --port $port

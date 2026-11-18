<#
.SYNOPSIS
  Post-Mine Sentinel developer tasks for Windows (PowerShell 5.1+).
.EXAMPLE
  .\scripts\dev.ps1 demo        # 3D console in offline demo mode
  .\scripts\dev.ps1 test        # run all locally available test suites
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet('setup', 'demo', 'test', 'data', 'train', 'api', 'up', 'down')]
    [string]$Task = 'demo'
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Py = Join-Path $Root '.venv\Scripts\python.exe'

function Invoke-Step([string]$Name, [scriptblock]$Body) {
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Body
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "$Name failed (exit $LASTEXITCODE)" }
}

switch ($Task) {
    'setup' {
        Invoke-Step 'Python venv' { python -m venv (Join-Path $Root '.venv'); & $Py -m pip install -q -e "$Root\ml[dev]" -e "$Root\services\api[dev]" paho-mqtt }
        Invoke-Step 'npm packages' { Push-Location "$Root\apps\command-center"; npm ci; Pop-Location }
    }
    'demo' {
        Push-Location "$Root\apps\command-center"; try { npm run dev } finally { Pop-Location }
    }
    'data' { Invoke-Step 'Validate register' { & $Py "$Root\data\scripts\build_mines.py" --as-of 2026 } }
    'train' {
        Invoke-Step 'Edge model' { & $Py "$Root\ml\scripts\train_edge.py" }
        Invoke-Step 'Risk calibration' { & $Py "$Root\ml\scripts\calibrate_risk.py" }
        Invoke-Step 'Mesh simulation' { & $Py "$Root\ml\scripts\run_netsim.py" }
    }
    'api' {
        Push-Location "$Root\services\api"
        try { $env:SENTINEL_DEMO_PASSWORD = 'Sentinel!Demo2026'; & $Py -m uvicorn app.main:app --reload --port 8000 } finally { Pop-Location }
    }
    'test' {
        Invoke-Step 'ML (pytest)' { Push-Location "$Root\ml"; & $Py -m pytest; Pop-Location }
        Invoke-Step 'API (pytest)' { Push-Location "$Root\services\api"; & $Py -m pytest; Pop-Location }
        Invoke-Step 'Case service (xUnit)' { Push-Location "$Root\services\case-service"; dotnet test; Pop-Location }
        Invoke-Step 'Console (lint, types, vitest)' { Push-Location "$Root\apps\command-center"; npm run lint; npm run typecheck; npm test; Pop-Location }
        if (Get-Command go -ErrorAction SilentlyContinue) {
            Invoke-Step 'Ingest (go test)' { Push-Location "$Root\services\ingest"; go test ./...; Pop-Location }
        } else { Write-Warning 'Go not installed: ingest tests run in CI' }
        if (Get-Command pio -ErrorAction SilentlyContinue) {
            Invoke-Step 'Firmware (pio test)' { Push-Location "$Root\firmware\spider-node"; pio test -e native; Pop-Location }
        } else { Write-Warning 'PlatformIO not installed: firmware tests run in CI' }
    }
    'up' {
        if (-not (Test-Path "$Root\infra\.env")) { Copy-Item "$Root\infra\.env.example" "$Root\infra\.env" }
        docker compose -f "$Root\infra\docker-compose.yml" --env-file "$Root\infra\.env" up --build -d
    }
    'down' { docker compose -f "$Root\infra\docker-compose.yml" --env-file "$Root\infra\.env" down }
}

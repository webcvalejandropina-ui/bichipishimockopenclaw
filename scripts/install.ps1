# Instalación en Windows (PowerShell): Docker Desktop con Compose v2.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Instala Docker Desktop: https://docs.docker.com/desktop/setup/install/windows-install/" -ForegroundColor Red
    exit 1
}

docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Necesitas «docker compose» (incluido en Docker Desktop reciente)." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Write-Host "Creado .env desde .env.example."
}

docker compose up --build -d
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Listo. UI: http://localhost:8080"
Write-Host "API:  http://localhost:3001/api/metrics"

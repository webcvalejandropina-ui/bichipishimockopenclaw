# Instalador Windows: lo ejecuta install.cmd con -ExecutionPolicy Bypass (sin bloqueos de politicas).
# Tambien puedes clic derecho -> "Ejecutar con PowerShell" si install.cmd falla.
$ErrorActionPreference = 'Continue'
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location -LiteralPath $Root

$Log = Join-Path $Root 'install-bichipishi-log.txt'
"=== Bichipishi $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -FilePath $Log -Encoding utf8
"Directorio: $Root" | Out-File -FilePath $Log -Append -Encoding utf8
"" | Out-File -FilePath $Log -Append -Encoding utf8

function Log-Append {
    param([string]$Text)
    $Text | Out-File -FilePath $Log -Append -Encoding utf8
}

Write-Host ""
Write-Host " ========================================"
Write-Host "  Bichipishi - arranque con Docker"
Write-Host " ========================================"
Write-Host ""
Write-Host " Si algo falla, abre este archivo y copia su contenido:"
Write-Host " $Log"
Write-Host ""

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    $msg = '[ERROR] No se encuentra el programa "docker" en el PATH.'
    Write-Host $msg
    Log-Append $msg
    Write-Host ' Instala Docker Desktop y REINICIA Windows si acabas de instalarlo.'
    Write-Host ' https://docs.docker.com/desktop/setup/install/windows-install/'
    Read-Host ' Pulsa Enter para cerrar'
    exit 1
}

# cmd /c para codigo de salida fiable en PowerShell 5.1
cmd /c "docker version >> `"$Log`" 2>&1"
cmd /c "docker info >> `"$Log`" 2>&1"
if ($LASTEXITCODE -ne 0) {
    Write-Host '[ERROR] Docker no responde (docker info fallo).'
    Write-Host ' Abre Docker Desktop desde el menu Inicio y espera 1-2 minutos a que arranque.'
    Write-Host " Detalle en: $Log"
    Read-Host ' Pulsa Enter para cerrar'
    exit 1
}

if (-not (Test-Path (Join-Path $Root '.env'))) {
    $ex = Join-Path $Root '.env.example'
    if (Test-Path $ex) {
        Copy-Item -LiteralPath $ex -Destination (Join-Path $Root '.env')
        Write-Host '[OK] Archivo .env creado desde .env.example'
        Log-Append 'Copiado .env.example -> .env'
    }
}

$useLegacy = $false
# PowerShell 5.1 a veces falla con "docker compose" como una sola linea; probamos con argumentos separados
$p = Start-Process -FilePath 'docker' -ArgumentList @('compose', 'version') -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) {
    if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
        $useLegacy = $true
        Log-Append 'Usando docker-compose (legado)'
    }
    else {
        $msg = '[ERROR] No funciona "docker compose".'
        Write-Host $msg
        Log-Append $msg
        Write-Host ' En Docker Desktop: Settings -> General -> activa "Use Docker Compose V2".'
        Write-Host ' Actualiza Docker Desktop si la opcion no aparece.'
        Read-Host ' Pulsa Enter para cerrar'
        exit 1
    }
}
else {
    Log-Append 'Usando docker compose (v2)'
}

Write-Host ''
Write-Host '[INFO] Construyendo e iniciando. La PRIMERA vez puede tardar 10-20 minutos.'
Write-Host '[INFO] No cierres esta ventana.'
Write-Host ''

if ($useLegacy) {
    docker-compose up --build -d 2>&1 | Tee-Object -FilePath $Log -Append
    $exitCode = $LASTEXITCODE
}
else {
    # Misma forma que "docker compose" en CMD; evita bugs de parsing en PowerShell
    & docker.exe @('compose', 'up', '--build', '-d') 2>&1 | Tee-Object -FilePath $Log -Append
    $exitCode = $LASTEXITCODE
}
Log-Append "Codigo salida: $exitCode"

if ($exitCode -ne 0) {
    Write-Host ''
    Write-Host '[ERROR] No se pudo completar. Ultimas lineas del log:'
    Write-Host ' ----------------------------------------'
    Get-Content $Log -Tail 45 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    Write-Host ' ----------------------------------------'
    Read-Host ' Pulsa Enter para cerrar'
    exit $exitCode
}

Write-Host ''
Write-Host ' ========================================'
Write-Host '  LISTO'
Write-Host ' ========================================'
Write-Host ''
Write-Host '  Abre el navegador en: http://localhost:8080'
Write-Host ''
Write-Host '  Para parar: parar.cmd o en terminal: docker compose down'
Write-Host ''
Read-Host ' Pulsa Enter para cerrar'

@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo.
echo  ========================================
echo   Bichipishi - arranque con Docker
echo  ========================================
echo.

where docker >nul 2>&1
if errorlevel 1 (
  echo [ERROR] No encuentro "docker".
  echo.
  echo  1) Instala Docker Desktop para Windows:
  echo     https://docs.docker.com/desktop/setup/install/windows-install/
  echo  2) Abre Docker Desktop y espera a que ponga "Running" / motor en marcha.
  echo  3) Vuelve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker esta instalado pero no responde.
  echo.
  echo  Abre Docker Desktop desde el menu Inicio y espera 1-2 minutos.
  echo  Luego ejecuta de nuevo install.cmd
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  if exist ".env.example" (
    copy /Y ".env.example" ".env" >nul
    echo [OK] Archivo .env creado desde .env.example
  )
)

echo [INFO] Construyendo e iniciando... La PRIMERA vez puede tardar varios minutos.
echo [INFO] No cierres esta ventana hasta que termine.
echo.

docker compose up --build -d
if errorlevel 1 (
  echo.
  echo [INFO] Probando "docker-compose" (version antigua)...
  docker-compose up --build -d
)

if errorlevel 1 (
  echo.
  echo [ERROR] No se pudo arrancar. Lee el mensaje rojo de arriba.
  echo         Comprueba que Docker Desktop este abierto y con suficiente RAM.
  echo.
  pause
  exit /b 1
)

echo.
echo  ========================================
echo   LISTO
echo  ========================================
echo.
echo  Abre el navegador en:
echo.
echo      http://localhost:8080
echo.
echo  Para parar: ejecuta parar.cmd o "docker compose down" en una terminal.
echo.
pause

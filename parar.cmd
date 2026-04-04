@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo Parando contenedores...
docker compose down
if errorlevel 1 docker-compose down

if errorlevel 1 (
  echo No se pudo ejecutar docker compose down.
  pause
  exit /b 1
)

echo Listo.
pause

@echo off
cd /d "%~dp0"
echo Parando contenedores...
docker compose down
if errorlevel 1 docker-compose down
if errorlevel 1 (
  echo No se pudo ejecutar docker compose down. Abre Docker Desktop e intentalo de nuevo.
)
echo Listo.
pause

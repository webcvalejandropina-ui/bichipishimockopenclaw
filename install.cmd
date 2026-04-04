@echo off
REM Llama a PowerShell SIN restriccion de scripts (Bypass). Asi no hace falta cambiar politicas del sistema.
cd /d "%~dp0"

echo.
echo  Si esta ventana se cierra muy rapido, abre el archivo:
echo  install-bichipishi-log.txt
echo.

where powershell >nul 2>&1
if errorlevel 1 (
  echo [ERROR] No se encuentra PowerShell en este Windows.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set ERR=%ERRORLEVEL%
exit /b %ERR%

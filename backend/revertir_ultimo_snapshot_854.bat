@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ========================================================
echo BUSCANDO EL ULTIMO SNAPSHOT DEL CLIENTE 854...
echo ========================================================

set "LAST_SNAP="
for /f "delims=" %%F in ('dir /b /o-d snapshot_cliente_854_*.json 2^>nul') do (
    if not defined LAST_SNAP set "LAST_SNAP=%%F"
)

if "%LAST_SNAP%"=="" (
    echo [ERROR] No se encontro ningun archivo de snapshot previo.
    echo Primero debe ejecutar tomar_snapshot_854.bat antes de poder revertir.
    echo ========================================================
    pause
    exit /b 1
)

echo.
echo Se encontro el snapshot mas reciente: %LAST_SNAP%
echo.
set /p CONFIRM="Desea revertir los cambios de este cliente a este punto? (S/N): "
if /i not "%CONFIRM%"=="S" (
    echo.
    echo Operacion cancelada por el usuario.
    pause
    exit /b 0
)

echo.
node auditar_cliente_capa.js --revertir "%LAST_SNAP%"
pause

@echo off
cd /d "%~dp0"
echo ========================================================
echo CONSULTANDO ESTADO ACTUAL DEL CLIENTE CAPA (ID 854)
echo ========================================================
node auditar_cliente_capa.js --ver
pause

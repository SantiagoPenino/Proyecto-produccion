@echo off
cd /d "%~dp0"
echo ========================================================
echo TOMANDO SNAPSHOT (BACKUP PREVIO) DEL CLIENTE 854
echo ========================================================
node auditar_cliente_capa.js --snapshot
pause

# Programa monitor-externo.ps1 para que corra cada 1 minuto, con o sin sesión iniciada (no guarda contraseña:
# usa S4U, que alcanza para salir a internet). Correr UNA vez, en PowerShell como administrador, desde esta carpeta:
#   .\instalar-tarea.ps1
# Para sacarla: Unregister-ScheduledTask -TaskName 'Monitor externo USER' -Confirm:$false
$ErrorActionPreference = 'Stop'
$Carpeta = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script = Join-Path $Carpeta 'monitor-externo.ps1'
if (-not (Test-Path (Join-Path $Carpeta 'config.json'))) { throw 'Falta config.json: copiá config.ejemplo.json como config.json y completalo antes de instalar.' }

$accion = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Script`"" -WorkingDirectory $Carpeta
$disparador = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
$quien = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName 'Monitor externo USER' -Action $accion -Trigger $disparador -Settings $ajustes `
    -Principal $quien -Description 'Chequea user.com.uy cada minuto y avisa si no responde (herramientas\monitor-externo).' -Force | Out-Null
Write-Output "Listo: la tarea 'Monitor externo USER' corre cada minuto. El registro queda en $Carpeta\monitor-externo.log"

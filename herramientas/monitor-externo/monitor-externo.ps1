# Monitor externo del servidor (23/10/2026). Corre en una PC de la oficina, FUERA de Hostinger, cada 1 minuto
# (lo programa instalar-tarea.ps1). Le pregunta a /api/health y, si falla N veces seguidas, avisa por mail
# (Resend) y, si está configurado, por WhatsApp (plantilla de Callbell). Avisa otra vez cuando vuelve, con
# cuánto estuvo caído, y recuerda cada tanto mientras siga caído.
#
# Cada corrida es un solo chequeo: el estado (fallas seguidas, desde cuándo) queda en estado.json, así que si
# una corrida se cuelga o la PC se reinicia, la siguiente sigue donde estaba.
#
# Si el chequeo da bien y hay clave en config.json (latido.token = MONITOR_EXTERNO_TOKEN del .env del servidor),
# le manda un latido al servidor: la pantalla del monitor muestra «monitor externo OK hace 1 min» y, si los latidos
# dejan de llegar, el servidor avisa que el que vigila desde afuera no está vigilando.
#
# Uso:
#   .\monitor-externo.ps1            un chequeo (lo que hace la tarea programada)
#   .\monitor-externo.ps1 -Probar    manda un aviso de prueba por cada canal configurado
#   .\monitor-externo.ps1 -SinEnviar un chequeo, pero escribe el aviso en pantalla en vez de mandarlo
# Compatible con Windows PowerShell 5.1.
param(
    [switch]$Probar,
    [switch]$SinEnviar
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Carpeta = Split-Path -Parent $MyInvocation.MyCommand.Path
$RutaConfig = Join-Path $Carpeta 'config.json'
$RutaEstado = Join-Path $Carpeta 'estado.json'
$RutaLog = Join-Path $Carpeta 'monitor-externo.log'

function Escribir-Log([string]$texto) {
    $linea = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto
    try {
        # El log no crece sin fin: pasado 1 MB se guarda como .1 y arranca de nuevo
        if ((Test-Path $RutaLog) -and ((Get-Item $RutaLog).Length -gt 1MB)) { Move-Item $RutaLog "$RutaLog.1" -Force }
        Add-Content -Path $RutaLog -Value $linea -Encoding UTF8
    } catch { }
    Write-Output $linea
}

if (-not (Test-Path $RutaConfig)) {
    Escribir-Log "Falta config.json: copiá config.ejemplo.json como config.json y completalo."
    exit 1
}
$Config = Get-Content $RutaConfig -Raw -Encoding UTF8 | ConvertFrom-Json
$Url = $Config.url
$FallasParaAvisar = [int]$Config.fallasParaAvisar
if ($FallasParaAvisar -lt 1) { $FallasParaAvisar = 2 }
$RecordarCadaMin = [int]$Config.recordarCadaMin
$Nombre = if ($Config.nombre) { $Config.nombre } else { 'user.com.uy' }
$Version = '1.1'

function Leer-Estado {
    if (Test-Path $RutaEstado) {
        try { return Get-Content $RutaEstado -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
    }
    return [pscustomobject]@{ estado = 'ok'; fallas = 0; desde = $null; ultimoAviso = $null; ultimaFalla = $null; latidoError = $null }
}
function Guardar-Estado($e) { $e | ConvertTo-Json | Set-Content -Path $RutaEstado -Encoding UTF8 }

# ─── Canales ──────────────────────────────────────────────────────────────────────────────────────────────────
function Enviar-Mail([string]$asunto, [string]$texto) {
    $r = $Config.resend
    if (-not $r -or -not $r.apiKey -or -not $r.para) { return 'mail sin configurar' }
    $html = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">' +
            (($texto -split "`n" | ForEach-Object { [System.Net.WebUtility]::HtmlEncode($_) }) -join '<br>') + '</div>'
    $cuerpo = @{ from = $r.desde; to = @($r.para); subject = $asunto; html = $html; text = $texto } | ConvertTo-Json -Depth 4
    Invoke-RestMethod -Method Post -Uri 'https://api.resend.com/emails' -TimeoutSec 20 `
        -Headers @{ Authorization = "Bearer $($r.apiKey)" } -ContentType 'application/json; charset=utf-8' `
        -Body ([Text.Encoding]::UTF8.GetBytes($cuerpo)) | Out-Null
    return 'mail enviado'
}

# WhatsApp: fuera de la ventana de 24 h, WhatsApp solo deja mandar plantillas aprobadas. La plantilla se crea en
# Callbell con UNA variable ({{1}}) donde va el texto del aviso, por ejemplo: «Aviso del sistema: {{1}}».
function Enviar-WhatsApp([string]$texto) {
    $c = $Config.callbell
    if (-not $c -or -not $c.apiKey -or -not $c.templateUuid -or -not $c.channelUuid -or -not $c.para) { return 'WhatsApp sin configurar' }
    $resultados = @()
    foreach ($numero in @($c.para)) {
        $cuerpo = @{
            to = [string]$numero; from = 'whatsapp'; type = 'text'; channel_uuid = $c.channelUuid
            content = @{ text = $texto }; template_uuid = $c.templateUuid; optin_contact = $true
            template_values = @($texto)
        } | ConvertTo-Json -Depth 4
        Invoke-RestMethod -Method Post -Uri 'https://api.callbell.eu/v1/messages/send' -TimeoutSec 20 `
            -Headers @{ Authorization = "Bearer $($c.apiKey)" } -ContentType 'application/json; charset=utf-8' `
            -Body ([Text.Encoding]::UTF8.GetBytes($cuerpo)) | Out-Null
        $resultados += "WhatsApp a $numero"
    }
    return ($resultados -join ', ')
}

function Avisar([string]$asunto, [string]$texto) {
    if ($SinEnviar) {
        Escribir-Log "AVISO (sin enviar) | $asunto | $($texto -replace "`n", ' / ')"
        return
    }
    foreach ($canal in @('mail', 'wsp')) {
        try {
            $res = if ($canal -eq 'mail') { Enviar-Mail $asunto $texto } else { Enviar-WhatsApp "$asunto. $($texto -replace "`n", ' ')" }
            Escribir-Log "  -> $res"
        } catch {
            Escribir-Log "  -> no se pudo mandar por $canal`: $($_.Exception.Message)"
        }
    }
}

# Estado de Hostinger en Brasil (su página de estado), para sumarlo al aviso
function Estado-Hostinger {
    try {
        $s = Invoke-RestMethod -Uri 'https://statuspage.hostinger.com/api/v2/summary.json' -TimeoutSec 15
        $inc = @($s.incidents | Where-Object { "$($_.name) $($_.incident_updates[0].body)" -match 'BR-CAM|Campinas|Brazil|Brasil|BR Datacenter' })
        if ($inc.Count -gt 0) { return "Hostinger informa: $($inc[0].name) ($($inc[0].status)). $($inc[0].shortlink)" }
        return 'Hostinger no informa problemas en Brasil.'
    } catch { return 'No se pudo consultar la página de estado de Hostinger.' }
}

# Latido al servidor (solo cuando el chequeo dio bien: si no, no llegaría). Un error se anota una sola vez.
function Enviar-Latido($estado) {
    $l = $Config.latido
    if (-not $l -or -not $l.token) { return }
    $url = if ($l.url) { $l.url } else { $Url -replace '/api/health$', '/api/sysadmin/monitor/latido-externo' }
    try {
        $cuerpo = @{ pc = $env:COMPUTERNAME; version = $Version } | ConvertTo-Json
        Invoke-RestMethod -Method Post -Uri $url -TimeoutSec 15 -Headers @{ 'x-monitor-token' = $l.token } `
            -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($cuerpo)) | Out-Null
        if ($estado.latidoError) { Escribir-Log "Latido: anda de nuevo" }
        $estado.latidoError = $null
    } catch {
        $msg = $_.Exception.Message
        if ($estado.latidoError -ne $msg) { Escribir-Log "Latido rechazado: $msg" }
        $estado.latidoError = $msg
    }
}

function Hay-Internet {
    try { Invoke-WebRequest -Uri 'https://www.google.com/generate_204' -UseBasicParsing -TimeoutSec 10 | Out-Null; return $true }
    catch { return $false }
}

$fmtHora = { param($t) if ($t) { ([datetime]$t).ToString('dd/MM HH:mm') } else { '—' } }
function Duracion([datetime]$desde) {
    $s = [int]((Get-Date) - $desde).TotalSeconds
    if ($s -lt 3600) { return "{0} min" -f [math]::Max(1, [math]::Round($s / 60)) }
    return "{0} h {1} min" -f [math]::Floor($s / 3600), [math]::Round(($s % 3600) / 60)
}

# ─── Prueba ───────────────────────────────────────────────────────────────────────────────────────────────────
if ($Probar) {
    Escribir-Log "Prueba de avisos"
    Avisar "[PRUEBA] Monitor externo de $Nombre" "Esto es una prueba del monitor externo.`nSi te llegó, el aviso funciona.`nPC: $env:COMPUTERNAME"
    exit 0
}

# ─── Chequeo ──────────────────────────────────────────────────────────────────────────────────────────────────
$estado = Leer-Estado
$ok = $false
$motivo = ''
$t0 = Get-Date
try {
    $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 15
    $ok = ($resp.StatusCode -eq 200)
    if (-not $ok) { $motivo = "respondió $($resp.StatusCode)" }
} catch {
    $codigo = $null
    try { $codigo = [int]$_.Exception.Response.StatusCode } catch { }
    if ($codigo -in 502, 503, 504) { $motivo = "nginx responde pero la app no ($codigo)" }
    elseif ($codigo -eq 500) { $motivo = 'la app responde pero la base de datos no (500)' }
    elseif ($codigo) { $motivo = "respondió $codigo" }
    else { $motivo = "el servidor no responde ($($_.Exception.Message))" }
}
$ms = [int]((Get-Date) - $t0).TotalMilliseconds

if ($ok) {
    if ($estado.estado -eq 'caido') {
        $dur = Duracion ([datetime]$estado.desde)
        Escribir-Log "VOLVIÓ ($ms ms) después de $dur"
        Avisar "[VOLVIÓ] $Nombre responde de nuevo" "El sistema volvió a responder a las $(Get-Date -Format 'HH:mm').`nEstuvo sin responder $dur (desde las $(& $fmtHora $estado.desde)).`nÚltimo problema: $($estado.ultimaFalla)"
    } elseif ($estado.fallas -gt 0) {
        Escribir-Log "OK ($ms ms) después de $($estado.fallas) falla(s) suelta(s)"
    }
    $nuevo = [pscustomobject]@{ estado = 'ok'; fallas = 0; desde = $null; ultimoAviso = $null; ultimaFalla = $null; latidoError = $estado.latidoError }
    Enviar-Latido $nuevo
    Guardar-Estado $nuevo
    exit 0
}

# Falló. Si la que no tiene internet es la oficina, no es el servidor: no se avisa (y tampoco se podría)
if (-not (Hay-Internet)) {
    Escribir-Log "FALLA pero la oficina no tiene internet: no cuenta ($motivo)"
    exit 0
}

$estado.fallas = [int]$estado.fallas + 1
if (-not $estado.desde) { $estado.desde = $t0.AddSeconds(-60).ToString('o') }   # falló entre el chequeo anterior y este
$estado.ultimaFalla = $motivo
Escribir-Log "FALLA $($estado.fallas): $motivo"

if ($estado.estado -ne 'caido' -and $estado.fallas -ge $FallasParaAvisar) {
    $estado.estado = 'caido'
    $estado.ultimoAviso = (Get-Date).ToString('o')
    Avisar "[CAÍDO] $Nombre no responde" "El sistema no responde desde las $(& $fmtHora $estado.desde) ($($estado.fallas) chequeos seguidos).`nQué pasa: $motivo.`n$(Estado-Hostinger)`nMonitor: https://user.com.uy/admin/monitor"
} elseif ($estado.estado -eq 'caido' -and $RecordarCadaMin -gt 0 -and $estado.ultimoAviso -and ((Get-Date) - [datetime]$estado.ultimoAviso).TotalMinutes -ge $RecordarCadaMin) {
    $estado.ultimoAviso = (Get-Date).ToString('o')
    Avisar "[SIGUE CAÍDO] $Nombre lleva $(Duracion ([datetime]$estado.desde)) sin responder" "Sigue sin responder desde las $(& $fmtHora $estado.desde).`nQué pasa: $motivo.`n$(Estado-Hostinger)"
}
Guardar-Estado $estado

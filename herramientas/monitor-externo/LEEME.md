# Monitor externo del servidor

Chequea `https://user.com.uy/api/health` cada minuto **desde afuera de Hostinger**. Si falla 2 veces seguidas, avisa por mail y, opcionalmente, por WhatsApp. Avisa también cuando vuelve, con cuánto estuvo caído, y recuerda cada 30 min mientras siga caído.

Es la contracara de los avisos del propio servidor: si el servidor se cae entero, no puede avisar nada, así que avisa esta PC.

## Instalación (en la PC de la oficina)

1. Copiar esta carpeta a la PC, por ejemplo a `C:\monitor-externo`.
2. Copiar `config.ejemplo.json` como `config.json` y completarlo:
   - `latido.token`: la misma `MONITOR_EXTERNO_TOKEN` del `.env` del servidor (inventala larga, 16 caracteres o más, y ponela en los dos lados). Con eso la pantalla del monitor muestra «monitor externo OK hace 1 min» y el servidor avisa si los latidos dejan de llegar.
   - `resend.apiKey`: la misma `RESEND_API_KEY` del `.env` del servidor.
   - `resend.para`: los mails que reciben los avisos.
   - `callbell` (opcional): para WhatsApp hace falta una plantilla aprobada en Callbell con una sola variable (`{{1}}`), por ejemplo «Aviso del sistema: {{1}}». Hay que completar `apiKey`, `channelUuid`, `templateUuid` y `para` (números con código de país, ej. `59899123456`).
3. Probar los avisos, en PowerShell, desde la carpeta:
   ```powershell
   .\monitor-externo.ps1 -Probar
   ```
   Tiene que llegar un mail «[PRUEBA] Monitor externo…».
4. Instalar la tarea, en PowerShell **como administrador**:
   ```powershell
   .\instalar-tarea.ps1
   ```
   Queda la tarea «Monitor externo USER», que corre cada minuto con o sin sesión iniciada.

## Uso

- **Registro:** `monitor-externo.log` en la misma carpeta, una línea por falla y por aviso. Los chequeos que dan bien no se anotan, para no llenarlo. Si el latido falla (clave mal puesta, por ejemplo), se anota una vez.
- **Probar sin mandar nada:** `.\monitor-externo.ps1 -SinEnviar` escribe en pantalla el aviso que mandaría.
- **Si la oficina se queda sin internet,** no cuenta como caída del servidor y no avisa.
- **Para sacarlo:** `Unregister-ScheduledTask -TaskName 'Monitor externo USER' -Confirm:$false`.

`config.json`, `estado.json` y el log no van al repo (`.gitignore`): la clave queda solo en esa PC.

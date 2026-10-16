# Pipeline del video tutorial (sin instalar nada)

Orden de uso (desde esta carpeta, con el backend y Vite corriendo en local):

1. `powershell -ExecutionPolicy Bypass -File tts.ps1` → genera `audio/*.wav` con la voz "Microsoft Sabina Desktop" a partir de `guion.json`.
2. `node chrome_daemon.js` (dejarlo corriendo) → abre un Chrome visible con perfil propio en /login; **iniciar sesión a mano** con un usuario interno.
3. `node cap_flujo.js --pasos=modulo,barra,abrir,escanear,tarjetas,situacion,cerrar,casos2,detalle,reportes2,ciclico2` → recorre la pantalla real
   (abre una auditoría "solo TP", escanea TP-372, TP-474, TP-250, TP-99999, TP-372 (repetida) y TP-359, la cierra) y guarda `capturas/*.png` + `capturas/rects.json`.
   Si hay una auditoría abierta, agregar `--anular` para anularla primero. Los códigos de ejemplo están en el script: cambiarlos si esas órdenes ya no están en depósito.
4. `node mk_escenas.js` → `escenas.json` (captura + resaltes + clics + zoom por frase de la narración; hay ajustes a mano para 02, 04, 08, 10, 12, 14).
5. `node grabar.js --modo=previa` → fotogramas de control en `previa/`. `node grabar.js --modo=grabar --vbps=560000 --abps=64000 --mono --salida=tutorial_auditoria_deposito.mp4` (≈27 MB; con `--vbps=1600000` y sin `--mono` ≈71 MB, más nítido en las transiciones) → MP4 (H.264 + AAC) grabado en tiempo real con MediaRecorder en Chrome headless; `mp4_fix.js` le escribe la duración total (MediaRecorder deja un MP4 fragmentado sin ella).
6. `node verificar.js tutorial_auditoria_deposito.mp4 verif 2,60,120,300` → duración, saltos y fotogramas del archivo final.

Requiere: Chrome instalado, puppeteer del proyecto (`node_modules`), voz en español de Windows. No usa ffmpeg.

# Guion del video tutorial — Auditoría de depósito

Video: `tutorial_auditoria_deposito.mp4` (1280×720, H.264 + AAC, ~5 min 45 s, voz en español "Sabina" de Windows).
Grabado el 2026-09-08 sobre la app real en local (auditoría de prueba AUD-2026-0908-02, alcance "solo TP").
Cada escena muestra la pantalla real con el elemento resaltado mientras la voz lo explica.

| # | Escena | Narración |
|---|--------|-----------|
| 1 | Portada | Bienvenidos al tutorial de la auditoría de depósito. En este video vamos a ver, paso a paso, cómo abrir una auditoría, escanear las órdenes del estante, cerrar el ciclo, trabajar los casos y leer los reportes. |
| 2 | Qué es y dónde está | La auditoría de depósito compara lo que el sistema dice que hay en el depósito con lo que realmente está en los estantes. Se entra desde el menú Logística, opción Auditoría de depósito. La pantalla tiene cinco pestañas: Escaneo físico, Situación depósito, Registro de casos, Reportes y Conteo cíclico. |
| 3 | Paso 1 · La barra de la auditoría | Arriba está la barra de la auditoría. Si no hay ninguna abierta, el escaneo queda bloqueado. Primero hay que abrir una auditoría, que toma una fotografía del depósito en ese momento: la lista de órdenes que deberían estar en los estantes. |
| 4 | Paso 2 · Abrir la auditoría | Al abrir, elegimos el alcance: el depósito completo, o solo algunas áreas, por ejemplo TP. Con alcance parcial, los casos de las otras áreas no se tocan. Solo puede haber una auditoría abierta a la vez: hasta que no se cierre o se anule, no se puede abrir otra. |
| 5 | Paso 3 · Escanear los estantes | Con la auditoría abierta, vamos al estante y escaneamos cada etiqueta en el campo de escaneo. Cada lectura genera una tarjeta con la orden y su situación. Verde es OK: la orden estaba en la fotografía y está físicamente en el depósito. |
| 6 | Paso 3 · Tarjetas rojas | Las tarjetas rojas son problemas. Entregada: el sistema la da por entregada, pero está en el estante. No ingresada: existe en producción, pero nunca se ingresó al depósito. Desconocida: el código no existe en el sistema. Con el signo de pregunta vemos qué significa cada una; con la llave, las acciones para corregirla; y con la cruz quitamos una lectura equivocada. Si escaneamos dos veces la misma etiqueta, el sistema avisa que ya estaba escaneada y no la cuenta dos veces. |
| 7 | Paso 3 · Avance del escaneo | El termómetro muestra qué porcentaje de la fotografía ya fue verificado. Los filtros permiten ver solo las tarjetas con problemas, o las órdenes que todavía faltan escanear, para no dejar ningún estante sin recorrer. |
| 8 | Situación depósito | La pestaña Situación depósito muestra todas las órdenes activas del depósito. Los interruptores filtran por plazo vencido, por escaneada o no, y por aviso enviado. El icono de pago indica si la orden está pagada, sin cobrar, facturada sin cobrar, o sin facturar. Desde acá también se puede avisar por WhatsApp o marcar como entregada. |
| 9 | Paso 4 · Cerrar la auditoría | Al terminar el recorrido físico, cerramos la auditoría. El sistema compara la fotografía con lo escaneado y genera los casos: faltantes, sobrantes, sin ingreso, sin registro, sin aviso y envejecidas. Anular, en cambio, descarta la sesión sin generar ningún caso. |
| 10 | Paso 4 · Resumen del cierre | El resumen del cierre indica cuántos casos son nuevos, cuántos ya existían y se volvieron a detectar, cuántos reincidieron después de haberse cerrado, y cuántos se resolvieron solos. Las órdenes que se entregaron o ingresaron durante la auditoría se informan como movidas y no generan caso. |
| 11 | Paso 5 · Registro de casos | El Registro de casos es permanente. Cada orden con problemas aparece una sola vez, con todos sus problemas adentro, y nunca se duplica: si vuelve a detectarse, se suma una detección al mismo caso. Las tarjetas resumen los casos abiertos, los crónicos, los de severidad alta, los reincidentes y los cerrados. Severidad alta significa tres o más detecciones, un faltante de más de cinco mil pesos, o más de noventa días. |
| 12 | Paso 5 · Trabajar un caso | Al abrir una orden vemos sus problemas, la historia completa y el seguimiento. Las acciones de seguimiento son: tomar, registrar avance, esperar, asignar responsable con fecha límite, resolver, o asumir la pérdida. Las acciones sobre depósito ejecutan directo: cancelar la orden, entregar, avisar por WhatsApp, regresar a depósito o ingresar. |
| 13 | Paso 5 · Cierre automático | Cuando la orden se entrega o se corrige desde el depósito, el caso se cierra solo al volver a abrir esta pantalla, y en la historia queda registrado cómo se cerró. Con el filtro de cerrados recientes se puede revisar qué se resolvió en los últimos días. |
| 14 | Paso 6 · Reportes | En Reportes elegimos una auditoría cerrada, o la foto en vivo del depósito. La versión ejecutiva trae el análisis gráfico: antigüedad, casos por tipo y severidad, verificación física, situación de pago y valor por área, además de los hallazgos redactados. Se imprime a PDF o se exporta a Excel con todas las hojas. |
| 15 | Paso 7 · Conteo cíclico | El Conteo cíclico propone qué área auditar y cuándo, según el valor que tiene en depósito. Las áreas A se auditan cada siete días, las B cada catorce y las C cada treinta. Con el botón Auditar solo esta área se abre una auditoría de esa zona con un clic. |
| 16 | Resumen | En resumen: abrir la auditoría, escanear los estantes, cerrar para generar los casos, trabajar cada caso hasta resolverlo, y usar los reportes y el conteo cíclico para mantener el depósito bajo control. Gracias por ver este tutorial. |

## Cómo se produjo (para regrabarlo cuando cambie la pantalla)

Los scripts están en `docs/Auditoria deposito/video-tutorial/` (ver su README), sin instalar nada en la máquina:

1. `guion.json` — escenas y narración. `tts.ps1` genera un WAV por escena con la voz de Windows (`System.Speech`, "Microsoft Sabina Desktop").
2. `chrome_daemon.js` abre un Chrome visible con perfil propio; el usuario inicia sesión ahí (Claude no maneja contraseñas).
3. `cap_flujo.js` recorre la pantalla real con puppeteer (abre la auditoría, escanea, cierra, recorre las pestañas), guarda capturas 1280×720 y los rectángulos de los elementos a resaltar (`capturas/rects.json`).
4. `mk_escenas.js` arma `escenas.json` (captura + resaltes + clics + zoom por frase de la narración).
5. `compose.html` + `grabar.js` dibujan el video en un canvas (capturas, foco resaltado, cursor, subtítulos) y lo graban con `MediaRecorder` a MP4 H.264/AAC en Chrome headless; luego verifican duración y extraen fotogramas.

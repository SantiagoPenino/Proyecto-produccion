# Changelog

Historial de cambios del sistema de producción. Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/).

- Desde julio 2026 en adelante: una entrada por deploy, con fecha exacta.
- Lo anterior: reconstruido desde el historial de git, una entrada por mes (la granularidad por deploy no se registró en su momento).

---

## [2026-07-27] — Sin deployar

### Agregado
- **Tótem — autorización por token de dispositivo**: reemplaza el chequeo por IP fija (el local se muda y deja de tenerla). El equipo se activa una sola vez con `/totem?activar=<TOTEM_TOKEN>`, queda guardado en ese navegador y viaja en cada request. Además **cierra los endpoints del tótem** (`lookup`, `lookup-by-client`, `create-pickup`, `announce`), que estaban abiertos a cualquiera: el chequeo de IP anterior solo escondía la pantalla. Con `TOTEM_TOKEN` vacío queda abierto (dev / transición).
- **Descarga del lote archivo por archivo** (sin ZIP): se pide un manifiesto y cada archivo se baja y escribe apenas llega. Evita cargar el lote entero en memoria del navegador, muestra progreso real (`3/14 · archivo.pdf`, MB y velocidad) y un archivo caído ya no arruina la descarga completa. El ZIP queda como fallback donde no hay File System API (HTTP inseguro, Firefox, Safari).
- **MIMAKI — avance de impresión por copias**: las órdenes de un lote en MIMAKI cargan cuántas copias van impresas (contador `x/y`, como TPU) en vez del tick binario. El total sale de las copias del arte; `Impreso` se sigue derivando al completar.
- **Portal — vista previa en todas las áreas**: la miniatura del arte (imagen o 1ª página del PDF) estaba limitada a materiales de medida fija; ahora se ve en cualquier servicio y material. El modal ampliado se acota al viewport y la vista previa se rasteriza a mayor resolución (antes se generaba a 320 px y se mostraba diminuta). En **DTF** el arte se muestra sobre damero, respetando la transparencia real del PDF.
- **Detalle de lote — indicador de rapport / escala**: el ícono del ojo de cada orden se colorea según cómo se imprime el arte (morado = rapport, magenta = escala, gris = normal), con el detalle en el tooltip. Se reconoce de un vistazo sin agregar columnas.
- **Detalle de orden — marca de falla en los archivos**: cada archivo relacionado con una falla lleva su indicador, **aunque ya esté sanada**: `FALLA` y `REPONE FALLA` en magenta para lo que sigue abierto, `FALLA RESUELTA` en verde para lo cerrado. Antes no había forma de saber, mirando una orden, que alguno de sus archivos había pasado por una falla. Contempla las dos marcas que deja la cura según el camino (`[Reposición OK]` y `[Repuesto]`) y distingue si el archivo de la orden `-F` ya se controló OK.
- **Trazabilidad de la edición de archivos**: al cambiar medidas, copias o metros de un arte, el historial de la orden ahora registra **qué cambió** (`Ancho: 1.55 → 1.50 | Alto: 0.90 → 0.85`), no solo "Archivo modificado". Antes se podía editar la medida de un arte sin dejar ningún rastro, y después era imposible saber si el archivo había sido tocado a mano.
- Detalle de lote: las órdenes de **bandera confeccionada** muestran la cantidad de banderas además de los metros (3,6 m no dice si son 4 banderas de 0,9).
- Planeación: la card del lote muestra su **número** (`LOTE #636`) junto al nombre — el nombre lo pone el operario y se repite entre días, el número identifica el lote sin ambigüedad.
- Push al cliente cuando una orden **se reactiva** (contraparte del aviso de cancelación).

### Arreglado
- **Auditoría de Depósito — no matcheaba NADA**: comparaba el código escaneado tal cual contra `OrdenesDeposito.OrdCodigoOrden`, pero la etiqueta física es `{NoDocERP}/B{idEtiqueta}` (`9471/B11575`) y el depósito guarda el código con prefijo de área (`SUB-9471`). Nunca coincidían: todo lo escaneado caía en "Falta Por Ingresar" y **las órdenes reales quedaban todas como extraviadas** (Activas y Extraviadas daban el mismo número). Ahora el código se normaliza —se le saca el `/B…` y el prefijo— y se compara por ambas formas, en el chequeo y en la carga inicial de la pantalla. Los desconocidos se listan con el código original que escaneó el operario. Las reposiciones (`-R`) y fallas (`-F`) siguen sin poder distinguirse de su madre: la etiqueta solo lleva el `NoDocERP`, que comparten.
- **Portal — medida fija: el rechazo no explicaba nada**: el flujo real es subir el arte y *después* elegir la tela, pero la validación de medida fija solo corría al subir el archivo. Con "Bandera Confeccionada" elegida después, no pasaba nada hasta el "Confirmar Pedido", donde el modal solo decía "hubo un problema al subir uno de los archivos" y mandaba a reintentar algo que nunca iba a entrar. Ahora avisa **apenas se elige el material**, el "Confirmar" corta antes de subir explicando el motivo, y detecta el caso más común (arte rotado: 0,85 × 1,50 en vez de 1,50 × 0,85) diciendo qué hacer. El modal de subida además muestra el error real del backend en lugar del texto genérico.
- **Rapport / escala se borraban al pasar por Control**: el control de archivos hacía `Observaciones = @Motivo`, pisando el campo — y un control sin motivo lo dejaba vacío. Toda orden que pasaba por Control perdía el detalle técnico de impresión (`[RAPORT] ORIG: 0.64x0.64m -> … -> FINAL: 1.47x2.40m`) y ya no se podía saber cómo se había impreso. Ahora la parte técnica se conserva y el motivo se anexa.
- **La falla de una falla no generaba nada**: al reportar una falla sobre una orden que ya era `-F`, el sistema buscaba una reposición activa de la misma madre para reutilizar… y se encontraba **a sí misma**. La "reutilizaba", le pisaba los metros al archivo y no se creaba ninguna orden nueva: la falla se perdía. Excluir la orden que se está controlando **no alcanzó**: como la búsqueda es por raíz (`SUB-9471`), seguía encontrando a las `-F` **hermanas** y absorbía la falla en una de ellas. En una cadena de tres (`SUB-9471` → `-F13858` → `-F13916`) el tercer eslabón no generaba reposición: la falla quedaba registrada pero sin orden. Ahora, cuando lo que falla es una `-F`, nunca se reutiliza otra: siempre nace su propia reposición.
- **El estado "Con Falla" se borraba solo**: al terminar de controlar el resto de los archivos de una orden que ya tenía una falla, la orden volvía a "Control y Calidad" y la falla dejaba de verse — la madre quedaba como si nada, esperando una reposición invisible. De las tres ramas del cierre de control, la del medio (orden completa pero pedido incompleto en el área) era la única que no miraba si había archivos en `FALLA`, y pisaba el estado recién puesto.
- **Sanación de fallas en cadena**: al completar una reposición se curaba siempre la orden RAÍZ (`split('-F')[0]`), nunca el padre inmediato. En cadenas madre → `-F1` → `-F2`, la `-F1` quedaba con su falla colgada para siempre y **el pedido nunca se resolvía**. Ahora se curan los archivos/servicios en falla de toda la familia (mismo `NoDocERP` + área) y se emite la señal de liberación del Canasto Falla (el guard anterior exigía `EstadoenArea = 'Retenido'`, un estado que las órdenes en falla nunca tienen).
- **La sanación no corría con "CORREGIR FALLA"**: estaba escrita dentro del control de archivos uno por uno, pero el botón que se usa para cerrar una reposición va por otro camino (`completarOrden`) que no curaba nada. O sea que en el flujo real casi nunca se ejecutaba: los eslabones previos de la cadena quedaban con su archivo en FALLA para siempre y el pedido no se resolvía. La cura pasó a ser una función compartida que llaman los dos caminos.
- **Desbloqueo post-reposición: solo llegaba a la raíz**: al cerrar una `-F` se buscaba la madre con un match exacto sobre el código sin sufijos, así que el eslabón intermedio de una cadena nunca entraba y se quedaba en "Con Falla" aunque su falla ya estuviera repuesta. Ahora recorre toda la familia y desbloquea cada orden que haya quedado sin fallas.
- **Metros de la reposición en 0,00**: en Sublimación la `-F` nace en 0 y los metros se cargan después, en el detalle del lote — pero eso solo actualizaba la orden, no sus archivos. El detalle mostraba la magnitud arriba y `TOTAL: 0.00 m` en el archivo, y el metraje total estimado quedaba corto. Ahora los metros se reflejan también en los archivos (en DTF ya pasaba, porque ahí se piden al reportar la falla). Solo afecta el metraje estimado: la cotización no lee ese campo.
- **Notas de falla — aparecían como "Notas de Producción"**: el prefijo `FALLA:` (que es lo que separa la caja azul de notas del cliente de la caja ámbar de fallas) solo se agregaba si la orden madre ya tenía nota. Cuando no la tenía, la **primera** falla caía en la caja equivocada y las siguientes en la correcta: la misma información repartida en dos cajas de distinto color. Ahora el prefijo va siempre. De paso, cada línea registra **a qué archivo** corresponde (`Archivo 4 de 4`) — una `-F` acumula una línea por cada falla del pedido y no se sabía cuál era cuál — y el motivo aparece siempre (`Motivo: (sin especificar)` si el operario no escribe nada; antes quedaba una línea muda "Máquina | Lote").
- **Caja — deadlocks de SQL cortaban el cobro**: `procesarTransaccion` moría con el error 1205 ("deadlock victim") y el cobro fallaba de cara al cajero. Ahora las cuatro operaciones de Caja (`procesarTransaccion`, `procesarVentaDirecta`, `procesarPagoDeuda`, `anularTransaccion`) **reintentan hasta 3 veces** con espera incremental. Reintentar es seguro y no puede duplicar un cobro: ante un deadlock SQL revierte la transacción entera, por eso el propio motor responde "Rerun the transaction". El RCSI activado en la base no cubre estos casos — resuelve los deadlocks lectura/escritura, no los escritura/escritura entre operaciones de caja.
- **Panel de control — "Canceladas" siempre en 0**: faltaba `getCancelledSummary` en el service del front; la tarjeta recibía `undefined` como `queryFn` y caía al fallback. El backend ya estaba bien.
- **Reposiciones (-R) con costo**: al recibirlas en depósito, si el pedido tenía diferencias contables, la `-R` tomaba la línea de cobranza de la madre y quedaba con importe. Son re-trabajo sin cargo: ahora siempre costo 0.
- **Búsqueda de clientes daba 500**: los nombres vienen de columnas `CHAR` con decenas de espacios de padding; el término superaba el `NVarChar(100)` del parámetro y SQL rechazaba la consulta entera. Se recorta y acota el término.
- **Etiqueta de lote**: la hora salía 3 horas atrasada (el driver entrega el `DATETIME` como UTC y se volvía a convertir), el nombre del lote se partía en tres líneas y los banners decían "CONTIENE" de más. Además ahora **solo se imprime en máquinas marcadas como impresora**.
- **Historial de lotes**: las fechas de creación y finalización también salían 3 horas atrasadas, por la misma causa.
- **Detalle de orden — Tela de Cliente**: mostraba el material genérico ("Tela Cliente (Mínimo 5mts)") en vez de la bobina elegida. Ahora compone Referencia + tela + ancho, igual que la planilla.
- **Crear Remito** ofrecía bultos de órdenes de falla (`-F`), que nunca se despachan solas — su material se incorpora al pedido madre.
- **Asignar a lote** ofrecía lotes que ya están en una calandra: ese lote ya se imprimió, sumarle órdenes las dejaría sin imprimir.
- **PDF de arte multipágina**: la validación era solo del navegador y tenía un hueco (si no podía contar páginas, dejaba pasar), además de no cubrir las otras vías de subida. Ahora el backend cuenta con `pdf-lib` y rechaza el arte de más de 1 página.
- **PNG/JPG sin metadata de DPI**: antes se ofrecía confirmar una medida calculada asumiendo 300 DPI — una suposición que terminaba imprimiéndose. Ahora se rechaza el archivo y se explica cómo resolverlo (guardar como PDF o contactar a Atención al Cliente).
- **Sincronización de clientes con Google Sheets**: migrada a la planilla nueva (la anterior agotó su historial de versiones) y la escritura salió del Apps Script — que se rompió al cambiar el propietario de la planilla — hacia la API directa, con el mismo token que ya usa el panel.
- Errores del ERP Macrosoft y del tótem se registraban sin detalle (solo "status 500"); ahora el log incluye la respuesta del servidor, el pedido y el payload.

### Cambiado
- **Nueva dirección del local**: Arenal Grande 2667 → **Inca 2228, Montevideo**. Actualizada en el footer, la página de contacto, el mapa del showroom (texto, popup, pin y link a Google Maps) y en los remitos y etiquetas de encomienda que se imprimen.
- **Historial del pedido sin tope**: la vista integral cortaba en 20 entradas sin avisar. Ahora hay un "ver más" que expande el historial **completo** (y vuelve a colapsar). En pedidos con varias órdenes hermanas cada evento se registra por orden, así que un solo "Ingresado" ocupaba 5 de las 20 líneas y el resto quedaba oculto.
- **Medida fija (banderas) — se elimina el fail-open**: si el material se imprime a medida fija y el arte **no se puede medir**, ahora se rechaza en vez de dejarlo pasar con un warning. En esos materiales la medida es lo único que importa, y por ese hueco entraban banderas sin el margen de confección (arte de 1,50 × 0,85 donde debía ser 1,55 × 0,90), imposibles de detectar después. La consulta de configuración sigue siendo fail-open: si falla, no se puede saber si el material aplica.
- **Finalizar lote**: el bloqueo por órdenes sin marcar como impreso/calandrado ahora es **exclusivo de Sublimación**. En el resto de las áreas se finaliza sin exigir el marcado.
- **Detalle de lote — agrupación**: las órdenes de falla se agrupan por material junto con las normales (antes iban a un grupo propio con header magenta). El indicador de falla pasa a la fila de la orden.
- **Código de las reposiciones — se ve el linaje**: la falla de una falla conserva el código de su origen y numera el eslabón (`SUB-9471-F13858` → `-F13858-2` → `-F13858-3`). Antes cada eslabón tomaba el ID de su propio archivo (`-F13858` → `-F13916` → `-F13917`) y por el código las tres parecían hermanas de la madre: no se veía que una salía de la otra. El sufijo `-N` pasa a significar siempre lo mismo — el siguiente número libre de ese linaje — y cubre también el caso de un archivo que vuelve a fallar después de repuesto.
- **TPU — el cliente aprueba el boceto, no el arte terminado**: para mandar una orden a aprobación ahora alcanza con **un PDF con "boceto" en el nombre** (se ve en Archivos de Referencia, como hasta ahora), en vez de exigir las 6 capas del arte. El diseño completo se sube después, ya con el visto bueno del cliente: antes había que terminar todo el arte para recién ahí preguntar si le gustaba. El **visor 3D** del portal pasa a armar el parche con ese mismo boceto (antes necesitaba la capa CMYK, que en la aprobación todavía no existe), y el botón "Ver 3D" solo aparece si la capa está cargada — antes se ofrecía siempre, incluso en órdenes sin ningún PDF, y abría solo para mostrar un error. El reuso de matriz con cantidad distinta no cambia: no pasa por el cliente y sigue necesitando las 6 capas regeneradas.

## [2026-07-23] — Sin deployar

### Agregado
- **TPU — Visor 3D del parche en la aprobación del cliente**: en "Mi Fábrica", los pedidos TPU en espera de aprobación tienen un botón "Ver 3D" que arma el parche en tres dimensiones desde las capas reales del arte: silueta del corte extruida (base blanca con espesor, canto y dorso blancos como el TPU físico) + la capa CMYK plana en el frente. Aísla UNA copia de la plancha (el arte viene repetido N veces), rota/zoom/pan con mouse o táctil, y se carga solo al abrirse (three.js + d3-contour lazy). Endpoints nuevos scopeados al dueño del pedido para leer las capas.
- **TPU — 6 archivos de arte** (antes 5): el gate de subida, el "enviar a aprobación" (exactamente 6) y el máximo por orden pasan a 6, en front y backend.
- **TPU — Boceto de producción**: el archivo de arte cuyo nombre contiene "boceto" se muestra en la pestaña "Archivos de Referencia" (debajo del boceto del cliente) con el tag BOCETO DE PRODUCCION, y es el que el cliente ve para aprobar en el portal (con fallback al CMYK para órdenes viejas). Sigue contando como uno de los 6.
- **TPU — Barra de progreso de subida**: el "Subiendo…" del detalle interno ahora muestra progreso real (archivo N/total + % ponderado por bytes).
- **Tareas (To-Do interno)**: lista compartida del sistema interno — cualquier usuario crea tareas y cualquiera las marca como hechas; queda registro de quién la creó y quién la realizó (con fechas). Filtros Pendientes/Hechas/Todas, alta colapsada tras botón "Nueva tarea", confirmación al borrar y actualización en vivo entre usuarios. Nueva pantalla `/tareas`.
- DTF (`/area/df`): marcado de "impreso" LIBRE — se puede marcar/desmarcar cualquier orden del lote sin exigir que las anteriores estén impresas (sin invariante de secuencia, sin bloque "FUERA DE ORDEN", sin rechazo de drags). El resto de las áreas sigue con marcado en orden, y finalizar la impresión sigue exigiendo TODO marcado.
- Portal / Bandera Confeccionada: la zona de subida muestra miniatura del arte con guía punteada de 2,5 cm (margen de confección), y al clickear abre un modal con la vista del área útil recortada y un toggle "Flamear" que ondea la bandera (WebGL). Solo para materiales de medida fija.
- Tótem: salida de emergencia en la pantalla de "Acceso no autorizado" (botón "Salir del tótem" + tecla Esc), para no quedar encerrado en el kiosco cuando falla la verificación.
- Changelog: este archivo.

### Arreglado
- **TPU — Cantidad "0 U"**: la cantidad pedida por el cliente (mínimo 15) nunca se guardaba en la orden — el ítem TPU no trae archivo y la Magnitud "la sumaban los archivos", que no existían: quedaba 0 en el portal, la planilla y el detalle, y rompía el contador de impresión parcial (el total es la Magnitud). Ahora la orden nace con Magnitud = cantidad pedida (portal + fork de prendas).
- **TPU — Campo cantidad muerto en el form del portal**: el ítem que lleva la cantidad se creaba y era pisado por el reset de la config en el mismo flush de efectos — el campo quedaba bindeado a nada (mostraba el placeholder), no se podía escribir y el confirmar rebotaba con "mínimo 15". El efecto ahora se auto-corrige tras cada commit (OrderForm + PrendaOrderForm).
- Portal mobile ("Mi Fábrica"): las pills de estado/acción (ESPERA TU APROBACIÓN · VER 3D · APROBAR) se cortaban fuera de pantalla; ahora la fila hace wrap y bajan a su propia línea.
- **Seguridad de datos**: las órdenes sin cliente vinculado se asignaban al azar a un cliente real al ingresar al depósito (la etiqueta salía con cliente "0" en el QR y matcheaba contra `Clientes.IDReact = 0`). Guard en los 3 puntos que resuelven cliente por IDReact (ingreso por QR, import on-demand, integración planilla) + corrección de datos (ningún cliente queda con IDReact = 0). Un cliente venía recibiendo los avisos WSP y retiros de órdenes ajenas desde marzo.
- Medida fija (banderas confeccionadas): la validación de "el archivo debe medir exactamente ancho × largo" ahora se hace también en el backend al subir el arte por el portal, no solo en el form (client-side). Rechaza el archivo antes de subirlo, respetando rotación (`/Rotate`) y `/UserUnit` — así ya no entra un archivo girado (ej. 0.90 × 1.54 en lugar de 1.55 × 0.90). Los caminos de sync/planilla siguen sin bloqueo (miden async; pendiente marcarlos).
- Finalizar impresión en MIMAKI: la impresora (mal marcada, sin el flag `SeparacionImpresion`) se trataba como calandra y pedía "calandrado", imposible de finalizar. Ahora la calandra se detecta por nombre, no por el flag (front y backend).
- Caja: el voucher de egreso daba 500 por una columna inexistente (`u.NombreCompleto` → `u.Nombre`). Además el logger de Caja descartaba el mensaje de error (winston con 2º arg string), por lo que los 500 salían sin detalle — corregido para que muestren el error real.
- Planeación: los lotes en máquina no mostraban sus órdenes — el filtro de estados del tablero era case-sensitive y con lista incompleta ('En cola' ≠ 'En Cola'; faltaban 'Imprimiendo'/'Produccion'). Ahora filtra case-insensitive por exclusión.
- Planeación: el tablero daba 500 en bases donde `CantidadImpresa` quedó como INT — el auto-heal a DECIMAL fallaba por el default constraint; ahora lo suelta, altera y lo recrea.
- Detalle de lote: una falla agregada a un lote no se iba al final cuando correspondía. Ahora una falla sin imprimir salta al bloque FUERA DE ORDEN (final del lote) cuando el grupo siguiente ya tiene alguna orden impresa (la máquina ya avanzó); si el siguiente grupo no empezó, se queda en su lugar. Que el grupo propio de la falla haya arrancado no cuenta.
- Detalle de lote: la columna Orden partía los códigos de falla largos a mitad de número (`w-28` + `break-all` → `w-36` + `break-words`).
- Detalle de lote: `JSON.parse` del estado de servicios hermanos protegido (un JSON malformado tiraba todo el detalle).

### Cambiado
- Rate limiter: los usuarios internos (con token `INTERNAL`) ya no pasan por el límite de peticiones. El local NATea muchas pantallas/usuarios tras una sola IP y su polling + sockets agotaban el cupo de 10k/15min, bloqueando hasta el login. El portal de clientes (web) sigue limitado igual. Deja de depender de tener la whitelist de IP del local actualizada.

## [2026-07] — hasta el 22/07 (commiteado)

### Agregado
- Diseñadores en el portal: registro público de diseñadores, home propio, y creación de pedidos en nombre de sus clientes vinculados (con hold de aprobación si el cliente lo exige); panel admin de diseñadores y pantalla "Mis Diseñadores" del lado del cliente.
- Pedidos de prendas: flujo dedicado (formulario, catálogo de servicios de prenda y página de pedido) para artículos confeccionados.
- Multiempresa: administración de empresas y su configuración.
- Cliente Vista 360: pantalla que reúne órdenes, cuenta corriente y retiros de un cliente en una sola vista.
- Admin: edición de órdenes ya creadas y reportes de contabilidad (con reporte de caja central).
- Pedidos: selector de bobinas de tela de cliente integrado al formulario.
- CFE: previsualización del comprobante contra DGI y nota de crédito externa.

### Cambiado
- Cobranza: `EstadoCobro` sincronizado con caja y retiros (se cablea en los servicios de caja/retiro, con reversa en anulación) — antes órdenes entregadas quedaban como "no pagado".
- Urgencia y descuento por rollo configurables por área.

### Arreglado
- Fallas: validación de metros del grupo de falla obligatoria al finalizar el lote; total del grupo = suma de sus órdenes (no editable).
- Limpieza automática de lotes vacíos/huérfanos.
- Varios fixes de bloqueos SQL y transacciones huérfanas en producción (timeouts de edición CFE, entrega múltiple de retiros).

## [2026-06]

### Agregado
- Igualador de Color: pantalla nueva para matchear color desde foto calibrada, manual LAB→CMYK y chart de referencia, con backend de color y scripts de calibración.
- Tela de Cliente: saldo e inventario de metros de tela por cliente, estado de cuenta y widget de saldo embebido en formularios y recepción.
- Dashboard de Producción y módulo de Reportes/Analítica: tableros con gráficos por área/estado/prioridad, informes de producción y exportación a Excel.
- Integraciones externas: WMS para armar pedidos por cliente desde catálogo con carrito (más logística y recepción de ventas) y API de órdenes protegida por API key para conectar un ERP externo.
- Facturación electrónica: nota de crédito (CFE), pre-factura y billetera de cliente; bandeja CFE y facturación manual rehechas.
- Coordinación de producción y Canastos: ordenar la cola de pendientes por prioridad (falla/urgente/normal/reposición) y clasificar órdenes en canastos (Producción, Falla, Reposiciones, Incompletos, etc.).
- Venta de Rollo con Adelanto: pantalla para vender rollos cobrando adelanto, integrada con Caja.
- Portal de clientes: tickets de soporte con adjuntos ligados a orden/departamento, notificaciones push, y aviso automático por WhatsApp que marca la orden como "Avisado".

### Cambiado
- Máquina de estados centralizada (stateManagerService): un único servicio para cambiar estado de órdenes y rollos con historial automático.
- Logística de remitos: historial con búsqueda por código de orden, encomiendas con cliente y origen/destino; Despacho, Transporte y Recepción reescritos.
- Portal y fábrica: formulario de pedidos y vista de fábrica reescritos, con descarga masiva de archivos (panel flotante + thumbnails).
- Gestión de bobinas: detalle de lote reescrito, selector de bobinas por tela de cliente y "Devolución al Cliente" que cierra la bobina automáticamente.

### Arreglado
- Contabilidad: repos sin PedidosCobranza ahora se insertan en OrdenesDeposito; facturas mal generadas y desajustes de moneda en estados de cuenta.
- Rendimiento: lentitud por tormentas de refetch de sockets; manejo de errores de carga de chunks con recarga forzada.
- Caja y monedas: correcciones en arqueo y pagos, moneda IMD y banderas de saldo.

## [2026-05]

### Agregado
- Caja: adelantos/anticipos de cliente — pestaña de saldo, facturación de anticipo, vale de egreso y previsualización de cierre de ciclo.
- Analítica de producción: pantallas e informes con métricas por área/estado.
- Integración Sisnet: sincronización con sistema externo.
- Ventas: CRM de leads.

### Cambiado
- Retiros y cobranza: mejoras en pagos y devoluciones, y en el ciclo de cuenta corriente (adelantos aplicados a retiros).

### Arreglado
- Correcciones varias en caja, arqueo y sincronizaciones.

## [2026-04]

### Agregado
- Módulo de contabilidad/ERP integrado: Caja con sesiones de apertura/cierre y arqueo, venta directa, egresos, otros ingresos y numeración de documentos por secuencias.
- Facturación electrónica CFE con envío a DGI (bandeja de comprobantes, facturación manual y anulación) y Tesorería con cartera de cheques y catálogo de bancos.
- Contabilidad de fondo: plan de cuentas y libro mayor, motor de reglas contables configurable, reconciliación automática y manual, cuentas corrientes de clientes (deudas, ciclos, planes/billetera), reportes de antigüedad de deuda, estados de cuenta por email y cotizaciones editables con QR.
- Helpdesk: los clientes abren tickets por categoría con evidencia y responden en hilos desde el portal; panel interno para gestionar, derivar y resolver.
- Mercado Pago (Checkout Pro) como pasarela de pago, en paralelo a Handy.
- Web pública rediseñada: landing con video, Guías (PDF), Paletas de color, Plantillas, Términos, Privacidad, Trabajá con nosotros, Contacto y showroom.
- Portal: flujo completo de cuenta (registro, login, recuperación de contraseña por email) con validación de documento CI/RUT.
- Auditoría de depósito con escáner QR/código de barras (cámara + escaneo en vivo persistido) para controlar órdenes contra los códigos activos.
- API externa con API-Key para sincronizar clientes y vendedores con otro sistema.

### Cambiado
- Retiros web: estantes y empaques dinámicos desde la BD; el retiro postpago con Handy se crea recién al confirmarse el pago en el webhook.
- Refactors grandes de Transporte, sesiones activas de consola (SysAdmin) y módulos de Precios.

### Arreglado
- Idempotencia en el webhook de pagos (no procesar la misma orden dos veces).
- Acentos y caracteres corruptos en la UI de logística.
- Comprobantes de encomiendas (migración de nombres y regeneración) y sincronización de precios (cron).

## [2026-03]

### Agregado
- Contabilidad (arranque): cotizaciones/presupuestos, carga de pagos, cuentas corrientes, antigüedad de deuda, cuadre diario y excepciones de deuda.
- Caja: pagos y devoluciones con Handy.
- Tótem de retiros: app de autoservicio (dashboard + pantalla de tótem) para que el cliente se anuncie en el local.
- Retiros web: módulo dedicado (webRetiros), lugares de retiro y retiros impagos.
- Notificaciones push y aviso al cliente; login con Google.
- Portal: pantalla de precios para el cliente, catálogo de precios e historial de pedidos.
- Landing page pública y pantalla de recursos; resultado de pago (PaymentResult).
- SysAdmin: panel de administración del sistema.

### Cambiado
- Sincronización con Google Sheets reescrita (nuevo servicio de sheets).
- Estado de órdenes de retiro y depósito centralizado en servicios dedicados.

### Arreglado
- Correcciones en el flujo de retiros, pagos y sincronización de órdenes.

## [2026-02]

### Agregado
- **Portal de clientes** (nace el portal): los clientes arman pedidos online por técnica (DTF, sublimación, corte, bordado, estampado, costura), suben archivos y siguen sus retiros.
- Portal: alta con registro y verificación por mail, login, recuperación de contraseña y perfil, con vendedor asignado por cliente.
- Portal: checkout con pasarela Handy (módulo de cobranzas).
- Precios: perfiles de precios, precios base, especiales, calculadora y terminaciones Eco UV.
- Etiquetas: generador de etiquetas por lote.
- Máquinas: control por slots para montar/desmontar/recargar bobinas, con inventario de bobinas.
- Logística: stock de depósito e historial de rollos.
- Integraciones: sync con ERP y planilla de Google Sheets (cron), monitor en tiempo real, logs y CMS del portal.
- Atención al cliente: reposiciones que clonan los archivos del pedido original.

### Cambiado
- Descarga de archivos unificada (File System API + ZIP en streaming) y nomenclatura estándar "ORDEN_CLIENTE_TRABAJO Archivo X de Y".
- Formulario de pedidos del portal reescrito en servicios modulares por técnica.
- Tokens con expiración y renovación automática; lazy-loading del sistema interno; rediseño de navbar, dashboard y retiros responsive.

### Arreglado
- Solapamiento de sincronizaciones automáticas; acceso a Google Drive vía proxy.
- Descarga y medición de archivos; PDF de una página en DTF.

## [2025-11 → 2026-01] — Orígenes

- v1 del sistema (nov 2025): gestión de producción base en React + Node/Express + SQL Server.
- Refactor general del sistema de producción y primeras mediciones de archivos (dic 2025).
- Sincronización con el ERP estabilizada (numeración de órdenes 1/N, tinta/retiro, tablas de referencia, extras de terminación), auth en Despacho y Control de Transporte, lógica de recepción de inventario (códigos BOB) e integración legacy con búsqueda unificada (ene 2026).

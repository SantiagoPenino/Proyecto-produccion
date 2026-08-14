# Changelog

Historial de cambios del sistema de producción. Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/).

- Desde julio 2026 en adelante: una entrada por deploy, con fecha exacta.
- Lo anterior: reconstruido desde el historial de git, una entrada por mes (la granularidad por deploy no se registró en su momento).

---

## [2026-08-13] — Sin deployar

### Arreglado
- **Reasignar un lote a una máquina revivía órdenes ya despachadas** (incidente del 12/08 con 7 órdenes de DTF): asignar o desmontar un lote estampaba el estado sobre **todas** sus órdenes, incluidas las que ya estaban controladas, en un remito y viajando a Depósito. Esas órdenes volvían a "En Maquina", y cuando el camión llegaba, Depósito no las podía recibir: el candado de pedido completo las veía en producción y rechazaba el escaneo con un mensaje que nombraba justo la orden que el operario tenía en la mano. El sistema ya tenía la protección para esto (se aplica al iniciar, finalizar y pausar un lote), pero **faltaba en las dos operaciones de asignar/desmontar lote-máquina**, que son las que se usan desde el tablero. Ahora una orden que ya salió del área se queda quieta aunque su lote vuelva a una impresora.
- **Una orden podía quedar lista para despachar y "pendiente de imprimir" al mismo tiempo**: Control y Planeación llevaban cuentas separadas, y finalizar en Control no tocaba la marca de impresión. Después el lote rebotaba al finalizarlo con "faltan N órdenes sin marcar como impreso" por órdenes que ya estaban controladas y listas, y había que ir a tildarlas a mano. Ahora, cuando Control aprueba todos los archivos de una orden, la impresión queda marcada sola — por los cuatro caminos que la dejan pronta (Finalizar Orden, Finalizar Lote Completo, el control archivo por archivo y el cierre de reposición).
- **En EcoUV se podían mezclar materiales y tintas arrastrando órdenes entre lotes**: "Asignar a Lote" validaba que el lote fuera de un solo material y una sola tinta, pero **arrastrar entre lotes en Planeación no validaba nada** — por ese camino se armaba un lote mitad Ecosolvente y mitad UV, que no se puede imprimir de una pasada. Ahora las dos vías aplican la misma regla (la variante sigue pudiendo convivir, como estaba definido).
- **Miniaturas que no se veían nunca más, aunque el archivo estuviera bien**: una miniatura que fallaba la primera vez quedaba envenenada en el navegador. Pedir una inexistente devolvía la aplicación entera en lugar de un 404, el service worker guardaba esa respuesta como si fuera la imagen, y ya no había forma de recuperarla ni regenerándola en el servidor. Ahora `/thumbnails` responde 404 de verdad cuando no existe, y el service worker deja pasar esas peticiones directo a la red sin cachearlas.
- **Miniaturas que nunca se generaban por culpa del nombre del archivo**: el sistema decidía cómo procesar cada archivo mirando su extensión, así que un PDF sin extensión en el nombre (las matrices TPU migradas del sistema viejo) se intentaba abrir como imagen y fallaba, y los archivos de corte `.plt` llenaban el log de errores intentando algo imposible. Ahora se mira el **contenido real** del archivo: los PDF se rasterizan aunque el nombre mienta, y lo que no puede tener miniatura se saltea sin ensuciar el log.
- **Las reposiciones al cliente (`-R1`, `-R2`…) nacían sin miniatura**: la reposición reusa el mismo archivo del original, pero como no hay una subida nueva nadie generaba su miniatura — en Control se veía el ícono genérico y el modal de falla decía "sin vista previa". Ahora se copia la miniatura del archivo original, sin volver a descargar ni procesar nada.

### Agregado
- **TPU — la columna Fecha muestra el veredicto del cliente**: si el cliente aprobó el boceto, la fecha de aprobación aparece en verde; si lo rechazó, la del rechazo en rojo; y hasta que se expide, la fecha de ingreso como siempre. Es la última acción tomada — un rechazo nuevo pisa al anterior y aprobar borra el rechazo.

---

## [2026-08-10] — Sin deployar

### Arreglado
- **Lotes recién creados desaparecían con órdenes adentro** (caso lote 1224 de Sublimación): mover cualquier orden, en cualquier área, dispara una limpieza que **borraba físicamente** todo lote sin órdenes de toda la planta — incluido uno recién creado cuya carga venía en camino, porque el lote se crea en un request y las órdenes le llegan en requests aparte (y el chequeo de "vacío" tampoco ve asignaciones sin commitear). Las órdenes quedaban apuntando a un lote inexistente: la planilla las mostraba "En Lote" con su número, pero en Planeación el lote no estaba. Candados: la limpieza ya no toca lotes de **menos de 10 minutos** y su conteo ahora espera a las asignaciones en vuelo; asignar a un lote existente **verifica que exista y lo retiene bloqueado hasta terminar la carga** — si lo borraron en el medio, avisa con error claro en lugar de dejar órdenes huérfanas; mismo candado al mover órdenes entre lotes en Planeación, y los chequeos de lote vacío al retirar o cancelar una orden llevan la misma protección.

---

## [2026-08-06] — Sin deployar

### Agregado
- **Falla por copias**: reportar una falla ya no repone el archivo entero. El modal pregunta **cuántas copias** salieron mal y la orden `-F` nace con esa cantidad; las buenas se siguen controlando normal. El contador del control muestra `controladas/total` descontando las falladas, con la insignia `+N con falla` en ámbar (no en rojo, que hacía leer el total como si fueran fallas). La sanación al completar la reposición cura **solo esas copias** — parcial e idempotente, se puede reponer en tandas. TPU, órdenes de solo servicios y archivos de 1 copia siguen con el flujo de archivo entero de siempre.
- **Etiqueta de falla única por archivo**: antes salía una etiqueta por cada falla reportada; ahora se imprime **una sola** cuando el control del archivo se completa (controladas + falladas = total), listando todas las fallas registradas — título "N FALLAS REGISTRADAS" y, por cada una, máquina, lote, motivo y **qué copia fue** (`COPIA 3`, `COPIAS 2-4`).
- **ECOUV acepta .jpg** en la subida del portal, igual que Sublimación.
- **ECOUV — lotes sin secuencia**: cualquier orden del lote puede marcarse como impresa sin exigir que la anterior lo esté (la impresión en EcoUV no sigue el orden del lote).
- **Forma de envío solo en EcoUV**: el selector se ocultó del resto de los servicios del portal.

### Cambiado
- **Gestión de Clientes (`/admin/clientes-integration`) — lavado de cara completo**: tarjetas rediseñadas con el **ID Cliente como dato principal** (el nombre debajo), contacto con íconos, y **estado como punto de color** en lugar del avatar de iniciales — verde activo, rojo inactivo, ⃠ bloqueado; el color del avatar salía de la primera letra del nombre, no informaba nada. Los **duplicados** dejaron la barra lateral de 6 colores (1 de cada 4 clientes está duplicado; la grilla era una ensalada y la leyenda vivía escondida en un hover): ahora se **pinta en ámbar el dato repetido** en su propio renglón y una pastilla `⧉ N` dice cuántos clientes comparten el grupo — el clic trae a todos los hermanitos, que ahora se agrupan por cliente (comparte cualquiera de sus campos duplicados) y no por campo suelto. Modal ancho a dos columnas con secciones (Identificación / Contacto / Ubicación / Clasificación / Vínculos), desplegables HeadlessUI con caja normalizada al mostrar (Capital Case; el dato guardado no se toca), IDReact y CodReferencia solo lectura. Toolbar con filtros HeadlessUI que marcan cuándo están aplicados, contador de duplicados junto al de clientes, pestañas en la línea del título, paleta a brand-cyan con "Nuevo Cliente" en magenta, pantalla a sangre completa y entrada animada de las tarjetas (escalonada al filtrar; al tipear solo animan las que aparecen).

### Arreglado
- **Reactivar una orden la devolvía a un estado imposible**: al reactivar se restauraba el estado previo a la cancelación ("En Maquina", etc.), pero cancelar ya la había sacado del lote — y el lote pudo haberse impreso o borrado en el medio. La orden volvía como "En Maquina" sin máquina ni lote y quedaba en el limbo hasta que alguien la encontrara de casualidad. Ahora **reactivar deja siempre en Pendiente** (la orden, el pedido entero o el archivo suelto), al principio de la cola del área, donde se la ve y se re-planifica. El snapshot pre-cancelación se sigue guardando como registro.
- **Las previsualizaciones del portal mataban la PC al subir muchos archivos**: cada archivo rasterizaba su PDF varias veces (miniatura, croquis y modal por separado), cada `getDocument` levantaba su propio worker de pdf.js que quedaba vivo, y el render usaba `toDataURL`, que congela el hilo principal. Ahora hay **una sola rasterización compartida en caché** por archivo (miniatura y croquis la reusan), los workers se comparten y liberan, y el render va por `toBlob` + objectURL, que no bloquea. En números del profiler: `drawImage` 1.242 ms → 69 ms, `toDataURL` 642 ms → 0, workers 7 → 0.
- **Un PDF guardado con versiones medía la medida vieja**: Illustrator guarda "incremental": agrega la versión nueva al **final** del archivo y deja la vieja al principio. El medidor leía la cabecera, encontraba un MediaBox y cortaba ahí — reportaba la medida de la versión anterior (`roll up laboratorio_770x2000.pdf` medía otra cosa). Ahora se lee también la cola (hasta 3 MB), y ante ambas versiones **gana la de la cola**, que es la vigente.
- **Pedido de varios archivos con Tela de Cliente no se podía confirmar**: al agregar archivos, los nuevos ítems no heredaban el material del primero y quedaban sin material aunque "aplicar a todos" estuviera activo — el pedido se rechazaba con un error que no decía cuál era el problema. Ahora el material se hereda al agregar, el selector aparece en el ítem si falta, y **cuando hay un único material disponible queda elegido solo** (caso Tela de Cliente).
- **El usuario del portal no mostraba su nombre en la barra lateral**: si en el mismo navegador convivía una sesión de gestión con una del portal, la de gestión pisaba a la del portal al refrescar. La sesión del portal ahora tiene precedencia en el portal, y un error de red ya no borra la sesión guardada.
- **Detalle de lote — la orden saltaba de lugar al marcarla impresa**: con todo el lote ya impreso, marcar una orden recién agregada la mandaba al final de su grupo de tela en vez de quedarse donde estaba. El orden dentro del grupo ahora es estable.
- **Pantalla negra tras deploy**: los estáticos se servían sin política de caché coherente — el navegador mezclaba `index.html` nuevo con chunks viejos y la app moría en negro. Ahora `index.html`/`sw.js` van con `no-store`, los archivos con hash en el nombre son inmutables por un año, y el resto revalida cada hora.

---

## [2026-07-27] — Sin deployar

### Agregado
- **TPU — el cliente ajusta cómo va puesta cada textura**: además de elegir el material por zona, define su **escala** (1× a 3×, de a 0,5) y **lo corre dentro de la zona** con un joystick sobre el render. El recorrido del joystick es una repetición del dibujo y nada más: las texturas son seamless, correrlas un módulo entero da el mismo resultado. Todo queda guardado con la elección (`OrdenTexturasTPU`), así que producción fabrica exactamente lo que se aprobó — antes esos controles eran de sesión y se perdían al aprobar. La altura del relieve queda fija en el máximo. El barniz por zona pasó al cajón, junto a las muestras, y cada zona muestra en su chip qué textura tiene.
- **TPU — "BOCETO APROBADO" queda archivado como imagen**: al aprobar (o al definir el diseñador las texturas) se genera un PNG con el **parche renderizado de frente** y, al lado, la referencia de cada zona: mini mapa, muestra del material, nombre de la textura, escala y barniz. Va a **Archivos de Referencia** de la orden, con el mismo detalle en texto en las notas para leerlo sin abrir la imagen. Es el documento que mira producción para fabricar. Se reemplaza en cada guardado y nunca frena la aprobación: si falla el render o la subida, el pedido se aprueba igual.
- **TPU — el cliente puede volver a ver el 3D después de aprobar**: el botón "Ver 3D" del portal ya no depende de que el pedido esté esperando aprobación. Sirve en las dos vías — para revisar lo que eligió, o para ver lo que definió el diseñador — siempre en modo lectura.
- **Control de copias de a 10**: al lado del `+1` aparece un `+10` en los archivos de 10 copias o más. Una orden de TPU de 500 parches obligaba a apretar 500 veces. Además la tarjeta ahora muestra la **miniatura del PDF** (el boceto de producción) en vez del ícono genérico.
- **Tótem — autorización por token de dispositivo**: reemplaza el chequeo por IP fija (el local se muda y deja de tenerla). El equipo se activa una sola vez con `/totem?activar=<TOTEM_TOKEN>`, queda guardado en ese navegador y viaja en cada request. Además **cierra los endpoints del tótem** (`lookup`, `lookup-by-client`, `create-pickup`, `announce`), que estaban abiertos a cualquiera: el chequeo de IP anterior solo escondía la pantalla. Con `TOTEM_TOKEN` vacío queda abierto (dev / transición).
- **Descarga del lote archivo por archivo** (sin ZIP): se pide un manifiesto y cada archivo se baja y escribe apenas llega. Evita cargar el lote entero en memoria del navegador, muestra progreso real (`3/14 · archivo.pdf`, MB y velocidad) y un archivo caído ya no arruina la descarga completa. El ZIP queda como fallback donde no hay File System API (HTTP inseguro, Firefox, Safari).
- **MIMAKI — avance de impresión por copias**: las órdenes de un lote en MIMAKI cargan cuántas copias van impresas (contador `x/y`, como TPU) en vez del tick binario. El total sale de las copias del arte; `Impreso` se sigue derivando al completar.
- **Portal — vista previa en todas las áreas**: la miniatura del arte (imagen o 1ª página del PDF) estaba limitada a materiales de medida fija; ahora se ve en cualquier servicio y material. El modal ampliado se acota al viewport y la vista previa se rasteriza a mayor resolución (antes se generaba a 320 px y se mostraba diminuta). En **DTF** el arte se muestra sobre damero, respetando la transparencia real del PDF.
- **Detalle de lote — indicador de rapport / escala**: el ícono del ojo de cada orden se colorea según cómo se imprime el arte (morado = rapport, magenta = escala, gris = normal), con el detalle en el tooltip. Se reconoce de un vistazo sin agregar columnas.
- **Detalle de orden — marca de falla en los archivos**: cada archivo relacionado con una falla lleva su indicador, **aunque ya esté sanada**: `FALLA` y `REPONE FALLA` en magenta para lo que sigue abierto, `FALLA RESUELTA` en verde para lo cerrado. Antes no había forma de saber, mirando una orden, que alguno de sus archivos había pasado por una falla. Contempla las dos marcas que deja la cura según el camino (`[Reposición OK]` y `[Repuesto]`) y distingue si el archivo de la orden `-F` ya se controló OK.
- **Trazabilidad de la edición de archivos**: al cambiar medidas, copias o metros de un arte, el historial de la orden ahora registra **qué cambió** (`Ancho: 1.55 → 1.50 | Alto: 0.90 → 0.85`), no solo "Archivo modificado". Antes se podía editar la medida de un arte sin dejar ningún rastro, y después era imposible saber si el archivo había sido tocado a mano.
- **ECOUV — un lote, un material y una tinta**: la misma regla que ya regía en DTF e Impresión Directa, con dos diferencias: la variante **sí** puede convivir en el lote, y en cambio se restringe la **tinta** —que es lo que rutea el lote a la máquina, un lote mitad Ecosolvente y mitad UV no se imprime de una pasada—. Avisa al apretar "Asignar a Lote" y el backend lo vuelve a validar, tanto entre las órdenes seleccionadas como contra las que ya están en el lote elegido.
- Detalle de lote: las órdenes de **bandera confeccionada** muestran la cantidad de banderas además de los metros (3,6 m no dice si son 4 banderas de 0,9).
- Planeación: la card del lote muestra su **número** (`LOTE #636`) junto al nombre — el nombre lo pone el operario y se repite entre días, el número identifica el lote sin ambigüedad.
- Push al cliente cuando una orden **se reactiva** (contraparte del aviso de cancelación).
- **TPU — estados de área REALES**: `Esperando`, `Aprobado`, `Rechazado` (hijos de Pendiente) y `Diseñado` (hijo de Producción) existen ahora en `ConfigEstados`, solo para TPU. Enviar a aprobación deja la orden en **Esperando**; aprobar o rechazar escriben el estado de verdad (antes era solo un color pintado en el front); y al subir la 5ª capa del arte la orden pasa sola a **Diseñado**, con el estado general saltando a Producción. El tablero colorea desde el estado real: Aprobado emerald pulsante, Rechazado rojo pulsante, Diseñado emerald fijo.
- **TPU — migración de las matrices del sistema viejo**: script de una sola vez (`backend/scripts/migrar-matrices-tpu.js`) que trae las **188 matrices reusables** de la planilla "PARCHES TPU" (Apps Script) a la base, para que los clientes las vean en "Mis matrices" y las reusen. Idempotente y con `--dry-run`; resuelve el cliente contra `Clientes.IDCliente`, mapea los tipos de parche viejos a los artículos actuales (con el 8x8 → parche común, NO el de estrellas, que cuesta distinto), toma la versión más reciente cuando hay varias, renombra las capas (`CMYK.pdf`, `Spot 1-3`, `Corte.plt`) y genera la miniatura bajando el "diseño origen" de Drive, que entra como `BOCETO-`. Descarta reusos (el nombre `TP-###` delata que no son matrices), órdenes sin arte y canceladas. Plan completo en `docs/tpu-migracion-matrices-sheets.md`.
- **Detalle de orden — la medida del parche TPU** (`10 x 8 cm`, la que eligió el cliente) se muestra al lado de Material / Sustrato, leída de la nota.
- **Planilla — totales del pie por unidad**: se suman por separado los metros, los m² y las unidades de las filas (`1.56 m2 · 2 u`) en vez de todo junto bajo una sola unidad — un cuadro de ECOUV (producto terminado, `u`) entraba al total como metros. Vale también para el contador de seleccionadas.

### Arreglado
- **La matriz de TPU nunca se cobró**: el cargo (artículo 156, US$ 15) está escrito desde que existe el área, pero la condición que lo dispara comparaba contra un campo que el portal manda con **otro nombre** (`idServicioBase` contra `idServicio`), así que era siempre falsa. Todo pedido TPU de trabajo nuevo se cotizaba como si reusara matriz. El mismo campo muerto era la causa de que la **magnitud saliera en 0** — las órdenes mostraban "0 U" en todos lados.
- **TPU — la cantidad se pisaba sola**: `Ordenes.Magnitud` en TPU es la cantidad pedida en unidades, pero **cuatro** recálculos automáticos la derivaban de los archivos. Como las capas del arte no tienen metros, la dejaban en 0; y desde que existe la línea de matriz, un fallback pensado para órdenes de solo servicios la tomaba como magnitud y una orden de 15 parches quedaba en **1**. Los cuatro llevan ahora la excepción de TPU. El detalle de la orden tampoco la recalcula más: muestra la cantidad guardada.
- **Visor 3D — colores lavados**: el parche se veía gris donde el arte es casi negro y los amarillos salían pasteles. La base estaba a media rugosidad y el brillo especular tendía un velo blanco parejo sobre todo; contra un albedo oscuro ese velo valía varias veces el color real. Ahora el material es mate, que es lo que es un TPU, y la luz quedó calibrada para que el color llegue a pantalla como está en el PDF.
- **Visor 3D — el parche se reescalaba solo**: mostrar u ocultar los controles le cambiaba el alto al lienzo y obligaba a recalcular la cámara, así que el modelo saltaba de tamaño. También perdía contextos de WebGL al abrir y cerrar el visor varias veces, hasta que el navegador mataba el más viejo.
- **Visor 3D — las piezas sueltas del diseño desaparecían**: un escudo con estrellas flotando arriba perdía las estrellas. Para aislar una copia del arte (una plancha puede traer varias) se tomaba **solo la mancha conectada más grande** y todo lo demás se descartaba como "otra copia". Ahora se suman los **satélites** —piezas chicas y cercanas respecto de la principal—, que es lo que el corte físico une con TPU transparente; una copia repetida de la plancha no califica porque tiene un área comparable.
- **Visor 3D — el relieve se comía las piezas chicas**: la franja donde el relieve se apaga contra el filo del parche era de ancho fijo (18 px), pensada para un escudo. En una estrella de 50 px erosionaba la pieza entera y la textura quedaba en un puntito central. Ahora el degradado se escala **al tamaño de cada pieza** (distancia real al borde + radio interior por componente): el escudo mantiene su filo, la estrella apaga en un tercio de su radio.
- **Visor 3D — no se podía texturizar el fondo**: las zonas se medían por "tinta", que descarta lo casi blanco; una capa `Fondo` pintada de blanco puro quedaba vacía y se eliminaba como zona. Ahora se miden por **canal alfa** (qué pintó la capa, sea del color que sea), restando el contenido que no pertenece a ninguna capa — la salvaguarda que el descarte de blanco cubría.
- **Visor 3D — el parche quedaba descentrado**: la cámara apuntaba al centro del recorte, y una pieza con satélites arriba empuja ese recorte hacia arriba, así que el escudo colgaba bajo. Ahora mira al **centroide de la silueta** (la masa real), que además pasa a ser el pivote de rotación y el encuadre de la foto de aprobación. Y el centrado **sigue a la interfaz**: descuenta la franja inferior cuando aparece la fila de escala, y el cajón de zonas cuando es el panel angosto de desktop —en mobile ocupa el 78% y correr el parche lo sacaba de la pantalla—, todo animado y sin tocar el lienzo.
- **Portal — la pantalla se refrescaba sola mientras el cliente elegía texturas**: cada evento de socket disparaba un refetch de "Mis Pedidos" que encendía el `loading`, y ese spinner es un early-return que reemplaza la vista **entera** — al apagarse se remontaba todo, incluido el visor 3D, que volvía a rasterizar el PDF desde cero. Con el job de WhatsApp avisando casi continuo, eso pasaba cada 8 segundos. Ahora el refetch por socket es silencioso: actualiza los datos sin tocar la vista. De paso, el botón Refrescar pedía `?page=[object Object]` (se le pasaba el evento del click como número de página).
- **TPU — ninguna orden podía asignarse a un lote**: el botón exigía estado general "Pendiente", regla que vale para el resto de las áreas pero no para TPU, donde el arte se sube **después** de que el cliente aprueba el boceto: para cuando la orden está lista para imprimir ya pasó a "Producción". Quedaban todas afuera de todo lote. Ahora en TPU se pide "Producción" y las demás áreas siguen igual.
- **Etiqueta del lote en TPU**: decía "Metros totales — 15.00 m" en un lote de 15 parches. Ahora dice **"Unidades totales — 15 u"**. El progreso del control tenía el mismo problema: calculaba por metros, y como las capas del arte no tienen, caía a contar archivos y se quedaba clavado en 17% con todo controlado.
- **Auditoría de Depósito — no matcheaba NADA**: comparaba el código escaneado tal cual contra `OrdenesDeposito.OrdCodigoOrden`, pero la etiqueta física es `{NoDocERP}/B{idEtiqueta}` (`9471/B11575`) y el depósito guarda el código con prefijo de área (`SUB-9471`). Nunca coincidían: todo lo escaneado caía en "Falta Por Ingresar" y **las órdenes reales quedaban todas como extraviadas** (Activas y Extraviadas daban el mismo número). Ahora el código se normaliza —se le saca el `/B…` y el prefijo— y se compara por ambas formas, en el chequeo y en la carga inicial de la pantalla. Los desconocidos se listan con el código original que escaneó el operario. Las reposiciones (`-R`) y fallas (`-F`) siguen sin poder distinguirse de su madre: la etiqueta solo lleva el `NoDocERP`, que comparten.
- **Portal — medida fija: el rechazo no explicaba nada**: el flujo real es subir el arte y *después* elegir la tela, pero la validación de medida fija solo corría al subir el archivo. Con "Bandera Confeccionada" elegida después, no pasaba nada hasta el "Confirmar Pedido", donde el modal solo decía "hubo un problema al subir uno de los archivos" y mandaba a reintentar algo que nunca iba a entrar. Ahora avisa **apenas se elige el material**, el "Confirmar" corta antes de subir explicando el motivo, y detecta el caso más común (arte rotado: 0,85 × 1,50 en vez de 1,50 × 0,85) diciendo qué hacer. El modal de subida además muestra el error real del backend en lugar del texto genérico.
- **Portal — un arte grande no se podía subir desde el celular**: el navegador convertía el archivo **entero** a base64 para quedarse con 500 caracteres de un campo que no lee nadie, y después lo cargaba completo a memoria otra vez solo para contar las páginas. Un PDF de 77 MB pedía así unos 250 MB de RAM antes de mandar el primer byte: en una PC ni se nota (ese mismo día entraron archivos de 427 MB desde desktop), pero en un teléfono la subida moría sola y el cliente veía "hubo un problema al subir uno de los archivos" sin que al servidor le llegara nada. Ahora el tipo se detecta con los primeros 64 bytes y arriba de 25 MB no se cuentan páginas en el navegador — eso ya lo valida el backend con pdf-lib y rechaza con el motivo concreto. El archivo va directo a la red, sin copia en memoria.
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
- **TPU — el arte son 5 capas exactas**, ni una más ni una menos (antes el tope era 6 y no se exigía el mínimo). El boceto no cuenta: es lo que aprobó el cliente y vive en Referencias.
- **TPU — no se asigna a un lote una orden sin el arte completo**: al intentarlo, el sistema dice cuáles faltan (`TPU-9995 (2/5)`). Antes se podía mandar a imprimir una orden a medio diseñar.
- **TPU — el lote no se finaliza con órdenes sin terminar de imprimir**: pasa a tener el mismo bloqueo duro que Sublimación y DTF. ⚠️ Esto **desactiva la impresión parcial** en el área: hasta ahora las órdenes incompletas volvían solas a la Mesa de Armado conservando su avance para continuarlas otro día. Para liberar lo hecho hay que sacar la orden del lote a mano; la pausa sigue conservando todo.
- **TPU — el equipo que sigue a la impresora es el SAMURAI**: el modal de finalizar dice "Enviar a Samurai" y el lote se rutea a esa máquina. Con el lote ahí, la marca de las órdenes deja de ser "impreso" y pasa a ser **"cortado"**. Tampoco se imprime etiqueta de lote al finalizar la impresión (como en DTF).
- **Control de TPU — una línea por orden**: en vez de listar las 5 capas del arte, el control muestra **una sola línea** (`TPU-9995_Carbonero`) y las copias a controlar son la cantidad de parches. Lo que se controla son los parches, no los archivos; contarlos uno por uno no decía nada y dejaba el progreso en 1 de 5.
- **TPU — quién puede tocar las texturas**: si el cliente las eligió, el visor interno abre en modo ver y el botón dice "Ver en 3D"; el diseñador puede corregirlas levantando un candado, y eso queda en el historial. Si el cliente aprobó sin elegir, el botón dice "Seleccionar texturas" y abre editable. Del lado del cliente, aprobado el pedido, es solo mirar.
- **Detalle de orden — Archivos de Referencia muestra archivos y nada más**: se quitó de ahí el listado de texturas elegidas. Se ven y se corrigen en el visor 3D, que es donde se ve lo que se está tocando.
- **Portal — ECOUV y TPU usan el form interno**: dejan de redirigir al Google Form (el link y sus campos quedan comentados por si hay que revertir). Con Bordado y Corte queda el resto.
- **Portal — forma de envío en ECOUV**: solo **Retiro en el Local** y **Encomienda**; entrega coordinada y envío a domicilio no aplican. Se filtra al traer el nomenclador, así que el valor por defecto sale de la misma lista recortada.
- **Portal — el reuso de matriz pide alto y ancho**: los selectores se mostraban marcados con `*` pero esa rama del formulario salía antes de la validación, así que nadie los miraba y la medida no se guardaba. Ahora se exige igual que en trabajo nuevo y queda en la nota de la orden.
- **Portal — "Mis matrices" ya no depende del nombre de los archivos**: se listaba solo las órdenes con un archivo que tuviera `cmyk` en el nombre, así que una matriz terminada con las 5 capas subidas nunca aparecía si nadie las había nombrado así — y sin ningún aviso. Ahora basta con que la orden esté Finalizada/Entregada/Cerrada, y la vista previa sale del **boceto**, que es lo que el cliente reconoce.
- **Contacto**: el horario de atención pasa de 9-17 a **8-18**.
- **Nueva dirección del local**: Arenal Grande 2667 → **Inca 2228, Montevideo**. Actualizada en el footer, la página de contacto, el mapa del showroom (texto, popup, pin y link a Google Maps) y en los remitos y etiquetas de encomienda que se imprimen.
- **Historial del pedido sin tope**: la vista integral cortaba en 20 entradas sin avisar. Ahora hay un "ver más" que expande el historial **completo** (y vuelve a colapsar). En pedidos con varias órdenes hermanas cada evento se registra por orden, así que un solo "Ingresado" ocupaba 5 de las 20 líneas y el resto quedaba oculto.
- **Medida fija (banderas) — se elimina el fail-open**: si el material se imprime a medida fija y el arte **no se puede medir**, ahora se rechaza en vez de dejarlo pasar con un warning. En esos materiales la medida es lo único que importa, y por ese hueco entraban banderas sin el margen de confección (arte de 1,50 × 0,85 donde debía ser 1,55 × 0,90), imposibles de detectar después. La consulta de configuración sigue siendo fail-open: si falla, no se puede saber si el material aplica.
- **Finalizar lote**: el bloqueo por órdenes sin marcar como impreso/calandrado ahora es **exclusivo de Sublimación**. En el resto de las áreas se finaliza sin exigir el marcado.
- **Detalle de lote — agrupación**: las órdenes de falla se agrupan por material junto con las normales (antes iban a un grupo propio con header magenta). El indicador de falla pasa a la fila de la orden.
- **Código de las reposiciones — se ve el linaje**: la falla de una falla conserva el código de su origen y numera el eslabón (`SUB-9471-F13858` → `-F13858-2` → `-F13858-3`). Antes cada eslabón tomaba el ID de su propio archivo (`-F13858` → `-F13916` → `-F13917`) y por el código las tres parecían hermanas de la madre: no se veía que una salía de la otra. El sufijo `-N` pasa a significar siempre lo mismo — el siguiente número libre de ese linaje — y cubre también el caso de un archivo que vuelve a fallar después de repuesto.
- **TPU — el cliente aprueba por dos vías, con o sin texturas**: en el visor 3D, elegir texturas y confirmar **ya es aprobar** (un solo paso). Si aprieta el ✓ sin haber elegido, un modal le da los dos caminos: **"Aprobar — el diseñador elige las texturas"** o **"Elegir mis texturas (ver 3D)"**, que lo lleva directo al visor. Cuando las define el diseñador, el detalle de la orden se lo señala a producción con el botón **"Ver en 3D / elegir texturas"** (el mismo visor del portal montado en la app interna), y esas texturas llevan la marca "Diseñador" — no "Modificada", porque en esa vía es el flujo normal, no una corrección.
- **TPU — aprobado el boceto, el pedido ya no se cancela desde el portal**: el botón de cancelar desaparece y el servidor también lo rechaza. Mientras espera aprobación tampoco se puede eliminar — la salida es rechazar con motivo. De paso se cerró un hueco: el botón de "eliminar error" (para subidas fallidas) aparecía también en pedidos retenidos por aprobación (comparten el estado interno) y permitía borrar de un clic un pedido con el boceto ya diseñado; ahora ni aparece ni el servidor lo permite.
- **TPU — el cliente puede rechazar el boceto**: al lado del badge "Espera tu aprobación" van dos botones compactos, **✓ aprueba / ✗ rechaza**. Rechazar exige **explicar qué corregir** (motivo obligatorio, mismo modal que la cancelación); el texto queda en el historial y en la Nota de la orden. El pedido vuelve a producción y en el tablero del área la celda de estado se pinta: **verde** si el cliente aprobó, **rojo pulsante** si rechazó. El operario borra el boceto desde Referencias, sube el corregido y lo reenvía — ahí la marca roja se apaga. Al rechazar se descarta la elección de texturas (era sobre el boceto viejo).
- **TPU — el flujo se divide en fases y no se puede saltear**: antes de la aprobación el detalle de la orden solo deja subir **un PDF: el boceto de producción** (antes ofrecía "máx. 6" desde el arranque; si el archivo no se llama "boceto" se renombra solo). Con el boceto cargado, el uploader da lugar al botón de enviar a aprobación. Una vez que el cliente aprueba, **"Enviar a aprobación" no reaparece** (badge "Boceto aprobado") y el backend rechaza re-enviar — re-retener una orden aprobada la sacaba del flujo incluso estando en un lote. La fase queda persistida en `Ordenes.FechaAprobacionCliente` (columna auto-creada); el reuso de matriz queda exento (nunca pasa por aprobación).
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

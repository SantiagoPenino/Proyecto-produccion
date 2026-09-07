# TPU — El cliente sube el vector y el sistema genera las planchas

**Fecha:** 11/08/2026 · **Actualizado:** 04/09/2026 · **Estado:** IMPLEMENTADO el 04/09 (sin deployar) — ver §0.8; lo de abajo de §1 es el plan original.

Objetivo: el cliente sube un vector, el sistema verifica que lo sea, el cliente elige zonas
(por color, por clic o mezcla) y texturas, y el sistema genera la plancha con los parches
impuestos en filas y columnas + los PDFs `CMYK`, `Spot 1`, `Spot 2`, `Spot 3` y el corte.

---

## 0. Actualización 04/09/2026 — la bifurcación comercial y lo que cambió

### 0.1 Tres modos al pedir TPU (hoy hay dos)

| Modo | Quién hace la matriz | Cobra matriz (art. 156, US$ 15) | Cobra producción (152-155) | Flujo |
|---|---|---|---|---|
| **Trabajo nuevo** (como hoy) | la fábrica: boceto → aprobación → 5 capas | **sí** | sí | el actual, sin cambios |
| **Hago mi matriz** (NUEVO) | el cliente: sube vector → zonas → texturas → el sistema genera las capas | **no** | sí | este plan |
| **Usar matriz** (como hoy) | ya existe | no | sí | `/reuse-matriz`, sin cambios |

- El cargo de la matriz se inserta en `webOrdersController.createWebOrder` cuando
  `serviceId === 'tpu' && !exec.isExtra && areaID === 'TPU'` (línea ~1387). Para el modo nuevo
  alcanza con que el pedido viaje con un flag (`metadata.matrizPropia`) y ese INSERT se saltee.
  El reuso ya no pasa por ahí, así que no se toca.
- El selector "Trabajo nuevo / Usar matriz" que ya existe en `OrderForm` (TPU) pasa a tener la
  tercera opción. La cantidad mínima (`minCopies` 15) aplica igual.

### 0.2 El contrato de salida REAL (leído de `SCRIPT DE PRUEBA 1PDF.jsx`, 04/09)

El script que hoy corre en Illustrator ya **no** exporta un PDF por capa ni pasa por Corel. Produce:

| Archivo | Contenido | Cómo lo lee el RIP |
|---|---|---|
| **`<base> - Impresion.pdf`** | CMYK + Spot 1 + Spot 2 + Spot 3 en **un solo PDF**, como capas de Acrobat (`acrobatLayers = true`) **y** cada capa técnica repintada con su **tinta plana** | PhotoPrint **separa por tinta, no por capa** (comentario textual del script). Mapea por el **nombre de la Separation**: lo que va antes del paréntesis en el nombre de la capa — `Spot 1 (Relieve 1)` → `Spot 1`, `Spot 3 (Barniz)` → `Spot 3` |
| **`<base> - Corte.pdf`** | solo el troquel | tinta **`CutContour`** (convención SAi/Roland). Reemplaza al `.plt` por Corel del §6 |
| `<base> - Boceto.pdf` (opcional) | arte a tamaño real + cotas en cm + troquel en blanco sobre gris + leyenda de colores CMYK | no va al RIP: es lo que aprueba el cliente / revisa el operario |

Detalles del script que fijan el contrato: las capas sobrantes se **eliminan** de una copia
temporal (ocultarlas no las saca del PDF); relieve doble = misma geometría en Spot 1 y Spot 2;
el troquel puede llamarse `Corte`, `CutContour` o `Cut Contour`; `preserveEditability = false`;
compatibilidad Acrobat 7. Los 5 archivos separados (`CMYK.pdf`, `Spot N.pdf`, `Corte.plt`) de
`migrar-matrices-tpu.js` son el formato **viejo**, el de las matrices migradas de Sheets.

**Imposición (F2): es un paso del OPERARIO, no del cliente.** El script la hace con sliders al
generar: plancha 20–50 cm (default 30), copias por fila = `1 + floor((ancho − arte + 0,5) / (arte
+ sep))`, espacio entre copias −10..20 mm (default 0), entre filas default 5 mm, filas 1–20
(default 5), registros de 5 mm de diámetro a 5 mm del borde **solo en CMYK y Corte** (uno por
límite de fila), mesa recortada al contenido + 5 mm, grupo de copias centrado. Por eso el
entregable del modo "Hago mi matriz" es el **parche unitario** (los 2 PDFs de arriba con una
sola copia); la plancha la arma producción, con el mismo script de hoy o con su port.

### 0.2.1 Impacto en el sistema: el gate de "5 capas" y el filtro `%cmyk%` son del formato viejo

Hoy `CAPAS_ARTE_TPU = 5` gobierna en `ordersController`: el tope al subir (L187), el pase a
'Diseñado' con la última capa (L240), `enviarAprobacionTPU` en reuso (L665), el flag
`arteCompleto` (L1156), **el gate para asignar a lote** (L1475-1498) y la deducción de estado
(L2703); `measurementController` L693 asume "5 capas". Y el cliente, "Mis matrices" y el visor
3D encuentran el arte por **nombre de archivo** `LIKE '%cmyk%'` (fallback de `%boceto%`) en
`webOrdersController` y `prendasOrdersController`.

Con el contrato nuevo (**2 archivos**: `Impresion.pdf` + `Corte.pdf`) todo eso falla: el gate
nunca llega a 5 y `Impresion.pdf` no contiene "cmyk". **Decisión necesaria antes de F5:**
(a) adoptar el contrato de 2 archivos en todo TPU — `CAPAS_ARTE_TPU` → 2 y reconocer los
archivos por rol (`Impresion` / `Corte`, o mejor una columna de rol en `ArchivosOrden` en vez
de olfatear el nombre) —, o (b) mantener 5 para el flujo fábrica y 2 solo para matriz propia
(dos contratos conviviendo: frágil). Recomendación: **(a)**, porque el script que produce el
arte ya es el de 2 archivos; las matrices migradas quedan como excepción histórica.

### 0.2.2 Qué genera el servidor en el modo nuevo (F5 replanteada)

A partir del vector del cliente + `OrdenTexturasTPU`:
1. **`Impresion.pdf`** — un PDF, una página del tamaño del parche, con 4 capas OCG (`CMYK`,
   `Spot 1 (Relieve 1)`, `Spot 2 (Relieve 2)`, `Spot 3 (Barniz)`) y 3 Separations `Spot 1/2/3`:
   CMYK = trazados del vector con su color, silueta expandida 1 mm; Spot 1 = por zona, liso
   (path de la zona relleno) o textura (tile del catálogo recortado por clip al path de la
   zona), en tinta `Spot 1` al 100 %; Spot 2 = copia exacta de las zonas con `Altura = 2`, en
   `Spot 2`; Spot 3 = zonas con `Barniz`, en `Spot 3`. **Todo vectorial** — los trazados salen de
   fitz `get_drawings()` y se reescriben en el content stream con pikepdf; las texturas SVG ya
   son paths. Es lo mismo que hoy entrega Illustrator, sin rasterizar.
2. **`Corte.pdf`** — la silueta original (sin expandir) en tinta `CutContour`.
3. **`Boceto.pdf`** (equivalente al del script) para la revisión del operario (F6).

### 0.3 Tooling — lo que hay instalado HOY (verificado 04/09 en local)

El §5 original pedía `cairosvg`/`rsvg`/Inkscape para SVG→PDF y Clipper/Shapely para el offset.
**Ya no hacen falta:**

- **PyMuPDF (fitz 1.27)** abre SVG **como vector** y lo convierte a PDF conservando los trazados
  con su color de relleno (`get_drawings()` devuelve cada path con su `fill`). Cubre F1
  (verificar: cero imágenes en el árbol), F3 (agrupar por color sin pasar por `pdftocairo`) y
  la base de F5. También abre AI/PDF del cliente.
- **pikepdf 10.9** ya fabrica planchas Separation en `dtf_blanco.py` (`incrustar_spot`): la
  misma receta sirve para Spot 1/2/3 (una tinta por PDF, alternate CMYK 0,0,0,0, overprint, y el
  marcador vectorial para que PhotoPrint liste el canal).
- **numpy + scipy + scikit-image** disponibles: el **offset de 1 mm del CMYK** (§1) sale por
  morfología a 300 dpi (dilatación de 12 px) si se decide rasterizar; y la textura recortada a
  la zona se resuelve con máscaras, igual que hoy en el visor 3D.
- **NO están:** `cairosvg`, `shapely`, `cv2`, `svgpathtools`. No instalar sin pedir; con lo de
  arriba no se necesitan.
- **Pendiente de confirmar:** dónde corre Python en producción. `dtf_blanco.py` hoy corre en un
  lugar aún no identificado; el generador TPU necesita fitz+pikepdf en el VPS (o un worker).

### 0.4 Escala física de las texturas — hueco del plan original

El catálogo (`getTexturasTpu`) **no conoce el tamaño real de los tiles**: los SVG traen
`viewBox` sin unidades físicas (`width="294.997"`, sin `mm`), y el visor los escala por
**`repeticiones`** (default 2, sidecar JSON opcional) = cuántas veces entra la textura a lo ancho
del parche. Para el 3D alcanza; para **imprimir la textura como relieve** hay que fijar la
escala física. La decisión coherente es **WYSIWYG con el visor**: tile (mm) = ancho del parche
(mm) ÷ repeticiones × `Escala` de la zona — la plancha reproduce exactamente lo que el cliente
vio y aprobó. Alternativa: sidecar `mmAncho` por textura (más trabajo de catálogo, menos
fiel a lo aprobado). Va como decisión a tomar antes de F5.

### 0.5 Reuso del visor 3D — qué cambia y qué no

Hoy las zonas son los OCG (capas de Illustrator) del boceto del operario, rasterizadas a
máscaras alfa por capa (`Tpu3DViewer`, ~L1006-1035). En el modo nuevo las zonas salen del
**vector del cliente agrupado por color de relleno** (fitz `get_drawings()` → un grupo por
`fill`; el clic suma/quita formas). Si el generador entrega **una máscara por zona con el mismo
contrato** (`{ m, w, h }` sobre el mismo raster del arte), todo lo demás — elección de textura,
escala/offset, altura 1/2, barniz, PNG "BOCETO APROBADO", `OrdenTexturasTPU` — se reutiliza
sin tocar. El punto de entrada natural es una prop del visor: `zonas` externas en lugar de OCG.

### 0.6 Decisiones tomadas el 04/09 (por el usuario)

1. **Contrato de archivos — IMPLEMENTADO:** conviven los dos formatos. `CAPAS_ARTE_TPU` pasa a
   ser **máximo 5** y "arte completo" es tener **entre 2 y 5** (`CAPAS_ARTE_TPU_MIN = 2`,
   helper `arteTPUCompleto`) en los seis usos del gate de `ordersController` + espejo en
   `OrderDetailModal`. El pase a 'Diseñado' se dispara al llegar a 2. Caveat aceptado: una orden
   del formato viejo queda "completa" al 2º archivo — el operario sube los 5 antes de asignarla.
   Convención de nombre provisoria: `Impresion.pdf` → **`tpu<NoDocERP>-cmyk-spots.pdf`**
   (contiene "cmyk", así los filtros `%cmyk%` siguen funcionando); se renombra solo al subir
   ("después veré una nueva forma"). El de corte ya trae "corte".
2. **Sin revisión del operario ni aprobación** en el modo matriz propia: al enviar, corre el
   generador → produce las copias y los 2 PDFs → la orden **entra en 'Diseñado'** y sigue a
   producción tal como llega. Todo lo hace el cliente.
3. **Formato de entrada: PDF** (vector). AI/SVG se pueden sumar después (fitz los abre igual).
4. **Escala de textura: WYSIWYG** con el visor (confirmado): tile = ancho del parche ÷
   repeticiones × escala; corrimiento dx/dy en fracciones de tile. El editor del portal y el
   generador hacen la misma cuenta.
5. **Dónde corre Python en prod:** verificado por el usuario el 04/09 en el VPS —
   `/opt/suite_user/venv/bin/python` tiene fitz 1.28.2, pikepdf 10.12.0, scipy 1.18.0,
   scikit-image 0.26.0 y Pillow 12.3.0 (numpy incluido). Es el binario que ya usa
   `dtfBlancoService` (`PYTHON_DTF_BIN` o esa ruta). En 1.28 `import fitz` avisa deprecado: el
   generador importa `pymupdf` con fallback a `fitz`.
6. ~~Imposición en alcance~~ → el generador **sí** hace las copias. Parámetros del script:
   plancha 30 cm, 0 mm entre copias, 5 mm entre filas. **Decidido 04/09 (tarde):** una sola
   plancha de **alto máximo 50 cm**, **siempre filas completas** (sobran hasta columnas−1
   parches); si ni la plancha más alta alcanza la cantidad pedida, los archivos de impresión y
   corte llevan el sufijo **`-<N>copias`** (N = **veces que hay que imprimir la plancha** para
   cubrir el pedido; aclarado por el usuario tras TPU-20744) y queda en el historial de la orden.
7. ~~Separación entre copias y filas~~ → defaults del script (0 mm / 5 mm).
8. **Sangrado de 1 mm:** relleno con el color de la forma más externa de cada isla (confirmado).
9. **Corte sin trazado propio:** silueta exterior del arte, una por isla, sin huecos (confirmado).

### 0.7 Política de copias — CERRADA el 04/09

Decisión del usuario: **filas completas con sobrantes** (no la cantidad exacta), **alto máximo
de plancha 50 cm**, y si la plancha no alcanza la cantidad pedida, **`-<N>copias` en el nombre
del archivo**, con N = veces que se imprime la plancha (copias de plancha, no parches). Implementado en `Imposicion` de `tpu_matriz.py` (`max_alto_mm`,
`completar_filas`, `sufijo`) y en `IMPOSICION` de `tpuMatrizService.js`. Ejemplo con el escudo
de prueba (parche 70 × 82 mm, pedido 40): 4 por fila, 5 filas entran en 50 cm → plancha de
300 × 450 mm con 20 parches → se imprime 2 veces → `tpu<NoDocERP>-cmyk-spots-2copias.pdf`, y el
historial dice "imprimir 2 veces". **Tintas planas como el archivo de referencia** (04/09, caso
TPU-20744): alternativo de color (Spot 1 cian, Spot 2 amarillo, Spot 3 verde, CutContour
magenta), sin sobreimpresión (knockout), corte relleno, PDF 1.6. Con alternativo (0,0,0,0) +
sobreimpresión —la receta de la tinta blanca DTF— Drive y Acrobat pintaban las zonas de blanco
opaco encima del arte y el archivo se veía vacío; el RIP separa por nombre igual. Descartadas: ancho de plancha por variante (queda el fijo de 30 cm) y que
el operario imponga a mano.

### 0.8 Implementado el 04/09/2026 — "Hago mi matriz" de punta a punta

| Pieza | Archivo | Qué hace |
|---|---|---|
| Generador | `backend/python/tpu_matriz.py` | `analizar arte.pdf` (vector puro: 0 imágenes, 0 texto sin curvar; trazados con color y `d` SVG en coordenadas de página; agrupación por color) y `generar job.json` (2 PDFs del RIP + boceto). Arte CMYK = la página del cliente como Form XObject (colores intactos) + anillo de sangrado 1 mm; Spot 1/2/3 = zonas lisas o texturas SVG del catálogo repintadas con la tinta al 100 % y recortadas por clip vectorial; corte = silueta por isla (raster 600 dpi → contornos simplificados a 0,05 mm) en `CutContour`; imposición y registros del script; OCGs `CMYK / Spot 1 (Relieve 1) / Spot 2 (Relieve 2) / Spot 3 (Barniz)` y `Corte`, idénticos al PDF de referencia. ~2,5 s para 40 copias del escudo de prueba. |
| Servicio | `backend/services/tpuMatrizService.js` | Token del PDF (`uploads/tpu-matriz/<codCliente>-<uuid>.pdf`, TTL 24 h), `analizar`, `validarMatriz` (token del cliente, zonas sin trazados repetidos, texturas SVG del catálogo), cola serial `encolarGeneracion` → Python → Drive (área TPU) → `ArchivosOrden` (`tpu<NoDocERP>-cmyk-spots.pdf`, `-corte.pdf`, `-boceto.pdf`, TipoArchivo 'Impresion') + `ArchivosReferencia` ('MATRIZ FUENTE', 'MATRIZ JOB' para regenerar) + `OrdenTexturasTPU` (ElegidaPor CLIENTE, Altura 2 = doble) + `FechaAprobacionCliente`/`TexturasElige` → `changeOrderState` 'Diseñado'. Error → HistorialOrdenes `MATRIZ_PROPIA_ERROR` + marca en Nota. |
| API | `POST /web-orders/tpu-matriz/analizar` (multipart) | `webOrdersController.analizarMatrizTpu` → `{ token, analisis }`. |
| Pedido | `webOrdersController.createWebOrder` | `metadata.matrizPropia` se valida al armar la ejecución; no inserta el artículo 156; tras el commit encola la generación. |
| Portal | `OrderForm.jsx` + `Tpu3DViewer.jsx` en **modo `matriz`** (lazy) | Tercer modo "Hago mi matriz": PDF → análisis → **el visor 3D de siempre**, adaptado: el modelo se arma con el PDF del cliente, cada trazado del vector queda identificado en el raster (mapa de ids alineado al arte) para tocarlo en el parche, selección por color en el cajón, zonas creadas/sumadas/deshechas por el cliente, toda zona con relieve (liso o textura del catálogo, normal o doble = Spot 2, barniz, escala y corrimiento con el mismo pad), y "Listo" devuelve las zonas al form. Botón **2D/3D** en el header (vista de frente sin girar), disponible también en los modos cliente e interno. La medida en mm va en el panel del form (fija si el producto trae tope, editable si no). El editor 2D que hubo unas horas se eliminó (pedido del usuario: la referencia es el visor 3D). |

**Ajustes del 04/09 (tarde), tras las pruebas del usuario con TPU-20744/20745:**
- **Zonas excluyentes** en el generador, como en el visor: cada forma de zona se recorta (clip nonzero
  de la forma + clip even-odd del compuesto forma+tapas) con las formas de mayor seqno que no son de su
  zona. Antes el fondo liso tapaba en Spot 1 a las estrellas texturadas.
- **Vista PNG** `tpu<NoDocERP>-vista.png` (referencia 'VISTA MATRIZ'): arte + Spot 1/2/3 tintados al
  45 % + corte magenta + leyenda. El PDF del RIP pinta las tintas opacas encima del arte (igual que el
  de Illustrator) y en Drive no se ve el diseño debajo.
- **Ver en 3D una orden de matriz propia**: `GET /orders/:id/tpu-matriz` (+ `/fuente`) y
  `GET /web-orders/orden/:id/tpu-matriz` (+ `/fuente`) devuelven el job (zonas) + análisis y el PDF
  del cliente (referencias 'MATRIZ JOB' / 'MATRIZ FUENTE' de Drive). `Tpu3DViewer` exporta por
  defecto `Tpu3DViewerAuto`, que consulta eso y abre en modo matriz (solo vista, sin Listo); si la
  orden no es de matriz propia, abre como siempre. Antes el visor tomaba el boceto (parche unitario
  en hoja gris) como arte y la plancha de corte para la silueta → recorte incoherente (captura del
  usuario, TPU-20745).
- **PDF de control de capas** `tpu<NoDocERP>-capas.pdf` (referencia 'CAPAS CONTROL', 07/09, pedido como
  temporal): una página por capa del parche unitario (CMYK, Spot 1, Spot 2, Spot 3, Corte) más "todo
  junto", rotuladas con tinta y alternativo, con la silueta de corte en gris de referencia. Se apaga con
  `CAPAS_CONTROL = false` en `tpuMatrizService.js`. La vista PNG se compone desde sus primeras páginas.
- **Textura por tinta** (07/09, lo delató el PDF de control): el XObject de una textura se cacheaba una
  sola vez repintado con `Spot 1` y se reutilizaba en Spot 2; como un Form XObject usa sus propios
  recursos, las zonas dobles con textura iban a la tinta equivocada. Ahora se cachea por (textura, tinta).
- **Base blanca del modelo**: achique por distancia al borde (5 px), bisel hacia adentro
  (`bevelOffset: -BISEL`) y simplificación 0,6 px: asomaba en los tramos cóncavos.

Lo que NO hace todavía: el visor 3D del portal identifica relieve/barniz por archivos separados
(formato viejo), así que con el formato de 2 archivos no muestra el relieve — habría que leer
los OCG del `-cmyk-spots.pdf`; regenerar automáticamente en el reuso con otra cantidad (el job
y la fuente quedan guardados para eso); el color del sangrado usa una conversión RGB→CMYK
simple cuando el PDF del cliente es CMYK.

---

## 1. Lo que se confirmó (medido sobre los archivos reales)

**`Script TPU 240726v2.jsx`** (el que corre hoy en Illustrator) **no separa nada**: replica las capas
que el diseñador ya armó, las impone en grilla y exporta **un PDF por capa** prendiendo/apagando
visibilidad. La separación es trabajo humano previo.

**`TPU UV.ai`** (arte fuente, 35 × 10 cm) — medido con pdfjs:

| Capa | Trazados |
|---|---|
| CMYK | 31 |
| Corte | 2 |
| Spot 1 (Relieve 1) | 45 |
| Spot 2 (Relieve 2) | **45 — geometría idéntica a Spot 1** |
| Spot 3 (Barniz) | 2 |

- **Vector puro**: 0 imágenes rasterizadas, 0 patterns, 0 degradados.
- Spot 1 ≡ Spot 2 confirma la regla del relieve doble (todo el parche va alto en este arte).
- El relieve es **una sola tinta (negro)**; los colores viven en el CMYK.

### Reglas de negocio (confirmadas por el usuario)

- **Relieve 2 ⊆ Relieve 1, con la MISMA textura.** Zona con textura solo en Spot 1 = relieve normal;
  la misma textura en Spot 1 y Spot 2 = doble altura. Nunca texturas distintas entre ambos.
- **Las zonas las SELECCIONA el cliente; la geometría sale del diseño.** El cliente nunca dibuja: elige
  formas que **ya existen** en su vector, agrupando **por color** (todas las del mismo relleno),
  **por clic** (una a una), o mezclando ambas (arranca por color y suma/quita con clic). Una zona
  puede ser una forma o varias. La textura se aplica **adentro** de esa geometría. Mismo modelo que
  ya usa el visor 3D — lo único que cambia es de dónde salen las zonas (antes, capas OCG del boceto
  del operario; ahora, la selección del cliente sobre el vector plano).
- **La capa de relieve es una MÁSCARA BINARIA**: donde hay negro hay relieve, donde no hay nada no
  hay. De ahí salen los dos casos:
  - **liso** → la zona **entera** pintada de negro (superficie levantada uniforme). Es lo que tiene
    el archivo de ejemplo: 45 formas sólidas, todo el escudo liso y doble.
  - **con textura** → dentro de la zona se pinta **solo la textura** (rayas, puntos…); el resto queda
    vacío. **La textura ES la geometría del relieve**, no un relleno decorativo.
- **"Sin relieve" NO es una opción**: un TPU sin relieve es una impresión común. Toda zona lleva
  relieve. Por eso la elección por zona es solo: **liso o textura X** + **normal o alto** + **barniz**.
- **El sangrado sale del CMYK, no del corte** (corregido 11/08):
  - **Corte** = el borde del CMYK **exacto**, sin agrandar. Es la línea por donde pasa la cuchilla.
  - **CMYK** = esa misma silueta **expandida 1 mm hacia afuera**. El arte sigue más allá del corte
    para que no aparezca filo blanco si la cuchilla se corre.
  - O sea, el offset de polígono se aplica **al arte**, y la silueta original queda como troquel.
- **Plancha**: ancho 50 cm (el script permite 20–50, default 30).

### Parámetros de imposición (del script, listos para portar)

- Copias por fila: `1 + floor((anchoPlancha − anchoArte + 0.5) / (anchoArte + separación))`
- Alto de plancha: `altoArte×filas + espacioFilas×(filas+1) + 5mm + 2×5mm`
- Separación entre copias: −10 a 20 mm (default 0) · entre filas: default 5 mm
- Filas: 1 a 20 (default 5)
- Marcas de registro: círculos negros de **5 mm** de diámetro, a **5 mm** de cada borde lateral, en
  **cada límite de fila** (filas+1 pares), dibujadas **solo en CMYK y Corte**
- Mesa de trabajo recortada al contenido + 5 mm

---

## 2. Modelo de datos

`OrdenTexturasTPU` ya guarda por zona: `ArchivoTextura`, `Barniz`, `Escala`, `Altura`, `OffsetX/Y`.

**No hace falta ninguna columna nueva.** El schema actual ya alcanza:

| Campo | Qué decide |
|---|---|
| **`Altura`** | **1 = solo Spot 1 · 2 = Spot 1 + Spot 2** (la altura física *es* la cantidad de pasadas; el 3D usa el mismo número para el render) |
| `ArchivoTextura` | **NULL = liso** (zona entera en negro) · con valor = esa textura recortada a la zona |
| `Barniz` | va o no a Spot 3 |
| `Escala`, `OffsetX/Y` | cómo queda puesta la textura dentro de la zona |

`ArchivoTextura = NULL` **no es ambiguo**: como toda zona lleva relieve, NULL significa liso. No hace
falta un estado extra para distinguir "sin relieve", porque ese caso no existe.

**Generación por zona** (todas las zonas entran en Spot 1):

| Elección | Qué se dibuja en Spot 1 | Costo técnico |
|---|---|---|
| Liso | la forma de la zona, negro pleno | trivial: copiar el path y pintarlo |
| Textura X | la textura recortada a la silueta de la zona | `clipPath` + `pattern` en SVG (las texturas del catálogo ya son SVG → sale vectorial, sin rasterizar) |

Spot 2 = las zonas con `Altura = 2`, con **exactamente el mismo contenido** que en Spot 1.

---

## 3. Fases

| # | Fase | Qué entrega | ¿Garantizable? |
|---|---|---|---|
| **F1** | **Verificación de vector** | Al subir: cero rasters = vector (determinístico, ver §4). Veredicto al cliente en el momento. | **Sí, 100%** |
| **F2** | **Imposición** | Toma 5 capas ya armadas → plancha con registros → PDFs por capa. Port directo del script. | **Sí** — se verifica comparando contra la plancha del script con el mismo arte |
| **F3** | **Zonas desde vector plano** | `pdftocairo -svg` → agrupar por `fill` → UI de selección por color / clic / mezcla | Sí, con casos borde (degradados, trazos) |
| **F4** | **Elección por zona** | textura (o liso) + altura 1/2 + barniz. Reusa el visor 3D y `OrdenTexturasTPU` **sin cambios de schema** | Sí |
| **F5** | **Generación de capas** | zonas → Spot 1 / Spot 2 / Spot 3 + Corte (offset 1 mm) → alimenta F2 | Parcial — necesita revisión humana |
| **F6** | **Revisión del operario** | Los 4 PDFs quedan como **borrador** en el detalle de la orden: aprobar o reemplazar antes del lote | — |

**F2 sirve sola**: aunque no se haga nada más, el operario deja de abrir Illustrator para imponer.
Por eso va primero: es la mitad verificable y el riesgo se paga en el orden correcto.

---

## 4. Cómo se verifica que es vector (100%)

Regla estricta: **el PDF no contiene ni una imagen rasterizada**. No es heurística — el raster solo
puede entrar por XObjects `/Image`, imágenes inline (`BI…ID…EI`) o anidado en Form XObjects/patterns;
recorriendo el árbol completo, cero imágenes = dibujado íntegramente con trazados.

Lo que **no** garantiza ningún chequeo automático: que el vector *sirva* (autotrace con miles de
trazados basura, tipografías sin curvar, sin trazo de corte, RGB en vez de CMYK). Eso lo firma
producción — de ahí F6.

---

## 5. Dependencias nuevas

- **SVG → PDF**: `rsvg-convert`, `cairosvg` o Inkscape. Poppler solo hace el camino inverso.
- **Offset de polígono** (expandir el CMYK 1 mm; el corte va sin tocar): Clipper (JS) o Shapely.
- `pdftocairo` y `pdfimages` ya están (vienen con poppler, instalado para los thumbnails).

---

## 6. El `.plt` — se genera directo (saca Corel del flujo)

**Hoy:** el script exporta *Corte* a PDF → se abre en **Corel** → se exporta a `.plt`. Paso manual.

**Se puede generar directo.** El `.plt` es HPGL: texto plano con comandos elementales (`IN;`
inicializar, `SP1;` pluma, `PU x,y;` mover sin cortar, `PD x,y;` cortar). Un contorno de corte es una
polilínea. El procedimiento es: tomar la geometría de *Corte*, **aplanar las curvas Bézier** a
segmentos (tolerancia ~0,05 mm — es lo que hace igual el plóter internamente), convertir a unidades
de plóter (**40 por mm**) y escribir los `PU`/`PD`. Pocas decenas de líneas, sin dependencias nuevas.
Es de las piezas más simples del proyecto y elimina un paso manual del flujo actual.

### Dialecto — DECODIFICADO de `leones.plt` (muestra real que la cortadora aceptó)

**Cabecera fija:**
```
IN;                        inicializar
VS32,1; … VS32,8;          velocidad 32, plumas 1 a 8
WU0;                       unidades de ancho: métricas
PW0.350,1; … PW0.350,8;    ancho de pluma 0,35 mm, plumas 1 a 8
```

**Cuerpo:** un bloque por contorno, cada uno precedido por su `SP`:
- **`SP1`** → **marcas de registro**: polígono cerrado de 17 puntos (el círculo aproximado con 16
  segmentos).
- **`SP7`** → **contornos de corte** (el troquel del escudo).
- **`SP0;`** cierra el archivo.

**Geometría (medida sobre la muestra):**

| Dato | Valor |
|---|---|
| Unidades | **40 por mm** (marca de registro = 199 u = 4,97 mm ≈ los 5 mm del script) |
| Origen | **centro de la plancha** (coordenadas con signo en ambos ejes) |
| Eje Y | positivo hacia arriba |
| Plancha de la muestra | 270 × 485 mm |
| Disposición | 3 columnas × 5 filas = **15 escudos**, paso entre filas **96 mm** |
| Marcas de registro | 12 (6 filas × 2), en X = ±132,5 mm |
| Curvas | **aplanadas a segmentos** (escudo ≈ 57 puntos por contorno) |
| Contornos | cerrados: el último punto repite el primero |

**Conclusión: no queda nada que adivinar.** Generar el `.plt` es emitir la cabecera fija, aplanar las
curvas y escribir `PU`/`PD` en unidades de 40/mm con origen al centro. La verificación es directa:
generar el `.plt` del mismo arte y comparar contra esta muestra.

## 7. Pendiente de confirmar

- Medidas: ¿la separación entre copias y filas se deja elegir al cliente, o se fija?

# Migración de matrices TPU del sistema viejo (Google Sheets → SQL)

**Objetivo:** que los clientes que ya tenían matrices hechas en el sistema de Apps Script las vean en "Mis matrices" del portal y puedan reusarlas. Es una migración **de una sola vez**, no una integración viva.

Planilla origen: **PARCHES TPU** — `1GJWKnuGx5h47uJvf6GC5OtPZ_UBy90fxaRryYAKMMCQ`
Se lee con el OAuth que ya tiene el backend (`sheetsService.js` / `token.json`), sin permisos nuevos.

---

## 1. Qué hay en la planilla

### Hoja `BASE` — 484 filas, una por pedido

| Col | Campo | Ejemplo | Destino |
|---|---|---|---|
| A | ORDENES | `TP-1` | `CodigoOrden` |
| B | Marca temporal | `2/02/2026 9:57` | `FechaIngreso` |
| C | ID de Cliente | `chuki` | → `Clientes.IDCliente` → `CodCliente` |
| D | Nombre del trabajo | | `DescripcionTrabajo` |
| E | Tipo de parche | `Escudo (De hasta 8x8)` | `Material` |
| F | Cantidad | | `Magnitud` |
| G | Carga logo | link Drive | referencia (lo que subió el cliente) |
| J | ESTADO | `PRONTO` | filtro |

Estados: **394 PRONTO**, 79 CANCELADO, 5 vacío, 2 PARA CORTAR, 2 PARA IMPRIMIR, 1 CONFIRMADO.

### Hoja `MATRIZ` — 234 filas: el arte

| Col | Campo |
|---|---|
| A | ORDEN — `TP-37 HEROICA CELTICS` o `TP-37` a secas |
| B | SPOT — **varios links de Drive en una misma celda** |
| C | MATRIZ DE CORTE (1 link) |
| D | Marca temporal |

**El arte está completo.** La celda SPOT no trae un link sino varios, separados por coma:

| Links (SPOT + CORTE) | Filas | Total archivos |
|---|---|---|
| 4 + 1 | 215 | **5** ← las capas que espera el sistema nuevo |
| 5 + 1 | 18 | 6 |
| 3 + 1 | 1 | 4 |

⚠️ **Dos cosas rompen un join ingenuo:**

1. La columna A a veces le pega el nombre del trabajo (`TP-37 HEROICA CELTICS`). El cruce va por regex `TP-\d+`, no por igualdad de string.
2. **26 de los 195 códigos tienen más de una fila** — son *versiones* de la misma matriz, no órdenes distintas. `TP-37` tiene 4 subidas (tres el 19/02 con minutos de diferencia, correcciones; una el 23/03, un mes después) y en `BASE` figura **una sola vez**. Regla propuesta: **quedarse con la más reciente** por `Marca temporal`.

---

## 2. Alcance real

**No toda orden es una matriz.** En el sistema viejo, cuando el *nombre del trabajo* (col D) empieza con `TP-###`, esa orden **reusa** la matriz de ese código — en la interfaz se ven con el badge `MATRIZ LISTA`. Ej: `TP-345` se llama "TP-297 THIAGOARGENTINA" → reusa la `TP-297`. Migrarlas como matriz le mostraría al cliente la misma matriz repetida.

| | |
|---|---|
| PRONTO en BASE | 394 |
| …con arte en MATRIZ | 193 |
| …de esas, reusos (nombre `TP-###`) | 4 |
| **MATRICES REALES a migrar** | **189** |
| PRONTO sin arte | 201 |
| Reusos entre todas las PRONTO | 101 |
| Clientes distintos | 80 |
| …que resuelven a `CodCliente` | **79** |
| …sin match | **1** (`leopalla`) |

**Segunda pasada (07/08): las sin arte se migran con el DISEÑO ORIGEN.** Las órdenes sin fila en `MATRIZ` no se descartan más: usan la columna **G "Carga logo"** —el arte que subió el cliente al pedir— como único archivo, insertado como `BOCETO-<tp>`. Alcanza para que `reuseMatrizTPU` las acepte y para la vista previa. **Las 110 tienen al menos un link**, así que se rescatan todas.

⚠️ **No son matrices listas para fabricar.** Traen el diseño del cliente, no las capas de impresión: cuando alguien reuse una, producción tiene que hacer el arte desde cero. Se migran igual porque el cliente reconoce su diseño y puede pedirlo; la alternativa era no tenerlas.

**Total tras las dos pasadas: 298 matrices** (188 con arte completo + 110 con diseño origen).

Tres tablas de override en el script, con los casos resueltos a mano:

- **`DISENO_ORIGEN_INDICE`** — cuál de los links usar cuando hay varios (101 traen uno solo). `TP-256`, `TP-361`, `TP-417`, `TP-467` → el 2º; `TP-307` → el 5º. El resto usa el primero, y un índice fuera de rango cae al primero en vez de dejar la orden sin archivo.
- **`CANTIDAD_FIJA`** — `TP-409` = 15. El cliente escribió *"15 parches URUGUAY 2025 me imagino que ya tienen la matriz actual…"* en el campo de cantidad y el parser leía **152025 unidades**. Importa porque la Magnitud de la matriz decide si un reuso regenera el arte.
- **`ALIAS_CLIENTE`** — los 3 IDs que cambiaron entre la planilla y la base, verificados contra `Clientes.IDCliente`: `leopalla`→`leo.palla` (Palla y Palla), `voidnexus`→`Voidnexus.uy` (Fabiana Limpias), `germanlf34`→`GERMANLF` (German Lalinde). Cubren 5 órdenes.

---

## 3. Qué se inserta

Para que una orden aparezca en `getMisMatrices` tiene que cumplir sus tres condiciones: ser del cliente, `AreaID='TPU'` y `Estado` en `Finalizado`/`Entregado`/`Cerrado`.

**`Ordenes`** (una por matriz):

- `AreaID='TPU'`, `Estado='Finalizado'`, `EstadoenArea='Finalizado'`
- `CodigoOrden` = el original (`TP-37`). **No** se renombra a `TPU-nnnn`: el contador de pedidos nuevos vive en `ConfiguracionGlobal.ULTIMOPEDIDOWEB` y reusar ese rango invita a colisiones. Con el prefijo viejo se distinguen de un vistazo.
- `CodCliente` ← resuelto por `Clientes.IDCliente`
- `DescripcionTrabajo`, `Material`, `Magnitud`, `FechaIngreso` ← columnas D, E, F, B
- `UM='u'`
- `Nota` = `[MIGRADO-TPU-SHEETS]` — deja rastro del origen y permite deshacer la migración con un solo `DELETE`.

**`ArchivosOrden`** (5 por matriz en el caso normal): los 4 links de SPOT + el de MATRIZ DE CORTE, con `RutaAlmacenamiento` = el link de Drive tal cual. El reuso copia la misma ruta, no duplica el archivo en Drive.

Como el arte está completo, **una matriz migrada se puede reusar igual que una nativa**: si la cantidad coincide se copian las 5 capas y la orden entra derecho a `Produccion / Diseñado`; si difiere, cae en `[REUSO-REGEN]` como cualquier otra.

---

## 4. Decisiones abiertas (necesito tu OK)

### a) Qué versión de la matriz se migra — 26 casos

Los 26 códigos con varias filas en `MATRIZ` son versiones sucesivas del mismo arte. **Propuesta: la más reciente por `Marca temporal`.** Si en algún caso la buena es otra, hay que marcarlo a mano.

### a-bis) Las 18 filas con 6 archivos

215 traen 5 archivos (lo esperado) pero 18 traen 6 y una trae 4. `CAPAS_ARTE_TPU = 5` funciona como **tope al subir**, no se valida al insertar, así que entran igual. Queda decidir si a esas 18 se les migra todo o se recorta.

### b) Miniatura — RESUELTO: sale de "Diseños origen"

En el sistema viejo, cada orden tiene **DISEÑOS ORIGEN → VER ARCHIVO**: es la columna **G "Carga logo"** de `BASE`, el arte que subió el cliente. Es el archivo reconocible (no una capa de separación de color) y **está en las 188 sin excepción** (176 con un link, 11 con dos, 1 con tres).

La migración lo inserta como **una fila más de `ArchivosOrden` con el nombre `BOCETO-<trabajo>`**, y le genera el thumbnail bajándolo de Drive.

El nombre no es casual: `getMisMatrices` elige la vista previa con `NombreArchivo LIKE '%boceto%'`, así que la matriz migrada muestra imagen **sin tocar una línea de la query**, igual que una nativa. Y encaja con el modelo nuevo, donde el boceto es justamente el diseño que el cliente aprobó.

Quedan **6 archivos por matriz**: las 5 capas de arte + el boceto. Son ~188 descargas de Drive, corre una sola vez dentro de la migración.

> Detalle para el script: la extensión hay que sacarla del `mimeType` que devuelve la API de Drive, no del link (que no la trae). `generateThumbnail` necesita saber si es PDF o imagen.

### c) `leopalla` — RESUELTO: se saltea

Único cliente sin match contra `Clientes.IDCliente`. Decisión: **no se migra**, queda fuera de la corrida. Son las órdenes marcadas "Cliente sin match" en el Excel de revisión.

### d) ¿Dónde se corre?

La planilla y la base de producción son las que importan. Propongo correrlo **primero en local** contra la base local (que está al día), revisar las 193 en el portal, y recién ahí en producción.

---

### e) Artículo de cada matriz — 44 casos

**Esto no es cosmético:** `reuseMatrizTPU` copia `CodArticulo` y `ProIdProducto` de la matriz a la orden nueva, y con eso se auto-cotiza. Una matriz sin artículo genera un pedido que no se puede cotizar.

De los 9 "Tipo de parche" de la planilla, 4 existen igual en `articulos`:

| Tipo de parche (planilla) | N | CodArticulo / ProIdProducto |
|---|---|---|
| Parche (De hasta 10x8) | 109 | 152 / 413 |
| Parche con un maximo de 4 estrellas (De hasta 10x8) | 17 | 154 / 415 |
| Parche (Hasta 7,5 x 4) | 10 | 155 / 416 |
| Parche (Hasta 4x4) | 8 | 153 / 414 |

Los otros 5 son nombres viejos que ya no están en el catálogo. **Mapeo CONFIRMADO:**

| Tipo viejo | N | → Artículo | Criterio |
|---|---|---|---|
| Escudo (De hasta 8x8) | 30 | **152** / 413 | lo que antes era 8x8 hoy es "De hasta 10x8" |
| Etiqueta Producto Oficial (Hasta 4x4) | 6 | 153 / 414 | misma medida |
| Escudo con estrella (De hasta 10x8) | 5 | **154** / 415 | misma medida, **lleva estrellas** |
| Logo de Marca (Hasta 7,5 x 4) | 2 | 155 / 416 | misma medida |
| Logo de Marca (`TP-41`) | 1 | **153** / 414 | ver abajo |

⚠️ **Las 8x8 y las "10x8 con estrellas" NO son lo mismo**: van a 152 y 154 respectivamente, que tienen precio distinto (US$ 3,50 vs 4,50). Confundirlas descotiza el reuso.

`TP-41` ("Logo de Marca", sin medida en el nombre y sin tamaño de referencia cargado) se resolvió por el costo que quedó registrado en la planilla: **60,00 de Costo Pedido ÷ 30 unidades = US$ 2,00**, que es exactamente el precio de *Parche (Hasta 4x4)* en `PreciosBase`.

## 5. Plan de ejecución

**Paso 1 — Cerrar el mapeo de artículos.** Confirmar la tabla de arriba y resolver el único "Logo de Marca". Sin esto no se arranca.

**Paso 2 — Script `backend/scripts/migrar-matrices-tpu.js`.**
Lee la planilla con el OAuth que ya existe, aplica los mismos filtros del Excel de revisión y escribe. **Idempotente**: si ya hay una orden con ese `CodigoOrden`, la saltea, así se puede correr las veces que haga falta. Arranca en `--dry-run` (imprime el resumen sin tocar nada) y solo escribe con `--commit`.

**Paso 3 — Correr en local.** Verificar en el portal, con un par de los clientes de la lista, que "Mis matrices" las muestra y que un reuso genera la orden bien cotizada.

**Paso 4 — Producción.** Backup de `Ordenes` y `ArchivosOrden`, correr con `--dry-run`, comparar contra el Excel, y recién ahí `--commit`.

Para deshacer: todas quedan marcadas con `[MIGRADO-TPU-SHEETS]` en la `Nota`, así que se borran con un `DELETE` filtrando por eso.

## 6. Cómo se corre

Script de una sola vez en `backend/scripts/`, **idempotente**: antes de insertar chequea si ya existe una orden con ese `CodigoOrden`, así se puede repetir sin duplicar. Con `--dry-run` para ver el resumen sin escribir nada.

Antes de correrlo en producción: backup de `Ordenes` y `ArchivosOrden`.

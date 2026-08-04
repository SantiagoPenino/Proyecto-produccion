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

Las 201 sin arte no se migran: `reuseMatrizTPU` las rechaza con *"La matriz no tiene arte para reusar"*, así que **aparecerían en la grilla solo para fallar al usarlas**.

⚠️ **17 matrices que sí se usaron no tienen arte en la hoja MATRIZ** (`TP-15`, `TP-20`, `TP-21`, `TP-33`, `TP-164`, `TP-165`, `TP-277`, `TP-310`…). Hay órdenes PRONTO que las reusan, o sea que la matriz existe y se fabricó, pero los archivos no están en la planilla. Esos clientes se quedan sin poder reusar salvo que aparezcan en otro lado (¿carpeta de Drive? ¿col G "Carga logo"?).

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

### b) No va a haber miniatura

El thumbnail se genera al subir el archivo y vive en el disco del server (`backend/thumbnails/`). Estas rutas apuntan a Drive y nunca pasaron por ahí, así que las 193 van a mostrar **"SIN VISTA PREVIA"**.

Se puede resolver bajando cada archivo de Drive y generándole el thumbnail en la migración (~193 descargas, corre una sola vez). **¿Lo hacemos o van sin imagen?**

### c) `leopalla`

Un cliente sin match. ¿Se le busca el `CodCliente` a mano, o se saltean sus órdenes?

### d) ¿Dónde se corre?

La planilla y la base de producción son las que importan. Propongo correrlo **primero en local** contra la base local (que está al día), revisar las 193 en el portal, y recién ahí en producción.

---

## 5. Cómo se corre

Script de una sola vez en `backend/scripts/`, **idempotente**: antes de insertar chequea si ya existe una orden con ese `CodigoOrden`, así se puede repetir sin duplicar. Con `--dry-run` para ver el resumen sin escribir nada.

Antes de correrlo en producción: backup de `Ordenes` y `ArchivosOrden`.

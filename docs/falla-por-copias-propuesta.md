# Falla por copias (Control / Empaquetado)

> Estado: **IMPLEMENTADO el 05/08/2026** (sin deployar). La restricción temporal
> ("falla solo en la última copia") quedó ELIMINADA de `FileControlCard.jsx`.
>
> Heal parcial verificado con tests de integración contra la base local (datos
> sintéticos + rollback): cura completa, idempotencia, reposición insuficiente y
> whole-file legacy — los 4 casos OK.
>
> Alcance real de lo implementado = lo descripto abajo. TPU y servicios extra
> quedaron EXCLUIDOS (siguen whole-file); archivos de 1 copia sin cambios; si el
> body no trae `copiasFalladas` (front viejo), todo se comporta como antes.

## Archivos del flujo (hoy)

- Front:
  - `src/components/production/components/FileControlCard.jsx` — card por archivo.
    `canReportFalla = totalCopies <= 1 || controlCount === totalCopies - 1` (la restricción).
  - `src/components/pages/FilePrintControl.jsx` — vista Control. El modal de falla manda
    `{ archivoId, estado:'FALLA', motivo, tipoFalla, metrosReponer (no en SB), annotatedImage }`.
    Botón **CORREGIR FALLA** (`handleCorregirFalla`) → `completarOrden` de la -F y navega a la madre.
- Back (`backend/controllers/productionFileController.js`):
  - `postControlArchivo` (~387) — marca el archivo y, si `estado='FALLA'`, crea/reutiliza la -F.
  - `updateFileCopyCount` (~1487) — el "+" del conteo; tiene SU PROPIO heal (viejo).
  - `sanarFamiliaTrasReposicion` (~40) — la cura por familia (nueva, compartida).
  - `completarOrden` (~2024) — cierre de orden; si es -F sin fallas, cura la familia.
  - `confirmarFalla` / `liberarCanastaFalla` (~2372/2394) — confirmación y liberación del canasto.
- Tablas: `ArchivosOrden` (Copias, Controlcopias, EstadoArchivo, Observaciones),
  `Ordenes`, `FallasProduccion` (CantidadFalla = **metros**, ImagenFalla), `ServiciosExtraOrden`.

## Cómo funciona la falla HOY (whole-file) — verificado

1. **Reporte** (`postControlArchivo`, estado `FALLA`):
   - `ArchivosOrden.EstadoArchivo='FALLA'` → la card se bloquea (no se pueden contar las buenas).
   - Orden madre → estado `Con Falla` + `[Esperando Reposición]` en Observaciones.
   - **Código de la -F**:
     - Falla sobre la MADRE → `{raíz}-F{archivoId}`.
     - Falla sobre una -F → se conserva el linaje y se numera el eslabón (`-F13858` → `-F13858-2`).
     - Si el código ya existe (archivo que vuelve a fallar) → sufijo incremental `-2`, `-3`…
   - **Reutilización**: si la madre ya tiene una -F activa, NO se crea otra: se anexa la línea
     (nota `|| FALLA: …` + archivo agregado/actualizado en la -F). No aplica cuando falla una -F.
   - La -F clona la orden (Prioridad='Falla'; en SB: Magnitud '0' y hereda BobinaTelaID).
     El archivo clonado lleva **las mismas `Copias`** del original; `Metros` se pisa con
     `metrosReponer` si el operario lo cargó (fuera de SB), o 0 en SB.
   - `FallasProduccion` guarda metros (CantidadFalla), tipo, equipo e imagen anotada.
   - **Todo el pedido** (hermanas por NoDocERP en el área) → `EstadoLogistica='Canasto Falla'`.
2. **Estados al completar control**: con fallas → orden `Retenido` / `Esperando Reposición`.
   Una -F completada sin fallas → `Finalizado` directo + `Canasto Reposiciones` (nunca va a logística).
3. **Sanación** — hay **TRES caminos y DOS marcadores** (esto es lo que más cambió):
   - `updateFileCopyCount` al llegar el contador de la -F al total: heal **viejo** — busca por
     `split('-F')[0]` (solo la RAÍZ exacta, no los eslabones intermedios del linaje) y marca
     `[Reposición OK]` (~1557-1582). `Controlcopias = Copias` (todo de golpe).
   - `postControlArchivo` cuando la -F completa su control sin fallas (~1112) →
     `sanarFamiliaTrasReposicion`: cura la **familia entera** (NoDocERP, o raíz + LIKE '-F%'),
     archivos por NombreArchivo y servicios por Descripción, marca `[Repuesto]`,
     limpia `[Esperando Reposición]` de órdenes sin fallas pendientes.
   - `completarOrden` (botón CORREGIR FALLA) (~2177) → `sanarFamiliaTrasReposicion`.
   - Tras curar, si el pedido no tiene nada sin resolver → `req._liberacionData` avisa al front
     y el operario confirma la liberación (`liberarCanastaFalla`: Canasto Falla → Canasto Produccion).
4. **TPU**: en `updateFileCopyCount` el tope NO es `Copias` sino `Ordenes.Magnitud` (parches).
   El badge de fallas del front reconoce ambos marcadores (`[Repuesto]` / `[Reposición OK]`).

## Problemas con copias múltiples (siguen)

- **Bloqueo**: reportada la falla, el archivo entero queda `FALLA` y no se controlan las buenas.
- **Repone de más EN COPIAS**: la -F clona `Copias` tal cual. En metros está mitigado a mano
  (`metrosReponer`), pero el conteo de la -F exige controlar `Copias` completas y el heal pone
  `Controlcopias = Copias` en la madre: el modelo sigue siendo todo-o-nada por archivo.
- Por eso la regla temporal: solo se permite reportar en la última copia.

## Modelo propuesto: falla por copias (ajustado a 2026-08)

- Modal de falla: campo **"copias falladas"** `f` (default 1, máx = `Copias - Controlcopias`).
- Madre **no se bloquea**: `EstadoArchivo` queda `Pendiente` (u otro no-FALLA) mientras queden
  buenas por contar; `CopiasFalladas += f`.
- La -F lleva `Copias = f` (y si se REUTILIZA una -F que ya tenía el archivo: **sumar** `f`,
  no pisar — hoy ese UPDATE pisa Metros y deja Copias como estaban).
- Completo del archivo madre = `Controlcopias + CopiasFalladas >= Copias`.
- **Heal parcial** al cerrar la -F: `madre.Controlcopias += f_repuestas`, `CopiasFalladas -= f`;
  si `Controlcopias >= Copias` → `OK`.

### Cambios necesarios (mapa real)

- **DB**: `ArchivosOrden.CopiasFalladas INT NOT NULL DEFAULT 0` (con `ensureFallaColumn`-style
  auto-ALTER como ya hace este controller).
- **`postControlArchivo`**:
  - Recibir `copiasFalladas`; con `f < copias restantes` NO setear `EstadoArchivo='FALLA'`
    (solo acumular el contador) — pero SÍ disparar el tren de estados de pedido
    (Con Falla / Canasto Falla / [Esperando Reposición]), que hoy cuelga de la falla.
  - Stats de completitud (~836-845): hoy `FALLA` cuenta como "controlado" y `Fallas>0` se
    detecta por estado. Con parciales: `Fallas` debe contar también `CopiasFalladas > 0`, y
    "controlado" del archivo parcial = `Controlcopias + CopiasFalladas >= Copias`.
  - La -F: archivo con `Copias = f`; en reutilización, `Copias += f`.
- **`updateFileCopyCount`**:
  - Permitir "+" con `CopiasFalladas > 0` (hoy el front bloquea por `isFailed`; el back no valida).
  - Completo = `Controlcopias + CopiasFalladas >= Copias` (ojo TPU: ahí el tope es Magnitud —
    definir si TPU entra al modelo por copias o queda whole-file).
  - Su heal viejo (~1557): pasar a heal PARCIAL, y decidir el linaje: hoy cura solo la raíz
    (`split('-F')[0]`); debería curar la orden DUEÑA del archivo fallado (por FallasProduccion
    o por linaje del código), no la raíz a ciegas.
- **`sanarFamiliaTrasReposicion`**: hoy pone `EstadoArchivo='OK'` a todo archivo FALLA con ese
  nombre en la familia. Con parciales: si `CopiasFalladas > 0` y no llega al total → sumar, no
  marcar OK. Mantener el comportamiento actual para fallas whole-file viejas (compatibilidad).
- **`completarOrden`**: nada extra si la cura queda encapsulada en `sanarFamiliaTrasReposicion`.
- **Front**:
  - `FileControlCard`: quitar `canReportFalla` (la restricción), no bloquear la card con falla
    parcial, badge "N en reposición", tope visual = `Copias - CopiasFalladas`.
  - `FilePrintControl` (modal): input "copias falladas"; `metrosReponer` puede autosugerirse
    como `f × Metros` del archivo (editable, como hoy).
- **`FallasProduccion`**: agregar `CopiasFalla INT NULL` (CantidadFalla sigue siendo metros —
  no romper el informe de producción que la consume).

### Decisiones tomadas (05/08/2026, confirmadas por el usuario)

1. **TPU se excluye** del modelo por copias (su contador ya es por Magnitud/parches, no por
   Copias del archivo). Igual que hace la -R con su Magnitud (ver abajo).
2. **Falla parcial sobre una -F: SÍ se permite**, con la misma mecánica de sufijos/linaje;
   la -F hija lleva `Copias = f` de la -F padre.
3. **La orden madre con solo fallas parciales va igual a `Canasto Falla` + `[Esperando
   Reposición]`** — el pedido no se despacha incompleto; lo único que cambia es que el
   conteo de las copias buenas no se frena.

## Referencia clave: la -R (reposición de cliente) YA es parcial por copias

Revisado `createCustomerReplacementOrder` (~1694) + `CustomerReplacementPage.jsx`: el flujo
de reposición de cliente ya implementa "reponer f copias de un archivo". Sirve de molde:

- **UI**: por cada archivo seleccionado, inputs de **metros y copias a reponer** con tope en
  los originales (`CustomerReplacementPage.jsx` ~107-176, ~381-398). El modal de falla puede
  copiar este patrón.
- **Validación de límites** (~1736-1757): `copiesReq <= copiesOrig`, `metersReq <= metersOrig`.
- **Archivo clonado con las copias ELEGIDAS**, no todas: `INSERT ... Copias = @Copias`
  (~1839-1854). Exactamente lo que la -F necesita hacer con `f`.
- **Magnitud de la repo = suma real de lo repuesto según UM** (metros o copias), con **TPU
  excluido explícitamente** (~1889-1905). Ese mismo bloque sirve para la -F — hoy la -F solo
  tiene un fallback parecido cuando Magnitud quedó en 0 (~781-793); unificar.
- **Sufijos**: raíz sin apilar + `-R{n}`. OJO: usa `COUNT(*)+1` (frágil si se borró una);
  la -F usa `MAX(usados)+1`, que es el patrón a conservar.
- `FallasProduccion` se registra por archivo con metros (CantidadFalla) y EquipoID de la
  máquina original.

**Lo que la -R NO resuelve** (y sigue siendo lo nuevo a construir): la **sanación**. La -R es
una orden independiente — la madre ya está entregada, no hay heal (solo resetea el aviso WSP
de la madre en depósito al completarse, ~1167-1178). Toda la complejidad del heal parcial
(3 caminos, 2 marcadores, linajes) es exclusiva de la -F.

### Puntos a probar

- Falla 1 de 3 → -F repone 1; se controlan las otras 2; al cerrar la -F la madre queda 3/3 OK.
- Falla 2 veces el mismo archivo (1 hoy, 1 mañana) con la MISMA -F activa → Copias de la -F
  suma 2, no pisa.
- Falla todas (3 de 3) → equivalente al whole-file actual.
- Falla parcial sobre una -F (linaje -2) → hereda `f`, cura al eslabón padre, no a la raíz.
- Archivo de 1 copia → comportamiento idéntico al actual.
- Falla whole-file vieja (CopiasFalladas=0, EstadoArchivo='FALLA') → sana como hoy, por
  cualquiera de los TRES caminos.
- SB: -F con Magnitud '0', metros cargados en la impresora, BobinaTelaID heredada.
- Liberación del Canasto Falla: recién cuando no queda NADA sin resolver en el pedido
  (parciales incluidos: `CopiasFalladas > 0` cuenta como sin resolver).

## Etiqueta de falla (cambiado el 05/08/2026)

Antes salía UNA etiqueta por cada reporte de falla. Ahora sale **una sola por archivo,
cuando queda RESUELTO** (contadas + falladas = total), **listando todas sus fallas**
(tipo, copias, metros y observación de cada una — `FallasProduccion` del ArchivoID).

- Dispara desde los DOS caminos que pueden resolver el archivo: el propio reporte de
  falla (`postControlArchivo`, si esa falla consumió lo último contable) o el conteo de
  la última copia buena (`updateFileCopyCount` → responde `imprimirEtiquetaFalla` +
  `fallasArchivo`, y la card avisa vía prop `onFallaResuelta`).
- Whole-file, servicios, TPU y archivos de 1 copia quedan resueltos EN el reporte →
  para ellos la etiqueta sigue saliendo en el mismo momento que antes (con 1 ítem).
- La impresión vive en `FilePrintControl.printFailureLabel({ order, file, fallas })`.

## Solución temporal (ELIMINADA el 05/08/2026)

La restricción `canReportFalla` ("solo en la última copia") se sacó al implementar el
modelo por copias: el modal ahora pregunta cuántas fallaron y la -F repone solo esas.

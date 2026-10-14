# Spec B — Pedidos · Bandeja · Proyectos · Plantillas · Archivo

Source folder: `C:\Users\Santiago\Desktop\New folder\Desarrollos - paquete para Sistemas\codigo\`.
Modules: `mod-pedidos.js`, `mod-bandeja.js`, `mod-proyectos.js`, `mod-plantillas.js`, `mod-archivo.js`.
The writes that modules delegate through `DP.cruce(name, …)` are implemented in the host page, in
`puente (incluido en la pagina principal).js`. The same code is embedded in `pagina-principal.html` L2094-2216, apart from 2 small diffs listed in §7.
Host helpers that the bridge calls live in `pagina-principal.html`, cited as `PP:Lnnn`. Examples are `DEF_PLANTILLAS` PP:L1024, `tplPasos` PP:L1128, `saveProj` PP:L1323, `setStep` PP:L1175 and its wrapper at PP:L1991, `nextCode` PP:L1474, `newPrevios` PP:L1151 and `logEv` PP:L1156.
All UI text below is verbatim Spanish from the code.

---

## 0. Shared concepts used by these 5 screens

### 0.1 Session and roles (`base.js:sesion`, bridge `DP.conectar`)
`DP.sesion()` returns `{nombre, id, puede, admin, rol}`, built as follows:
- `nombre` = `YO || me.name`. `YO` is the person picked at login (PIN login against `config/equipo`).
- `puede` = `canWrite && !!db`. It means "can write at all": create requests and comment.
- `admin` = `isAdmin` (`user.canEdit() || user.isOwner()`; default `true` in local mode). It means "editor of the development team".
- `rol` = `rolDe(YO)`, taken from `config/equipo.miembros[].rol`. Values are `'desarrollo'` (default, "Equipo de desarrollo") or `'vendedor'` ("Vendedor") (`ROLES`, bridge L11).
- **Vendor routing**: if `rol==='vendedor'`, the overridden `render()` (bridge L119) only ever mounts `pedidos`, so a vendor sees nothing but the Pedidos screen. Non-vendors also have a "Pedidos" tab. The tab list (PP:L2234) is: Inicio, Bandeja, Proyectos, Planificación, Tareas, Muestras, Pedidos, Catálogo técnico, Archivo, Reportes. Plantillas opens from the "más" menu button `#tplBtn` (bridge L94).

Permission matrix as implemented in these modules:
| Capability | Condition |
|---|---|
| Create a pedido (Pedidos screen) | `puede` |
| Comment anywhere | `puede` |
| See/edit Bandeja cards, load a pedido in Bandeja, posponer, descartar, reabrir, edit request fields | `puede && rol!=='vendedor'` (`mod-bandeja.js:puede`) |
| **Aprobar** (create project / add variant) | the above **and** `admin` (button hidden otherwise; text `Aprobar lo hace quien administra la herramienta.`) |
| Borrar a solicitud | `admin` (and `puede`) |
| Edit a project ficha (anything) | `admin && db` (`mod-proyectos.js:edita`) |
| Edit templates / tipos de desarrollo | `admin && db` (`mod-plantillas.js:admin`) |

Server-side checks in the bridge are only partial. `guardarProyecto` (for codigo, archivos, desarrollo, proveedor and costo_estimado), `guardarPuntaje`, `guardarPlantilla` and `borrarPlantilla` throw `{aviso:true}` errors. `saveProj` silently does nothing when `!isAdmin`. `cancelarProyecto`, `reactivarProyecto` and `borrarProyecto` have **no** admin check. The rebuild must enforce all of this in the API.

### 0.2 Puntaje (identical formula in `base.js:puntaje`, `mod-bandeja.js:puntaje`, host `scoreOf` PP:L1142)
```
E = +puntaje.estrategico || 3 ; C = +comercial || 3 ; X = +complejidad || 3 ; R = +recursos || 3   (each 1..5; 0/empty → 3)
urg = 0; if fecha_limite: d = (new Date(fecha_limite) - now)/86400000 ; urg = d<=7 ? 3 : d<=30 ? 1.5 : 0   (past dates → 3)
puntaje = round1( (3E + 2C) / (X + R) + urg )
```
- The value is shown with a comma decimal (`String(n).replace('.', ',')`). The range is 0.5 to 15.5.
- Criteria UI (`CRIT`, `mod-bandeja.js` L10 and `mod-proyectos.js` L167) is `[key, label, label-for-1, label-for-5]`:
  `estrategico` "Estratégico" nada/clave · `comercial` "Comercial" poco/mucho · `complejidad` "Complejidad" simple/compleja · `recursos` "Recursos" pocos/muchos.
- Each criterion is a select 1..5. Options read `1 · nada`, `2`, `3`, `4`, `5 · clave` (low label on 1 and high label on 5 only). The default is 3.
- Host help texts (`CRIT` PP:L1087) exist but these modules don't show them: Estratégico "¿Abre un rubro, fideliza clientes clave, nos diferencia?"; Comercial "Volumen y ventas esperadas: ¿se va a producir mucho?"; Complejidad "Moldería, confección, pasos nuevos."; Recursos "Horas del equipo, muestras, insumos e inversión." The host also explains the formula (`scoreTxt` PP:L1148): `beneficio {3E+2C} (estratégico E×3 + comercial C×2) ÷ recursos {X+R} (complejidad X + recursos R) [+ urg por fecha límite]`.

### 0.3 Bitácora (history) entries (`DP.log` / host `logEv`)
- Each entry is `{fecha: ISO, autor: userId|null, quien: session nombre, accion, detalle (≤300 chars)}`. The array keeps only the last 200 entries.
- It is shown in a collapsed `<details>` titled `Historial de cambios`, newest first. Each line reads `dd/mm/yy · <b>quien</b> · accion: detalle`. When the array is empty the text is `Sin registros.`.
- Solicitudes and productos have `bitacora`. Productos also have `historial` = `[{estado: etapaId|'publicado', fecha}]`, which is appended only when the current stage changes (last 80 entries kept).

### 0.4 Comments (`base.js:comentarios*`)
- Stored in the shared collection `comentarios` as `{ref, texto (trimmed, ≤2000), autor: userId, quien: nombre, fecha: ISO}`.
- `ref` = `'solicitudes/'+id` for requests and `'productos/'+id` for projects. The same thread is visible in Pedidos (vendor) and Bandeja (team).
- Comments are listed in ascending date order as `<b>quien||'Alguien'</b> · dd/mm/yy` followed by the text. When there are none the text is `Sin comentarios todavía.`.
- Input: textarea with placeholder `Escribí un comentario o una pregunta…` and a button `Enviar`. On failure a toast says `No se pudo enviar el comentario.`.
- Comments cannot be edited or deleted, and there are no notifications or mentions.

### 0.5 Attachments (`base.js:subir/fotosHtml`)
- Upload: each file goes to the asset store and is saved as `{id, tipo: contentType, nombre, url? (only for data: URLs)}`.
- Messages: `Subiendo {name}…`. A rejected type shows `Ese tipo de archivo no se puede subir: usá JPG, PNG o PDF.`; any other error shows `No se pudo subir {name}.`. An error stops the remaining files.
- Display: images are 60×60 thumbnails that zoom on click. Other files show a chip with `PDF` or the extension (up to 6 chars, uppercase) linking to the file in a new tab. In editable mode a `✕` removes the item from the array.
- Upload happens immediately on file pick, so a draft that is never saved leaves orphan assets.

### 0.6 Project stage and progress helpers (base.js; documented by the other agent, summarized here)
- **Stages of a project**: `p.etapas` if the project has custom stages (copied from its template), otherwise the 5 defaults `DP.ETAPAS`:
  `definicion` "Definición" #5b7cff · `desarrollo` "Desarrollo técnico" #0a8fb8 · `muestra` "Muestra y aprobación" #3f9a2a · `industrializacion` "Industrialización" #d9822b · `lanzamiento` "Lanzamiento" #d1236b.
- Task states (`ESTADOS_TAREA`): `pendiente` Pendiente, `en_curso` En curso, `en_espera` En espera, `hecho` Hecho, `no_aplica` No aplica. A task is "pending" when its state is not `hecho` and not `no_aplica`.
- **Current task** `tareaActual(p)` is the first pending task in stage order. It is null when the project is cancelled.
- **Stage of a project** `etapaDe(p)`: `'cancelado'` if `estado_general==='cancelado'`; otherwise the stage of the current task; `'publicado'` if no task is pending. "Publicado" means "terminado" and the project goes to Archivo.
- `avance(p)` = `{h: tasks hecho, t: tasks not no_aplica, pct}`. `atrasadas(p)` = pending tasks with `fecha < hoy`.
- Líneas (`LINEAS`): `sublimacion` Sublimación, `directa` Impresión Directa, `ecouv` EcoUV.
- Tipos de desarrollo default (`TIPOS_DES`): `producto` Producto (producto:true), `tecnologia` Tecnología, `maquina` Máquina, `proceso` Proceso, `procedimiento` Procedimiento, `sistemas` Sistemas. The list can be overridden by `config/desarrollos.tipos` (§4.4). `esProducto(o)` is true when the record's `desarrollo` type has `producto:true`. A missing `desarrollo` field counts as `'producto'`.

### 0.7 Codes
`nextCode(list, prefix)` (PP:L1474) works as follows:
- It takes every record whose `codigo` starts with the prefix and reads the number as `parseInt(codigo with non-digits stripped)`.
- It returns the prefix followed by `max+1`, zero-padded to 2 digits, e.g. `PD-53` or `SOL-07`.
- Prefixes: `SOL-` for requests, `PD-` for new projects, `CO-` for correction projects. Legacy data also has `PS-` codes.
- The number is computed client-side, so concurrent creates can collide. The rebuild should generate codes server-side.

---

## 1. Pedidos (`mod-pedidos.js`): the vendor screen

**Purpose and users**: the "Vendedor" (role `vendedor`) loads what customers ask for and follows each request's outcome. Vendors see only this screen. Team members can also open it from the "Pedidos" tab.
**Writes**: only `crearSolicitud` and comments.
**Reads**: `solicitudes` (subscription), `comentarios`, and `DP.proyectos()`. The bridge maps the latter to `{id, nombre, codigo, cancelado, etapa: etapaLabel(etapaActual), listo: etapaActual==='publicado'}` (bridge L98).

### 1.1 Layout (`dibujar`)
- Title `Pedidos`, followed by the hint `Hola{, nombre}. Cargá acá lo que te piden los clientes y seguí en qué quedó cada pedido.`
- If `sesion.puede`, the **Nuevo pedido** form is shown (§1.2). Otherwise the screen shows `Estás en modo lectura: no podés cargar pedidos.`
- `Mis pedidos {count}` heads the list (§1.3).

### 1.2 Form "Nuevo pedido"
| Field (label) | key | type / limits | required | default | placeholder |
|---|---|---|---|---|---|
| Qué piden | `titulo` | text, maxlength 120 | **yes** (`Escribí qué piden.`, focus returns to the field) | '' | `Ej.: camiseta de ciclismo manga larga` |
| Detalle | `descripcion` | textarea 3 rows, maxlength 4000 | no | '' | `Medidas, tela, terminaciones, cantidad, para qué lo quieren…` |
| Cliente | `cliente` | text 120 | no | '' | `Para quién es` |
| Para cuándo (opcional) | `fecha_limite` | date (YYYY-MM-DD) | no | '' | — |
| Fotos o PDF (opcional) | `imagenes` | file input `accept="image/*,application/pdf" multiple`; uploads immediately; ✕ removes from the draft | no | [] | if there is no asset store: `En esta vista no se pueden subir archivos.` |

**Submit** `Enviar pedido`:
- The button is disabled while sending (`S.enviando`).
- It calls `DP.cruce('crearSolicitud', {titulo: trim, descripcion: trim, cliente: trim, fecha_limite, imagenes, tipo:'solicitud'})`.
- The payload has no `desarrollo`, so the request gets `'producto'`. It has no `pedido_por`, so the bridge uses the session name `YO`.
- On success the draft resets and the status text reads `Pedido enviado. Lo ves abajo, en «Mis pedidos».`
- On failure the alert reads `No se pudo enviar el pedido.` and `sinPermiso(e)` runs.
- Typing in any field clears both messages.

What `crearSolicitud` stores (bridge `xCrearSolicitud` L15). This is the full solicitud document shape:
```
codigo: nextCode(sols,'SOL-'), tipo: (valid TIPOS key || 'solicitud'), estado:'nueva',
titulo, descripcion||'', corrige_id:'', familia:'', etiqueta:'', linea:'', cliente||'', cantidad:'',
fecha_limite||'', links:'', imagenes||[],
contacto:{nombre:quien, telefono:'', email:''}, pedido_por: quien (= d.pedido_por || YO || me.name),
desarrollo: d.desarrollo||'producto', puntaje_solicitante:{}, puntaje:{estrategico:3,comercial:3,complejidad:3,recursos:3},
requiere:[], opiniones:[], autor: me.id, autor_equipo: rolDe(quien)!=='vendedor',
pasos_previos: newPrevios(quien), bitacora:[{… accion:'Cargó', detalle: `${TIPOS[tipo].l}: ${titulo}`}],
creado: ISO, actualizado: ISO
```
- `newPrevios` (PP:L1151) creates 6 pre-steps. Each is `{id, nombre, responsable, fecha, estado, hecho_el, nota}`:
  `registro` "Registro" (estado hecho, responsable=quien, fecha=hoy, hecho_el=now) · `aclaracion` "Aclaración con quien la cargó" · `viabilidad` "Viabilidad técnica" · `comercial` "Análisis comercial" · `estimacion` "Estimación y puntaje" · `decision` "Decisión en conjunto". All except the first are `pendiente`.
- These steps are not shown in the 5 modules of this spec. They do appear as tasks in the Tareas screen (host `workItems`), and completing one moves the request from `nueva` to `en_evaluacion` (`setStep` 's' branch PP:L1186).
- Host `TIPOS` labels (PP:L1079) are used in the bitácora text: idea "Idea o sugerencia", solicitud "Solicitud", orden "Orden", correccion "Corrección", variante "Variante u opción nueva".

### 1.3 "Mis pedidos"
- **Filter** (`mios`): solicitudes where `norm(pedido_por) === norm(sesion.nombre)` or `norm(contacto.nombre) === norm(sesion.nombre)`. `norm` lowercases, strips accents and collapses non-alphanumerics. Nothing is shown when the session name is empty.
  This is a name match, not an ID match. It also catches requests that the team loaded in Bandeja with "Lo pidió" set to the vendor's name. The filter runs client-side over **all** solicitudes, so the rebuild should filter server-side.
- **Sort**: `creado` descending. There are no other filters or sorts.
- **Row header** (a button that toggles expand, one open at a time): `<b>titulo</b> · dd/mm/yy(creado) [· cliente] [· N comentario|comentarios]` plus a status pill on the right.
- **Motivo block** (always visible when the status has a motivo, not only when expanded): label `Motivo` followed by the text.
- **Expanded**: `descripcion` (pre-wrap), `Para el dd/mm/yy` if there is a fecha_limite, the images (read-only), and `Comentarios`, with a writable thread if `puede`.
- **Empty state**: `Todavía no cargaste ningún pedido.`
- The vendor cannot edit or cancel a request after sending it. The only follow-up channel is comments.

### 1.4 Status shown to the vendor (`estado(s)`)
| Condition (in this order) | Pill text | css class | Motivo shown |
|---|---|---|---|
| `s.estado==='rechazada'` | `No se hace` | `no` (accent/red) | `s.motivo || s.evaluacion` |
| `s.estado==='pospuesta'` | `Pospuesto` + (`fecha_revision` ? ` · se vuelve a ver el dd/mm/yy` : '') | `pospuesto` (warn) | `s.motivo || s.evaluacion` |
| `aprobada` and the project `producto_creado_id` is not found (deleted) | `Aprobado` | `desarrollo` (cyan) | — |
| `aprobada` and the project is cancelled | `Se canceló el desarrollo` | `no` | — |
| `aprobada` and the project is `listo` (all tasks done, i.e. publicado) | `Listo` | `listo` (ok/green) | — |
| `aprobada` otherwise | `Aprobado · en desarrollo ({etapa label})` | `desarrollo` | — |
| anything else (`nueva`, `en_evaluacion`) | `Recibido` | `recibido` (grey) | — |

Notes:
- `p.etapa` is always a non-empty label, so the parentheses always appear, e.g. `Aprobado · en desarrollo (Muestra y aprobación)`.
- A paused project still shows "en desarrollo".
- For an approved **variante**, `producto_creado_id` is the *parent product*. The vendor therefore sees the parent product's stage or "Listo", not the variant's own progress.
- The fallback to `evaluacion` (the team's internal evaluation note) can expose internal notes to the vendor when `motivo` is empty, which happens with legacy data. Bandeja always sets `motivo` on a decision.

### 1.5 Live behaviour
- The screen subscribes to `solicitudes` and `comentarios` and redraws on change.
- `refrescar()` skips the redraw while the user is typing a non-empty comment.
- Focus and caret are preserved across redraws through `data-fk`.

---

## 2. Bandeja (`mod-bandeja.js`): intake and decision

**Purpose and users**: the development team (any non-vendor with `puede`) triages everything that comes in (pedidos, ideas, orders, corrections, variants) and decides on each one: approve and create a project (admin only), postpone, or discard.
**Writes**: directly to collection `solicitudes` for edits, decisions, reopen and delete. Through cruces for `crearSolicitud` and `aprobar`.
**Reads**: `solicitudes`, `comentarios`, `DP.proyectos()` (for the product pickers and the "Ver el proyecto" label), `DP.plantillas()`, `DP.listas().familias`, `DP.equipo()` and `DP.tiposDes()`.

### 2.1 Enums (verbatim)
- `TIPOS` (request kind), as `[value, form label]`:
  `solicitud` "Pedido" · `idea` "Idea" · `orden` "Orden (hay que hacerla)" · `correccion` "Corrección de un producto" · `variante` "Variante de un producto".
  The short label `tipoLbl` (used on cards and in the filter) strips ` (…)` and ` de un producto`, giving Pedido / Idea / Orden / Corrección / Variante.
- Request `estado` values: `nueva`, `en_evaluacion` (both count as "open"), `pospuesta`, `aprobada`, `rechazada`.
  Pill labels (`ELBL`): nueva/en_evaluacion "Por resolver", pospuesta "Pospuesta", aprobada "Aprobada", rechazada "Descartada". Open cards show no pill.
- Status filter chips (`ESTADOS`): `abiertas` "Por resolver" (= nueva or en_evaluacion) · `pospuesta` "Pospuestas" · `aprobada` "Aprobadas" · `rechazada` "Descartadas" · `todas` "Todas". The default is `abiertas`.
- Sort options (`ORDEN`): `rec` "Recomendado para atender" (default) · `puntaje` "Mayor puntaje" · `nuevas` "Más nuevas" · `viejas` "Más viejas" · `limite` "Fecha límite más cercana".
- `desarrollo` values come from `DP.tiposDes()` (§0.6).

### 2.2 Header, tools, chips, list
- Header: `Bandeja` followed by a count badge `{N} por resolver`. N counts all open requests and ignores the filters.
- `+ Cargar pedido` button appears if `puede` (§2.6).
- Search (`type=search`), placeholder `Buscar por título, código, cliente o quién lo pidió`. It normalizes the query and splits it into words, and **every** word must appear in `norm(titulo+codigo+descripcion+cliente+quien+familia)`. `quien(s)` = `pedido_por || contacto.nombre || quien`.
- Filter `Desarrollo` (`DP.filtroDes`): `Todos` + tipos. It matches `tipoDes(s)`, where a missing value counts as `producto`.
- Filter `Tipo`: `Todos` + the 5 short labels. It matches `s.tipo` exactly.
- `Ordenar` select (§2.3).
- Status chips with counts. Each count = requests that pass search, tipo and desarrollo **and** that chip's status. The list shows the selected chip's subset.
- Empty state:
  - No requests at all: `Todavía no entró ningún pedido.`
  - The filter is `abiertas` and there is no query and no tipo filter (the desarrollo filter is ignored here): `No queda nada por resolver.`
  - Otherwise: `Nada coincide con el filtro.`

### 2.3 Sort logic (exact)
- `puntaje`: §0.2, descending.
- `rec` (recommended), descending. `rec(s)` adds the following to `puntaje(s)`:
  - `+5` if `tipo==='orden'`.
  - If `fecha_limite`: with `d` = calendar days from today to fecha_limite (noon-to-noon), add `+4` if `d<0` (overdue) or `+2` if `d<=7`.
  - `+3` if `estado==='pospuesta'` and `fecha_revision <= hoy` (review date reached).
  - `+ min(3, ageDays/14)`, where age is measured from `creado`.
  - The fecha-límite urgency is therefore counted twice: once inside puntaje (+3 or +1.5) and again here (+4 or +2).
- `nuevas` / `viejas`: `creado` string descending / ascending.
- `limite`: `fecha_limite` ascending (empty sorts as `'9999'`, i.e. last); ties go by puntaje descending.

### 2.4 Card (`tarjeta`)
- Thumbnail: first attachment whose `tipo` is not pdf. Otherwise a placeholder `sin foto`.
- Title button `titulo || 'Sin título'` toggles the detail/edit panel. Only one panel is open at a time.
- Right side: puntaje badge (title "Puntaje", comma decimal) and the status pill if the request is not open.
- Meta line, in order:
  - `codigo` and the short tipo label.
  - **bold desarrollo name** (only if not a product type).
  - `pidió {quien}` and `cliente {cliente}`.
  - `dd/mm/yy` (creado) and `N comentario|comentarios`.
  - Deadline badge (only for open requests with a fecha_limite): `vencido el dd/mm/yy` if before today, otherwise `para el dd/mm/yy`.
- `Motivo` block: shown if the request is not open, not `aprobada`, and `motivo || evaluacion` exists. The block shows that text.
- Pospuesta with `fecha_revision`: `Volver a verlo el dd/mm/yy`, plus ` · ya es momento` if `fecha_revision <= hoy`.
- Action row (replaced by the decision box when a decision is in progress for this card):
  - If `puede` and the request is (open **or** `pospuesta`):
    - If admin: `Aprobar y crear proyecto` (for tipo `variante` the label is just `Aprobar`).
    - If not admin: the hint `Aprobar lo hace quien administra la herramienta.`
    - `Posponer`, **only if open**.
    - `Descartar`, if open or pospuesta.
  - If `producto_creado_id`: link `Ver el proyecto[: {nombre}]`, which calls `DP.abrirProyecto(id)` and opens the project ficha.
  - If `puede` and `rechazada`: `Reabrir`.
  - Aprobada requests have no decision buttons.

### 2.5 Detail / edit panel (`detalle`, `draftDe`, `guardar`)
The draft is copied from the request when the panel opens:
```
{titulo, descripcion, cliente, cantidad, fecha_limite, tipo||'solicitud', corrige_id, familia, desarrollo: tipoDes(s),
 evaluacion, puntaje:{estrategico:3,comercial:3,complejidad:3,recursos:3, ...s.puntaje}, imagenes: clone}
```
| Label | key | control | limits / options |
|---|---|---|---|
| Qué piden | titulo | text | 120; required on save (`Falta el título.`) |
| Detalle | descripcion | textarea 3 rows | 4000 |
| Cliente | cliente | text | 120 |
| Cantidad | cantidad | text (free) | 60 |
| Para cuándo | fecha_limite | date | — |
| Desarrollo de | desarrollo | select `tiposDes()` | re-renders on change |
| Tipo | tipo | select of the 5 full `TIPOS` labels | re-renders on change (toggles the Producto field) |
| Familia del ERP | familia | select: `— sin familia —` + `listas.familias` (+ the current value if not in the list) | defaults (PP:L1093): Banderas, Calza, Camisetas, Campera, Canguros y Buzos, Chomba, Gorros, Media de compresión, Media deportiva, Prendas, Productos del Local, Remeras, Shorts |
| Producto (only if tipo is `correccion` or `variante`) | corrige_id | select `— elegir producto —` + **all** projects (any state) sorted by name (es), label `nombre · codigo` | — |
| Puntaje (opcional) · resultado {X} | puntaje.{4} | 4 selects 1..5 (§0.2) | the result recalculates live using the draft's fecha_limite |
| Nota de evaluación (opcional) | evaluacion | textarea 2 rows | 2000; placeholder `Viabilidad, qué falta saber, con quién se habló…` |
| Fotos o PDF | imagenes | thumbnails (✕ if editable) + file input `image/*,application/pdf` multiple | — |

Buttons (if `puede`):
- `Guardar cambios` and `Cerrar`.
- Admins also get `Borrar`, which needs a 2-tap confirm: the label changes to `¿Borrar? Tocá de nuevo`. It hard-deletes the document; comments are not deleted. Toast `Borrado.`
- When not `puede`, every field is disabled and only `Cerrar` is shown.

Below the buttons: `Comentarios` (thread `solicitudes/{id}`, writable if `sesion.puede`) and `Historial de cambios`.

**Save** (`guardar(silencio)`):
- If nothing changed, no write happens.
- The change detector compares titulo, descripcion, cliente, cantidad, fecha_limite, tipo, corrige_id, familia, desarrollo, evaluacion, the 4 puntaje values (missing = 3) and the number of images.
- Write: `solicitudes/{id}.update({titulo, descripcion, cliente, cantidad (trimmed), fecha_limite, tipo, corrige_id, familia, desarrollo||'producto', evaluacion (trimmed), puntaje {4 numbers}, imagenes, actualizado: now, bitacora += {accion:'Editó', detalle: changed labels joined ' · '}})`.
  - `corrige_id` is cleared unless the tipo is correccion or variante.
  - Detail labels: `título`, `detalle`, `cliente`, `cantidad`, `para cuándo`, `tipo`, `producto`, `familia`, `tipo de desarrollo`, `nota de evaluación`, `puntaje`, `archivos: {n}`. Example: `título · puntaje · archivos: 2`.
- Toast `Cambios guardados.` (unless silent). On error: `No se pudo guardar.`
- When the panel is open, Aprobar, Posponer and Descartar first run `guardar(true)` and abort if it fails.

### 2.6 "+ Cargar pedido" (team intake form, `nuevaHtml` / `crear`)
| Label | key | default | notes |
|---|---|---|---|
| Qué piden | titulo | '' | required (`Escribí qué piden.`); 120; placeholder `Ej.: camiseta de ciclismo manga larga` |
| Detalle | descripcion | '' | 4000; placeholder `Medidas, tela, terminaciones, cantidad…` |
| Desarrollo de | desarrollo | current Desarrollo filter or `producto` | select tipos |
| Tipo | tipo | `solicitud` | select of the 5 TIPOS |
| Cliente | cliente | '' | 120 |
| Lo pidió | pedido_por | session name | text 60 with a datalist of `equipo` names |

- Buttons `Cargar` and `Cancelar`, plus the hint `Fotos, puntaje y el resto se agregan después, abriéndolo.`
- Submit calls `cruce('crearSolicitud', {titulo, descripcion, cliente, tipo, desarrollo, pedido_por, fecha_limite:'', imagenes:[]})` (full document in §1.2).
- On success: toast `Cargado en la Bandeja.`, the filter switches to `abiertas`, and the view scrolls to the new card. On error: `No se pudo cargar.`
- The host can also open this form with param `nueva`.

### 2.7 Decision: Aprobar (`accionHtml` aprobar, `aprobar`, bridge `xAprobar`)
Clicking Aprobar opens an inline box (`S.accion = {id, tipo:'aprobar', plantilla, corrige_id}`).

**Template picker** `Plantilla de tareas` (hidden for tipo `variante`):
- Options: `DP.plantillas()` except `para==='variante'`, so the **corrección template is offered too**. Templates whose `desarrollo` equals the request's saved `desarrollo` are sorted first. The sort uses the saved request `s`, not the unsaved draft.
- Preselected value:
  - tipo `correccion`: `'correccion'`.
  - Otherwise `plantillaPara(o)`, where `o` is the draft's desarrollo if the panel is open, else the saved one. Among templates with `para` not variante and not correccion:
    1. Pick the first template whose `desarrollo === o.desarrollo`.
    2. Else, if the type is not a product, the first template with `desarrollo!=='producto'`.
    3. Else `'prenda'`.
  - With the default templates this gives: producto → `prenda`; maquina → `maquina`; procedimiento → `procedimiento`; sistemas → `sistemas`; **tecnologia → `maquina`; proceso → `maquina`** (first non-product in insertion order).

**Product picker** (only for tipo `correccion` or `variante`):
- Label `Producto que se corrige` or `Producto al que se le agrega la variante`.
- Preselected from the draft's or the request's `corrige_id`. Options are all projects.

Buttons, hints and validation:
- Buttons: `Crear proyecto` (for variante: `Aprobar y agregar la variante`) and `Cancelar`. Hint `Lo que falte se completa después, en el proyecto.`
- While running, the button is disabled and reads `Creando…`.
- Validation: a variante without a product shows `Elegí el producto.`. Correction does **not** require a product: without one, the project name falls back to the request title.

Call: `cruce('aprobar', s.id, {plantilla, corrige_id})`. Bridge behaviour:
1. If the request no longer exists, it throws `Ese pedido ya no existe.` (aviso).
2. `nota = s.evaluacion`, `cid = o.corrige_id || s.corrige_id`. The pre-steps (`pasos_previos`) are cloned and step `decision` gets `estado='hecho'`, `fecha=hoy`. `hecho_el` is not set.
3. **tipo `variante`**: the product `cid` must exist, otherwise it throws `Elegí el producto al que se le agrega la variante.`. Then:
   - It appends to `productos/{cid}.variantes` the object `{id:'v…', nombre: s.titulo, combinacion:{libre: descripcion[0..200]}, origen:'solicitud', solicitud_id, estado:'en_desarrollo', moldes:'no', tizada:'no', tizada_nombre:'', erp:'no', responsable: p.lider, fecha: s.fecha_limite, nota, creado, pasos: tplPasos('variante', p.lider)}`.
   - Product bitácora: `Variantes` / `variante nueva desde {SOL-xx}: {nombre}`.
   - Request update: `{corrige_id: cid, pasos_previos, estado:'aprobada', producto_creado_id: cid, decidido: now, actualizado, bitacora 'Aprobó la variante' / 'se agregó a {p.nombre}'}`. The call returns the product id.
4. **Any other tipo**, which creates a project:
   - `tipo = s.tipo==='correccion' ? 'correccion' : 'nuevo'`.
   - `base` = the product `cid` (correction only).
   - `tpl = o.plantilla || ('correccion' | 'prenda')`. If the id does not exist, `tplPasos` falls back to `prenda`.
   - New `productos` document:

| field | value |
|---|---|
| nombre | correccion: `Corrección: {base.nombre || s.titulo}`; else `s.titulo` |
| codigo | `nextCode(prods, 'CO-' if correccion else 'PD-')`. The prefix follows the **request tipo, not the template** |
| tipo | `correccion` / `nuevo` |
| tipo_origen | `s.tipo` (solicitud/idea/orden/correccion) |
| ref_erp | `s.ref_erp || base.ref_erp || ''` |
| estado_general | `activo` |
| familia / etiqueta / linea | `s.x || base.x || ''` |
| fecha_limite | `s.fecha_limite || ''` |
| notas | lines joined `\n`: `descripcion`, `Cliente: {cliente}`, `Cantidad: {cantidad}`, `Evaluación: {evaluacion}` (empty ones skipped) |
| pasos | `tplPasos(tpl, YO)`: every template task becomes `{id: uid('s…'), etapa, nombre, duracion: (tpl.duracion||1), entregable, ref, erp, responsable: YO (the approver), fecha:'', estado:'pendiente', hecho_el:'', nota:''}`, ordered by stage |
| etapas | a deep copy of the template's `etapas` **only if the template has custom stages** (otherwise the field is absent and the 5 defaults apply) |
| plantilla | tpl id |
| desarrollo | `s.desarrollo || template.desarrollo || 'producto'` |
| lider | `YO` (the approving user, not the requester) |
| fecha_inicio | today `YYYY-MM-DD` |
| puntaje | **carried over** from `s.puntaje`, or defaults of 3 |
| prioridad_fija | 0 |
| muestras | [] |
| requiere | `s.requiere || []` |
| solicitud_id | s id |
| corrige_id | cid |
| origen | `solicitud` |
| creado / actualizado | now |
| historial | `[{estado: first custom stage id || 'definicion', fecha: now}]` |
| bitacora | `Planificado` / `desde {SOL-xx}[, pedido por {quien}]` |

   - Not set: `variantes`, `archivos`, `proveedor`, `costo_estimado`. Request images are **not copied**; the ficha shows them live from the request.
   - Request update: `{corrige_id: cid, pasos_previos, estado:'aprobada', producto_creado_id: newId, decidido: now, actualizado, bitacora 'Aprobó y creó el proyecto' / {evaluacion}}`.
5. UI after success:
   - The box, panel and draft are cleared.
   - Toast `Variante agregada al producto.` or `Proyecto creado.`
   - The view navigates to the project ficha (for a variante, the parent product's ficha).
   - On error the box shows `e.message` (aviso) or `No se pudo aprobar: crear proyectos necesita permiso de edición.`.

### 2.8 Decision: Posponer / Descartar (`decidir`)
- The inline box shows:
  - `Motivo (lo ve quien lo pidió)`: textarea 2000. Placeholder `Por qué queda para más adelante` (posponer) or `Por qué no se hace` (descartar).
  - Posponer only: `Volver a verlo el (opcional)` (date).
- Buttons `Posponer` / `Descartar` and `Cancelar`.
- Validation: the motivo is required (`Escribí el motivo.`).
- Write: `update({estado: 'pospuesta'|'rechazada', motivo, fecha_revision: (posponer ? fecha||'' : ''), decidido: now, actualizado, bitacora 'Pospuso'|'Rechazó' / [ 'revisar el dd/mm/yy. ' ] + motivo})`.
- Toast `Pospuesto.` or `Descartado.`
- The vendor sees the motivo (§1.4).
- Allowed states: Posponer only from open; Descartar from open or pospuesta. Tipo `orden` can also be discarded, although the host's TIPOS describes orden as "Hay que hacerla: no se puede rechazar." The UI does not enforce this.

### 2.9 Reabrir
- Only on `rechazada`, with no confirmation.
- Write: `update({estado:'nueva', fecha_revision:'', motivo:'', actualizado, bitacora 'Reabrió' / 'vuelve a la bandeja'})`. `decidido` and `pasos_previos` stay as they were.
- The filter switches to `abiertas`.
- A pospuesta request has no Reabrir button: it is approved or discarded directly from its card.

### 2.10 Navigation params
`params({est, tipo, abrir, nueva})` comes from the host (`vBandejaN`, bridge L112).
- `est` sets the status chip if it is valid.
- `tipo` sets the tipo filter.
- `nueva` opens the intake form.
- `abrir:id` opens that card's panel ("external" open). This clears the search and the tipo filter, switches to `todas` if the card is not visible under the current chip, and scrolls to it. If the data is not loaded yet, the open is queued.
- The project ficha's link `viene de SOL-xx` uses this through `cruce('abrirSolicitud')`, which calls host `openSol`.
- `refrescar()` does not redraw while a draft, decision box, intake form or comment text is in progress.

---

## 3. Proyectos (`mod-proyectos.js`): list of developments in progress and the project ficha

**Purpose and users**: the development team works projects here. Everyone sees them; only `admin` edits (`edita()` = `admin && db`). Non-admins get every control disabled, but they can still comment if `puede`.
**Reads**: `productos` (subscription), `tandas`, `muestras`, `solicitudes`, `comentarios`, `DP.equipo()` and `DP.listas()`.
**Writes**: only through cruces: `guardarProyecto`, `tarea`, `tareaNueva`, `tareaMover`, `tareaQuitar`, `altaErp`, `guardarPuntaje`, `guardarPlantilla`, `cancelarProyecto`, `reactivarProyecto`, `borrarProyecto`, `nuevoProyecto`.
**Modes**: `params({modo:'lista', etapa?})` and `params({modo:'ficha', id})`.
- The host's `DP.abrirProyecto(id)` calls `goProj`, which sets view `proyecto` and mounts with `{modo:'ficha', id}`.
- `DP.navegar('proyectos')` sets view `proys` and mounts the list.
- Opening a different project resets the open-stage state, the REF prompt, the open "Datos" panel and the template form.

### 3.1 List
**Universe**: `enCurso` = projects whose `etapaDe(p) !== 'publicado'`. A cancelled project has stage `'cancelado'`, so it is always in this set; terminated projects are not (they live in Archivo).

**State chips** (counts over the whole universe, unaffected by search or filters):
- `activos` "En curso": `estado_general !== 'cancelado'`. Paused projects are **included**.
- `pausa` "En pausa": `estado_general==='pausado'`.
- `cancelados` "Cancelados": `estado_general==='cancelado'`.
- The hint next to the chips reads `Los terminados están en «Archivo».`

**Filters** (combined with AND):
- Search `Buscar por nombre, código, REF, responsable o detalle`: every word must appear in `norm(nombre, codigo, ref_erp, lider, familia, etiqueta, notas)`.
- `Responsable`: `Todos` + the distinct `lider` values of the universe, sorted (es). Exact match on `p.lider`.
- `Desarrollo`: `Todos` + tipos (`tipoDes(p)`).
- `Línea`: `Todas` + Sublimación / Impresión Directa / EcoUV (exact `p.linea`).
- **Stage chips** (counts over the filtered base):
  - `Todas las etapas` (count of the base).
  - One chip per default stage with a coloured dot, matching `etapaDe(p) === id`.
  - `Con etapas propias` (`__otras`), shown only if some project in the base is currently in a non-default stage (`propia(p)`: the stage is not publicado, not cancelado and not one of the 5 defaults).
  - A cancelled project matches no stage chip; it only appears under "Todas las etapas".

**Sorts** (`ORDEN`):
- `rec` "Recomendado para atender" (default): `rec(p)` descending. `rec(p)` adds the following to `DP.puntaje(p)`:
  - `+ min(4, 2 × overdue tasks)`.
  - If `fecha_limite`: with `d` = days from today, `+4` if `d<0`, or `+2` if `d<=14`.
  - `+2` if the project belongs to an open tanda (`tandas.estado!=='cerrada'` and `productos` includes the id).
  - `+1` if the current task has no `responsable`.
  - `−3` if `pausado`.
  - `+ min(2, ageDays/30)`, measured from `creado`.
- `puntaje` "Mayor puntaje".
- `nuevos` "Más nuevos" / `viejos` "Más viejos" (by `creado`).
- `limite` "Fecha límite más cercana" (empty last, no tie-break).
- `avance` "Más avanzados" (pct descending).
- `nombre` "Nombre" (localeCompare es).

**Header**: `Proyectos {N} en curso`, where N = non-cancelled projects in the universe. `+ Nuevo proyecto` appears for editors and calls `cruce('nuevoProyecto')`, which opens the host dialog in §3.6.

**Card** (whole card is a button that opens the ficha). The left border uses the current stage colour.
- Column 1:
  - `nombre || 'Sin nombre'`.
  - Sub line: `codigo` · `REF {ref_erp}` (if set) · grey tag with the desarrollo name (only for non-product) · línea label · `lider` or `sin responsable`.
  - Tags: `{n} atrasada|atrasadas` (red), the open tanda's `nombre` (cyan), `En pausa` (warn), `Cancelado` (grey).
- Column 2: `Ahora: {current task nombre}[ · responsable][ · dd/mm/yy fecha]`, or `—`.
- Column 3: `{stage label} · {h}/{t}` and a progress bar at `pct`.

**Empty state**: `Ningún proyecto coincide con el filtro.`, or when there are no projects at all `Todavía no hay proyectos. Se crean al aprobar un pedido en la Bandeja.`

### 3.2 Ficha: header, notes, files
- `← Proyectos` returns to the list.
- **Nombre**: a large inline text input. On change: an empty value reverts; otherwise `guardarProyecto {nombre: trim}`.
- **Chips**. In edit mode they are buttons that open "Datos del proyecto" and focus the matching field:
  - `Código {codigo|—}`.
  - Product: `REF ERP {ref_erp | 'sin REF'}` (warn style if missing). Non-product: `Desarrollo de {tipo name}`.
  - `Responsable {lider | 'sin asignar'}` (warn if missing).
  - `Avance {h}/{t}`.
  - `Tanda {name}` if the project is in an open tanda.
  - `Estado En pausa` / `Estado Cancelado` (warn).
  - Link `viene de {SOL-xx | 'un pedido'}` if `solicitud_id` resolves; it calls `cruce('abrirSolicitud', id)`, which opens Bandeja with that request expanded.
  - Button `Editar datos`.
- **Descripción y notas**: `notas` textarea, placeholder `Qué es, para quién, decisiones tomadas, pendientes…`. Saved on change (blur) through `guardarProyecto {notas}`. Bitácora: `detalle actualizado`.
- **Imágenes y archivos** (`p.archivos`):
  - Thumbnails, with ✕ in edit mode. ✕ has no confirmation and saves `guardarProyecto {archivos: list minus i}`.
  - The file input has **no accept filter**: hint `Fotos, PDF, planillas o texto.`, multiple. After upload it saves `guardarProyecto {archivos: [...old, ...new]}`.
  - Read-only mode with no files shows `Sin archivos.`.
  - If the origin request has images, a read-only block follows: `Del pedido {SOL-xx}:`.

### 3.3 Ficha: stepper, "Ahora", tasks per stage
**Stepper**: one button per project stage (custom or default), in order.
- State per stage, computed over tasks that are not `no_aplica`:
  - `na`: no such tasks. Subtitle `no aplica`, 50% opacity.
  - `ok`: all of them done. Title `✓ {label}`.
  - `cur`: this is the current stage.
  - Otherwise pending: title `{i+1} · {label}`.
- Subtitle `{h} de {n}`.
- Clicking a stage opens and scrolls to that stage's section.

**Ahora** box:
- If there is a current task: the label `Ahora · {stage name}` and that task's row with a big ✓.
- Otherwise: `Proyecto terminado: todas las tareas están hechas. Queda en «Archivo».` (stage publicado) or `Proyecto cancelado.`.

**Tareas por etapa**: one collapsible section per stage. It is open by default if it is the current stage; afterwards the user's open/closed choice is kept. The summary shows `{label}` and `{h}/{n}` or `no aplica`. Rows are in project task order (`DP.tareasDe`). Editors also get an inline input at the bottom, `+ Agregar una tarea en {etapa}` (Enter submits, maxlength 120).

**Task row** (`filaTarea`), in column order:
1. **✓** round button (`Marcar como hecha` / `Volver a pendiente`):
   - If the task is `hecho`: `cruce('tarea', pid, sid, {estado:'pendiente'})`.
   - If the task has `ref:true` and the project has no `ref_erp`: show the REF prompt (see below).
   - Otherwise: `cruce('tarea', …, {estado:'hecho'})`.
2. Name. Done tasks are struck through.
3. **Estado** select with the 5 states. Choosing `hecho` on a `ref` task without a REF also shows the prompt instead of saving. Otherwise it calls `tarea {estado}`.
4. **Responsable** select: `Sin asignar` + all `equipo` names (vendors included) + the current value. Calls `tarea {responsable}`.
5. **Fecha**: if done, the text `hecha dd/mm/yy` (`hecho_el || fecha`). Otherwise a date input, red when `fecha < hoy` and the task is pending. Calls `tarea {fecha}`.
6. Extra lines below the row:
   - `Espera a: {names}` (pending dependencies).
   - `Fecha sugerida ≈ dd/mm/yy` (pending task with no fecha; `DP.fechasSugeridas`).
   - `Entregable: {x}` (pending tasks only).
   - The `nota`.
7. **REF prompt**: `Para dar el alta hace falta el código del producto en el ERP:`, an input (placeholder `REF`, maxlength 20), `Guardar y marcar hecha` and `cancelar`.
   - An empty value keeps focus on the input.
   - Otherwise it calls `cruce('altaErp', pid, sid, ref)`. The bridge sets `ref_erp=ref`, sets the task to `hecho` with `hecho_el=now`, and moves the first pending task in order from `pendiente` to `en_curso`. Bitácora `Alta en el ERP` (with diffs, including `ref erp: X`).
8. **`⋯ más` detail** (`DP.tareaDetalleHtml`, documented in the base spec). Each field is saved on change through `cruce('tarea', pid, sid, {field})`:
   - Nombre (120, cannot be empty), Etapa (select of the project's stages), Duración (días hábiles, 0..120), Entregable (80), Nota (300).
   - Depende de: checkboxes; a checkbox that would create a cycle is disabled with the tooltip "Esa tarea ya depende de esta".
   - Button `Usar la fecha sugerida ≈ dd/mm/yy`.
   - Link `+ Google Calendar`.
   - `↑ Subir` / `↓ Bajar` (`tareaMover`, within the same stage).
   - `Quitar tarea`, with a 2-tap confirm: `¿Quitar esta tarea? Tocá de nuevo`. It calls `tareaQuitar`, which also strips the task from other tasks' `depende`.

**Bridge `tarea` semantics** (bridge L50):
- `patch.estado==='hecho'` goes through `setStep('p|pid|sid')`, wrapped at PP:L1991:
  1. If the task's dependencies are still pending, a toast warns `Ojo: dependía de «X», que todavía no está hecho.`. The task is still completed.
  2. `hecho_el = hecho_el || now`.
  3. The **next** pending task after this one in order, if it is `pendiente`, becomes `en_curso`.
  4. `historial` gets an entry if the project's stage changed.
  5. Bitácora `Completó` with diff lines such as `{tarea}: Pendiente → Hecho`.
- Any other patch goes through `saveProj`:
  - `Object.assign(task, patch)`.
  - If `patch.estado` is set and is not hecho, then `hecho_el=''`.
  - If the `etapa` changed, the task is moved to the end of its new stage (`xInsertar`).
  - Bitácora `Editó` with diffs (responsable, fecha, renames, depende…).
- `tareaNueva` inserts `{id, etapa, nombre, duracion:1, entregable:'', responsable: project lider, fecha:'', estado:'pendiente', hecho_el:'', nota:''}` at the end of its stage. Bitácora `Agregó una tarea`.
- `tareaMover` swaps the task with its neighbour in the same stage. Bitácora `Reordenó las tareas`.
- `tareaQuitar` bitácora: `Quitó una tarea`.
- `saveProj` (PP:L1323) only persists `pasos, nombre, linea, lider, fecha_inicio, fecha_limite, ref_erp, estado_general, familia, etiqueta, notas, actualizado` (+ historial, bitacora). It re-sorts `pasos` by the **default** stage index (`ordenar`). Custom-stage tasks all get index 9 and keep their array order.

### 3.4 Ficha: "Datos del proyecto" (collapsible)
The panel opens automatically when `lider` or `linea` is missing, or after `Editar datos` / a chip click. Every control saves on change; an unchanged value is skipped.

| Label | field | control | shown for | save path |
|---|---|---|---|---|
| Desarrollo de | `desarrollo` | select tiposDes | all | guardarProyecto → direct update, bitácora `Editó` / `tipo de desarrollo: x`. Switching it toggles the product/non-product layout live |
| Código | `codigo` | text 20 | all | direct update. If another project already has the same code (normalized) a toast says `Ojo: ya hay otro proyecto con el código X.`, but **it saves anyway**. Bitácora `código: X` |
| Línea | `linea` | `Sin línea` + 3 líneas | all | saveProj |
| Responsable | `lider` | `Sin asignar` + equipo | all | saveProj. Does **not** change task responsables |
| Código en el ERP (REF) | `ref_erp` | text 20 | **product** | saveProj |
| Proveedor | `proveedor` | text 80 | **non-product** | direct update (`proveedor: x`) |
| Costo estimado | `costo_estimado` | text 40, placeholder `Ej.: USD 4.500` (free text, not numeric) | **non-product** | direct update (`costo estimado: x`) |
| Inicio | `fecha_inicio` | date | all | saveProj. It is the starting point for suggested dates |
| Fecha límite | `fecha_limite` | date | all | saveProj. It feeds puntaje urgency and the rec sort |
| Estado | `estado_general` | `activo` Activo / `pausado` En pausa. When cancelled, the only option is `Cancelado` and the select is disabled | all | saveProj (bitácora `estado general: pausado`) |
| Familia del ERP | `familia` | `Sin familia` + listas.familias (+ current) | **product** | saveProj |
| Etiqueta del ERP | `etiqueta` | `Sin etiqueta` + listas.etiquetas (default Básquet, Fútbol, Vóley) (+ current) | **product** | saveProj |
| Puntaje | — | read-only `{X}`, hint `se calcula con los cuatro criterios de abajo` | all | — |
| Estratégico / Comercial / Complejidad / Recursos | `puntaje.k` | select 1..5 (§0.2) | all | `cruce('guardarPuntaje', pid, k, n)`, a direct update. Bitácora `Puntaje` / `Estratégico: 3 → 4` |

### 3.5 Ficha: cross links, template, comments, lifecycle
**Link chips**:
- Product:
  - `Muestras · {n}`: `cruce('verMuestras', pid)` opens the Muestras screen filtered to this project. n counts muestras where `proyectos[]` includes pid, or the legacy `proyecto_id` matches.
  - `Variantes · {p.variantes.length}`: `navegar('catalogo', {sec:'variantes', proyecto})`.
  - `Capacidades · {p.requiere.length}`: `navegar('catalogo', {sec:'capacidades', proyecto})`.
- Non-product: `Capacidades que resuelve · {p.resuelve.length}`, also `catalogo/capacidades`. It is edited in Catálogo through `guardarResuelve`.
- Always: `Sus tareas en la pantalla Tareas`: `navegar('tareas', {proyecto})`.

**Guardar como plantilla** (editors). The button sits next to the link `Ver las plantillas` (navigates to `plantillas`) and the hint `Guarda este flujo (etapas y tareas) para usarlo en proyectos nuevos.`. The form:
- Label `Guardar las etapas y tareas de este proyecto como plantilla:`, input placeholder `Nombre de la plantilla` (maxlength 60), buttons `Guardar plantilla` and `cancelar`. The name is required (an empty name refocuses the input).
- Document passed to `cruce('guardarPlantilla', null, doc)`:
  `{nombre, para: p.tipo==='correccion' ? 'correccion' : 'producto', descripcion: 'Guardada desde el proyecto {nombre}', etapas: clone (only if the project has custom stages), pasos: every task in stage order → {etapa, nombre, duracion: +duracion||1, entregable, ref, erp}}`.
  - Done and `no_aplica` tasks are included as well.
  - **`desarrollo` is not included**, so the new template counts as a "producto" template even when it came from a máquina or sistemas project.
- Bridge: the new id is `'t'+Date.now().toString(36)`. If the `plantillas` collection is still empty, all `DEF_PLANTILLAS` are first written to it.
- Toast `Plantilla «{nombre}» guardada. Ya se puede elegir al crear un proyecto.`

**Comments**: thread `productos/{id}`. **Historial de cambios**: `p.bitacora`.

**Lifecycle buttons** (editors). Hint: `Cancelar lo guarda fuera de las listas; borrar lo elimina para siempre.`
- `Cancelar el proyecto`:
  - 2-tap confirm: `¿Cancelar el proyecto? Tocá de nuevo`.
  - Bridge: the project is unlinked from every **open** tanda (removed from `productos`, from task refs `p|pid|…` and from `grupos[].productos`). Then `estado_general='cancelado'`, bitácora `Canceló` / `el proyecto`. Toast `«{nombre}» cancelado.`
  - The origin request is untouched; the vendor then sees `Se canceló el desarrollo`.
  - No `historial` entry is written.
- `Reactivar el proyecto` (shown instead when cancelled):
  - No confirmation. Sets `estado_general='activo'`, bitácora `Reactivó`. Toast `«{nombre}» vuelve a la lista.`
  - The tanda links are not restored.
- `Borrar el proyecto`:
  - 2-tap confirm: `¿Borrar para siempre? Tocá de nuevo`.
  - Bridge `borrarProyecto` (PP:L2053): the project is removed from **all** tandas (open or closed) and from `config/orden.ids`, then the document is hard-deleted. Toast `«{nombre}» borrado.`. The UI navigates to the list.
  - Comments, muestras links and the request's `producto_creado_id` are left dangling; the vendor then sees plain `Aprobado`.

### 3.6 "+ Nuevo proyecto" (host dialog `openNewProj`, PP:L1486)
This is not part of the module, but the list button triggers it.

Fields:
- `np-nombre` (required).
- `np-plantilla`: every template except `para==='variante'`, default `prenda`. The description line reads `{descripcion} {N} pasos en {M} etapas, unos {Σduración} días hábiles en total. Después se pueden agregar, quitar o mover pasos.`
- `np-linea` (`Sin línea` + líneas).
- `np-lider` (default the current user).
- `np-inicio` (default today).

Created document:
- `tipo = template.para==='correccion' ? 'correccion' : 'nuevo'`. Here the template decides the code: `codigo` = `CO-`/`PD-` accordingly.
- `tipo_origen:'equipo'`, `plantilla`, `linea`, `lider`, `fecha_inicio`, `desarrollo: template.desarrollo||'producto'`.
- `ref_erp:''`, `estado_general:'activo'`, `familia:''`, `etiqueta:''`, `fecha_limite:''`, `notas:''`.
- `pasos: tplPasos(tid, lider)`, so every task is assigned to the chosen lider. `etapas` if the template has custom stages.
- `puntaje:{}`, `prioridad_fija:0`, `muestras:[]`, `variantes:[]`, `requiere:[]`, `origen:'manual'`.
- `historial:[{estado: first stage, fecha}]`, bitácora `Creó el proyecto` / `{nombre} · plantilla {template nombre}`.
- After creation the ficha opens.

### 3.7 Redraw guard
- The module subscribes to `productos`, `tandas`, `muestras`, `solicitudes` and `comentarios`.
- It skips redraws while the user is typing in any of these: a task detail input with a changed value, a non-empty comment, the REF input, the template-name input, or the add-task input.
- `refrescar()` is a no-op.

---

## 4. Plantillas (`mod-plantillas.js`): saved flows (stages + tasks) and the list of tipos de desarrollo

**Purpose and users**: admins maintain the templates picked when approving a request (Bandeja) or creating a project. Everyone else can view them read-only. The same screen edits the list of "tipos de desarrollo".
**Source of templates**: `DP.plantillasCompletas()` maps to host `plantillasAll()` (PP:L1121).
- It returns the `plantillas` collection **if it has at least one document**, otherwise the hard-coded `DEF_PLANTILLAS`.
- The collection is seeded lazily: on the first save or delete of any template, all defaults are written to it first (bridge `guardarPlantilla` / `borrarPlantilla`).
- Template document shape: `{nombre, para:'producto'|'correccion'|'variante', desarrollo?: tipoId (absent means producto), descripcion, etapas?: [{id,label,c}] (only for custom flows), pasos:[{etapa, nombre, duracion, entregable, ref?, erp?}], actualizado}`. The document id is the template id.
- **Fixed templates** `FIJAS = ['prenda','correccion','variante']` can be edited but not deleted. The system uses them: `prenda` is the fallback, `correccion` is the default for correction requests, and `variante` supplies the tasks of every new variant (`tplPasos('variante')`).
- Copy semantics: editing a template **does not change existing projects**. Projects copy `pasos` and `etapas` at creation (UI hint: `Cambiar una plantilla no modifica los proyectos que ya existen.`).

### 4.1 List view
- Title `Plantillas {count}`. `+ Nueva plantilla` appears for admins.
- Hint: `Cada plantilla es un flujo guardado: sus etapas y las tareas de cada etapa. Se elige al aprobar un pedido o al crear un proyecto. Cambiar una plantilla no modifica los proyectos que ya existen.`
- Card grid in object insertion order (no sort). Each card (a button that opens the editor) contains:
  - `<b>nombre || id</b>`.
  - Hint: `[<b>{tipo name}</b> · ]{para label} · {N} tareas[ · etapas propias]`. The tipo name appears only when `desarrollo` is set and not `producto`.
  - `para` labels (`PARA`): `producto` "Proyectos de producto", `correccion` "Correcciones", `variante` "Variantes".
  - A dot per stage (colour, label, task count).
  - `descripcion`.
- **Tipos de desarrollo** box (§4.4).

### 4.2 Editor (`abrir`, `editor`)
The draft is `{id, nombre, desarrollo||'producto', para||'producto', descripcion, etapas: clone(t.etapas || DP.ETAPAS) each with k=id, tareas: [{etapa, nombre, duracion ?? 1, entregable, ref, erp}]}`. A new template starts with the 5 default stages and no tasks.
- `← Plantillas` and `Cancelar` discard the draft without asking.
- **Header box**:
  - `Nombre`: text 60, required.
  - `Se usa para`: select PARA.
  - `Tipo de desarrollo`: select tiposDes.
  - `Descripción`: text 200, placeholder `Para qué tipo de producto sirve`.
- **Etapas box**. Hint: `El recorrido del proyecto, en orden. Podés renombrarlas, reordenarlas, agregar o quitar. Una etapa con tareas no se puede quitar: mové o quitá antes sus tareas.`
  - Each row has a colour picker (default `#8a94a6`), a name (text 40), `{n} tarea|tareas`, `↑`, `↓` and `✕`. `✕` is disabled if the stage has tasks or is the only stage.
  - `+ Etapa` adds a blank stage. Its colour is `DP.COLORES[index % 7]`, cycling `#5b7cff #0a8fb8 #3f9a2a #d9822b #d1236b #7a6bd6 #8a94a6`.
  - `Volver a las cinco etapas de siempre` resets to the defaults. It is blocked if any task sits in a stage that is not one of the defaults, with the message `Antes mové las tareas a etapas que vayas a conservar, o quitá las etapas propias una por una.`
- **Tareas de cada etapa box**. Hint: `Días = duración estimada en días hábiles. «Pide REF» = al marcarla hecha pide el código del producto en el ERP.`
  - There is one block per stage. Each task row has:
    - name (text 120, placeholder `Nombre de la tarea`)
    - days (number 0..120)
    - entregable (text 80, placeholder `Entregable (opcional)`)
    - checkbox `Pide REF` (`ref`)
    - a select to move the task to another stage
    - `↑`/`↓` (within the same stage) and `✕` (no confirmation)
  - `+ Tarea en {etapa}` adds a task with `duracion 1`.
  - The `erp` flag is preserved but **not editable**. No code in these modules gives it any behaviour.
- **Footer** (sticky):
  - Admin: `Guardar plantilla`, `Cancelar`, an error slot, and `Borrar plantilla` (only for an existing id that is not FIJAS).
  - Non-admin: everything disabled, with the hint `Las plantillas las cambia quien administra la herramienta.`

### 4.3 Save (`guardar` → `armar` → `cruce('guardarPlantilla', id|null, doc)`)
**Validations**, in order:
1. `Falta el nombre de la plantilla.`
2. `Hay una etapa sin nombre.`
3. `Hay dos etapas con el mismo nombre.` (trimmed, case-insensitive)
4. `Agregá al menos una tarea.` This counts only after **dropping tasks with an empty name, silently**.

**armar()** builds the document:
- **Same as the defaults**: the stages are exactly the 5 defaults (same ids, same order, same trimmed labels). Then no `etapas` field is stored and tasks keep the default ids.
- **Otherwise** a custom flow is stored:
  - `etapas = [{id, label: trim, c: colour || '#8a94a6'}]`.
  - The **id is the trimmed label**. ` ·` is appended while the id collides with a default id or with an id already used.
  - Consequence: renaming a single default stage, e.g. "Definición" to "Definición inicial", turns the whole template into custom stages whose ids are labels.
- `pasos` is ordered by stage, then by position, with fields `{etapa: mapped id, nombre: trim, duracion: max(0, int), entregable: trim, ref, erp}`.
  - A duration of 0 is allowed in templates, but `tplPasos` turns it into 1 when creating a project (`duracion||1`).
- Final document: `{nombre, para, desarrollo||'producto', descripcion, pasos, [etapas]}`.

**Bridge `guardarPlantilla`**:
- A non-admin gets the error `Las plantillas las cambia quien administra la herramienta.`
- The id is the existing one, or `'t'+Date.now().toString(36)` for a new template.
- It seeds the defaults if needed, then calls `set()`, a **full replace**, with `actualizado`.

UI: toast `Plantilla guardada.`, then back to the list. On error: the aviso message or `No se pudo guardar.`

**Delete**:
- 2-tap confirm: `¿Borrar esta plantilla? Tocá de nuevo`.
- `cruce('borrarPlantilla', id)`. If the collection is empty, it seeds every default *except* this one, which is an implicit delete. Otherwise it deletes the document.
- Toast `Plantilla borrada.`
- There is no check that projects reference the template. Projects keep `plantilla: id` as a dangling label (host `plantillaNombre` falls back to showing the id).

### 4.4 Tipos de desarrollo (same screen)
- Box title `Tipos de desarrollo`. Hint: `Qué clases de desarrollo se manejan. Los marcados como «producto» usan código del ERP, familia, variantes y muestras; el resto usa proveedor y costo estimado.`
- Read view: `<b>nombre</b>[ (producto)]` for each type.
- Admins get `Editar la lista`. Each row has:
  - name (text 40)
  - checkbox `es producto`
  - `✕` (disabled for id `producto`)
- `+ Tipo` adds `{id: 't'+uid(), nombre:''}`.
- Buttons `Guardar tipos` and `Cancelar`.
- Validation: `Hay un tipo sin nombre.`
- Save: `DP.guardarConfig('desarrollos', {tipos:[{id, nombre, producto?:true}], actualizado})`, a direct write of `config/desarrollos` (full set). Toast `Tipos de desarrollo guardados.` On error: `No se pudo guardar: lo cambia quien administra la herramienta.`
- **No integrity checks**:
  - Removing a type that requests, projects or templates use is allowed. The name then falls back to the built-in `TIPOS_DES` name or to the raw id.
  - `esProducto` for an unknown id is true only if the id is `'producto'`.
  - Only id `producto` cannot be removed, but its `es producto` flag *can* be unticked.
- Default list (`base.js:TIPOS_DES`): Producto (producto), Tecnología, Máquina, Proceso, Procedimiento, Sistemas. `copia-de-datos.json` has no `config/desarrollos` and no `plantillas` collection, so the defaults are live.

### 4.5 Default templates: `DEF_PLANTILLAS` (PP:L1024-1076), verbatim
These are the 8 selectable templates plus the internal `variante` template. Insertion order (which is also display order and plantillaPara order): prenda, plano, estructura, stock, correccion, maquina, procedimiento, sistemas, variante.
- "Días" = `duracion` in business days.
- Flags: `ref` = "Pide REF", which requires the ERP code when the task is ticked. `erp` = a stored flag with no behaviour.
- Default stage ids and colours: `definicion` Definición #5b7cff · `desarrollo` Desarrollo técnico #0a8fb8 · `muestra` Muestra y aprobación #3f9a2a · `industrializacion` Industrialización #d9822b · `lanzamiento` Lanzamiento #d1236b.
- In custom-stage templates the stage **id equals its label** (with accents).

#### prenda — Prenda con molde | para=producto | desarrollo=(sin campo → producto) | 12 tareas, 27 días hábiles
Descripción: Camisetas, shorts, buzos: molde en el sistema de moldes y en TizadaPro.
Etapas: (las 5 de siempre) 1. Definición (id `definicion`, #5b7cff) · 2. Desarrollo técnico (id `desarrollo`, #0a8fb8) · 3. Muestra y aprobación (id `muestra`, #3f9a2a) · 4. Industrialización (id `industrializacion`, #d9822b) · 5. Lanzamiento (id `lanzamiento`, #d1236b)
| # | Etapa | Tarea | Días | Entregable | Flags |
|---|---|---|---|---|---|
| 1 | Definición | Alta en el ERP como borrador | 1 | REF del ERP | ref (pide REF) |
| 2 | Definición | Definición: modelo, medidas, telas y avíos | 3 | Brief del producto |  |
| 3 | Desarrollo técnico | Molde en el sistema de moldes | 5 | Molde de alta |  |
| 4 | Desarrollo técnico | Molde y modelos en TizadaPro | 2 | Modelos cargados |  |
| 5 | Muestra y aprobación | Corte y confección de la muestra | 3 | Muestra física |  |
| 6 | Muestra y aprobación | Revisión y ajustes | 2 | Lista de cambios |  |
| 7 | Muestra y aprobación | Aprobación de la muestra | 1 | Muestra aprobada |  |
| 8 | Industrialización | Ficha de diseño (dibujo, avíos, costura paso a paso) | 3 | Ficha completa |  |
| 9 | Industrialización | Tiempos de costura y costeo | 2 | Costo unitario |  |
| 10 | Industrialización | Precio | 1 | Precio de lista |  |
| 11 | Lanzamiento | Configuración completa en el ERP | 2 | Producto configurado | erp |
| 12 | Lanzamiento | Fotos y publicación en canales | 2 | Publicado |  |

#### plano — Producto plano (lámina, sin molde) | para=producto | desarrollo=(sin campo → producto) | 8 tareas, 12 días hábiles
Descripción: Toallas, manteles, banderas: medida de corte, sin talles.
Etapas: (las 5 de siempre) 1. Definición (id `definicion`, #5b7cff) · 2. Desarrollo técnico (id `desarrollo`, #0a8fb8) · 3. Muestra y aprobación (id `muestra`, #3f9a2a) · 4. Industrialización (id `industrializacion`, #d9822b) · 5. Lanzamiento (id `lanzamiento`, #d1236b)
| # | Etapa | Tarea | Días | Entregable | Flags |
|---|---|---|---|---|---|
| 1 | Definición | Alta en el ERP como borrador | 1 | REF del ERP | ref (pide REF) |
| 2 | Definición | Definición: medidas estándar, material y terminación | 2 | Tabla de medidas |  |
| 3 | Desarrollo técnico | Lámina o archivo a medida | 2 | Archivo listo |  |
| 4 | Muestra y aprobación | Muestra impresa y terminada | 2 | Muestra física |  |
| 5 | Muestra y aprobación | Aprobación | 1 | Muestra aprobada |  |
| 6 | Industrialización | Costeo y precio | 2 | Precio de lista |  |
| 7 | Lanzamiento | Configuración completa en el ERP | 1 | Producto configurado | erp |
| 8 | Lanzamiento | Fotos y publicación en canales | 1 | Publicado |  |

#### estructura — Estructura o exhibición | para=producto | desarrollo=(sin campo → producto) | 11 tareas, 24 días hábiles
Descripción: Windflags, backdrops, gazebos: tela más estructura y accesorios.
Etapas: (las 5 de siempre) 1. Definición (id `definicion`, #5b7cff) · 2. Desarrollo técnico (id `desarrollo`, #0a8fb8) · 3. Muestra y aprobación (id `muestra`, #3f9a2a) · 4. Industrialización (id `industrializacion`, #d9822b) · 5. Lanzamiento (id `lanzamiento`, #d1236b)
| # | Etapa | Tarea | Días | Entregable | Flags |
|---|---|---|---|---|---|
| 1 | Definición | Alta en el ERP como borrador | 1 | REF del ERP | ref (pide REF) |
| 2 | Definición | Definición: formas, tamaños y componentes | 3 | Lista de tamaños y componentes |  |
| 3 | Definición | Proveedores de la estructura | 3 | Proveedor elegido |  |
| 4 | Desarrollo técnico | Forma o archivo por tamaño | 4 | Archivos por tamaño |  |
| 5 | Desarrollo técnico | Funda y refuerzos | 2 | Detalle de confección |  |
| 6 | Muestra y aprobación | Muestra armada | 3 | Muestra con estructura |  |
| 7 | Muestra y aprobación | Aprobación | 1 | Muestra aprobada |  |
| 8 | Industrialización | Accesorios de stock en el WMS | 1 | Accesorios vinculados |  |
| 9 | Industrialización | Costeo y precio | 2 | Precio de lista |  |
| 10 | Lanzamiento | Configuración completa en el ERP | 2 | Producto configurado | erp |
| 11 | Lanzamiento | Fotos y publicación en canales | 2 | Publicado |  |

#### stock — Producto de stock o de terceros | para=producto | desarrollo=(sin campo → producto) | 8 tareas, 11 días hábiles
Descripción: Se compra hecho y se personaliza.
Etapas: (las 5 de siempre) 1. Definición (id `definicion`, #5b7cff) · 2. Desarrollo técnico (id `desarrollo`, #0a8fb8) · 3. Muestra y aprobación (id `muestra`, #3f9a2a) · 4. Industrialización (id `industrializacion`, #d9822b) · 5. Lanzamiento (id `lanzamiento`, #d1236b)
| # | Etapa | Tarea | Días | Entregable | Flags |
|---|---|---|---|---|---|
| 1 | Definición | Alta en el ERP como borrador | 1 | REF del ERP | ref (pide REF) |
| 2 | Definición | Definición: proveedor, talles, colores y personalización | 2 | Ficha de proveedor |  |
| 3 | Desarrollo técnico | Zonas y archivos de personalización | 2 | Plantilla de zonas |  |
| 4 | Muestra y aprobación | Muestra personalizada | 2 | Muestra física |  |
| 5 | Muestra y aprobación | Aprobación | 1 | Muestra aprobada |  |
| 6 | Industrialización | Costeo y precio | 1 | Precio de lista |  |
| 7 | Lanzamiento | Configuración en el ERP (origen «Producto del local») | 1 | Producto configurado | erp |
| 8 | Lanzamiento | Fotos y publicación en canales | 1 | Publicado |  |

#### correccion — Corrección | para=correccion | desarrollo=(sin campo → producto) | 6 tareas, 10 días hábiles
Descripción: Arreglo de un producto que ya existe.
Etapas: (las 5 de siempre) 1. Definición (id `definicion`, #5b7cff) · 2. Desarrollo técnico (id `desarrollo`, #0a8fb8) · 3. Muestra y aprobación (id `muestra`, #3f9a2a) · 4. Industrialización (id `industrializacion`, #d9822b) · 5. Lanzamiento (id `lanzamiento`, #d1236b)
| # | Etapa | Tarea | Días | Entregable | Flags |
|---|---|---|---|---|---|
| 1 | Definición | Diagnóstico: qué falla y qué se cambia | 2 | Diagnóstico |  |
| 2 | Desarrollo técnico | Corrección del molde o archivo | 3 | Molde corregido |  |
| 3 | Muestra y aprobación | Muestra de control | 2 | Muestra física |  |
| 4 | Muestra y aprobación | Aprobación | 1 | Muestra aprobada |  |
| 5 | Industrialización | Actualizar la ficha | 1 | Ficha actualizada |  |
| 6 | Lanzamiento | Actualizar el producto en el ERP | 1 | ERP actualizado | erp |

#### maquina — Máquina o tecnología nueva | para=producto | desarrollo=maquina | 12 tareas, 41 días hábiles
Descripción: Evaluar, comprar, instalar y poner en marcha un equipo o una tecnología.
Etapas: PROPIAS 1. Evaluación (id `Evaluación`, #5b7cff) · 2. Compra (id `Compra`, #0a8fb8) · 3. Instalación (id `Instalación`, #d9822b) · 4. Pruebas (id `Pruebas`, #3f9a2a) · 5. Puesta en marcha (id `Puesta en marcha`, #d1236b)
| # | Etapa | Tarea | Días | Entregable | Flags |
|---|---|---|---|---|---|
| 1 | Evaluación | Necesidad y qué se espera lograr | 2 | Objetivo escrito |  |
| 2 | Evaluación | Opciones y proveedores | 5 | Comparativa |  |
| 3 | Evaluación | Costo y decisión | 2 | Decisión tomada |  |
| 4 | Compra | Pedido y pago | 3 | Orden de compra |  |
| 5 | Compra | Seguimiento de la entrega | 10 | Equipo recibido |  |
| 6 | Instalación | Lugar, energía y conexiones | 3 | Lugar listo |  |
| 7 | Instalación | Instalación y configuración | 3 | Equipo funcionando |  |
| 8 | Pruebas | Pruebas con trabajos reales | 5 | Resultados de las pruebas |  |
| 9 | Pruebas | Ajustes | 3 | Ajustes hechos |  |
| 10 | Puesta en marcha | Capacitación del equipo | 2 | Gente capacitada |  |
| 11 | Puesta en marcha | Procedimiento de uso y mantenimiento | 2 | Procedimiento escrito |  |
| 12 | Puesta en marcha | En producción | 1 | En uso |  |

#### procedimiento — Proceso o procedimiento | para=producto | desarrollo=procedimiento | 9 tareas, 20 días hábiles
Descripción: Definir o cambiar cómo se hace algo y dejarlo funcionando.
Etapas: PROPIAS 1. Relevamiento (id `Relevamiento`, #5b7cff) · 2. Borrador (id `Borrador`, #0a8fb8) · 3. Prueba (id `Prueba`, #d9822b) · 4. Capacitación (id `Capacitación`, #3f9a2a) · 5. Vigente (id `Vigente`, #d1236b)
| # | Etapa | Tarea | Días | Entregable | Flags |
|---|---|---|---|---|---|
| 1 | Relevamiento | Cómo se hace hoy y qué falla | 3 | Relevamiento |  |
| 2 | Relevamiento | Qué se quiere lograr | 1 | Objetivo |  |
| 3 | Borrador | Escribir el paso a paso | 3 | Borrador |  |
| 4 | Borrador | Revisión con quienes lo hacen | 2 | Borrador revisado |  |
| 5 | Prueba | Probarlo en trabajos reales | 5 | Resultado de la prueba |  |
| 6 | Prueba | Ajustes | 2 | Versión final |  |
| 7 | Capacitación | Capacitar a quienes lo usan | 2 | Gente capacitada |  |
| 8 | Vigente | Publicarlo donde se consulta | 1 | Procedimiento publicado |  |
| 9 | Vigente | Revisión al mes | 1 | Revisión hecha |  |

#### sistemas — Desarrollo de sistemas | para=producto | desarrollo=sistemas | 7 tareas, 22 días hábiles
Descripción: Cambios o funciones nuevas en el ERP, en esta herramienta o en otros sistemas.
Etapas: PROPIAS 1. Definición (id `Definición`, #5b7cff) · 2. Desarrollo (id `Desarrollo`, #0a8fb8) · 3. Pruebas (id `Pruebas`, #d9822b) · 4. Puesta en producción (id `Puesta en producción`, #3f9a2a)
| # | Etapa | Tarea | Días | Entregable | Flags |
|---|---|---|---|---|---|
| 1 | Definición | Qué se necesita y para quién | 2 | Pedido claro |  |
| 2 | Definición | Alcance y prioridad con sistemas | 2 | Alcance acordado |  |
| 3 | Desarrollo | Desarrollo | 10 | Versión para probar |  |
| 4 | Pruebas | Pruebas con datos reales | 3 | Lista de correcciones |  |
| 5 | Pruebas | Correcciones | 3 | Versión aprobada |  |
| 6 | Puesta en producción | Puesta en producción | 1 | Funcionando |  |
| 7 | Puesta en producción | Capacitación y aviso al equipo | 1 | Equipo avisado |  |

#### variante — Variante | para=variante | desarrollo=(sin campo → producto) | 6 tareas, 9 días hábiles
Descripción: Un modelo o una opción de slot nueva.
Etapas: (las 5 de siempre) 1. Definición (id `definicion`, #5b7cff) · 2. Desarrollo técnico (id `desarrollo`, #0a8fb8) · 3. Muestra y aprobación (id `muestra`, #3f9a2a) · 4. Industrialización (id `industrializacion`, #d9822b) · 5. Lanzamiento (id `lanzamiento`, #d1236b)
| # | Etapa | Tarea | Días | Entregable | Flags |
|---|---|---|---|---|---|
| 1 | Definición | Definición de la combinación | 1 | Combinación definida |  |
| 2 | Desarrollo técnico | Receta o molde en el sistema de moldes | 3 | Variante de alta |  |
| 3 | Desarrollo técnico | Cargar el modelo en TizadaPro | 1 | Modelo cargado |  |
| 4 | Muestra y aprobación | Muestra | 2 | Muestra física |  |
| 5 | Muestra y aprobación | Aprobación | 1 | Muestra aprobada |  |
| 6 | Lanzamiento | Habilitar en el ERP («Modelos que se venden») | 1 | Habilitada para la venta |  |


---

## 5. Archivo (`mod-archivo.js`): terminated and cancelled projects (read-only)

**Purpose and users**: anyone can look up finished or cancelled developments. The module **writes nothing**.
**Reads**: `productos` and `muestras` (subscriptions).

### 5.1 What is listed
- **Terminados**: `estado_general !== 'cancelado'` and `etapaDe(p)==='publicado'`, i.e. no pending task (every task is `hecho` or `no_aplica`).
  This also covers a project with **zero tasks**, or one where every task is `no_aplica`: such a project is archived immediately.
- **Cancelados**: every project with `estado_general==='cancelado'`, whatever its tasks. These also appear under the Proyectos "Cancelados" chip.
- Chips `Terminados {n}` (default) and `Cancelados {n}`. The counts ignore search and filters. Switching chips collapses any open item.
- Header: `Archivo {n} terminados`. Hint: `Proyectos con todas las tareas hechas. Salen de las listas de trabajo y quedan acá para consultar.`

### 5.2 Filters and sort
- Search, placeholder `Buscar por nombre, código, REF, familia o detalle`: every word must appear in `norm(nombre, codigo, ref_erp, lider, familia, etiqueta, notas)`.
- `Familia`: `Todas` + the distinct `familia` values across terminated **and** cancelled projects (sorted, es).
- `Ordenar`: `nuevos` "Más recientes" (default; end date descending) · `viejos` "Más antiguos" · `nombre` "Nombre".
- There are no filters for desarrollo, línea or responsable.

### 5.3 Dates and the "cuánto llevó" metric
- **End date** `finDe(p)` (YYYY-MM-DD):
  - Cancelled: `actualizado`, the *last update of any kind*. It is not a stored cancellation date.
  - Terminated, first value that exists:
    1. the `fecha` of the **last** `historial` entry with `estado==='publicado'`
    2. otherwise the max `hecho_el` among tasks
    3. otherwise `actualizado`
- **Start date**: `fecha_inicio`, otherwise `creado` (date part). `fecha_inicio` is user-editable.
- **Duration**: `dias = max(0, round((fin − ini) in days))` in **calendar days**, not business days, computed noon to noon.
  - Shown only for terminated projects, as `{d} día|días de desarrollo`.
  - Not shown for cancelled projects, or when either date is missing.
- There are no aggregates such as average duration or counts per month. (Reportes might have them; that module is out of this scope.)

### 5.4 Item
**Header** (a button that toggles expand):
- Column 1: `nombre || 'Sin nombre'`, then a sub line: `codigo` · `REF {ref_erp}` · `familia` · línea label.
- Column 2: `lider` or `sin responsable`, and the duration text.
- Tag: `Terminado · dd/mm/yy` (green) or `Cancelado · dd/mm/yy` (grey).

**Expanded**:
- Grid: `Inicio`, `Terminado|Cancelado` (dates or `—`), `Muestras` (count of muestras linked through `proyectos[]` or legacy `proyecto_id`), `Etiqueta` (or `—`), `Puntaje` (comma decimal), `Variantes` (count).
- `notas` (pre-wrap).
- Collapsed `Tareas ({h} hechas de {t})`: every task in stage order as `{✓ | – (no_aplica) | ○ (pending)} {stage name} · {nombre}[ · responsable][ · dd/mm/yy hecho_el]`.
- Buttons:
  - `Abrir la ficha completa`: `DP.abrirProyecto(id)`. The ficha stays fully editable for admins.
  - `Ver sus muestras`: only if the count is > 0. Calls `cruce('verMuestras', id)`.

**Empty states**:
- Cancelados: `Ningún cancelado coincide.` / `No hay proyectos cancelados.`
- Terminados: `Ningún terminado coincide.` / `Todavía no hay proyectos terminados. Un proyecto pasa acá cuando se completan todas sus tareas.`

**Actions not available here**: un-archive and reactivate. To reopen a terminated project, open the ficha and un-tick a task; its stage stops being `publicado` and it returns to Proyectos. To revive a cancelled project, use `Reactivar el proyecto` in the ficha.

---

## 6. Status/state machines (summary for the rebuild)

**Solicitud.estado**:
```
(create) → nueva ──(complete a pre-step in Tareas)──→ en_evaluacion      [both = "Por resolver" in Bandeja; vendor sees "Recibido"]
nueva|en_evaluacion ──Posponer(motivo, fecha?)──→ pospuesta              [vendor: "Pospuesto · se vuelve a ver el …" + motivo]
nueva|en_evaluacion|pospuesta ──Descartar(motivo)──→ rechazada           [vendor: "No se hace" + motivo]
nueva|en_evaluacion|pospuesta ──Aprobar (admin)──→ aprobada (+producto_creado_id)
rechazada ──Reabrir──→ nueva
aprobada: terminal. Vendor status is derived from the linked project: Aprobado · en desarrollo (etapa) | Listo | Se canceló el desarrollo | Aprobado (project missing)
(admin) Borrar: hard delete from any state
```
**Producto.estado_general**: `activo` ⇄ `pausado` (Datos select). `activo|pausado` → `cancelado` (Cancelar). `cancelado` → `activo` (Reactivar). Hard delete is possible from any state.
**Derived stage**: `cancelado` | stage of the first pending task | `publicado` (= terminated, shown in Archivo). `historial` gets an entry each time the derived stage changes through a task or saveProj write.
**Task estado**: `pendiente | en_curso | en_espera | hecho | no_aplica`.
- Completing a task stamps `hecho_el` and moves the next `pendiente` task to `en_curso`.
- Any other state clears `hecho_el`.
- A `ref` task cannot be marked `hecho` without `ref_erp`; the UI forces the REF prompt.
- "bloqueada" is a display-only state for tasks whose dependencies are pending (`DP.estadoVisible`, used by other screens). Here it shows as `Espera a: …`.

---

## 7. Ambiguities, oddities and things to decide in the rebuild

Identity and permissions:
1. **Name-based identity.** "Mis pedidos" matches `pedido_por`/`contacto.nombre` against the session *name*, normalized (`mod-pedidos.js:mios`). Renaming a person breaks the link, and two people with the same name collide. The filter is also client-side over all requests. Recommendation: store the requester's user id and filter on the server.
2. **Permissions are UI-only in many places.**
   - `cancelarProyecto`, `reactivarProyecto` and `borrarProyecto` have no admin check in the bridge.
   - `saveProj` silently ignores writes from non-admins: no error, the UI just reverts on the next snapshot.
   - Bandeja writes straight to the DB (edit, decide, reopen, delete) without server validation.
   - The API must enforce the matrix in §0.1.
3. **The vendor can see the internal evaluation note.** Both Pedidos and the Bandeja card show `motivo || evaluacion`. When `motivo` is empty, which happens with legacy data, the team's internal note becomes visible to the vendor.

Approval and project creation:
4. **Variant approval sets `producto_creado_id` to the parent product.** The vendor's status then follows the parent product (often "Listo" already), not the variant's own progress (`variantes[].estado`).
5. **`orden` can be discarded** although the host describes it as "Hay que hacerla: no se puede rechazar." The only special treatment is +5 in the "Recomendado" sort.
6. **Default template for tipo `tecnologia` or `proceso` is `maquina`.** `plantillaPara` falls back to "the first non-product template", which is máquina. There is no template for those two types.
7. **Code prefix and `tipo` are decided differently in two places.**
   - When approving, `CO-`/`correccion` depends on the *request tipo*, even if the user picks the "Corrección" template for a normal request, or vice versa.
   - The "Nuevo proyecto" dialog decides it from `template.para`.
   - The approve box also offers the Corrección template for non-correction requests.
8. **The approve box uses two different `desarrollo` sources.** The template list is sorted by the *saved* request `desarrollo`, while the preselected template comes from the *unsaved draft*. Both are saved before creation anyway.
9. **A correction does not require choosing the product to correct.** Without one, the project is named `Corrección: {request title}` and nothing is inherited.
10. **The approver becomes lider and responsable of every task.** At approval `lider = YO` and every task's `responsable = YO`. The requester is only mentioned in the bitácora.
11. **Request attachments are not copied to the project.** The ficha shows them live from the request, so deleting the request (admin "Borrar" in Bandeja) loses them from the project. The same delete leaves `productos.solicitud_id` dangling and its comments orphaned.
12. **Fields applied at approval that Bandeja cannot edit.** `ref_erp`, `linea`, `etiqueta` and `requiere` are copied from the request, but no form in these modules edits them; they are always empty for new requests. Inversely, `cantidad` is captured in Bandeja but not in the vendor form.
13. **Urgency is counted twice in "Recomendado para atender".** It is inside `puntaje` (+3 or +1.5) and added again in `rec` (+4 overdue or +2 within 7 days). In Proyectos the window is 14 days.
14. **Pospuestas whose review date has arrived are not surfaced in the default view.** They get +3 in `rec`, but they stay under the "Pospuestas" chip; only "Por resolver" is shown by default. There is no "reopen" for pospuesta: from there it can only be approved or discarded.
15. **`decidir` does not mark the `decision` pre-step**, and Reabrir does not reset `decidido`. `en_evaluacion` is reached only from the Tareas screen (pre-steps), and Bandeja never shows the pre-steps.

Projects:
16. **Two different task orderings.**
    - `DP.tareasDe` (modules) sorts by the *project's* stage order.
    - The host's `ordenar` (used by `saveProj`, `setStep`, `etapaActual`, the Pedidos stage label and `historial`) sorts by the *default* stage index; custom stages all get 9 and keep their array position.
    - These match only while `pasos` stays grouped by stage, which `xInsertar` and the template editor preserve.
    - The rebuild should use one ordering: `(stage.order, task.position)`.
17. **Stage ids equal their labels in custom flows** (e.g. `Evaluación`, plus a ` ·` suffix on collision). Renaming one default stage in the editor converts the whole template to custom stages. Use surrogate ids.
18. **"Guardar como plantilla" has three quirks.** It omits `desarrollo`, so the new template is treated as "producto". It copies done and `no_aplica` tasks. A duration of 0 becomes 1.
19. **The `erp` task flag is stored everywhere but has no behaviour** in this code. The "Configuración completa en el ERP" tasks carry it, so a check such as "configured in ERP before publishing" may have been intended. Ask the owner.
20. **The REF prompt applies to any task with `ref:true`**, even in a non-product project, where the "Código en el ERP (REF)" field is hidden.
21. **`codigo` is editable and may duplicate another project's code**: a toast warns, then it saves. Codes are computed client-side with `max+1`, so they can race.
22. **Several list behaviours may surprise users.**
    - "En curso" includes paused projects, and so does the header count.
    - Cancelled projects appear both in Proyectos (Cancelados chip) and in Archivo (Cancelados).
    - Stage-chip counts are filtered, but state-chip counts are not.
    - The Bandeja "No queda nada por resolver." message ignores the Desarrollo filter.
23. **People pickers include all `equipo` members, vendors too.** This applies to the task responsable and the project lider. Changing the project lider does not reassign tasks.
24. **Cancel and Reactivar side effects.**
    - Cancel removes the project from open tandas.
    - Reactivar does not restore those tanda links and writes no `historial` entry.
    - Neither action notifies the requester. The vendor only sees the status change on the next visit; there are no notifications at all.
25. **Delete leaves references behind.** Deleting a project leaves `solicitudes.producto_creado_id` dangling (the vendor sees plain "Aprobado"), plus comments and muestras links. The host navigates through the old "Cronograma" view (`V.tipo='proyectos'`) before the module navigates to the list, which is harmless.
26. **The current task is rendered twice in the ficha**: in the "Ahora" box and inside its stage, with the same keys and the same ⋯ detail open state.
27. **The Estado select can show an unsaved value.** Choosing "Hecho" on a REF task without a REF opens the prompt, but the select keeps showing "Hecho" until the next redraw, although nothing was saved.

Archive, templates and data:
28. **Archivo's cancellation date is `actualizado`.** Any later edit to a cancelled project moves it. A project with no applicable tasks counts as "Terminado" immediately. The duration counts calendar days from an editable `fecha_inicio`.
29. **Template order once seeded (inferred, not verified).** After the first save the templates come from the `plantillas` collection. Firestore-like snapshots return documents ordered by id, which would change the display order and the plantillaPara fallback order compared with `DEF_PLANTILLAS`. With the current ids the fallback is still `maquina`. This depends on the backing store's default ordering.
30. **Tipos de desarrollo have no referential integrity.** Deleting a type in use is allowed. Unticking "es producto" on `producto` itself is allowed.
31. **Puntaje urgency timezone.** It uses `new Date('YYYY-MM-DD')`, which is UTC midnight, minus local now. In UTC−3 a deadline therefore starts counting 3 h early. Minor.
32. **Orphan uploads.** Uploads happen when files are picked, so abandoned drafts (Pedidos, Bandeja) leave orphan assets.
33. **Two copies of the bridge differ slightly.** The separate `puente … .js` has two extra cruces, `abrirAnterior` and `versionAnterior` (the "versión anterior" screen), and `'proyantes'` in `SIN_FILTROS`. The copy embedded in `pagina-principal.html` (L2094-2216) lacks them. Nothing in this spec's modules uses them.
34. **Data snapshot (`datos/copia-de-datos.json`, verified by inspection).**
    - 65 productos: all `tipo:'nuevo'`, `plantilla` prenda 59 / plano 5 / estructura 1, no `desarrollo` field and no custom `etapas`. 62 are activo and 3 cancelado. Codes are `PD-03…PD-52` and legacy `PS-01…PS-27`.
    - 35 solicitudes: estados aprobada 30 / nueva 5; tipos idea 25 / solicitud 9 / correccion 1; no `desarrollo`.
    - There is no `plantillas` collection and no `config/desarrollos`, so the defaults are in use.
    - `config/equipo.miembros` has 2 people (Felipe, German) with **no `rol`**, so both count as "desarrollo". No vendor exists in the data.

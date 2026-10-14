# Spec C — Planificación, Tareas, Inicio, Muestras, Catálogo técnico, Reportes

Fuente: `codigo/mod-planificacion.js`, `mod-tareas.js`, `mod-inicio.js`, `mod-muestras.js`, `mod-catalogo.js`, `mod-reportes.js`; cruces leídos en `codigo/puente (incluido en la pagina principal).js` (= `pagina-principal.html` ~L2100-2200) y helpers de la página (`setStep` L1175, `saveProj` L1323, `sumarTareas` L2026). `base.js` solo en lo necesario.

## 0. Convenciones comunes a los 6 módulos

- **Permisos** (de `DP.sesion()`): `admin` = "Editor" (todo); `puede` = "Colaborador" (cargar pedidos, muestras, comentarios); sin ninguno = lectura. Además todo exige `DP.db` presente.
  - Planificación, Tareas, Inicio (marcar hecha), Catálogo: `edita() = sesion().admin && !!DP.db`.
  - Muestras: crear/editar/borrar/tildes/estado/pegar = `puede`; editar listas de estados/tildes = `puede && admin`.
  - Los cruces de la página re-chequean `isAdmin` (`saveProj`, `tUpd`, `guardarPuntaje`, `guardarVariantes`, `guardarRequiere`...) y si falla tiran `Error` con `aviso:true` → el módulo hace `DP.sinPermiso(e)` + toast con `e.message`, o un texto genérico.
- **Referencia de tarea**: string `'p|<proyectoId>|<tareaId>'` (tareas de proyecto). Las variantes usan `'v|<proyectoId>|<varianteId>|<tareaId>'` (solo vía cruce `tareaVariante`). Se resuelve buscando el proyecto en `productos` y la tarea en `p.pasos`; si no existe se descarta silenciosamente (refs colgadas).
- **Colecciones** leídas/escritas: `productos` (proyectos; tareas embebidas en `p.pasos[]`, variantes en `p.variantes[]`), `tandas`, `solicitudes`, `muestras`, `capacidades`, `opciones`, `feedback`, `comentarios`; configs `config/plan`, `config/orden`, `config/muestras`.
- **Tarea (paso)** campos usados: `id, etapa, nombre, duracion (días hábiles), entregable, responsable (nombre, string), fecha (YYYY-MM-DD, fecha comprometida), estado ∈ pendiente|en_curso|en_espera|hecho|no_aplica, hecho_el (ISO), nota, depende: [tareaId], ref (bool: tarea "Alta en el ERP" que exige REF), erp (bool)`.
- `DP.pendiente(t)` = estado ∉ {hecho, no_aplica}. `DP.tareasDe(p)` = pasos ordenados por índice de etapa del proyecto (etapa desconocida = 9) y luego orden del array. `DP.tareaActual(p)` = primera pendiente (null si cancelado). `DP.etapaDe(p)` = etapa de la tarea actual; `'publicado'` si no queda pendiente; `'cancelado'` si `estado_general==='cancelado'`.
- **Personas**: selects de responsable = `'Sin asignar'` (valor `''`) + nombres únicos de `DP.equipo()` + el valor actual si no está en el equipo. Responsable se guarda como **nombre**, no id. "Yo" = `sesion().nombre` (match por string exacto).
- **Fechas**: `fmtD('2026-10-14')` → `14/10/26`; `.slice(0,5)` → `14/10`. Cálculo con `new Date(s+'T12:00')` (evita corrimientos TZ). `DP.hoy()` = fecha local.
- **Cruce `tarea(pid, sid, patch)`** (puente L50): si `patch.estado==='hecho'` → `setStep('p|pid|sid',{estado:'hecho'})`: setea `hecho_el` (si no tenía), y la **siguiente pendiente posterior en orden, si está `pendiente`, pasa a `en_curso`**; si cambia la etapa actual agrega `{estado, fecha}` a `p.historial` (máx 80); bitácora `'Completó'`. Además (wrapper L1991) si la tarea tenía dependencias pendientes muestra toast `Ojo: dependía de «X», «Y», que todavía no está hecho.` (no bloquea). Otros patches → `saveProj`: `Object.assign`; si `patch.estado` ≠ hecho limpia `hecho_el`; si cambia `etapa` la tarea se re-inserta **al final de la nueva etapa**; reordena pasos; bitácora `'Editó'` con diff.
- **Bitácora** `DP.log(arr, accion, detalle)` → push `{fecha: ISO, autor: sesion.id, quien: sesion.nombre, accion, detalle (≤300)}`, conserva las últimas 200.
- **Redibujo**: cada módulo redibuja todo (innerHTML) al cambiar datos suscriptos, salvo si el usuario está escribiendo (`ocupado()`: input de texto con foco y valor modificado). Tras redibujar restaura foco/cursor por `data-fk`. En React esto desaparece (estado controlado), pero **conservar la regla de no pisar lo que se está tipeando**.
- **Confirmación "tocá de nuevo"**: botones destructivos cambian su texto en el primer clic (`data-sure`) y ejecutan en el segundo. No hay modal.

---

## 1. Planificación (`mod-planificacion.js`, registro `'planificacion'`, vista `tandas`)

**Propósito**: armar períodos de trabajo ("tandas") con proyectos, grupos de proyectos y las tareas elegidas de cada uno; y ordenar la "lista de desarrollo" (todos los proyectos en curso). Lo que está en una tanda abierta está *planificado*; el resto está *dormido* (no aparece por defecto en Tareas/Inicio/Reportes-próxima semana). Lo usa el líder/editor del equipo de desarrollo. Solo `admin` edita; el resto ve todo deshabilitado (sin botones, sin arrastre).

**Escribe**: colección `tandas`; configs `plan` y `orden`. Estado/responsable/fecha de tareas y puntaje van por cruces (`tarea`, `guardarPuntaje`). **Lee**: `productos`, `tandas`, `config/plan`, `config/orden`, `DP.equipo()`.

### 1.1 Modelo

`tandas/{id}`:
```
nombre: string            // 'Tanda N' al crear (N = cantidad TOTAL de tandas, incluidas cerradas, +1)
inicio, fin: 'YYYY-MM-DD'
objetivo: string
productos: [proyectoId]   // proyectos vinculados (puede haber proyecto sin tareas elegidas)
tareas: ['p|pid|sid']     // tareas elegidas
grupos: [{ id: 'g'+uid, nombre: string, productos: [proyectoId] }]
estado: 'abierta' | 'cerrada'
creado, actualizado: ISO
bitacora: [{fecha, autor, quien, accion, detalle}]
// al cerrar:
cerrada_el: ISO, resumen: 'H de N tareas hechas', pendientes: ['p|pid|sid']
```
Toda escritura de tanda pasa por `tUpd(t, data, accion)`: `update({...data, actualizado, bitacora: log(accion || 'Editó', Object.keys(data).join(', '))})` (detalle = nombres de campos cambiados). Solo si `edita()`.

`config/plan` = `{ horizonte: 14|28|56|91|0, tanda: 1|2|3|4, actualizado }`. Defaults si no existe: `{horizonte: 28, tanda: 2}` (merge `{...defaults, ...config}`). Guardar: `guardarConfig('plan', {...plan(), [campo]: +valor, actualizado})`.
`config/orden` = `{ ids: [proyectoId], actualizado, quien: sesion.nombre }` — orden manual de la lista de desarrollo.

### 1.2 Estados de tanda (calculados) — `tEstado(t)`
| clave | etiqueta pill (`T_LBL`) | condición (h = hoy) |
|---|---|---|
| `cerrada` | `Cerrada` | `t.estado==='cerrada'` |
| `proxima` | `Próxima` | `inicio > h` |
| `vencida` | `Terminó: cerrala` | `fin < h` (y abierta) |
| `en_curso` | `En curso` | resto |

- `abiertas()` = tandas con `estado!=='cerrada'`, ordenadas por `inicio` asc (la suscripción ordena todas por inicio).
- `actual()` = 1ª abierta `en_curso` → si no 1ª `vencida` → si no 1ª abierta → null. (Misma regla que `tActual()` de la página, usada por el cruce `tareaATanda`.)
- Tanda seleccionada `sel()` = la de `S.sel` si existe y (no está cerrada o `S.verCerradas`), si no `actual()`.

### 1.3 Encabezado: horizonte y largo
Texto: `Planificamos hasta [select horizonte] adelante, en tandas de [select largo]`.
- Horizonte (`HORIZ`): `14 '2 semanas'`, `28 '1 mes'`, `56 '2 meses'`, `91 '3 meses'`, `0 'Sin límite'`. Solo lectura: muestra la etiqueta en negrita (o `'<n> días'` si el valor no está en la lista).
- Largo de tanda: `1 '1 semana'`, `2..4 'N semanas'`.
- **Efecto del horizonte**: SOLO se usa al crear una tanda manual (`hLim() = hoy + horizonte` días, o `'9999-12-31'` si 0). No filtra la lista ni nada más.

### 1.4 Pestañas de tandas
- Una pestaña por tanda **abierta**: `<b>nombre</b> dd/mm–dd/mm <pill estado>`; clic → `S.sel=id`, cierra picker y confirmación de cierre.
- Botón `+ Nueva tanda (N semana|semanas)` (N = `plan().tanda`), solo admin.
- Si hay cerradas: link `Ver cerradas (n)` / `Ocultar cerradas`; al ver, chips `nombre · dd/mm–dd/mm · resumen` que seleccionan la tanda cerrada (se muestra en solo lectura).
- Sin ninguna tanda (ni seleccionable): caja `Todavía no hay tandas` + `Una tanda es un período de trabajo. Se le vinculan proyectos y, de cada uno, las tareas que se van a hacer en ese período. Lo que no está en una tanda queda sin planificar.`

### 1.5 Crear tanda — `nuevaTanda()` (solo manual; la única creación automática es al cerrar, §1.10)
1. `sem = plan().tanda`; `ult` = última abierta (mayor inicio).
2. `ini = ult ? ult.fin + 1 día : (hoy es lunes ? hoy : lunes de esta semana + 7)`.
3. Si `ini` cae sábado → +2; domingo → +1.
4. Si `ini > hLim()` → toast `Esa tanda empezaría el dd/mm/yy, después del horizonte de planificación. Si querés planificar más adelante, ampliá el horizonte.` y no crea.
5. Crea `{nombre:'Tanda '+(tandas.length+1), inicio: ini, fin: ini + sem*7 - 3, objetivo:'', productos:[], tareas:[], grupos:[], estado:'abierta', creado, actualizado, bitacora:[log('Creó la tanda', '2 semanas' | '1 semana')]}` → `fin` = viernes de la última semana si arranca lunes. Selecciona la nueva.

### 1.6 Panel de la tanda seleccionada — `tandaHtml(t)`
Bloqueado (`blo`) si no admin o tanda cerrada → todos los inputs `disabled`, sin botones de acción, sin arrastre, y la sección no es destino de drop.
- **Nombre** (input grande): onchange, trim; vacío → revierte; si cambió → `tUpd({nombre}, 'Editó nombre')`.
- **Pill** de estado + sufijo: en_curso → ` · quedan N día|días` (N = días corridos hoy→fin); proxima → ` · empieza el dd/mm/yy`.
- **Desde / Hasta** (date). Cambio de `fin` con valor `< inicio` (incluye vacío) → toast `El fin no puede ser antes del inicio.` y redibuja sin guardar. `inicio` no se valida (ni contra fin ni vacío). Guardado: `tUpd({[campo]: v}, 'Editó '+campo)` solo si cambió.
- **Largo rápido**: botones `1 sem.` `2 sem.` `3 sem.` `4 sem.` → `fin = inicio + n*7 - 3`, `tUpd({fin}, 'Duración')`. Sin chequeo de horizonte.
- **`+ Google Calendar`** (link, siempre): evento de día completo `https://calendar.google.com/calendar/render?action=TEMPLATE&text=<enc(nombre)>&dates=<inicioYYYYMMDD>/<(fin+1día)YYYYMMDD>&details=<enc(det)>`; `det` = `objetivo + '\n'` (si hay) + por cada proyecto de la tanda `'· <proyecto>: <tareas PENDIENTES en la tanda, separadas por ', '>'` unidos con `\n` (respeta el filtro Responsable activo, ver §1.11).
- **Objetivo** (input, placeholder `Ej.: muestras aprobadas de camiseta y short`) → `tUpd({objetivo}, 'Editó objetivo')`.
- **KPIs**: `<b>P</b> proyectos` · `<b>H/N</b> tareas hechas` · barra `round(H*100/N)%`. N = refs de la tanda que resuelven a tarea existente; H = las que NO están pendientes (**`no_aplica` cuenta como hecha**). No usa filtro de responsable.
- **Carga pendiente por persona**: `Carga pendiente: <b>Nombre</b> n tarea|tareas · ...` — cuenta tareas pendientes de la tanda agrupadas por `responsable || 'Sin responsable'`, orden desc por cantidad. Se oculta si no hay pendientes.
- Si cerrada y tiene resumen: `Cerrada: <resumen>.`
- **Cuerpo**:
  - Proyectos `ps` = `t.productos` existentes, ordenados por `rec()` desc (§1.12) — no por orden manual.
  - Sin proyectos: `Vinculá proyectos desde la lista de desarrollo, abajo («+ <tanda>» o arrastrándolos hasta acá).`
  - Sin grupos: lista de bloques de proyecto.
  - Con grupos: un bloque por grupo (con sus proyectos) + bloque final `Sin grupo` con los proyectos que no están en ningún grupo (siempre visible si hay grupos).
- **Bloque de proyecto** (arrastrable si no bloqueado; grip `⋮⋮`): nombre (link → `DP.abrirProyecto`); hint `<lider|'sin responsable'> · <h/n tareas hechas | 'sin tareas elegidas'>[ · también en <otras tandas abiertas que contienen el proyecto>]`; acciones (no bloqueado): botón `Elegir tareas` / `Listo` (toggle `S.pick`), select de grupo (solo si hay grupos: `Sin grupo` + nombres), link `desvincular`. Debajo: el picker (si `S.pick===p.id`) o las filas de tareas de ese proyecto en la tanda (filtradas por `S.resp`, ordenadas según `DP.tareasDe(p)`), o `Todavía no hay tareas de este proyecto en la tanda. Tocá «Elegir tareas».`
- **Fila de tarea en la tanda**: select estado (los 5 `ESTADOS_TAREA`: Pendiente, En curso, En espera, Hecho, No aplica) · nombre + etapa (hint) · select responsable · date `fecha` (o `hecha dd/mm/yy` = `hecho_el||fecha` si no pendiente) · `✕` "Sacar de la tanda". Cambios → `DP.cruce('tarea', pid, sid, {estado}|{responsable}|{fecha})`. `✕` → `quitar(t,[ref],'Sacó una tarea')` (el proyecto queda vinculado).
- **Grupo**: input nombre (onchange, si no vacío → `tUpd({grupos}, 'Renombró un grupo')`), hint `N proyecto(s)[ · h/n tareas hechas]`, link `deshacer el grupo` (sin confirmación → quita el grupo; sus proyectos quedan sin grupo; `'Deshizo un grupo'`). Vacío: `Arrastrá proyectos acá, o elegí este grupo en el selector de cada proyecto.`
- **Pie** (no bloqueado): `+ Grupo de proyectos` (agrega `{id:'g'+uid, nombre:'Grupo '+(n+1), productos:[]}`, `'Creó un grupo'`, enfoca y selecciona el nombre) · `Ver las tareas de la tanda por estado` (→ `DP.navegar('tareas', {tanda: t.id})`) · `Cerrar la tanda` (abre franja de confirmación, §1.10) · link rojo `borrar la tanda` (doble clic: `¿Borrar la tanda? Tocá de nuevo` → `delete` del doc, `S.sel=''`; no toca proyectos).

### 1.7 Vincular un proyecto — `vincular(t, pid, gid?)`
Disparadores: botón `+ <tanda>` en la lista; arrastrar fila de la lista sobre la tanda; arrastrar sobre un grupo (con `gid`); elegir grupo en el select de un proyecto no vinculado (vía `aGrupo`).
1. `refs = actuales(p)` = **tareas pendientes de la etapa actual** del proyecto (`DP.etapaDe(p)`); `[]` si publicado/cancelado.
2. Si vino `gid` (incluye `''`): saca `pid` de todos los grupos y lo agrega al grupo `gid` (si existe).
3. **Regla "una tarea, una tanda abierta"**: por cada OTRA tanda abierta que tenga alguna de esas refs → `tUpd(o, {tareas: sin esas refs}, 'Pasó tareas a <t.nombre>')` (el proyecto sigue en `o.productos`).
4. `tUpd(t, {productos: ∪ pid, tareas: ∪ refs, grupos}, 'Vinculó <proyecto>')`.
5. Abre el picker del proyecto (`S.pick=pid`). Toast: con refs → `«<p>» vinculado con N tarea|tareas de <Etapa>. Tildá o destildá las que quieras.`; sin refs → `«<p>» vinculado. Elegí sus tareas.`
- Un proyecto **puede estar en varias tandas abiertas** (con tareas distintas); una tarea solo en una abierta.

### 1.8 "Elegir tareas" — picker por etapa
Hint: `Tildá las tareas que entran en «<tanda>». El casillero de cada etapa suma o saca todas sus tareas pendientes.`
Por cada etapa del proyecto (`DP.etapasDe(p)`, color `e.c` como borde) que tenga tareas ≠ `no_aplica`:
- Checkbox de etapa: checked si todas sus pendientes están en la tanda; disabled si no tiene pendientes; texto `<b>Etapa</b> en/pen pendientes en la tanda[ · etapa actual]`. Tildar → `sumar(t, pendEtapa(p,e), 'Sumó una etapa')`; destildar → `quitar(..., 'Sacó una etapa')`.
- Checkbox por tarea: checked si la ref está en la tanda; **disabled si está hecha** (hint `hecha`); si está en otra tanda abierta hint `está en <otra> (tildala para traerla)`. Tildar → `sumar(t,[ref],'Sumó una tarea')`; destildar → `quitar(t,[ref],'Sacó una tarea')`.
- Botón `Listo` cierra el picker.
- `sumar(t, refs, accion)`: quita las refs de las otras tandas abiertas (`'Pasó tareas a X'`), luego `tUpd(t, {productos: ∪ pids de las refs, tareas: ∪ refs})`. `quitar` solo saca refs de `tareas` (no desvincula el proyecto).

### 1.9 Desvincular / grupos
- `desvincular(t,pid)` (sin confirmación): saca `pid` de `productos`, todas sus refs de `tareas` y de todos los grupos; `'Desvinculó <p>'`.
- `aGrupo(t,pid,gid)`: si el proyecto no está vinculado → `vincular(t,pid,gid)`; si está → lo mueve al grupo (`''` = sin grupo); bitácora `'<p> → <grupo>'` o `'<p> sin grupo'`.

### 1.10 Cerrar la tanda — `cerrarTanda(t, pasar)`
Franja (fondo warn): `Cerrar «<tanda>»: [Cerrar y pasar lo pendiente a la próxima tanda] [Cerrar y dejar lo pendiente sin planificar] cancelar`.
1. `ws` = refs resueltas; `H` = no pendientes; `pendR` = refs pendientes; `pendP` = proyectos únicos de `pendR`; `resumen = 'H de N tareas hechas'`.
2. `tUpd(t, {estado:'cerrada', cerrada_el: ahora, resumen, pendientes: pendR}, 'Cerró la tanda')`. `tareas`/`productos`/`grupos` de la cerrada quedan intactos (histórico). Como deja de ser "abierta", sus tareas pendientes quedan **sin planificar** automáticamente.
3. Si `pasar` y hay pendientes:
   - Grupos a copiar `grs` = grupos de `t` con **id nuevo**, filtrando `productos` a los de `pendP`, descartando grupos vacíos.
   - `nx` = primera otra tanda abierta con `inicio > t.inicio`.
   - Si no hay `nx` → **crea una tanda automática**: `inicio = t.fin + 3 días` (vie→lun), `sem = max(1, round((días(inicio,fin)+3)/7))`, `fin = inicio + sem*7 - 3`, `nombre 'Tanda '+(total+1)`, `productos: pendP, tareas: pendR, grupos: grs`, bitácora `'Creó la tanda' / 'con lo pendiente de <t>'`. Sin chequeo de horizonte ni de fin de semana.
   - Si hay `nx` → `tUpd(nx, {productos ∪ pendP, tareas ∪ pendR, grupos: [...nx.grupos, ...grs]}, 'Recibió lo pendiente de <t>')` (los grupos se **concatenan**, pueden duplicarse nombres y un proyecto quedar en dos grupos).
   - Selecciona la destino.
4. Si no pasa: `S.sel=''` (vuelve a `actual()`).
5. Toast `«<t>» cerrada: H de N tareas hechas.`

### 1.11 Lista de desarrollo
Título `Lista de desarrollo <count>`; select `Ordenar`; buscador `Buscar en la lista`; filtro `Desarrollo` (`DP.filtroDes`: `Todos` + tipos); select `Responsable` (`Todos` + nombres); link `Usar este orden como manual` (solo admin y modo ≠ manual).
- **Universo**: proyectos `activo` = no cancelado y etapa ≠ `publicado` (los `pausado` entran).
- **Filtros**: `des` → `DP.tipoDes(p)===des`; `resp` → `p.lider===resp` **o** alguna tarea pendiente con `responsable===resp`; `q` (normalizado sin acentos, todas las palabras) sobre `[nombre, codigo, ref_erp, lider, familia]`.
- Opciones del select Responsable: únicos de `lider` + `responsable` de **todas** las tareas (incluso hechas) de proyectos activos, orden alfabético `es`.
- **El filtro Responsable también filtra** las filas de tareas dentro de la tanda y el texto del Google Calendar (comparten `S.resp`), no los KPIs ni la carga.
- **Modos de orden** (`ORDEN`): `manual 'Orden manual (arrastrando)'`, `rec 'Recomendado para atender'`, `puntaje 'Mayor puntaje'`, `nuevos 'Más nuevos'` (creado desc), `viejos 'Más viejos'` (creado asc), `limite 'Fecha límite más cercana'` (asc, sin fecha = '9999' al final), `avance 'Más avanzados'` (`DP.avance(p).pct` desc), `nombre 'Nombre'` (localeCompare es). `rec`/`puntaje` desc.
- **Modo por defecto**: `S.orden` (elección de la sesión, no persiste) o, si vacío, `manual` si `config/orden.ids` tiene algo, si no `rec`.
- **Orden manual**: primero los ids presentes en `config.orden.ids` en ese orden; después los no ordenados, por puntaje desc.
- **Fila**: grip (admin) · número `i+1` · nombre (link) + hint `<Etapa> · <lider|'sin responsable'>` + badge por cada tanda abierta que lo contiene `'<tanda> · N tareas'` (N = refs del proyecto en esa tanda) · botón puntaje (`3,4` con coma; abre editor) · acciones admin: en modo manual `↑` (disabled 1º), `↓` (disabled último), `⤒` (arriba de todo); si la tanda seleccionada está abierta: `Tareas en <tanda>` (si ya está vinculado: abre picker y hace scroll al bloque) o `+ <tanda>` (primario → `vincular`). Fila con borde izquierdo cian (`plan`) si está en alguna tanda abierta.
- Hint: manual → `El orden lo decidís vos: arrastrá las filas o usá ↑ ↓. Lo que no se ordenó va al final, por puntaje.`; otro → `Si arrastrás una fila, la lista pasa a orden manual.`; siempre + ` Los proyectos con borde celeste ya están en una tanda.`
- Vacío: `No hay proyectos en curso que coincidan.`
- **Guardar orden** (`guardarOrden(ids)` → `config/orden = {ids, actualizado, quien}`), `ordenVisible` = ids de la lista filtrada en pantalla:
  - `↑/↓/⤒`: mueve dentro de `ordenVisible` y guarda `[...visibles reordenados, ...ids previos de config que no están visibles]`.
  - Arrastrar fila sobre otra fila (mitad superior = antes, inferior = después): igual que arriba y fija `S.orden='manual'`.
  - `Usar este orden como manual`: guarda **solo** `ordenVisible` (pisa el orden previo; los ocultos por filtro pierden su posición) y fija modo manual.
- **Editor de puntaje** (toggle por proyecto, debajo de la fila): 4 selects 1..5 (`CRIT`): `estrategico 'Estratégico'` (1·nada … 5·clave), `comercial 'Comercial'` (poco/mucho), `complejidad 'Complejidad'` (simple/compleja), `recursos 'Recursos'` (pocos/muchos); valor actual o 3. Cambio → `DP.cruce('guardarPuntaje', pid, criterio, n)` (página: requiere admin; si igual no hace nada; guarda `puntaje.{k}=n`, bitácora `'Puntaje'` `'<Etiqueta>: viejo → n'`). Texto: `Puntaje X,Y = (3 × estratégico + 2 × comercial) ÷ (complejidad + recursos), más un extra si tiene fecha límite cerca.` + link `listo`. Disabled en solo lectura (pero el editor se puede abrir).

### 1.12 Fórmulas
- `DP.puntaje(o)` = `round(((3E + 2C)/(X + R) + u) * 10)/10`, E/C/X/R = `puntaje.*` (falsy → 3); `u` = días hasta `fecha_limite` (desde ahora, fraccional): `≤7 → 3`, `≤30 → 1.5`, si no 0 (vencidas también suman 3).
- `rec(p)` ("Recomendado para atender") = `puntaje(p)` + `min(4, 2 × #tareas atrasadas)` (atrasada = pendiente con `fecha < hoy`) + (fecha_limite: días corridos `<0 → +4`, `≤14 → +2`) + (`+2` si está en alguna tanda abierta) + (`+1` si la tarea actual no tiene responsable) + (`-3` si `estado_general==='pausado'`) + `min(2, díasDesdeCreado/30)`. (La fecha límite pesa dos veces: en `u` y aquí.)

### 1.13 Arrastrar y soltar (solo admin)
- Origen: fila de la lista (`data-dl`) o bloque de proyecto en la tanda (`data-tp`).
- Destinos: fila de lista (solo si el origen es la lista) → reordenar; un `.pl-grupo` (incluye `Sin grupo`) dentro de una tanda abierta → `aGrupo(sel, id, gid|'')` (si viene de la lista y no estaba, vincula con ese grupo); la sección de tanda abierta (fuera de grupos) → si viene de la lista y no está vinculado → `vincular`. Bloque de tanda soltado sobre la lista: nada.
- Feedback visual: `dropb`/`dropa` (línea arriba/abajo), `dropt` (contorno punteado).

### 1.14 Parámetros de entrada
`montar(el, {tanda})` / `params({tanda})` → selecciona esa tanda. Desde Inicio: `navegar('tandas')`.

---

## 2. Tareas (`mod-tareas.js`, registro `'tareas'`)

**Propósito**: "el trabajo del día": todas las tareas de proyectos (no variantes, no pasos previos de pedidos), por estado, en lista agrupada o tablero. Por defecto solo lo planificado (tareas en una tanda abierta). Lo usa todo el equipo; edita solo `admin`.
**Escribe** (solo por cruces): `tarea` (estado/responsable/fecha/detalle), `tareaATanda`, `altaErp`, y desde el detalle común `tareaMover`, `tareaQuitar`. **Lee**: `productos`, `tandas`, `DP.equipo()`.

### 2.1 Construcción de la lista — `items()`
- Mapa `ref → tanda abierta` (si una ref estuviera en dos abiertas gana la última por orden de inicio).
- Para cada proyecto **no cancelado** (incluye publicados y pausados), para cada tarea de `DP.tareasDe(p)`:
  - Se excluye `no_aplica`.
  - `est` = estado visible `DP.estadoVisible(t, ts)`: `'bloqueada'` si está pendiente y tiene alguna dependencia (`t.depende[]`) pendiente; si no `t.estado || 'pendiente'`.
  - Se excluyen las `hecho` cuyo `(hecho_el || fecha)` (día) sea `< hoy − 14 días` corridos (o sin ninguna fecha).
  - `fecha` = `t.fecha`; si vacía y no hecha → fecha sugerida `DP.fechasSugeridas(p)[t.id]` (calculada una vez por proyecto). `sug = !t.fecha && est!=='hecho'`.
  - `actual` = es la tarea actual del proyecto **o** está `en_curso`.
  - `tanda` = tanda abierta que la contiene o null.

**Fechas sugeridas** (`DP.fechasSugeridas(p)`, base.js): `cur = fecha_inicio || creado || hoy`. Recorre `tareasDe(p)`: salta `no_aplica`; `hecho` → `fin[id] = hecho_el||fecha||cur`, `cur = ese`; resto → `base = cur`, o si tiene `depende` la mayor `fin[]` de sus dependencias (o `cur`); `sug = diasHabiles(max(base, hoy), max(1, duracion||1))` (suma N días hábiles lun-vie a partir del día siguiente); `f = t.fecha || sug`; `fin[id]=f`; `cur = max(cur, f)`. Devuelve `{tareaId: sug}`.

### 2.2 Filtros (en este orden)
| Control | Estado `S` | Lógica |
|---|---|---|
| Alcance (si no hay proyecto ni tanda fijados): select `Mostrar` | `alcance` (def `tandas`) | `tandas 'Planificadas (en una tanda)'` → `w.tanda != null`; `actuales 'La tarea actual de cada proyecto'` → `w.actual || est==='hecho'`; `todas 'Todas, también las dormidas'` → sin filtro |
| Chip `Solo <tanda>` (uno por tanda abierta) | `tanda` | solo refs de esa tanda (también funciona con una cerrada si llega por parámetro). Al activo se muestra chip `Solo <tanda> ✕` en lugar del select de alcance |
| Proyecto (solo por parámetro `proy`) | `proy` | solo tareas de ese proyecto; **prevalece** sobre tanda y alcance; chip `Proyecto: <p> ✕` |
| `Desarrollo` (`DP.filtroDes`) | `des` | `DP.tipoDes(p)===des` |
| `Responsable` | `resp` | opciones: `Todos` (''), `Yo (<nombre>)` si hay sesión, demás nombres (de todas las tareas visibles por `items()`, alfabético), `Sin responsable` (`'__nadie'` → `!t.responsable`) |
| Buscador `Buscar por tarea, proyecto o responsable` | `q` | normalizado, todas las palabras en `[t.nombre, p.nombre, p.codigo, t.responsable]` |
| Chips de estado | `est` | `Sin terminar <n>` (default, `est=''` → todo menos `hecho`) y uno por estado visible con punto de color y contador; clic en el activo lo desactiva |

Estados visibles (`EST`): `pendiente 'Pendiente'`, `en_curso 'En curso'`, `en_espera 'En espera'`, `bloqueada 'Bloqueada'`, `hecho 'Hechas (14 días)'`. Colores: pendiente muted, en_curso cian, en_espera warn, bloqueada accent (magenta), hecho ok.
Contadores: `cnt(k)` sobre el conjunto filtrado (antes del chip de estado). Título: `Tareas <N sin terminar>`.

### 2.3 Vistas
Segmentado `Lista` | `Tablero por estado` (`S.modo`, def `lista`).
- **Tablero**: columnas = los 5 estados (o solo el elegido en chips). Cada columna toma del conjunto filtrado las de ese estado, orden fecha asc (sin fecha al final), máx 60 tarjetas + `y N más: filtrá por responsable o proyecto.`; vacía `Nada acá.`. Tarjeta: nombre, proyecto (link), hint `<responsable|'sin responsable'>[ · [≈ ]dd/mm/yy][ · <tanda>]`, si bloqueada `Espera a: <nombres>`, select de estado (5 estados reales).
- **Lista**: select `Agrupar` (`GRUPOS`): `resp 'Responsable'` (def) → `responsable||'Sin responsable'`; `proyecto 'Proyecto'` → nombre; `etapa 'Etapa'` → nombre de etapa (agrupa por etiqueta, mezclando proyectos); `semana 'Semana'` → `'Semana del dd/mm/yy'` (lunes de `fecha`, incluida la sugerida) o `'Sin fecha'`; `estado 'Estado'` → etiqueta; `'' 'Sin agrupar'` → un solo grupo sin título.
  - Orden dentro de grupo: primero `actual`, luego fecha asc.
  - Orden de grupos: `estado` → orden de `EST`; `semana` → `'Sin fecha'` al final, resto por la fecha del primer ítem del grupo; demás → alfabético `es`, claves que empiezan con `'Sin'` al final.
  - Cabecera `<clave> <count>`; máx 150 filas por grupo + `y N más en este grupo: filtrá o buscá para verlas.`
  - Vacío: si alcance `tandas` sin tanda/proyecto fijado y no hay tandas abiertas → `Todavía no hay tandas. Las tareas aparecen acá cuando su proyecto entra en una tanda; mientras tanto podés ver «Todas, también las dormidas».`; si no → `No hay tareas con estos filtros.`

### 2.4 Fila de tarea (lista)
- Botón redondo `✓`: si hecha → `tarea {estado:'pendiente'}` (limpia `hecho_el`; no revierte el `en_curso` automático de la siguiente). Si no: si `t.ref && !p.ref_erp` → abre el pedido de REF (abajo); si no → `tarea {estado:'hecho'}`.
- Nombre + proyecto (link) + etapa (hint).
- Select estado (Pendiente/En curso/En espera/Hecho/No aplica). Elegir `hecho` con `t.ref && !p.ref_erp` → pedido de REF (no guarda); resto → `tarea {estado}`.
- Select responsable → `tarea {responsable}`.
- Fecha: date (`class late` roja si `t.fecha < hoy` y no hecha) → `tarea {fecha}`; si hecha `hecha dd/mm/yy`.
- Columna tanda: badge `<tanda>` si está en una abierta; si no, admin y no hecha y existe tanda actual (en curso → vencida → primera abierta) → botón `+ <tanda>` → `cruce('tareaATanda', ref)` (página: `tActual()`; si no hay → error `No hay una tanda abierta.`; `sumarTareas` con la regla una-tarea-una-tanda y vincula el proyecto; toast `Tarea sumada a <tanda>.`).
- Líneas extra: `Espera a: <tareas que bloquean>`; `Fecha sugerida ≈ dd/mm/yy` (si sugerida); `t.nota`.
- **Pedido de REF del ERP** (una fila a la vez, `S.pideRef`): `Para dar el alta hace falta el código del producto en el ERP: [input REF maxlength 20] [Guardar y marcar hecha] cancelar`. Vacío → refoca. OK → `cruce('altaErp', pid, sid, ref)` (página: `p.ref_erp = ref`, tarea `hecho`, `hecho_el = ahora`, la primera pendiente si está `pendiente` pasa a `en_curso`, bitácora `'Alta en el ERP'`).
- Al final, el **detalle común** `DP.tareaDetalleHtml(p, t, ro)` (§2.5).

### 2.5 Detalle de tarea (`⋯ más`, pieza común de base.js, también usada en la ficha del proyecto)
`<details>` (recuerda cuál está abierta en `DP.tareaAbierta = 'pid|sid'`). Guarda **en cada change** vía cruces:
- `Nombre` (text, maxlength 120; vacío → revierte) → `tarea {nombre}`.
- `Etapa` (select de etapas del proyecto) → `tarea {etapa}` (se re-inserta al final de esa etapa).
- `Duración (días hábiles)` (number 0..120; `parseInt`, mínimo 0) → `tarea {duracion}`. (Para sugerencias 0 se trata como 1.)
- `Entregable` (maxlength 80) → `tarea {entregable}`; `Nota` (maxlength 300) → `tarea {nota}`.
- `Depende de` (si hay otras tareas): checkbox por cada otra tarea del proyecto con su etapa; hint `No puede empezar hasta que estén hechas las que marques. Las fechas sugeridas se ajustan solas.`; checkbox **deshabilitado si crearía un ciclo** (`DP.dependeDe(x, t)`, title `Esa tarea ya depende de esta`). Cambio → `tarea {depende: [ids tildados]}`.
- Botón `Usar la fecha sugerida ≈ dd/mm/yy` (solo si pendiente y sin fecha) → `tarea {fecha: sug}`.
- Link `+ Google Calendar` (si pendiente y tiene fecha o sugerida): `https://calendar.google.com/calendar/render?action=TEMPLATE&text=<enc('<tarea> · <proyecto>')>&dates=<fYYYYMMDD>/<(f+1)YYYYMMDD>&details=<enc('Proyecto: <p>' + ['\nEntregable: <e>'])>` (día completo).
- `↑ Subir` / `↓ Bajar` → `cruce('tareaMover', pid, sid, ∓1)`: intercambia con la tarea adyacente **de la misma etapa** en `p.pasos`; en el borde no hace nada; bitácora `'Reordenó las tareas'`.
- `Quitar tarea` (doble clic: `¿Quitar esta tarea? Tocá de nuevo`) → `cruce('tareaQuitar', pid, sid)`: borra el paso y lo saca de los `depende` de las demás; bitácora `'Quitó una tarea'`. **No** limpia refs en tandas.

### 2.6 Confirmar fechas sugeridas
Si admin y hay tareas visibles (`vis`, no hechas) con fecha sugerida: botón `Confirmar las fechas sugeridas (N)` → franja `Confirmar la fecha sugerida en N tarea|tareas sin fecha: [Confirmar] cancelar` → recorre en serie la foto `[ref, fecha]` del último dibujo y hace `tarea {fecha}` por cada una; toast `Fechas confirmadas en N tarea.|tareas.`. De a una: botón del detalle (§2.5).

### 2.7 Parámetros
`{proy, resp, tanda, modo}` (desde la página: `resp: V.resp||''`, `tanda: V.ptanda||''`, `modo: V.tmodo||''`, `proy` si vino `proyecto`). `proy` truthy → fija `S.proy`. `resp`, `tanda`, `modo` solo se aplican **si difieren del último valor recibido** (`ult`), para no pisar lo que el usuario cambió; `modo` solo si es truthy. Entradas: Planificación (`{tanda}`), Inicio (`{resp: yo}`), ficha de proyecto (`{proyecto}`).

---

## 3. Inicio (`mod-inicio.js`, registro `'inicio'`)

**Propósito**: pantalla de entrada personal: lo que le toca a quien entró, sus proyectos, la tanda en curso y resúmenes de Bandeja y Muestras. **Escribe** solo marcar tarea hecha (cruce `tarea`). **Lee**: `productos` (no cancelados), `solicitudes`, `tandas`, `muestras`, `config/muestras`.

- **Saludo**: hora local `<12 'Buen día'`, `<20 'Buenas tardes'`, si no `'Buenas noches'` + `, <nombre>`.
- Botones (si `sesion().puede`): `+ Cargar pedido` → `navegar('bandeja', {nueva:1})`; `+ Nueva muestra` → `navegar('muestras', {nueva:1})`.
- `tanda` = abierta que contiene hoy (`inicio ≤ hoy ≤ fin`) → si no 1ª con `fin < hoy` → si no 1ª abierta (orden inicio). `enTanda` = refs de **todas** las abiertas.

### 3.1 Lo mío
- Ítems: tareas **pendientes** de proyectos no cancelados con `responsable === sesion().nombre` y (`está en una tanda abierta` **o** `tiene fecha`). `late = fecha && fecha < hoy`.
- Orden: atrasadas primero → planificadas (en tanda) primero → fecha asc (sin fecha al final).
- Secciones: `Atrasadas · N` (roja; muestra las primeras 10) y `Para hacer · N` (primeras 15). Si total > 25: `Hay más: están en «ver todas mis tareas».`
- Fila: botón `✓` (disabled si no admin) · nombre + proyecto (link) · a la derecha `dd/mm` de la fecha (roja si atrasada) o `en tanda` (si planificada sin fecha) + ` · en espera` si `en_espera`.
- Marcar hecha: si `t.ref && !p.ref_erp` → toast `Para dar el alta falta el código del producto en el ERP: cargalo en la ficha.` y abre el proyecto; si no → `cruce('tarea', pid, sid, {estado:'hecho'})` + toast `Hecha: <tarea>.` (error → `No se pudo guardar.`).
- Cabecera `Lo mío <N>` + link `ver todas mis tareas` → `navegar('tareas', {resp: nombre})`.
- Vacíos: sin nombre → `Entrá con tu nombre para ver tus tareas.`; sin ítems → `No tenés tareas planificadas ni con fecha. Acá aparece lo que entra en una tanda con tu nombre o tiene fecha; el resto está dormido hasta que se planifica.`

### 3.2 Mis proyectos
Proyectos no cancelados con `lider === nombre` y etapa ≠ `publicado` (incluye pausados). Primeros 8: nombre (link) + `<Etapa> · h/t[ · sigue: <tarea actual>]` (`DP.avance`: h hechas / t no-`no_aplica`). `y N más.`. Vacío `No sos responsable de ningún proyecto en curso.`. Link `ver todos los proyectos` → `navegar('proyectos')`.

### 3.3 Tanda
`<b>nombre</b> dd/mm/yy – dd/mm/yy · <'empieza en N días' si inicio > hoy | 'quedan N día|días' si N ≥ 0 | 'terminó: hay que cerrarla'>`, objetivo, barra, `H de N tareas hechas · P proyectos[ · <rojo>K sin responsable</rojo>]`. H = refs no pendientes; **K cuenta tareas pendientes sin responsable de TODAS las tandas abiertas**, no solo de la mostrada. Vacío `No hay una tanda abierta. Se arman en Planificación.`. Link `abrir Planificación` → `navegar('tandas')`.

### 3.4 Bandeja
`solicitudes` con estado ∈ {`nueva`, `en_evaluacion`}, orden `creado` desc. Cabecera `Bandeja <N por resolver>`. Primeras 5: título (o `Sin título`) como link → `cruce('abrirSolicitud', id)` + `dd/mm[ · <pedido_por || contacto.nombre>]`. Vacío `No queda nada por resolver.`. Link `abrir la Bandeja`.

### 3.5 Muestras
`Muestras <total>`; línea `<b>n</b> <estado> · ...` contando por nombre de estado tomado de `config/muestras.estados` (**sin** los defaults del módulo Muestras: si la config no existe muestra el id crudo, p. ej. `enviada`; sin estado → `Sin estado`). Orden de aparición = orden de las muestras, no del recorrido. Vacío `Sin muestras cargadas.`. Link `abrir Muestras`.

---

## 4. Muestras (`mod-muestras.js`, registro `'muestras'`, vista `envios`)

**Propósito**: registro de cada muestra física mandada a producir: sus órdenes de USER, proyectos vinculados, estado en el recorrido, tildes, ronda, fecha, comentario y fotos. Lo usa desarrollo (y colaboradores). **Escribe**: colección `muestras`, `config/muestras`. **Lee**: `muestras`, `DP.proyectos()` (resumen que da la página: `{id, nombre, codigo, cancelado, etapa, listo}`).
Permisos: `puede()` = `sesion().puede && DP.db` → crear, editar, borrar, cambiar estado, tildar, pegar. `adm` = `puede && admin` → botón `Estados y tildes`. Sin `puede`: todo en solo lectura (estado disabled, tildes solo las marcadas como etiqueta fija, sin `Editar`).

### 4.1 Modelo `muestras/{id}`
```
ordenes: [{ numero: string, nombre: string }]   // ≥1 con número o nombre (trim)
proyectos: [proyectoId]                          // muchos-a-muchos con proyectos (array en la muestra)
proyecto_id: string                              // legado = proyectos[0] || ''
estado: string                                   // id de config.estados
fecha_envio: 'YYYY-MM-DD' | ''
ronda: number | ''                               // input 1..99
tildes: [tildeId]
comentario: string                               // textarea maxlength 2000, trim
fotos: [{ id, tipo /*contentType*/, url? /*solo si es data: URL*/ }]   // sin 'nombre'
creado, actualizado: ISO; autor: sesion.id; quien: sesion.nombre
bitacora: [...]
```
- Lectura de proyectos con legado: `proys(m) = m.proyectos (si no vacío) || [m.proyecto_id] || []`.
- **Título / formato de orden**: cada orden `'#' + numero + ' ' + nombre` (sin `#` si no hay número; sin nombre si vacío); varias unidas por ` · `; sin órdenes → `Muestra sin orden`. Ej.: `#SUB-31584 Windflags tela bandera · #DIR-31586 Windflags imp directa`. En la tarjeta cada orden es un chip `<b>#numero</b> nombre`.
- `fecha(m)` (para ordenar) = `fecha_envio || día de creado`.

### 4.2 Config `config/muestras` = `{ estados: [{id, nombre, tono}], tildes: [{id, nombre}], actualizado }`
Defaults (si `estados` vacío/inexistente; tildes si `tildes` inexistente — un array vacío guardado significa "sin tildes"):
| id | nombre | tono |
|---|---|---|
| `enviada` | Enviada a producción | azul |
| `cortada` | Cortada (en mis manos, sin coser) | ambar |
| `costura` | En costura | azul |
| `terminada` | Terminada | gris |
| `aprobada` | Aprobada | verde |
| `con_cambios` | Aprobada con cambios | ambar |
| `rechazada` | Rechazada | rojo |

Tildes default: `avisado 'Avisado'`, `fotos 'Fotos sacadas'`. Tonos (`TONOS`): `gris 'Gris'`, `azul 'Azul'`, `ambar 'Ámbar'`, `verde 'Verde'`, `rojo 'Rojo'`. El **orden de la lista de estados = orden del recorrido** (usado en "Por estado"). Estado desconocido (no está en la config) → `{id, nombre: id || 'Sin estado', tono: 'gris'}` y se agrega al final de los selects/chips.

### 4.3 Pantalla
- Encabezado `Muestras <total>` (sin filtrar). Botones (si `puede`): `Estados y tildes` (solo adm), `Pegar desde planilla`, `+ Nueva muestra` (primario). Los paneles Nueva / Pegar / Estados-y-tildes son mutuamente excluyentes (abrir uno cierra los otros; editar una existente no los cierra).
- Buscador `Buscar por número u orden de USER, proyecto o comentario` → normalizado, todas las palabras en: `numero nombre` de cada orden + nombres de proyectos + comentario + nombre del estado.
- `Ordenar` (`ORDEN`): `nuevas 'Más nuevas'` (def, fecha desc), `viejas 'Más viejas'`, `estado 'Por estado'` (índice en config, desconocido = 99; empate fecha desc), `proyecto 'Por proyecto'` (nombre del 1er proyecto, sin proyecto = `'~'`; empate fecha desc).
- **Filtros**: `base` = proyecto (si `S.proj`) + texto. Chips de estado: `Todas <n base>` + uno por estado de la config + estados "huérfanos" presentes en datos, cada uno con punto de color y contador sobre `base`; clic fija el estado (no es toggle; `Todas` limpia). Fila `Tildes`: chip `✓ <tilde> <n>` por tilde (toggle). Chip `Proyecto: <p> ✕` si hay filtro de proyecto.
- Vacío: con muestras → `Ninguna muestra coincide con el filtro.`; sin ninguna → `Todavía no hay muestras. Cargá la primera con «+ Nueva muestra».`
- **Tarjeta**: chips de órdenes (o `sin orden`) + `Ronda N` · proyectos como links (o `sin proyecto`; borrado → `proyecto borrado`) · hint `enviada el dd/mm/yy` (si fecha_envio) o `cargada el dd/mm/yy` + ` · <quien>` · select de estado coloreado por tono → `update({estado, actualizado, bitacora: log('Estado', <nombre>)})` · botón `Editar` · tildes (toggle → `update({tildes ±id, bitacora: log('Tildó'|'Destildó', <nombre>)})`) · comentario (pre-wrap) · miniaturas de fotos (clic/Enter/Espacio → zoom a pantalla completa; Escape o clic cierra).

### 4.4 Alta / edición (editor en línea; la nueva aparece arriba de la lista, la existente reemplaza su tarjeta)
Borrador (`nuevoDraft`): nueva → 1 orden vacía, `proyectos = [S.proj]` si hay filtro de proyecto, `estado = 1er estado de la config`, `fecha_envio = hoy`, resto vacío. Existente → copia.
- `Órdenes de USER`: por fila input `N.º de orden` (mono) + `Nombre de la orden` + `✕` (si hay más de una). `+ Otra orden`.
- `Proyectos`: chips con `✕` + select `+ Vincular un proyecto…` / `+ Vincular otro proyecto…` con proyectos no cancelados aún no vinculados, orden alfabético, etiqueta `nombre · codigo`. Elegir agrega al borrador.
- `Estado` (select), `Fecha de envío` (date), `Ronda` (number 1..99, placeholder `1`).
- `Tildes` (toggles), `Comentario` (placeholder `Qué se espera, qué respondieron, qué falta…`).
- `Fotos`: miniaturas con `✕`; `<input type=file accept="image/*" multiple>` (si hay servicio de archivos; si no `En esta vista no se pueden subir fotos.`). Sube una por una (`Subiendo <archivo>…`); error → `No se pudo subir <archivo>.` y corta.
- `Guardar` (también Enter en cualquier input del editor) / `Cancelar` / mensaje de error / `Borrar` (solo existente; doble clic `¿Borrar esta muestra? Tocá de nuevo` → `delete`, toast `Muestra borrada.`).
- **Guardar**: limpia órdenes (trim, descarta filas con ambos vacíos); ninguna → `Poné al menos un número o nombre de orden.`. Data: `{ordenes, proyectos, proyecto_id: proyectos[0]||'', estado, fecha_envio||'', ronda: Number|'' , tildes, comentario.trim(), fotos, actualizado}`.
  - Nueva: `add({...data, creado, autor, quien, bitacora:[log('Registró la muestra', <título>)]})`, toast `Muestra registrada.`. Sin control de duplicados.
  - Edición: arma cambios `órdenes: <título>`, `proyectos: <nombres>|ninguno`, `estado: <nombre>`, `fecha: dd/mm/yy`, `ronda: N|—`, `tildes`, `comentario`, `fotos: N`; bitácora `log('Editó', cambios.join(' · '))` solo si hay alguno.
  - Error → `No se pudo guardar.`

### 4.5 Pegar desde planilla (carga masiva)
Texto de ayuda: `Copiá filas de la planilla (columnas: número de orden, nombre, casilla, comentario) y pegalas acá. Cada fila es una muestra; las órdenes que ya están cargadas no se repiten.` Placeholder: `SUB-31584⇥Windflags tela bandera⇥FALSE⇥avisado`.
Selects: `Casilla tildada =` (estado; default el 2º de la lista, o el 1º) y `Sin tildar =` (default el 1º).
**Parseo exacto** (`leerPegado`):
1. Separar líneas por `/\r?\n/`; cada línea por **TAB** (`\t`); `trim()` a cada celda.
2. Descartar filas donde col1 y col2 están vacías.
3. Por fila → una muestra: `ordenes: [{numero: col1 || '', nombre: col2 || ''}]`; `estado` = `si` si col3 coincide (trim, sin mayúsculas) con `/^(true|verdadero|si|sí|x|✓|✔|1)$/i`, si no `no` (FALSE, vacío, cualquier otro → sin tildar); `comentario` = col4 en adelante, no vacías, unidas con ` · `.
4. Ninguna fila → error `No encontré filas para cargar.`
5. **Duplicados**: conjunto con `norm(numero)` de todas las órdenes de todas las muestras existentes (`norm` = minúsculas, sin acentos, no alfanuméricos → espacio, trim; o sea `SUB-31584` ≡ `sub 31584`). Fila sin número → siempre entra. Con número ya visto → se salta. Se agrega al conjunto al aceptar (deduplica dentro del mismo pegado).
6. Inserta una por una: `{...fila, proyectos: S.proj ? [S.proj] : [], proyecto_id: S.proj||'', fecha_envio:'', ronda:'', tildes:[], fotos:[], creado, actualizado, autor, quien, bitacora:[log('Registró la muestra (pegada desde planilla)', <título>)]}`. Si una falla por permiso → corta.
7. Toast `N muestra cargada|muestras cargadas[ · K ya estaban (mismo número de orden)].`

### 4.6 Estados y tildes (solo adm) — editor sobre una copia
- Estados (texto `En qué punto del recorrido está la muestra. El orden de esta lista es el orden del recorrido.`): fila = punto de color, nombre (maxlength 60), select tono, `↑` `↓`, `✕` (deshabilitado si lo usan n muestras → title `Lo usan n muestras: cambialas de estado antes de quitarlo`, o si es el único). `+ Estado` → `{id:'e'+uid, nombre:'', tono:'gris'}`.
- Tildes (texto `Marcas sueltas que no son un paso del recorrido. Una muestra puede tener varias.`): nombre (maxlength 40), `✕` (deshabilitado si lo tienen n muestras → `Lo tienen n muestras: destildalas antes de quitarlo`). `+ Tilde` → `{id:'t'+uid, nombre:''}`.
- `Guardar listas`: nombre vacío → `Hay un nombre vacío.`; `guardarConfig('muestras', {estados:[{id,nombre.trim(),tono||'gris'}], tildes:[{id,nombre.trim()}], actualizado})`, toast `Listas guardadas.`; error → `No se pudo guardar: solo quien administra la herramienta puede cambiar estas listas.`. `Cancelar` descarta.

### 4.7 Parámetros
`{nueva}` (si `puede`: abre editor nuevo), `{q}` (pone búsqueda y limpia estado/tilde/proyecto), `{proyecto}` (filtro de proyecto y limpia q/estado/tilde). Entradas: Inicio (`nueva`), ficha de proyecto (cruce `verMuestras` → `proyecto`), cualquier botón `[data-mproj]` de la página.
Nota: "comentarios" de muestra = solo el campo `comentario`; este módulo **no** usa el hilo de comentarios de `DP.comentariosHtml`.

---

## 5. Catálogo técnico (`mod-catalogo.js`, registro `'catalogo'`)

**Propósito**: conocimiento técnico compartido: **Capacidades** (piezas/terminaciones/formas que necesitan los productos, y cuál conviene desarrollar primero), **Variantes** (modelos de cada producto y dónde están: moldes, TizadaPro, ERP) y **Opciones de slot** (lo que ofrece cada molde en cada parte). Edita solo `admin`.
**Escribe**: `capacidades`, `opciones` (directo); variantes y requiere/resuelve del proyecto por cruces. **Lee**: `productos`, `opciones`, `capacidades`, `solicitudes`.
Selector de sección (segmentado): `capacidades 'Capacidades'` (def), `variantes 'Variantes'`, `opciones 'Opciones de slot'`. Cambiar de sección cierra formularios y errores.

### 5.1 Capacidades — modelo `capacidades/{id}`
`{ nombre (≤80), familia (≤60, texto libre con sugerencias de familias existentes), ambito: 'prenda'|'plano', nota (≤200), lista: bool /*true = Resuelta, false = Por desarrollar*/, actualizado }`.
- **id** al crear = `norm(nombre).replace(/ /g,'_')` (ej. `abertura_lateral`), o `'c'+uid` si queda vacío. Se crea con `set({...data, lista:false})`. Editar hace `update` (el id no cambia al renombrar).
- Ámbitos (`AMB`): `'' 'Todo'`, `prenda 'Prendas'`, `plano 'Diseño plano'`.
- **Vínculo con proyectos/pedidos**: `p.requiere: [capId]` (proyectos de tipo producto, `DP.esProducto(p)`), `p.resuelve: [capId]` (desarrollos no-producto: tecnología, máquina, proceso…). `solicitudes.requiere` también (se copia al proyecto al aprobar).
- `faltan(o)` = ids de `o.requiere` que **existen** en capacidades y no están `lista`.

**Vista por proyecto** (cuando llega `proy`; desde la ficha: botón `Capacidades · n` (producto) o `Capacidades que resuelve · n` (no-producto) → `navegar('catalogo', {sec:'capacidades', proyecto})`):
- Chip `Producto: <p> ✕`. Texto: no-producto → `Tildá las capacidades que este desarrollo va a resolver. Cuando el proyecto termine, acá se ofrece marcarlas como resueltas.`; producto → `Tildá lo que este producto necesita. ` + (`<b>n</b> todavía por desarrollar.` | `Todo lo que necesita está resuelto.`).
- Grilla por familia (`familia || 'Otras'`, alfabético) con checkbox por capacidad (todas, sin filtro de ámbito) + badge `por desarrollar` si no está resuelta.
- Tildar/destildar → `cruce('guardarRequiere' | 'guardarResuelve', pid, [ids])` (página: requiere admin; `update({requiere|resuelve: ids})`, bitácora `'Capacidades'` o `'Resuelve'` con nombres o `ninguna`).

**Vista sin proyecto**: chips `Qué destraba más` (def) | `Todas las capacidades <n>`.

**"Qué destraba más" (ranking) — algoritmo exacto**:
1. `pend` = proyectos activos (no cancelados, etapa ≠ publicado; cualquier tipo) como `{o, k:'p', n:nombre}` + solicitudes con estado ∈ {`nueva`, `en_evaluacion`, `pospuesta`} como `{o, k:'s', n:titulo}`.
2. Filtro ámbito (`S.amb`) y, salvo `Mostrar también las resueltas`, solo capacidades `!lista`.
3. Por capacidad `id`: `users` = `pend` cuyo `requiere` incluye `id`; `unl` ("Destraba ya") = si resuelta `[]`, si no los `users` cuyo `faltan()` es **solo** esa capacidad (todas las faltantes == id).
4. Se muestran las que tienen `users.length > 0` (o todas si "mostrar resueltas").
5. Orden: por desarrollar antes que resueltas → `users.length` desc → `unl.length` desc (sin desempate por nombre).
6. **"De a dos"** (máx 3 tarjetas): de cada ítem de `pend` con **exactamente 2** faltantes, ambas en el ámbito, se forma el par ordenado. Por par: `ps` = ítems de `pend` con faltantes no vacías y **todas** dentro del par (incluye los que solo les falta una de las dos). Se quedan los pares con `ps ≥ 2`, orden `ps` desc, top 3. Tarjeta: `De a dos` · `<b>N</b> quedan con todo resuelto si se hacen` · `<b>CapA + CapB</b>` · nombres.
7. **Aviso "listos"** (ignora ámbito): capacidades `!lista` que están en `resuelve` de algún proyecto no cancelado cuya etapa es `publicado`. Caja `Hay desarrollos terminados que resuelven capacidades todavía marcadas «por desarrollar»:` + `Cap · ProyA, ProyB` + botón (admin) `Marcarlas como resueltas` → `update({lista:true, actualizado})` por cada una, toast `Capacidades marcadas como resueltas.`
- Texto: `Lo que comparten los productos: partes del molde, terminaciones, formas. Resuelta = el sistema de moldes ya la tiene; por desarrollar = hay que construirla. Resolver una sola puede destrabar varios productos. Cuentan los proyectos en curso y los pedidos sin resolver (borde punteado).`
- Controles: chips Ámbito, toggle `Mostrar también las resueltas`, `+ Capacidad` (admin).
- Tabla: `Capacidad` (nombre + link `editar` (admin; abre el form arriba y hace scroll) + hint `familia · nota` + `La resuelve: <links a proyectos no cancelados con id en resuelve>`) · `Estado` (botón `✓ Resuelta` / `Por desarrollar` → `update({lista: !lista})`) · `La necesitan` (#users) · `Destraba ya` (#unl, resaltado si >0; `—` si resuelta) · `Proyectos y pedidos` (chips: proyecto = link, verde si está en `unl`; pedido = chip punteado sin link; vacío `nadie todavía`). Sin filas: `No hay capacidades por desarrollar con estos filtros.`
- Pie: `Para marcar qué necesita un proyecto: abrí su ficha y tocá «Capacidades». Para ver, editar o borrar cualquier capacidad: «Todas las capacidades», arriba.`

**"Todas las capacidades" (gestión CRUD)**:
- `usan(id)` = proyectos no cancelados (cualquier etapa) con `id` en `requiere` + solicitudes {nueva, en_evaluacion, pospuesta} con `id` en `requiere` (no cuenta `resuelve`).
- Texto: `Todas las capacidades técnicas, por familia: <b>R</b> resueltas y <b>P</b> por desarrollar. Acá se crean, se editan, se marcan como resueltas y se borran las que nadie usa.` (conteo global, sin ámbito).
- Chips Ámbito + `+ Capacidad`. Tarjeta por familia (`familia || 'Sin familia'`, alfabético) con `count`; filas por nombre: nombre + nota · ámbito · toggle Resuelta/Por desarrollar · `la necesitan n` | `nadie la necesita` · `editar` · `borrar` (deshabilitado si n>0, title `La necesitan n: no se puede borrar`; doble clic `¿borrar? tocá de nuevo` → `delete`, toast `Capacidad borrada.`). Vacío `No hay capacidades cargadas.`
- **Formulario** (`Nueva capacidad` / `Editar capacidad`): `Nombre`, `Familia` (datalist), `Ámbito` (Prendas/Diseño plano; default `S.amb || 'prenda'`), `Nota`; `Guardar` / `Cancelar`. Nombre vacío → `Poné un nombre.`. OK → toast `Capacidad guardada.`; si era nueva activa `Mostrar también las resueltas` (para que aparezca aunque nadie la use). Error → `No se pudo guardar.`

### 5.2 Variantes (embebidas en `productos/{id}.variantes[]`)
Modelo de variante: `{ id:'v…', nombre, combinacion: {<slot>: <codigoOpcion>, …, libre?: texto}, origen: 'equipo'|'solicitud'|'sistema', solicitud_id?, estado, moldes, tizada, tizada_nombre, erp, responsable, fecha, nota, creado, pasos: [tareas] }`.
| campo | valores (`clave 'Etiqueta'`) |
|---|---|
| `estado` (VEST) | `propuesta 'Propuesta'`, `en_desarrollo 'En desarrollo'`, `muestra 'En muestra'`, `lista 'Lista'`, `descartada 'Descartada'` |
| `moldes` "Sistema de moldes" (VMOL) | `no 'Sin molde'`, `generada 'Generada por el motor'`, `de_alta 'De alta en moldes'` |
| `tizada` "TizadaPro" (VTIZ) | `sin_verificar 'Sin verificar'`, `no 'No cargada'`, `cargada 'Cargada'` |
| `erp` "ERP" (VERP) | `sin_verificar 'Sin verificar'`, `no 'No habilitada'`, `habilitada 'Habilitada para la venta'` |

**Avisos de lo que falta** (`gaps(v)`, en orden):
- `en_curso 'Nuevas en desarrollo'` si estado ∈ {propuesta, en_desarrollo, muestra} (solo filtro, no se muestra como aviso).
- Si `descartada` → sin más avisos.
- `alta_sin_tiz 'De alta sin cargar en TizadaPro'`: `moldes==='de_alta' && tizada!=='cargada'`.
- `tiz_sin_erp 'En TizadaPro sin habilitar en el ERP'`: `tizada==='cargada' && erp!=='habilitada' && estado==='lista'`.
- `erp_sin_tiz 'Habilitadas en el ERP sin TizadaPro'`: `erp==='habilitada' && tizada!=='cargada'`.
- `sin_verificar 'Sin verificar en TizadaPro o ERP'`: `tizada==='sin_verificar' || erp==='sin_verificar'`.

**Tareas de la variante** (plantilla interna `variante`, `DEF_PLANTILLAS`, reemplazable si existe una plantilla guardada con id `variante`; responsable = líder del producto):
| etapa | tarea | días | entregable |
|---|---|---|---|
| definicion | Definición de la combinación | 1 | Combinación definida |
| desarrollo | Receta o molde en el sistema de moldes | 3 | Variante de alta |
| desarrollo | Cargar el modelo en TizadaPro | 1 | Modelo cargado |
| muestra | Muestra | 2 | Muestra física |
| muestra | Aprobación | 1 | Muestra aprobada |
| lanzamiento | Habilitar en el ERP («Modelos que se venden») | 1 | Habilitada para la venta |

Al cambiar una tarea de variante (cruce `tareaVariante(pid, vid, sid, patch)` → `setStep('v|…')`): misma lógica de hecho/siguiente en curso; luego si no queda ninguna pendiente y estado ≠ `lista` → **estado = `lista`**; si no, si estado era `propuesta` → **`en_desarrollo`**. Las tareas de variantes no aparecen en Tareas ni en Planificación.

**Lista de variantes**: universo = variantes de proyectos no cancelados (de cualquier tipo), o solo del producto si hay `proy` (chip `Producto: <p> ✕`). Orden = orden de colección y del array (sin ordenar). Filtros: chips `Todas <n>` + uno por cada GAP con contador; buscador `Buscar por variante, producto u opción` sobre `[nombre, producto, texto de combinación, responsable, tizada_nombre]`. Botón `+ Variante` (admin). Vacío: hay variantes → `Ninguna variante coincide.`; no → `Todavía no hay variantes cargadas[ para este producto]. Una variante es un modelo del mismo producto: otra manga, otro cuello, otro largo.`
- **Texto de combinación** `comb(pid, c)`: por cada `[slot, código]`: `libre` → el texto; si no busca la opción con ese `slot` y `codigo` vinculada al producto (o cualquiera con ese slot+código) → `'<slot_nombre||slot>: <nombre||código>'`; unidas por ` · `. Vacío → `sin combinación cargada`.
- **Tarjeta**: nombre (`Sin nombre`) + tag `pedida` si `origen==='solicitud'` + producto (link) + combinación; toggle `más[ · tareas h/n]` / `cerrar` (una abierta a la vez); avisos (sin `en_curso`) en color warn unidos por ` · `; 4 selects: `Estado`, `Sistema de moldes`, `TizadaPro`, `ERP`. Expandida: `Nombre` (≤120; vacío revierte), `Nombre en TizadaPro` (≤80), `Responsable`, `Fecha`, `Nota` (≤300); `Tareas de la variante`: `✓` toggle hecho↔pendiente (`tareaVariante`), nombre, `hecha dd/mm/yy` o responsable; `Borrar la variante` (doble clic `¿Borrar esta variante? Tocá de nuevo`) + hint `Si se probó y no va, conviene dejarla como «Descartada» para que quede el registro.`
- Cualquier cambio de campo (si difiere) → clona `p.variantes`, aplica patch → `cruce('guardarVariantes', pid, vars)` (página: admin; guarda el array completo con bitácora `'Variantes'` + diff). Borrar = guardar el array sin esa variante.
- **Nueva variante** (form): `Producto` (`— elegir —` + proyectos no cancelados por nombre; preseleccionado si hay `proy`), `Nombre de la variante` (placeholder `Ej.: manga larga, cuello V`). Con producto elegido: un select por cada `slot` presente en las opciones vinculadas al producto (`opciones.productos` contiene pid), etiqueta `slot_nombre`, opciones `—` + `nombre[ (falta desarrollar)]` (valor = código); y texto libre (`Algo más (opcional)` si hay slots, si no `En qué cambia`; ≤200; placeholder `Descripción libre de la variante`). Cambiar producto resetea la combinación. `Agregar`: sin producto → `Elegí el producto.`; sin nombre → `Poné un nombre.`; → `cruce('nuevaVariante', pid, {nombre, combinacion: {...slots, libre?}})` → página agrega `{id, nombre, combinacion, origen:'equipo', estado:'propuesta', moldes:'no', tizada:'no', tizada_nombre:'', erp:'no', responsable: p.lider||'', fecha:'', nota:'', creado, pasos: plantilla variante}`.
- Otra fuente de variantes: aprobar en Bandeja un pedido tipo `variante` crea `{origen:'solicitud', solicitud_id, estado:'en_desarrollo', combinacion:{libre: descripcion[:200]}, fecha: fecha_limite, nota: evaluación, moldes/tizada/erp:'no', …}`.

### 5.3 Opciones de slot — modelo `opciones/{id}` (id del import, ej. `camiseta_basica__CA-01`)
`{ molde, molde_nombre, slot, slot_nombre, codigo, codigo_casa, nombre, estado: 'receta'|'molde'|'falta', habilitada: bool, por_defecto: bool, productos: [proyectoId], nota, actualizado }`.
Estados (`OEST`): `receta 'Receta del motor'`, `molde 'Molde a mano'`, `falta 'Falta desarrollar'`.
- Texto: `Lo que el sistema de moldes ofrece en cada parte de la prenda. «Habilitada» = el maestro la ofrece hoy. Una opción que falta se pide desde la Bandeja, con un pedido de tipo «Variante».`
- Orden: `molde_nombre`, `slot_nombre`, `codigo`. Agrupadas por `molde_nombre || molde || 'Sin molde'` en desplegables (recuerda cuál está abierto); resumen `<b>molde</b> N opciones · K por desarrollar · H habilitadas`.
- Tabla: `Parte` (slot_nombre||slot) · `Código` (codigo + salto + codigo_casa) · `Opción` (nombre + `por defecto`) · `Estado` (select) · `Habilitada` (checkbox) · `Variantes` (uso = variantes no descartadas de los productos de `o.productos` cuya `combinacion[o.slot] === o.codigo`) · `Nota` (text ≤200).
- Edición (admin): `estado`, `habilitada`, `nota` → `update({[campo]: valor (trim en texto), actualizado})` directo. **No hay alta ni baja de opciones en la UI** (vienen del import). Vacío `Sin opciones cargadas.`

### 5.4 Parámetros
`{sec, proy}`: `sec` cambia sección y cierra formularios; `proy` fija el producto (solo se limpia con el chip ✕). Hace scroll arriba. Rutas viejas `variantes`/`capacidades` abren el catálogo en esa sección.

---

## 6. Reportes (`mod-reportes.js`, registro `'reportes'`, vista `reporte`)

**Propósito**: resumen semanal para el equipo/dirección; se copia como texto para WhatsApp o mail. **No escribe nada**. **Lee**: `productos`, `solicitudes`, `tandas`, `muestras`, `feedback`, `config/muestras`.

### 6.1 Semana y filtro
- Semana = lunes a domingo. `sem` = lunes elegido (def `lunes(hoy)`), `fin = sem+6`, próxima semana `psem = sem+7` a `pfin = sem+13`. Navegación `‹` (−7 días) / `›` (+7); `Esta semana` (si no es la actual); título `Semana del dd/mm/yy al dd/mm/yy`.
- `enSem(f)` = día de `f` (primeros 10 chars) existe y `sem ≤ día ≤ fin`.
- Filtro `Desarrollo` (`DP.filtroDes`): filtra **proyectos y solicitudes** por `desarrollo` (def `producto`). No filtra muestras, tandas (salvo que sus tareas se resuelven contra proyectos filtrados) ni avisos.

### 6.2 Cálculos (`datos()`)
- `vivos` = proyectos no cancelados; `activos` = vivos con etapa ≠ publicado.
- `enTanda` = refs de las tandas abiertas **actuales**.
- Por cada tarea de `vivos`:
  - `hecho` → entra en **hechas** si `hecho_el` cae en la semana (solo `hecho_el`).
  - `no_aplica` → se ignora.
  - pendiente con `fecha < hoy` → **atrasadas** (relativo a HOY, no a la semana elegida).
  - `en_espera` → **en espera**. Con dependencias pendientes → **bloqueadas** (`de` = las que bloquean).
  - **Próxima semana**: `f = fecha`, o si no tiene y está en una tanda abierta, su fecha sugerida; entra si `psem ≤ f ≤ pfin` (`sug = !fecha`). Orden por `f`.
- **Cambios de etapa**: entradas de `p.historial` (sin la primera) con `fecha` en la semana → `{p, h}`; **terminados** = las de `h.estado==='publicado'`.
- **Sin movimiento en 2 semanas** (`quietos`): activos cuya última actividad (`fecha` de la última entrada de bitácora, o `actualizado`, o `creado`) es anterior a `hoy − 14`.
- Bandeja: **nuevos** = solicitudes con `creado` en la semana; **decisiones** = solicitudes con estado ∈ {`aprobada`→`Aprobado`, `rechazada`→`Descartado`, `pospuesta`→`Pospuesto`} y `decidido` en la semana; `porResolver` = estado ∈ {nueva, en_evaluacion}; `pospuestas` = estado pospuesta (ambos estado actual).
- **Tanda**: la primera tanda **abierta** (por inicio) que se superpone con la semana (`inicio ≤ fin && t.fin ≥ sem`). Info: total refs resueltas, hechas = total − pendientes, `carga` = pendientes agrupadas por `responsable || 'Sin responsable'`, nombres de proyectos.
- Muestras: conteo por nombre de estado (de `config/muestras`; sin config → id; vacío `Sin estado`); **de la semana** = muestras con `actualizado || creado` en la semana.
- **Por persona**: `{h: hechas de la semana, p: tareas de la próxima semana}` por `responsable || 'Sin responsable'`. **Por línea**: activos por `linea` (`sublimacion 'Sublimación'`, `directa 'Impresión Directa'`, `ecouv 'EcoUV'`, si no `Sin línea`).
- **Avisos «Esto me trabó»**: `feedback` con `fecha` en la semana, orden asc.

### 6.3 Pantalla
- KPIs: `tareas hechas` · `cambios de etapa` (excluye los que pasan a publicado) · `proyectos terminados` · `pedidos nuevos` · `decisiones` · `tareas atrasadas` (rojo si > 0) · `proyectos en curso` (#activos, foto actual).
- Secciones:
  - **Tanda**: `<b>nombre</b> dd/mm/yy – dd/mm/yy[ · objetivo]`, barra, `H de N tareas hechas · P proyectos`; por persona `Nombre · n pendiente|pendientes` + hasta 12 `tarea · <link proyecto>` + `y N más`. Sin pendientes `No queda nada pendiente en la tanda.`; sin tanda `No hay una tanda en esta semana.`
  - **Avances**: por proyecto (link) → `✓ tarea (responsable) · …`; vacío `Sin tareas hechas esta semana.`; + subtítulo `Cambios de etapa`: `<proyecto> → <b>Etapa</b> dd/mm/yy` (incluye `Publicado`).
  - **Bandeja**: `<b>N</b> por resolver[ · K pospuestos]` + link `abrir la Bandeja`; `Pedidos nuevos`: `titulo[ · pide][ · cliente X]`; `Decisiones`: `<b>Aprobado:</b> titulo → <proyecto creado>` o `<b>Descartado|Pospuesto:</b> titulo · <motivo || evaluacion>`; vacío `Sin pedidos nuevos ni decisiones esta semana.`
  - **Muestras**: `<b>n</b> estado · …` (o `Sin muestras cargadas.`) + `Cargadas o modificadas esta semana`: `<título> · <estado>[ · comentario]`.
  - **Atrasado o trabado**: hasta 20 `<rojo>dd/mm/yy</rojo> tarea · proyecto · responsable|sin responsable` + `y N más`; `En espera` (12); `Bloqueadas` (12, `espera a X, Y`); `Sin movimiento en 2 semanas · N` (15 links + `y N más`). Vacío `Nada atrasado ni trabado.`
  - **Próxima semana**: por responsable `Nombre · n` + hasta 12 `[≈ ]dd/mm tarea · proyecto` + `y N más`. Vacío `Nada con fecha para la semana que viene. Acá entran las tareas con fecha confirmada y las que están en una tanda.`
  - **Por persona y por línea**: `<b>Nombre</b>: h hechas · p para la próxima semana` (o `—`); `Proyectos en curso por línea`: `Línea: n`.
  - **«Esto me trabó» `<n>`**: `dd/mm/yy · <quien|—>[ · en <vista>]` + texto. Vacío `Sin avisos esta semana.`

### 6.4 "Copiar resumen" — formato de texto exacto
`navigator.clipboard.writeText(texto)` → status `Copiado: pegalo en WhatsApp o en un mail.`; si falla, panel `No se pudo copiar automáticamente. Seleccioná el texto y copialo:` + textarea readonly (seleccionado) + `Cerrar` (mientras está abierto no se redibuja con datos nuevos). Texto (sin límites de cantidad; secciones solo si tienen datos; cada sección termina con línea en blanco; resultado `trim()`):
```
DESARROLLOS · semana del dd/mm/yy al dd/mm/yy

Tareas hechas: N · Cambios de etapa: N(sin publicados) · Terminados: N · Pedidos nuevos: N · Decisiones: N · Atrasadas: N

TANDA: <nombre> (dd/mm/yy – dd/mm/yy) · H de N tareas hechas
  <persona>: <tarea> (<proyecto>); <tarea> (<proyecto>)

AVANCES
  <proyecto>: <tarea>; <tarea>

CAMBIOS DE ETAPA
  <proyecto> → <Etapa|Publicado>

BANDEJA (<porResolver> por resolver)
  Nuevo: <titulo>[ (<pedido_por|contacto.nombre>)]
  <Aprobado|Descartado|Pospuesto>: <titulo>[ · <motivo||evaluacion>, solo si no es aprobada]

MUESTRAS
  <#num nombre · #num nombre> · <estado>

ATRASADO O TRABADO
  dd/mm/yy <tarea> (<proyecto>, <responsable|sin responsable>)
  En espera: <tarea> (<proyecto>)
  Bloqueada: <tarea> (<proyecto>) espera a <a>, <b>

PRÓXIMA SEMANA
  <persona>: [≈]dd/mm <tarea> (<proyecto>); …

«ESTO ME TRABÓ»
  <quien|—>: <texto>
```
(`BANDEJA` aparece solo si hay nuevos o decisiones; `ATRASADO O TRABADO` si hay alguna de las 3 listas.) No incluye "sin movimiento", "por persona" ni "por línea".

### 6.5 Botón «Esto me trabó» (de la página, no del módulo; `pagina-principal.html` L921, L1522-1527)
Botón flotante `Esto me trabó` en todas las pantallas → diálogo `Esto me trabó` / `Contá qué querías hacer y qué te frenó. Sirve para ajustar la herramienta.` / textarea `Qué pasó` (requerido, maxlength 1500) / contexto `Se guarda con: vista «<vista>»[ (proyecto <nombre>)], <nombre|sin nombre>, dd/mm/yy.` → `feedback.add({texto: trim[:1500], vista: <id de vista actual>, pid: <id proyecto si la vista es la ficha, si no ''>, quien: <nombre sesión>, autor: <id usuario|null>, fecha: ISO})` → `Gracias: queda registrado y aparece en el reporte semanal.` (cierra a 1,2 s); error `No se pudo guardar.`. Sin chequeo de permiso más allá de tener base.
Además (plan funcional, lógica de la página): todos los viernes 17:00 se descarga una copia completa de datos + este reporte (sin fotos/archivos/PIN) — fuera de este módulo.

---

## 7. Ambigüedades y rarezas (decidir al reconstruir)

**Planificación**
1. El **horizonte** solo bloquea la *creación manual* de una tanda cuyo inicio supere hoy+horizonte; no filtra la lista ni limita la tanda automática del cierre ni el botón de largo. El texto "Planificamos hasta…" sugiere más.
2. Nombre `'Tanda N'` con N = total de tandas + 1 → tras borrar una se repiten nombres. Sin unicidad.
3. `inicio` se edita sin validar (puede quedar > fin o vacío); solo `fin` se valida. `fin = inicio + sem*7 − 3` supone arranque lunes.
4. Al cerrar, la tanda conserva `tareas`; "dejar sin planificar" funciona solo porque deja de estar abierta. `pendientes` se guarda pero ningún módulo lo lee.
5. Pasar lo pendiente a una tanda existente **concatena grupos** (nombres duplicados; un proyecto puede quedar en dos grupos, cosa que el resto del código supone imposible). La tanda automática no salta fines de semana ni chequea horizonte.
6. `no_aplica` cuenta como "hecha" en KPIs/resumen de tanda (y en Reportes/Inicio "H de N"), mientras Tareas las oculta.
7. El filtro `Responsable` de la lista de desarrollo también filtra, sin aviso, las tareas mostradas dentro de la tanda y el texto del Google Calendar.
8. `Usar este orden como manual` guarda solo lo visible (pierde la posición de lo filtrado); `↑↓⤒`/arrastre mandan lo oculto al final.
9. `rec()` cuenta la fecha límite dos veces (en `puntaje` y aparte).
10. `vincular` "roba" las tareas de la etapa actual de otras tandas abiertas sin aviso (solo bitácora); el proyecto queda en la otra tanda con 0 tareas ("sin tareas elegidas").
11. Borrar tanda / desvincular / deshacer grupo: sin confirmación fuerte (doble clic o ninguna). El handler de borrar no re-chequea permiso (el backend debe hacerlo).
12. Refs colgadas: quitar una tarea o borrar un proyecto no limpia todas las tandas (borrarProyecto sí; `tareaQuitar` no). Se filtran al leer.
13. Arrays completos reescritos (last-write-wins) y varias escrituras secuenciales no transaccionales (`sumar`, `vincular`, `cerrarTanda`). En SQL: tabla `TandaTareas(tandaId, proyectoId, tareaId)` con **índice único filtrado por tanda abierta** para la regla una-tarea-una-tanda, y transacción.
14. En el picker una tarea hecha que ya está en la tanda no se puede destildar (sí con ✕ en la fila).

**Tareas**
15. Solo tareas de proyectos: las de variantes y los pasos previos de pedidos (que la versión anterior mostraba) no aparecen en Tareas, Inicio ni Planificación.
16. "Hechas (14 días)" usa `hecho_el || fecha`; hechas sin ninguna fecha desaparecen.
17. Agrupar por `Etapa` mezcla etapas homónimas de distintos proyectos y ordena alfabético (no por recorrido). Claves que empiezan con "Sin" van al final (incluido un proyecto llamado "Sin…"). En `Semana` el orden usa la fecha del primer ítem del grupo tras ordenar "actual primero".
18. Desmarcar una hecha no revierte el `en_curso` automático que se le puso a la siguiente.
19. Parámetros con memoria (`ult`): si el usuario quita el chip de tanda y vuelve a entrar desde Planificación con la misma tanda, no se re-aplica.
20. Confirmar todas las fechas = una escritura por tarea en serie (en backend: lote).
21. Responsable y "Yo" se resuelven por **nombre** (string), no por id de usuario.

**Inicio**
22. "K sin responsable" cuenta todas las tandas abiertas aunque muestre una sola. Recorte 10 atrasadas/15 para hacer con aviso "Hay más" solo si total > 25.
23. Marcar hecha exige `admin` aunque sea "lo mío"; para la tarea de alta ERP manda a la ficha (en Tareas se pide la REF en línea).
24. Resumen de muestras (y Reportes) usa solo `config/muestras` sin los defaults del módulo Muestras → ids crudos si nunca se guardó la config.

**Muestras**
25. Pegado: la col. 3 solo elige entre dos estados; col. 4+ va a comentario. El ejemplo del placeholder pone `avisado` en la columna de comentario: no se mapea al tilde "Avisado". ¿Intención?
26. Deduplicación solo por número de orden normalizado (`SUB-31584` = `sub 31584`), solo en el pegado; filas sin número y altas manuales no se controlan. El pegado no carga fecha ni ronda.
27. Orden "Por proyecto" usa `'~'` para "sin proyecto" pero `localeCompare('es')` pone símbolos **antes** que letras → quedan primeras (probablemente se quería al final).
28. No hay hilo de comentarios en muestras (solo el campo `comentario`). Fotos solo imagen y se guardan sin nombre de archivo.
29. Un Colaborador (`puede`) puede editar y borrar cualquier muestra, también las de otros.
30. Chips de estado no son toggle (los de tilde sí).

**Catálogo**
31. Crear una capacidad cuyo nombre normalizado ya existe **pisa** el doc existente (`set`) y lo vuelve "por desarrollar". Renombrar no cambia el id.
32. `faltan()` ignora ids de `requiere` inexistentes en capacidades, pero la página (`missing()`, filtro "listos" de Proyectos) los cuenta como faltantes → números distintos.
33. Borrar capacidad: `usan` cuenta solo `requiere` (no `resuelve`), así que puede dejar ids colgados en `resuelve`.
34. Ranking sin desempate estable (orden de documentos). "Listos" y "Marcarlas como resueltas" ignoran el filtro de ámbito; la vista por proyecto muestra todas las capacidades sin ámbito.
35. Opciones: no hay alta/baja en UI (solo import); el `slot` de `combinacion` debe coincidir exacto (mayúsculas: hay `Manga` y `cartera`).
36. Variantes nuevas desde el catálogo nacen con `tizada:'no'`/`erp:'no'` (las del import, `sin_verificar`); el `estado` cambia solo con las tareas (`lista`/`en_desarrollo`) pero también a mano, y los avisos no miran las tareas.
37. Tareas de variante solo se tildan (sin responsable/fecha/duración desde aquí) y no se planifican en tandas.

**Reportes**
38. Solo hechas/cambios/terminados/nuevos/decisiones/muestras de la semana/avisos dependen de la semana elegida; atrasadas, en espera, bloqueadas, quietos, por resolver, en curso y la "próxima semana" (vía tandas actuales) son foto de hoy → mirar semanas pasadas mezcla tiempos.
39. La tanda de una semana pasada no aparece si ya se cerró (solo busca abiertas).
40. El KPI/encabezado "Cambios de etapa" excluye pasajes a Publicado, pero la sección los lista. Texto copiado sin recortes; pantalla con recortes (12/15/20).
41. Muestras y avisos no respetan el filtro Desarrollo.


# Spec A — Desarrollos: modelo de datos, base (DP), página principal y puente

Alcance: `codigo/base.js`, `codigo/pagina-principal.html`, `codigo/puente (incluido en la pagina principal).js`, `datos/copia-de-datos.json` (snapshot del 12/10/2026). Se espiaron `mod-*.js` solo para cerrar reglas que viven allí (recomendado, dormidas, tandas) y la Guía PDF para contrastar.
Convención de citas: `base.js:DP.x`, `html:función` (pagina-principal.html), `puente:función`, `mod-x.js:función`.
Marcas para lo que no es código: **[verificado: dónde]** / **[inferido de X]** / **[no lo sé]**.

---

## 0. Arquitectura en 10 líneas

- Persistencia: base de documentos tipo Firestore provista por el host de artifacts de Claude: `window.claude.use('db')` → `db.collection(c).add/doc(id).set/update/delete/onSnapshot`, `db.doc('config/x')`. Sin esquema, sin servidor propio. **[verificado: html arranque L2249-2269]**; que se comporte como Firestore (ids, reemplazo de campos en `update`) es **[inferido de la forma de la API y de los ids de 20 chars del JSON]**.
- Modo autocontenido (`LOCAL_MODE`, html L966-1009): si no hay `window.claude.use` o la página corre en `file:`/host sin "claude", se instala un shim con la MISMA API sobre `localStorage['dp-local-db-v1']` (un JSON `{coleccion:{docId:doc}}`), semilla desde `<script id="dp-seed">`. **El JSON del paquete tiene exactamente ese formato** (`{productos:{id:{...}}, solicitudes:{...}, config:{equipo:{...}}...}`) **[verificado: estructura del JSON = `dpLocal.exportar()`]**.
- `update()` en el shim hace merge profundo de objetos (no de arrays): `merge(a,b)` html L978. Firestore real también reemplaza arrays enteros → todas las escrituras de listas (pasos, variantes, bitacora, tareas de tanda) son "leer todo, modificar, reescribir el array" (last-write-wins, sin transacciones).
- Identidad/permiso real = cómo se comparte el artifact: `user.canEdit()||user.isOwner()` → `isAdmin` (Editor); `user.can('data.write')` → `canWrite` (Colaborador). El PIN y el rol son solo UI. **[verificado: html L2253]**
- `base.js` define `window.DP` (utilidades, reglas, suscripciones, carga de módulos). La página se conecta UNA vez con `DP.conectar(host)` (puente) pasando db, sesión, proyectos resumidos, equipo, listas, plantillas, **cruces** (funciones de escritura compartidas), navegación, toast, assets.
- Cada pantalla = `mod-<nombre>.js`, cargado on-demand con `<script src="mod-x.js">` por `DP.cargar`; se registra con `DP.registrar(nombre,{montar,params,refrescar})`.
- La página principal conserva un "legado" grande (variables globales `prods`, `sols`, `V`, `render()`, filtros, Cronograma, login, buscador, Más) y suscripciones propias a casi todas las colecciones (doble suscripción con los módulos).

---

## 1. MODELO DE DATOS

### 1.1 Colecciones (inventario)

| Colección | En JSON | Docs | Quién escribe (código) | Id del doc |
|---|---|---|---|---|
| `productos` (proyectos) | sí | 65 | puente cruces, html (saveProj/setStep/import/nuevo), mods | auto (add) o semilla `pd-NN`/`ps-NN` |
| `solicitudes` (pedidos) | sí | 35 | puente `xCrearSolicitud`/`xAprobar`, html `quickAdd`/`setStep`, mod-bandeja | auto o semilla `sol-NN` |
| `capacidades` | sí | 53 | mod-catalogo, html `captoggle` | slug: `norm(nombre).replace(/ /g,'_')` o `'c'+DP.uid()` |
| `opciones` (opciones de slot) | sí | 102 | mod-catalogo (update de campos) | `<molde>__<codigo>` ej. `camiseta_basica__COS-ANC` |
| `muestras` | sí | 13 | mod-muestras | auto o semilla `m-sub-31561`, `m-dir-31586` |
| `config` (docs sueltos) | sí (6) | equipo, fuentes, listas, muestras, orden, plan | html/mods vía `DP.guardarConfig` o `db.collection('config').doc(x).set` | nombre fijo |
| `config/desarrollos` | NO | — | mod-plantillas `DP.guardarConfig('desarrollos',{tipos,actualizado})` | fijo |
| `tandas` | NO (LEEME: "todavía no trae tandas") | — | mod-planificacion, puente (`sumarTareas`,`desvincular`,`borrarProyecto`) | auto |
| `plantillas` | NO | — | puente `guardarPlantilla`/`borrarPlantilla` | clave fija (`prenda`,…) o `'t'+Date.now().toString(36)` |
| `comentarios` | NO | — | `DP.comentar` (base) | auto |
| `pines` | NO (el plan dice que la copia semanal no incluye PIN) | — | html `savePin`, borrar en Equipo | `'u-'+norm(nombre).replace(/ /g,'-')` |
| `vistas` (vistas guardadas, legado) | NO | — | html `viewOk` | auto |
| `feedback` ("Esto me trabó") | NO | — | html `fbForm` | auto |

Ids auto: en el host de Claude son 20 chars `[a-z0-9]` (35 productos, 13 solicitudes en el JSON); en modo local `Date.now().toString(36)+Math.random().toString(36).slice(2,8)` (~14 chars) html L980.
Generadores de ids internos (no doc ids):
- tarea (paso): `uid()` html L1103 = `'s'+Date.now().toString(36)+rand(5)` → 14 chars (`s14`: 416 en JSON); 343 tareas tienen `s`+9 (10 chars, semilla vieja).
- `DP.uid()` base L15 = `Date.now().toString(36)+rand(5)` (13 chars, sin prefijo; usado en grupos `'g'+DP.uid()`).
- variante: `newVarId()` html L1546 = `'v'+Date.now().toString(36)+rand(3)`; semilla usa `v1..v5` (únicos solo dentro del producto).
- plantilla nueva: `'t'+Date.now().toString(36)` (puente `guardarPlantilla`).

### 1.2 Correlativos (`nextCode`, html L1474)

```js
function nextCode(list,pre){const n=list.filter(p=>String(p.codigo||'').startsWith(pre)).map(p=>parseInt(String(p.codigo).replace(/\D/g,''))||0);return pre+String(Math.max(0,...n)+1).padStart(2,'0')}
```
- Solicitudes: `nextCode(sols,'SOL-')` → `SOL-38` (JSON: SOL-01..SOL-37, faltan 03 y 24 → **[inferido: borradas]**). Calculado en el cliente sobre la lista en memoria: **dos altas simultáneas pueden repetir código** (no hay unicidad).
- Proyectos: `PD-` (tipo `nuevo`), `CO-` (tipo `correccion`), `ERP-<ref>` o `nextCode(prods,'ERP-')` (importación). Semilla: `PS-NN` (25 proyectos "del sistema de moldes", PS-01..PS-27 sin 05/23) — nunca generado por código. JSON: PD-03..PD-52 (40; faltan 01,02,06,07,09-16). Próximo: PD-53, CO-01.
- Código de proyecto editable (`guardarProyecto`): si choca con otro solo hace `toast('Ojo: ya hay otro proyecto con el código …')` y guarda igual.
- `replace(/\D/g,'')` junta todos los dígitos: un código `ERP-PR-034` → 34; `PD-1-2` → 12. Mantener la semántica "max+1 por prefijo, mínimo 2 dígitos".

### 1.3 `productos` (proyecto). Campos

| Campo | Tipo | Valores / regla | Distribución JSON (65) |
|---|---|---|---|
| `codigo` | string ≤20 | ver 1.2 | PD 40, PS 25 |
| `nombre` | string ≤120 | requerido | 65 distintos |
| `tipo` | enum | `nuevo` \| `correccion` | nuevo 65 |
| `tipo_origen` | enum | tipo de la solicitud (`idea`,`solicitud`,`orden`,`correccion`), `equipo` (alta directa), `catalogo` (semilla) | catalogo 35, idea 22, solicitud 8 |
| `origen` | enum | `solicitud` (xAprobar), `manual` (alta directa), `erp` (importación), `sistema`/`lista` (semilla) | solicitud 30, sistema 25, lista 10 |
| `estado_general` | enum | `activo` \| `pausado` \| `cancelado` ("terminado" NO se guarda) | activo 62, cancelado 3 (PS-04, PS-21, PS-22) |
| `plantilla` | string | id de plantilla | prenda 59, plano 5, estructura 1 |
| `etapas` | array opc. | `[{id,label,c}]` copiadas de la plantilla si define flujo propio (`tplEtapas`) | ausente |
| `desarrollo` | enum abierto | `producto`,`tecnologia`,`maquina`,`proceso`,`procedimiento`,`sistemas` (+ custom de `config/desarrollos`) — ausente ⇒ `producto` (`DP.tipoDes`) | ausente en 65 |
| `pasos` | array | tareas, ver 1.4 | 12 pasos: 59; 8: 5; 11: 1 |
| `lider` | string | nombre de persona (texto libre = nombre en equipo) | Felipe 36, '' 29 |
| `linea` | enum | `''`,`sublimacion`,`directa`,`ecouv` (`LINEAS`) | '' 35, sublimacion 28, directa 2 |
| `fecha_inicio` | 'YYYY-MM-DD'\|'' | base de fechas sugeridas | '' 30, 10/07-10/12 resto |
| `fecha_limite` | 'YYYY-MM-DD'\|'' | entra en puntaje (urgencia) | todos '' |
| `ref_erp` | string ≤20 | código del producto en el ERP; obligatorio para cerrar la tarea `ref:true` | `PR-NNN` 54 (PR-001..PR-057), `574` 1, `PRP-001` 1, **`PR-034 PR-030`** 1 (dos códigos en un campo), '' 8 |
| `familia`,`etiqueta` | string | valor de `config/listas` (texto, no id) | familia '' 56 (Canguros y Buzos 3, Camisetas 2, Campera 2, Banderas 1, Gorros 1); etiqueta '' 59 (Fútbol/Básquet/Vóley 2 c/u) |
| `notas` | string ≤3000 | descripción; trae links de mockups/moldes pegados | 55 distintos |
| `puntaje` | `{estrategico,comercial,complejidad,recursos}` int 1-5 | falta ⇒ 3; alta directa guarda `{}` | E:2-5, C:2-5, X:1-4, R:1-4 |
| `prioridad_fija` | number | 0 = no fijado; >0 posición manual (legado `ranked()`) | todos 0 |
| `muestras` | array | LEGADO (rondas embebidas); hoy colección `muestras` | todos [] |
| `requiere` | string[] | ids de `capacidades` que necesita | 0:18, 1:7, 2:16, 3:16, 4:7, 5:1; todos existen en `capacidades` |
| `resuelve` | string[] | ids de capacidades que resuelve (para no-producto) | ausente |
| `variantes` | array | ver 1.5 | 7 proyectos (todos `sistema`) |
| `solicitud_id` | string | id de la solicitud origen | 30 con valor, todos existen |
| `corrige_id` | string | id del producto que corrige | '' |
| `archivos` | `[{id,tipo,nombre,url?}]` | adjuntos (cruce `guardarProyecto`) | ausente |
| `proveedor`,`costo_estimado` | string | solo no-producto (cruce `guardarProyecto`) | ausente |
| `historial` | `[{estado,fecha}]` | estado = id de etapa \| `publicado` \| `cancelado`; se agrega en cada cambio de etapa actual; `slice(-80)` | 65 arrays; definicion 66, desarrollo 2, cancelado 2 |
| `bitacora` | `[{fecha,autor,quien,accion,detalle}]` | ver 2.6; `slice(-200)`, detalle ≤300 | 406 entradas |
| `creado`,`actualizado` | ISO-8601 | `new Date().toISOString()` | — |
| `categoria` | string | solo semilla, **ningún código lo lee** | 30 docs, 8 valores (Bottoms de equipo 8, Camisetas de equipo 7, …) |
| `molde_sistema` | string | solo semilla, id del molde en el sistema de moldes (`camiseta_basica`, `camiseta_basquet`, `musculosa_entrenamiento`, `short_basico`, `short_basquet`, `short_dolphin`); **ningún código lo lee** | 7 |

Campos por `origen` en el JSON: `solicitud` trae `solicitud_id`/`corrige_id`; `sistema` trae `categoria`,`molde_sistema`,`variantes` (sin `corrige_id`/`solicitud_id`); `lista` trae `categoria`.

**Alta por cada camino** (todos con `creado=actualizado=T`, `estado_general:'activo'`, `prioridad_fija:0`, `muestras:[]`):
- `xAprobar` (puente): `nombre` = título (o `Corrección: <producto base>`), `codigo` PD/CO, `tipo`, `tipo_origen:s.tipo`, `ref_erp/familia/etiqueta/linea` = de la solicitud o del producto base, `fecha_limite`, `notas` = join('\n') de [descripcion, 'Cliente: x', 'Cantidad: x', 'Evaluación: x'], `pasos=tplPasos(tpl, YO)`, `...tplEtapas(tpl)`, `plantilla`, `desarrollo = s.desarrollo || plantilla.desarrollo || 'producto'`, `lider:YO`, `fecha_inicio:hoy`, `puntaje` de la solicitud, `requiere` de la solicitud, `solicitud_id`, `corrige_id`, `origen:'solicitud'`, `historial:[{estado: primera etapa de la plantilla|'definicion', fecha:T}]`, `bitacora:[Planificado: "desde SOL-xx, pedido por X"]`.
- `openNewProj`/`npForm` (html L1486-1496): `nombre`, plantilla (excluye `para:'variante'`), línea, responsable (default YO), inicio (default hoy). `tipo='correccion'` si `plantilla.para==='correccion'`. `tipo_origen:'equipo'`, `origen:'manual'`, `puntaje:{}`, `variantes:[]`, `requiere:[]`, `ref_erp:''`, bitácora "Creó el proyecto".
- Importación ERP (html L1640-1646): ver §3.6.

### 1.4 Tarea (`productos.pasos[]`, también `variantes[].pasos[]`)

```js
// tplPasos(tid, resp)  html L1128
{id:uid(), etapa, nombre, duracion:x.duracion||1, entregable:'', ref:!!x.ref, erp:!!x.erp,
 responsable:resp||'', fecha:'', estado:'pendiente', hecho_el:'', nota:''}
// tareaNueva (puente): {id:uid(), etapa, nombre, duracion:1, entregable:'', responsable:c.lider||'', fecha:'', estado:'pendiente', hecho_el:'', nota:''}   (sin ref/erp)
```
| Campo | Tipo | Regla |
|---|---|---|
| `id` | string | único dentro del proyecto; referenciado por `depende` y por tandas (`'p\|<pid>\|<sid>'`) |
| `etapa` | string | id de etapa del proyecto (`DP.etapasDe(p)`): default `definicion`,`desarrollo`,`muestra`,`industrializacion`,`lanzamiento`; en flujos propios los ids son el texto (`'Evaluación'`, `'Puesta en marcha'`…) |
| `nombre` | string ≤120 | no vacío (si se vacía se revierte) |
| `estado` | enum | `pendiente`,`en_curso`,`en_espera`,`hecho`,`no_aplica` (`DP.ESTADOS_TAREA`). `bloqueada` es calculado |
| `responsable` | string | nombre de persona |
| `fecha` | 'YYYY-MM-DD'\|'' | fecha **confirmada**; vacía ⇒ se muestra la sugerida |
| `hecho_el` | ISO\|'' | se setea al pasar a `hecho` (si estaba vacío); se borra al pasar a cualquier otro estado |
| `duracion` | int 0-120 | días hábiles; para sugerir usa `max(1,duracion)` |
| `entregable` | string ≤80 | |
| `nota` | string ≤300 | |
| `depende` | string[] opc. | ids de tareas del MISMO proyecto; al quitar una tarea se limpia de los `depende` de las demás (`tareaQuitar`) |
| `ref` | bool | "Pide REF": no se puede cerrar sin `p.ref_erp` (solo validado en UI) |
| `erp` | bool | marca "configuración en el ERP"; **se guarda pero ningún código lo usa** |

Distribución JSON (759 tareas): pendiente 644, hecho 59, en_curso 56; ninguna `en_espera`/`no_aplica`; `depende` en 0; `fecha` confirmada en 1 (PD-25); `nota` vacía en todas; responsable Felipe 404 / '' 355. Por proyecto: 53 con 1 hecha, 3 con 2, 9 con 0; 56 con exactamente 1 `en_curso`. Hechas: "Alta en el ERP como borrador" 56 (+3 otras). En curso: "Definición: modelo, medidas, telas y avíos" 50, "Definición: medidas estándar…" 4, otras 2.
Duraciones: 1:200, 2:319, 3:180, 4:1, 5:59. Etapas: muestra 189, industrializacion 184, definicion 131, lanzamiento 130, desarrollo 125. 23 nombres distintos (todos de plantillas).

### 1.5 Variante (`productos.variantes[]`)

```js
// nuevaVariante (puente)
{id:newVarId(), nombre, combinacion:{<slot>:<codigoOpcion>, libre?:texto}, origen:'equipo', estado:'propuesta',
 moldes:'no', tizada:'no', tizada_nombre:'', erp:'no', responsable:p.lider||'', fecha:'', nota:'', creado:T, pasos:tplPasos('variante',p.lider||'')}
// desde solicitud tipo 'variante' (xAprobar): origen:'solicitud', solicitud_id, estado:'en_desarrollo', combinacion:{libre: descripcion.slice(0,200)}, fecha: s.fecha_limite, nota: s.evaluacion
```
Enums (html L1530-1533):
- `estado` VESTADOS: `propuesta`,`en_desarrollo`,`muestra`,`lista`,`descartada` (JSON: lista 12, en_desarrollo 3).
- `moldes` VMOLDES: `no` (Sin molde), `generada` (Generada por el motor), `de_alta` (De alta en moldes) (JSON: de_alta 12, generada 3).
- `tizada` VTIZ: `sin_verificar`,`no`,`cargada` (JSON: sin_verificar 15).
- `erp` VERP: `sin_verificar`,`no` (No habilitada),`habilitada` (Habilitada para la venta) (JSON: sin_verificar 15).
- `combinacion`: mapa slot→código de `opciones` (JSON: `costadillo: COS-SIN|COS-FIN|COS-ANC`, `cuello: CUE-R|CUE-V`, `pretina: PRE-DOB|PRE-SEP`, `entrepierna: ENT-LIS`, `silueta: SIL-REG`, `abertura: ABE-SIN|ABE-DOL`, `bolsillo: BOL-COS`, `largo: LAR-COR`, `ruedo: RUE-RIB`, y **`Manga: corta|raglan`** — slot con mayúscula y valor que no es código).
- Las 15 variantes del JSON (semilla) NO tienen `pasos` ni `creado`.
- Regla automática al cambiar una tarea de variante (`setStep` rama `v`): si no queda ninguna pendiente y estado≠`lista` ⇒ `estado='lista'`; si estado era `propuesta` ⇒ `en_desarrollo`. Variantes `lista`/`descartada` no generan items de trabajo.
- Avisos (mod-catalogo `gaps`): `alta_sin_tiz` (moldes=de_alta && tizada≠cargada), `tiz_sin_erp` (tizada=cargada && erp≠habilitada && estado=lista), `erp_sin_tiz` (erp=habilitada && tizada≠cargada), `sin_verificar` (tizada o erp = sin_verificar).

### 1.6 `solicitudes` (pedido / entrada de la Bandeja)

Alta (`xCrearSolicitud`, puente; `quickAdd`, html L1848 — idénticos salvo `pedido_por`/`desarrollo`/`autor_equipo`):
```js
{codigo:nextCode(sols,'SOL-'), tipo, estado:'nueva', titulo, descripcion, corrige_id:'', familia:'', etiqueta:'', linea:'', cliente, cantidad:'', fecha_limite, links:'', imagenes:[],
 contacto:{nombre:quien, telefono:'', email:''}, pedido_por:quien, desarrollo:d.desarrollo||'producto', puntaje_solicitante:{}, puntaje:{estrategico:3,comercial:3,complejidad:3,recursos:3},
 requiere:[], opiniones:[], autor:me?.id||null, autor_equipo: rolDe(quien)!=='vendedor', pasos_previos:newPrevios(quien), bitacora:logEv([],'Cargó',`${TIPOS[tipo].l}: ${titulo}`), creado:T, actualizado:T}
```
| Campo | Tipo | Valores | JSON (35) |
|---|---|---|---|
| `codigo` | string | `SOL-NN` | SOL-01..37 |
| `tipo` | enum | `idea`,`solicitud`,`orden` (no se puede rechazar),`correccion`,`variante` (`TIPOS`); inválido ⇒ `solicitud` | idea 25, solicitud 9, correccion 1 |
| `estado` | enum | `nueva`,`en_evaluacion` (legado: al tocar un paso previo),`pospuesta`,`aprobada`,`rechazada` (`SESTADOS`) | aprobada 30, nueva 5 |
| `titulo` | string ≤120 | | |
| `descripcion` | string ≤3000 | | 17 vacías |
| `cliente`,`cantidad`(texto ≤40),`fecha_limite`,`links`(texto) | string | | todos vacíos |
| `familia`,`etiqueta`,`linea`,`ref_erp` | string | igual que productos | casi todo vacío (familia Gorros 1, linea sublimacion 1) |
| `desarrollo` | enum | ver productos | ausente (⇒ producto) |
| `pedido_por` | string | quién lo pidió | **ausente en los 35** (anterior a ese campo) → se usa `contacto.nombre` |
| `contacto` | `{nombre,telefono,email}` | | nombre: "Lista de WhatsApp (06/10)" 14, "Sugerencia de Claude" 8, "Felipe Lalinde" 6, "Felipe" 6, "Sergio" 1; telefono basura ("a"×5, "1"); email 1 |
| `puntaje` | 4 criterios 1-5 | default 3 | |
| `puntaje_solicitante` | `{estrategico?,comercial?}` | lo que puso quien cargó (legado) | 7 con valores |
| `requiere` | string[] | capacidades | 14 ids usados |
| `opiniones` | `[{autor,nombre?,area,postura,comentario,fecha}]` | legado: área `Desarrollo`/`Ventas`/`Producción`/`Dirección`/`Solicitante`; postura `favor`,`condiciones`,`contra` | todos [] |
| `pasos_previos` | 6 pasos fijos | ver abajo | 35×6 |
| `autor` | user id\|null | | `u_LesegtkaQTo9NGD6lNmyDQ` 13 |
| `autor_equipo` | bool | false si quien pidió es vendedor | true 35 |
| `imagenes` | `[{id,tipo,nombre?,url?}]` | | 1 imagen (sin el archivo) |
| `evaluacion` | string | nota interna de evaluación; pasa a `notas` del proyecto | 31 |
| `motivo` | string | obligatorio al posponer/rechazar (mod-bandeja) | ausente |
| `fecha_revision` | date | al posponer | 31 '' |
| `participantes` | string ≤200 | legado | 31 '' |
| `decidido` | ISO | fecha de la decisión | 30 |
| `producto_creado_id` | string | id del proyecto creado (o del producto al que se sumó la variante) | 30, todos existen |
| `corrige_id` | string | producto a corregir / al que se agrega variante | '' |
| `categoria` | string | solo semilla, no se usa | 22 |
| `bitacora`,`creado`,`actualizado` | | | acciones: Editó 69, Aprobó y planificó 30, Carga inicial 22, Creó la solicitud 7, Cargó 6 |

`pasos_previos` (`newPrevios`, html L1151) — orden fijo `PREVIOS`: `registro` (Registro), `aclaracion` (Aclaración con quien la cargó), `viabilidad` (Viabilidad técnica), `comercial` (Análisis comercial), `estimacion` (Estimación y puntaje), `decision` (Decisión en conjunto). El primero nace `hecho` con `responsable=quien`, `fecha=hoy`, `hecho_el=T`; el resto `pendiente`. Al aprobar, `decision` pasa a `hecho` con `fecha=hoy`. **Ningún `mod-*.js` lee ni edita `pasos_previos`** (grep = 0): se crean al cargar y al aprobar se marca `decision`, pero ninguna pantalla actual los muestra. En la versión anterior se aprobaba "con pendientes" (ver `evaluacion` = "Aprobada para empezar a trabajarla; queda por completar: Viabilidad técnica, …"). Candidato a no migrar o a dejar como checklist opcional.
Transiciones (Bandeja, mod-bandeja): aprobar → `aprobada` (+proyecto); posponer → `{estado:'pospuesta', motivo, fecha_revision, decidido}`; descartar → `{estado:'rechazada', motivo, fecha_revision:'', decidido}`; reabrir → `{estado:'nueva', fecha_revision:'', motivo:''}`. "Una `orden` no se puede rechazar" está en `TIPOS.orden.d` y en `decCheck` (html L1600, diálogo legado sin uso); **la Bandeja nueva (mod-bandeja L126) muestra "Descartar" también para órdenes** — la regla hoy no se aplica (solo suma +5 al recomendado).

### 1.7 `muestras`

```json
{"ordenes":[{"numero":"SUB-31561","nombre":"Fundas tension neostretch"}],"proyectos":["025gbx2bl9o4352zbp4z"],"proyecto_id":"025gbx2bl9o4352zbp4z",
 "estado":"enviada","tildes":["avisado"],"ronda":"","fecha_envio":"","comentario":"","fotos":[],"autor":null,"quien":"Felipe",
 "creado":"…","actualizado":"…","bitacora":[{"accion":"Registró la muestra (desde la planilla «Ordenes desarrollo producto»)","detalle":"#SUB-31561 Fundas tension neostretch",…}]}
```
- `ordenes[]`: órdenes de USER (`numero`, `nombre`). Formato número en JSON: `SUB-NNNNN` (11) y `DIR-NNNNN` (2) — prefijo = línea (Sublimación / Impresión Directa) **[inferido de los prefijos y de LINEAS]**. 1 orden por muestra en el JSON. Se muestra como `#SUB-31561 nombre` (`mTitulo`).
- `proyectos[]` (N:M) + `proyecto_id` (legado, el primero). Lectura: `mProys(m) = m.proyectos?.length ? m.proyectos : m.proyecto_id ? [m.proyecto_id] : []`. Todos existen (pd-08 tiene 3 muestras).
- `estado` ∈ `config/muestras.estados[].id` (JSON: enviada 7, cortada 6). `tildes` ⊂ `config/muestras.tildes[].id`.
- `fotos[]` `{id,tipo,nombre,url?}`.

### 1.8 `capacidades`

`{nombre, familia, ambito, lista, nota, actualizado}` — doc id = slug (`abertura_lateral`).
- `ambito`: `prenda` (40) | `plano` (13).
- `lista`: bool = "resuelta hoy por el sistema de moldes" (true 14, false 39). Toggle: `update({lista:!c.lista})`. Acción "resolver" (mod-catalogo): marca `lista=true` para cada capacidad que figure en `resuelve` de un proyecto no cancelado en etapa `publicado`.
- `familia`: 14 valores (Ruedos, largos y aberturas 10; Mangas y puños 8; Cierres 5; Confección plana 5; …).
- Usada por `productos.requiere`/`resuelve` y `solicitudes.requiere`. `missing(o) = o.requiere.filter(c => !caps[c]?.lista)` (html L1140); `capName(id) = caps[id]?.nombre || id.replace(/_/g,' ')`.

### 1.9 `opciones` (opciones de slot del sistema de moldes)

`{molde, molde_nombre, slot, slot_nombre, codigo, codigo_casa, nombre, estado, habilitada, por_defecto, productos[], nota, actualizado}`
- `molde` (6): camiseta_basica 30, camiseta_basquet 18, musculosa_entrenamiento 16, short_dolphin 16, short_basquet 12, short_basico 10.
- `slot` (14): cuello 31, costadillo 18, terminacion_manga 9, terminacion_cintura 6, abertura 6, pretina 6, silueta 6, Manga 4, entrepierna 4, cartera 3, largo 3, terminacion_bocapierna 2, bolsillo 2, ruedo 2.
- `codigo` (46 distintos, ej. `COS-ANC`, `CUE-R`, `TM-01`); `codigo_casa` = código del catálogo de la casa (`CT-01`, `CV-03`, `MG-01`…; '' en 61).
- `estado`: `receta` 101 | `molde` 1. `habilitada` bool (82 true). `por_defecto` bool (24 true).
- `productos[]`: ids de productos `ps-01, ps-02, ps-03, ps-04, ps-09, ps-10, ps-27` (todos existen).
- Editables campo a campo (mod-catalogo `update({[campo]:valor})`).

### 1.10 `config/*`

| Doc | Forma | JSON |
|---|---|---|
| `config/equipo` | `{miembros:[{nombre, lineas:[sublimacion\|directa\|ecouv], rol:'desarrollo'\|'vendedor'}], actualizado}` | Felipe (3 líneas), German (sin líneas); **sin `rol`** (⇒ desarrollo) |
| `config/listas` | `{familias:string[], etiquetas:string[], actualizado}` | 13 familias (= `DEF_LISTAS`), 3 etiquetas |
| `config/muestras` | `{estados:[{id,nombre,tono}], tildes:[{id,nombre}], actualizado}` | estados: enviada (Enviada a producción, azul), cortada (Cortada (en mis manos, sin coser), ambar), costura (En costura, azul), terminada (gris), aprobada (verde), con_cambios (Aprobada con cambios, ambar), rechazada (rojo). tildes: avisado, fotos ("Fotos sacadas"). `tono` ∈ azul/ambar/gris/verde/rojo |
| `config/plan` | `{horizonte:int días, tanda:int semanas, actualizado}` | horizonte 14, tanda 2 (default en página `{horizonte:28,tanda:2}`) |
| `config/orden` | `{ids:string[], quien, actualizado}` orden manual de la "lista de desarrollo" | 45 ids (de 62 activos), quien Felipe |
| `config/fuentes` | `{items:[{grupo,url,nombre,nota}], actualizado}` | 17 (Moldes 12, Mockups 4, Herramientas 1). Una nota contiene una cuenta de mail de acceso |
| `config/desarrollos` | `{tipos:[{id,nombre,producto?:true}], actualizado}` | ausente ⇒ `DP.TIPOS_DES` |

### 1.11 Colecciones ausentes del JSON (forma según código)

- **`tandas`**: `{nombre:'Tanda N', inicio:'YYYY-MM-DD', fin, objetivo:'', estado:'abierta'|'cerrada', productos:[pid], tareas:['p|pid|sid'], grupos:[{id:'g'+uid, nombre:'Grupo N', productos:[pid]}], creado, actualizado, bitacora, cerrada_el?, resumen? ('h de n tareas hechas'), pendientes?:[refs]}` (mod-planificacion L129-140). Estado visible (`tEstado`, html L2016 = mod-planificacion L71): `cerrada` si estado=cerrada; `proxima` si inicio>hoy; `vencida` si fin<hoy; si no `en_curso`. Tanda actual (`tActual`): primera abierta `en_curso`, si no la primera `vencida`, si no la primera abierta (ordenadas por `inicio`).
- **`plantillas`**: doc por id = `{nombre, para:'producto'|'correccion'|'variante', desarrollo?, descripcion, etapas?:[{id,label,c}], pasos:[{etapa,nombre,duracion,entregable,ref?,erp?}], actualizado}`. Si la colección está vacía se usan `DEF_PLANTILLAS` del código (§2.8); al guardar/borrar la primera vez se copian TODAS las default a la colección (puente `guardarPlantilla`/`borrarPlantilla`).
- **`comentarios`**: `{ref:'productos/<id>'|'solicitudes/<id>'|…, texto ≤2000, autor, quien, fecha}` (`DP.comentar`).
- **`pines`**: `{nombre, salt (8 chars base36), hash (16 hex), actualizado}` (§3.1).
- **`vistas`**: `{nombre ≤60, config:{tipo,pmodo,etapa,sprev,stipo,sestado,familia,etiqueta,resp,lider,linea,plantilla,ptipo,avance,cap,agrupar,orden,amb,showLista,taskGroup,vgap,pestado,tmodo,ptanda,sorden,tsort}, autor, creado}` (legado).
- **`feedback`**: `{texto ≤1500, vista:V.tipo, pid, quien, autor, fecha}`.

### 1.12 Personas que aparecen en los datos

`lider`: Felipe. `pasos[].responsable`: Felipe. `pasos_previos[].responsable`: German 27, Felipe 9, Claude 7, Felipe Lalinde 6, "Lista de WhatsApp" 2, Sergio 1. `bitacora.quien`: Felipe, Claude, ''. `muestras.quien`: Felipe. Equipo: Felipe, German. User id del host: `u_LesegtkaQTo9NGD6lNmyDQ` (Felipe). Las personas se referencian **por nombre (texto)**, no por id: renombrar a alguien en Equipo deja huérfanos sus `responsable`/`lider`.

---

## 2. BASE (`base.js`, objeto `window.DP`) + reglas calculadas

### 2.1 Utilidades
| Miembro | Qué hace |
|---|---|
| `esc(s)` | escapa `& < > " '` para HTML |
| `norm(s)` | minúsculas, sin tildes (NFD + quitar U+0300–U+036F), todo lo no `[a-z0-9]` → espacio, trim. **Se usa para búsquedas, comparar nombres de personas, ids de PIN y slugs de capacidad** |
| `ahora()` | `new Date().toISOString()` (UTC) |
| `hoy()` | 'YYYY-MM-DD' **local** del navegador |
| `fmtD(s)` | 'YYYY-MM-DD…' → 'dd/mm/yy' |
| `uid()` | `Date.now().toString(36)+rand(5)` |
| `opt(v,l,cur)` | `<option>` con selected |
| `diasHabiles(s,n)` | ver 2.7 |
| `diasCorridos(s,n)` | s + n días calendario ('YYYY-MM-DD', a las 12:00 local para evitar DST) |
| `gcal(titulo,ini,fin,det)` | link "crear evento" de Google Calendar, evento de día completo `dates=ini/(fin\|\|ini)+1` |
| `log(arr,accion,detalle)` | ver 2.6 |

### 2.2 Conexión con el host (todo lo que un módulo puede pedir)
`conectar(h)` guarda `host`. Funciones que delegan en `host` (con default si falta):
- `db` (getter) → `host.db()`; `sesion()` → `{nombre,id,puede,admin,rol}` (default `{nombre:'',id:null,puede:false,admin:false,rol:'desarrollo'}`). Desde el puente: `nombre = YO || me.name`, `id = me.id` (user id del host), `puede = canWrite && !!db`, `admin = isAdmin`, `rol = rolDe(YO)`.
- `proyectos()` → resumen `[{id,nombre,codigo,cancelado,etapa:<label>,listo:etapa==='publicado'}]` (calculado con `etapaActual` de la página).
- `equipo()` → `config/equipo.miembros`; `listas()` → `{familias,etiquetas}`; `plantillas()` → `[{id,nombre,para,desarrollo}]`; `plantillasCompletas()` → mapa id→plantilla (colección o `DEF_PLANTILLAS`).
- `abrirProyecto(id)` (→ `goProj`), `navegar(vista,params)` (→ `xNavegar`, ver 3.8), `toast(m)`, `assets()` (subida de archivos del host), `imgSrc(f)` (default `'/_blob/'+f.id`; si `f.url` es `data:` la usa), `sinPermiso(e)` (→ `markRO`: si `e.code==='invalid_argument'` muestra la barra "No tenés permiso para ese cambio…").
- `cruce(nombre,...args)` → `host.cruces[nombre](...args)` (Promise; rechaza con `Error('Cruce no disponible: x')`). Los errores de negocio se lanzan como `Error` con `aviso:true` (el mensaje se muestra tal cual al usuario; si no, "No se pudo guardar.").

### 2.3 Datos compartidos (suscripciones)
- `suscribir(col, fn)`: una sola suscripción `onSnapshot` por colección (`subs[col]`), reparte a todos los `fn`; cada doc llega como `{id, ...data}` (**`id`**; la página usa `_id`). Si ya hay datos, llama `fn` enseguida. No hay `unsubscribe`. Errores de `fn` se tragan (`catch(e){}`).
- `datos(col)` → última lista en caché (o `[]` si nadie se suscribió todavía).
- `config(nombre, defecto)` → valor cacheado de `config/<nombre>` o `defecto`; abre la suscripción la primera vez (perezoso). `alCambiarConfig(nombre,fn)`. `guardarConfig(nombre,valor)` → `db.doc('config/'+nombre).set(valor)` (reemplazo total).
- `listo()`: lo llama el puente cuando `db` existe (poll cada 200 ms); recién ahí abre las suscripciones pedidas antes.
- Colecciones que usan los módulos vía DP: productos, solicitudes, muestras, tandas, capacidades, opciones, comentarios, feedback; configs: muestras, plan, orden, desarrollos.

### 2.4 Módulos
- `registrar(nombre, mod)`; `cargar(nombre)` → inyecta `<script src="mod-<nombre>.js">` una sola vez (promesa cacheada; si falla se puede reintentar).
- `montar(nombre, el, params)`: si ya está montado en `el` con otra firma `JSON.stringify(params)` → `mod.params(params)`; si está cargando, acumula params; si no, pinta "Cargando…", carga y llama `mod.montar(raiz, params)`. Un solo módulo montado a la vez (`montado`).
- `avisar()` → `mod.refrescar()` del módulo visible (la página lo llama cuando cambian proyectos/sesión).
- Contrato: `{montar(raiz,params), params?(params), refrescar?()}`.

### 2.5 Constantes de dominio
- `ETAPAS` (default, 5): `definicion` "Definición" #5b7cff · `desarrollo` "Desarrollo técnico" #0a8fb8 · `muestra` "Muestra y aprobación" #3f9a2a · `industrializacion` "Industrialización" #d9822b · `lanzamiento` "Lanzamiento" #d1236b. Pseudo-etapas: `publicado` ("Publicado", #1f8a4c en el flujo) y `cancelado`.
- `ESTADOS_TAREA`: pendiente, en_curso (En curso), en_espera (En espera), hecho, no_aplica (No aplica).
- `LINEAS`: sublimacion (Sublimación), directa (Impresión Directa), ecouv (EcoUV).
- `COLORES` (paleta para etapas propias): #5b7cff #0a8fb8 #3f9a2a #d9822b #d1236b #7a6bd6 #8a94a6.
- `TIPOS_DES`: producto (`producto:true`), tecnologia, maquina, proceso, procedimiento, sistemas. `tiposDes()` = `config/desarrollos.tipos` si tiene items, si no `TIPOS_DES`. `tipoDes(o)` = `o.desarrollo || 'producto'`. `esProducto(o)` = `!!tipo.producto` (o `=== 'producto'` si el tipo no existe). Un desarrollo no-producto oculta REF ERP/familia/variantes/muestras y usa `proveedor`/`costo_estimado`/`resuelve`.
- `filtroDes(cur, attr)` → `<select>` "Desarrollo: Todos | tipos…".

### 2.6 Bitácora, historial, comentarios
- `DP.log(arr, accion, detalle)` = `logEv` de la página: `[...arr, {fecha:ahora(), autor:sesion.id||null, quien:sesion.nombre||'', accion, detalle:String(detalle).slice(0,300)}].slice(-200)`. Append-only en la UI, **pero se reescribe el array entero y se trunca a las últimas 200**.
- Acciones emitidas/observadas. Proyectos: `Planificado`, `Creó el proyecto`, `Editó`, `Completó`, `Alta en el ERP`, `Puntaje` ("Comercial: 2 → 3"), `Variantes`, `Variante <nombre>`, `Capacidades`, `Resuelve`, `Canceló`, `Reactivó`, `Reordenó las tareas`, `Quitó una tarea`, `Agregó una tarea`, `Confirmó las fechas sugeridas`, `Asignó pasos`; semilla: `Carga inicial`, `Reorganizado`, `Mockups`, `Moldes pagos`, `Creado`, `Movió de etapa`. Solicitudes: `Cargó`, `Creó la solicitud`, `Editó`, `Aprobó y creó el proyecto`, `Aprobó la variante`, `Aprobó y planificó` (legado), `Pospuso`, `Rechazó`, `Reabrió`. Tandas: `Creó la tanda`, `Sumó tareas`, `Sumó una tarea`, `Pasó tareas a X`, `Desvinculó X`, `Quitó X (borrado)`, `Cerró la tanda`, `Vinculó X`, `Creó un grupo`… Muestras: `Registró la muestra`, `Estado`, `Tildó`/`Destildó`, `Editó`.
- Texto de cambios de tareas (`diffPasos`, html L1157): `paso nuevo: L` · `L: Pendiente → Hecho` · `L: responsable X|(ninguno)` · `L: fecha dd/mm/yy|(sin fecha)` · `paso renombrado: N` · `L: depende de A, B|(nada)` · `paso quitado: N`; unidos con ` · `. `saveProj` agrega `k: v` para nombre, linea (label), lider, fecha_inicio, fecha_limite, ref_erp, estado_general, familia, etiqueta (clave con el primer `_` → espacio: `ref erp: PR-029`) y `detalle actualizado` si cambian las notas. Variantes (`diffVars`): `variante nueva: N`, `N: estado|moldes|TizadaPro|ERP <label>`, `N: responsable …`, `N: fecha …`, `variante quitada: N`.
- `historial` (proyecto): en `saveProj` y `setStep` (rama p), si `etapaActual(antes) !== etapaActual(después)` ⇒ push `{estado:e1, fecha:T}` y `slice(-80)`. **Cancelar/reactivar no escriben historial** (update directo); los 2 `cancelado` del JSON vienen de la versión anterior.
- Comentarios: `comentariosDe(ref)` (de `datos('comentarios')`, por fecha asc), `comentar(ref,texto)` → add `{ref, texto:trim().slice(0,2000), autor, quien, fecha}`, `comentariosHtml(ref, puede)` (lista + textarea + botón; el envío lo maneja un listener global de base.js). La página usa `ref = 'productos/<id>'` y `'solicitudes/<id>'` (`renderComs`); el formato que usan los módulos lo cubre el spec de mods **[inferido de html L2259]**.

### 2.7 Reglas calculadas (fórmulas exactas)

**Pendiente** — `DP.pendiente(t) = t.estado !== 'hecho' && t.estado !== 'no_aplica'`.

**Orden de tareas** — `DP.tareasDe(p)`: ordena `p.pasos` por índice de su etapa en `DP.etapasDe(p)` (`p.etapas` si existe y no vacío, si no `ETAPAS`; etapa desconocida = 9) y, a igual etapa, por posición en el array (estable). La página tiene su propio `ordenar(pasos)` que usa SIEMPRE las 5 etapas default (en proyectos con etapas propias todas quedan con índice 9 → orden del array). `saveProj` persiste `c.pasos = ordenar(c.pasos)`.

**Tarea actual** — `DP.tareaActual(p)` = `null` si cancelado; si no, la primera pendiente de `tareasDe(p)`.

**Etapa actual** — `DP.etapaDe(p)` = `'cancelado'` si `estado_general==='cancelado'`; si no `tareaActual(p)?.etapa || 'publicado'`. No se guarda (solo su rastro en `historial`). `etapaNombre(id,p)`: Publicado / Cancelado / label de la etapa propia o default / id.

**Terminado (= "publicado", pasa al Archivo)** — no cancelado y ninguna tarea pendiente (todas `hecho`/`no_aplica`). Un proyecto **sin tareas** es "publicado" de entrada. "Activo" para la página: `activo(p) = estado_general!=='cancelado' && etapaActual(p)!=='publicado'` (pausado cuenta como activo).

**Avance** — `DP.avance(p)`: `t` = tareas con estado ≠ `no_aplica`; `h` = tareas `hecho`; `pct = t ? round(h*100/t) : 0` (si todo es `no_aplica` da 0 % aunque esté publicado).

**Atrasadas** — `DP.atrasadas(p) = pasos.filter(s => s.fecha && s.fecha < hoy() && pendiente(s))`: solo cuenta la fecha confirmada; comparación de strings ISO.

**Bloqueada** — `DP.bloqueos(t, ts)` = las tareas de `t.depende` (buscadas en `ts`, mismo proyecto) que siguen pendientes. `DP.estadoVisible(t, ts) = pendiente(t) && bloqueos.length ? 'bloqueada' : (t.estado || 'pendiente')`. No se guarda. Ciclos: `DP.dependeDe(a,b,ts)` = a depende de b directa o transitivamente (DFS con `vistos`); en el editor, la casilla de una tarea X queda deshabilitada si X ya depende de la tarea editada. Cerrar una tarea con dependencias pendientes **no se bloquea**: la página solo avisa (`setStep` envuelto, html L1990: toast "Ojo: dependía de «…», que todavía no está hecho.").

**Puntaje** — `DP.puntaje(o)` (idéntico a `scoreOf` html L1142 y a `puntaje` de mod-bandeja):
```
E=+estrategico||3, C=+comercial||3, X=+complejidad||3, R=+recursos||3   (0/vacío ⇒ 3; no se acota a 1..5)
u = 0; si fecha_limite: d = (new Date(fecha_limite) - new Date()) / 86400000   // fraccional; 'YYYY-MM-DD' se parsea como 00:00 UTC
       u = d <= 7 ? 3 : d <= 30 ? 1.5 : 0                                        // vencida (d<0) también suma 3
puntaje = round( ((3E + 2C) / (X + R) + u) * 10 ) / 10
```
Rango sin urgencia: 0.5 (E=C=1, X=R=5) a 12.5 (E=C=5, X=R=1). Se muestra con coma decimal. Texto explicativo (`scoreTxt`): "beneficio {3E+2C} (estratégico E×3 + comercial C×2) ÷ recursos {X+R} (complejidad X + recursos R) [+ u por fecha límite]". Criterios (`CRIT`): estrategico "¿Abre un rubro, fideliza clientes clave, nos diferencia?" (nada→clave), comercial "Volumen y ventas esperadas: ¿se va a producir mucho?" (poco→mucho), complejidad "Moldería, confección, pasos nuevos." (simple→compleja), recursos "Horas del equipo, muestras, insumos e inversión." (pocos→muchos). Escala 1 a 5.

**Recomendado** (no está en base.js; vive en cada módulo). Con `dias(a,b)=round((b@12:00 − a@12:00)/día)`, `h=hoy`:
- Bandeja (`mod-bandeja.js:rec`): `rec = puntaje(s) + (tipo==='orden' ? 5 : 0) + (fecha_limite ? (dias(h,lim) < 0 ? 4 : dias(h,lim) <= 7 ? 2 : 0) : 0) + (estado==='pospuesta' && fecha_revision && fecha_revision <= h ? 3 : 0) + (creado ? min(3, dias(creado,h)/14) : 0)`.
- Proyectos y Planificación (`mod-proyectos.js:rec` = `mod-planificacion.js:rec`): `rec = puntaje(p) + min(4, 2·atrasadas(p).length) + (fecha_limite ? (d<0 ? 4 : d<=14 ? 2 : 0) : 0) + (en alguna tanda abierta ? 2 : 0) + (tareaActual sin responsable ? 1 : 0) − (estado_general==='pausado' ? 3 : 0) + (creado ? min(2, dias(creado,h)/30) : 0)`.
- Lista de desarrollo (Planificación), modo `manual`: primero los ids de `config/orden.ids` en ese orden; el resto detrás por **puntaje** desc. Modo por defecto: `manual` si hay orden guardado, si no `rec`.
- Legado (`ranked`, html L1149, usado por el Cronograma): primero `prioridad_fija>0` ascendente, después puntaje desc.
- Tareas (mod-tareas) NO tiene recomendado: ordena por fecha (confirmada o sugerida) asc, `'9999'` si no hay; al agrupar, la tarea "actual" va primero.

**Fechas sugeridas** — `DP.fechasSugeridas(p)` → `{idTarea: 'YYYY-MM-DD'}` solo para tareas pendientes (gemela en la página: `plan(pasos,inicio)`, que además devuelve `{ini,fin,sug,sugerida}` para el Cronograma):
```
hoy = hoy(); cur = (p.fecha_inicio || p.creado || hoy).slice(0,10); fin = {}
para t en tareasDe(p):                         // orden de etapa y posición
  si t.estado==='no_aplica': saltar
  si t.estado==='hecho': f=(t.hecho_el||t.fecha||cur).slice(0,10); fin[t.id]=f; cur=f; seguir   // el cursor puede RETROCEDER
  base = cur
  si t.depende no vacío: base = max(fin[d] de las deps ya recorridas) || cur   // deps posteriores en el orden se ignoran
  inicio = base < hoy ? hoy : base
  sug = diasHabiles(inicio, max(1, +t.duracion || 1))
  f = t.fecha || sug                           // la fecha confirmada manda para encadenar
  out[t.id] = sug; fin[t.id] = f; si !(f < cur): cur = f
```
`diasHabiles(s,n)`: parte de `s` a las 12:00 local, `k=max(0,round(n))`; mientras k>0 suma 1 día y, si no es sábado ni domingo, k--. **Sin feriados.** n=0 devuelve `s` aunque caiga en fin de semana. Consecuencia: las sugeridas de lo no empezado se corren con `hoy` cada día. Solo se guarda una fecha cuando alguien la confirma ("Usar la fecha sugerida ≈ dd/mm/yy" → `cruce('tarea',…,{fecha})`; "Confirmar las fechas sugeridas" → todas las pendientes sin fecha, bitácora `Confirmó las fechas sugeridas`).

**Dormidas** (regla de módulos: mod-inicio, mod-tareas, mod-reportes): una tarea está "planificada" si su ref `'p|<pid>|<sid>'` figura en `tareas[]` de alguna tanda con `estado !== 'cerrada'`. "Lo mío" (Inicio) = tareas pendientes con `responsable === yo` y (planificada **o** con `fecha`), orden: atrasadas, luego planificadas, luego fecha asc. Tareas, por defecto (`alcance:'tandas'`), muestra solo planificadas; `actuales` = la actual de cada proyecto (o `en_curso`); `todas`. Reportes, "Próxima semana", excluye lo no planificado. Las hechas se ven 14 días (`(hecho_el||fecha) >= hoy−14`).

**Una tarea, una tanda** (`sumarTareas`, html L2026): al sumar refs a la tanda `sel`, se quitan de cualquier otra tanda abierta; `sel.productos ∪= {pid} ∪ refs.map(refPid)`. Un proyecto puede estar en varias tandas con tareas distintas.

**Alta en el ERP** — una tarea con `ref:true` no se marca hecha si `!p.ref_erp`: la UI pide la REF y llama `cruce('altaErp', pid, sid, ref)` ⇒ `ref_erp=ref`, tarea `hecho` (`hecho_el=now`), y la primera pendiente del proyecto pasa a `en_curso` si estaba `pendiente`; bitácora `Alta en el ERP`. **Solo se valida en la UI** (`cruce('tarea',…,{estado:'hecho'})` no lo verifica).

**Auto-avance al completar** (`setStep`, html L1175): al marcar `hecho`, `hecho_el = hecho_el || T`; la primera pendiente (≠ esta) en orden, si está `pendiente` y va DESPUÉS de la completada, pasa a `en_curso`. Cualquier otro estado ⇒ `hecho_el=''`. En solicitudes, tocar un paso previo pasa `estado` de `nueva` a `en_evaluacion`.

### 2.8 Plantillas por defecto (`DEF_PLANTILLAS`, html L1024-1076)
Formato: etapa: tarea (días) → entregable. `[ref]` = pide REF; `[erp]` = flag erp.
- **prenda** "Prenda con molde" (para producto). definicion: Alta en el ERP como borrador (1) → REF del ERP [ref]; Definición: modelo, medidas, telas y avíos (3) → Brief del producto. desarrollo: Molde en el sistema de moldes (5) → Molde de alta; Molde y modelos en TizadaPro (2) → Modelos cargados. muestra: Corte y confección de la muestra (3) → Muestra física; Revisión y ajustes (2) → Lista de cambios; Aprobación de la muestra (1) → Muestra aprobada. industrializacion: Ficha de diseño (dibujo, avíos, costura paso a paso) (3) → Ficha completa; Tiempos de costura y costeo (2) → Costo unitario; Precio (1) → Precio de lista. lanzamiento: Configuración completa en el ERP (2) → Producto configurado [erp]; Fotos y publicación en canales (2) → Publicado. (12 tareas, 27 días hábiles)
- **plano** "Producto plano (lámina, sin molde)": Alta en el ERP como borrador (1) [ref]; Definición: medidas estándar, material y terminación (2) → Tabla de medidas; Lámina o archivo a medida (2) → Archivo listo; Muestra impresa y terminada (2) → Muestra física; Aprobación (1) → Muestra aprobada; Costeo y precio (2) → Precio de lista; Configuración completa en el ERP (1) [erp]; Fotos y publicación en canales (1). (8)
- **estructura** "Estructura o exhibición": Alta ERP (1) [ref]; Definición: formas, tamaños y componentes (3); Proveedores de la estructura (3) → Proveedor elegido; Forma o archivo por tamaño (4); Funda y refuerzos (2); Muestra armada (3); Aprobación (1); Accesorios de stock en el WMS (1) → Accesorios vinculados; Costeo y precio (2); Configuración completa en el ERP (2) [erp]; Fotos y publicación (2). (11)
- **stock** "Producto de stock o de terceros": Alta ERP (1) [ref]; Definición: proveedor, talles, colores y personalización (2); Zonas y archivos de personalización (2); Muestra personalizada (2); Aprobación (1); Costeo y precio (1); Configuración en el ERP (origen «Producto del local») (1) [erp]; Fotos y publicación (1). (8)
- **correccion** "Corrección" (para correccion): Diagnóstico: qué falla y qué se cambia (2); Corrección del molde o archivo (3); Muestra de control (2); Aprobación (1); Actualizar la ficha (1); Actualizar el producto en el ERP (1) [erp]. (6, sin `ref`)
- **maquina** "Máquina o tecnología nueva" (desarrollo maquina), etapas propias Evaluación / Compra / Instalación / Pruebas / Puesta en marcha (ids = el texto; colores #5b7cff #0a8fb8 #d9822b #3f9a2a #d1236b): Necesidad y qué se espera lograr (2); Opciones y proveedores (5); Costo y decisión (2); Pedido y pago (3); Seguimiento de la entrega (10); Lugar, energía y conexiones (3); Instalación y configuración (3); Pruebas con trabajos reales (5); Ajustes (3); Capacitación del equipo (2); Procedimiento de uso y mantenimiento (2); En producción (1). (12)
- **procedimiento** "Proceso o procedimiento" (desarrollo procedimiento), etapas Relevamiento / Borrador / Prueba / Capacitación / Vigente: Cómo se hace hoy y qué falla (3); Qué se quiere lograr (1); Escribir el paso a paso (3); Revisión con quienes lo hacen (2); Probarlo en trabajos reales (5); Ajustes (2); Capacitar a quienes lo usan (2); Publicarlo donde se consulta (1); Revisión al mes (1). (9)
- **sistemas** "Desarrollo de sistemas" (desarrollo sistemas), etapas Definición / Desarrollo / Pruebas / Puesta en producción: Qué se necesita y para quién (2); Alcance y prioridad con sistemas (2); Desarrollo (10); Pruebas con datos reales (3); Correcciones (3); Puesta en producción (1); Capacitación y aviso al equipo (1). (7)
- **variante** "Variante" (para variante, interna): Definición de la combinación (1); Receta o molde en el sistema de moldes (3) → Variante de alta; Cargar el modelo en TizadaPro (1) → Modelo cargado; Muestra (2); Aprobación (1); Habilitar en el ERP («Modelos que se venden») (1) → Habilitada para la venta. (6)
Plantilla al aprobar: la elegida (`o.plantilla`), o `correccion` si es corrección, o `prenda` (la Bandeja propone la del mismo `desarrollo`: `plantillaPara`). `tplPasos` con un id inexistente cae en `prenda`. Cambiar una plantilla no toca proyectos existentes (se copian los pasos al crear).

### 2.9 Cruces (escrituras compartidas; implementadas en el puente)
Todos operan sobre la copia en memoria (`prods`/`sols`) y reescriben el doc. "admin" = `isAdmin` (Editor del artifact).

| Cruce | Firma | Efecto exacto | Permiso |
|---|---|---|---|
| `crearSolicitud` | `(d:{titulo,descripcion?,cliente?,fecha_limite?,imagenes?,tipo?,desarrollo?,pedido_por?}) → id` | alta de 1.6 | DB (colaborador) |
| `aprobar` | `(solId, {plantilla?, corrige_id?}) → idProyecto` | tipo `variante`: agrega variante al producto `corrige_id` (aviso si no existe) y marca la solicitud aprobada con `producto_creado_id` = ese producto. Otro tipo: crea el proyecto (1.3) y actualiza la solicitud `{estado:'aprobada', producto_creado_id, decidido, corrige_id, pasos_previos (decision hecho)}` + bitácora `Aprobó y creó el proyecto` (detalle = evaluacion). **Dos escrituras sin transacción** | el cruce no chequea; la Bandeja solo muestra "Aprobar" a admin ("Aprobar lo hace quien administra la herramienta.") |
| `guardarProyecto` | `(id, cambios)` | `codigo`, `archivos`, `desarrollo`, `proveedor`, `costo_estimado` → update directo con bitácora `Editó` (requiere admin si algo cambió; aviso si el código está duplicado, pero guarda). El resto → `saveProj(Object.assign)`, que **solo persiste** `pasos, nombre, linea, lider, fecha_inicio, fecha_limite, ref_erp, estado_general, familia, etiqueta, notas` (cualquier otro campo se descarta en silencio) | admin |
| `tarea` | `(pid, sid, patch)` | si `patch.estado==='hecho'` → `setStep` (auto-avance, `hecho_el`; ignora el resto del patch). Si no → `saveProj`: `Object.assign(tarea,patch)`; estado≠hecho ⇒ `hecho_el=''`; si cambia `etapa`, la saca y la reinserta al final de su etapa (`xInsertar`) | admin (saveProj sale en silencio si no) |
| `tareaMover` | `(pid,sid,±1)` | intercambia con la vecina de la MISMA etapa (orden del array) | admin |
| `tareaQuitar` | `(pid,sid)` | borra la tarea y la saca de todos los `depende` | admin |
| `tareaNueva` | `(pid, etapa, nombre)` | inserta al final de la etapa, responsable = líder | admin |
| `tareaATanda` | `(ref)` | suma la tarea a la tanda actual (`tActual`), sacándola de otras abiertas; aviso si no hay tanda abierta | admin (tUpd silencioso) |
| `altaErp` | `(pid, sid, ref)` | ver 2.7 | admin |
| `cancelarProyecto` | `(pid)` | desvincula de cada tanda **abierta** (productos, tareas, grupos) y pone `estado_general='cancelado'` + bitácora `Canceló` | DB |
| `reactivarProyecto` | `(pid)` | `estado_general='activo'` + `Reactivó` | DB |
| `borrarProyecto` | `(pid)` | lo saca de TODAS las tandas (también cerradas) y de `config/orden`, y **borra el doc** (no limpia muestras, comentarios ni `solicitudes.producto_creado_id`) | DB |
| `guardarPuntaje` | `(pid, criterio, n)` | `puntaje[k]=n`, bitácora `Puntaje` "Comercial: 2 → 3" | admin (throw) |
| `guardarVariantes` | `(pid, vars[])` | reemplaza el array + bitácora `Variantes` (diffVars) | admin (throw) |
| `nuevaVariante` | `(pid, {nombre, combinacion})` | ver 1.5 | admin (throw) |
| `tareaVariante` | `(pid, vid, sid, patch)` | `setStep('v\|…')` + reglas de estado de la variante | DB |
| `guardarRequiere` / `guardarResuelve` | `(pid, ids[])` | reemplaza `requiere` / `resuelve` + bitácora `Capacidades` / `Resuelve` | admin (throw) |
| `guardarPlantilla` | `(id\|null, doc) → id` | id nuevo `'t'+base36(now)`; si la colección está vacía, primero copia todas las DEF_PLANTILLAS | admin (throw) |
| `borrarPlantilla` | `(id)` | borra (o, si la colección está vacía, copia todas las default menos esa) | admin (throw) |
| `nuevoProyecto` / `abrirSolicitud(id)` / `verMuestras(pid)` | — | navegación/diálogo | — |
| `abrirAnterior`, `versionAnterior` | — | **solo en el archivo puente suelto**, no en la copia dentro del HTML (pantallas retiradas) | — |

### 2.10 Piezas de UI comunes en base.js (vale replicarlas)
- **Detalle de tarea** `tareaDetalleHtml(p,t,ro)`: `<details>` "⋯ más" con Nombre (≤120), Etapa (select de las etapas del proyecto), Duración (0-120 días hábiles), Entregable (≤80), Nota (≤300), "Depende de" (checkbox por cada otra tarea con su etapa; deshabilita las que harían ciclo), botón "Usar la fecha sugerida ≈ dd/mm/yy" (si está pendiente y sin fecha), link "+ Google Calendar" (si tiene fecha efectiva y está pendiente), ↑ Subir / ↓ Bajar / Quitar tarea (doble toque: "¿Quitar esta tarea? Tocá de nuevo"). Guarda en cada `change` (autosave) por los cruces `tarea` / `tareaMover` / `tareaQuitar`. Recuerda cuál está abierta (`DP.tareaAbierta = 'pid|sid'`). `DP.editando(raiz)` evita redibujar mientras alguien escribe.
- **Comentarios** (`comentariosHtml`) y **fotos/archivos** (`fotosHtml(fotos, editable)`: miniaturas 60×60 con zoom a pantalla completa; lo que no es imagen sale como chip "PDF"/extensión; ✕ con `data-dp-fdel` que maneja cada módulo). `subir(files, alAvisar)` → `[{id, tipo:contentType, nombre, url? (solo si es data:)}]`; corta en el primer error ("Ese tipo de archivo no se puede subir: usá JPG, PNG o PDF." si `unsupported_type`). En modo local: imágenes reescaladas a 1200 px máx., JPEG 0.82 en dataURL, límite 8 MB.

---

## 3. PÁGINA PRINCIPAL (`pagina-principal.html`) y PUENTE

### 3.0 Arranque y estado global (html L2247-2270, L1109-1123)
1. `render()` inmediato (pinta "Cargando…" hasta `loaded.p && loaded.s`).
2. `db = await claude.use('db')`; si no hay: mensaje "La base no está disponible…", oculta `+ Nueva solicitud`, `Más`, `Guardar vista`, y termina.
3. `user = claude.use('user')` → `me = user.me()` (`{id,name,avatarUrl,…}`), `isAdmin = canEdit()||isOwner()`, `canWrite = can('data.write') !== false`. `assets = claude.use('assets')`.
4. `!isAdmin` ⇒ oculta "+ Nuevo proyecto" e "Importar listado del ERP" y muestra la barra: "Podés cargar solicitudes, comentar y guardar vistas. Los productos los edita el equipo de desarrollo." (o "Estás en modo lectura."). `!canWrite` ⇒ oculta "+ Nueva solicitud".
5. Suscripciones propias (`onSnapshot`): productos (`prods`, `loaded.p`), solicitudes (`sols`, `loaded.s`), comentarios, plantillas, `config/equipo` (`loaded.eq` → `maybeLogin`), pines (`loaded.pin` → `maybeLogin`), feedback, `config/fuentes`, opciones, capacidades (`caps` mapa id→doc), vistas, `config/listas`; y en `tandasInit`: tandas (orden por `inicio`), `config/orden`, `config/plan` (`PLANCFG` default `{horizonte:28,tanda:2}`). Los módulos se suscriben otra vez por DP (doble lectura de las mismas colecciones).
6. El puente hace `DP.conectar(...)`, espera `db` (poll 200 ms) → `DP.listo()`, se suscribe a `muestras` (`envios`) y a `config/muestras`.

Navegación: **sin URL/rutas**. Estado de vista `V` (objeto) persistido en `localStorage['dp3-view']`; `render()` despacha por `V.tipo` (html L1263): `inicio`→mod inicio, `bandeja`→mod bandeja, `proys`→mod proyectos {modo:'lista'}, `proyecto`→mod proyectos {modo:'ficha', id:V.pid}, `tandas`→mod planificacion, `tareas`→mod tareas, `envios`→mod muestras, `pedidos`→mod pedidos, `catalogo`/`variantes`/`capacidades`→mod catalogo (sec), `archivo`→mod archivo, `plantillas`→mod plantillas, `reporte`→mod reportes, `plan`→plan funcional embebido, `proyectos`→**Cronograma** (legado, `vCrono`). Parámetros transitorios en `V` que se consumen y se borran al montar: `bsol`, `bnueva`, `mq`, `mproj`, `mnueva`, `ptanda`, `tproy`, `csec`, `cproy`, `tandaSel`.

### 3.1 Ingreso: elegir nombre + PIN (html L1871-1933)
- Se pide cuando `!YO && !MIRAR && loaded.eq && loaded.pin` (`maybeLogin`). El diálogo no se puede cerrar con Esc. `YO` vive en `sessionStorage['dp-sesion']` (**por pestaña**: cada pestaña nueva vuelve a pedir PIN) y el último nombre en `localStorage['dp-yo']` (para sugerirlo).
- Paso `quien`: botones con `loginNombres()` = nombres de `config/equipo` ∪ nombres que tienen doc en `pines`, orden `localeCompare('es')`; cada uno dice "con PIN" / "todavía sin PIN". Sugerido: `dp-yo` si está en la lista, si no el que coincide con `me.name` (`norm` igual o `me.name` empieza con `nombre+' '`). "No estoy en la lista" → input nombre (≤40, espacios colapsados); si ya existe (por `norm`) usa ese; si es nuevo y `isAdmin` lo agrega a `config/equipo.miembros` como `{nombre, lineas:[]}` (sin rol). "Solo mirar, sin usuario" → `MIRAR=true` (botón de usuario muestra "Solo mirando · entrar").
- Paso `pin` (si la persona tiene PIN): input password numérico ≤6. `checkPin` = `pinHash(pin, salt) === hash`. 5 errores ⇒ bloqueo 30 s (solo en memoria del diálogo). "No soy yo" vuelve.
- Paso `crear` (sin PIN): PIN nuevo + repetir, `/^\d{4,6}$/`, iguales; requiere `canWrite` ("Con permiso de solo lectura no se puede crear un PIN. Entrá con «Solo mirar»."). `savePin` → `pines/<pinId>.set({nombre, salt, hash, actualizado})`.
- `pinId(n) = 'u-' + (norm(n).replace(/ /g,'-') || 'x')` (ej. "Felipe Lalinde" → `u-felipe-lalinde`).
- `pinHash(pin,salt)` (html L1878): `t = salt+':'+pin; h1=0xdeadbeef; h2=0x41c6ce57; for k in 0..3999: for cada char: c=charCode+k; h1=imul(h1^c,2654435761); h2=imul(h2^c,1597334677)`; mezcla final estilo cyrb53; devuelve `hex8(h2)+hex8(h1)`. `salt = Math.random().toString(36).slice(2,10)`. La colección `pines` es legible por todo el equipo ⇒ fuerza bruta trivial (10⁴–10⁶ combinaciones). El propio código y la Guía lo dicen: identifica, no protege.
- `entrar(n)`: `setYo(n)`, lee `LASTSEEN = localStorage['dp-lastseen-'+norm(n)]` y a los 8 s guarda ahí la hora actual (marca de "última visita"); toast "Hola, n.".
- Menú de usuario (`#yoMenu`): "Cambiar mi PIN" (pide el actual si tiene; nuevo 4-6 dígitos ×2) y "Cambiar de usuario" (borra `dp-sesion`, vuelve a pedir).
- Olvido: un admin toca "borrar PIN" en Más › Equipo (doble toque) → `pines/<id>.delete()`; al volver a entrar crea uno nuevo.

### 3.2 Roles y qué ve cada uno
- Rol (UI): `ROLES = [['desarrollo','Equipo de desarrollo'],['vendedor','Vendedor']]`; `rolDe(n) = equipo.find(m => norm(m.nombre)===norm(n))?.rol || 'desarrollo'` (puente). Sin rol cargado ⇒ desarrollo.
- **Vendedor** (`esVend()`): `render` reemplazado (puente) → `body.modo-vend` oculta pestañas, buscador, flujo, vistas guardadas, filtros, menú Más, Guías, "+ Nueva solicitud", barra de permisos y subtítulo; monta **solo** el módulo `pedidos`. Quedan visibles el menú de usuario y el botón flotante "Esto me trabó". En Bandeja/Pedidos los módulos usan `puede = sesion.puede && rol !== 'vendedor'` y `autor_equipo = rolDe(quien) !== 'vendedor'` al crear.
- **Permiso real** (al compartir el artifact): Lectura = ver; Colaborador (`canWrite`) = cargar pedidos, muestras, comentarios, vistas, PIN propio; Editor/dueño (`isAdmin`) = todo (proyectos, tareas, tandas, plantillas, configuración, equipo, listas, fuentes, importar, borrar PIN). El back de Claude rechaza con `code:'invalid_argument'` → `markRO` muestra "No tenés permiso para ese cambio…". Muchas funciones también se cortan en el cliente (`if(!isAdmin) return` o `throw aviso`).

### 3.3 Menú y estructura de pantalla (estado final tras el bloque "pantalla limpia", html L2232-2240)
- Encabezado: logo + "Desarrollos" + subtítulo; botones **Más** (desplegable), **Guías**, **+ Nueva solicitud** (→ Bandeja con formulario nuevo).
- Pestañas (orden): **Inicio · Bandeja (badge = solicitudes `nueva`+`en_evaluacion`) · Proyectos · Planificación · Tareas · Muestras · Pedidos · Catálogo técnico · Archivo · Reportes**. Select "Más pantallas…": **Cronograma** (único). Ocultas pero navegables: ficha de proyecto, Plantillas (desde Más), Plan funcional (desde Guías).
- A la derecha: buscador global (`/` o Ctrl/Cmd+K) y menú de usuario.
- Menú **Más**: + Nuevo proyecto · Equipo · Plantillas de proyecto · Familias y etiquetas del ERP · Fuentes de moldes · Importar listado del ERP · (solo modo local: Descargar copia de seguridad · Restaurar una copia de seguridad · Volver a los datos iniciales; "Mi nombre en esta computadora" tiene handler pero nunca se des-oculta).
- Botón flotante "Esto me trabó" (`feedback`, §3.11).
- Barra de flujo, vistas guardadas y filtros legados: solo visibles en el Cronograma (todas las demás vistas están en `SIN_FILTROS`).

### 3.4 Buscador global (html L1789-1855)
- Tokeniza `norm(q).split(' ')`. Puntaje por resultado `hit(main, extra, needMain)`: por cada palabra, +3 si aparece al inicio de una palabra de `main`, +2 si aparece dentro de `main`, +1 si aparece en `extra`; si alguna palabra no aparece en ningún lado ⇒ 0 (descartado). `needMain` exige al menos una en `main`.
- Grupos en orden, máximo 5 por grupo (3 en Pasos pendientes), por puntaje desc:
  1. **Ir a o hacer**: acciones (título / palabras clave): + Nueva solicitud (canWrite), + Nuevo proyecto (admin), Inicio, Bandeja, Proyectos, Planificación, Archivo, Cronograma, Reporte semanal, Todas las tareas, Mis tareas (si YO), Muestras, + Nueva muestra (canWrite), Catálogo técnico, Variantes, Qué destraba más, Guías, Plan del módulo, Equipo (admin), Plantillas de proyecto (admin), Cambiar mi PIN, Cambiar de usuario, Esto me trabó; + los 14 atajos `PRESETS` y las vistas guardadas del equipo.
  2. **Proyectos**: main `nombre`; extra `codigo, ref_erp, lider, familia, etiqueta, línea, nombre de plantilla, notas` → abre la ficha. Subtítulo "código · etapa · líder".
  3. **Muestras**: main = "numero nombre" de cada orden; extra nombres de proyectos, comentario, estado → Muestras filtradas por el primer número de orden.
  4. **Solicitudes**: main `titulo`; extra `codigo, cliente, descripcion, tipo, contacto.nombre` → Bandeja con esa solicitud abierta.
  5. **Personas**: equipo ∪ líderes/responsables (needMain) → Tareas filtradas por esa persona.
  6. **Pasos pendientes** (de proyectos no cancelados): main nombre de la tarea; extra proyecto + responsable (needMain) → ficha.
  7. **Variantes**: main nombre; extra producto (needMain) → Catálogo › Variantes de ese producto.
  8. **Capacidades**: main nombre; extra familia (needMain) → Cronograma filtrado por esa capacidad (vista legada).
- Grupo extra **Cargar**: si `q.length ≥ 3 && canWrite`: "Cargar «q» como idea" (`quickAdd(q,'idea')` → solicitud nueva tipo idea, toast "Cargada en la Bandeja: «q».") y "Cargar «q» con el formulario completo"; siempre "Buscar «q» en la lista de proyectos" (Cronograma con `V.q`). Teclado: ↑/↓, Enter, Esc.

### 3.5 Pantallas de "Más"
- **Equipo** (`eqDlg`): una fila por persona: Nombre, casillas Sublimación / Impresión Directa / EcoUV, select Rol, "borrar PIN" (si tiene) y "quitar"; "+ Agregar persona". Guardar → `config/equipo.set({miembros:[{nombre:trim, lineas, rol||'desarrollo'}] (sin vacíos), actualizado})`. Inputs deshabilitados si no es admin (el select de rol no se deshabilita, pero la escritura fallaría). Quitar a alguien **no borra su PIN** y su nombre sigue en la lista de ingreso (`loginNombres` incluye los `pines`).
- **Plantillas de proyecto** → navega a la vista `plantillas` (mod-plantillas). El diálogo `tpDlg` del HTML quedó sin uso.
- **Familias y etiquetas del ERP** (`listDlg`): dos textareas, un valor por línea; guarda `config/listas.set({familias, etiquetas, actualizado})` con trim, sin vacíos, sin duplicados. Texto: "Las mismas listas que usa el configurador de productos del ERP… Cuando el módulo esté dentro del ERP, se leen de ahí." Default sin doc: `DEF_LISTAS`.
- **Fuentes de moldes** (`fuDlg`): lista agrupada por `grupo` ("Otras" si vacío) con link (solo si empieza con http/https; texto = nombre o host), host y nota. Edición (solo admin) en un textarea: una fuente por línea `link | nombre | nota`; una línea que empieza con `#` abre grupo (`# Mockups`). Guarda `config/fuentes.set({items:[{grupo,url,nombre,nota}], actualizado})` (los `|` extra quedan dentro de la nota).
- **Importar listado del ERP**: §3.6. **+ Nuevo proyecto**: §3.7.
- **Modo local**: "Descargar copia de seguridad" → archivo `desarrollo-productos-copia-YYYY-MM-DD.json` con TODO el store (formato del JSON del paquete; en modo local incluye `pines`); "Restaurar" (valida que tenga `productos` o `solicitudes`, reemplaza todo); "Volver a los datos iniciales" (semilla embebida).

### 3.6 Importar listado del ERP (html L1625-1646) — formato exacto
- Entrada: texto pegado desde una planilla, **con fila de títulos**. Separador: TAB si la primera línea tiene TAB; si no `;` si hay más `;` que `,`; si no `,`. Comillas `"` alternan modo citado (no maneja `""` escapado). Líneas vacías se ignoran; mínimo 2 líneas.
- Columnas reconocidas (títulos pasados por `norm`): `ref` = `/^(ref|referencia|codigo|cod|id)$/`; `nombre` = `/^(nombre|producto|articulo)/` (**obligatoria**: si falta, error "No encontré una columna «Nombre» o «Producto» en la primera fila."); `familia` = `/^familia/`; `etiqueta` = `/^etiqueta/`. **"Estado" se menciona en la ayuda pero no se lee.** Filas sin nombre se descartan.
- "Revisar": cuenta coincidencias. Coincide si `r.ref && p.ref_erp === r.ref` (texto exacto), o si no, `norm(p.nombre) === norm(r.nombre)` (contra TODOS los proyectos, incluso cancelados).
- "Importar" (admin): por fila, sin transacción, contando ok/errores:
  - Coincide ⇒ `update({ref_erp: r.ref || p.ref_erp || '', actualizado})` (solo la REF; no toca familia/etiqueta).
  - Nueva ⇒ add `{nombre, codigo: r.ref ? 'ERP-'+r.ref : nextCode(prods,'ERP-'), tipo:'nuevo', ref_erp:r.ref, estado_general:'activo', familia:clean(r.familia), etiqueta:clean(r.etiqueta), pasos: tplPasos('prenda','') todas con estado 'hecho' y hecho_el=T, plantilla:'prenda', puntaje:{}, prioridad_fija:0, muestras:[], requiere:[], origen:'erp', creado, actualizado, historial:[{estado:'publicado', fecha:T}]}` ⇒ entra directo al Archivo como **publicado**. `clean(v)` vacía valores que empiezan con "sin " (ej. "Sin familia"). No se escribe bitácora ni `lider`/`linea`/`notas`.
  - Ojo: `prods` no se refresca dentro del bucle ⇒ dos filas con la misma REF/nombre nuevo crean dos proyectos, y `nextCode('ERP-')` devuelve el mismo código para todas las filas sin REF.

### 3.7 Crear proyecto directo (Más › + Nuevo proyecto, html L1485-1496)
Solo admin. Campos: Nombre (requerido, ≤120), Plantilla (todas menos `para:'variante'`; default `prenda`; muestra descripción, "N pasos en M etapas, unos D días hábiles en total"), Línea (o "Sin línea"), Responsable (equipo; default YO), Inicio (default hoy). Crea el doc de 1.3 (camino `manual`) y abre la ficha. Nota en pantalla: "Se crean los pasos de la plantilla, asignados al responsable, con fechas sugeridas desde el inicio."

### 3.8 El puente (`puente (incluido en la pagina principal).js` = html L2095-2215)
Es el único lugar donde la página y la base se conocen.
- Ajusta menús: reemplaza la vista legada `muestras` por `envios`; agrega vistas a `SIN_FILTROS`; define `ROLES`, `rolDe`, `esVend`.
- Implementa los **cruces** (2.9) y `xNavegar(v, p)`: `V = {...DEF, mes, tipo: {proyectos:'proys', muestras:'envios'}[v] || v}` + params: `tanda`→`ptanda`, `proyecto`→`tproy` (y `cproy` si v=catalogo), `resp`, `sec`→`csec`, `nueva`→`bnueva` (bandeja) / `mnueva` (muestras). Luego `render()` y scroll arriba.
- `DP.conectar({...})` (2.2), `DP.listo()` cuando hay db, suscripción a muestras.
- Funciones `vX()` que montan cada módulo en `#view` con sus params.
- Reemplaza `openSol` (abrir/cargar solicitud ⇒ Bandeja) y `render` (modo vendedor).
- Listener global: cualquier `[data-mproj]` fuera de un diálogo navega a Muestras filtradas por ese proyecto.
- Diferencias entre el archivo suelto y la copia dentro del HTML: el suelto agrega `'proyantes'` a `SIN_FILTROS` y los cruces `abrirAnterior(id,pane)` → `openProd` (vacío) y `versionAnterior(id)` → vista `proyantes` (ya no existe). El HTML es la versión vigente.

### 3.9 Cronograma (vista `proyectos`, `vCrono` html L1338-1349)
- Proyectos que pasan los filtros legados (`matchP`) y están activos (no cancelados ni publicados), en orden `ranked` (prioridad fija, luego puntaje).
- Ventana: desde el lunes de la semana actual −14 días, 16 semanas (112 días). Una fila por proyecto: nombre (link a la ficha), líder o "sin responsable", línea, "atrasado" si tiene tareas atrasadas. Una barra por cada **etapa default** con tareas (no `no_aplica`): desde el menor `ini` hasta el mayor `fin` según `plan()`; rayada si alguna fecha es sugerida, "hecha" si todas están hechas; ancho mínimo 0,8 %; se omite si cae fuera de la ventana. Etiquetas de semana dd/mm y línea vertical de hoy. Leyenda con colores de etapa.
- Proyectos con etapas propias (máquina, procedimiento, sistemas) **no muestran barras** (limitación reconocida en el plan).
- Arriba: barra de flujo con conteos ("En pasos previos" = solicitudes nueva+en_evaluacion, las 5 etapas, Publicado; clic filtra por etapa). Filtros legados: Línea, Responsable del proyecto, "Con pasos de", Plantilla, Familia, Etiqueta, "Ver cancelados", chips de avance (`en_tanda`, `sin_planificar`, `atrasado`, `sin_lider`, `sin_resp`, `sin_fecha`, `sin_ref`, `muestra_abierta` [usa el legado `p.muestras`], `listos` [todas las capacidades requeridas resueltas], `fijados`), "Mis pasos", chip de capacidad; búsqueda por texto; vistas guardadas (`vistas`) + 14 atajos `PRESETS`. El selector Lista/Kanban/Cronograma aparece pero siempre dibuja el Cronograma (los otros renderers se borraron).

### 3.10 Guías (html L1663-1786)
- `TOURS` (recorridos sobre la pantalla real con foco y caja flotante; Esc sale; ←/→ navegan): general (Primeros pasos), inicio, proyecto, archivo, tareas, tandas, envios, nuevo, solicitud, fechas, reporte, variantes, copias (solo modo local). Cada paso `{sel, t, x, pre?, after?, skipIf?}`; si el selector no está visible, salta al siguiente.
- Progreso en `localStorage['dp-guias']` (`{_visto:1, <id>:1}`); guía sugerida según la vista (`TOUR_POR_VISTA`); al terminar una, ofrece la siguiente.
- "Leer el plan" → vista `plan`: renderiza el `<template id="dp-plan">` (Plan funcional del 13/10/2026, embebido en el HTML), con "Imprimir o guardar como PDF" en modo local.

### 3.11 "Esto me trabó" y copia semanal
- Botón flotante → diálogo (≤1500 chars) → `feedback.add({texto, vista:V.tipo, pid (si está en una ficha), quien, autor, fecha})`; "Gracias: queda registrado y aparece en el reporte semanal." (mod-reportes lo lee).
- **Copia semanal automática (viernes 17:00)**: el Plan funcional dice "todos los viernes a las 17:00 se guarda en Descargas una copia completa de los datos y un reporte. No incluye fotos, archivos ni los PIN"; la Guía dice "Todos los viernes se guarda sola una copia completa en JSON, con un reporte de la semana". **[verificado: NO hay código de esto en base.js, pagina-principal.html, el puente, ningún mod-*.js ni en herramienta/desarrollos.html — grep de viernes/getDay()===5/17:00/download]**. **[inferido de "se guarda en Descargas" + que no está en la página: corre fuera de la herramienta, probablemente una tarea programada del lado de Claude que lee la base y escribe el JSON + reporte]**. **[no lo sé]**: con qué se ejecuta, qué colecciones exporta exactamente y el formato del reporte. Para el sistema nuevo: reemplazar por backup de SQL Server + reporte semanal programado.
- Única exportación en código: `dpLocal.exportar()` (modo local, manual).

### 3.12 Claves de almacenamiento del navegador
`dp-local-db-v1` (base local), `dp-local-nombre`, `dp-yo` (último usuario), `sessionStorage.dp-sesion` (usuario de la pestaña), `dp3-view` (estado de vista `V`), `dp-lastseen` y `dp-lastseen-<nombre>` (última visita, ISO), `dp-guias`, `dp-limpio-1`.

---

## 4. ÓRDENES DE USER, CÓDIGOS ERP, TIZADAPRO Y SISTEMA DE MOLDES

| Sistema externo | Qué se guarda | Dónde | Cómo se usa |
|---|---|---|---|
| **Órdenes de USER** (órdenes de trabajo/producción) | `numero` (texto libre; en datos `SUB-NNNNN` ×11, `DIR-NNNNN` ×2) y `nombre` de la orden | `muestras.ordenes[]` | Solo vínculo textual (sin API, sin estado). Se cargan a mano o pegando filas de la planilla «Ordenes desarrollo producto» (columnas: número, nombre, casilla TRUE/FALSE, comentario/tilde; ver mod-muestras). Al pegar no se repiten números ya cargados (`norm(numero)`). Se muestran como `#SUB-31561 nombre`; el buscador las indexa. 5 proyectos semilla (PD-48..PD-52, `origen:'lista'`, bitácora `Creado` por "Claude") nacieron "desde la muestra enviada #SUB-…". El plan pide a futuro "elegir la orden desde USER". |
| **ERP — maestro de productos** | `ref_erp` (texto ≤20; en datos `PR-001..PR-057`, `PRP-001`, `574`, y un `PR-034 PR-030`) | `productos.ref_erp`; también `solicitudes.ref_erp` (opcional, "si ya existe en el ERP") | La tarea con `ref:true` ("Alta en el ERP como borrador", entregable "REF del ERP") no se cierra sin REF (cruce `altaErp`). Se busca por REF en buscador y listas. La importación cruza por REF exacta. Al aprobar una corrección se hereda la REF del producto base. |
| **ERP — listas** | `familia`, `etiqueta` (texto) | `config/listas` (13 familias, 3 etiquetas) copiadas a mano del "configurador de productos del ERP"; valores en `productos`/`solicitudes` | Selects y filtros. Se guardan como texto (sin id). |
| **ERP — configuración/venta** | flag de tarea `erp:true` (sin lógica); estado de variante `erp` (`sin_verificar`/`no`/`habilitada` = "Habilitada para la venta" en «Modelos que se venden») | `pasos[].erp`, `variantes[].erp` | Avisos de catálogo (`tiz_sin_erp`, `erp_sin_tiz`, `sin_verificar`) y atajo "Variantes en TizadaPro sin habilitar en el ERP". Texto "Copiar datos para el alta en el ERP" (Nombre / Familia / Etiqueta / Línea de producción / Descripción al portapapeles) existe en el HTML pero quedó **sin uso** (diálogo legado). Plantilla stock: "Configuración en el ERP (origen «Producto del local»)". |
| **WMS** | nada | — | Solo nombre de tarea "Accesorios de stock en el WMS" (plantilla estructura). |
| **TizadaPro** (tizada/modelos) | `tizada` (`sin_verificar`/`no`/`cargada`) y `tizada_nombre` (nombre del modelo en TizadaPro, ≤80) | `productos.variantes[]` | Avisos `alta_sin_tiz` (de alta en moldes pero no cargada en TizadaPro), `tiz_sin_erp`, `erp_sin_tiz`. Tareas de plantilla "Molde y modelos en TizadaPro", "Cargar el modelo en TizadaPro". En datos: las 15 variantes están `sin_verificar`. |
| **Sistema de moldes** (motor propio de moldería) | `opciones` (102: molde, slot, código, `codigo_casa`, estado `receta`/`molde`, habilitada, por defecto, productos); `variantes[].moldes` (`no`/`generada` = "Generada por el motor"/`de_alta`); `variantes[].combinacion` (slot→código de opción); `capacidades.lista` ("el sistema de moldes ya la resuelve hoy"); `productos.molde_sistema` (solo semilla, sin uso) | ver 1.5, 1.8, 1.9 | Catálogo técnico: opciones de slot por molde, variantes, "Qué destraba más". Tareas "Molde en el sistema de moldes", "Receta o molde en el sistema de moldes". Notas de semilla citan códigos internos (`MG91`, `MG67`, "maestro", DXF). |
| **Fuentes de moldes** (sitios externos) | `config/fuentes.items[]` `{grupo,url,nombre,nota}` | config | Lista de consulta (Etsy, Mercado Libre UY, Yellow Images, Freepik…). |
| **Google Calendar** | nada | — | Link "+ Google Calendar" por tarea (`DP.gcal`). |

---

## 5. AMBIGÜEDADES Y RAREZAS

1. **Copia semanal de los viernes**: documentada pero sin código en el paquete (3.11). Hay que definir quién/qué la hace.
2. **Personas por nombre, no por id**: `lider`, `responsable`, `pedido_por`, `quien` son texto. Renombrar en Equipo deja huérfanos; `pasos_previos` tiene "Felipe" y "Felipe Lalinde" como personas distintas; "Claude" y "Lista de WhatsApp" aparecen como responsables.
3. **Correlativos sin unicidad**: `nextCode` en el cliente (carrera = códigos repetidos); el código de proyecto es editable y se permite duplicado (solo aviso). Prefijo `PS-` solo existe en la semilla. Importar varias filas sin REF da el mismo `ERP-NN`.
4. **Escrituras no atómicas**: arrays completos (pasos, variantes, bitácora, tareas de tanda) se leen de memoria y se reescriben (last-write-wins). `aprobar` hace 2 escrituras; cancelar/borrar recorre tandas una por una.
5. **Bitácora truncada**: "no se edita ni se borra", pero se queda con las últimas 200 entradas (historial: 80).
6. **`saveProj` descarta campos** fuera de su lista blanca: `guardarProyecto` con `puntaje`, `requiere`, `etapas`, etc. por el camino "resto" no persiste nada, sin error. Además `saveProj`/`tUpd` salen en silencio si no es admin.
7. **Dos implementaciones de cada regla**: `ordenar`/`plan`/`scoreOf`/`etapaActual` en la página vs `DP.tareasDe`/`fechasSugeridas`/`puntaje`/`etapaDe` en base. Para proyectos con etapas propias el orden de la página ignora `p.etapas` (usa el array). `DP.proyectos().etapa` y `historial` se calculan con la versión de la página.
8. **Fechas**: `hoy()` es local y `ahora()` UTC; el puntaje parsea `fecha_limite` como medianoche UTC (en UY, 21:00 del día anterior), mientras el recomendado usa días enteros a las 12:00 local → umbrales con ±1 día de diferencia. Vencida suma +3 en puntaje (≤7 días incluye negativos). Sin feriados en días hábiles.
9. **Fechas sugeridas**: el cursor retrocede a la fecha real de una tarea hecha; las dependencias que están más abajo en el orden se ignoran; todo lo no empezado se corre con `hoy` cada día.
10. **"Terminado" implícito**: un proyecto sin tareas, o con todo `no_aplica`, cuenta como publicado (va al Archivo); avance 0 % en el segundo caso.
11. **Reglas solo de UI o no aplicadas**: la REF obligatoria (`ref:true`) no se valida en la capa de datos; "una orden no se puede rechazar" solo vive en el diálogo legado y la Bandeja nueva deja descartar órdenes; terminar una tarea con dependencias pendientes solo avisa.
12. **Campos sin uso o legados**: `pasos[].erp`, `productos.categoria`, `productos.molde_sistema`, `productos.muestras`, `prioridad_fija`, `solicitudes.opiniones`, `participantes`, `puntaje_solicitante`, `estado:'en_evaluacion'`, `pasos_previos` (la Bandeja nueva aprueba sin completarlos), colección `vistas`, diálogos `#dlg`/`#solDlg`/`#tpDlg` y el botón "Copiar datos para el alta en el ERP" (`openProd` vacío).
13. **Datos sucios**: `ref_erp = "PR-034 PR-030"` (dos códigos), `574` sin prefijo, `PRP-001`; `contacto.telefono` "a"/"1"; slot `Manga` con mayúscula y valores `corta`/`raglan` que no son códigos de opción; ids de variante `v1..v5` repetidos entre productos; `muestras.proyecto_id` duplicado de `proyectos[0]`; una nota de `config/fuentes` trae un mail de acceso a un sitio.
14. **JSON vs código**: el snapshot no trae `desarrollo` (⇒ producto), `pedido_por`, `tandas`, `plantillas`, `comentarios`, `pines`, `vistas`, `feedback`, `config/desarrollos`; `config/equipo` no tiene `rol`. `config/orden.ids` cubre 45 de 62 activos (el resto se ordena por puntaje).
15. **Importación**: la ayuda menciona la columna "Estado" pero no se lee; coincide por nombre también contra cancelados; los nuevos entran como publicados con 12 tareas `hecho` de la plantilla prenda sea cual sea el producto; `prods` no se refresca durante el bucle.
16. **Quitar del equipo no quita el acceso**: el nombre sigue en el ingreso mientras tenga PIN. PIN legible y forzable por cualquiera con lectura; el bloqueo de 5 intentos es solo del cliente. Sesión por pestaña (sessionStorage).
17. **Borrar proyecto** no limpia muestras vinculadas, comentarios ni `solicitudes.producto_creado_id`. **Cancelar** solo desvincula de tandas abiertas y no escribe `historial`.
18. **Cronograma**: el filtro/vista legado sigue vivo (`V.tipo='proyectos'`), el selector Lista/Kanban no hace nada y no dibuja barras de proyectos con etapas propias; el buscador de capacidades y "Buscar en la lista de proyectos" llevan a esta vista legada, no al módulo Proyectos.
19. **"Cargar con el formulario completo"** del buscador intenta llenar `#s-titulo` del diálogo legado; como `openSol` ahora navega a la Bandeja, el título no se precarga.
20. **Puente duplicado**: el archivo suelto y la copia dentro del HTML difieren (`proyantes`, `abrirAnterior`, `versionAnterior`); vale la del HTML.
21. **Doble suscripción**: la página y los módulos se suscriben por separado a las mismas colecciones (`_id` en la página, `id` en DP).

---

## Apéndice: mapeo directo a tablas (para SQL Server)

Mínimo para respetar el comportamiento descrito (la Guía, sección 8, ya sugiere sacar tareas, tandas y variantes a tablas propias):
- `Proyecto` (1.3, sin arrays) · `ProyectoEtapa` (solo si tiene flujo propio: orden, id, label, color) · `Tarea` (1.4, + `ProyectoId`, `Orden` int, `VarianteId` nullable) · `TareaDependencia` (TareaId, DependeDeId; misma obra) · `ProyectoCapacidad` (ProyectoId, CapacidadId, Tipo `requiere`|`resuelve`) · `ProyectoArchivo`.
- `Variante` (1.5; `combinacion` como JSON o tabla `VarianteOpcion(slot, codigo)` + `libre`).
- `Solicitud` (1.6) · `SolicitudArchivo` · `SolicitudCapacidad`. `pasos_previos`/`opiniones` solo si se decide conservarlos.
- `Muestra` (1.7) · `MuestraOrden` (numero, nombre; FK a la orden de USER si existe) · `MuestraProyecto` (N:M) · `MuestraTilde` · `MuestraFoto`.
- `Tanda` · `TandaProyecto` · `TandaTarea` (UNIQUE TareaId entre tandas abiertas = "una tarea, una tanda") · `TandaGrupo` · `TandaGrupoProyecto`.
- `Capacidad` (1.8), `OpcionSlot` (1.9), `Plantilla` + `PlantillaEtapa` + `PlantillaTarea`, `TipoDesarrollo` (config/desarrollos), `Linea`, `Familia`, `Etiqueta` (o leerlas del ERP), `EstadoMuestra` (id, nombre, tono, orden), `TildeMuestra`, `FuenteMolde`, `OrdenListaDesarrollo` (ProyectoId, posición), `PlanConfig` (horizonte, tanda).
- `Comentario` (Entidad, EntidadId, texto, autor, fecha) · `Bitacora` (Entidad, EntidadId, fecha, autorId, quien, accion, detalle) **sin el tope de 200** · `ProyectoHistorialEtapa` · `Feedback`.
- Personas: usuarios del sistema destino con `rol` (desarrollo/vendedor) y líneas; reemplazar `lider`/`responsable`/`pedido_por` (texto) por FK y migrar por coincidencia de `norm(nombre)`. PIN y `pines` no se migran.
- Calculados que NO se guardan: etapa actual, terminado/publicado, avance, atrasadas, bloqueada, fechas sugeridas, puntaje, recomendado, dormidas (2.7). Correlativos (`SOL-`, `PD-`, `CO-`) con secuencia o `MAX+1` dentro de una transacción con UNIQUE.

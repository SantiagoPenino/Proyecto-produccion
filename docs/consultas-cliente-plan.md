# Consulta al Cliente — plan de implementación (SB · DTF · ECOUV)

Fecha: 2026-09-10. Estado: **plan, sin implementar**.
Origen: prototipo y spec de `Desktop/xime` (`CEREBRO_consulta_al_cliente.md`), revisados en [consulta-cliente-revision-prototipo.md](consulta-cliente-revision-prototipo.md).

---

## 0. Qué se pide

Que el operador, desde el **detalle de orden** de la planilla de Sublimación, DTF y ECOUV, pueda **preguntarle algo al cliente** sobre un archivo o sobre la orden entera, con foto, y que el trabajo quede frenado hasta que el cliente responda desde su portal: **continuar** o **cancelar**.

Hoy las únicas salidas del operador ante una duda son editar el archivo o cancelarlo. Falta el paso del medio: preguntar. El objetivo de negocio es dejar de cancelar (o de imprimir a ciegas) por dudas que se resuelven con una foto, y que la aprobación del cliente quede **escrita**, que es lo que después sostiene el reclamo.

Áreas del alcance: `SB`/`SUB`, `DF`/`DTF`, `ECOUV`. Quedan afuera por ahora TPU (ya tiene su propio circuito de aprobación de boceto), Bordado, Corte, Costura y PRO.

---

## 1. La decisión de arquitectura

**Esto no es un chat.** El operario hace **una** pregunta, con foto si quiere, y el cliente responde **una** vez: aprueba o cancela. No hay réplica, ni hilo, ni conversación. Esa restricción es la que define el diseño.

### Por qué NO se monta sobre el módulo de tickets

El sistema tiene tickets (`Tickets`, `Tickets_Mensajes`, `Tickets_Adjuntos`) con hilo, adjuntos, badge y push, y a primera vista parecía el atajo. Se descarta por dos razones de fondo:

1. **Un ticket es, por definición, un ida y vuelta.** El cliente puede responder texto, y el staff volver a contestar (`ticketsController.js:391` alterna el estado entre "esperando al cliente" y "esperando al staff"). Eso es exactamente lo que no se quiere.
2. **Lo mandaría a la bandeja equivocada.** Los tickets viven en Soporte, como reclamos. Una consulta de producción tiene que aparecer **sobre el pedido**, donde el cliente ya mira sus trabajos, no en otra sección.

Sí se reusa el **patrón** de los adjuntos de tickets (`middleware/multerTicketsConfig` + carpeta por entidad + ruta autenticada que sirve el archivo), porque es la única subida de imágenes cliente-facing que ya existe y está probada. Se copia el mecanismo, no la tabla.

### Qué se construye

Un objeto propio, chico y cerrado: **una consulta = una pregunta + hasta 5 fotos + una respuesta**. Sin mensajería. La pregunta se escribe una vez y no se edita; si el operario se equivocó, retira la consulta y manda otra, y eso queda en el historial.

El único texto que puede escribir el cliente es un **comentario opcional al responder**, que no abre conversación: es la explicación de por qué canceló, que hoy se pierde por teléfono. Va en la misma tabla, se lee en el detalle de la orden y ahí termina. Si preferís que ni eso, se saca y quedan solo los dos botones (decisión 7 de la lista final).

---

## 2. El freno de producción: usar lo que ya frena

`Ordenes.EstadoDependencia` es el mecanismo existente para sacar una orden de la grilla trabajable. La consulta del tablero la excluye explícitamente:

```sql
-- ordersController.js:1156 (getOrdersByArea, modo activo)
AND (o.EstadoDependencia IS NULL OR o.EstadoDependencia = 'OK')
```

Valores en uso hoy en producción: solo `OK` (22.003) y `VENTA_DIRECTA` (110); el código además maneja `ESPERANDO_IMPRESION` y `ESPERANDO_RETIRO_WMS`. Agregar **`ESPERANDO_CONSULTA`** entra en un mecanismo probado y no toca ninguna consulta existente.

Con eso, la orden desaparece sola de la grilla activa, de la selección para lote y del kanban. Para que **no se vuelva invisible**, se replica el patrón que ya usa Bordado, que muestra las bloqueadas en su propia bandeja con el motivo (`embBoardController.js:366-385`).

Defensa en profundidad, porque el freno no puede depender de una sola capa:

1. `EstadoDependencia = 'ESPERANDO_CONSULTA'` → fuera de la grilla y del kanban.
2. **Guard nuevo en `assignRoll`** (`ordersController.js:1418`): hoy valida material y variante pero **no valida ningún estado**, así que una orden frenada podría entrar a un lote por API. Rechazar con mensaje claro.
3. El front ya exige estado `Pendiente` para asignar a lote (`AreaView.jsx:874-884`), pero es UX, no seguridad.

Al liberar hay que **restaurar el estado previo, no asumir `OK`**: la orden pudo estar esperando otra cosa antes (`ESPERANDO_IMPRESION`, por ejemplo). Por eso la tabla guarda el valor anterior.

### Lo que NO se toca

`ArchivosOrden.EstadoArchivo` **no** recibe un valor nuevo `EN_CONSULTA`. Hay 56 lugares del backend que filtran esa columna por literal (`productionFileController`, `pedidoCompletoService`, `rollsController`, `fileProcessingService`, `LabelGenerationService`, `inventoryController`, `erpSyncService`, el job de zombies). Un valor nuevo obliga a revisar cada uno para decidir si cuenta como activo, pendiente o controlado. La consulta **registra a qué archivo se refiere**, pero el freno es de la orden.

---

## 3. Modelo de datos

```sql
-- Catálogo de motivos, espejo de MotivosCancelacion (se pueden agregar sin deploy)
CREATE TABLE dbo.MotivosConsulta (
    MotConIdMotivo   INT IDENTITY(1,1) PRIMARY KEY,
    MotConTitulo     NVARCHAR(80)  NOT NULL,
    MotConDescDefault NVARCHAR(400) NULL,   -- texto sugerido que precarga el mensaje
    MotConActivo     BIT NOT NULL CONSTRAINT DF_MotCon_Activo DEFAULT 1,
    MotConOrden      INT NOT NULL CONSTRAINT DF_MotCon_Orden  DEFAULT 0
);

-- Semilla (del CEREBRO §4)
INSERT INTO dbo.MotivosConsulta (MotConTitulo, MotConOrden) VALUES
 ('Resolución / calidad del archivo', 1), ('Medidas o proporción', 2),
 ('Color / tonalidad', 3), ('Contenido, texto u ortografía', 4),
 ('Material o terminación', 5), ('Sangrado / elementos cortados', 6),
 ('Consulta general del pedido', 7), ('Otro', 99);

CREATE TABLE dbo.ConsultasCliente (
    ConIdConsulta     INT IDENTITY(1,1) PRIMARY KEY,
    OrdIdOrden        INT           NOT NULL,   -- Ordenes.OrdenID (producción)
    ArchivoID         INT           NULL,       -- ArchivosOrden.ArchivoID; NULL = toda la orden
    MotConIdMotivo    INT           NOT NULL,
    ConPregunta       NVARCHAR(1500) NOT NULL,  -- LA pregunta: se escribe una vez, no se edita
    ConEstado         VARCHAR(24)   NOT NULL,   -- ENVIADA | RESPONDIDA | RETIRADA | VENCIDA
    ConRespuesta      VARCHAR(12)   NULL,       -- APROBADO | CANCELADO
    ConComentarioCli  NVARCHAR(1000) NULL,      -- opcional, del cliente, NO abre conversación
    ConBloqueaProd    BIT           NOT NULL CONSTRAINT DF_Con_Bloquea DEFAULT 1,
    -- Para liberar al estado REAL anterior, no a un OK asumido
    ConDependenciaPrev VARCHAR(50)  NULL,
    ConEstadoAreaPrev  NVARCHAR(50) NULL,
    ConUsuarioAlta    INT           NOT NULL,
    ConFechaAlta      DATETIME      NOT NULL CONSTRAINT DF_Con_Alta DEFAULT GETDATE(),
    ConFechaVence     DATETIME      NULL,
    ConFechaRespuesta DATETIME      NULL
);

-- Las fotos de la pregunta (0 a 5). Solo las sube el operario, al crear la consulta.
CREATE TABLE dbo.ConsultasClienteFotos (
    CFoIdFoto     INT IDENTITY(1,1) PRIMARY KEY,
    ConIdConsulta INT          NOT NULL,
    CFoRutaArchivo VARCHAR(500) NOT NULL,
    CFoNombre      NVARCHAR(200) NULL,
    CFoFecha       DATETIME NOT NULL CONSTRAINT DF_CFo_Fecha DEFAULT GETDATE()
);

-- Una sola consulta abierta por orden (regla dura del CEREBRO §5.3)
CREATE UNIQUE INDEX UX_ConsultasCliente_AbiertaPorOrden
    ON dbo.ConsultasCliente (OrdIdOrden) WHERE ConEstado = 'ENVIADA';

CREATE INDEX IX_ConsultasCliente_Estado ON dbo.ConsultasCliente (ConEstado, ConFechaVence);
```

La pregunta es una **columna**, no una tabla de mensajes: es una sola y no se responde con texto. Si mañana hiciera falta un ida y vuelta, ahí sí correspondería un ticket, y son dos cosas distintas conviviendo sin pisarse.

El índice único filtrado es el que impone, a nivel base, que no haya dos consultas abiertas pisándose sobre la misma orden. Sin eso, dos operadores en dos pantallas generan estados inconsistentes.

---

## 4. Máquina de estados

```
                  ┌──────────────► RETIRADA   (el operador la da de baja, o edita el archivo)
                  │
ENVIADA ──────────┼──────────────► VENCIDA    (pasó el SLA sin respuesta)
                  │
                  └──► RESPONDIDA ─┬─ APROBADO  → libera y deja la conformidad escrita
                                   └─ CANCELADO → cancela archivo u orden (ruta existente)
```

Efecto sobre la orden:

| Momento | `EstadoDependencia` | `EstadoenArea` |
|---|---|---|
| Se envía la consulta | `ESPERANDO_CONSULTA` (guarda el previo) | `Esperando Cliente` (guarda el previo) |
| Cliente aprueba | restaura el previo | restaura el previo |
| Cliente cancela | lo maneja `cancelFile` / `cancelOrder` | ídem |
| Vence | restaura el previo + avisa al **operador**, no al cliente | ídem |

`Esperando Cliente` hay que darlo de alta en `ConfigEstados` como `TipoEstado='ESTADOENAREA'` colgando de `Pendiente` (EstadoID 2), porque `changeOrderState` deriva el estado general del padre. Sin la fila, el estado general se pierde.

**Vencer no cancela.** Cancelar por silencio destruye ventas: al vencer la orden vuelve a estar trabajable y el aviso va al operador.

---

## 5. UI del operador — detalle de orden

Archivo: `src/components/production/components/OrderDetailModal.jsx`. Es el mismo modal para las tres áreas y se abre desde `AreaView`, `PlaneacionTrabajo`, `IntegralOrderView`, `OrdersQueryView` y `FilePrintControl`, así que un solo cambio cubre todos los accesos. Ya detecta el área con `isSB` / `isDF` (hay que sumar `isECOUV`).

**a) Consulta por archivo.** Un botón nuevo en la fila de cada archivo, junto a Editar y Cancelar (`OrderDetailModal.jsx:1284-1345`). Ícono de globo de diálogo, color ámbar. **Solo aparece si la orden está pendiente** (decisión 6): con la orden en un lote o en máquina no se muestra. Se deshabilita además si el archivo está cancelado, si ya hay una consulta abierta en esa orden o si el modal viene en `readOnly`.

**b) Consulta de la orden completa.** Un botón en el pie, en el grupo donde hoy están Cancelar Orden y Cancelar Pedido (`:2434-2456`), pero **fuera** del bloque rojo: es una acción de espera, no destructiva. Ámbar, nunca magenta, que está reservado a lo destructivo.

**c) El modal de consulta.** Motivo (obligatorio, del catálogo), mensaje (obligatorio, mínimo 10 caracteres: una foto sin pregunta es ruido), fotos hasta 5, y el aviso de que la orden queda frenada. Fondo sólido, **sin `backdrop-blur`**.

**d) Estado a la vista.** Con una consulta abierta, la cabecera del detalle muestra una banda ámbar con el motivo, desde cuándo espera y quién la mandó.

---

## 6. UI del cliente — portal

**a) Dónde aparece.** En Mi Fábrica (`src/client-portal/modulos/FactoryView.jsx`), sobre la tarjeta del pedido, con el mismo tratamiento que ya tiene el pedido retenido esperando aprobación (`pendientesAprobacion`, líneas 238-265 y 429-431). El cliente ya está entrenado en ese gesto.

**b) La pantalla de respuesta.** Una sola pantalla, sin caja de chat: motivo, la pregunta del operario, las fotos ampliables, un campo de comentario opcional y dos botones, **Está correcto, continuar** (verde) y **Cancelar** (magenta), cada uno con su confirmación. El texto de la confirmación dice qué se cancela exactamente: el archivo o la orden entera. Al responder, la pantalla se cierra y la consulta pasa a ser historial: no queda nada para seguir escribiendo.

**c) El aviso.** El badge va sobre la propia tarjeta del pedido (no en Soporte), más push (`pushNotificationService.sendToOrderClient`, que soporta botones de acción) y mail. WhatsApp solo con link al portal, nunca con la decisión por texto: un "dale" suelto no es evidencia estructurada.

---

## 7. La respuesta del cliente — la regla que evita romper todo

La cancelación **no implementa lógica propia**. Llama a lo que ya existe:

- Consulta **de archivo** → `ordersController.cancelFile` (`:3407`), que ya marca el archivo, recalcula la magnitud, auto-cancela la orden si no quedan activos, arrastra la hermana de terminaciones, escribe el historial y resincroniza el ERP.
- Consulta **de orden** → la misma ruta que el botón Cancelar Orden.

Si se escribe una tercera ruta de cancelación, esas reglas dejan de aplicarse y aparecen órdenes en estado inconsistente. Es el bug más probable de esta funcionalidad.

Al aprobar: se libera la orden, se guarda `ConRespuesta = 'APROBADO'` con fecha, y esa conformidad queda visible en el detalle y en el historial. Si después se **edita** el archivo, la consulta abierta pasa a `RETIRADA` y la conformidad se limpia: un arte nuevo no está aprobado.

---

## 8. Endpoints y archivos

**Backend, nuevo** `controllers/consultasClienteController.js` + `routes/consultasClienteRoutes.js`:

| Método | Ruta | Quién | Qué hace |
|---|---|---|---|
| GET | `/api/consultas/motivos` | interno | catálogo |
| POST | `/api/consultas` | interno | crea (multipart con fotos) y congela la orden |
| GET | `/api/consultas/orden/:ordenId` | interno | consultas de esa orden para el modal |
| POST | `/api/consultas/:id/retirar` | interno | la da de baja y libera |
| GET | `/api/web-orders/consultas` | cliente | sus consultas abiertas |
| POST | `/api/web-orders/consultas/:id/responder` | cliente | `{ respuesta, comentario }` |

**Backend, a tocar:**

- `ordersController.js` — guard en `assignRoll` (`:1418`); exponer si la orden tiene consulta abierta en `getOrdersByArea` (`:1020`); limpiar la consulta al editar archivo en `updateFile` (`:1747`); **cascada a las órdenes encadenadas** en `cancelOrder` (`:2844`) y `cancelFile` (`:3407`), según §11.
- `services/stateManagerService.js` — sin cambios; se usa `changeOrderState` tal cual para el historial.
- `middleware/multerConsultasConfig.js` (nuevo) — copia del de tickets: carpeta por consulta y ruta autenticada que sirve la foto.
- `jobs/` — job nuevo de vencimiento (fase 4).

**Frontend, a tocar:**

- `production/components/OrderDetailModal.jsx` — los dos botones, el modal y la banda de estado.
- `production/areas/AreaView.jsx` — badge en la fila y filtro "Esperando respuesta del cliente".
- `client-portal/modulos/FactoryView.jsx` — la tarjeta y la pantalla de respuesta.
- `services/modules/ordersService.js` — los llamados nuevos.

---

## 9. Fases

| # | Fase | Qué entra | Estado |
|---|---|---|---|
| F0 | Base de datos y backend | Las dos tablas, el catálogo sembrado, los endpoints, congelar y liberar. | ✅ **Hecho (10/09)** |
| F3 | Cancelar de verdad | Cablear la respuesta CANCELADO a `cancelFile` / `cancelOrder`. | ✅ **Hecho (10/09)** |
| F1 | UI del operador | Botón por archivo, botón de orden completa, modal con fotos, banda de estado. | ✅ **Hecho (11/09)** |
| F4 | Visibilidad en planilla | Badge y bandeja de frenadas. | ✅ **Hecho (11/09)** |
| F2 | UI del cliente | Aviso en Mi Fábrica, pantalla de respuesta, los dos botones. | ✅ **Hecho (11/09)** |
| F5 | Vencimiento y recordatorios | Job de SLA, recordatorios a las 4 h y 20 h, aviso al operador al vencer. | ✅ **Hecho (11/09)** |

F3 se hizo junto con F0: dejar la respuesta CANCELADO sin cablear habría sido una trampa (el cliente cancela y no se cancela nada). F4 entró con F1, porque sin ella una orden frenada desaparece de la planilla.

**El módulo está completo.** Falta deployarlo y correr el SQL en producción (o dejar que lo cree el auto-heal).

### Lo que quedó construido (F1 + F4)

| Archivo | Qué es |
|---|---|
| `src/services/modules/consultasService.js` | Los llamados de la planta (+ export en `services/api.js`). La foto va por blob: la ruta es autenticada. |
| `src/components/production/components/ModalConsultaCliente.jsx` | El modal: motivo, la pregunta (mínimo 10), hasta 5 fotos con preview y el aviso del freno. Ámbar, fondo sólido. |
| `src/components/production/components/BandaConsultaCliente.jsx` | La banda ámbar del detalle (motivo, desde cuándo, quién preguntó, fotos, botón Retirar) y, si ya respondió, la conformidad escrita con su comentario. |
| `src/components/production/components/OrderDetailModal.jsx` | Botón por archivo (junto a Editar), botón de orden completa en el pie **fuera** del bloque rojo, y la banda arriba de todo. |
| `src/components/production/components/ProductionTable.jsx` | Celda de estado en ámbar fijo para `Esperando Cliente` (fijo y no pulsante: en la planta nadie tiene nada que hacer con esa orden). |
| `src/components/production/areas/AreaView.jsx` | Bandeja "Ver esperando al cliente", al lado de finalizadas/canceladas y excluyente con ellas. Solo en SB/DTF/ECOUV. |
| `backend/controllers/ordersController.js` | `mode='consultas'` en `getOrdersByArea`: filtra por `EstadoDependencia` y trae motivo/desde/vence/quién por `OUTER APPLY`. |
| `src/services/modules/ordersService.js` | `getById` ahora mapea `rollId` y `dependencyStatus` (sin eso el gate del modal decidía a ciegas). |

Dos decisiones de implementación que conviene no perder:

1. **El `OUTER APPLY` corre SOLO en `mode='consultas'`.** En el tablero activo esas órdenes están excluidas por el filtro de `EstadoDependencia`, así que la subconsulta nunca devolvería nada y sería costo puro en el camino más caliente del sistema.
2. **La bandeja filtra por `EstadoDependencia`, no por la consulta.** La hermana de terminaciones de una ECOUV queda frenada por arrastre y no tiene fila propia en `ConsultasCliente`: si se filtrara por la consulta, esa hermana desaparecería igual que antes.

Probado contra la base local, de punta a punta: crear la consulta frena la orden (`ESPERANDO_CONSULTA` + `Esperando Cliente`), la saca de la grilla activa y la muestra en la bandeja con su motivo y quién preguntó; retirarla la devuelve a `OK` / `Pendiente` y la bandeja queda vacía.

### Lo que quedó construido (F2)

| Archivo | Qué es |
|---|---|
| `src/client-portal/modulos/ConsultaClienteModal.jsx` | La pantalla de respuesta: motivo, la pregunta, las fotos ampliables, comentario opcional y los dos botones, cada uno con su confirmación. La de cancelar dice si cae el archivo o la orden entera. |
| `src/client-portal/modulos/FactoryView.jsx` | Aviso ámbar arriba de la lista con un botón por consulta, badge pulsante "RESPONDÉ PARA SEGUIR" sobre la tarjeta del pedido, y refresco por socket. |
| `src/client-portal/api/apiClient.js` | `getBlob`: un archivo servido por ruta autenticada no se puede poner en un `<img src>` (ahí no viaja el token). |
| `backend/routes/webOrdersRoutes.js` | `GET /consultas/:consultaId/foto/:fotoId` para el cliente. |
| `backend/controllers/consultasClienteController.js` | `getFoto` ahora valida propiedad. |

Tres decisiones de esta fase:

1. **El aviso va arriba de la lista, además del badge en la tarjeta.** La tarjeta sola no alcanza: el pedido consultado puede caer fuera de la página cargada (son de a 20) o del filtro elegido, y entonces el cliente nunca se entera de que hay algo frenado esperándolo.
2. **`getFoto` valida propiedad.** `verifyToken` acepta cualquier JWT válido, así que un cliente logueado podía leer las fotos de las consultas de otro probando ids. Ahora, si el token trae `codCliente` (cliente, o diseñador impersonando), la consulta tiene que ser de su pedido; los usuarios internos no tienen ese campo y no se ven afectados.
3. **La confirmación de cancelar nombra lo que cae.** Es una decisión que destruye trabajo real; un "¿estás seguro?" genérico no alcanza.

Probado contra la base local: el operario pregunta y la orden queda frenada; el cliente ve la consulta y **otro cliente no** (0 filas); responder desde otra cuenta rebota con 403; aprobar libera la orden a `OK` / `Pendiente` y le vacía la lista de pendientes; responder dos veces rebota con 409.

El mail del §6c quedó afuera: el aviso hoy es push (`sendToOrderClient`, con el `tag` de la consulta) más lo que se ve al entrar al portal.

### Lo que quedó construido (F5 + los dos ganchos del plan)

| Archivo | Qué es |
|---|---|
| `backend/jobs/consultasVencimiento.job.js` | Cada 15 min: recordatorios al cliente (4 h y 20 h) y vencimiento del plazo. Registrado en `jobRegistry`, así que aparece en /admin/cron y se puede disparar a mano. |
| `backend/services/consultasClienteService.js` | `vencerConsulta`, `getConsultasVencidas`, `getConsultasParaRecordar`, `marcarRecordatorio`, `archivoEditado`. Dos columnas nuevas por auto-heal: `ConRecordatorios` y `ConArteCambiado`. |
| `backend/utils/cadenaOrdenes.js` | `cancelarOrdenesEncadenadas` (§11.2) y `hermanasVivasDelPedido` (§11.3/§11.4). |
| `backend/controllers/ordersController.js` | La cascada en `cancelOrder` y en el auto-cancel de `cancelFile`; `updateFile` avisa al módulo de consultas; las dos rutas devuelven `encadenadas` y `hermanasVivas`. |
| `src/components/production/components/OrderDetailModal.jsx` | Tras cancelar, el aviso de qué cayó en cascada y qué quedó vivo, con el botón para cancelar el pedido completo. |
| `src/components/production/components/BandaConsultaCliente.jsx` | Una aprobación cuyo arte se editó después se muestra en ámbar, no en verde. |

Cuatro decisiones:

1. **Vencer NO cancela** (§4). El aviso al operador es una **nota de producción** más el historial: no hay bandeja de notificaciones internas en el sistema, y la nota queda donde el operario va a mirar igual.
2. **La conformidad no se borra nunca.** Cuando se edita un archivo ya aprobado se marca `ConArteCambiado`, y el detalle deja de mostrarla en verde. Borrar la respuesta sería destruir el registro de lo que el cliente dijo y cuándo, que es justamente lo que sostiene el reclamo.
3. **Editar un archivo retira solo las consultas de ESE archivo.** Una consulta sobre la orden entera no queda sin sentido porque se haya tocado un archivo; esa la retira el operario si quiere.
4. **`cancelRequest` no lleva la cascada.** Cancela el pedido entero con un UPDATE masivo por `NoDocERP`, y las órdenes encadenadas siempre pertenecen al mismo pedido: ya caen ahí. Meterle la cascada sería trabajo duplicado sobre el camino más sensible del sistema.

Probado contra la base local: el job vence la consulta, libera la orden a `OK` / `Pendiente` y escribe la nota; correrlo de nuevo no toca nada; editar el archivo retira la consulta abierta y libera la orden. La cascada se probó con una cadena armada a mano dentro de una transacción revertida (en local no hay órdenes encadenadas reales): cancela la hija y la nieta, les cancela los archivos, les limpia la dependencia y la segunda pasada no hace nada.

### Lo que quedó construido (F0 + F3)

| Archivo | Qué es |
|---|---|
| `backend/scripts/sql/consultas_cliente.sql` | DDL + semilla. Idempotente. Opcional: el backend también lo crea solo. |
| `backend/services/consultasClienteService.js` | Toda la lógica: esquema, crear, congelar, liberar, responder, retirar, lecturas. |
| `backend/controllers/consultasClienteController.js` | Endpoints internos y del portal + el cableado a la cancelación existente. |
| `backend/routes/consultasClienteRoutes.js` | `/api/consultas` (planta). |
| `backend/middleware/multerConsultasConfig.js` | Fotos: hasta 5, solo imágenes, 5 MB, carpeta por consulta. |
| `backend/utils/hermanaTerminaciones.js` | Se agregó `buscarHermanaTerminaciones` (sin tocar lo existente). |
| `backend/routes/webOrdersRoutes.js` | `/api/web-orders/consultas` y `/consultas/:id/responder` (cliente). |
| `backend/controllers/ordersController.js` | Guard en `assignRoll`: una orden con consulta abierta no entra a un lote. |

**Probado contra la base local, de punta a punta:** el esquema se crea solo; la consulta frena la orden y la saca de la grilla activa; guarda el estado previo y lo restaura al liberar; rechaza una segunda consulta abierta, una pregunta de menos de 10 caracteres, responder dos veces y responder desde otra cuenta; y la respuesta CANCELADO pasa por el controller real, delega en `cancelFile` y dispara la auto-cancelación de la orden cuando era el último archivo activo.

---

## 10. Decisiones tomadas (10/09/2026)

| # | Tema | Decisión |
|---|---|---|
| 1 | Alcance del freno | Se frena **la orden del área**. La cascada al cancelar se resuelve en §11. |
| 2 | ECOUV y terminaciones | Si se frena la madre, **se frena la hermana**. Mismo helper que ya usa la cancelación (`utils/hermanaTerminaciones.js`). |
| 3 | Quién puede consultar | **Todos los usuarios** internos. Sin permiso especial. |
| 4 | El plazo | 24 horas hábiles, **configurable** en `ConfiguracionGlobal`. |
| 5 | Cancelación general | Igual que la 1: se resuelve en §11. |
| 6 | Cuándo se puede consultar | **Solo sobre órdenes pendientes.** Si ya está en un lote o en máquina, el botón no aparece. |
| 7 | Comentario del cliente | **Sí**, un renglón opcional al responder. |

La decisión 6 simplifica todo lo demás: si la consulta solo sale sobre pendientes, cuando el cliente cancela **nada aguas abajo empezó todavía**. No hay material impreso viajando ni nadie trabajando sobre esa pieza en otra área.

---

## 11. Qué pasa con el resto del pedido cuando el cliente cancela

La pregunta de fondo: si freno solo la orden del área y esa orden tenía que seguir viaje a otra, ¿qué pasa con la de destino cuando se cancela?

### Cómo está hoy, verificado

Cancelar una orden (`ordersController.cancelOrder`, `:2844`) hace tres cosas: cancela la orden y sus archivos, **cancela la hermana de terminaciones** de ECOUV y limpia el lote si quedó vacío. Nada más.

Eso deja dos agujeros, que **ya existen hoy** sin esta funcionalidad:

1. **Las hermanas del mismo pedido en otras áreas quedan vivas**, esperando un material que nunca va a llegar. Comparten `NoDocERP` pero no hay vínculo uno a uno entre la pieza impresa y la que la termina, salvo el caso ECOUV que sí está atado.
2. **Las órdenes encadenadas quedan colgadas para siempre.** Una orden de Estampado que espera su DTF queda con `EstadoDependencia = 'ESPERANDO_IMPRESION'` y `LiberaCuandoOrdenID` apuntando a la fuente. Se libera **solo** cuando la fuente llega a "Pronto" (`productionFileController.js:2468-2485`), y una orden cancelada nunca llega a Pronto. Queda invisible en la grilla activa y esperando indefinidamente.

El segundo es un bug real, independiente de esta feature, que conviene arreglar acá porque la consulta lo va a disparar seguido.

### La regla propuesta

1. **Frenar**: la orden del área y su hermana de terminaciones.
2. **Al cancelar**: cae esa orden, su hermana de terminaciones (ya lo hace) y **todo lo que la estaba esperando por `LiberaCuandoOrdenID`** (esto hay que agregarlo). Sin eso quedan órdenes zombi.
3. **Las otras órdenes del pedido que no dependían de la cancelada no se tocan solas.** Un pedido puede tener trabajos independientes: una bandera y unos stickers. Cancelar los stickers porque el cliente rechazó la bandera es peor que el problema.
4. **Se decide con una persona, no con una regla.** Al confirmarse la cancelación, el operador ve un aviso con las órdenes del pedido que quedaron vivas y un botón para cancelar el pedido completo, que ya existe (`cancelRequest`, `:3197`). El sistema informa; la decisión es humana.

Lo mismo aplica a la consulta de orden completa: cancela esa orden y su cadena, y avisa del resto.

---

## 11. Lo que queda afuera de la v1

- Mail con botones de decisión por link firmado. Un link de "cancelar pedido" reenviado cancela producción real: si se hace, el token va de un solo uso y vence con el SLA.
- WhatsApp con respuesta por texto.
- Reportes por motivo (sale gratis después, con el motivo ya como dato).
- TPU, Bordado, Corte, Costura y PRO.

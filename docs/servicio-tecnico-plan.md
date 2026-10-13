# Servicio Técnico — plan del módulo (28/09/2026)

Módulo para el equipo de Servicio Técnico (área `SERVICIO`): solicitudes de reparación
(máquinas de producción y también PC, internet, software), mantenimientos programados,
proyectos, historial de cambios de las máquinas, procedimientos, insumos y reportes.

Estado (28/09): **etapa 1 implementada y probada en local, sin deployar** (ver CHANGELOG, "Servicio
Técnico etapa 1"). Etapas 2 a 5: pendientes. Decisiones al final.

---

## 0. Lo que hay hoy (verificado en el código el 28/09)

- El botón "Reportar Falla" de cada área (`AreaView.jsx`) abre `ReportFailureModal`: máquina,
  tipo de falla, prioridad, descripción → crea un ticket en `TicketsMantenimiento` y pone la
  máquina en `ConfigEquipos.Estado = 'FALLA'`. Guarda "Operario" fijo como quien reportó.
- No hay forma de cerrar un ticket (la columna `FechaCierre` existe y nadie la escribe).
- La pantalla `ServicioTecnico.jsx` no la importa nadie: no se puede abrir.
- `/api/failures` no pide login.
- El estado `FALLA` lo limpia sin querer la configuración de equipos (`ConfigPrintersModal`
  solo conoce DISPONIBLE/MANTENIMIENTO/OCUPADO: al editar cualquier dato de una máquina en
  FALLA la guarda como DISPONIBLE) y la planificación solo descuenta capacidad de las que
  están en MANTENIMIENTO.
- El tablero de Planeación (`MachineControl.jsx`) ya bloquea soltar lotes en una máquina en
  FALLA, pero solo en la pantalla: el servidor no controla nada.
- No existe forma de avisarle a UN usuario interno: la campanita es decorativa, los avisos
  por socket llegan a todos y las notificaciones push son solo para clientes del portal.
  Sí hay email (Brevo/Resend) y la tabla `ConfiguracionGlobal` (clave-valor).
- Las fallas de impresión (`FallasProduccion.EquipoID`) casi nunca guardan la máquina: no
  sirven para "máquinas que más fallan". Este módulo cuenta sus propias solicitudes.

## 1. Quién usa qué

- **Cualquier usuario interno**: crea solicitudes (desde el botón de cada área o desde la
  pantalla de Servicio Técnico para PC/internet/software) y sigue las suyas.
- **Técnicos** (usuarios del área SERVICIO) y **Admin**: todo el módulo.
- **Encargado**: se elige con un selector que se guarda en la base (`ConfiguracionGlobal`,
  clave `ST_EncargadoId`); si no hay nadie elegido, se usa la variable de entorno
  `ST_ENCARGADO_USUARIO` (id o nombre de usuario). Recibe los avisos. Lo cambia un Admin o el
  encargado de ahora, para pasárselo a otro (29/09).

## 2. Solicitudes

**Datos de cada solicitud**
- Número (`ST-00001`), categoría: Máquina de producción · PC · Internet/red · Software ·
  Instalaciones (luz, aire, agua) · Otro.
- Máquina (si es de producción) o equipo/lugar en texto (ej. "PC de caja 2"), área.
- Título (sugerencias por categoría + texto libre), descripción, **prioridad** (Baja, Media,
  Alta, Crítica), **¿la máquina puede seguir trabajando?** (ver punto 3).
- **Fecha de solicitud** y **quién la pide**: el formulario pregunta quién reporta, con el
  usuario logueado ya elegido (hay tablets con usuario propio y otras compartidas — D4).
- **Fecha en que un técnico la tomó** y qué técnico.
- **Fecha de finalización** y **resultado**: Resuelta · Resuelta en parte · No resuelta ·
  Cancelada (duplicada / no corresponde).
- **Estado**: Pendiente → En curso → En espera (repuesto / proveedor / usuario) → Derivada →
  Finalizada.
- **¿Requiere seguimiento?** + fecha de seguimiento (aparece en el calendario) + nota.
- **Lo realizado** (texto).
- **Adjuntos**: fotos, capturas, PDF. Desde el celular abre la cámara.
- **¿Se necesitan repuestos?** + cuáles. Si se espera el repuesto, queda "En espera".
- Insumos usados (de la lista de insumos, punto 6).

**Derivaciones**: a otro técnico o a un servicio externo (texto: empresa/persona), con
**motivo obligatorio**. Se le avisa al técnico que la recibe y al encargado.

**Historial de cada solicitud**: todo cambio queda registrado con fecha y usuario (creada,
tomada, cambio de estado, derivada y por qué, comentario, adjunto, finalizada, reabierta).

**Lista / historial de fallas**
- Buscador por palabra: número, título, descripción, lo realizado, máquina/equipo, quién la
  pidió, técnico.
- Filtros: estado, categoría, prioridad, técnico, área, máquina, fechas.
- Incluye las finalizadas: es el historial de fallas.
- Tiempos por solicitud: respuesta (tomada − pedida), resolución (finalizada − pedida),
  parada de máquina.

## 3. Máquinas

- **Ficha**: estado (Operativa · Parada por falla · En mantenimiento), solicitudes
  abiertas, próximos mantenimientos, historial de fallas, historial de cambios.
- **Historial de cambios**: fecha, tipo (repuesto, cabezal, firmware/software,
  calibración, configuración, reubicación, alta/baja, otro), descripción, **motivo (por
  qué)**, técnico, solicitud relacionada, costo opcional, adjuntos.
- **Estado de la máquina (D3): se usa el que ya tiene** (`ConfigEquipos.Estado`, el de
  Configuración → Equipos: DISPONIBLE · MANTENIMIENTO · OCUPADO). Verificado 28/09:
  MANTENIMIENTO ya es "fuera de servicio" para la planificación (no suma capacidad, pedido
  del 25/08); OCUPADO sigue contando; FALLA (lo que escribe el reporte actual) no está en la
  lista, la configuración la pisa con DISPONIBLE al editar y la planificación la ignora.
  - Si la solicitud dice que la máquina **no puede trabajar** → pasa a MANTENIMIENTO.
  - Al finalizar, el técnico elige cómo queda (por defecto DISPONIBLE).
  - Desde la ficha, el técnico puede cambiar el estado con motivo (queda en el historial).
  - Se deja de escribir FALLA.
  - Propuesta a confirmar: el tablero de Planeación bloquea soltar lotes en MANTENIMIENTO
    igual que hoy con FALLA.

## 4. Mantenimientos

- **Creador de procedimientos**: título, a qué máquina o área aplica, pasos en orden con
  **tiempo estimado por paso** (el total se calcula solo). Ej.: "Limpieza de cabezales
  i3200": 1) purga — 5 min, 2) limpieza de capping — 15 min…
- **Planes**: máquina + procedimiento + cada cuánto (días/semanas/meses) + técnico por
  defecto. Cuando se realiza (o se da por no realizado) uno, se genera el siguiente.
- **Tareas puntuales**: trabajos que no se repiten (título, tiempo estimado, fecha,
  técnico). Van al mismo calendario.
- **Calendario semanal**: lunes a sábado, por técnico, con el tiempo estimado total de cada
  día. Muestra mantenimientos, tareas y seguimientos de solicitudes. Semana anterior /
  siguiente.
- **Estados**: Pendiente · Pospuesto · Vencido (pendiente con fecha pasada) · En curso ·
  Realizado · No realizado (con motivo) · Cancelado.
- **Posponer**: nueva fecha + motivo obligatorio; cuenta cuántas veces se pospuso y queda en
  el historial.
- **Tareas con tiempo estimado**: al generarse, el mantenimiento copia los pasos del
  procedimiento como lista para tildar; se registra quién hizo cada paso y el tiempo real.
- **Vista para técnicos ("Mi semana")**: tarjetas grandes para tablet/celular con lo de hoy
  y la semana — solicitudes asignadas, mantenimientos, tareas, seguimientos — y botones
  Tomar · Empezar · Terminar · Posponer · Foto.

## 5. Proyectos

- Título, descripción, responsable, estado (Planificado · En curso · En pausa · Terminado ·
  Cancelado), avance %, prioridad, fechas (inicio, estimada, fin), máquina opcional.
- **Historial**: avances con fecha, usuario, texto y adjuntos; cada cambio de estado o de
  avance queda registrado.

## 6. Insumos — del stock (D2)

- Los insumos y repuestos son los artículos de `/stock`. Se crea un depósito
  **"Servicio Técnico"** (tipo Sector) y los técnicos lo tienen como "Mi sector".
- Al usar un insumo en una solicitud, mantenimiento o proyecto se descuenta del stock
  (del depósito de Servicio Técnico u otro que se elija) como **consumo** con referencia a la
  solicitud: así también aparece en el gasto por sector de `/stock`.
- El módulo guarda cada uso con **fecha de uso**, cantidad, máquina, solicitud /
  mantenimiento / proyecto, técnico, y el **costo en ese momento** (el stock no lo guarda en
  el movimiento: lo calcula al leer con el costo actual).
- Solapa Insumos: stock del depósito de Servicio Técnico + historial de usos.
- Ojo (verificado): lo que llega a un sector por remito queda sin costo propio y se valoriza
  con el costo actual de la variante.

## 7. Reportes

- **Técnicos**: solicitudes tomadas, solucionadas, finalizadas, derivadas y los motivos de
  derivación; tiempo medio de respuesta y de resolución.
- **Máquinas que más fallan**: cantidad de solicitudes y horas de parada por máquina.
- **Operarios que más fallas reclaman** (decisión D4).
- **Reporte semanal** (pantalla + imprimir / guardar PDF, sin paquetes nuevos): proyectos
  (avances), tareas, mantenimientos (realizados / pospuestos / vencidos, estimado vs real),
  fallas (nuevas / finalizadas / abiertas por categoría), tiempos, insumos usados.

## 8. Avisos — dentro del sistema + push al celular (D1)

- **A quién**: al encargado; y al técnico al que se le asigna o deriva algo.
- **Cuándo**: solicitud nueva · derivación · mantenimiento vencido · seguimiento que vence
  hoy. Un job diario (node-cron, hora de Montevideo) revisa vencidos y seguimientos.
- **Dentro del sistema**: avisos por usuario guardados en la base; la campanita del menú
  superior (hoy decorativa, con un "3" fijo) pasa a mostrarlos con contador de no leídos, y
  llega un aviso emergente al momento. El socket se une a una sala por usuario validando el
  token (hoy todos los avisos internos llegan a todos).
- **Push al celular**: hoy solo existe para clientes del portal. Se agrega la suscripción de
  usuarios internos (tabla propia, botón "Activar avisos en este celular") y el service
  worker abre la pantalla interna al tocar el aviso. En iPhone, según las reglas de Apple,
  solo funciona con el sistema instalado en la pantalla de inicio.

## 9. Cómo se construye

- **Tablas nuevas** (prefijo `ST_`): `ST_Solicitudes`, `ST_Historial` (historial común de
  solicitudes, mantenimientos, proyectos y máquinas), `ST_Adjuntos`, `ST_CambiosEquipo`,
  `ST_Procedimientos` + `ST_ProcedimientoPasos`, `ST_Planes`, `ST_Trabajos` +
  `ST_TrabajoTareas` (mantenimientos y tareas del calendario), `ST_Proyectos`,
  `ST_InsumosUso` (cada uso: variante del stock, depósito, cantidad, costo del momento),
  `ST_TiposFalla` (sugerencias de título), `NotificacionesUsuario` y
  `PushSuscripcionesInternas` (avisos; sirven para cualquier módulo).
  Ids numéricos (`INT IDENTITY`): el id actual `T-` + 6 dígitos de la hora se repite.
- **Lo existente**: los tickets de `TicketsMantenimiento` se copian a `ST_Solicitudes`
  (quedan con su número viejo como referencia); `ReportFailureModal` pasa a usar la API
  nueva; `ServicioTecnico.jsx` (huérfana) se reemplaza. `ProyectosTecnicos` (sin uso) se
  deja de lado.
- **API** `/api/servicio-tecnico` con login (`verifyToken` + solo usuarios internos). Las
  acciones de técnico, solo Admin o área SERVICIO (`esAdminOServicioTecnico`, que ya
  existe). Se le agrega login a `/api/failures`.
- **Adjuntos** en disco: `ST_ADJUNTOS_PATH` (por defecto `backend/servicio-tecnico/<id>`),
  servidos por una ruta con login que valida que el id sea numérico y que el archivo quede
  dentro de la carpeta.
- **Pantalla** `/servicio-tecnico`: fila en `Modulos` + permisos por rol (script SQL para
  prod). Solapas: Solicitudes · Mi semana · Calendario · Máquinas · Proyectos ·
  Procedimientos · Insumos · Reportes. Los usuarios que no son técnicos ven solo "Nueva
  solicitud" y "Mis solicitudes".
- **Tiempo real**: evento de socket `st:updated`; las listas recargan con
  `useRecargaConFreno`.
- **Fechas**: `GETDATE()` como el resto del sistema (UTC en prod); "hoy" y las semanas se
  calculan en hora de Uruguay.

## 10. Etapas (cada una se puede deployar sola)

1. **Solicitudes** — HECHA 28/09 (sin deployar): todo el punto 2 + categorías PC/red/software +
   adjuntos + derivaciones + encargado y avisos (campanita por usuario + push interno) + login en
   `/api/failures` + copia de los tickets viejos. Se adelantó de la etapa 2 la parte de máquina parada
   ↔ producción: MANTENIMIENTO no recibe lotes (tablero, servidor, búsqueda automática de calandra,
   bandejas) y la solicitud cambia el estado. Script: `docs/servicio-tecnico/st-etapa1.sql`.
   Falta de la etapa 1: los insumos usados salen en la etapa 4 (por ahora "repuestos" es texto).
2. **Máquinas** — HECHA 28/09 (sin deployar): sección Máquinas (lista por área con resumen) y ficha
   (resumen, fallas, cambios, estados, ficha técnica); historial de cambios (tipo, fecha, qué, por qué,
   solicitud, costo, adjuntos; corregir = técnicos, borrar = Admin, todo anotado). Script
   `st-etapa2.sql` (ST_CambiosEquipo). Controller `stEquiposController.js`; helpers comunes en
   `backend/services/servicioTecnicoComun.js`.
3. **Mantenimientos** — HECHA 28/09 (sin deployar): procedimientos (pasos + tiempo), planes (cada N
   días/semanas/meses; siempre un trabajo abierto; al cerrar genera el siguiente), trabajos (mantenimiento
   o tarea, lista de tareas, posponer con motivo, empezar/terminar, parar la máquina), calendario
   semanal, "Mi semana", seguimiento hecho de solicitudes, job diario 07:30 (`jobs/servicioTecnico.job.js`).
   Script `st-etapa3.sql`. Controller `stMantenimientoController.js` + `services/stMantenimientoService.js`.
4. **Proyectos** con historial + **insumos** — HECHA 28/09 (sin deployar): `stProyectosController.js`,
   `stInsumosController.js` (egresarVenta del WMS, 'baja_consumo', RefTipo 'ST_USO'; costo guardado al
   usar; faltante → discrepancia), script `st-etapa4.sql`. Depósito de ST: ConfiguracionGlobal
   'ST_DepositoId' > env ST_DEPOSITO_ID > Mi sector. Pendiente: anular un uso.
5. **Reportes** — HECHA 28/09 (sin deployar): `stReportesController.js` (resumen por período y semanal),
   `ReportesVista.jsx` (imprimir/PDF solo el reporte); aviso de los lunes en el job.

**Estado 28/09:** las 5 etapas implementadas y probadas en local (205 pruebas, build OK), sin
deployar y sin ver en el navegador. Scripts en orden: `st-etapa1.sql` … `st-etapa4.sql` (la 5 no
tiene tablas). Pendientes conocidos: anular un uso de insumo; medir la parada con el historial de
estados de la máquina (hoy se mide por las solicitudes que la reportaron parada).

## Decisiones (28/09)

- **D1 — Avisos**: dentro del sistema + push al celular (punto 8).
- **D2 — Insumos**: del stock `/stock` (punto 6).
- **D3 — Máquina parada**: usar el estado que ya tienen las máquinas (punto 3). Falta
  confirmar el bloqueo de lotes en MANTENIMIENTO en el tablero de Planeación.
- **D4 — Operarios**: hay tablets con usuario propio y compartidas → el formulario pregunta
  quién reporta, con el usuario logueado ya elegido.

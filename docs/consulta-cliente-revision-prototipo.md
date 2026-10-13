# Revisión del prototipo "Consulta al Cliente" (carpeta `Desktop/xime`)

Fecha: 2026-09-02. Solo revisión: no se tocó código del sistema ni del prototipo.

## Qué hay en la carpeta

| Archivo | Qué es |
|---|---|
| `consulta_cliente_prototipo.jsx` (29/07) | Prototipo React autocontenido: vista operador (mock del modal Detalle de Orden) + vista cliente (mock del portal), estado en memoria, orden ficticia SUB-8157 / ZEUS. No hay `consulta.jsx`. |
| `CEREBRO_consulta_al_cliente.md` | Spec del módulo: modelo de datos, máquina de estados, SLA, canales, decisiones. Dice explícitamente que se diseñó **sin ver el código** (§8). |
| `files.zip` | Los mismos dos archivos. |
| `index.html`, `src/`, `vite.config.js`, `package.json` | Scaffold Vite para correr el prototipo (React 19, Tailwind 4, lucide 1.27). |

## §8 del CEREBRO, completada con los nombres reales

| Necesitaban saber | Respuesta (verificada en el código) |
|---|---|
| Componente del modal de detalle | `src/components/production/components/OrderDetailModal.jsx`. Botones por archivo en ~1284-1327: Editar (`startEditing`) y Cancelar Archivo (`startCancellingFile`). Íconos FontAwesome, no lucide. |
| Función que cancela un archivo | Front: `handleConfirmCancel` (OrderDetailModal ~1005) → `ordersService.cancelFile` → `POST /file/cancel` → `ordersController.cancelFile` (backend/controllers/ordersController.js:3349). Marca `EstadoArchivo='CANCELADO'`, guarda `MotivoCancelacionID`/`DetallesCancelacion`, recalcula magnitud, auto-cancela la orden si no quedan activos (vía `changeOrderState`, y cae la hermana TERMINAC), escribe `HistorialOrdenes`, resincroniza el ERP. |
| Función que cancela la orden | Mismo `handleConfirmCancel` con `cancelType` 'ORDER' → `ordersService.cancelOrder`; 'REQUEST' → `cancelRequest` (todo el pedido, todas las áreas). |
| Dónde vive el estado del archivo | `ArchivosOrden.EstadoArchivo varchar(50)`. Valores en uso (base local): `Pendiente`, `OK`, `FALLA`, `CANCELADO` (+ 3 residuales `Produccion`). Es un estado de **control post-impresión**, no una puerta de entrada a producción. |
| Stack | React 18.2 + Vite 7 + Tailwind 3.4 + lucide 1.14 (el prototipo usa React 19 / Tailwind 4 / lucide 1.27). Backend Node + Express + node-mssql (SQL Server). |
| Cómo se suben archivos | `uploadOrderFile` con multer `diskStorage` (se lee `file.path`, nunca `file.buffer`). Los archivos de referencia son filas de `ArchivosOrden` con `TipoArchivo`. Los tickets NO tienen adjuntos (`Tickets_Mensajes`: solo `TMenTexto`). |
| Canal de notificación al cliente | No existe una tabla genérica de notificaciones. Existen: (1) **Tickets** (`Tickets` + `Tickets_Mensajes`) con badge en el portal (`MainLayout.jsx` ~105-140, `TicEstado === 3` = esperando respuesta, socket `join:ticket`); (2) **push** `pushNotificationService.sendToOrderClient(orderId, {title, body, url, tag, actions, actionUrls})` con botones de acción; (3) email por `emailService.js` (Resend). WhatsApp solo para avisos de depósito. |

## Lo que el prototipo asume y el sistema no hace así

1. **La producción se planifica por ORDEN, no por archivo.** La orden entra a un lote (`Ordenes.RolloID / MaquinaID / Secuencia`) y se imprimen todos sus archivos juntos. No hay ningún punto donde un archivo individual "no entre a producción". La decisión central del CEREBRO (§10, fila 1: consulta por archivo que no frena a los demás) no tiene dónde apoyarse: el único freno real es a nivel orden.
2. **Un valor nuevo `EN_CONSULTA` en `EstadoArchivo` toca 56 lugares.** Hay 56 líneas en el backend que filtran `EstadoArchivo` por literal (productionFileController, pedidoCompletoService, rollsController, fileProcessingService, LabelGenerationService, inventoryController, erpSyncService, zombie job, etc.). Cada una tendría que decidir qué hace con el valor nuevo (¿cuenta como activo?, ¿como pendiente?, ¿como controlado?).
3. **El hold a nivel orden ya existe y es exactamente la "consulta general".** `Ordenes.AprobacionPendiente` (bit) + `FechaAprobacionCliente` + `FechaRechazoCliente`:
   - Operador: botón "Enviar a aprobación del cliente" en OrderDetailModal (~768-789) → `ordersController.enviarAprobacionTPU` (:636). Deja `AprobacionPendiente=1, Estado='Pendiente', EstadoenArea='Esperando'`.
   - Cliente: `webOrdersController.aprobarPedido` (:2772) y `rechazarPedido` (:2873, motivo obligatorio). UI en `FactoryView.jsx` (`pendientesAprobacion`, ✓ aprobar, modal de rechazo).
   - Tablero: `ProductionTable.jsx` (~186-201) pinta Esperando / Aprobado / Rechazado.
   - El job de zombies respeta el hold.
   - Hoy está limitado a `AreaID='TPU'` (devuelve 400 si no) y exige un archivo "boceto". Generalizarlo a todas las áreas + agregar mensaje, motivo y fotos es el módulo pedido, con la máquina de estados, el portal, el badge y el historial ya resueltos.
4. **`ESPERANDO_CONSULTA` no necesita columna nueva.** El estado de orden se deriva de `EstadoenArea` (catálogo `ConfigEstados`, padre `Estado`). El hold TPU usa `'Esperando'` (no está en el catálogo local; en prod no lo verifiqué) y el catálogo tiene `Retenido` (ID 35, ámbar). Coincide con la regla del CEREBRO de que el estado sea derivado.
5. **Los motivos van en tabla, no en enum.** El sistema ya tiene `MotivosCancelacion` (MotivoID, Titulo, DescripcionDefault, flags por área). El motivo de consulta sería un catálogo hermano, no un array en el JSX.
6. **Fotos:** no hay ningún upload de imágenes para mensajes al cliente. Habría que reusar `uploadOrderFile` con un `TipoArchivo` propio (varchar(10)) o crear un endpoint chico.

## Nits del prototipo (no bloquean nada)

- Si el operador destilda "Frenar la producción", el archivo igual pasa a `EN_CONSULTA` (`enviarConsultaArchivo`): el flag `bloqueaProduccion` se guarda pero no cambia nada.
- `cancelarArchivo` dispara el toast dentro del updater de `setArchivos` (efecto secundario en updater; en StrictMode se duplica).
- Stack distinto al del sistema (React 19 / Tailwind 4 / tokens hex hardcodeados / lucide vs FontAwesome en el modal real): el JSX no es transplantable, sirve como spec visual.
- Sin `backdrop-blur` (correcto para la casa).

## Recomendación

No portar el JSX. Tomar el CEREBRO como spec y ajustar dos decisiones al sistema real:

- **Consulta general de orden** = generalizar el hold `AprobacionPendiente` a todas las áreas, con una tabla `ConsultasCliente` (orden, archivo opcional, motivo, mensaje, fotos, respuesta, comentario, fechas) colgada del mismo flujo `enviar → aprobarPedido / rechazarPedido`. Aviso al cliente por el badge del portal + push con `actions`. Esto es la parte de bajo riesgo.
- **Consulta por archivo**: registrar a qué archivo se refiere (para la evidencia y el reporte por motivo), pero el freno sigue siendo la orden. Si el cliente cancela ese archivo, llamar a `cancelFile` (regla §8 del CEREBRO, que ya existe con la auto-cancelación de la orden). No inventar `EN_CONSULTA` en `EstadoArchivo`.

Pendiente de definir con el usuario antes de planificar: si en v1 se quiere la consulta por archivo o solo la general, y si el SLA/recordatorios (§6) entran o quedan para después.

# Spec 39 — Fallas, Faltantes y Entregas Parciales entre Áreas

> Cómo un Pedido con Órdenes en varias áreas sigue avanzando cuando una de ellas tiene una
> falla, cómo cualquier área reporta lo que le falta y dónde nace la reposición, y qué pasa
> cuando el insumo dañado no lo fabrica producción (tela o prenda del cliente, producto del
> local). Extiende Spec 02 §8 (fallas y reposiciones), Spec 03 (producción) y Spec 04 §4–5
> (remitos y pedido completo). Estado: **to-be**, pendiente de aprobación (borrador 1.0,
> 3 de setiembre de 2026). El documento de aprobación con las pantallas se entrega aparte.

## 1. Propósito y alcance

Un Pedido grande (un juego deportivo) se fabrica con una Orden por Área encadenadas:
Sublimación → Corte → Costura → Bordado → Estampado → Depósito. Hoy una falla en un área
detiene la cadena entera: nada de esa Orden sale hacia la siguiente Área hasta que la
reposición termina, la siguiente Área no ve qué le falta ni cuándo llega, y las áreas de
bandeja (Corte, Costura, Bordado, Estampado) no pueden reportar una falla. Cuando el insumo
dañado es del cliente o del local, no existe circuito.

Esta spec define cinco cosas:

1. **Envío parcial entre Áreas**: lo que ya está bien avanza mientras la falla se repone.
2. **Libro de Entregas por Orden**: esperado, enviado, recibido y pendiente, con motivo.
3. **Faltante**: una falla reportada desde cualquier Área cuya reposición nace en el Área
   que produce el insumo, encadenada hasta el Área que reportó.
4. **Solicitud de Insumo**: el circuito cuando lo dañado es del cliente o del local.
5. El **candado de Depósito** medido sobre el Libro de Entregas.

Fuera de alcance: la Reposición de cliente (Spec 02, RN-PED.24) no cambia; los mensajes de
WhatsApp (Spec 10) no cambian.

## 2. Conceptos

| Concepto | Definición |
|---|---|
| **Orden madre** | La Orden original de un Área dentro de un Pedido. Las reposiciones cuelgan de ella. |
| **Libro de Entregas** | Por Orden: la lista de envíos (cuándo, en cuántos Bultos, cantidad si se conoce, y si completa la Orden) y las Reposiciones abiertas con su estado real. "Incompleta" es una Orden con un envío parcial sin cerrar o con una Reposición abierta: es un motivo, no un número. Única fuente de verdad para el Área siguiente, la Hoja de Ruta y Depósito. |
| **Envío parcial** | Remito que lleva parte de una Orden, con el motivo del pendiente (falla en proceso o resto en producción) y la cantidad **por Orden** cuando se conoce, en la unidad de la Orden. Solo hacia otra Área productiva. |
| **Complemento** | Envío posterior que completa una Orden ya enviada en parte. Puede venir de la madre (resto en producción) o de una Reposición. |
| **Faltante** | Falla reportada sobre un insumo que vino de un Área anterior. |
| **Cadena de reposición** | Órdenes de falla encadenadas en las Áreas anteriores a la que reportó, desde la primera que produce el insumo hasta la inmediata anterior. |
| **Solicitud de Insumo** | Alerta a Atención al Cliente y Administración cuando el insumo dañado es tela o prenda del cliente, o un producto del local, y producción no lo puede reponer. |
| **VEN interna** | Venta directa a precio cero, marcada como reposición por falla: descuenta stock, no genera deuda ni factura, no aparece en la cuenta del cliente. |
| **Parcial aceptado** | Cierre de una Solicitud cuando el cliente decide llevarse solo lo producido: la Orden se redimensiona y la cotización se recalcula. |

## 3. Envío parcial entre Áreas

- **RN-FLT.01** **Envío parcial.** Un Área puede despachar a la siguiente parte de una
  Orden aunque el resto siga en proceso, haya o no una falla de por medio. En el Remito se
  declara por Orden el motivo del pendiente y, cuando se conoce, la cantidad en la unidad de
  la Orden. **El Bulto no lleva cantidad**: en Sublimación no es posible decir cuánto va en
  cada bulto; lo que importa es "van cuatro bultos y queda una falla en proceso". El Remito sigue siendo por destino: si se
  seleccionan Bultos con distintos destinos se genera un Remito por destino, como hoy, y la
  cantidad se declara por Orden dentro de cada uno.
- **RN-FLT.02** **Cantidad cuando se conoce.** En las Áreas que cuentan prendas o unidades
  (Corte en adelante) la cantidad del envío se declara siempre y nunca supera lo esperado
  menos lo ya enviado. En Sublimación es opcional: si se imprimieron los 60 metros y
  calidad detecta una falla, nadie sabe cuántos metros son hasta reimprimir y medir. Lo
  obligatorio es el motivo del pendiente: falla en proceso (con su Orden) o resto en
  producción.
- **RN-FLT.03** **La Orden viaja con el último envío.** Pasa a "en tránsito" recién con el
  envío marcado "completa la Orden". La marca la pone el operario en el último Remito; el
  sistema la propone cuando no queda ninguna Reposición abierta para esa Orden y no la
  acepta mientras quede alguna. Mientras tanto la Orden queda en su Área con envío
  "parcial", y sus Bultos ya enviados están en el Área destino. La Orden madre "retenida" por una falla
  puede igual enviar parcialmente lo que ya está bien. Lo mismo vale cuando la falla
  pendiente está en un Área anterior (reposición por faltante en curso): el Área sigue
  despachando en parcial lo que termina; solo Depósito exige el Libro en cero.
- **RN-FLT.04** **Libro de Entregas.** Cada Orden lleva su lista de envíos (fecha, Bultos,
  cantidad si se declaró, y si completa la Orden) y sus Reposiciones abiertas con el estado
  real de cada una. Mientras una Reposición esté en proceso, la Orden está incompleta aunque
  nadie sepa todavía cuántos metros son; la cantidad de la Reposición aparece cuando se
  imprime y se mide. El Libro se ve desde el Área destino (qué le falta a este Pedido y
  dónde está), desde la Hoja de Ruta y desde Depósito.
- Un envío parcial **nunca** tiene destino Depósito (INV-FLT.01). Hacia Depósito rige el
  pedido completo de siempre (Spec 04, RN-LOG.10 y RN-LOG.12).

## 4. Faltantes y cadena de reposición

- **RN-FLT.05** **Faltante.** Es una falla reportada sobre un insumo que vino de un Área
  anterior. Se reporta con el mismo gesto que una falla y desde **cualquier** Área
  productiva, incluidas las de bandeja (Corte, Costura, Bordado, Estampado). Motivo
  obligatorio; foto opcional. Cuando el insumo es tela, quien reporta elige de qué archivo
  de la Orden madre viene lo que falta y detalla las piezas (cantidad, parte, talle).
- **RN-FLT.06** **Primero mirar, después reportar.** Antes de crear un faltante, el sistema
  muestra lo pendiente del Pedido según el Libro (qué falta, dónde está, en qué estado) y
  obliga a confirmar que el faltante no es eso. Si es eso, no se crea nada.
- **RN-FLT.07** **Cadena hacia atrás.** El sistema reconstruye la secuencia de Áreas del
  Pedido a partir de sus Órdenes hermanas y propone una Orden de falla en cada Área
  anterior, desde la primera que produce el insumo hasta la inmediata anterior a la que
  reporta, encadenadas: cada una se libera cuando recibe la anterior. Cada Orden de falla nace
  **Pendiente** en su Área, como cualquier falla de hoy. En las Áreas que cuentan prendas la
  cantidad se declara; en Sublimación la Orden nace **sin metros**, con el archivo de origen
  que eligió quien reportó, el detalle de piezas y la foto: los metros aparecen al imprimir y
  medir, igual que hoy. El archivo de reimpresión se sube después desde el detalle de la
  Orden (quién lo arma está pendiente de definir). Es una oferta: el operario decide crearla. **Del Área que reporta en
  adelante no se crea ninguna Orden**: la Orden que reportó queda retenida y sigue
  trabajando con lo que tiene.
- **RN-FLT.08** **La reposición viaja como complemento.** Una Orden de falla nunca va sola
  en un Remito. Su material sale como complemento de la Orden madre en el Libro. Esto
  mantiene RN-PED.25 (la falla se cierra en su canasto y su material se incorpora a la
  madre) y lo extiende al caso en que la falla nació en otra Área.
- Cada Reposición guarda su vínculo explícito: Orden madre, Orden de falla, Área que
  produce, Área que reportó, cantidad, unidad, motivo, foto y estado. Ese vínculo alimenta
  el Libro; el sufijo del código deja de ser la única relación.

## 5. Origen del insumo dañado

- **RN-FLT.09** **Detección del origen.** El sistema detecta solo el origen del insumo
  porque ya está en la Orden: fabricación propia, tela del cliente (bobina asociada),
  prenda del cliente (paquete asociado) o producto del local (artículo de stock asociado).
  Según el origen:
  - **Fabricación propia** → cadena de reposición (RN-FLT.07).
  - **Producto del local** → **VEN interna** sin costo para el cliente por la cantidad
    dañada: descuenta stock, no genera deuda ni factura. El producto nuevo llega al Área como
    complemento de la Orden madre. Si no hay stock, se abre una Solicitud de compra para
    Administración. La pérdida queda registrada con motivo y foto.
  - **Tela o prenda del cliente** → **Solicitud de Insumo**, sin crear ninguna Orden.
- **RN-FLT.10** **Solicitud de Insumo.** Cae en una bandeja que ven Atención al Cliente y
  Administración, con la Orden, el cliente, la cantidad que falta, el motivo y la foto.
  Al abrirse, el sistema busca si hay **stock de esa tela o prenda de ese cliente** (otras
  bobinas o paquetes del mismo cliente y del mismo insumo con cantidad disponible) y lo
  muestra en la Solicitud. Atención al Cliente analiza, informa al cliente **por el portal**
  con ese dato y, si hay stock, le pide confirmación para usarlo; nada es automático y nada
  va por WhatsApp. La Orden queda retenida hasta la decisión.
- **RN-FLT.11** **Decisión sobre el insumo del cliente.** Cuatro salidas, siempre con usuario,
  fecha y cómo la confirmó el cliente:
  - **(a) Usa el stock de su propia tela o prendas**: solo si hay stock y el cliente lo
    confirma. La Orden de falla se crea con esa bobina o paquete existente, sin PRE. La
    Solicitud se resuelve; la Orden madre se libera cuando la reposición termina.
  - **(b) Trae más tela o prendas**: al ingresar la nueva PRE se la vincula a la Solicitud y
    **recién ahí** se crea la Orden de falla con esa bobina o prenda nueva. La Solicitud se
    resuelve; la Orden madre se libera cuando la reposición termina.
  - **(c) Acepta llevarse solo lo producido**: la Orden se redimensiona a lo producido, la
    cotización se recalcula con el mismo precio unitario y se cobra lo real; la falla queda
    registrada sin costo; la Solicitud se cierra como "parcial aceptado"; la Orden queda
    completa y el Pedido cuenta como completo.
  - **(d) Administración compra el insumo**: ingresa como PRE y sigue el camino (b).
  - Si no hay stock, el cliente elige entre (b) y (c).
- Si el cliente no responde en un plazo configurable, la Solicitud pasa a "sin respuesta"
  para que Administración la resuelva (plazo pendiente de aprobación, propuesta 7 días).

## 6. Candado de Depósito

- **RN-FLT.12** Un Pedido solo se despacha o recibe en Depósito cuando **cada** Orden tiene
  su último envío marcado "completa la Orden" y no queda ninguna Reposición ni Solicitud
  abierta en toda la cadena. Se suma a las condiciones actuales de pedido completo global
  (estados de las hermanas) y de conteo físico de Bultos (Spec 04, RN-LOG.12 y RN-LOG.13).
- La vista "Esperando bultos" de Depósito muestra, además de los Bultos, qué Órdenes están
  incompletas y por qué: qué Reposición, en qué Área y en qué estado. Cuando no queda nada
  abierto, el Pedido se libera solo.

## 7. Invariantes

- **INV-FLT.01** A Depósito nunca llega una Orden incompleta: con envío parcial sin cerrar o
  con una Reposición abierta. "Forzar ingreso" queda solo para Bultos físicos extraviados
  con el Libro completo.
- **INV-FLT.02** Una reposición interna nunca tiene costo para el cliente y nunca viaja sola.
- **INV-FLT.03** No nacen Órdenes nuevas en el Área que reporta un faltante ni en las
  siguientes.
- **INV-FLT.04** Con insumo del cliente no se crea ninguna Orden hasta que exista la PRE
  nueva vinculada a la Solicitud.
- **INV-FLT.05** Ningún envío se marca "completa la Orden" mientras esa Orden tenga una
  Reposición abierta. En las Áreas que cuentan prendas o unidades, la cantidad enviada nunca
  supera la esperada.
- **INV-FLT.06** Redimensionar una Orden por parcial aceptado siempre recalcula la
  cotización antes de liberar el Pedido a Depósito.

## 8. Ciclos de vida

| Objeto | Estados | Transiciones |
|---|---|---|
| Orden madre · envío | sin enviar → parcial → completo | A "parcial" con el primer envío sin la marca; a "completo" con el envío marcado "completa la Orden", y recién ahí la Orden pasa a "en tránsito". La marca no se acepta con Reposiciones abiertas. Un envío parcial nunca tiene destino Depósito. |
| Orden madre · producción | como hoy: retenida / con falla mientras tenga una falla, un faltante o una Solicitud abierta | Retenida no bloquea el envío parcial de lo bueno. Se libera al recibir el complemento o al cerrar la Solicitud. |
| Reposición | propuesta → en producción → enviada → recibida → cerrada; bloqueada mientras espera la anterior de la cadena | Nace en el Área que produce. Cerrada cuando su material llega al Área que reportó. |
| Solicitud de Insumo | nueva → en análisis → notificada por portal → resuelta (trae insumo / parcial aceptado / compra Administración) / sin respuesta | Mientras esté abierta no existe Orden de falla. Se resuelve por la PRE nueva o por la aceptación del parcial. |
| Pedido | como hoy: completo en Área / completo global | Completo global exige además Libro en cero y ninguna Reposición ni Solicitud abierta. |

## 9. Reglas existentes que se modifican

| Regla | Dice hoy | Pasa a decir |
|---|---|---|
| RN-PED.25 | La falla la declara el operario en el control del archivo y nace en la misma Área. | La falla se declara desde cualquier Área productiva y puede nacer en un Área anterior cuando es un faltante. |
| RN-LOG.10 | Despacho por pedido completo en Área; el parcial es una excepción configurada por Área, por Bultos enteros. | Hacia destinos intermedios el parcial es la regla, con cantidad declarada por Orden. Hacia Depósito no cambia. |
| RN-LOG.13 | "Esperar bultos" cuenta Bultos físicos, solo en Depósito. | La espera se mide por el Libro de Entregas en cada Área y en Depósito, además del conteo físico de Bultos. |

## 10. Actores

| Actor | Qué hace en esta spec |
|---|---|
| Operario de Área con control de archivo | Reporta la falla, envía parcialmente lo bueno, envía el complemento cuando la reposición termina. |
| Operario de bandeja | Ve qué le falta a su Pedido y dónde está; reporta falla o faltante con el mismo botón; confirma la cadena propuesta; sigue trabajando con lo que tiene. |
| Atención al Cliente | Recibe las Solicitudes de Insumo, decide si notifica por el portal, registra la decisión del cliente (trae insumo / acepta parcial). |
| Administración | Ve las mismas Solicitudes, resuelve compras, ve las pérdidas internas registradas. |
| Recepción (PRE) | Ingresa la tela o prenda nueva vinculándola a la Solicitud; esa vinculación crea la Orden de falla. |
| Depósito | Ve qué Órdenes están incompletas y por qué; no puede forzar el ingreso con Reposiciones abiertas o envíos sin cerrar. |
| Cliente | Recibe la notificación por el portal y decide: trae más o acepta la entrega parcial. |

## 11. Puntos de interacción (contrato, no diseño)

- **Crear Remito** muestra, por cada Orden seleccionada, si es envío parcial y por qué
  (Reposiciones abiertas con su estado, o resto en producción), la cantidad de este envío
  cuando se conoce, y la marca "este envío completa la Orden" (propuesta sin Reposiciones
  abiertas, bloqueada con alguna). Confirma con el texto exacto: qué va, qué queda en
  proceso, y que la Orden no pasa a "en tránsito" hasta el envío que la complete. Sigue
  armando un Remito por destino.
- **Bandeja del Área** muestra "lo que falta de este Pedido": por cada Orden que la
  alimenta, recibido / pendiente / motivo / Área / estado / desde cuándo, y el botón
  "Reportar falla / faltante" en todas las Áreas productivas.
- **Reportar falla / faltante** en tres pasos: (1) lo pendiente del Libro, con "¿lo que te
  falta es esto?"; (2) tipo, cantidad en la unidad del Área, archivo de origen de la Orden
  madre, detalle de piezas, motivo, nota, foto, y el origen detectado; (3) las reposiciones
  propuestas por Área (Pendientes, sin metros en Sublimación) y la leyenda de que de esta
  Área en adelante no se crea nada.
- **Solicitudes de Insumo** (bandeja de Atención al Cliente y Administración): estado,
  origen, Orden, cliente, cantidad, motivo, foto; acciones "Notificar al cliente por el
  portal", "Registrar decisión", "Ver orden".
- **Ingreso de PRE** ofrece "¿repone una Solicitud abierta?" y explica qué Orden de falla se
  va a crear con esa bobina.
- **Registrar decisión · parcial aceptado** muestra cantidad pedida → producida, cotización
  actual → nueva y precio unitario, y cómo confirmó el cliente.
- **Depósito** muestra el motivo exacto del bloqueo: qué Orden está incompleta, por qué
  Orden de falla o envío sin cerrar, en qué Área y estado, y la cantidad si se conoce.

## 12. Interacciones

| Módulo | Interacción |
|---|---|
| Pedidos (Spec 02) | Extiende RN-PED.25; conserva RN-PED.26 (costo 0) y RN-PED.24 (reposición de cliente sin cambios). |
| Producción (Spec 03) | Botón de falla en las bandejas; Orden retenida que igual envía parcial; cadena de reposiciones encadenadas por liberación. |
| Logística (Spec 04) | Línea por Orden en el Remito con motivo, cantidad opcional y marca "completa la Orden"; Libro de Entregas; pedido completo global sobre el Libro; "esperar bultos" con el motivo de lo incompleto. |
| Recursos del cliente (Spec 07) | PRE vinculada a una Solicitud crea la Orden de falla con la bobina o prenda nueva. |
| Stock y tienda (Spec 08) | VEN interna a precio cero por producto del local dañado; Solicitud de compra si no hay stock. |
| Precios (Spec 09) | Recotización por parcial aceptado con el mismo precio unitario. |
| Portal y notificaciones (Spec 10) | Notificación al cliente por el portal, decidida por Atención al Cliente; WhatsApp sin cambios. |
| Trazabilidad (Spec 13) | Toda decisión sobre una Solicitud queda con usuario, fecha y medio de confirmación. |

## 13. Decisiones pendientes de aprobación

1. "Forzar ingreso" en Depósito no puede saltear pendientes del Libro.
2. Atención al Cliente registra la decisión del cliente, con usuario, fecha y medio.
3. Plazo de espera de una Solicitud antes de pasar a "sin respuesta": configurable,
   propuesta 7 días.
4. Quién arma y sube el archivo de reimpresión de una Orden de falla nacida en Sublimación
   por un faltante de otra Área (PRO, Diseño o el operario de Sublimación).

## 14. Estado de implementación (2026-09-10)

Implementado y probado contra la base LOCAL (33/33 escenarios automáticos: 3 baterías
`test-f1.js`, `test-f3.js`, `test-f5.js` con datos sintéticos, limpiados al final). **Sin
desplegar a producción** — switches por Área apagados por defecto
(`AREAS_DESPACHO_PARCIAL`, `AREAS_CADENA_REPOSICION`) hasta que se elija el piloto.

- **Modelo de datos**: `docs/migrations/fallas_faltantes_parciales.sql` — tablas
  `Logistica_EnvioOrdenes`, `Reposiciones`, `SolicitudesInsumo`; columnas nuevas en
  `Ordenes` (`OrdenOrigenID`, `EstadoEnvio`, `CantidadEsperada`); vista `vw_LibroEntregas`;
  configuración y `TiposFallas` de bandeja. Aplicado y probado en local.
- **Menú**: `docs/migrations/fallas_faltantes_parciales_menu.sql` — módulo "Solicitudes de
  insumo" bajo Atención al Cliente (`IdPadre 29`), permisos para Admin, Administración,
  Coordinador y Atención al Cliente. Aplicado en local.
- **Piloto**: `docs/migrations/fallas_faltantes_parciales_piloto.sql` — activa
  `AREAS_DESPACHO_PARCIAL` / `AREAS_CADENA_REPOSICION` solo para las Áreas que se editen en
  el script (sugerido: Corte Láser y Taller Costura). Sin correr en producción.
- **Backend**: `services/linajeOrdenesService.js`, `services/libroEntregasService.js`,
  `services/reposicionesService.js`, `services/solicitudesInsumoService.js`,
  `services/cadenaReposicionService.js` (creación de Órdenes de falla, compartida por el
  reporte directo y por las Solicitudes de insumo); `controllers/libroEntregasController.js`,
  `controllers/fallaBandejaController.js`, `controllers/solicitudesInsumoController.js`;
  cambios en `controllers/logisticsController.js` (candado de Depósito, líneas por Orden,
  complementos), `controllers/embBoardController.js` y `controllers/productionFileController.js`
  (falla propia que se incorpora sin viajar), `controllers/receptionController.js` (PRE que
  repone una Solicitud), `controllers/quotationController.js` (recotización del parcial
  aceptado); `jobs/solicitudesInsumo.job.js` (Solicitudes vencidas sin respuesta, 07:00 hs).
- **Frontend**: `DispatchView.jsx` (envío parcial por Orden), `EmbBandeja.jsx` +
  `ReportarFallaModal.jsx` + `PendientesPedidoPanel.jsx` (reportar desde la bandeja),
  `SolicitudesInsumoPage.jsx` (bandeja de Atención al Cliente / Administración, nueva),
  `ReceptionPage.jsx` ("¿repone una Solicitud abierta?" al cargar una PRE).
- **Sin implementar**: preguntas de la sección 13 (quién sube el archivo de reimpresión
  cuando la falla nace en otra Área — hoy se sube desde el detalle de la Orden, sin
  restricción de rol); interfaz para editar `PLAZO_SOLICITUD_INSUMO_DIAS` desde el panel de
  configuración (hoy solo por SQL).
- **Pendiente antes de producción**: correr los tres scripts de arriba en ese orden, hacer
  el `git commit` (no incluido: instrucción del usuario), probar en el Área piloto elegida
  con datos reales y recién entonces habilitar más Áreas.

## 15. Extensión: "Aprobar Control por tandas" (10-sep-2026)

Al probar Corte Láser en vivo, surgió un caso que la spec original no cubría: el operario
controla parte de las prendas (ej. 10 de 30) y quiere mandarlas a la siguiente área
**sin terminar de cortar el resto de la misma orden**. Antes de esto, "Aprobar Control"
exigía el 100% del conteo antes de generar cualquier bulto.

- **Dónde**: paso de Control y Calidad de la bandeja (EMB, EST, TWC, TWT), botón nuevo
  "Aprobar esta tanda" junto al "Aprobar Control" de siempre.
- **Cuándo aparece**: solo en áreas con envío parcial habilitado
  (`ConfiguracionGlobal.AREAS_DESPACHO_PARCIAL`, el mismo interruptor del resto de Spec 39)
  y solo si hay unidades controladas todavía no aprobadas en ninguna tanda anterior.
- **Qué hace**: genera bultos para lo controlado desde la última tanda, la orden **no** pasa
  a Pronto — vuelve a su estado de trabajo (En Máquina o Pendiente) para seguir controlando
  el resto. La aprobación final (100% controlado) sigue funcionando exactamente igual que
  antes: pasa a Pronto, cierra la reposición si es una orden de falla, corre la lógica de
  hermanas de Estampado.
- **Modelo de datos**: columna nueva `Ordenes.CantidadAprobadaBultos` (cuánto ya se aprobó en
  bultos, acumulado) — `docs/migrations/fallas_faltantes_control_parcial.sql`.
- **Backend**: `controllers/embBoardController.js` (`aprobarControl` acepta `parcial: true`).
- **Frontend**: `EmbBandeja.jsx` (botón + confirmación explícita con la cantidad y lo que
  queda pendiente).
- **Probado**: `test-control-parcial.js` (13/13 OK) — tanda 1 (10 de 30), reintento sin
  conteo nuevo rechazado, tanda 2 (15 más), cierre final (5 más) igual que siempre, área sin
  el interruptor rechazada. Regresión F3 corrida de nuevo completa porque esta función
  también cierra las órdenes de falla.

## 16. Extensión: validaciones cruzadas entre contadores (10-sep-2026)

Con "aprobar por tandas" (sección 15), surgió un riesgo nuevo: los tres contadores de una
orden en la bandeja (Trabajo, Control, y lo que declaró el remito) son independientes entre
sí, y ninguno se comparaba contra el anterior. Un operario podía declarar más prendas
controladas que las trabajadas, o más trabajadas que las que realmente llegaron del área
anterior — inflando bultos y remitos con cantidades que no existen físicamente.

Dos candados nuevos, ambos con `git blame` en `embBoardController.js` (10-sep-2026):

- **Control ≤ Trabajo**: `setProgresoControl` y `setAvanceArchivo` (Corte, por tizada) no
  dejan declarar más prendas/piezas controladas que las que Trabajo marcó como hechas para
  esa misma orden o tizada.
- **Trabajo ≤ recibido del área anterior**: `setProgreso` y `setAvanceArchivo` no dejan
  cargar más avance que lo que realmente llegó del área inmediatamente anterior del pedido
  (`embBoardController.getRecibidoDeAreaAnterior`, basado en
  `libroEntregasService.getPendientesParaArea`). Antes de cualquier envío, "recibido" es 0
  (bloquea). Si el área anterior no declara cantidad en una unidad comparable (ej.
  Sublimación mide metros, Corte cuenta piezas), no hay con qué comparar y se deja pasar
  como antes.

Probado con `test-validaciones-cruzadas.js` (13/13 OK): bloqueo con 0 recibido, aceptación
exacta, rechazo por exceso (Trabajo y Control), y el caso de unidad no comparable (SB→Corte)
sigue sin bloquear. Regresión completa (F1/F3/F5/control-parcial) + build de producción en
verde después del cambio.

## 17. Extensión: Control de Pedidos en PRO (10-sep-2026)

Encontramos que la pantalla "Control de Pedidos — PRO" (Fase 6, previa a Spec 39, no
relacionada originalmente) usa su propio criterio de "pedido completo" —
`isPedidoCompletoFisicamenteEnArea`, que solo mira si los bultos de los componentes están
físicamente en PRO— sin ninguna noción de Reposiciones ni del libro de entregas. Un pedido
podía figurar "listo para controlar" en PRO con una reposición abierta en una etapa muy
anterior de la cadena (ej. una falla de Sublimación) que nunca pasa por PRO.

El candado real de Depósito (`validarLibroParaDeposito`, dentro de `createRemito`) seguía
funcionando — el remito final PRO→Depósito se rechazaba igual — pero recién ahí, DESPUÉS de
generar la etiqueta final y consumir los bultos de los componentes, dejando al operador con
un mensaje genérico ("el remito no se pudo armar, armalo a mano") sin explicar el motivo real.

Arreglado en `logisticsController.js` (`getPedidosCompletosPRO`, `aprobarControlPRO`):

- `getPedidosCompletosPRO` ahora también corre `ordenesIncompletasPedido` (el mismo chequeo
  del libro que usan las demás bandejas) por cada pedido candidato y expone
  `libroIncompleto` + `motivosLibro` (qué orden, qué área, qué motivo).
- `aprobarControlPRO` corta ANTES de generar la etiqueta final o consumir los bultos de los
  componentes cuando el libro está incompleto, con el mismo tipo de mensaje detallado que
  usa el resto de Spec 39.
- Magnitud efectiva (no la columna cruda) para los componentes de bandeja (Bordado,
  Estampado, Corte, Costura) — mismo fix que en la sección 15/16, reusa
  `embBoardController.getMagnitudEfectiva`.
- Frontend (`ControlPedidosPRO.jsx`): pill "Incompleto en el libro", panel expandido con el
  detalle, y el botón "Aprobar Control" queda deshabilitado con el motivo en el tooltip —
  mismo criterio de claridad que las demás bandejas.

**Nota de higiene**: al verificar este fix se generó por error una etiqueta final duplicada y
se consumió el bulto de un componente real (efecto de correr `aprobarControlPRO` directo en
una prueba manual); se revirtió a mano antes de cerrar (bulto final borrado, bulto del
componente devuelto a `EN_STOCK`/`PRO`). Sirve de recordatorio: este endpoint tiene efectos
secundarios reales (genera etiqueta, consume bultos) incluso cuando el remito final falla —
cualquier prueba futura contra él en la base local debe hacerse dentro de una transacción o
revertirse explícitamente después.

## 18. Extensión: subir el archivo de reimpresión en órdenes de falla (10-sep-2026)

Cierra la última pregunta abierta de la sección 13 ("quién arma y sube el archivo de
reimpresión"): no existía NINGÚN botón de subida interna en el detalle de la orden para
áreas de impresión estándar (Sublimación, DTF, Eco UV) — solo TPU, PRO y la matriz de
Bordado tenían uno. Los archivos de esas áreas siempre venían del portal del cliente; nadie
interno necesitaba subir uno a mano hasta ahora.

- **Referencia del original**: cuando la orden es de falla (código `-F#`), el detalle ahora
  muestra también el archivo de la orden madre (de solo lectura, etiquetado "Original
  (madre)") — mismo mecanismo que ya usaban las reposiciones de cliente (`-R#`), extendido a
  `-F#`. El operario lee ahí las copias y dimensiones originales para igualarlas.
- **Botón de subida nuevo**: en `OrderDetailModal.jsx`, visible solo para órdenes `-F` en
  áreas que no son PRO/TPU/EMB (que ya tienen su propia subida). Pide las copias a mano
  (no se pueden leer del PDF) y sube el archivo con `ordersService.uploadProductionFile`.
- **Sin `procesarPortal`, a propósito**: ese flag mide el PDF Y recotiza el pedido completo
  — usarlo hubiera cobrado al cliente la reimpresión de su propia falla, violando RN-FLT.02
  ("sin costo"). El archivo queda adjunto en estado `Pendiente`, sin metros; el mecanismo
  existente de Control de Impresión (sin tocar) los completa cuando se imprime y se mide,
  exactamente como ya pasa hoy con toda falla.
- **Probado**: subida real de un PDF contra `SUB-20936-F1107` — el archivo quedó adjunto con
  las copias correctas, `EstadoArchivo='Pendiente'`, y `Ordenes.CostoTotal` no se movió (0
  antes y después). El archivo de prueba se subió por error al Drive real de la empresa
  durante la verificación (no hay endpoint de borrado en `driveService.js`); la fila de
  `ArchivosOrden` sí se limpió.

## 19. Corrección: no contaminar la lista de archivos de la orden de falla (10-sep-2026)

El primer intento de la sección 18 (mostrar el archivo original) reutilizó el mecanismo de
las reposiciones de cliente (`-R#`), que trae **todos** los archivos de las órdenes hermanas
del pedido. El usuario lo probó y encontró contaminación real: aparecían archivos de otras
áreas (una matriz de Bordado, un PDF de otro cliente) mezclados en la lista de "Archivos de
Impresión" de la orden de falla — un riesgo serio si alguien descarga el lote completo para
ripear, porque mandaría a imprimir contenido ajeno.

Corregido: se revirtió por completo la ampliación del filtro de `productionFiles` (las
órdenes de falla vuelven a ver solo sus propios archivos, igual que cualquier orden común).
En su lugar, el archivo original a reponer se muestra en una **tarjeta separada**, fuera de
la lista de archivos de la orden — nombre, copias y medidas de solo lectura, con un link para
verlo — usando el dato PUNTUAL ya guardado (`Reposiciones.ArchivoOrigenID`), no "todo lo de la
madre". Nuevo endpoint `GET /api/logistics/reposiciones/orden/:ordenId` (reexpone
`fallaBandejaController.getReposicionesOrden`, ya existía, solo faltaba montarlo genérico
para áreas fuera de la bandeja EMB/EST/TWC/TWT) con `ArchivoOrigenNombre/Copias/Metros/Ruta`
agregados vía JOIN. Verificado contra `SUB-20936-F1107`: devuelve exactamente un archivo, el
correcto.

## 20. Tres correcciones en el remito de complementos (10-sep-2026)

Al probar el ciclo completo Corte→Costura→Bordado con una falla real chained (COR-20936-F1215
como reposición de Corte), aparecieron tres problemas relacionados con los COMPLEMENTOS
(bultos de una orden de falla que viajan junto/en representación de la madre):

1. **"cantidad del envío tiene que ser mayor que cero"**: `getEnvioInfo` sugería la cantidad
   del complemento con los números de la ORDEN MADRE (aprobado − enviado), que ya estaba
   100% completa y enviada → siempre daba 0. Corregido: para un complemento, la cantidad
   sugerida sale de la PROPIA orden de falla (`CantidadAprobadaBultos`, o `Reposiciones.Cantidad`
   si nunca pasó por Control), no de la madre.
2. **Candado de "cantidad esperada" mal aplicado a complementos**: `armarLineasRemito`
   validaba la cantidad del complemento contra `cantidadEsperada − enviada` de la MADRE —
   rechazando cualquier reposición sobre una madre que ya salió completa (el caso normal:
   la falla se descubre después de que la madre ya se despachó). Corregido: un complemento
   "puro" (sin bulto propio de la madre en el mismo remito) queda exento de ese candado;
   en su lugar, si no declaró cantidad, se autocompleta desde la propia -F (mismo criterio
   que el punto 1), y si no hay dato en ninguna, se deja sin validar (no bloquea).
3. **Órdenes ya entregadas seguían en "Bandeja"**: una orden que mandó TODO en 2+ remitos y
   ya fue RECIBIDA en su próxima área (`EstadoenArea = 'Recibido en Destino'`, estado que
   pone `recibidasIntermedias` en `receiveDispatch` para áreas intermedias — no Depósito)
   seguía apareciendo en "Bandeja" porque las queries de listado solo excluían `'Pronto'`,
   no ese otro estado terminal. Corregido en las 5 queries de `embBoardController.js` que
   listaban por `EstadoenArea` (trabajo, las 3 de "bloqueadas", y el chequeo de hermanas EST):
   ahora excluyen también `'Recibido en Destino'`.

Probado contra el pedido real 20936 (verificado en vivo, no solo con datos sintéticos) y con
la regresión completa (6 baterías) + build de producción, todo en verde.

## 21. Hoja de Ruta (grafo del pedido) desordenada por el pivote de PRO (10-sep-2026)

`OrderRouteTracker.jsx` (componente pre-existente, no forma parte original de Spec 39, pero
lo usa `OrderDetailModal` para mostrar el flujo completo del pedido) mostraba las áreas fuera
de secuencia — para el pedido 20936: Bordado, Corte, Costura, Producción, Sublimación,
Depósito, en vez de Sublimación→Corte→Costura→Bordado→Producción→Depósito — con badges de
estado en crudo ("RECIBIDO EN DESTINO", "EN TRANSITO").

Causa real: el manejo especial de PRO como "pilar" de combos (que puede ser tanto origen como
destino — ver comentario original del componente) trataba a CUALQUIER paso sin ningún otro
paso apuntándole como "hijo derivado de PRO". Eso es correcto quiere para un combo real
(Bordado y DTF arrancando en paralelo, sin padre, porque de ahí nacen), pero rompía cualquier
pedido común: Sublimación (el INICIO real de la cadena) tampoco tiene padre por ser el primer
paso, así que el algoritmo la enganchaba como si PRO la hubiese originado — PRO terminaba
como raíz artificial de TODO el grafo, arrastrando el orden visual con él. Como además el
grafo resultante (con esa arista falsa) daba una capa por paso (sin ramas reales), la
condición `hasBranching` caía a `false` y el fallback a "modo lineal" usaba el orden CRUDO en
que llegaron los pasos del backend (orden de inserción en el `Map` de `areaSteps`, sin ninguna
relación con la secuencia real) en vez de aprovechar el orden ya calculado.

Corregido en dos partes, ambas verificadas simulando el algoritmo contra los datos reales de
20936 (cadena simple) y un caso combo sintético (2 raíces independientes) antes y después:

1. El pivote especial de PRO (duplicar el nodo en origen/destino y "adoptar" huérfanos) ahora
   solo se activa cuando hay **2 o más** raíces sueltas de verdad (`otrosRoots.length > 1` —
   la señal real de un combo). Con 0 o 1 raíz (el caso normal), PRO es un paso más: sigue su
   propio `ProximoServicio` como cualquier otro, igual que "Comprar y personalizar" ya hacía.
2. El modo lineal (sin ramas) ahora usa el orden ya calculado por el algoritmo de capas
   (`ProximoServicio` real, BFS por camino más largo) en vez del orden crudo del backend —
   antes se calculaba correctamente y se descartaba.

No se tocó el modo grafo (columnas/SVG) para combos reales — mismo comportamiento de antes.
Build de producción en verde.

## 22. Falla propia en Bordado/Corte/Costura también arma la cadena completa (10-sep-2026)

Decisión del usuario: en Bordado (EMB), Corte (TWC) y Costura (TWT) no hay prenda de repuesto
en stock. Antes, una falla PROPIA (reportada por la misma área que la produjo, sin insumo de
otra área involucrado) siempre creaba **una sola orden nueva en la misma área** — asumiendo
que la prenda física seguía sana y solo había que rehacer el trabajo de esa área (ej. "hilo
del color equivocado"). Pero si la falla rompe/pierde la prenda física (ej. la aguja rasga la
tela), no hay nada que "rehacer en el lugar": hay que fabricar una prenda nueva desde cero,
exactamente igual que un FALTANTE.

Cambio: en `EMB`/`TWC`/`TWT` (`ConfiguracionGlobal.AREAS_FALLA_PROPIA_REQUIERE_CADENA`, default
esas 3), reportar una falla PROPIA ahora arma la misma cadena hacia atrás que un FALTANTE
(Sublimación→Corte→Costura...) en vez de una orden nueva en la misma área — sin crear ninguna
orden en el área que reporta, igual que ya hacía FALTANTE. El `Tipo` de la reposición sigue
siendo `FALLA_PROPIA` (para no perder que fue un defecto, no una ausencia), solo cambia el
MECANISMO de reposición.

Con un matiz importante, verificado con un caso real: no todo pedido que llega a Bordado pasó
por Sublimación/Corte/Costura — un combo "Comprar y personalizar" puede llegar directo desde
un producto ya armado (WMS/stock del local), sin tela detrás. Ahí no hay nada que encadenar,
así que se cae automáticamente al comportamiento de siempre (una orden nueva en la misma área,
o la detección de insumo del cliente/local si corresponde) — el sistema intenta la cadena
primero y solo si `proponerCadena` encuentra áreas anteriores reales EN ESE PEDIDO la usa; si
no, sigue como antes. `getPendientes` expone `fallaPropiaUsaCadena` (área habilitada Y el
pedido tiene anteriores) para que el modal ajuste el texto y pida "de qué archivo viene" en
ese caso también.

Verificado con una prueba dirigida (`test-falla-propia-cadena.js`, 3 escenarios: cadena
completa real, combo sin anteriores, área fuera de la lista) + la regresión completa de 7
baterías + build de producción, todo en verde.

## 23. Marcador visual "Inicio" en la Hoja de Ruta (10-sep-2026)

A pedido del usuario: el gráfico de flujo del pedido (sección 21) arrancaba "de la nada" en el
primer paso real (Sublimación en un pedido de tela, o Producción en un "Comprar y personalizar"
sin tela detrás, ver sección 22) — sin nada que indique visualmente que ahí empieza el pedido.
Se agregó un marcador `InicioMarker` en `OrderRouteTracker.jsx`: un círculo gris punteado con
el texto "Inicio", puramente visual, sin estado ni dato real detrás (no lee ninguna columna de
`Ordenes`). Aparece siempre que haya más de un paso real que mostrar (`rawSteps.length > 1`),
tanto en modo lineal (pegado antes del primer paso, con el mismo conector que ya usan los pasos
entre sí) como en modo grafo (una columna más a la izquierda de las capas, sin flechas —
no participa del cálculo de aristas/capas, es aditivo puro sobre el render). Build de
producción en verde.

## 24. Badge de fallas/reposiciones en la Hoja de Ruta (10-sep-2026)

El usuario preguntó "qué pasa con las órdenes de falla" en el gráfico. Repuesta: ya se
tenían en cuenta para el ESTADO del paso (sección 21, "la orden más atrasada" entre todas las
hermanas de esa área), pero de forma invisible — no había ninguna señal de que detrás de ese
estado hubo una falla/reposición encadenada. Se agregó un badge rosa con el número, en la
esquina del círculo de cada paso, cuando ese paso tiene órdenes con código `-F#`/`-R#` (mismo
criterio que `libroEntregasService.getHermanas` para excluirlas de la secuencia normal).
Backend (`ordersController.getIntegralPedidoDetailsV2`) agrega `fallaCount` al objeto de cada
paso de `ruta`; frontend (`OrderRouteTracker.jsx`, `FallaBadge`) lo pinta en ambos modos
(lineal y grafo). Verificado contra los códigos reales del pedido 20936: Sublimación queda con
badge "2" (F1107 + F1215), Corte y Costura con "1" cada una, Bordado/Producción/Depósito sin
badge. Sobre la pregunta de "por qué no sale en modo grafo con líneas": correcto que no salga
así — el modo grafo (columnas + flechas SVG) es solo para combos con ramas REALES (2+ arranques
independientes convergiendo en Producción); las órdenes de falla de este pedido no arman una
rama paralela, se pliegan dentro del mismo paso de su área (ahora visibles vía el badge), así
que seguir en modo lineal es lo correcto, no un bug. Build de producción en verde.

## 25. Tres correcciones más tras probar "Control de Pedidos — PRO" (10-sep-2026)

El usuario mostró la pantalla "Control de Pedidos — PRO" del pedido 20936 con BOR-20936
repetida 3 veces, todas "x30", y la Hoja de Ruta mostrando Producción/Depósito en naranja
("Avisado") pese a estar ya ingresado en Depósito. Tres bugs distintos:

1. **Duplicados en "Control de Pedidos — PRO"**: `logisticsController.getPedidosCompletosPRO`
   (línea ~2366) hacía `JOIN Ordenes → Logistica_Bultos` sin `DISTINCT`, seleccionando
   columnas de bulto (`BultoID`, `CodigoEtiqueta`) junto a las de la orden — con varios bultos
   en PRO para la misma orden (tandas/remitos parciales), el JOIN hacía fan-out y la orden
   aparecía repetida, siempre con la Magnitud total (no había cantidad por bulto). Esas
   columnas no se usaban en el frontend (`ControlPedidosPRO.jsx`). Corregido: `SELECT DISTINCT`
   sobre las columnas de orden, sin las de bulto — una fila por componente real, que es lo que
   el badge "X de X en PRO" siempre quiso decir. Verificado con una prueba sintética (3 bultos
   en PRO para la misma orden → 1 sola fila).
2. **"Avisado" se veía como EN PROCESO (naranja, engranaje girando)** en la Hoja de Ruta:
   `OrderRouteTracker.jsx`'s `stepVisual` no tenía "AVISADO" en la lista de estados
   FINISHED (sí tenía Pronto/Finalizado/Recibido en Destino/Ingresado/Entregado). Agregado.
3. **Badge de fallas (sección 24) mejorado** a pedido del usuario: ahora muestra "F" + la
   cantidad repuesta (`Reposiciones.Cantidad` sumada por `AreaProduce`, con fallback a la
   Magnitud de las propias órdenes -F si no hay match), en rojo mientras algo siga sin cerrar
   (`Reposiciones.Estado ≠ CERRADA/CANCELADA`) y en verde cuando ya cerró todo. Nueva
   pre-consulta a `Reposiciones` en `ordersController.getIntegralPedidoDetailsV2`.

Verificado con una prueba sintética nueva (`test-pro-dedup.js`) + los datos reales del pedido
20936 (las 4 reposiciones de esta cadena, todas CERRADA → badges verdes) + la regresión
completa (8 baterías) + build de producción, todo en verde.

## 26. Aviso de Depósito en $0 para "comprar y personalizar" facturado por área (10-sep-2026)

El usuario recibió el aviso de WhatsApp de "pedido listo" con costo $0 para el 20936. Investigación
completa (no es un bug de Spec 39, pero se encontró probando este flujo): la orden llevaba la nota
`[FACTURA POR AREA]` (marcador real, puesto por PrendaOrderForm al crear el pedido) — en ese modo,
cada área cobra su propia línea (Sublimación 2,70 + Bordado 1,13 = 3,83 USD, ya correctamente sumado
en `PedidosCobranza.MontoTotal`) y la orden de Producción, la ÚNICA que el cliente retira físicamente
por Depósito, queda a propósito en $0. El aviso de WhatsApp y la decisión de cobro al retirar
(`retiroService.crearRetiro`) solo miran el costo de ESA orden puntual — nunca el total del pedido.

Dos correcciones, confirmadas por el usuario ("sí, también se retira por Depósito" / "todo en una
sola línea en Producción"):

1. **`ordenesController.costoParaDeposito`** (el que fija `OrdenesDeposito.OrdCostoFinal` al
   escanear/ingresar): si la línea propia de la orden da $0 Y es la orden ancla de Producción
   (AreaID='PRO', sin ComboItemID) de un pedido con NoDocERP, ahora cae a
   `PedidosCobranza.MontoTotal` (nueva función `totalDelPedido` en `backend/utils/montoTotalPedido.js`,
   con la misma conversión de moneda que ya usa `totalesCobranzaDeOrden`). No toca ningún otro caso
   (pedidos de una sola orden, combos reales con ComboItemID). Verificado: `totalDelPedido('20936',
   'USD')` da 3.83, sin afectar `totalesCobranzaDeOrden` de las órdenes hermanas.

2. **`PedidosCobranzaDetalle.EsFacturable`** (columna nueva, migración
   `docs/migrations/pedidoscobranzadetalle_esfacturable.sql`, default 1): a pedido del usuario
   ("algo que diga si la línea es facturable, para que la factura no quede sucia con líneas en
   cero"). `erpSyncService.js` la calcula al insertar cada línea: `!esHermanaConsolidada && |Subtotal| > 0`.
   `contabilidadCore.js` (`resolverLineasDetalle`, ambos modos) filtra `EsFacturable=1` además del
   `EsHermanaConsolidada=0` que ya tenía. Verificado re-sincronizando el 20936 real (`skipDeposito:true`):
   Sublimación y Bordado quedan `EsFacturable=true`; Producción y las 5 órdenes -F en $0 quedan
   `EsFacturable=false`. `PedidosCobranza.MontoTotal` no se movió (sigue en 3.83).

**Hallazgo nuevo, NO corregido — fuera de alcance de esta sesión**: probando el punto 2 en vivo
(MODO 2 de `resolverLineasDetalle`, vía el `OrdIdOrden` real de PRO-20936 en `OrdenesDeposito`)
apareció un problema más profundo y previo a esta sesión: el JOIN de `contabilidadCore.js` entre
`OrdenesDeposito`/`TransaccionDetalle` y `PedidosCobranza` compara `OrdCodigoOrden` (ej.
"PRO-20936") contra `PedidosCobranza.NoDocERP` (ej. "20936") — un código CON prefijo de área contra
un número de documento SIN prefijo, que casi nunca coinciden. Medido contra las últimas 2000 filas
reales de `OrdenesDeposito`: solo 25 (1,25%) encuentran su `PedidosCobranza`. Para el 98,75%
restante, `pcd`/`pc` quedan NULL y la factura cae directo a `od.OrdCostoFinal`/`td.TdeImporteFinal`
(que sí llevan el número correcto gracias al arreglo del punto 1, pero sin el detalle de
`LogPrecioAplicado`/`PerfilAplicado` que da `pcd`). No se tocó — es un problema aparte, mucho más
grande que "comprar y personalizar", y merece su propia investigación dedicada antes de tocarlo.

Verificado con la regresión completa (8 baterías) + build de producción, todo en verde. Migración
aplicada en LOCAL (no en producción — script en docs/migrations/ para que el usuario la corra).

## 27. Bandeja de Producción (10/11-sep-2026)

A pedido del usuario, mockup previo aprobado: reemplaza el botón "Modificar Flujo" del área
PRO (antes abría "Gestión de Rutas" — plantillas de secuencia de áreas sin uso real en
ningún otro lado del sistema, verificado por grep antes de tocarlo). Ahora abre la **Bandeja
de Producción**: grilla de tarjetas con los pedidos que tienen orden madre PRO, cada una con
badge de fallas abiertas (mismo criterio `-F#`/`-R#` de la sección 24) y su estado — al hacer
clic se ve el detalle completo en una sola pantalla: el gráfico "Hoja de Ruta" (secciones
21-26, reusado tal cual vía `OrderRouteTracker`), componentes reunidos, estado del libro de
entregas, y el botón de "Aprobar control y generar bulto" ahí mismo (reusa
`logisticsController.aprobarControlPRO`, sin cambios).

Cambio de fondo necesario: `getPedidosCompletosPRO` antes OCULTABA el pedido hasta que
llegaran TODOS sus componentes — no se podía ver nada mientras tanto. Ahora also devuelve los
pedidos parciales, marcados `estado: 'esperando'` (con `faltantesPorLlegar`), y `'recibido'`
cuando ya está completo (comportamiento de siempre). La pantalla vieja
(`ControlPedidosPRO.jsx`, ruta directa sin pasar por este modal) sigue mostrando SOLO los
`'recibido'` — filtro agregado del lado del cliente, sin tocar su lógica — para no cambiarle
el comportamiento a nadie que ya la use.

Archivos nuevos: `src/components/production/ProBandeja.jsx` (grilla + detalle),
`ProBandejaModal.jsx` (envoltorio modal, mismo disparador `isFlowsModalOpen` de siempre en
`AreaView.jsx`). Verificado con una prueba dirigida (`test-bandeja-pro.js`: un pedido con 1
de 2 componentes → `esperando`, llega el segundo → `recibido`) + la regresión completa (9
baterías) + build de producción, todo en verde.

## 28. Reportar falla desde la Bandeja de Producción (11-sep-2026)

Se agregó el botón "Reportar falla" al detalle de la Bandeja de Producción (sección 27),
reusando el mismo `ReportarFallaModal`/`fallaBandejaController` genérico de siempre — sin
duplicar lógica. Nuevas rutas `backend/routes/logisticsRoutes.js` bajo `/logistics/pro/orders/
:ordenId/falla*` (mismo patrón "forzar el área" que `bandejaRoutes.js`, pero SOLO las 4 rutas
de falla — no se montó la fábrica completa porque Trabajo/Control no existen para PRO, que se
controla vía `aprobarControlPRO`). Frontend: `createBandejaService` (antes privada en
`embBoardService.js`) ahora exportada para poder armar `proFallaService` apuntando a ese
prefijo nuevo.

PRO no tiene "áreas anteriores" en la secuencia (`getHermanas` la excluye a propósito), así
que solo está disponible reportar Falla Propia — Faltante queda deshabilitado ahí, correcto:
no hay de dónde encadenar. La orden -F que nace queda en AreaID='PRO', Pendiente — no hay
todavía una pantalla de "Trabajo" para resolverla ahí dentro (PRO se consolida distinto);
queda como limitación conocida, no bloqueante para lo pedido.

Verificado con `test-falla-pro.js` (reportar sobre una orden PRO real: crea 1 -F, orden madre
queda Retenida) + la regresión completa (10 baterías) + build de producción, todo en verde.

## 29. Modo de facturación y "Facturable" en la pantalla de Cotización (11-sep-2026)

A pedido del usuario, sobre la pantalla "Confirmación de Cotización"
(`src/components/logistics/QuotationEditModal.jsx`, `backend/controllers/quotationController.js`):

1. **Selector de modo de facturación**, visible solo si el pedido tiene orden madre PRO:
   Consolidado / Por área / Precio establecido (con monto+moneda). Lee y escribe el mismo
   marcador de texto que ya usaba `erpSyncService.js` (`[FACTURA POR AREA]` /
   `[PRECIO ESTABLECIDO: monto MONEDA]` en la Nota de la orden madre PRO) — no se inventó un
   campo nuevo, se expuso el que ya existía pero vivía invisible como texto libre. Nuevo campo
   en la respuesta de `getQuotation`: `modoFacturacion`/`tieneOrdenMadrePro`/
   `precioEstablecidoMonto`/`Moneda`; `saveQuotation` acepta esos mismos campos y reescribe la
   Nota preservando el resto de su contenido.
2. **Columna "Facturable" editable por línea**: checkbox nuevo junto a "Perfil", pisa a mano
   el cálculo automático de la sección 26 (`EsFacturable`) cuando hace falta (ej. mostrar a
   propósito una línea en $0, u ocultar una con importe). `getQuotation` ahora trae
   `EsFacturable`; `saveQuotation` la persiste (explícita si el usuario la tocó, si no sigue
   el cálculo automático de siempre).

**Bug real encontrado y corregido en el camino** (no introducido hoy, preexistente):
`saveQuotation` recalculaba `Subtotal = Cantidad × PrecioUnitario` para TODAS las líneas al
guardar — pero las líneas con precio "por puntadas"/"por bajadas" (Bordado, Estampado; bloque
OVERRIDE de `erpSyncService.js`) tienen `Cantidad = 0` a propósito, con `PrecioUnitario` ya
siendo el total de esa línea. Guardar esta pantalla — aunque no se cambiara nada — borraba esas
líneas a $0 en cada guardado. Detectado probando el pedido 20936 real (Bordado 1,13 → 0,
`PedidosCobranza.MontoTotal` 3,83 → 2,70 al guardar sin tocar nada). Corregido: `Subtotal =
Cantidad > 0 ? Cantidad × PrecioUnitario : PrecioUnitario` — no cambia ninguna línea normal
(Cantidad > 0), solo deja de romper las de precio fijo por-línea. El pedido 20936 quedó
restaurado (resync real) antes de seguir.

Verificado: reproducido el bug y confirmado el fix contra el pedido 20936 real (guardar sin
cambios ahora conserva Subtotal=1,13 y MontoTotal=3,83) + ida y vuelta de los 3 modos (POR_AREA
→ CONSOLIDADO → restaurado a POR_AREA, la Nota se actualiza y preserva el resto del texto) +
la regresión completa (12 baterías) + build de producción, todo en verde.

## 30. Falla propia en Producción también arma la cadena completa (14-sep-2026)

Probando "Reportar falla" desde la Bandeja de Producción (sección 27-28), el usuario notó que
creaba una orden nueva EN Producción — inconsistente con la decisión de la sección 22
(Bordado/Corte/Costura arman la cadena completa porque no hay repuesto en stock). Confirmado:
Producción tampoco tiene repuesto — la prenda ya armada, si se rompe, hay que rehacerla desde
Sublimación. Se agregó 'PRO' a `areasFallaPropiaRequiereCadena` (sección 22).

Dos ajustes de fondo necesarios, no evidentes a simple vista:

1. **`libroEntregasService.getHermanas()` excluye a PRO a propósito** (`AreaID <> 'PRO'`, es
   el "pilar" del pedido, no un paso de la secuencia) — así que `areasAnteriores(doc, 'PRO')`
   siempre daba vacío, sin importar cuántas áreas reales tuviera el pedido detrás. Nueva
   función `areasAnterioresAPro(noDocERP, conn)`: para PRO, "anteriores" es la secuencia de
   producción COMPLETA del pedido (todo es anterior a Producción, por definición). Usada en
   `proponerCadena` (fallaBandejaController.js) y en `getPendientesParaArea` cuando el área
   es PRO — sin esto, `getPendientes` seguía devolviendo `anteriores: []` y
   `fallaPropiaUsaCadena: false` aunque el pedido sí tuviera SB/TWC/TWT/EMB reales.
2. **`ConfiguracionGlobal.AREAS_CADENA_REPOSICION`** (el interruptor maestro que ya gatea
   FALTANTE) no tenía 'PRO' — sin él, `proponer`/`reportar` caían al fallback de "sin cadena
   real" aunque el pedido sí la tuviera. Agregado en LOCAL a mano; script para producción en
   `docs/migrations/areas_cadena_reposicion_agregar_pro.sql` (aditivo, agrega 'PRO' a la lista
   existente si no está ya).

Verificado con una prueba dirigida nueva (`test-falla-pro-cadena.js`, pedido sintético
SB→TWC→TWT→EMB→PRO): `getPendientes` ahora trae las 4 áreas y `fallaPropiaUsaCadena=true`;
`proponer`/`reportar` arman la cadena de 4 eslabones en el orden correcto, ninguna orden nace
en PRO, y PRO queda Retenida — mismo patrón que Bordado/Corte/Costura. El caso sin pedido real
detrás (combo aislado, `test-falla-pro.js`) sigue cayendo al comportamiento viejo (una orden
en PRO), sin cambios. Regresión completa (11 baterías) en verde.

## 31. Panel 1 de "Reportar falla" confuso — subtítulo real, no "lo pendiente" (14-sep-2026)

El paso 1 de `ReportarFallaModal.jsx` decía "esto es lo que **todavía no llegó**" pero la
lista mostraba TODAS las órdenes anteriores del pedido, incluidas las que ya llegaron
completas (badge "Completo") — contradictorio a simple vista. El dato en sí estaba bien (es
`getPendientesParaArea`, el mismo que usa `PendientesPedidoPanel`, y sirve para decidir si lo
que falta ya está resuelto antes de reportar); lo que estaba mal era el texto, que prometía
solo pendientes cuando en realidad es el estado completo. Se corrigió el texto (encabezado y
pill) para describir lo que realmente se muestra, sin tocar qué órdenes se listan:

- "Antes de reportar, esto es lo que todavía no llegó a {área}" → "Antes de reportar, así está
  cada área anterior a {área} en este pedido, según el libro de entregas"
- Pill "Pedido X · pendiente según el libro" → "Pedido X · estado de las órdenes anteriores"

## 32. Bandeja de Producción — Control: cantidad, archivos y nota (14-sep-2026)

El detalle de un pedido en la Bandeja de Producción (sección 28) tenía el gráfico de flujo y
"Lo que falta de este pedido", pero nada para comprobar que el pedido está realmente OK antes
de aprobar el control: ni la cantidad de prendas por componente, ni los archivos de impresión/
bocetos, ni la nota del cliente. Se agregó una sección "Control del pedido" en
`ProBandeja.jsx`, antes del botón de aprobar:

- **Cantidad de prendas por componente**: reutiliza `selected.componentes` (ya lo traía
  `getPedidosCompletosPRO` — magnitud efectiva por área, la misma que usa cada bandeja para su
  propio control) en una lista por área/orden. Si dos componentes con magnitud numérica no
  coinciden, se marca en rojo — señal real de que algo no cierra antes de aprobar a ciegas.
- **Nota**: nuevo campo `header.notas` en `getIntegralPedidoDetailsV2` (`ordersController.js`)
  — junta la `Nota` de cada orden del pedido, descartando las que quedan vacías al sacarles los
  marcadores internos entre corchetes (`[FACTURA POR AREA]`, `[COMBO: ...]`, etc. — puro estado
  de sistema, nada que mostrarle a quien controla). Se conserva el texto ORIGINAL de las que sí
  tienen algo real, sin inventar una versión "limpia" que se coma contexto.
- **Bocetos/logos y archivos de impresión**: reutiliza `archivos` (ya lo traía la misma
  respuesta, para el gráfico) — ahora cada fila viene etiquetada con `OrdenCodigoOrden`/
  `OrdenAreaID` (join agregado a las 3 queries de archivos) para poder separarlos visualmente.
  Clasificación por `TipoArchivo` (BOCETO/LOGO/MATRIZ/PREDISENO vs. el resto), mismo criterio
  que ya usa `embBoardController.enriquecerPreview` para Bordado.

Verificado con `test-pro-bandeja-archivos-notas.js` contra un pedido real (20937, solo
lectura): `header.notas` viene como array, los 12 archivos del pedido vienen con
`OrdenCodigoOrden`/`OrdenAreaID`, y ninguna nota es puro marcador interno. `vite build` OK.

## 33. Corrección: "cantidad de prendas" no es la Magnitud del componente (14-sep-2026)

Probando la sección 32 contra un pedido real (20938), el usuario vio "Cantidad de prendas por
componente" comparando SUB-20938 (0.19) contra SUB-20938-F1365 (1) y marcándolas como
"no coinciden" — falso positivo. Las dos son órdenes de **Sublimación**, cuya `Magnitud` son
METROS de tela, no prendas (0.19 m de tela; el "1" de la reposición es un valor placeholder,
"sin metros hasta imprimir y medir" — ver su Nota). Comparar esos dos números como si fueran
"prendas" no tenía sentido — el bug estaba en tratar la Magnitud cruda de CUALQUIER componente
como si fuera cantidad de prendas, cuando eso solo es cierto en las áreas de bandeja.

Fix en `logisticsController.getPedidosCompletosPRO`:
- **Fuente única de la cantidad de prendas del pedido**: `Ordenes.Magnitud` de la orden madre
  PRO (UM='u' — el "campo prendas" real, pedido por el usuario explícitamente: *"cerciórate
  que la subes desde el campo prendas"*). Nuevo `cantidadPrendas` en la respuesta.
- **`esPrendas` por componente**: `true` solo para EMB/EST/TWC/TWT (`AREAS_BANDEJA`, donde
  `getMagnitudEfectiva` ya cuenta piezas reales); `false` para Sublimación/DTF/TPU/etc, cuya
  Magnitud es otra unidad (metros) y no es comparable como cantidad de prendas.

`ProBandeja.jsx`: la comparación "no coinciden" ahora solo mira componentes con
`esPrendas=true`; arriba de la lista se muestra siempre la cantidad de prendas del pedido
(el número de la orden madre), como dato principal. Los archivos (sección 32) también se
agruparon visualmente por la orden dueña (`OrdenCodigoOrden`/`OrdenAreaID`) en vez de una
lista plana — al hacerlo, quedó a la vista que uno de los "archivos de impresión" del pedido
20938 (orden SUB-20938-F1365) es en realidad un PDF de nota de crédito CFE, no un archivo de
impresión — dato real mal adjuntado en la orden, se lo señalé al usuario, no se tocó (no es
un bug de código, es un archivo subido a la orden equivocada).

Verificado con `test-pro-cantidad-prendas.js` contra el pedido real 20938 (solo lectura):
`cantidadPrendas` = "4" (el dato real de la orden PRO), ambos componentes de Sublimación
vienen con `esPrendas=false` (ya no se comparan). `vite build` OK.

## 34. Costo del pedido + link a la cotización; cliente real y nombre del trabajo (14-sep-2026)

Pedido explícito del usuario: mostrar el costo del pedido en la Bandeja de Producción, con un
link que abra la cotización. Al revisar la pantalla para agregarlo, dos cosas más saltaron a
la vista (avisadas por el usuario mientras se armaba esto, mismo pedido 20938 de prueba):

1. **El "cliente" mostraba `Yoa1973`** — no es el nombre del cliente, es su usuario del portal
   (`Clientes.IDCliente`). `Ordenes.Cliente` es texto suelto cargado al crear la orden y en
   pedidos del portal a veces queda el usuario en vez del nombre real. Fix en
   `getPedidosCompletosPRO` (`logisticsController.js`): `LEFT JOIN Clientes C ON
   C.CliIdCliente = O.CliIdCliente`, usando `C.Nombre` (la FK real) y cayendo a `O.Cliente`
   solo si no hay cliente vinculado. Pedido 20938: pasó de "Yoa1973" a "Yoania Yamiles".
2. **No se veía el nombre del trabajo** — `ListaCard` y el header del detalle mostraban
   `producto` (el artículo de catálogo, que para prendas a medida cae en el genérico "Prenda
   Personalizada (sin catálogo)") antes que `trabajo` (`DescripcionTrabajo`, siempre específico
   de ese pedido — ej. "BILLETERA SIN SALDO"). Se invirtió la prioridad en `ProBandeja.jsx`
   (`p.trabajo || p.producto`) en ambos lugares.

Costo + cotización: nuevo botón bajo el nombre del trabajo, en el header del detalle
(`ProBandeja.jsx`) — `MontoTotal`/`Moneda` de `PedidosCobranza` (mismo dato que ya usa la
pantalla de Cotización, vía `GET /quotation/:noDocERP`, cabecera), y al hacer clic abre
`QuotationEditModal` (`areaFilter="TODOS"`, mismo patrón que ya usa `OrderDetailModal.jsx`
para editar la cotización del pedido completo desde Producción). Si el pedido todavía no tiene
cotización, el botón dice "Ver cotización" en vez de mostrar un monto vacío.

Verificado contra el pedido real 20938 (solo lectura): cliente resuelve a "Yoania Yamiles",
trabajo a "BILLETERA SIN SALDO", y `/quotation/20938` devuelve MontoTotal 68.40 UYU. `vite
build` OK.

## 35. Volver a "Por área" restaura la facturabilidad sola, con el precio original (14-sep-2026)

El usuario preguntó si, ocultando las líneas no facturables (sección 29/33) en vez de directamente
no insertarlas, iba a poder "rehacerlas" si más adelante cambiaba de modo de facturación — y si
había de dónde sacar esos datos. Respuesta corta: si nunca se insertan, NO hay otro lugar del
sistema donde esté guardado el precio/descuento tal como se cotizó — las columnas que lo
conservan (`PrecioLista`, `DescuentoOrigen`, `LogPrecioAplicado`, `PricingTrace`) son
justamente esa fila; recotizar después usaría los precios de HOY, no los reales de cuando se
hizo el trabajo. Por eso se sigue con "ocultar, no borrar".

Pero probando esto se encontró que la restauración automática al volver a POR_AREA **no
estaba completa**: el `useEffect` de `QuotationEditModal.jsx` que cambia de modo solo hacía
`EsHermanaConsolidada: false` en la rama POR_AREA — nunca tocaba `EsFacturable`, que había
quedado en `false` (persistido) desde la última vez que estuvo en PRECIO_ESTABLECIDO/
CONSOLIDADO. Resultado: cambiar el modo de vuelta NO revivía la línea sola, había que ir línea
por línea y tildar "Facturable" a mano.

Fix (una línea): en la rama POR_AREA del useEffect, además de `EsHermanaConsolidada: false`,
se manda `EsFacturable: null` — ni true ni false, "recalculalo vos". El backend
(`quotationController.js:642`, ya existía, sin tocar) hace exactamente eso cuando recibe
`null`: `!EsHermanaConsolidada && subtotal !== 0`. Con el precio/descuento de la línea intactos
(nunca se tocaron, solo se ocultaron), el resultado es el mismo cálculo que hubiera dado si esa
línea jamás se hubiera ocultado — ni una reposición sin cargo real (subtotal 0) se factura de
más, ni una línea con precio real queda perdida.

Verificado con `test-quotation-restaurar-facturable.js` contra el pedido real 20936: se lo
llevó a PRECIO_ESTABLECIDO (SUB-20936 queda oculto, `EsFacturable=false`, precio intacto),
se volvió a POR_AREA con el fix (`EsFacturable=true` solo, mismo `PrecioUnitario` y mismo
`LogPrecioAplicado` que al principio — no recalculado), y se restauró el pedido a su estado
exacto original al final (MontoTotal 3.83, sin alterar el pedido de prueba del usuario).

**⚠️ Superseded por la sección 36** — el usuario decidió después ir por el camino contrario
(no insertar en vez de ocultar). El mecanismo de esta sección (`EsFacturable: null` al volver
a POR_AREA) sigue en el código y sigue siendo correcto para cuando SÍ hay una línea guardada
que restaurar, pero deja de ser la defensa principal contra perder datos — ver 36.

## 36. Decisión: PedidosCobranzaDetalle solo guarda lo facturable — se deja de "ocultar" (14-sep-2026)

Cambio de rumbo explícito del usuario tras la discusión de las secciones 33-35 (¿de dónde
saco los datos si no inserto? → "decidido, cuando inserte el pedido va a pedidocobranza solo
las lineas que se van a facturar y aca en pro pone para poder agregar cualquier linea de
cualquier area"). Se pasa de "insertar todo, ocultar lo no facturable con `EsFacturable=0`" a
**no insertar directamente** lo que no se va a facturar — con una válvula de escape manual: la
pantalla de cotización en la vista PRO (pedido completo) ahora permite agregar cualquier línea
de cualquier área, para recuperar a mano lo que haga falta si más adelante se necesita
facturar algo que quedó afuera (con el precio de ESE momento, no el histórico — riesgo
aceptado explícitamente por el usuario).

Dos cambios, mismo criterio en ambos puntos donde se insertan líneas:

1. **`erpSyncService.js`** (sync automático al finalizar producción): en el loop que arma
   `PedidosCobranzaDetalle`, si la línea no es facturable (`!EsHermanaConsolidada &&
   Math.abs(Subtotal) > 0.005`) se hace `continue` — no se inserta. Antes se insertaba igual
   con `EsFacturable=0`.
2. **`quotationController.saveQuotation`** (pantalla de Cotización — recordar que esta
   pantalla borra y reinserta TODAS las líneas en cada guardado, ver sección 33/34): mismo
   criterio, respetando un `EsFacturable` explícito tildado/destildado a mano en cualquier
   sentido. Efecto colateral esperado: **guardar un pedido viejo con líneas ocultas
   heredadas de antes de este cambio las limpia** (ya no se reinsertan) — es intencional, no
   un bug.

Válvula de escape: **`ProductSearchPanel`** (el buscador de "Agregar línea") filtraba por
`!isAdmin && userArea` incluso en la vista PRO/TODOS (pedido completo) — un usuario sin rol
ADMIN veía "Sin productos disponibles" al intentar agregar una línea de cualquier área desde
ahí, porque filtraba por `AreaID='PRO'` (que no tiene catálogo propio). Encontrado en vivo por
el usuario (captura con "Sin productos disponibles" sobre 252 productos cargados). Fix en
`QuotationEditModal.jsx`: `isAdmin={isAdmin || areaFilter === 'TODOS'}` en las dos instancias
de `<ProductSearchPanel>` — la vista "TODOS" (abierta desde Producción, pedido completo) ya es
de por sí una vista sin restricción de área, no debe caer en el filtro "solo mi área".

**Válvula de escape #2 — botón "Reconstruir líneas"**: agregar línea a mano funciona pero
obliga a saber/adivinar la cantidad real (metros, puntadas, piezas) de memoria. Se agregó un
botón nuevo, al lado de "Recargar Precios", que en vez de eso vuelve a armar TODAS las líneas
del pedido desde el origen real — llama a `ERPSyncService.syncFinalOrderIntegration` (nuevo
endpoint `POST /quotation/:noDocERP/reconstruir`, `quotationController.reconstruirLineas`),
el MISMO camino que ya corre solo al despachar/recibir un bulto — no es código nuevo de
cotización, es reusar el motor real. Respeta el modo de facturación GUARDADO (marcador en la
Nota de la orden madre PRO); si el usuario cambió el modo en pantalla pero no guardó, se
avisa en la confirmación antes de reconstruir. `skipDeposito: true` porque se dispara desde
Producción, no desde un ingreso real a Depósito.

**Freno — nunca guardar/quedar en 0 líneas facturables**: esto pasó en la práctica con el
pedido 20938 (el usuario borró líneas en "Editar Cotización" y guardó — el pedido quedó con
`PedidosCobranza` viva pero `MontoTotal=0` y ninguna línea, invisible en la lista filtrada por
área). Dos frenos, uno en cada punta:

1. **Frontend** (`QuotationEditModal.jsx`, `handleDelete`): no deja borrar la ÚLTIMA línea
   de la tabla — avisa con un toast y no hace nada.
2. **Backend** (`quotationController.saveQuotation`): rechaza con 400 CUALQUIER guardado
   donde ninguna línea del payload resulte facturable (mismo cálculo que decide qué se
   inserta, replicado ANTES de tocar la base) — corta aunque el freno del frontend se
   saltee (otro cliente, un bug futuro, etc.). El mensaje sugiere cancelar el pedido si de
   verdad no va más, en vez de vaciar la cotización.

Verificado: intentar guardar 20936 con `lineas: []` devuelve 400 y el pedido queda intacto
(`MontoTotal` sin cambios). `vite build` OK.

## 37. Bug real de la sección 36: la línea madre PRO podía desaparecer del todo (14-sep-2026)

Probando en vivo el pedido 20938: guardó "Por área" bien (quedó con 1 línea, SUB-20938, USD
1.71 — correcto, PRO cotiza $0 en ese modo). Pero al volver a tocar "Precio establecido" (300
UYU), la tabla quedó VACÍA y el freno de la sección 36 bloqueó el guardado. Encontrados y
corregidos DOS bugs en cadena:

1. **`EsFacturable: null` se coercionaba a `false`** en `QuotationEditModal.jsx` (línea que
   arma el payload de "Guardar Confirmación"): `l.EsFacturable === undefined ? null :
   !!l.EsFacturable` — como `null !== undefined`, caía al `!!l.EsFacturable` = `!!null` =
   `false`. El fix de la sección 35 (mandar `null` al volver a "Por área" para que el backend
   recalcule sola la facturabilidad) nunca llegaba entero al backend — se guardaba `false` a
   mano, y la línea quedaba no-facturable de nuevo. Fix: `(l.EsFacturable === undefined ||
   l.EsFacturable === null) ? null : !!l.EsFacturable` — ahora si es `null` viaja `null`.
2. **La línea madre PRO podía desaparecer del todo**: en modo "Por área", PRO cotiza $0 A
   PROPÓSITO (cada componente cobra la suya) — con la regla de "solo facturables" (sección
   36), esa línea en $0 no se insertaba NUNCA. Problema: es el ÚNICO lugar donde "Precio
   establecido" tiene una línea para pisarle el monto pactado — sin ella, cambiar a ese modo
   no tenía nada que editar, tabla vacía, guardado bloqueado por el freno de la sección 36.
   Fix (mismo criterio en los dos puntos de inserción, `erpSyncService.js` y
   `quotationController.saveQuotation`): la línea de la orden madre PRO (`ComboItemID IS
   NULL`) se marca `esProMadre`/se detecta por `OrdenID` y se inserta SIEMPRE, aunque esté en
   $0 — es el pilar del pedido, no una hermana descartable.

**Efecto secundario, deseado**: `listQuotations` (sección "Editar Cotización" del toolbar de
PRO) también se corrigió — filtraba por "pedidos con una línea tageada AreaID='PRO'", que
para un pedido en "Por área" nunca existía (por el mismo motivo de arriba). Ahora, para el
filtro específico `areaId='PRO'`, busca pedidos con una orden madre PRO real (no una línea de
cotización), que es lo que esa pantalla realmente necesita mostrar.

Verificado en cadena contra el pedido real 20938: `reconstruirLineas` en "Por área" ahora deja
2 filas (SUB-20938 facturable USD 1.71 + PRO-20938 en $0, no facturable pero presente);
simulando el guardado ya arreglado a "Precio establecido" (300 UYU), la línea PRO se pisa
correctamente (facturable=true, PU=300, MontoTotal=300 UYU) y las hermanas quedan
consolidadas. Restaurado el pedido a "Por área" (USD 1.71) al terminar, con la línea PRO en
$0 pero presente — listo para que un próximo cambio de modo no repita el bug.

## 40. El arreglo anterior dejaba el número correcto en la cuenta equivocada (14-sep-2026)

Apenas arreglada la sección 39, el usuario probó "cubrir con billetera USD" para el 20938 en
vivo y el sistema descontó apenas **US$0.04** en vez de US$1.68. Causa: el arreglo anterior
actualizaba `MovImporte` con el número nuevo de la cotización (1.68, en dólares) **pero dejaba
el movimiento en la cuenta donde ya vivía** — una cuenta en PESOS (el pedido había cotizado en
pesos en algún momento anterior de la sesión). Cualquier código que después convierte ese
movimiento a otra moneda (como `consumirDesdeSaldo`, la pantalla de "cubrir con cuenta
elegida") le pregunta a LA CUENTA qué moneda es — no a la cotización — así que tomó "1.68"
como si fueran 1.68 PESOS y los convirtió a dólares: 1.68 ÷ 40.82 ≈ 0.04.

Decisión del usuario: "borrón y cuenta nueva" — si la cotización cambió de moneda respecto a
la cuenta donde vive el cargo, no convertir el número a mano ahí adentro (deja un valor
mintiendo sobre su propia moneda); **anular el movimiento viejo y recrearlo entero en la
cuenta de la moneda correcta**.

Fix en `propagarCotizacionADeposito` (`quotationController.js`): antes de pisar el importe,
compara la moneda de la CUENTA donde vive el movimiento contra la moneda actual de la
cotización.
- **Si coinciden** (el caso de siempre): sigue igual que antes — solo actualiza el importe in
  place.
- **Si NO coinciden**: `anularMovimiento` el viejo (revierte su cuenta sola, con
  `contabilidadService.anularMovimiento` — ya existía, hace exactamente esto), busca/crea la
  cuenta de la moneda correcta (`obtenerOCrearCuenta`) y `registrarMovimiento` uno nuevo ahí,
  por el monto real. La deuda (`DeudaDocumento`) sigue el mismo criterio: si no tuvo pagos
  parciales, se mueve a la cuenta nueva con el importe correcto (mismo cuidado que ya usa
  `crearDeudaDocumento`: si tuvo pagos, no se pisa a ciegas, se avisa para revisión manual).

Verificado en vivo contra el 20938 (real, con corrección incluida): se deshizo el consumo mal
calculado (-0.04, devuelto a la billetera), se re-disparó el guardado, y esta vez armó
`MovId 48382` (ORDEN, -1.68) en la cuenta DINERO_USD real — no la billetera — anulando el
48380 viejo (cuenta en pesos). La deuda vieja (#12593) quedó CANCELADA en $0, la nueva
(#12594) PENDIENTE por US$1.68 en la cuenta correcta — sin duplicar el total. Repetida la
simulación exacta de la query de cobertura del portal: ahora lee `MonIdMoneda=2, MovImporte=
-1.68` — el checkout mostraría "US$1.68" de verdad.

**Pendiente, explícitamente anotado, no confirmado todavía**: al facturar en caja, ¿la deuda
que nace al entrar a depósito (como la #12593/#12594 de este pedido) se cierra sola o puede
convivir con una deuda nueva atada al documento de la factura? Es la duda que quedó del
intercambio anterior sobre "Deuda que reaparece = DeudaDocumento duplicada" — sin tocar
todavía, a revisar aparte.

## 41. Había una SEGUNDA copia del mismo bug — y un tercer bug de fondo (14-sep-2026)

El usuario preguntó, con buen instinto: "en Caja hay un editar para modificar las líneas de
una orden — ¿eso puede dejar los saldos descuadrados?". Sí: `editarCostoOrden`
(`ordenesRetiroController.js`, la pantalla "Editar órdenes del retiro" de Caja) es una función
**completamente aparte** de `quotationController.js`, con su propia copia pegada de la misma
lógica — y tenía los MISMOS dos bugs de las secciones 37 y 40 (buscaba el movimiento solo por
el ID de `OrdenesDeposito`, y pisaba el importe sin convertir si la moneda cambiaba). Se
arregló igual: `buscarMovContable` ahora busca por los dos IDs (reutiliza el helper
`buscarOrdenErpId` que ya existía en el archivo), y `editarCostoOrden` hace el mismo
"anular y recrear en la cuenta correcta" cuando la moneda cambió.

Al arreglar esta segunda copia apareció un **tercer bug, más de fondo, en las dos**: tanto acá
como en `propagarCotizacionADeposito` (sección 37), el ajuste de precio hacía `CueSaldoActual
= CueSaldoActual - delta` a mano. Pero el usuario preguntó por separado: *"¿por qué no veo
saldo negativo en la billetera cuando la orden entra a depósito?"* — y la respuesta está
escrita, literal, en `SP_RegistrarMovimiento` (el procedimiento que graba TODOS los
movimientos, arreglado el 05-sep): **"las ORDEN/ORDEN_ANTICIPO NO mueven el saldo guardado —
se cobran al facturar; si se restan acá Y otra vez al facturar, la deuda se cuenta dos
veces"**. O sea: la CREACIÓN del cargo (vía `receiveDispatch`) ya respeta esta regla desde el
5 de setiembre — pero las pantallas que EDITAN el precio después (las dos de arriba, y
`anularMovimiento`, la función genérica que usa mi propio arreglo de "anular y recrear") nunca
se actualizaron y seguían moviendo el saldo a mano. Efecto real visto en vivo: cada vez que se
editaba el precio de una orden ya en depósito, la cuenta del cliente ganaba o perdía saldo sin
que nadie pagara ni cobrara nada — un crédito/débito fantasma.

Fix, en el lugar correcto (la función compartida, no cada copia):
- `anularMovimiento` (`contabilidadService.js`) ahora lee el `MovTipo` del movimiento antes de
  revertir saldo, y **no lo toca** si es `ORDEN`/`ORDEN_ANTICIPO` — mismo criterio que el SP.
- Se sacó el `UPDATE CuentasCliente SET CueSaldoActual = CueSaldoActual - @Delta` de las dos
  ramas "misma moneda" (`propagarCotizacionADeposito` y `editarCostoOrden`) — ya no existe en
  ninguna de las dos.

Verificado en vivo contra el 20938 con `editarCostoOrden` (la de Caja): subir el precio de $3
a $50 y volver a $3 dejó `CueSaldoActual` de la cuenta principal en US$0,00 todo el tiempo —
antes hubiera quedado con un crédito fantasma. La deuda formal (`DeudaDocumento`) sigue
reflejando bien el pendiente real (US$3,00, una sola fila viva) — es el único lugar donde
corresponde verlo, tal como muestra el panel "Pendiente Facturar" del cliente.

Se limpiaron a mano los rastros de saldo fantasma (+2,32 / +4,68 / +421,68 en distintas
cuentas) y las filas de `DeudaDocumento` duplicadas que quedaron de las pruebas de ESTA
sesión, hechas antes de encontrar el bug real — no eran plata real del cliente, eran
artefactos de las pruebas. `vite build` no aplica (todo backend). `node -e "require(...)"` en
los 3 archivos tocados, sin errores de sintaxis.

## 42. Freno: no editar el precio de una orden ya entregada o cobrada (14-sep-2026)

Encontrados dos bugs más siguiendo la misma línea de preguntas del usuario:

1. **`resincronizarConsumosBilletera` (contabilidadService.js) tenía el MISMO saldo
   fantasma, en DOS lugares más** — la parte "resto sin cubrir por la billetera" (tipo
   ORDEN) y su "espejo marcado" también movían `CueSaldoActual` a mano, inconsistente con la
   propia función unas líneas más abajo (que SÍ pasa por el procedimiento correcto al crear
   una ORDEN nueva). Sacado — ya no toca saldo en ninguno de los dos casos.

2. **Faltaba un freno real: nada impedía editar el precio de una orden ya ENTREGADA o
   COBRADA.** `detectarEstadosSensibles` (quotationController.js) ya sabe detectar estos
   casos (además de FACTURADA) — pero solo protegía si el caller pasaba
   `propagarADeposito=true` (la pantalla vieja de Administración de Órdenes); tanto el
   guardado automático de cotización (`propagarCotizacionADeposito`) como "Editar órdenes
   del retiro" en Caja (`editarCostoOrden`) lo esquivaban. De paso, el chequeo de FACTURADA
   que sí tenían ambas funciones también tenía el bug del ID único de las secciones
   37/41 — podía no encontrar la factura real y dejar pasar el cambio igual.

   Fix: las dos funciones ahora chequean `OrdEstadoActual=9` (ENTREGADA) y `PagIdPago`
   (COBRADA) antes de tocar nada, con el mismo criterio dual-ID ya corregido para
   FACTURADA. `propagarCotizacionADeposito` (automática, corre en cada guardado) SALTEA la
   orden en silencio, igual que ya hacía con FACTURADA. `editarCostoOrden` (acción directa
   del usuario en Caja) **rechaza la edición entera** con un mensaje claro.

   **Encontrado de pura casualidad, verificando el freno**: el pedido 20938 (el de prueba de
   toda la sesión) YA estaba genuinamente en estado "Entregada" — no fue una simulación, era
   su estado real. Confirmó el freno con datos reales sin querer.

   **Efecto secundario detectado, no resuelto todavía**: `propagarCotizacionADeposito` frena
   bien a `OrdenesDeposito` — pero `saveQuotation` (la función que la llama) sigue guardando
   igual el precio nuevo en `PedidosCobranza`/`PedidosCobranzaDetalle`, aunque depósito lo
   haya rechazado. Resultado: la pantalla de "Confirmación de Cotización" puede terminar
   mostrando un total que NO coincide con lo que depósito/caja tienen (ej. cotización dice
   3108, depósito sigue en 3, correctamente protegido). No se tocó — decidir si la cotización
   en sí también debería rechazar el guardado cuando alguna de sus órdenes ya está entregada
   o cobrada, o si alcanza con que depósito quede protegido y la cotización quede "a mano" del
   que factura corregirla antes de mandarla a un documento real.

Verificado en vivo contra el 20938 real: simulando ENTREGADA y COBRADA con `editarCostoOrden`,
la edición se rechaza y `OrdCostoFinal` no se mueve; guardando la cotización con la orden
real ya entregada, `propagarCotizacionADeposito` la saltea (`motivo: 'ENTREGADA'`) y
`OrdCostoFinal` se mantiene en US$3 — mientras que la cotización sí cambió (efecto
secundario de arriba, restaurado a mano). Estado final del 20938 reconciliado: USD 3.00 en
las 4 tablas, saldo en $0, billetera intacta en US$6.69.

## 38. La línea de PRO en "Precio establecido" quedaba editable — y romperse sola (14-sep-2026)

Consecuencia directa de la sección 37: con la línea de PRO ahora siempre presente, el usuario
vio que en "Precio establecido" arrancaba en `Cantidad: 1` (fijado por el `useEffect` de modo,
`Cantidad:1, PrecioUnitario:monto` — el pedido vale ESE monto, no "monto por prenda") y, al
intentar cambiarla a la cantidad real de prendas, el precio se le iba a $0.

Causa: el campo Cantidad de esa fila seguía editable, y cualquier cambio dispara
`handleRecalculateLine` → `/prices/calculate` con el artículo real (`PPERS`, "Prenda
Personalizada (sin catálogo)") — que no tiene un precio de lista propio (vale $0 en el
catálogo; el monto pactado es SIEMPRE manual). El recálculo pisaba el monto pactado con el
precio real del artículo (0), sin avisar.

Fix en `QuotationEditModal.jsx` (`LineRow`): la fila de la orden madre PRO ahora queda
bloqueada (Cantidad, Precio U., Moneda, Descuento/Recargo, Facturable — toda la fila) cuando
el modo es "Precio establecido" — el monto se sigue editando en un solo lugar: el input de
arriba, al lado del botón de modo. Un tooltip en el campo Cantidad lo explica. Nuevo prop
`modoFacturacion` pasado a `LineRow` (antes no lo tenía). `vite build` OK.

## 39. Cambiar la moneda de la línea de PRO no convertía el número (14-sep-2026)

El usuario preguntó, mirando la línea consolidada de PRO (UYU 68.40, sin `PrecioLista`):
"¿si acá cambio la moneda no me varía el precio?" — pregunta bien hecha: **no la convertía**.
El selector de Moneda tenía dos casos (precio tipeado a mano → solo cambia la etiqueta;
precio con lista de catálogo → recalcula contra el motor) pero NINGUNO cubría el caso de esta
línea: sin `PrecioLista` (es un compuesto — "Base $0 + Personalizaciones") y no marcada como
manual (`PerfilAplicado='Precio Base'`, no `'Manual'`). Caía en el primer caso "por default" y
solo re-etiquetaba: pasar de UYU a USD hubiera dejado el mismo "17,1" pero como USD — 27 veces
más caro sin que nadie lo pidiera.

Tampoco servía mandarla a recalcular contra el motor (la otra rama): PPERS no tiene precio de
catálogo propio (vale $0), así que un recálculo real la hubiera vuelto a pisar a $0 — mismo
patrón de bug que la sección 38 con la Cantidad.

Fix en `QuotationEditModal.jsx` (`LineRow`, selector de Moneda): tercer caso explícito — sin
lista y sin ser manual, se CONVIERTE el número existente con la cotización del día
(`convertirMoneda`, ya usado en otras partes del archivo), sin tocar el motor de precios.
`vite build` OK.

Verificado con `test-quotation-reconstruir.js` contra el pedido real 20936: se guardó sin la
línea SUB-20936 (confirmado ausente), se llamó a "Reconstruir líneas", y volvió sola — con la
Cantidad real (0.3, la Magnitud de la orden) y el precio recalculado por el motor real
(9.00, con "Descuento Trabajadores 10%" aplicado automáticamente, no a mano). BOR-20936
siguió intacta. Restaurado el pedido a su MontoTotal original (3.83) al final.

Verificado con `test-quotation-no-inserta-no-facturables.js` contra el pedido real 20936:
guardar con SUB-20936 marcada no-facturable hace que DEJE de aparecer en `getQuotation`
(antes solo se ocultaba); volver a guardar con el payload original la trae de vuelta
(recuperable DENTRO de la misma sesión de edición, mientras el dato siga en el estado del
frontend — el riesgo real es cerrar sin guardar o perder ese estado). Efecto colateral
verificado y aceptado: el guardado de esta prueba limpió de paso 3 líneas viejas en $0 que
databan de antes de hoy (PRO-20936, COR-20936, COS-20936, ambas falla -F1107/-F1215) —
MontoTotal se mantuvo en 3.83 (correcto, esas líneas nunca sumaban). `vite build` OK.

**Corrección sobre la marcha**: el primer fix de "Agregar línea" (arriba) solo cubría la
entrada desde `ProBandeja.jsx` (`areaFilter="TODOS"`). El usuario lo probó en vivo desde OTRA
entrada — el botón "Editar Cotización" del toolbar de PRO (`AreaView.jsx` → `QuotationView` →
`QuotationEditModal`, que pasa `areaFilter="PRO"`, no `"TODOS"`) — y seguía sin encontrar
nada al buscar "dtf" pese a haber 35 coincidencias reales en el catálogo. Causa: con
`areaFilter="PRO"`, `forceArea` quedaba en `'PRO'` (la condición original solo exceptuaba
`'TODOS'`), así que el buscador filtraba el catálogo a `AreaID='PRO'` — que no tiene productos
propios — sin importar el texto buscado. El archivo YA tenía el concepto correcto en otro
lado (`esVistaConsolidadaPro`, usado para permitir EDITAR líneas existentes) pero nunca se
había aplicado al buscador de "Agregar línea". Fix: tanto `forceArea` como `isAdmin` ahora
tratan `areaFilter==='PRO'` igual que `'TODOS'` (sin restricción) — `AreaView.jsx` solo abre
esta pantalla con `areaFilter='PRO'` cuando `isPro` (o sea, siempre es la vista consolidada
del pedido completo, nunca una restricción real a "solo catálogo de PRO"). `vite build` OK.

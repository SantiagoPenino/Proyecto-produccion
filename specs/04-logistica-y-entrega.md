# Spec 04 — Logística, Depósito y Entrega

> Nivel: negocio. Sin nombres de tablas, columnas ni funciones.
> Entidades definidas aquí: **Bulto**, **Remito**, **Orden en Depósito**, **Retiro**,
> **Estante**, **Encomienda**, **Canasto**.
> Referencia entidades de otras specs: Pedido, Orden, Área, Cliente, Deuda, Ciclo, Plan.

## 1. Los cuatro objetos del dominio

| Objeto | Qué es |
|---|---|
| **Bulto** | La caja/paquete físico con etiqueta y QR; la unidad que se pistolea. |
| **Remito** | El documento de traslado de un lote de bultos entre dos puntos (origen → destino), con firma de salida y de recepción. |
| **Orden en Depósito** | El registro comercial de la orden ya recibida en el depósito central: lo que se cobra, se avisa y se entrega. |
| **Retiro** | La "bolsa de entrega": agrupa órdenes en depósito de un mismo cliente para un solo acto de entrega (mostrador o encomienda). |

- **INV-LOG.01** *(Lección estructural)* En el sistema actual, el identificador de orden de
  un Bulto de encomienda apunta al **Retiro**, no a la Orden — una columna que apunta a dos
  tablas según contexto, que obliga a excluirla en cada consulta y colgó encomiendas ajenas
  de órdenes nuevas. **El sistema nuevo debe separar esas referencias en campos/relaciones
  distintas.**

## 2. Salida de producción: canastos

- **RN-LOG.01** Al controlar el último archivo de una orden, el sistema la ubica en un
  **canasto físico**: *Incompletos* (faltan archivos), *esperando* (orden OK pero el pedido
  no está completo en el área), *Falla / Esperando Reposición* (hay fallas — y si una
  hermana tiene falla, la orden sana también espera), o *Producción* (= lista para
  despachar). Las órdenes de falla interna van a su canasto propio, se finalizan solas y
  **nunca viajan solas**: su material se incorpora a la orden madre. Resuelto el pedido,
  las retenidas se liberan en bloque.

## 3. Bultos y etiquetas

- **RN-LOG.02** El bulto nace en el área productora, en stock, con **tipo de contenido**
  según su próximo destino: hacia Depósito = producto terminado (único tipo que dispara
  las reglas de pedido completo); hacia otra área = en proceso (insumo).
- **RN-LOG.03** **Auto-consumo**: al etiquetar, el área marca como consumidos los bultos
  del mismo pedido llegados de **otras** áreas (insumo ya transformado). Los hermanos de la
  **misma** área (multitela) no se consumen: son producto terminado propio y debe poder
  viajar.
- **RN-LOG.04** Multi-bulto: la cantidad se calcula por metros-por-bulto (configurable por
  área) o se fija a mano; cada bulto lleva numeración n/m. Regenerar etiquetas rehace la
  tanda (con rastro forense); agregar un bulto preserva los impresos y recalcula el total;
  los retornos de servicios externos abren una tanda nueva dejando la anterior como
  historia.
- **INV-LOG.02** **El QR de la etiqueta es por Orden, no por Pedido**: lleva código,
  cliente, trabajo, producto, cantidad e importe **de esa orden**. (El QR del pedido
  repetido en todas las hermanas duplicaba el importe del retiro.)
- **RN-LOG.05** No se etiqueta sin número de pedido ni sin cotización válida (importe > 0),
  salvo los casos donde el $0 es intencional (reposiciones, prepago, terminaciones,
  hermanas de personalización).

## 4. Remitos y transporte

- **RN-LOG.06** Al armar un remito, marcar un bulto **auto-selecciona todos los hermanos
  del mismo pedido en esa área** (agrupación Pedido + Área) con aviso explícito. Un remito
  por destino. El remito nace "esperando retiro"; sus bultos pasan a en-tránsito y las
  órdenes a "en tránsito".
- **RN-LOG.07** **Firma de salida**: el transportista pistolea bulto por bulto (código
  ajeno se rechaza) y firma con usuario y contraseña; queda estampado quién firmó. Escaneo
  completo ⇒ en tránsito; parcial ⇒ en tránsito parcial con el detalle N/M.
- **INV-LOG.03** **No se puede firmar la salida de un remito que el destino ya recibió
  completo** (conflicto explícito): firmar tarde lo "resucitaba" en la bandeja de
  recepción. Recibido parcial sí admite un segundo viaje.
- **RN-LOG.08** **Recepción**: el destino pistolea; alertas forzables si nadie firmó la
  salida o si el remito era para otra área. Cada bulto vuelve a stock del receptor; lo no
  escaneado puede cerrarse como **perdido** (irreversible en la operación, con bandeja de
  extraviados y recuperación). El remito queda recibido parcial o total.
- **RN-LOG.09** En destinos intermedios la orden pasa a "recibido en destino" (solo desde
  "en tránsito"). Ganchos de recepción: recibir material en Terminaciones habilita la
  hermana de terminaciones en su bandeja; al recibir se auto-cumplen los **requisitos de
  producción** de la orden destino según lo que el área origen declara entregar.
- **RN-LOG.10** **Despacho por pedido completo** (solo producto terminado; insumos y
  encomiendas nunca se bloquean): hacia Depósito exige el pedido completo **global**; hacia
  otra área, completo **en esa área**; y además "el pedido sale completo del área" (no se
  crea remito dejando bultos hermanos en stock fuera de la selección; las fallas internas
  no obligan). Excepción configurada: áreas con **despacho parcial** habilitado pueden
  enviar tandas a otra área (nunca a Depósito); la orden pasa a en-tránsito recién cuando
  sale su último bulto.
- **RN-LOG.11** **Control manual de armado** (prendas/combos): el remito final hacia
  Depósito no se arma solo — el responsable aprueba el pedido reunido físicamente,
  verificado por **ubicación real de los bultos** (no por estado: "en tránsito" contaba
  como pronto y salían remitos parciales). Al aprobar se genera el bulto consolidado sobre
  la orden madre, se consumen los componentes y se arma el remito, con re-verificación.

## 5. Depósito central

- **RN-LOG.12** El check-in en depósito es **el punto de conversión de mercadería a
  plata**: valida pedido completo global, cuenta los bultos del pedido, contabiliza, crea
  la Orden en Depósito (importe, cantidad, producto, moneda, lugar de retiro por defecto) y
  la deja habilitada para el aviso. Dos vías: con remito (primero el check-in logístico,
  después la carga comercial — orden invertido a propósito para que nunca exista una
  ventana donde el aviso salga antes de tiempo) y pistoleo directo del QR (validado contra
  la base; reingreso de una entregada la reactiva explícitamente).
- **RN-LOG.13** **Esperar bultos**: el conteo es **por Pedido** — bultos de producto
  terminado vivos de todas las hermanas no canceladas, excluyendo los ya procesados
  (etapas previas) y los de **fallas internas** (nunca viajan; contarlos clavaba pedidos
  esperando un bulto imposible). Mientras falte alguno: la orden queda **Esperando
  Bultos** con contadores esperados/recibidos, **sin contabilizar, sin cargo y sin
  aviso** (si no había fila, se crea en ese estado para que sea visible). Al completar, se
  procesan **todas las hermanas juntas** — sin retroceder a las que ya avanzaron. Bandeja
  propia con días de espera y botón **Forzar** (fuerza el pedido entero, avisado en el
  confirm).
- **RN-LOG.14** **Qué no genera fila propia en depósito**: fallas internas (trabajo
  interno); hermanas de terminaciones (el cliente retira la orden madre; una fila propia
  duplicaba el aviso y mostraba líneas fantasma); hermanas de prenda personalizada — cuyo
  registro se **redirige a la madre** (excluirlas sin redirigir dejaba pedidos sin cobrar
  ni avisar si la última en llegar era una hermana). Las **reposiciones de cliente sí**
  generan fila, siempre con **costo 0**.
- **INV-LOG.04** **Hoja de ruta**: el paso Depósito sale **únicamente** de la Orden en
  Depósito; sin fila = "pendiente a recibir". **Nunca** se usa el estado del bulto como
  sustituto (un bulto puede figurar entregado por logística sin que la orden haya
  ingresado). Un paso con varias órdenes se muestra tan avanzado como la más atrasada;
  con combos la ruta es un grafo con ramas y convergencia, no una fila.
- **RN-LOG.15** **Auditoría de depósito**: inventario físico vs sistema con escaneos en
  vivo compartidos entre operarios; clasifica en OK / falta / sobra / desconocido /
  olvidadas (más de N días configurables) / **entregadas sin pago**. Esta última cruza
  contra el documento vinculado para no acusar en falso a los clientes de cuenta corriente
  (el cobro salda el documento, no estampa pago en la orden): distingue pagado, facturado
  impago, en cuenta corriente sin facturar y genuinamente pendiente.
- **RN-LOG.16** Acciones en lote de la auditoría: marcar entregado (órdenes + retiros +
  estantes + bultos + estado global); devolver a depósito (con intento de auto-aprobación
  por anticipo; si no alcanza, vuelve a pasar por caja); **avisar nuevamente** con guarda
  dura (jamás toca entregadas/canceladas/perdidas — incidente de ~60 re-avisos) y rastro en
  historial; email de aviso que **no** cambia estados.

## 6. Retiros

- **RN-LOG.17** El Retiro se arma con órdenes en depósito del mismo cliente (identificadas
  por el QR por orden), lugar de retiro y datos de envío si corresponde. **Guard
  anti-duplicado**: se excluyen órdenes ya tomadas por un retiro activo.
- **RN-LOG.18** **Moneda del retiro**: si alguna orden hija está en dólares, el retiro
  entero es en dólares. **Las órdenes hijas son la fuente de verdad**; lo que manda la
  pantalla es sugerencia.
- **RN-LOG.19** El estado inicial del retiro lo decide la **cascada de cobertura**
  (Spec 05 §7): todo cubierto ⇒ Abonado; crédito ⇒ Autorizado; sin cobertura ⇒ frena y
  pasa por caja. La señal fiable en clientes rollo es el **costo de la orden** (0 = la
  cubrió el rollo), no el tipo de cliente. Los clientes semanales no aparecen en caja por
  defecto (se cobran por ciclo).
- **RN-LOG.20** **Empaque y estantes**: un retiro ocupa un solo estante; el estante lo
  determinan los últimos dígitos del número de retiro (rangos por letra); **un casillero no
  mezcla clientes**. Al empaquetar, el estado (empaquetado con o sin abono) se decide por
  el pago **verificado en base**, no por la pantalla. Desasignar reconstruye el estado
  anterior desde el historial.
- **RN-LOG.21** **Gate de entrega**: no se entrega un retiro ni pagado ni autorizado
  ("debe pasar por caja"), salvo cliente semanal. La entrega con deuda exige **contraseña
  de autorización** y queda en un libro de retiros con deuda (cliente, monto, autorizador,
  explicación obligatoria).
- **RN-LOG.22** Entregar libera el estante, marca retiro y órdenes entregados y sincroniza
  el estado global de producción. La entrega múltiple es **una transacción por retiro**
  (una transacción global tardaba más de un minuto y bloqueaba caja y facturación; se
  acepta la entrega parcial informada).
- **RN-LOG.23** **Anular un retiro** exige motivo y está **bloqueado si ya fue entregado o
  tiene pago registrado**. Al anular, las órdenes se desvinculan y vuelven a disponibles,
  y se libera el estante. Desvincular la última orden cancela el retiro.
- **RN-LOG.24** **Encomienda** = un retiro cuyo destino no es el local: al despacharse se
  materializa como un bulto tipo encomienda en un remito hacia agencias externas y el
  retiro pasa a **En viaje** (bloqueado para re-despachar). La entrega final exige
  **comprobante** (foto) por bulto, visible también en el portal. El remito impreso se
  agrupa por agencia, con dos firmas y el sello pagado/pendiente por retiro.
- **RN-LOG.25** Cuando el cliente se anuncia (tótem), se imprime ticket y se **canta el
  número por voz**, distinguiendo retiro de encomienda.

## 7. Contabilización en el check-in

- **RN-LOG.26** El disparo contable ocurre en el **check-in en depósito**, no en la
  entrega. Si el pedido ya estaba contabilizado y cambió monto o metros, se emite primero
  una **reversa automática** (mismo cargo en negativo, rotulado) y luego el cargo nuevo.
  Queda marca de contabilizado (monto y metros) para no duplicar en el siguiente check-in.
- **INV-LOG.05** Se contabilizan **solo las líneas de esa orden**, nunca del pedido entero
  (recorrer las líneas del pedido por cada hermana descontó telas N veces y sumó el
  importe del pedido completo en cada orden — incidente real).
- **INV-LOG.06** **Conversión de moneda por línea**: cada línea puede estar en otra moneda
  que la cabecera; sumar en crudo cobró pesos como dólares (importes ~20× — incidentes
  documentados con corrección manual de 10 órdenes). Toda suma cross-moneda convierte
  línea por línea con su cotización.
- **RN-LOG.27** Con plan de metros: cobertura total ⇒ evento de entrega a $0 (descuenta
  metros, sin deuda); parcial ⇒ dos eventos (metros cubiertos a $0 + cargo por el
  excedente); sin plan ⇒ cargo por el importe, **en una sola llamada por orden**.
- **RN-LOG.28** Los caminos de pago (caja, pasarelas, retiros web) marcan la vista de
  cobranza como pagada y la anulación la devuelve a pendiente — es la vista que leen caja,
  portal y tótem.

## 8. Interacciones

| Módulo | Interacción |
|---|---|
| Producción (Spec 03) | Canastos de salida; requisitos auto-cumplidos al recibir; control de armado. |
| Caja (Spec 05) | Cascada de cobertura del retiro; gate de entrega; exoneraciones y cancelaciones. |
| Contabilidad (Spec 06) | Evento contable en el check-in; reversa automática; "entregadas sin pago". |
| Portal/Tótem (Spec 10) | Aviso WhatsApp con sus gates; anuncio del cliente; comprobante de encomienda visible. |
| Recursos (Spec 07) | Cobertura por plan en el check-in; descuento de metros. |

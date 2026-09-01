# Spec 06 — Facturación Electrónica (CFE) y Contabilidad

> Nivel: negocio. Sin nombres de tablas, columnas ni funciones.
> Entidades definidas aquí: **Documento**, **Línea de Detalle**, **Deuda**, **Pago**,
> **Ciclo de Facturación**, **Nota de Crédito**, **Asiento**, **Cuenta Contable**,
> **Evento Contable**, **Empresa Emisora**, **Recibo**.
> Contexto: facturación electrónica uruguaya (CFE) vía un proveedor homologado ante DGI.

## 1. Tipos de documento

- **RN-FAC.01** Documentos **fiscales** (viajan a DGI): e-Ticket y e-Factura (contado o
  crédito), Nota de Crédito y Nota de Débito de cada familia — cada uno con su código CFE
  oficial. Documentos **no fiscales** (nunca van a DGI): **Pedido Caja** (borrador interno
  de venta; debe convertirse a e-Ticket/e-Factura para existir fiscalmente), Recibo de
  cobro, Recibo de anticipo (secuencia separada), egresos de caja, y **stubs externos**
  (representan facturas del proveedor anterior, solo para referenciarlas desde una NC).
- **INV-FAC.01** La familia del CFE de una venta **la decide el tipo elegido por el
  operador, no el RUT del cliente** (un e-Ticket a un cliente con RUT no se eleva solo).
  En una NC/ND la familia **la impone el documento referenciado**, descrito tal como DGI lo
  tiene registrado.
- **INV-FAC.02** *(Lección crítica)* El tipo de documento truncado por un campo corto hizo
  que durante meses las NC se emitieran ante DGI **como ventas**. En el sistema nuevo el
  tipo es un **nomenclador con clave estable**, jamás texto libre truncable; y al emitir se
  **guarda el tipo CFE efectivamente pedido a DGI** para auditoría.

## 2. Ciclo de vida del CFE

```
BORRADOR (solo Pedido Caja) → convertir
PENDIENTE  → editable, anulable, retrofechable
   → vista previa DGI → envío → ACEPTADO_DGI (CAE + número oficial + QR + fecha DGI)
   → rechazo: queda PENDIENTE con el mensaje; se corrige y reenvía
ANULADO (solo si NUNCA llegó a DGI)
```

- **INV-FAC.03** Un documento **aceptado por DGI no se edita ni se anula**: la única
  reversa es la Nota de Crédito.
- **RN-FAC.02** El **número oficial DGI** (serie + número, del CAE) no tiene relación con
  el número interno; siempre que exista, es el que se muestra al cliente (email, PDF,
  exports). La **fecha real DGI** se extrae del QR del CFE.
- **RN-FAC.03** **Bandeja CFE**: filtros por fecha, estado DGI, tipo, empresa, medio de
  pago y cliente; buscador puntual que ignora el rango de fechas (por número interno, de
  retiro o de orden); muestra los retiros asociados por fila; acciones de PDF, vista previa
  DGI, envío individual y en lote (excluyendo borradores), edición, anulación, copia, NC y
  email.
- **RN-FAC.04** **Cuadre pre-DGI**: la vista previa y el envío usan **la misma
  preparación** del payload (lo que se audita es lo que viaja). Bloqueos antes de tocar al
  proveedor: documento sin líneas; **líneas ≠ total del documento** (tolerancia mínima por
  redondeo de IVA por línea — los incidentes reales son de 2× o 40×); NC/ND sin referencia;
  NC de e-Factura sin RUT válido; empresa emisora no configurada; documento ya aceptado.
- **RN-FAC.05** Validaciones de receptor: e-Factura exige RUT válido (con dígito
  verificador); e-Ticket sobre el **umbral en unidades indexadas** (parámetros
  configurables, con conversión de moneda) exige identificar al comprador — validado sobre
  el receptor que **realmente viaja**.
- **RN-FAC.06** Matemática DGI: 2 decimales estrictos; cantidad × precio unitario exacto;
  IVA exacto sobre el neto; **las líneas en 0 se rechazan**; la forma de pago ante DGI la
  define el tipo del documento, no si ya se cobró.

## 3. Líneas de detalle

- **RN-FAC.07** Un resolvedor **centralizado y único** arma el detalle desde una
  transacción de caja (cascada: relación moderna retiro→órdenes, vínculo legacy,
  referencia directa) o desde una lista de órdenes. El precio sale del pedido de cobranza,
  con fallback al costo de la orden y por último al importe de la transacción.
- **RN-FAC.08** Cada línea lleva: nombre del ítem (con descarte de nombres basura del
  catálogo, tope de caracteres DGI), descripción con **código de orden y número de retiro
  siempre**, cantidad, unitario, neto, IVA y total; y el **área/sector estampado en un
  paso posterior idempotente** (cascada orden → artículo → prefijo) que nunca rompe la
  venta.
- **INV-FAC.04** **Exclusiones duras**: reposiciones sin cargo (dejarlas caía al importe
  del pedido entero), órdenes cubiertas por rollo (cada una salía por el **total del
  retiro**), líneas hermanas ya consolidadas en el producto (se duplicaba el detalle),
  órdenes ya facturadas y órdenes cubiertas por cuenta. Un $0 en una orden que **no** es
  reposición sí se muestra: es señal de error, no se oculta.
- **RN-FAC.09** **Cotización implícita del cobro**: las líneas en otra moneda se convierten
  prioritariamente a la tasa a la que la plata entró de verdad (cobrado ÷ suma de líneas);
  fallback a la cotización del día si no hay cobro o si la implícita cae fuera de ±25% —
  se prefiere que el cuadre pre-DGI frene el envío antes que fabricar una línea que lo
  disimule.
- **RN-FAC.10** **Descuento por línea**: el unitario guardado es el **bruto** y el % se
  guarda aparte tal como lo tipeó el usuario (recalcularlo desde importes redondeados da
  10,03% donde había 10%). Al editar, el descuento viaja siempre o se pierde.

## 4. Facturación manual

- **RN-FAC.11** **Fecha de emisión editable** mientras el documento no fue a DGI; se guarda
  con la hora actual del día elegido (preserva orden intradía); propaga a asiento,
  transacción, pago y submayor; jamás toca a DGI.
- **RN-FAC.12** **"Facturar a"** separa el cliente interno (cuenta corriente) del
  **receptor del CFE**: modos "el cliente" (espejo de la ficha, bloqueado), "un tercero"
  (datos DGI escritos a mano, congelados en el documento, jamás propagados a la ficha
  salvo pedido explícito) y "consumidor final". El **nombre de fantasía** es un campo del
  documento, distinto de la ficha.
- **RN-FAC.13** **Consumidor final**: existe una ficha genérica compartida **sin cuenta
  corriente** (no registra movimientos ni deudas). Un e-Ticket sin RUT propio en el
  documento es venta a consumidor final y **no hereda el RUT de la ficha**. Una e-Factura
  **no puede** ser consumidor final. Defaults por tipo (e-Ticket nace final, e-Factura
  identifica), re-aplicados al cambiar de familia. La ficha genérica no se actualiza desde
  una factura.
- **INV-FAC.05** Candados de edición: una NC/ND **no cambia de tipo** al editarse; no se
  devuelve a pendiente una factura con **cobro real imputado** sin confirmación explícita
  logueada; **cabecera y detalle deben cerrar por el mismo importe** (el PDF imprime la
  cabecera pero DGI suma las líneas); los pagos intactos se preservan (mantienen vínculo a
  órdenes y retiros); **cambiar la moneda migra la deuda y los movimientos** a la cuenta de
  la nueva moneda; contado⇄crédito convierte pago⇄deuda.
- **RN-FAC.14** Numeración: cada tipo tiene su secuencia, incrementada dentro de la
  transacción; **todos los caminos de emisión comparten el mismo numerador** por tipo
  (caja, manual, cierre de ciclo) — nunca dos contadores que colisionen.

## 5. Deudas y pagos

- **RN-FAC.15** La **Deuda** de un documento: su moneda **la hereda de la cuenta** donde
  vive; su fecha es **la del documento** que la origina (no la de hoy — si no, las deudas
  viejas nacían "al día" y no se reclamaban); el vencimiento sale de la condición de pago
  de la cuenta.
- **INV-FAC.06** **Un documento, una sola deuda viva** (guard de idempotencia: si existe,
  se actualiza; si ya tuvo cobros imputados, no se toca). La violación duplicó deudas que
  los pagos nunca mataban.
- **RN-FAC.16** Al nacer una deuda se **auto-consume el saldo a favor** del cliente
  (pago sintético de anticipo aplicado), con el saldo **recalculado desde los
  movimientos** — nunca desde el acumulado guardado.
- **RN-FAC.17** Cobros: selección de varias deudas y varios medios; moneda base = la de
  las deudas; imputación por antigüedad; excedente a saldo a favor; a crédito no se exige
  medio; recibo correlativo; reintentos seguros ante bloqueo (la transacción entera se
  revierte). Diferencias de cambio y ajuste de caja: Spec 05 (RN-CAJA.16/25).
- **RN-FAC.18** **Anulación** (solo pre-DGI) revierte: transacción, pagos, movimientos de
  cuenta (y por ende saldos), deuda del documento, deudas individuales de las órdenes
  absorbidas (vuelven a pendiente), vínculos de los movimientos de orden/entrega (se
  **liberan**, no se anulan: vuelven a "pendiente de facturar"), asiento, y la compra de
  recurso que la venta hubiera creado.
- **INV-FAC.07** **La anulación jamás retrocede estados físicos**: un retiro entregado no
  se "des-entrega", una orden retirada no revive; solo se revierte el estado que puso el
  pago, y al historial va únicamente lo que realmente cambió.

### 5.1 Gestión de vencimientos de cobranza — to-be

> Escalamiento: hoy la deuda tiene vencimiento pero nadie lo gestiona (y el vencimiento
> de los documentos a crédito arrastra el bug de quedar igual a la emisión).

- **RN-FAC.26** Las **condiciones de pago** son datos maestros ricos (Spec 21): contado,
  N días, fin de mes + N, y opcionalmente **cuotas** (un documento puede generar varias
  deudas con vencimientos escalonados).
  > DECISIÓN PENDIENTE (negocio): si se habilitan cuotas desde el día uno.
- **INV-FAC.09** El vencimiento de toda Deuda se calcula **desde la fecha del documento
  con su condición de pago** — jamás desde "hoy" ni igual a la emisión en crédito
  (corrige el defecto actual).
- **RN-FAC.27** **Escala de morosidad configurable**: al día → por vencer (N días antes)
  → vencida → morosa (N días de atraso). El estado es derivado y visible en toda
  pantalla que muestre al cliente (360, caja, bandeja).
- **RN-FAC.28** **Gestión activa**: recordatorios automáticos configurables al cliente
  (por vencer / vencida, por email o push — vía Spec 10, con registro en el historial de
  envíos), alerta operativa interna por morosidad que supere umbral (Spec 15), y
  acciones de negocio opcionales por escala: exigir pago antes de nuevos pedidos o
  proponer bloqueo (siempre decisión humana registrada, Spec 26 RN-CRM.10 — nunca
  bloqueo automático silencioso).
- **RN-FAC.29** El reporte de **antigüedad de saldos** (existente) se completa con la
  **agenda de cobranza**: qué vence esta semana y quién debe llamarlo (el vendedor de la
  cartera, Spec 26).

## 6. Ciclos de facturación (clientes semanales)

- **RN-FAC.19** Las órdenes del cliente semanal se acumulan en un **Ciclo abierto**
  (abierto automáticamente al crear la cuenta); el cierre es **manual** con pre-factura:
  edición de precios/cantidades línea a línea (etiquetada como ajuste manual y sincronizada
  al movimiento), descuento global en %, exclusión de movimientos (pasan al ciclo
  siguiente), elección de moneda (mezcla de monedas ⇒ default dólares, forzable) y datos
  DGI solo cuando el tipo los exige.
- **RN-FAC.20** Al cierre entran **solo** movimientos de orden, negativos, sin documento
  asignado y no cubiertos por cuenta; los débitos sueltos (reversas, cruces) quedan fuera
  — inflaban el total y se re-facturaban.
- **RN-FAC.21** **El total facturado es el bruto de órdenes menos el descuento**; los
  pagos recibidos no reducen la factura: definen el **pendiente** (saldo recalculado ≥ 0 ⇒
  pendiente 0; < 0 ⇒ pendiente = |saldo| topeado por la factura). Sin nada que facturar,
  el ciclo cierra **sin documento** y abre el siguiente.
- **INV-FAC.08** **Guard anti-descuadre**: si el total desde los movimientos difiere del
  total de las líneas de la pre-factura (más que la tolerancia), el cierre **se aborta**
  (causa típica: órdenes que entraron después de abrir la pre-factura).
- **RN-FAC.22** El documento de ciclo nace sin marca de pagado (la estampa la caja al
  cobrar) — **salvo** que nazca totalmente cubierto por saldo a favor (jamás pasará por
  caja): ahí se marca pagado al emitir. Las **deudas individuales** de las órdenes
  consolidadas se absorben (se marcan pagadas) para no duplicar la antigüedad.
- **RN-FAC.23** Cierre **cross-moneda**: se busca/crea la cuenta en la moneda destino, el
  documento se convierte con cotización, la deuda vive en la cuenta destino y en la de
  origen queda un **marcador de trazabilidad de importe 0** que **jamás se migra** al
  editar la moneda (migrarlo lo convierte en un segundo cargo).
- **RN-FAC.24** **Anular la factura de un ciclo**: el ciclo queda **anulado** (no se
  reabre, conserva trazabilidad) y sus órdenes se liberan y reasignan al ciclo activo,
  recalculando totales.
- **RN-FAC.25** **Facturar anticipos**: órdenes ya cobradas sin comprobante se facturan
  juntas en un documento **contado** (ya está pagado), reutilizando la maquinaria del
  cierre. Pre-factura multimoneda: las órdenes de otras cuentas se **trasladan** a la
  cuenta base con nota de trazabilidad (sin mover plata) — sin esto quedaban "pendientes
  de facturar" tras haberse cobrado (doble cobro).

## 7. Plan de cuentas, motor y asientos

- **RN-CON.01** El plan de cuentas es administrable: código, nombre, nivel, tipo base
  (activo/pasivo/ganancia/pérdida), moneda, **imputable** (solo las imputables reciben
  asientos; no se des-imputa una cuenta con asientos) y activa.
- **RN-CON.02** **Motor de reglas contables configurable**: cada **Evento Contable**
  (venta, pago, orden, entrega, NC, anticipo…) define en datos sus líneas de asiento
  (cuenta, debe/haber, fórmula del importe) y su comportamiento en el submayor (afecta
  saldo, genera deuda, aplica recurso). Metavalores resueltos en ejecución a la cuenta de
  deudores o caja **de la moneda que corresponda**. Nada de cuentas fijas en el código
  (queda solo un fallback).
- **INV-CON.01** **Partida doble bimonetaria**: todo asiento exige transacción activa,
  mínimo dos líneas, conversión de cada línea a moneda local con **su** cotización, y
  cuadre con tolerancia técnica mínima. Cada línea guarda importe local, importe original,
  moneda y cotización, más la entidad imputada. La cabecera guarda origen, fecha, concepto,
  usuario y transacción.
- **RN-CON.03** Asientos tipo: venta = caja (o **valores a depositar** si es cheque) al
  debe por medio de pago, deudores al haber, más línea de ajuste si no cuadra; venta pagada
  íntegramente con saldo de cuenta = **debe al pasivo de anticipos** (la plata no entró a
  caja); cobro de deuda = caja/valores al debe, deudores al haber, ± diferencia de cambio
  con tope; anticipo = caja al debe, deudores por lo imputado y **pasivo de anticipos**
  por el remanente al haber (en dólares, con cotización obligatoria); NC = inverso de la
  venta — y si su asiento falla, la NC no se frena pero **el error se muestra** (no un log
  silencioso).
- **RN-CON.04** **Libro diario/mayor**: cabeceras paginadas con totales del filtro
  completo; las líneas se cargan al expandir (el libro entero colgaba el navegador);
  filtros por fecha, origen y búsqueda por asiento/operación/concepto/cuenta.
- **INV-CON.02** *(Lección central)* El **saldo acumulado guardado de la cuenta del
  cliente está corrompido** por doble conteo de órdenes abiertas; todos los cálculos
  críticos recalculan el saldo desde los movimientos (todo menos las órdenes abiertas).
  **El sistema nuevo no debe tener un acumulador así, o debe garantizar su consistencia
  por estructura.**

## 8. Multiempresa

- **RN-EMP.01** Dos (o más) **Empresas Emisoras**, cada una con identidad completa (RUC,
  razón social, fantasía, dirección, logo, color) y su **configuración propia del
  proveedor CFE** (URL, usuario, contraseña **cifrada** y jamás devuelta por la API, caja
  emisora, códigos de tasa). Flags activa y por defecto (**solo una** por defecto).
- **RN-EMP.02** La empresa la elige el operador al emitir; sin elección, aplica la
  predeterminada. No se emite si la empresa no existe, no está activa o no tiene caja
  configurada. La empresa condiciona PDF, email, filtros de bandeja y exports (un archivo
  por empresa). Los numeradores CAE se gestionan **por empresa y por tipo** ante DGI, con
  monitoreo de stock y vencimiento.

## 9. Exports y reportes

- **RN-REP.01** **Libro del contador** (solo lectura, formato de importación del estudio):
  libro de **ventas** con **solo documentos aceptados por DGI**, base de fecha
  seleccionable (contable o **fecha real DGI**, con fallback), asiento por CFE (NC
  invertidas), etiquetas por tipo con serie y número **oficiales**; libro de **cobros**
  (pagos del mes sobre facturas de crédito aceptadas). Un archivo por empresa +
  estadísticas de control (sin RUC, sin número oficial, por tipo y medio).
- **RN-REP.02** Definición de "venta" en reportes: facturas y tickets (sin notas) **más
  Pedidos Caja** (excluirlos subestimaba fuerte la venta real); fuera recibos, anticipos,
  egresos y anulados.
- **INV-REP.01** **"Ventas por área" y "ventas por documento" son la misma plata** y deben
  cerrar exacto: cada documento reparte su propio total entre las áreas que tocó,
  proporcionalmente — la igualdad queda garantizada por construcción (sumar subtotales de
  línea directo llegó a inflar 77%).
- **RN-REP.03** Reportes: ventas por área/sector comercial (roll-up configurable de
  áreas) con torta por moneda; enviados vs no enviados a DGI; top clientes **neto de NC**
  (distinguiendo ficha real, mostrador y receptor tercero) con drill-down; top productos;
  resumen mensual con pesos+dólares **unificados a un TC de referencia editable**.

## 10. Notas de crédito

- **RN-NC.01** La NC es la única reversa de un documento aceptado por DGI. Exige el
  **bloque de referencia** al original (tipo tal como DGI lo tiene, serie, número, fecha,
  importe y **moneda del original**). NC de e-Factura exige RUT.
- **RN-NC.02** El total de la NC no supera al del original; puede ser **parcial** (líneas
  editables, nunca por encima del original) o **total** (100%). Efectos: crédito en la
  cuenta del cliente, reducción de la deuda del documento referenciado y asiento —
  excepto sobre el consumidor final genérico (sin cuenta corriente).
- **RN-NC.03** Compra de recurso: NC **total** revierte el plan en la misma operación —
  y **no se emite si el rollo ya fue consumido** (primero revertir consumos); NC
  **parcial** no toca el plan pero avisa que el cliente sigue teniendo el rollo.
- **RN-NC.04** **NC externa** (factura del proveedor anterior): stub solo-referencia,
  **sin ningún efecto en cuenta corriente ni contabilidad**; se emite con los datos del
  original descritos como texto en la razón de la referencia (el proveedor no puede
  validar CFEs que no están en su base).

## 11. Envío por email

Ver Spec 10 (RN-MAIL.03/04/05): PDF generado por el navegador del operador, número oficial
DGI cuando existe, advertencia si no está firme, selección de proveedor por credenciales,
modo simulado explícito e historial único de envíos. Los **dos correos** (ficha vs portal)
se muestran etiquetados y el operador elige (RN-POR.11).

## 12. Brechas conocidas (para el sistema nuevo)

1. IVA a tasa mínima no soportado en el envío (todo sale a tasa básica).
2. Vencimiento de documentos a crédito = fecha de emisión, no el real.
3. Sin e-Remito, e-Resguardo, CFE de exportación, adendas ni procedimiento de
   contingencia con el proveedor caído.
4. El código de orden estructurado en las líneas no siempre se completa (queda como texto
   en la descripción) — el sistema nuevo lo lleva como dato estructurado siempre.
5. Campos de texto cortos que truncan en silencio (el origen del bug de las NC).

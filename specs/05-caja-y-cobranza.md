# Spec 05 — Caja y Cobranza

> Nivel: negocio. Sin nombres de tablas, columnas ni funciones.
> Entidades definidas aquí: **Sesión de Caja**, **Cobro**, **Medio de Pago**, **Anticipo**,
> **Cuenta de Billetera**, **Autorización sin Pago**, **Ajuste de Cobro**.
> Referencia entidades de otras specs: Retiro, Orden, Pedido, Documento, Deuda, Ciclo, Plan de Metros.

## 1. Propósito

La caja cobra los retiros de mercadería, las deudas y las ventas directas; administra los
anticipos y la billetera del cliente; y registra todo movimiento de dinero con su asiento
contable. Distingue el dinero físico del mostrador (arqueable) del dinero administrativo
(sin plata en mano).

## 2. Sesión de Caja (mostrador)

- **RN-CAJA.01** Existe **una sola Sesión de Caja abierta en todo el sistema** a la vez.
  Abrir una nueva exige cerrar la anterior.
- **RN-CAJA.02** Al abrir se declara el fondo inicial **en pesos y en dólares por separado**,
  y queda registrado quién abre y cuándo.
- **RN-CAJA.03** Al cerrar, el cajero cuenta el efectivo con desglose por denominación
  (billetes y monedas, en ambas monedas). El sistema calcula:
  `esperado = fondo inicial + cobros del turno − egresos del turno` y
  `diferencia = contado − esperado`.
- **RN-CAJA.04** Diferencia menor a 1 peso ⇒ estado **Cerrada**; si no, **Cerrada con
  diferencia**. La diferencia y las observaciones se conservan.
- **RN-CAJA.05** El control de dólares es de auditoría: no entra al cálculo principal de
  diferencia, pero su detalle (físico, esperado, diferencia, desglose) queda anexado a las
  observaciones del cierre.
- **RN-CAJA.06** El cierre genera un **PDF de arqueo** que se guarda; el histórico de cierres
  permite ver el PDF y regenerarlo desde los movimientos de la sesión. El arqueo agrupa por
  medio de pago y moneda, separando entradas y salidas, con el efectivo puro aparte.

## 3. Caja Central vs Caja Administrativa

- **RN-CAJA.07** Toda operación de dinero pertenece a uno de dos "baldes":
  - **Central**: mostrador. Exige Sesión de Caja abierta; sin sesión no se puede operar.
    Entra al arqueo del turno.
  - **Administrativa**: operaciones sin plata en mano (cobros del Panel 360, anticipos
    administrativos, venta de rollo adelantado, ajustes, egresos administrativos). No tiene
    sesión y **no ensucia el arqueo** del cajero. Se consulta por rango de fechas.
- **RN-CAJA.08** Los cobros online (pasarelas, web) son **siempre administrativos**.
- **RN-CAJA.09** Un movimiento puede **reclasificarse** de una caja a la otra para cuadrar
  arqueos. Administrativa → Central exige una sesión central abierta que lo reciba. La
  reclasificación **no afecta contabilidad ni cuenta corriente** y queda auditada.
- **RN-CAJA.10** Existe un reporte Central vs Administrativa por período, con los movimientos
  separados por balde y totales por moneda, para detectar contaminaciones de arqueo.
- **RN-CAJA.11** Toda operación puede atribuirse a una **Empresa emisora** elegida por el
  cajero; si no se elige, aplica la empresa por defecto (ver Spec 06).

## 4. Cobro de un Retiro

- **RN-CAJA.12** La caja muestra los Retiros marcados "pasar por caja". Pueden cobrarse
  varios juntos **solo si son del mismo cliente**.
- **RN-CAJA.13** Del Retiro se cobran únicamente las Órdenes no pagadas y no cubiertas
  (se excluyen las ya pagadas, las cubiertas por recurso/cuenta y las ya abonadas o
  autorizadas).
- **RN-CAJA.14** El cobro tiene una **moneda de exhibición** (pesos o dólares); el total se
  convierte con la cotización del día. **Cada línea de pago puede ir en su propia moneda**;
  el sistema convierte y controla el cuadre con tolerancia de 1 peso (exhibición en pesos)
  o 0,05 (exhibición en dólares).
- **RN-CAJA.15** Un cobro admite **varios Medios de Pago** simultáneos. No existe el pago
  parcial libre en el cobro de retiro: lo ingresado debe cuadrar con el importe a cobrar.
- **RN-CAJA.16** El cajero puede fijar un **importe a cobrar** distinto del total real
  (redondeo, precio cerrado). El Documento se emite por el valor real; la diferencia se
  contabiliza como **descuento concedido** (cobró de menos) o **recargo/recupero** (cobró de
  más), sin tocar Órdenes ni Documento. El desbalance en moneda base (importe fijado +
  redondeo por conversión) se tipifica igual, de modo que **el asiento siempre cuadra**.
- **RN-CAJA.17** Comprobantes posibles: **Pedido Caja** (interno, no va a DGI), e-Ticket o
  e-Factura, contado o crédito. A **crédito** no se exige medio de pago: se emite el
  comprobante y la Deuda queda viva.
- **RN-CAJA.18** Al confirmar el cobro, en una única operación atómica:
  1. Se consume el correlativo y se crea la transacción (con o sin sesión según el balde).
  2. Se registra una línea por Orden y un registro por cada Medio de Pago.
  3. Se imputan Deudas: primero cruce exacto por Orden; el remanente por antigüedad (PEPS)
     en la cuenta del cliente de esa moneda.
  4. Las Órdenes pasan a pagadas — salvo las entregadas, canceladas o perdidas: **un pago
     tardío nunca retrocede un estado físico**.
  5. El Retiro pasa a Abonado (o "empaquetado y abonado") y deja de pasar por caja. Si todas
     sus órdenes quedaron pagas por otra vía, se auto-cierra como Abonado.
  6. El Documento se emite con desglose de IVA y **detalle real por material** (una línea por
     tela del Pedido, prorrateada a lo cobrado, sin duplicar por órdenes hermanas); si el
     detalle no puede resolverse, cae a línea genérica sin bloquear el cobro.
  7. Si queda importe sin cobrar y el tipo de documento genera deuda, se crea la Deuda con
     vencimiento (30 días por defecto) y se auto-consume el saldo a favor existente.
  8. Se genera el asiento (caja o valores a depositar al debe; deudores al haber; línea de
     ajuste si hay desbalance).
- **INV-CAJA.01** **Un Documento tiene a lo sumo una Deuda viva.** (Idempotencia del alta de
  deuda; la violación histórica de esto produjo deudas duplicadas.)
- **INV-CAJA.02** Reintentar un cobro que falló por bloqueo de base es seguro: la operación
  se revierte entera o se aplica entera; **nunca puede duplicar un cobro**.
- **RN-CAJA.19** **Anular un cobro** revierte estados (Abonado → Pendiente), desvincula los
  pagos, reactiva "pasar por caja", revierte la cobranza y revierte la compra de rollo si esa
  venta creó/recargó un Plan (falla si el rollo ya se consumió). Bloqueada si el comprobante
  está aceptado por DGI (corresponde Nota de Crédito).
- **RN-CAJA.20** **Autorización sin Pago**: el cajero puede dejar salir un Retiro sin cobrar,
  con motivo obligatorio, monto y vencimiento. Nace Activa y se gestiona luego a Cobrada o
  Condonada, con nota de gestión.

## 5. Pago de Deudas

- **RN-CAJA.21** Un pago de deudas no mezcla clientes ni mezcla monedas de deuda.
- **RN-CAJA.22** Dos categorías: **documentos con deuda** (ya facturados ⇒ genera Recibo) y
  **órdenes a facturar** (deuda sin factura ⇒ genera Pedido Caja o comprobante fiscal, con
  el detalle real de ítems, agrupando por Pedido para no duplicar líneas en multitela).
- **RN-CAJA.23** La moneda base del cobro es **la de la deuda**. Pagos en otra moneda se
  normalizan con el tipo de cambio del cobro. El TC por defecto es el del día, pero el
  cajero puede fijar un **TC pactado**; se descarta al salir (cada cobro decide su TC).
- **RN-CAJA.24** El sistema ofrece el **TC implícito** (el que cancelaría exacto la deuda)
  solo si cae dentro de ±25% del TC del día; fuera de ese rango se considera pago corto o
  largo real, no fluctuación.
- **RN-CAJA.25** La diferencia del cobro tiene un **destino elegido por el cajero**:
  - **Cliente** (por defecto): pagó de menos ⇒ deuda parcial; pagó de más ⇒ el excedente
    queda como saldo a favor en la cuenta principal de la moneda de la deuda.
  - **Cambio**: la deuda se cancela entera y la diferencia va a resultado por diferencia de
    cambio, con **tope de 1 dólar** (o equivalente); por encima, la operación se rechaza.
- **INV-CAJA.03** El excedente de un cobro es dinero real: si su registro como saldo a favor
  falla, **se aborta el cobro completo**.
- **RN-CAJA.26** **Fecha de cobro editable**: se puede retrofechar (nunca a futuro; hoy o
  futuro se tratan como hoy). La fecha elegida se estampa en comprobante, asiento, movimiento
  de caja y submayor. No afecta a DGI.
- **RN-CAJA.27** Imputación deuda por deuda, sin exceder el pendiente de cada una; una deuda
  pasa a cobrada solo con pendiente cero; un Documento se marca pagado solo cuando **ninguna**
  de sus deudas tiene pendiente. Cada pago queda referenciado al Documento (u Orden) que
  cancela — sin esa referencia no se distingue un pago de un anticipo.
- **RN-CAJA.28** El pago de deudas emite un **Recibo de cobro con numeración propia**,
  además del comprobante que corresponda.

## 6. Billetera del cliente

> Los **beneficios pactados** (bolsas de billetera con precios pactados a cambio de una carga
> facturada) se especifican en la Spec 40; esta sección define la billetera sobre la que se
> apoyan.

### 6.1 Estructura

- **RN-CAJA.29** La billetera es un conjunto de **Cuentas de Billetera**:
  - **Una cuenta principal por moneda** (pesos y dólares).
  - **Cuentas secundarias** con nombre propio.
  - **Cuentas de recurso** (bolsas de material/metros, ver Spec 07).
- **RN-CAJA.30** Roles: la **principal** se usa automáticamente para cubrir deudas y retiros;
  una **secundaria libre** solo se usa si el cajero la elige explícitamente; una
  **restringida** ("rollo en plata") tiene lista blanca de artículos y paga sola las órdenes
  de esos artículos al ingresar, sin pasar por caja, pudiendo quedar **en negativo**.

### 6.2 Configuración por cuenta

- **RN-CAJA.31** Cada cuenta tiene dos interruptores: **consumo automático** (paga sola al
  ingresar la orden) y **permite negativo** (si no alcanza: ON = descuenta todo y queda en
  rojo; OFF = descuenta lo que hay y el resto sigue a la principal ⇒ pasa por caja).
- **RN-CAJA.32** Cada cuenta tiene una **modalidad fiscal**:
  - **Anticipo a facturar**: se carga con anticipos o transferencias; lo consumido queda
    "sin facturar" y se factura después ("facturar consumos": la factura nace paga).
  - **Prepago facturado**: se carga solo con "venta de saldo" (factura + pago en el acto);
    lo consumido **no se vuelve a facturar** y la cuenta **no puede pagar otros documentos**
    (duplicaría venta e IVA) ni recibir anticipos.
- **INV-CAJA.04** La modalidad fiscal de una cuenta **no puede cambiarse si ya tiene
  movimientos**.

### 6.3 Uso del medio "Saldo de cuenta"

- **RN-CAJA.33** Exige elegir la cuenta origen; debe ser de dinero, activa, del mismo
  cliente, **no principal**, **no restringida**, **no prepago**, en la **misma moneda** de la
  línea de pago, y con saldo suficiente salvo que permita negativo. Contablemente no entra a
  caja: baja el pasivo de anticipos.
- **RN-CAJA.34** Cuando el cobro nace fijado a este medio (facturar consumos, venta de saldo
  desde saldo a favor), el medio queda **bloqueado**: cambiarlo cobraría dos veces.

### 6.4 Cross-moneda

- **RN-CAJA.35** Consumo automático cross-moneda: convierte con la cotización del día y **la
  cotización usada queda registrada en el movimiento**.
- **RN-CAJA.36** **Cruce automático entre principales**: deuda en una moneda + saldo a favor
  en la otra ⇒ el sistema cruza lo que alcance al TC del día, con dos movimientos espejo.
  El saldo de la otra cuenta se **recalcula desde los movimientos** (nunca se usa un saldo
  acumulado guardado).
- **RN-CAJA.37** Transferencias entre cuentas del mismo cliente: dos movimientos espejo; si
  cruzan moneda, exigen cotización explícita.

### 6.5 Anticipos

- **RN-CAJA.38** Un **Anticipo** registra dinero a favor (crédito, no deuda). El cajero elige
  la cuenta destino (por defecto la principal de la moneda; nunca una prepago); si no existe,
  se crea. Genera un **Recibo de Anticipo con numeración propia** (serie separada del recibo
  de cobro) y admite retrofecha.
- **RN-CAJA.39** El anticipo **se imputa automáticamente** a las deudas pendientes por
  antigüedad; el remanente queda como saldo a favor. La imputación automática no descuenta el
  libro de la cuenta (el anticipo queda entero como billetera; la Deuda dice qué factura está
  paga). La **imputación manual** posterior sí descuenta del saldo disponible.
- **RN-CAJA.40** Anticipo en dólares **exige cotización** (el libro contable lleva base
  pesos). Anticipo cobrado con cheque va a valores a depositar, no a caja.
- **RN-CAJA.41** El **saldo efectivo** de una cuenta es su saldo menos lo comprometido
  (órdenes aprobadas por anticipo aún sin facturar); nunca es negativo a efectos de
  disponibilidad.
- **RN-CAJA.42** Desde el 360 puede cargarse un **saldo inicial** de apertura por moneda
  (a favor o en contra) y **ajustarse** el saldo de una cuenta con motivo obligatorio.

## 7. Cobertura de un Retiro (qué frena en caja)

Cascada evaluada al crear el Retiro, en orden:

1. Orden ya pagada ⇒ cubierta.
2. Cliente tipo **Rollo**: cobertura por costo — costo cero = la cubrió el rollo ⇒ pasa;
   costo > 0 = quedó fuera del rollo ⇒ necesita pago o crédito.
3. **Plan de Metros** activo para el artículo ⇒ cubierta.
4. **Cuenta restringida** que cubre el artículo (cobertura entera; una parcial no cuenta) ⇒
   cubierta.
5. Lo no cubierto, ¿lo cubre el crédito? **Ciclo abierto vigente** o **adelanto limpio ≥ 0
   con anticipos reales** ⇒ el Retiro nace **Autorizado**.
6. Nada lo cubre ⇒ nace **Pendiente**: **frena y pasa por caja**.

- **RN-CAJA.43** Todo cubierto por pago/plan/rollo/cuenta ⇒ el Retiro nace **Abonado**.
  Estados cubiertos (Abonado, Abonado de antemano, Autorizado) no pasan por caja.
- **RN-CAJA.44** El **adelanto limpio** se calcula desde los movimientos crudos de la cuenta
  principal, excluyendo la capa fiscal (venta de caja, cierre de ciclo — que duplican el
  débito de las órdenes) y los anulados. **Nunca desde un saldo acumulado guardado.** El
  criterio es "adelanto ≥ 0 y tiene anticipos" porque el débito de la orden ya corrió al
  ingresar.
- **RN-CAJA.45** Solo la cuenta **principal** cubre retiros automáticamente. Clientes rollo
  con ciclo de crédito abierto sí pueden llevar órdenes con costo (se cobran al cierre).

## 8. Edición de Órdenes desde caja

- **RN-CAJA.46** Desde el retiro pueden editarse **cantidad, precio/total y moneda** de cada
  Orden. Las Órdenes ya pagadas no se editan.
- **RN-CAJA.47** La edición se propaga en una sola operación atómica a: la orden en depósito,
  el movimiento de cuenta del cliente (con ajuste de saldo), la Deuda viva (pendiente
  arriba/abajo; cobrada si llega a cero; nunca toca deudas canceladas), el total del Ciclo si
  pertenece a uno, el total del Retiro, y el pedido de cobranza con sus líneas prorrateadas.
  Queda en el historial de la Orden como "Ajuste Administrativo" con antes → después.
- **RN-CAJA.48** Otras acciones: **desvincular** una orden del retiro (retiro vacío ⇒ se
  cancela), **cancelar** la orden (revierte movimiento, devuelve saldo, cancela deuda,
  recalcula ciclo y retiro), **exonerar** (pago de $0 que salda sin tocar importe ni deuda
  contable; reversible solo si el pago vinculado es de exoneración), y **cambiar estado
  administrativo** dentro de una lista acotada, siempre con historial.

## 9. Medios de pago especiales

- **RN-CAJA.49** **Cheque**: se identifica por su naturaleza en el catálogo de medios (no por
  un identificador fijo). Un cobro con cheque **no es plata en caja**: va a **valores a
  depositar** y pasa a banco al depositarse. Aplica en cobros, pagos de deuda y anticipos.
  El cheque se da de alta en el momento y queda **vinculado al cobro**; no se procesa una
  línea de cheque sin sus datos. Tiene moneda y cotización propias.
- **RN-CAJA.50** **Transferencia**: único medio que exige comprobante adjunto (en venta de
  rollo adelantado); el adjunto queda referenciado a la transacción.
- **RN-CAJA.51** Medios internos: **anticipo aplicado** (imputa un anticipo a una orden sin
  caja física, deja el retiro "empaquetado y abonado") y **exoneración** (pago $0).

## 10. Documentos internos y robustez

- **RN-CAJA.52** La bandeja de documentos internos (recibos no fiscales y egresos) permite
  anular — revirtiendo documento, pagos, movimiento de cuenta y asiento — **salvo que exista
  comprobante fiscal aceptado por DGI** (ahí va Nota de Crédito).
- **RN-CAJA.53** "Modificar monto" de un documento interno **no edita**: anula el original y
  recrea el documento con número nuevo. Si la recreación falla, se informa que el original
  quedó anulado.

## 11. Interacciones

| Módulo | Interacción |
|---|---|
| Logística (Spec 04) | El Retiro es lo que la caja cobra; estados Abonado/Autorizado/Pendiente gobiernan la salida de mercadería. |
| Facturación (Spec 06) | Cada cobro emite un Documento (interno o CFE); las Deudas y su ciclo de vida se definen allí. |
| Recursos (Spec 07) | Planes de metros y rollos cubren órdenes sin pasar por caja; la anulación de una venta de rollo revierte el plan. |
| Contabilidad (Spec 06) | Todo cobro/anticipo/ajuste genera su asiento; cheques a valores a depositar; saldo de cuenta baja pasivo de anticipos. |
| Portal/Tótem (Spec 10) | La vista de cobranza que lee el cliente se sincroniza con cada cobro y anulación. |

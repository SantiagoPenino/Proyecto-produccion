# Spec 07 — Recursos del Cliente (planes de metros, telas, bobinas)

> Nivel: negocio. Sin nombres de tablas, columnas ni funciones.
> Entidades definidas aquí: **Plan de Recursos**, **Movimiento de Recurso**, **Bobina**,
> **Tela del Cliente**.
> Vocabulario: "Bobina" = rollo físico de material en inventario; "rollo de producción"
> (lote de impresión en máquina) es otra cosa y se define en la Spec 03.

## 1. Plan de Recursos ("rollo por adelantado")

- **RN-REC.01** Un **Plan de Recursos** es una bolsa prepaga de unidades (metros, kilos o
  piezas) que el cliente compra por adelantado y consume con sus pedidos. Es la billetera
  "en material": saldo en metros en lugar de dinero.
- **RN-REC.02** Un Plan tiene: cantidad total comprada, usada y restante; % consumido;
  cuelga de una **cuenta de recursos** del cliente (nunca de una cuenta monetaria); está
  atado a un artículo y admite una **lista de artículos permitidos** ("plan mixto");
  tiene inicio, vencimiento opcional y estado activo/inactivo; y guarda el **importe pagado
  y su moneda** (que valorizan los metros consumidos y devueltos).
- **RN-REC.03** Un plan vencido no es elegible para consumo. El plan se desactiva solo
  cuando lo usado alcanza el total, o manualmente (cerrarlo con saldo restante registra un
  ajuste negativo de "pérdida de saldo": el cliente pierde esos metros, documentado).

### 1.1 Compra y recarga

- **RN-REC.04** Si el cliente no tiene cuenta de recursos para el material, se crea
  automáticamente al vender.
- **RN-REC.05** **Recarga vs. plan nuevo**: si existe un plan activo con **exactamente el
  mismo conjunto de artículos permitidos**, la compra recarga ese plan (suma metros);
  cualquier diferencia en el conjunto crea un plan nuevo. Evita planes paralelos del mismo
  material.
- **RN-REC.06** Toda compra deja un **movimiento de entrada** en el estado de cuenta del
  recurso ("saldo inicial" o "recarga"), etiquetado con la transacción que lo originó para
  poder revertirlo si la venta se anula.
- **RN-REC.07** Alta por gestión con tipo de comprobante: Factura o Recibo generan documento
  contable con numeración propia; **Ticket solo mueve inventario de recursos** (sin
  documento contable).
- **RN-REC.08** **Herencia de sobregiro**: si un plan anterior del mismo cliente/material se
  agotó con consumo en exceso (negativo en la cuenta), ese excedente se hereda como "usado
  inicial" del plan nuevo (absorbe hasta el tope; el resto queda en advertencia). Los
  movimientos de excedente se marcan absorbidos para no heredarse dos veces.
- **RN-REC.09** Restricción de venta adelantada: para el rubro de impresión ecológica (UV)
  solo se vende como rollo el **material impreso** (lonas, canvas, vinilos, papel);
  productos terminados y terminaciones quedan fuera.

### 1.2 Consumo

- **RN-REC.10** El consumo se dispara **al ingresar/cotizar la Orden** (no a la entrega:
  el producto ya se fabrica). Se descuenta en **cascada FIFO** por fecha de alta del plan
  (el más viejo primero), generando un movimiento de entrega (negativo) por plan tocado,
  con el trabajo como concepto y el plan como referencia.
- **RN-REC.11** Con menos del 10% restante se registra una alerta; al llegar a cero el plan
  se desactiva solo.
- **RN-REC.12** El **disponible efectivo** al cotizar = (restante de todos los planes) −
  (metros ya comprometidos por otras órdenes vivas del cliente sobre esos artículos). Nunca
  se prometen dos veces los mismos metros.
- **RN-REC.13** Cobertura en el precio: cubre todo ⇒ una línea a $0 con perfil "prepago";
  cubre parcial ⇒ **dos líneas**: metros cubiertos a $0 + excedente a precio normal.
- **RN-REC.14** Reposiciones y fallas sin cargo van a $0 y **no consumen plan**. Los retiros
  de componentes de un combo también van a $0 (el combo se cobra en una única orden).
- **RN-REC.15** **Sobregiro**: si la orden pide más de lo disponible, para clientes con
  recursos comprados el exceso **nunca genera deuda de dinero**: queda como metros en
  negativo en la cuenta del recurso, visible, y lo hereda el próximo plan (RN-REC.08).
- **RN-REC.16** **Urgencia pagada en metros**: si un pedido urgente está cubierto por rollo
  (precio $0), el recargo de urgencia no puede cobrarse en dinero: se cobra consumiendo un
  **% adicional de metros**, registrado como movimiento propio y visible. Despliegue
  configurable por lista de clientes (piloto / todos) y porcentaje configurable.

### 1.3 Reversas (devolver metros)

- **RN-REC.17** **Devolver el consumo de un plan** deja la orden de nuevo pendiente de
  facturar: suma los metros al plan (nunca bajo cero), lo reactiva, repone el saldo de la
  cuenta, marca los movimientos originales como devueltos, restaura el importe de la orden
  y revive su deuda. **Bloqueada si**: la orden está anulada, **ya fue facturada**, no tiene
  marca de cobertura, o no se encuentran los movimientos originales.
- **INV-REC.01** **Candado dinero**: por el circuito de metros no se puede tocar un
  movimiento de dinero (pago, venta, cierre de ciclo, anticipo) — eso se deshace anulando
  la transacción de caja que lo generó.
- **INV-REC.02** **Candado compra**: el circuito de reversa de consumos no puede borrar una
  **entrada** (la compra del rollo): eso se deshace anulando la venta o con Nota de Crédito,
  que dan de baja el plan. (Borrar la entrada sumaba metros, dejaba el plan vivo y hacía
  desaparecer la compra sin rastro.)
- **INV-REC.03** **Candado facturación**: no se revierte el consumo de una orden ya
  facturada; primero se anula la factura. La emisión del documento es el punto de no
  retorno.
- **RN-REC.18** Al revertir con reactivación: si la orden se pagó 100% con metros y nunca
  tuvo deuda de dinero, **se crea la deuda** para que vuelva a "pendientes de facturar";
  los metros devueltos se valorizan con el precio unitario del plan (o importe 0 si no hay
  precio, a fijar al facturar).

### 1.4 Portal ("Mis Recursos")

- **RN-REC.19** El cliente ve sus planes (comprado/usado/restante/vence) y sus telas en
  depósito, **solo lectura**, con estado de cuenta orden por orden y saldo corrido. El
  cliente se resuelve de la sesión y toda cuenta consultada se verifica como propia
  (Spec 10, RN-POR.08). Los nombres internos de los planes se le ocultan.

## 2. Tela del Cliente (material físico del cliente)

- **RN-TEL.01** El cliente trae tela física que queda en depósito a su nombre. Entra por una
  **recepción** con código propio (uno por bulto); por cada bulto nacen un bulto logístico y
  una **Bobina** a nombre del cliente, con medidas **declaradas**, en estado **Pendiente**
  (sin verificar), con movimiento de ingreso y comprobante PDF de recepción.
- **RN-TEL.02** **Confirmación de medida**: solo bobinas de cliente en Pendiente; solo el
  área dueña (o un administrador). Los valores declarados se conservan y los reales se
  guardan aparte; diferencia > 10% ⇒ alerta con signo y porcentaje. El movimiento se
  registra **contra el saldo físico actual**, no contra el declarado (contra el declarado
  se contaba doble). La bobina pasa a Disponible.
- **RN-TEL.03** Saldo por tipo de tela: Disponible cuenta solo bobinas activas; una bobina
  **Agotada se cuenta consumida entera** (su remanente es merma no usable); las Pendientes
  no cuentan como consumidas; el histórico incluye agotadas y cerradas (la tela consumida
  sigue siendo historia del cliente).
- **RN-TEL.04** Reserva: un bulto puede marcarse En Uso al asignarse a una orden (validando
  pertenencia y metros suficientes); liberar la reserva lo devuelve a Disponible. Ambas
  quedan registradas.
- **RN-TEL.05** Consumo por pedido: se descuenta **una sola vez por Pedido** (en la orden
  principal, no en las extra), validando metros suficientes con **descuento condicionado**
  (dos pedidos simultáneos no dejan la bobina en negativo: el segundo falla). ≤ 0,5 m ⇒
  Agotada. El movimiento de consumo es **la fuente de verdad para la devolución**.
- **RN-TEL.06** **Devolución por cancelación**: al cancelar una orden se devuelve **lo
  realmente consumido según los movimientos** (no la magnitud actual de la orden, que pudo
  cambiar). Es **idempotente** (cancelar dos veces o por dos caminos no infla stock) y corre
  dentro de la transacción de cancelación. Devolver metros a una Agotada la **reabre** si
  supera 0,5 m.

## 3. Bobinas — ciclo de vida

Estados: **Pendiente** (solo tela de cliente, declarada sin verificar) → **Disponible** →
**En Uso** → **Agotada** (terminal operativo; remanente = merma) / **Cerrada** (terminal
heredado). Umbral operativo: **0,5 m**.

- **RN-BOB.01** Material propio: alta manual por área (insumo, metros, N bobinas), cada una
  con etiqueta única y movimiento de ingreso.
- **RN-BOB.02** Consumo en producción: descuenta metros, pasa a En Uso o Agotada (≤ 0,5 m),
  registrado con referencia a orden/lote.
- **INV-BOB.01** **Nunca se descuenta sin registrar movimiento**: si el registro falla, se
  revierte todo. Y **una bobina nunca queda Agotada sin un movimiento que lo explique**
  (al agotar se registra ajuste aunque la diferencia sea 0).
- **RN-BOB.03** Ajuste manual: restar o fijar valor (nunca negativo), con conceptos
  tipificados (muestra, merma, ajuste, venta externa, devolución al cliente, otro) y orden
  asociable. Un ajuste que devuelve metros a una Agotada **la reabre** (> 0,5 m); una rebaja
  que la deja en ≤ 0,5 m la agota. "Devolución al Cliente" además **cierra la bobina** en 0.
  El ancho real se corrige con un movimiento propio de cantidad 0 (visible sin alterar
  saldo).
- **RN-BOB.04** Cierre con medición física: el operario declara el sobrante real; el sistema
  calcula el **desecho** (sistema − real), iguala el saldo al real y deja Agotada o
  Disponible según si se marcó "terminar" (desmarcado por defecto: venía marcado y agotaba
  bobinas con metros útiles).
- **RN-BOB.05** Cambio de bobina en máquina: se declara el destino de la vieja ("se acabó" ⇒
  0 y Agotada; "devolver al stock" ⇒ Disponible con su remanente) y la eventual **merma por
  reimpresión** con motivo, descontada y registrada aparte.
- **RN-BOB.06** Reporte de desperdicio por insumo y período: desecho de cierre + producción
  fallida + merma de reimpresión ⇒ desperdicio total, consumo neto (nunca negativo) y %.
- **RN-BOB.07** Visibilidad: el inventario por área oculta por defecto Agotadas/Cerradas;
  un insumo aparece en un área por asignación, stock o mapeo de categoría; Administración y
  Depósito ven todas las áreas.

## 4. El libro del recurso (ledger)

- **INV-REC.04** Hay dos verdades que deben coincidir siempre: el **saldo físico** de cada
  bobina/cuenta y el **libro de movimientos** (ingreso, consumos, ajustes, mermas,
  reservas, devoluciones). Convención: salidas en negativo, entradas en positivo; el saldo
  corrido se acumula por suma directa.
- **INV-REC.05** El saldo corrido se calcula **por bobina**, nunca por tipo de insumo
  (varias bobinas del mismo insumo se contaminaban entre sí).

## 5. Interacciones

| Módulo | Interacción |
|---|---|
| Caja (Spec 05) | La venta del rollo entra por caja; la cascada de cobertura usa los planes; anular la venta revierte el plan. |
| Precios (Spec 09) | Cobertura parcial parte la cotización en dos líneas; el plan valoriza consumos con su precio implícito. |
| Facturación (Spec 06) | La factura emitida bloquea reversas; "facturar consumos" factura lo consumido de cuentas de anticipo. |
| Producción (Spec 03) | El consumo de bobinas y las mermas nacen en producción; el cambio de bobina en máquina. |
| Portal (Spec 10) | "Mis Recursos" en solo lectura con candado de pertenencia. |

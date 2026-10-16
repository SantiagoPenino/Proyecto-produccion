# Spec 40 — Beneficios Pactados sobre la Billetera (to-be)

> Nivel: negocio. Sin nombres de tablas, columnas ni funciones.
> Módulo nuevo (no existe en el sistema actual). Se apoya en la Billetera (Spec 05 §6), en
> las cuentas restringidas "rollo en plata" (Spec 05 RN-CAJA.30) y en el motor de precios
> (Spec 09).
> Entidades definidas aquí: **Beneficio**, **Beneficio Predefinido** (plantilla),
> **Beneficio Pactado**, **Bolsa del Beneficio**, **Regla del Beneficio**.
> Diseño acordado con Administración el 2 y 3 de setiembre de 2026. Mockup de referencia:
> lienzo "Beneficios de la Billetera" (pantallas 0 a 7). Plan de construcción:
> [docs/beneficios-billetera-plan.md](../docs/beneficios-billetera-plan.md).

## 1. Qué es un Beneficio

- **RN-BEN.01** Un **Beneficio** es un acuerdo comercial: el cliente obtiene determinados
  productos o servicios a un **precio pactado** a cambio de cargar por adelantado una
  cantidad de dinero en su billetera. Son **dos cosas con la misma vida**:
  1. la **Bolsa**: una Cuenta de Billetera propia del cliente, con el nombre del beneficio,
     restringida al alcance del beneficio, de modalidad **prepago facturado** y con consumo
     automático;
  2. las **Reglas de precio**: el conjunto de precios pactados que el motor aplica **solo
     mientras la bolsa esté habilitada, vigente y con saldo**.
- **RN-BEN.02** Alcance de una regla: un artículo, varios artículos, un grupo/familia
  entero, un servicio completo (área) o varios servicios. Tipos de regla: **precio fijo por
  unidad**, **descuento porcentual** y **descuento por monto**.
- **RN-BEN.03** **El porcentaje se calcula siempre sobre el precio de lista**, nunca sobre el
  precio especial que el cliente pueda tener. (Un especial del 10 % y un beneficio del 8 %
  dan lista −8 %: el beneficio puede ser peor que el especial, y por eso existe la alerta de
  RN-BEN.10.)
- **RN-BEN.04** Origen: **Predefinido** (plantilla de la empresa, ofrecida a todos los
  clientes o "solo por pacto") o **Pactado a medida** por un vendedor con un cliente. Ambos
  terminan en un Beneficio del cliente cuando se activan.
- **INV-BEN.01** Un beneficio tiene **una sola moneda**: la de su bolsa y la de sus precios.

## 2. Beneficios predefinidos (plantillas)

- **RN-BEN.05** El catálogo de plantillas es **de la empresa, no de un cliente**: se
  administra en su propia pantalla del menú principal. Una plantilla define: nombre, quién
  puede activarla (todos los clientes desde el portal / solo por pacto), moneda, **carga que
  la activa** (monto fijo o mínimo), **vigencia** (días desde la activación, fecha fija o
  hasta agotar el saldo), alcance y reglas de precio, y estado (borrador, pendiente de
  aprobación, publicada, pausada).
- **RN-BEN.06** Una plantilla nueva o modificada pasa **una vez** por aprobación antes de
  publicarse. Las activaciones que los clientes hagan sobre una plantilla publicada **no**
  pasan por aprobación.
- **RN-BEN.07** Pausar una plantilla la saca de la oferta; **no toca** los beneficios ya
  activados con ella (siguen hasta agotarse o vencer).
- **RN-BEN.08** Donde se ve a un cliente (360 de vendedores y portal), las plantillas
  publicadas se **muestran** con el precio que ese cliente paga hoy y una alerta si le salen
  peor; sirven de base para pactar. No se crean ni editan desde el cliente.

## 3. El pacto (vendedor ↔ cliente)

- **RN-BEN.09** El pacto se propone desde la pestaña **Beneficios** de la vista 360 de
  vendedores. Contiene: cliente, base (plantilla o a medida), nombre, moneda, carga pactada
  (fija o mínima), vigencia, reglas por artículo/grupo/servicio con el precio pactado, nota
  para quien aprueba y vendedor proponente.
- **RN-BEN.10** Por cada artículo alcanzado, el formulario muestra el **precio de lista**, el
  **precio especial** del cliente si tiene, los **beneficios activos** que ya lo alcanzan, el
  **precio pactado** y la diferencia contra lista. **Alerta de precio peor**: si el pactado es
  peor que lo que el cliente paga hoy (su especial si tiene, si no la lista; para reglas en %
  se evalúa artículo por artículo dentro del alcance), el sistema lo marca al vendedor, a
  quien aprueba y al cliente en el portal. **Avisa, no bloquea.**
- **RN-BEN.11** Enviar un pacto **no cambia ningún precio**: es una propuesta. La vista 360 de
  vendedores sigue siendo de consulta; la pestaña Beneficios es la única que propone.

## 4. Aprobación

- **RN-BEN.12** Existe una **lista de aprobación** con pendientes, aprobados sin activar,
  activos e historial. Administración **aprueba con nota** o **rechaza con motivo
  obligatorio**. Un vendedor no aprueba su propio pacto. Aprobar un pacto que tiene precios
  peores que los actuales del cliente exige nota.
- **RN-BEN.13** **Aprobado no es habilitado.** Un pacto aprobado queda disponible para que
  el cliente lo active cargando el saldo pactado; hasta que esa carga se acredita, **no
  cambia ningún precio**. Un aprobado que nunca se carga se **cancela** desde la lista, sin
  plata que devolver.
- **RN-BEN.14** El vendedor ve el estado de sus pactos desde el 360; Administración ve todos.
- **INV-BEN.02** Ningún precio pactado aplica sin (a) aprobación y (b) carga acreditada.

## 5. Activación: la carga facturada

- **RN-BEN.15** Activar es **cargar la bolsa con una carga facturada**: venta de saldo en caja
  (factura + cobro en el acto) o recarga web con e-Ticket / e-Factura confirmada por la
  pasarela. **Ninguna otra entrada**: a una bolsa de beneficio nunca entra una transferencia,
  un anticipo ni un ajuste manual.
- **RN-BEN.16** Al acreditarse la carga nace la Bolsa (cuenta propia con el nombre del
  beneficio, restringida a su alcance, prepago facturada, consumo automático), se fija el
  vencimiento y el beneficio pasa a **Activo**. El cliente ve la bolsa como una cuenta más
  de su billetera, separada del saldo común.
- **RN-BEN.17** La carga es exactamente el monto pactado (fijo) o al menos el mínimo. Un
  predefinido público lo activa el cliente solo desde el portal; un pactado aprobado se carga
  desde el portal o en caja.
- **RN-BEN.18** La carga con beneficio en caja se elige explícitamente ("¿Qué cargás?: saldo
  común / un beneficio aprobado o predefinido"); el importe queda fijado por el pacto.

## 6. Precios mientras el beneficio está activo

- **RN-BEN.19** El motor de precios toma las reglas de los beneficios del cliente que estén
  **Activos, vigentes y con saldo mayor a cero**. Mientras duren, esas reglas ganan sobre la
  tarifa común y sobre los precios especiales del cliente.
- **RN-BEN.20** Si dos beneficios alcanzan el mismo artículo gana **el alcance más
  específico** (artículo antes que grupo, grupo antes que servicio completo); a igual alcance,
  **el que vence primero**. Dentro de un mismo beneficio rige la misma regla entre sus reglas.
- **RN-BEN.21** La cotización de cada orden **registra qué beneficio aplicó** (trazable y
  reportable: cuánto se vendió con beneficio y cuánto margen se resignó).
- **RN-BEN.22** Las órdenes ingresadas antes de activar un beneficio no entran en él.

## 7. Consumo de la bolsa

- **RN-BEN.23** **La cotización decide, el consumo obedece**: la orden cotizada con un
  beneficio se descuenta de la bolsa de **ese** beneficio. Una orden sin beneficio nunca toca
  una bolsa, y una bolsa nunca paga otra cosa.
- **RN-BEN.24** **Última orden, cascada de plata (nunca de tarifas)**: cuando la orden supera
  el saldo de la bolsa, la orden vale **entera** al precio pactado y el cobro se reparte:
  bolsa del beneficio hasta cero → billetera común de la misma moneda si tiene saldo → lo que
  falte queda pendiente de facturar y pagar en la cuenta corriente. Nunca se parten tarifas
  y nunca salta a la bolsa de otro beneficio. (Clientes semanales: la billetera común no
  descuenta al ingreso; el resto va al ciclo y lo toma el cierre, como hoy.)
- **RN-BEN.25** Agotada la bolsa, el beneficio pasa a **Agotado** y el cliente vuelve solo a
  su tarifa común o especial; si otro beneficio vigente alcanza el artículo, pasa a ese.
- **INV-BEN.03** Una bolsa de beneficio **no es medio de pago**, no recibe ni envía
  transferencias (salvo el cierre de RN-BEN.28), no admite consumo manual de órdenes ajenas
  al beneficio ni recarga común.

## 8. Vigencia, pausa y cierre

- **RN-BEN.26** La vigencia es opcional: N días desde la activación, una fecha fija, o hasta
  agotar el saldo.
- **RN-BEN.27** Administración puede **pausar y reanudar** un beneficio activo desde su
  vista 360 (gestor de cuentas del cliente). En pausa, los pedidos salen a la tarifa normal y
  no tocan el saldo; el saldo queda guardado. El interruptor **nunca reemplaza** la carga
  facturada: para habilitar un aprobado hay que cargarlo.
- **RN-BEN.28** **Cierre.** En cero, la bolsa se cierra sola. Con saldo (vencido o por
  decisión), se cierra desde el 360 de Administración y el saldo pasa **por transferencia a
  la billetera común** del cliente (misma moneda y misma modalidad prepago): queda como plata
  común a tarifa normal y **nunca sirve para activar otro beneficio**.
- **RN-BEN.29** Estados: Propuesto → Pendiente de aprobación → Aprobado sin activar → Activo
  → Agotado / Vencido. Ramas: Rechazado (desde pendiente, con motivo), Cancelado (desde
  aprobado sin activar), En pausa (desde activo, reversible), Cerrado con transferencia.
  Predefinido público: Disponible → Activo al acreditarse la carga.

## 9. Qué ve cada uno

- **RN-BEN.30** **Portal.** Cada beneficio activo es una tarjeta propia en "Mi billetera":
  saldo, precio pactado, cuánto le queda en unidades aproximadas, vencimiento y libro,
  separado del saldo común. "Beneficios para vos" lista los pactados aprobados y los
  predefinidos públicos con "Activar cargando $X", con la alerta si le salen peor. "Mi
  saldo" y "cubrir con mi billetera" nunca ofrecen bolsas de beneficio.
- **RN-BEN.31** **Vista 360 de vendedores.** Pestaña Beneficios: beneficios del cliente con
  saldo y estado, predefinidos disponibles (solo consulta), pactar, mis pactos.
- **RN-BEN.32** **Vista 360 de Administración.** El total de billetera muestra el saldo
  común separado de los beneficios; el gestor de cuentas lleva el interruptor pausa/reanuda
  y el cierre con transferencia; la carga en caja ofrece "¿Qué cargás?".
- **RN-BEN.33** Reportes: ventas cotizadas con beneficio y margen resignado (la línea sabe
  qué beneficio aplicó), saldo vivo por beneficio, pactos por vendedor y su tasa de
  activación.

## 10. Criterio contable y fiscal

- **RN-BEN.34** Rige el criterio de la billetera prepaga (Spec 05 RN-CAJA.32 y Spec 06): la
  carga se factura y la venta se reconoce al facturar, con IVA implícito en el precio; los
  consumos no se facturan ni asientan; el descuento pactado se materializa en las unidades
  entregadas. La bolsa no puede pagar otros documentos (duplicaría venta e IVA).

## 11. Interacciones

| Módulo | Interacción |
|---|---|
| Caja y Billetera (Spec 05) | La bolsa es una Cuenta de Billetera restringida prepaga; la carga es una venta de saldo; el cierre es una transferencia a la común. |
| Precios (Spec 09) | Fuente nueva de reglas para el motor; especificidad y vencimiento; % sobre lista; traza y línea registran el beneficio. |
| Facturación (Spec 06) | La carga es factura (e-Ticket / e-Factura); los consumos no se facturan. |
| Pedidos (Spec 02) | La cotización al ingresar decide el beneficio y lo estampa en la orden. |
| Portal (Spec 10) | Recarga con beneficio, tarjetas propias, alertas; candado de pertenencia. |
| CRM (Spec 26) | El vendedor propone desde su 360; pactos por vendedor como indicador comercial. |
| Seguridad (Spec 12) | Aprobar, pausar y cerrar son operaciones de Administración; el proponente no aprueba. |

## 12. Decisiones pendientes

- > DECISIÓN PENDIENTE: **recompra del mismo beneficio** — cada compra es un beneficio nuevo
  > con bolsa y vigencia propias (propuesta), o recarga de la misma bolsa.
- > DECISIÓN PENDIENTE: **rol exacto que aprueba** (Administración; quiénes dentro de ella).
- > DECISIÓN PENDIENTE: **reversa** de un consumo cuando el beneficio ya está agotado o
  > vencido (propuesta: la plata vuelve a la bolsa y el beneficio se reactiva si sigue vigente).
- > DECISIÓN PENDIENTE: **cross-moneda** entre una orden y la bolsa (propuesta: cotización
  > del día registrada en el movimiento, como hoy en la billetera).

# Spec 28 — Tesorería (to-be)

> Spec de escalamiento. La tesorería actual es una libreta de cheques con el circuito
> contable bien pensado pero sin herramienta de gestión alrededor (sin vencimientos, sin
> totales, sin bancos reales, sin conciliación). El sistema nuevo la trata como módulo
> completo de valores y bancos.
> Entidades definidas aquí: **Cheque**, **Cuenta Bancaria**, **Boleta de Depósito**,
> **Movimiento Bancario**, **Conciliación**.

## 1. Diagnóstico del sistema actual

Lo que funciona (se conserva): la regla de oro **"un cheque no es plata en caja"**
(valores a depositar → banco recién al depositarse); alta bimonetaria con cotización
obligatoria en dólares; el cheque nacido del cobro **no genera asiento propio** (lo
genera el cobro — evita la doble contabilización); aviso de duplicado con confirmación;
anulación con reversa contable y motivo, que no borra la fila ("un cheque es un papel que
existió") y se bloquea si está vinculado a un cobro; el detalle editable que **no deja
tocar importe ni estado** ("si el importe está mal, es otro cheque").

Lo que falla:
1. **Dos puertas de entrada**: el alta manual desde tesorería cancela deuda del cliente
   sin cobro, sin recibo y sin vínculo — el origen de los duplicados históricos (cheques
   cargados N veces que inflaron valores y cancelaron deuda no pagada; limpieza aún
   pendiente en producción).
2. **Estados sin asiento, en silencio**: eventos del cheque cuyo asiento no estaba
   configurado cambiaban el estado igual — un cheque rebotado no devolvía la deuda.
3. La reversa busca el asiento **por coincidencia de texto** del concepto, no por
   referencia formal.
4. Sin cuentas bancarias (solo nombres de banco, mezclando "banco del cliente" con "mi
   chequera"), sin acreditación, sin boleta de depósito, sin conciliación, sin
   movimientos bancarios, sin vencimientos ni totales ni reportes; API sin autenticación.

## 2. El Cheque

- **RN-TES.01** Ciclo de vida del **cheque recibido** (proceso del motor, Spec 14):
  En cartera → Depositado → **Acreditado** / Rechazado; En cartera → Endosado →
  Rechazado; cualquier no-terminal → Anulado (error de carga, con reversa). Se agrega el
  estado **Acreditado** que hoy no existe: "lo llevé al banco" ≠ "el banco me lo pagó".
- **RN-TES.02** Ciclo del **cheque emitido**: Emitido (pasivo de cheques a pagar) →
  Debitado (cancela pasivo contra banco) / Rechazado / Anulado. La emisión declara
  **contra qué se emite** (una cuenta por pagar de la Spec 29, o un gasto) — nunca un
  pasivo sin contrapartida clara.
- **INV-TES.01** **Toda transición de cheque genera su asiento o no ocurre.** Un evento
  sin regla contable configurada **bloquea la transición con error visible** (Spec 15) —
  jamás el cambio silencioso de estado. Y la reversa referencia el asiento **por vínculo
  formal**, nunca por texto.
- **INV-TES.02** **Una sola puerta de entrada con contrapartida**: todo cheque recibido
  nace vinculado a la operación que lo trae (un cobro, un anticipo) — el alta suelta que
  cancela deuda sin cobro no existe. Duplicado (mismo número + banco) = bloqueo con
  confirmación explícita **y constraint en la base**.
- **RN-TES.03** El rechazo registra sus consecuencias completas: la deuda del cliente
  revive (espejo del alta), y opcionalmente el gasto bancario asociado; un rechazado
  puede re-presentarse como nuevo intento de depósito (decisión del operador,
  registrada). El endoso registra **a quién** se endosó (proveedor de la Spec 29).

## 3. Bancos y depósitos

- **RN-TES.04** Se separan dos catálogos que hoy son uno: **Bancos del mundo** (el banco
  emisor del cheque del cliente) y **Cuentas Bancarias propias** (banco, número, moneda,
  cuenta contable asociada) — la entidad que hoy no existe.
- **RN-TES.05** **Boleta de Depósito**: N cheques (y/o efectivo) se agrupan en un
  depósito con fecha, cuenta bancaria destino y número de boleta; depositar es una
  operación sobre la boleta, no un clic por cheque. La acreditación se confirma por
  boleta o por cheque.
- **RN-TES.06** **Movimientos Bancarios**: transferencias emitidas y recibidas, débitos,
  comisiones e intereses se registran como operaciones de tesorería con su asiento —
  incluye la contrapartida de los egresos pagados por banco (Spec 29 corrige que hoy todo
  egreso acredita caja).
- **RN-TES.07** **Conciliación bancaria**: por cuenta y período, cotejo del extracto
  (importación manual o por archivo) contra los movimientos registrados, con partidas
  conciliadas/pendientes y saldo bancario vs contable. Es la herramienta que hoy no
  existe en ninguna forma.

## 4. Gestión de cartera (la herramienta que falta)

- **RN-TES.08** La pantalla de cartera muestra: **totales por moneda, banco y estado**;
  **vencimientos** con semáforo (vencidos, esta semana, próximos) y alerta operativa por
  cheque diferido próximo a vencer (Spec 15); búsqueda y filtros de servidor; paginación;
  exportables (Spec 18).
- **RN-TES.09** Gestión de **chequeras propias**: rangos de numeración por cuenta
  bancaria, control de correlatividad, cheques anulados en blanco.
- **RN-TES.10** Reportes de tesorería: cartera valorizada a fecha, flujo de vencimientos
  (lo que entra por cheques diferidos vs lo que sale por emitidos), historial por
  cliente/banco.
- **RN-TES.11** DECISIÓN PENDIENTE (negocio): incorporar otros valores (conformes,
  letras, vales) — el modelo de "valor con ciclo de vida" los soporta; se activan si el
  negocio los usa.
- **RN-TES.12** **Agenda financiera consolidada**: una vista única de vencimientos por
  fecha que cruza las tres fuentes — **cuentas por cobrar** (Spec 06 RN-FAC.27),
  **cuentas por pagar** (Spec 29) y **cheques** (en cartera por vencer, diferidos
  emitidos por debitarse) — con totales por moneda por semana. Es el flujo de caja
  proyectado mínimo: "¿qué entra y qué sale en los próximos 30/60/90 días?", respondible
  en una pantalla.

## 5. Interacciones

| Con | Relación |
|---|---|
| Spec 05 | El cheque nace del cobro (una puerta); anular el cobro anula el cheque. |
| Spec 06 | Asientos por transición vía motor de reglas; cuentas de valores/bancos/pasivo. |
| Spec 29 | Endosos y cheques emitidos contra proveedores/cuentas por pagar. |
| Spec 14 | Los dos ciclos de vida como procesos declarados con guardas. |
| Spec 31 | La migración depura los duplicados históricos ANTES de entrar. |

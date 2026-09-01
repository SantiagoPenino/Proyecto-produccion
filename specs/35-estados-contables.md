# Spec 35 — Estados Contables y Cierre (to-be)

> Módulo nuevo. El sistema actual tiene libro diario/mayor y (con las Specs 06 y 29) los
> datos de ventas y gastos — pero nadie presenta los estados: hoy el resultado del
> período y el balance se arman fuera, con los CSV del contador. Este módulo los saca del
> sistema.
> Entidades definidas aquí: **Período Contable**, **Estado de Resultados**, **Balance
> General**, **Cierre de Período**, **Asiento de Ajuste**.

## 1. Períodos contables

- **RN-EST.01** El ejercicio se divide en **Períodos Contables** (meses) con estado:
  **Abierto → En revisión → Cerrado**. Sobre un período cerrado no se registran asientos
  con esa fecha (guarda del motor, Spec 14); las correcciones tardías van al período
  abierto con referencia al hecho original — coherente con la retrofecha existente
  (Spec 06 RN-FAC.11), que queda acotada a períodos abiertos.
  > DECISIÓN PENDIENTE (contador): política de cierre mensual (a cuántos días del fin de
  > mes se cierra) y quién tiene el permiso de cerrar/reabrir.
- **RN-EST.02** Los **Asientos de Ajuste** (amortizaciones — Spec 37 —, diferencias de
  cambio de cierre, provisiones que indique el contador) son asientos manuales
  tipificados, con plantillas reutilizables, permiso propio y registro (Spec 13).

## 2. Estado de Resultados

- **RN-EST.03** El **Estado de Resultados** del período sale del plan de cuentas por
  tipo base (ganancia/pérdida): ventas netas de NC (por sector comercial, Spec 26
  RN-CRM.15), costo/gastos por rubro (Spec 29 RN-COM.12), resultados financieros
  (diferencias de cambio 4.2.1/5.2.01, descuentos concedidos, recargos) — con drill-down
  de cada línea al mayor y del mayor al documento.
- **RN-EST.04** **Bimonetario con criterio declarado**: se presenta en pesos (moneda
  local del libro) y, opcionalmente, en dólares a un TC de referencia visible (mismo
  criterio del resumen mensual existente, Spec 06 RN-REP.03). Los importes originales en
  dólares conservan su cotización por línea (Spec 06 INV-CON.01).
- **RN-EST.05** Comparativos estándar: mes vs mes anterior, mes vs mismo mes del año
  anterior, acumulado del ejercicio — y contra presupuesto cuando exista (Spec 38).

## 3. Balance General

- **RN-EST.06** El **Balance** a fecha: activo (cajas por moneda, bancos, valores a
  depositar, deudores por venta, activo fijo neto — Spec 37), pasivo (anticipos de
  clientes, cuentas por pagar — Spec 29, cheques a pagar, IVA), patrimonio (capital,
  retiros de socios — Spec 29 RN-COM.06, resultados acumulados).
- **INV-EST.01** **El balance cuadra por construcción**: es la suma del libro, no un
  reporte paralelo — si no cuadra, hay un bug de asientos y salta como alerta de
  consistencia (Spec 21 RN-ADM.09), no como "diferencia a ajustar".
- **RN-EST.07** **Conciliaciones de soporte** visibles junto al balance: deudores por
  venta vs suma de deudas vivas; anticipos vs suma de saldos de billetera; valores a
  depositar vs cartera de cheques (Spec 28) — las tres igualdades que en el sistema
  actual se rompieron alguna vez, ahora verificadas en cada cierre.

## 4. Cierre de ejercicio

- **RN-EST.08** El cierre anual: asientos de refundición de resultados a patrimonio,
  generados con previsualización y aprobación del contador (o export para que los haga el
  estudio — DECISIÓN PENDIENTE con el contador sobre quién ejecuta el cierre formal).
  Los libros del contador (Spec 06 RN-REP.01) siguen existiendo como export.

## 5. Interacciones

| Con | Relación |
|---|---|
| Spec 06 | El libro y el motor de asientos son la fuente; los períodos acotan la retrofecha. |
| Spec 29 | Los gastos por rubro completan el resultado. |
| Spec 37 | Amortizaciones como asiento de ajuste; activo fijo neto en el balance. |
| Spec 38 | Comparativo real vs presupuesto. |
| Spec 21 | Las conciliaciones de cierre son chequeos de consistencia programados. |

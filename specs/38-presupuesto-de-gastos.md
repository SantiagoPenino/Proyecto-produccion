# Spec 38 — Presupuesto de Gastos (budget vs real) (to-be)

> Módulo nuevo y chico: presupuestar gastos por rubro/categoría y comparar contra el
> real. Se apoya enteramente en la familia de gastos (Spec 29 §3.1) — sin ella no tendría
> contra qué comparar.
> Entidades definidas aquí: **Presupuesto de Gastos**, **Partida Presupuestal**,
> **Desvío**.

## 1. El presupuesto

- **RN-PGA.01** Un **Presupuesto de Gastos** cubre un ejercicio (o un período) con
  **Partidas** por Rubro o Categoría de gasto (Spec 29 RN-COM.10) y monto mensual (igual
  todos los meses, o distribuido a mano — hay gastos estacionales). Moneda por partida
  (los gastos en dólares se presupuestan en dólares y se comparan con la cotización
  vigente).
- **RN-PGA.02** Ciclo simple: **Borrador → Vigente → Cerrado** (uno vigente por
  ejercicio; las revisiones crean versión nueva con registro de qué cambió — el
  presupuesto original no se pisa).
- **RN-PGA.03** Se construye con ayuda: la pantalla propone como base **el real del
  ejercicio anterior** por partida (± un % global), editable línea a línea.

## 2. El comparativo (lo que paga el módulo)

- **RN-PGA.04** **Real vs presupuesto** por partida y mes: ejecutado, presupuestado,
  desvío en monto y %, acumulado del ejercicio — con drill-down del desvío a los egresos
  que lo componen (Spec 29). Integrado al Estado de Resultados (Spec 35 RN-EST.05) como
  columna comparativa.
- **RN-PGA.05** **Alerta de desvío configurable** por partida: al superar el N% del mes
  (o al proyectar que se supera al ritmo actual), alerta operativa a administración
  (Spec 15) — el desvío se conoce durante el mes, no al cerrar.
- **RN-PGA.06** El presupuesto **no bloquea el gasto** (un egreso que excede la partida
  se registra igual — la caja no puede frenarse por control presupuestal): informa y
  alerta. Un control bloqueante por partida es DECISIÓN PENDIENTE (negocio) para
  categorías específicas, nunca el default.

## 3. Interacciones

| Con | Relación |
|---|---|
| Spec 29 | Las partidas son los rubros/categorías de gasto; drill-down a egresos. |
| Spec 35 | Columna comparativa del Estado de Resultados. |
| Spec 15 | Alertas de desvío durante el mes. |
| Spec 21 | El presupuesto vigente y sus versiones, administrables con historial. |

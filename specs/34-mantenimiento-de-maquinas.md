# Spec 34 — Mantenimiento de Máquinas (to-be)

> Módulo nuevo. Las máquinas son el corazón del negocio (23 equipos en 9 áreas, capacidad
> de planta calculada por su velocidad real) y hoy no tienen ningún módulo de
> mantenimiento — solo una categoría de tickets internos ("Mantenimiento Preventivo") sin
> ninguna funcionalidad detrás.
> Entidades definidas aquí: **Orden de Mantenimiento**, **Plan Preventivo**, **Contador
> de Uso**, **Repuesto/Insumo de Mantenimiento**, **Parada de Máquina**.

## 1. El equipo como activo mantenible

- **RN-MNT.01** La ficha del equipo (Spec 03 RN-PRO.23) se amplía con: fecha de compra /
  puesta en servicio, proveedor de servicio técnico, garantía, manuales adjuntos
  (Spec 19) y sus **Contadores de Uso**: horas de máquina (derivadas de la bitácora de
  producción — ya se registran) y metros/unidades producidos (derivados de los lotes).
  Los contadores se acumulan solos: nadie carga horas a mano.

## 2. Mantenimiento preventivo

- **RN-MNT.02** Un **Plan Preventivo** por equipo define tareas con disparador **por
  calendario** (cada N días/semanas) **o por uso** (cada N horas o N metros — el
  disparador correcto para impresoras y calandras), con su checklist y repuestos
  típicos. Al cumplirse el disparador, el sistema **genera la Orden de Mantenimiento
  automáticamente** y avisa (Spec 15 alertas).
- **RN-MNT.03** Los planes son datos maestros (Spec 21); las tareas vencidas y por vencer
  se ven en un **calendario de mantenimiento** por área y equipo.

## 3. Mantenimiento correctivo

- **RN-MNT.04** Una **Orden de Mantenimiento** correctiva nace de: un operario que
  reporta una falla de máquina (desde la pantalla del área — un clic, no un ticket
  aparte), un control de calidad que detecta un patrón (fallas de producción repetidas en
  el mismo equipo, Spec 03 — el sistema **sugiere** revisar la máquina cuando N fallas
  consecutivas comparten equipo), o carga manual.
- **RN-MNT.05** Ciclo de vida (motor, Spec 14): **Reportada → Programada → En ejecución →
  Completada / Cancelada**, con responsable (interno o servicio técnico externo —
  proveedor de la Spec 29), diagnóstico, trabajo realizado, repuestos usados con costo, y
  tiempo de parada.

## 4. La conexión con producción y capacidad (lo que lo hace valioso)

- **INV-MNT.01** Una máquina con mantenimiento en ejecución queda **fuera de servicio
  para producción**: no recibe lotes (guarda del motor, Spec 14) y **descuenta capacidad
  de planta** durante la ventana (Spec 03 RN-PRO.27) — la simulación de fechas de entrega
  deja de prometer sobre una máquina parada.
- **RN-MNT.06** El mantenimiento programado se agenda **contra el calendario de carga**:
  la pantalla muestra la cola de la máquina para elegir la ventana de menor impacto, y la
  parada planificada aparece en la agenda de planificación.
- **RN-MNT.07** **Historial por equipo**: todas las órdenes, costos (repuestos + servicio
  externo), horas de parada y disponibilidad (% del tiempo operativo). Responde "¿cuánto
  nos cuesta mantener cada máquina y cuánto para?" — insumo directo para decidir
  recambios (y para la amortización, Spec 37).
- **RN-MNT.08** Los **repuestos e insumos de mantenimiento** se registran en las órdenes
  con su costo (comprados vía Spec 29; categoría de gasto "mantenimiento" con imputación
  por equipo). Stock de repuestos: DECISIÓN PENDIENTE (negocio) — arrancar sin stock
  (solo costo por orden) y evaluar.

## 5. Interacciones

| Con | Relación |
|---|---|
| Spec 03 | Contadores desde la bitácora; máquina fuera de servicio no recibe lotes; capacidad descontada. |
| Spec 14 | Ciclo de la orden como proceso; guarda de fuera-de-servicio. |
| Spec 29 | Servicio técnico como proveedor; repuestos como gasto por equipo. |
| Spec 27 | La categoría de tickets "mantenimiento" deriva a órdenes de este módulo. |
| Spec 37 | Historial de costos y vida útil alimentan la gestión del activo. |

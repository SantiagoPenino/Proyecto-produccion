# Spec 36 — RRHH Ligero (empleados, asistencia, licencias) (to-be)

> Módulo nuevo, deliberadamente **ligero**: legajo + asistencia + licencias, conectados a
> producción y capacidad. La **nómina NO se liquida adentro** (en Uruguay la lleva el
> estudio/BPS): el sistema exporta las horas.
> Entidades definidas aquí: **Empleado (legajo)**, **Marcaje**, **Licencia**,
> **Novedad de Nómina**.

## 1. El Empleado

- **RN-RRH.01** El **Empleado** es la persona; el Usuario Interno (Spec 12) es su acceso
  al sistema — **vinculados formalmente** (la lección del vendedor con dos
  identificadores, Spec 26 INV-CRM.01, generalizada: operarios, vendedores y cajeros son
  empleados con usuario). Un empleado puede no tener usuario (personal sin pantalla);
  un usuario humano siempre tiene empleado.
- **RN-RRH.02** Legajo mínimo: datos personales y de contacto, documento, fecha de
  ingreso/egreso, **área y puesto**, turno habitual (del calendario laboral, Spec 03
  RN-PRO.25), y documentos adjuntos (Spec 19 — contrato, carné de salud, certificados),
  con vencimientos que alertan (carné de salud vencido, Spec 15).
- **RN-RRH.03** El legajo es dato sensible: acceso con permiso propio y auditado
  (Specs 12/25).

## 2. Asistencia

- **RN-RRH.04** **Marcaje** de entrada/salida por jornada: por pantalla/tótem interno con
  identificación del empleado (o importación desde un reloj externo — adaptador,
  Spec 22). El marcaje registra fecha/hora y origen; correcciones solo por permiso, con
  motivo y rastro (Spec 13).
- **RN-RRH.05** La asistencia se **cruza con el calendario laboral del área**: ausencias
  y llegadas fuera de turno quedan como novedades visibles para el supervisor — no para
  sancionar automáticamente, para que el dato exista.
- **RN-RRH.06** **El cruce que paga el módulo**: asistencia × bitácora de producción
  (Spec 03 RN-PRO.24) = productividad real por operario (horas presentes vs horas de
  máquina/bandeja registradas) y costo-hora real por área — insumo del costeo (Spec 09
  §6) y de los reportes de producción por operario que hoy existen a medias.

## 3. Licencias

- **RN-RRH.07** **Licencia** con tipo (nomenclador: anual, enfermedad, estudio,
  especial…), período, estado (solicitada → aprobada / rechazada — aprobación del
  supervisor con permiso) y saldo anual por tipo cuando aplica (la licencia anual
  reglamentaria).
- **INV-RRH.01** Una licencia aprobada **descuenta capacidad**: el empleado no aparece
  como operario disponible en su área durante el período, y si su ausencia deja a un
  equipo sin operarios, la capacidad de planta del área lo refleja (Spec 03 RN-PRO.27) —
  la fecha prometida deja de asumir gente que no va a estar.

## 4. Novedades para el estudio (en lugar de nómina)

- **RN-RRH.08** El sistema genera por período el **export de novedades**: días
  trabajados, ausencias, licencias por tipo, horas extra si se marcan — el insumo que el
  estudio necesita para liquidar. Formato acordado con el estudio (Spec 18 RN-DOC.10: el
  export entregado se congela como documento).
  > DECISIÓN PENDIENTE (negocio + estudio): formato y periodicidad del export; si se
  > registran horas extra y con qué autorización.

## 5. Interacciones

| Con | Relación |
|---|---|
| Spec 12 | Empleado ↔ Usuario vinculados; legajo con permiso. |
| Spec 03 | Turnos, capacidad descontada por licencias, productividad por operario. |
| Spec 09 §6 | Costo-hora real alimenta el costeo de proceso. |
| Spec 25 | Datos personales de empleados en el inventario de datos, con retención. |
| Spec 18 | Export de novedades como documento congelado. |

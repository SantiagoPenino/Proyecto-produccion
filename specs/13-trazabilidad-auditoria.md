# Spec 13 — Trazabilidad y Auditoría (módulo dedicado, to-be)

> Spec de escalamiento: define el módulo que el sistema nuevo debe tener, partiendo del
> diagnóstico del actual.
> Entidades definidas aquí: **Evento de Negocio**, **Hilo de Trazabilidad (correlación)**,
> **Bitácora**, **Retención**.

## 1. Diagnóstico del sistema actual

Hoy existen **cinco pistas paralelas** que no conversan: log de seguridad en archivo,
tabla de auditoría en base (cobertura parcial), historial de estados de órdenes (el único
completo y con autor obligatorio), registro de sesiones en memoria (volátil), y logs
sueltos de HTTP, emails e integraciones. Consecuencias:

1. No se puede responder "todo lo que le pasó al pedido X, de punta a punta" en un lugar.
2. Muchas operaciones de negocio (ediciones de precio, reclasificaciones, ajustes,
   anulaciones parciales) no dejan rastro en la pista visible.
3. Parte del rastro se pierde al reiniciar (memoria) o al rotar (archivos).
4. Sin antes→después en la mayoría de los casos: se sabe que algo cambió, no qué decía.
5. Cada incidente investigado (cobros dobles, re-avisos, remitos resucitados) exigió
   reconstruir la historia cosiendo fuentes.

## 2. El principio: un solo libro de eventos

- **INV-TRZ.01** **Toda operación de negocio emite exactamente un Evento de Negocio** en
  un libro único, **append-only** (solo se agrega, jamás se edita ni borra), escrito
  **dentro de la misma transacción** que la operación: si el evento no se puede escribir,
  la operación no ocurre. Generaliza el modelo del historial de estados actual — la única
  pista que funcionó siempre.
- **RN-TRZ.01** Estructura del Evento: tipo (nomenclador), fecha/hora, **actor**
  (identidad real o actor de sistema identificado — nunca genérico), origen (pantalla,
  job, API, dispositivo), entidad afectada (tipo + id), **antes→después** de los valores
  relevantes, detalle legible para humanos, y **correlación** (ver §3).
- **RN-TRZ.02** Cobertura mínima obligatoria (lo que hoy falta): cambios de estado (ya
  existe), cobros/anulaciones/reclasificaciones, ediciones de precio/cantidad/moneda,
  ajustes de saldo y de inventario, envíos (WhatsApp/email/push) con su resultado real
  (enviado/simulado/error), decisiones de acceso elevadas y denegaciones relevantes,
  cambios de configuración y de permisos, forzados manuales (forzar pedido, forzar
  recepción), y ejecuciones de jobs con su resultado.
- **RN-TRZ.03** Los eventos técnicos de bajo nivel (HTTP, integraciones) siguen en
  bitácoras propias con su retención, pero **referencian la correlación** para poder
  saltar del negocio a la técnica.

## 3. El hilo de trazabilidad (correlación)

- **RN-TRZ.04** Cada cadena de negocio comparte un **identificador de correlación** que
  nace con el Pedido y viaja por todo lo que deriva de él: órdenes → lotes → bultos →
  remitos → orden en depósito → retiro → cobro → documento → deuda → pagos → asientos →
  avisos. Las operaciones que tocan varias cadenas (un cobro de varios retiros)
  referencian todas.
- **RN-TRZ.05** **La pregunta canónica del módulo**: "mostrame la línea de tiempo completa
  de este pedido/cliente/documento" se responde con una consulta al libro, ordenada,
  legible, con actores — sin coser fuentes. Es la vista principal de la pantalla de
  auditoría del sistema nuevo.

## 4. Integridad del rastro

- **INV-TRZ.02** El libro es **inalterable por diseño**: sin operación de UPDATE/DELETE
  para nadie (ni administradores); las correcciones son eventos nuevos que referencian al
  corregido. Opcional recomendado: encadenamiento por hash para evidencia de no
  manipulación.
- **INV-TRZ.03** **Nada del rastro vive solo en memoria ni solo en archivos rotativos**:
  sesiones activas, intentos de acceso y streaks de jobs persisten en base.
- **RN-TRZ.06** **Retención declarada por tipo de evento** (datos administrables): los
  eventos de dinero y documentos fiscales se conservan según la exigencia legal; los
  técnicos, según necesidad operativa. El purgado es un job auditado que solo actúa sobre
  tipos con retención vencida.

## 5. Explotación

- **RN-TRZ.07** Pantalla de auditoría con filtros por actor, tipo, entidad, período y
  correlación; exportable. Los detalles sensibles respetan los permisos (Spec 12).
- **RN-TRZ.08** **Alertas sobre el libro**: patrones definibles (N anulaciones seguidas
  del mismo usuario, ajustes de saldo fuera de horario, forzados repetidos) generan avisos
  a administración. El libro deja de ser solo forense y pasa a ser preventivo.
- **RN-TRZ.09** Los reportes de control existentes (entregadas sin pago, caja central vs
  administrativa, cierres con diferencia) se alimentan del libro, no de consultas ad-hoc.

## 6. Interacciones

| Módulo | Interacción |
|---|---|
| Máquina de estados (Spec 14) | Cada transición ejecutada por el motor ES un evento del libro — una sola escritura, un solo formato. |
| Seguridad (Spec 12) | Autor obligatorio; autorizaciones elevadas con doble actor; acceso al libro con permisos. |
| Todos los módulos | Emiten eventos en vez de escribir pistas propias; sus pantallas de "historial" leen del libro. |

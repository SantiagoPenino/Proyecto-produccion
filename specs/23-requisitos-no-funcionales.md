# Spec 23 — Requisitos No Funcionales (to-be)

> Los números que el sistema nuevo debe cumplir. Los volúmenes salen de la operación real
> medida en el sistema actual (2026); los objetivos son compromisos de diseño. Sin
> números, "que ande rápido" no es un requisito.

## 1. Volúmenes reales (dimensionamiento)

Medidos en el sistema actual — el nuevo debe soportarlos con margen ×3 (crecimiento):

| Dimensión | Valor actual | Diseñar para |
|---|---|---|
| Órdenes/día DTF | ~154 | ~500 |
| Órdenes/día Sublimación | ~101 | ~300 |
| Órdenes/día resto de áreas (juntas) | <70 | ~200 |
| Máquinas activas | 23 en 9 áreas | 50 |
| Documentos fiscales | miles/mes | ×3 |
| Asientos contables acumulados | ~17.500 y creciendo | millones (con archivado) |
| Tamaño del libro mayor completo | ~9,7 MB si se trae entero | nunca se trae entero |
| Clientes con billetera activa | miles | ×3 |
| Archivos por pedido | 1–20 (artes + referencias) | igual, archivos de cientos de MB |
| Usuarios internos concurrentes | decenas | 100 |
| Operarios escaneando a la vez (depósito/auditoría) | varios simultáneos | 20 concurrentes sin pisarse |

## 2. Rendimiento (percentil 95, no promedio)

- **RN-NFR.01** Operaciones interactivas (abrir bandeja, buscar orden, cobrar):
  **p95 < 2 s**. Escaneo de un código (pistoleo): **p95 < 1 s** — el operario con la
  pistola no puede esperar.
- **RN-NFR.02** Listados: siempre paginados; los totales del filtro completo se calculan
  en el servidor (Spec 17 RN-FRO.15). Ninguna respuesta interactiva supera unos cientos
  de KB.
- **RN-NFR.03** Reportes pesados y exports corren como tarea con progreso, nunca
  bloqueando la sesión; **p95 < 60 s**.
- **RN-NFR.04** Los jobs cumplen su intervalo: un ciclo de avisos no puede tardar más que
  su período. Procesamiento de imágenes (capa blanca, medición): resultado visible en
  **< 2 min** con estado intermedio "procesando".
- **RN-NFR.05** *(Lección directa)* La entrega múltiple, el cierre de ciclo y el envío en
  lote se diseñan como **una transacción por ítem** con resultado parcial informado —
  jamás una transacción global que bloquee caja y facturación (el incidente de los 75 s).

## 3. Concurrencia y consistencia

- **RN-NFR.06** Operaciones de dinero y stock: **serializables o con bloqueo optimista**;
  ante conflicto, reintento automático seguro (Spec 15) — el usuario no ve el deadlock.
- **RN-NFR.07** Dos operarios sobre el mismo recurso (misma bobina, mismo retiro, misma
  edición): el segundo recibe el estado real, nunca pisa en silencio (detección de
  edición concurrente).
- **RN-NFR.08** Los descuentos condicionados se conservan como patrón: dos pedidos
  simultáneos no dejan una bobina/cuenta en negativo no permitido — el segundo falla con
  mensaje.

## 4. Disponibilidad y recuperación

- **RN-NFR.09** Horario crítico del negocio: lunes a sábado en horario de planta y
  mostrador. Objetivo: **99,5% de disponibilidad en horario crítico** (≈ máx. 1,5 h/mes
  caído en horario de trabajo).
- **RN-NFR.10** **RPO ≤ 1 hora** (máxima pérdida de datos aceptable ⇒ respaldo continuo o
  log-shipping cada ≤ 1 h). **RTO ≤ 4 horas** (máximo tiempo para volver a operar desde
  un desastre, con la restauración probada de la Spec 21 RN-ADM.06).
  > DECISIÓN PENDIENTE: validar con el negocio si 1 h de pérdida de cobros de mostrador
  > es aceptable o si caja exige RPO menor.
- **RN-NFR.11** Dependencias externas caídas **no tumban lo local**: los modos de
  degradación de la Spec 22 son parte del contrato de disponibilidad.

## 5. Capacidad de datos y archivado

- **RN-NFR.12** Las tablas de crecimiento infinito (eventos, movimientos, asientos,
  archivos) nacen con **estrategia de archivado** declarada (partición o archivo frío por
  antigüedad, según retención de Specs 13/19/25): el sistema a 10 años no puede depender
  de que "todavía aguanta".
- **RN-NFR.13** El almacenamiento de archivos se dimensiona por crecimiento anual medido
  y alerta por umbral de espacio (Spec 21 salud).

## 6. Operación

- **RN-NFR.14** Deploy sin pérdida de trabajo en curso: ventana anunciada (Spec 21
  RN-ADM.10) o deploy sin corte; nunca "se reinició y perdí lo que estaba cargando".
- **RN-NFR.15** Observabilidad mínima de fábrica: latencia por operación, errores por
  tipo, profundidad de colas, duración de jobs — visibles en la consola sin herramientas
  externas obligatorias.

## 7. Interacciones

| Con | Relación |
|---|---|
| Spec 16 | La arquitectura debe poder cumplir estos números (colas, capa de lectura, paginación). |
| Spec 21 | Backups (RPO/RTO), salud, archivado y alertas de capacidad. |
| Spec 24 | Los números son criterios de aceptación verificables (pruebas de carga). |

# Spec 22 — Integraciones Externas (to-be)

> Spec de escalamiento. Cada sistema externo se trata como un **contrato**: qué se le
> pide, qué garantiza, cómo degrada cuando falla y cómo se prueba sin tocar el mundo
> real. Un proveedor debe poder cambiarse sin reescribir el negocio (ya pasó una vez: el
> cambio de facturador dejó como cicatriz las NC externas).
> Entidades definidas aquí: **Integración**, **Adaptador**, **Modo de Degradación**,
> **Modo Sandbox**, **Bitácora de Integración**.

## 1. Principios

- **INV-INT.01** **El dominio nunca conoce al proveedor**: conoce un puerto ("emitir
  CFE", "leer stock", "enviar aviso") y cada proveedor es un **Adaptador** intercambiable
  (Spec 16 RN-ARQ.06). Cambiar de proveedor = escribir un adaptador nuevo, no tocar
  negocio.
- **INV-INT.02** **Toda integración declara su modo de degradación** (Spec 15 RN-ERR.08):
  qué se bloquea, qué sigue con dato faltante, qué se encola. "Se cayó X" nunca se
  descubre por sus síntomas.
- **INV-INT.03** **Toda llamada externa queda en bitácora** (request resumido, resultado,
  duración, correlación — Spec 13) y **toda integración tiene modo sandbox/simulado
  explícito** que jamás marca operaciones de negocio como hechas (Spec 15 INV-ERR.02).
- **RN-INT.01** Credenciales de integraciones: cifradas, rotables, nunca expuestas
  (Spec 12 RN-SEG.10); estado de salud visible en la consola (Spec 21 RN-ADM.08).

## 2. El contrato por integración

### 2.1 DGI / proveedor CFE (crítica)

- **Función**: solicitar CAE y emitir CFE; el proveedor valida matemática y referencias.
- **Degradación**: proveedor caído ⇒ los documentos quedan **pendientes de envío en la
  bandeja** (la venta y el cobro NO se frenan); reintento por lote cuando vuelve. Falta
  en el sistema actual un **procedimiento de contingencia formal** — el sistema nuevo lo
  define: cola de pendientes visible + alerta si supera umbral de horas.
- **Sandbox**: entorno de homologación del proveedor para pruebas; los documentos de
  prueba jamás se mezclan con reales (empresa emisora de prueba).
- **Vigilancia propia**: stock y vencimiento de numeradores CAE por empresa y tipo
  (Spec 21 salud) — quedarse sin numerador es quedarse sin facturar.

### 2.2 WMS (depósito externo)

- **Función**: catálogo maestro + variantes con SKU, stock del depósito de ventas,
  remitos de egreso al preparar.
- **Degradación** (contrato ya probado, se conserva): catálogo sin respuesta ⇒ stock
  "sin dato" y **la venta no se cae**; preparación con WMS caído ⇒ **sí se bloquea**;
  faltante puntual ⇒ advertencia sin abortar. Combos: sin dato ≠ sin stock.
- **Cambio estructural**: la vinculación por NOMBRE se reemplaza por **clave estable**
  (Spec 08 RN-WMS.01).
- **Sandbox**: modo simulado que no toca stock físico, apagable por configuración (no
  "desactivar antes de deployar" a mano).

### 2.3 WhatsApp (avisos)

- **Función**: plantilla aprobada de aviso "pronto para retirar", por orden.
- **Degradación**: sin credenciales ⇒ **modo simulado que NO marca avisado** (corrige el
  actual); proveedor caído ⇒ los avisos quedan en cola con reintento; teléfono inválido ⇒
  error visible al operador sin marcar.
- **Control de ritmo**: throttle por destinatario y concurrencia acotada (anti-bloqueo
  del número), configurables.
- **Modo prueba**: todo a un número de test (se conserva).

### 2.4 Email (transaccional y contabilidad)

- **Función**: activaciones, reseteos, comprobantes con PDF, estados de cuenta.
- Selección por credenciales con forzado opcional; **modo simulado explícito** con estado
  propio; historial único de envíos (se conserva todo de la Spec 10 RN-MAIL.04/05).

### 2.5 Pasarelas de pago (cobros online)

- **Función**: cobros del portal; webhooks de confirmación.
- **Reglas**: todo cobro online es **caja administrativa**; los webhooks son
  **idempotentes** (el mismo aviso dos veces no duplica el cobro) y verifican firma;
  la **cotización implícita del cobro** manda para las líneas (Spec 06 RN-FAC.09 — nació
  de que la pasarela cobra a SU tasa).
- **Degradación**: webhook perdido ⇒ conciliación periódica contra la pasarela
  (job que detecta cobros no registrados).

### 2.6 Cotización de moneda (banco central + respaldo)

- Una cotización por día, fuente primaria con reintento hacia atrás y proveedor de
  respaldo (se conserva la Spec 09 RN-PRE.16). Sin cotización del día ⇒ las operaciones
  que la exigen **se rechazan** (nunca se inventa un TC) y salta alerta.

### 2.7 Almacenamiento de archivos

- El repositorio de la Spec 19 abstrae el backend físico (disco, nube, Drive legacy):
  mover el almacenamiento no cambia ninguna referencia (la identidad es el id, no la
  ruta).

### 2.8 Entrada por API (planillas / sistemas externos)

- Clave de API por integración con alcance acotado (Spec 12 RN-SEG.11); validación
  **tolerante con marca** (entra señalado para revisión, no se rechaza — se conserva);
  bitácora completa.

## 3. Pruebas de integración

- **RN-INT.02** Cada adaptador tiene su **doble de pruebas** (fake) que implementa el
  mismo puerto: el sistema completo se prueba de punta a punta sin tocar proveedores
  reales (Spec 24). Los contratos se verifican además con pruebas contra el sandbox real
  del proveedor, separadas y ejecutables a demanda.

## 4. Interacciones

| Con | Relación |
|---|---|
| Spec 15 | Modos de degradación y colas con reintento son la política de errores aplicada. |
| Spec 16 | Puertos y adaptadores; los proveedores viven en infraestructura. |
| Spec 21 | Salud de cada integración en la consola; credenciales y su rotación. |
| Spec 13 | Bitácora con correlación: del evento de negocio a la llamada externa. |

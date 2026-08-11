# Plan: Cobro en tótems de autoservicio + caja — POSLink (tarjeta) y Cashdro (efectivo)

**Estado:** 🟡 Propuesta para revisión (nada implementado)
**Fuente:** "Especificación POSLink 1.50" (junio 2026, escritorio) — Resonet/Geocom. Cashdro: sin documentación aún.
**Fecha del análisis:** 2026-07-03 · **Actualizado:** 2026-08-07 (releída completa de la spec + definición de alcance con Santiago)

---

## 0. Alcance definido (2026-08-07)

- **El objetivo principal son los 2 tótems de autoservicio**: el cliente paga solo, sin cajera. Lo que en el plan original era la fase futura (F5) pasa a ser el centro.
- **3 pinpads**: 1 Lane por tótem (autoservicio, sin operador) + 1 POS estándar para la cajera física.
- **Una sola caja contable para los dos tótems** ("Caja Tótem"); la cajera mantiene la suya como hoy.
- **A los tótems se les suma un Cashdro** (cajón inteligente de efectivo) — el cobro del tótem se diseña con **proveedores de pago enchufables** (tarjeta/efectivo) desde el día 1.
- POSLink **no habla con DGI**: la factura electrónica (CFE) la emite nuestra facturación, como hoy. Lo fiscal que viaja al POS es `InvoiceNumber` + `TaxableAmount` + `TaxRefund` para que el adquirente aplique la devolución de IVA (ley 19.210).

## 1. Qué es POSLink y qué nos da

POSLink conecta nuestro **sistema de caja (SCA)** con los **pinpads POS** físicos vía el **servidor POSLink (PLS)** de Resonet. Hoy el cobro con tarjeta es manual: el cajero tipea el monto en el POS, cobra, y después registra el pago en la caja a mano — dos sistemas sin hablar, con riesgo de diferencias (typos de monto, pagos registrados que nunca se cobraron y viceversa). Y en un tótem directamente no hay forma de cobrar.

Integrado: el sistema manda el monto al pinpad → el cliente pasa la tarjeta → recibimos el resultado (aprobada/denegada) con código de autorización, ticket, tarjeta enmascarada → **el pago se registra solo**, con la conciliación garantizada.

- **Protocolo:** REST (JSON) contra PLS. SOAP existe pero es legacy — usamos REST.
- **URL homologación:** `https://poslink.hm.opos.com.uy/itdServer/` (producción se entrega al homologar).
- **Modelo:** asíncrono con **polling**: se inicia la transacción y se consulta el estado cada **2–3 segundos** hasta el resultado final.

## 2. Flujo core (venta simple)

Usamos el flujo **sin promociones** (`NeedToReadCard = false`, el default) — el más simple y robusto:

```
Front (tótem/caja)        Backend                  PLS                    Pinpad
 |--- cobrar $X ---------->|                       |                      |
 |                         |-- processFinancialPurchase -->|              |
 |                         |<- ResponseCode 0 + TransactionId             |
 |<-- ptxId ---------------|                       |                      |
 |                         |                       |<--- pinpad levanta la venta
 |--- polling c/2.5s ----->|-- processFinancialPurchaseQuery -->|         |
 |<-- RC 10 "esperando tarjeta"                    |     (cliente pasa tarjeta,
 |<-- RC 12 "procesando"   |                       |      PIN, va al adquirente)
 |<-- RC 0 + PosResponseCode 00 (APROBADA) + AuthorizationCode/Ticket/...  |
 |--- cierre común: registrar Pago + CFE + habilitar retiro --|           |
```

**Códigos que gobiernan el estado** (Anexos 1/2/8 de la spec):
- `ResponseCode`: `10` = esperando que el pinpad capture · `12` = pinpad procesando · `0` = **finalizada** (el resultado real viene en `PosResponseCode`) · `111` = ya finalizada (re-consulta) · `11` = tiempo excedido · `-100` = campos mal formados.
- `PosResponseCode`: `00`/`11`/`08`/`85`/`OF` = **aprobada** · `TP` = pendiente (billeteras) · resto = denegada con motivo (mapa completo Anexo 2: "TARJETA INVALIDA", "SALDO INSUFICIENTE", "RETENER TARJETA"...). Mapear a español para el cliente.
- `RemainingExpirationTime`: segundos restantes — **es la referencia oficial para timeouts y reversas**. Escalera (V150+): arranca 240 → se reinicia a 240 al capturar → cae a **70 s** (tarjeta) o **130 s** (billetera) cuando va al adquirente.

**Datos clave del request** (`processFinancialPurchase`):
- `PosID` (terminal), `SystemId` (nos lo asigna Resonet, secreto), `Branch`, `ClientAppId` (id del dispositivo), `UserId` (cajero, o "TOTEM").
- `Amount`/`InvoiceAmount`: **string de centavos sin separadores** ("1.200,50" → `"120050"`). Un helper único y testeado.
- `Currency`: `"858"` UYU / `"840"` USD → mapea directo de nuestro `MonIdMoneda` 1/2.
- `Quotas`: mandar `1` (con `0` el pinpad pregunta cuotas en pantalla — la spec lo desaconseja).
- `InvoiceNumber`: **máx 7 chars** — número del CFE (⇒ facturar ANTES de cobrar) o `TcaIdTransaccion`.
- `TaxRefund`/`TaxableAmount`: ver §5 (fiscal).

**Respuesta final** (query): `AuthorizationCode` (⚠️ hasta **20 chars** desde v1.34 — billeteras), `Ticket`, `Batch`, `CardNumber` (enmascarada; billeteras = `999999******9999`), `Issuer`/`Acquirer`, `InputMode`, `EmvApplicationName`, `AdditionalData` (`PosId#RequiereFirma#MensajePromocional#LiteralEstadoBilletera`) — todo se persiste para auditoría/conciliación.

## 3. Arquitectura

**El backend es el único que habla con PLS** (el `SystemId` es secreto y el flujo necesita estado confiable). Tótem y caja pollean a *nuestro* backend.

### 3.0 Proveedores de pago enchufables (decisión de diseño clave)

El cobro del tótem NO se ata a POSLink. Se separa en dos capas:

```
Tótem: "¿Cómo querés pagar?"
   ├── Tarjeta      → poslinkService      (POS Lane, polling, reversas)
   ├── Efectivo     → cashdroService      (inserta billetes, da vuelto)   ← FUTURO, API local del equipo
   └── MercadoPago  → mercadopagoService  (QR dinámico en pantalla)      ← FUTURO, sin hardware
                        ↓  (cualquiera, al aprobar)
        CIERRE COMÚN (se escribe UNA vez, no sabe de dónde vino la plata):
        registrar Pago en Caja Tótem → boleta CFE automática → habilitar retiro → voucher
```

El Cashdro tendrá su propio plan cuando esté el manual/API del modelo elegido. MercadoPago es el proveedor más simple (QR por API, sin hardware; mismo patrón de polling). Lo que sí se decide HOY es que el cierre común y la tabla de cobros del tótem sean agnósticos del medio de pago.

### 3.1 SQL (tablas nuevas)

```sql
-- Mapa dispositivo → terminal POS + a qué caja contable asienta
CREATE TABLE dbo.PosTerminales (
    ID INT IDENTITY PRIMARY KEY,
    ClientAppId NVARCHAR(100) NOT NULL,   -- 'TOTEM1' | 'TOTEM2' | 'CAJA1' (trazabilidad por dispositivo)
    PosID NVARCHAR(10) NOT NULL,          -- terminal asignado por Resonet
    CajaContable NVARCHAR(50) NOT NULL,   -- 'TOTEM' (una sola para ambos tótems) | 'CAJA1'
    EsAutoservicio BIT NOT NULL DEFAULT 0,-- 1 = Lane sin operador ⇒ reversas obligatorias
    Descripcion NVARCHAR(100) NULL,
    Activo BIT NOT NULL DEFAULT 1
);

-- Toda transacción POSLink que iniciamos: auditoría + máquina de estados + reversas
CREATE TABLE dbo.PosTransacciones (
    PtxId INT IDENTITY PRIMARY KEY,
    TransactionId BIGINT NULL,            -- id de PLS (19 dígitos) — usar STransactionId si hace falta
    PosID NVARCHAR(10) NOT NULL,
    TcaIdTransaccion INT NULL,            -- link a TransaccionesCaja (cuando se concreta)
    PagIdPago INT NULL,                   -- link al Pago registrado
    Tipo NVARCHAR(20) NOT NULL,           -- VENTA | ANULACION | DEVOLUCION | REVERSA
    Estado NVARCHAR(20) NOT NULL,         -- INICIADA | EN_POS | APROBADA | DENEGADA | CANCELADA | EXPIRADA | REVERSADA
    Monto DECIMAL(18,2) NOT NULL,
    MonIdMoneda INT NOT NULL,
    ResponseCode INT NULL,
    PosResponseCode NVARCHAR(10) NULL,
    AuthorizationCode NVARCHAR(20) NULL,  -- ⚠️ 20 chars (billeteras)
    Ticket NVARCHAR(10) NULL,
    Batch NVARCHAR(5) NULL,
    CardNumber NVARCHAR(50) NULL,         -- enmascarada, viene así de PLS
    Issuer INT NULL, Acquirer INT NULL,
    RawRespuesta NVARCHAR(MAX) NULL,      -- JSON completo de la última query (debug/conciliación)
    UsuarioId INT NULL,
    FechaInicio DATETIME NOT NULL DEFAULT GETDATE(),
    FechaFin DATETIME NULL
);
```

Config global (`SystemId`, `Branch`, URL) en **variables de entorno** (`POSLINK_URL`, `POSLINK_SYSTEM_ID`, `POSLINK_BRANCH`) — secretos fuera de la DB, patrón ya usado (Drive, Callbell).

### 3.2 Backend

**`backend/services/poslinkService.js`** (nuevo) — cliente REST puro, sin lógica de negocio:
- `iniciarVenta({posId, monto, monedaId, invoiceNumber, userId, clientAppId})` → `processFinancialPurchase` (con `TransactionDateTimeyyyyMMddHHmmssSSS` generado acá).
- `consultarEstado(transactionId, posId, ...)` → `processFinancialPurchaseQuery`.
- `cancelar(...)` → `cancelFinancialPurchase` (solo válida con RC 10, según spec).
- `anular(ticketOriginal, ...)` → `processFinancialPurchaseVoidByTicket` (mismo lote abierto, monto total).
- `devolver(datosOriginales, ...)` → `processFinancialPurchaseRefund` (lote cerrado, parcial o total).
- `reversar(transactionId, ...)` → `processFinancialReverse`.
- `cierreLote(posId)` → `processCloseQuery` / `processQueryLastNClose`.
- Helpers: `aCentavos(1200.50) → "120050"`, `monedaISO(monIdMoneda) → "858"|"840"`, **axios con timeout corto (10s)** — nunca colgar al que espera.

**`backend/controllers/poslinkController.js` + `backend/routes/poslinkRoutes.js`** (nuevos), montado en `/api/poslink`:
- `POST /venta` — valida, resuelve `PosID` desde `PosTerminales` por el dispositivo, inserta `PosTransacciones` (INICIADA) **antes** de hablar con PLS, llama `iniciarVenta`, devuelve `ptxId`.
- `GET /estado/:ptxId` — consulta PLS, actualiza `PosTransacciones` (estado + raw), devuelve estado normalizado: `{estado, mensaje, authorizationCode?, ticket?, remainingTime}`. **Server-side throttle**: si preguntan más seguido que cada 2 s, responder cache (respeta el "2-3 s" de la spec).
- `POST /cancelar/:ptxId` — solo si el último RC fue 10.
- `POST /anular` / `POST /devolucion` — fase 3 (solo caja de la cajera).
- `POST /cierre` — fase 4.
- **Regla de reversa (venta simple, sin NTRC)**: si en el polling llega `ResponseCode 12` con `RemainingExpirationTime == 0` → la transacción murió sin respuesta → `processFinancialReverse` automático + estado `REVERSADA` + cartel "no se te cobró, intentá de nuevo". La reversa queda encolada en el pinpad y sale antes de la próxima transacción (puede demorar hasta 24 h en efectivizarse).
- **Recuperación**: al iniciar una venta para un `PosID`, si hay una `PosTransacciones` colgada (INICIADA/EN_POS vieja) — p. ej. el backend se reinició a mitad de un cobro — resolverla primero: query → aprobada = vincular el pago / muerta = reversar. Recién ahí aceptar la nueva.

### 3.3 Tótem (autoservicio — el objetivo)

El cliente ya se identifica en el tótem (busca su pedido, anuncia retiro). Se agrega:

1. Ve el saldo del pedido → **"Pagar con tarjeta"** (o efectivo, cuando esté el Cashdro).
2. Backend inicia la venta contra **el Lane de ese tótem** → pantalla "Pasá tu tarjeta en el lector".
3. Polling con estados en vivo: esperando tarjeta → procesando → ✅ aprobada / ❌ rechazada (motivo en español) / expirada.
4. Aprobada → **cierre común**: pago real en Caja Tótem (`PagIdPago`, `EstadoCobro` → Pagado, motor de caja/cobranza actual) → boleta CFE automática → se habilita el retiro.
5. **Voucher por la impresora del tótem** (los Lane chicos no imprimen; el tótem ya imprime el ticket de retiro). Con los datos de la query: auth, ticket, tarjeta enmascarada. **Nunca en el camino crítico** — primero el éxito, después imprimir (lección aprendida del print bloqueante).
6. **Reversas obligatorias** (spec, caso tótem/Lane textual: "debe asegurarse que la última transacción no se le debite al usuario"). Sin excepción en autoservicio.
7. Cancelar: botón "Cancelar" en el tótem mientras RC 10; después, solo el botón rojo del pinpad.

### 3.4 Caja de la cajera

- **`MetodosPagos`**: registro nuevo **"Tarjeta (POS integrado)"** (o flag sobre el método Tarjeta existente — ver P3). El motor contable/CFE lo trata igual que el método tarjeta actual.
- **`CobroPOSModal.jsx`** (nuevo): se abre desde `CajaPanelPago`. Monto grande + estado en vivo, botón Cancelar habilitado solo mientras RC 10. Polling cada 2.5 s con cleanup.
- **Al aprobar**: completa el flujo actual de `procesarTransaccion` (TransaccionesCaja + Pagos + motor contable + CFE, sin cambios) y se linkea `PosTransacciones.PagIdPago`. Referencia en el pago: `POS Auth 077629 Ticket 209`.
- **Voucher**: lo imprime su pinpad.
- **Sin reversas automáticas** en el mostrador: la spec exime a cajas atendidas cuyo POS imprime voucher y donde el cajero puede registrar a mano. La cajera además resuelve anulaciones/devoluciones — también las de los tótems.

## 4. Fases

| Fase | Contenido | Riesgo |
|---|---|---|
| **F0 — Prerrequisitos** | Alta con Resonet: `SystemId`, acceso a homologación. **Pedir 2 Lane (tótems) + 1 POS (cajera)**. Sin esto no se prueba nada. | Trámite externo |
| **F1 — Venta simple en la caja de la cajera** | Tablas + service + controller + modal + registro automático del pago. Homologar contra `poslink.hm`. Valida todo el stack con un humano adelante. | Medio |
| **F2 — Tótem** | Cierre común de cobro (agnóstico del medio de pago), reversas automáticas, recuperación de colgadas, boleta CFE automática, UX de pago en el kiosco, voucher por la impresora del tótem. | **Alto — acá está la plata** |
| **F2.5 — Cashdro** | Efectivo en los tótems por el mismo cierre común. Se especifica cuando esté el manual/API del modelo. | A definir |
| **F2.6 — MercadoPago** | **La integración YA EXISTE en la web** (`mercadoPagoService.js`: Checkout Pro + tabla `MercadoPagoTransactions` + webhook `/api/web-orders/mp-webhook` + `MP_ACCESS_TOKEN`). Para el tótem: opción A = reusar Checkout Pro mostrando el `init_point` como QR en pantalla (cliente paga en su teléfono, el webhook existente confirma, el tótem pollea nuestra tabla) — casi sin código nuevo; opción B = QR presencial nativo (Instore API, abre la app de MP con el monto cargado) — mejor UX, API nueva. Conciliación aparte (la plata cae en la cuenta MP, no en el lote del POS). | Bajo |
| **F3 — Anulación/Devolución** | Desde la caja de la cajera (lote abierto → anulación por ticket; lote cerrado → devolución parcial/total), incluyendo cobros de los tótems. | Medio |
| **F4 — Cierre y conciliación** | Cierre de lote (desde el pinpad, la spec no lo permite desde caja) + reporte diario `processQuery` vs `Pagos` (3 terminales, 2 cajas). Con Cashdro: sus totales de efectivo entran al arqueo de la Caja Tótem. | Bajo |

## 5. Fiscal (DGI / CFE / devolución de IVA)

- **POSLink no factura ni habla con DGI.** La boleta/factura CFE la emite nuestro sistema, como hoy.
- Para que el adquirente aplique la **devolución de IVA (ley 19.210)** hay que mandar: `TaxRefund` (Anexo 3: `1` = devolución IVA 19.210; **`0` si es factura con RUT** — FAQ textual), `TaxableAmount` (monto gravado = `total/1.22`, mezcla: `70/1.22 + 30/1.10`; ítems exentos suman solo para MIDES) e `InvoiceNumber` (máx 7).
- ⇒ **Orden de operaciones: facturar primero, cobrar después** (el número de CFE viaja en el request).
- **Tótem**: boleta automática **consumidor final** al aprobar el pago. ¿Factura con RUT? → el tótem lo manda con la cajera (meter ingreso de RUT en el kiosco no paga en F2).
- **AFAM al 10%**: si aplicara al rubro, hay cálculo especial vía `IVAAmount` (FAQ). Consultar con el contador; no bloquea.

## 6. Riesgos y decisiones técnicas

- **Homologación obligatoria**: Resonet certifica contra homologación antes de dar producción. F1 no se valida sin terminal de prueba.
- **Es dinero real**: persistir en `PosTransacciones` ANTES de hablar con PLS. Doble cobro es el peor escenario: máquina de estados + reversas + recuperación existen para eso.
- **Timeouts**: `RemainingExpirationTime` es la única referencia válida. No inventar timeouts propios.
- **Nada bloqueante**: polling con estados visibles; ni la cajera ni el tótem quedan colgados esperando a PLS (axios timeout 10 s).
- **Montos**: SIEMPRE string de centavos. Helper único y testeado — un error acá cobra 100× o /100.
- **`AuthorizationCode` 20 chars** y `CardNumber 999999******9999` (billeteras TOKE/Pago Después): dimensionar columnas desde el día 1.
- **Billeteras**: exigen pinpad v150+; pueden quedar en `PosResponseCode TP` (pendiente) que se verifica a mano en el pinpad. FUERA del alcance fino de F1/F2 (si el pinpad las acepta, funcionan; el manejo del TP es fase posterior).
- **TOKE por SpecialData** exige saber consumidor final vs RUT ANTES de mandar la transacción — otro motivo del orden "facturar → cobrar".
- **V150+ en los pinpads** desde el arranque (pedirlo a Resonet): BIN 8-9 dígitos, AuthorizationCode 20, timeouts nuevos, SpecialData.
- **SOAP**: no usar, legacy.

## 7. Preguntas abiertas

> **P1 — Dispositivos.** ✅ RESPONDIDA (2026-08-07): 2 tótems de autoservicio + 1 cajera física. 1 Lane por tótem (a confirmar que no compartan), 1 POS mostrador. Una caja contable para ambos tótems. Cashdro a futuro en los tótems.

> **P2 — ¿Ya tienen relación con Resonet/Geocom?** ¿Hay `SystemId` asignado o hay que iniciar el alta? ¿Fecha para homologación? ¿Los Lane ya están cotizados?
>
> **R:** _(pendiente)_

> **P3 — Método de pago:** ¿"Tarjeta (POS)" nuevo en `MetodosPagos`, o flag al método Tarjeta existente? Impacta reportes/motor contable.
>
> **R:** _(pendiente)_

> **P4 — Cuotas:** tótem = contado fijo (`Quotas=1`) asumido. ¿La cajera necesita ofrecer cuotas?
>
> **R:** _(pendiente)_

> **P5 — Monedas:** tótem = solo pesos asumido. ¿La cajera cobra USD por POS (Currency 840)?
>
> **R:** _(pendiente)_

> **P6 — Fiscal:** confirmar con el contador: boleta automática consumidor final en tótem, `TaxRefund=1` + `TaxableAmount`; RUT → cajera. ¿AFAM aplica al rubro?
>
> **R:** _(pendiente)_

> **P7 — Alcance F3:** ¿anulación/devolución integrada es requisito de arranque o alcanza con hacerlo a mano en el pinpad hasta F3?
>
> **R:** _(pendiente)_

> **P8 — Propina** (`TipAmount`): asumo que NO aplica.
>
> **R:** _(pendiente)_

> **P9 — Cashdro:** ¿qué modelo va? Conseguir manual/API para armar su plan (F2.5).
>
> **R:** _(pendiente)_

> **P10 — MercadoPago:** cuenta y credenciales YA existen (la web cobra por MP con Checkout Pro). Fiscal: el tótem replica el tratamiento que ya se le da a los pagos MP de la web. Queda elegir en F2.6: ¿reusar Checkout Pro como QR en pantalla (opción A, casi gratis) o QR presencial nativo Instore (opción B, mejor UX)?
>
> **R:** _(pendiente la elección A/B)_

---

## 8. Resumen de archivos a crear/tocar

| Archivo | Acción |
|---|---|
| `backend/services/poslinkService.js` | NUEVO — cliente REST PLS |
| `backend/services/cashdroService.js` | FUTURO (F2.5) — cliente API Cashdro |
| `backend/controllers/poslinkController.js` | NUEVO — venta/estado/cancelar/reversa + máquina de estados + recuperación |
| `backend/routes/poslinkRoutes.js` + `server.js` | NUEVO + montar `/api/poslink` |
| Cierre común de cobro del tótem (pago + CFE + retiro + voucher) | NUEVO — agnóstico del medio de pago |
| SQL | `PosTerminales` (con `CajaContable` + `EsAutoservicio`), `PosTransacciones`, registro en `MetodosPagos`, alta "Caja Tótem" |
| Tótem (front) | Pantalla de pago: selector de medio, estados en vivo, voucher |
| `src/components/pages/CobroPOSModal.jsx` | NUEVO — UI del cobro en vivo (cajera) |
| `src/components/pages/CajaPanelPago.jsx` | Hook del método POS → abre modal → completa pago |
| `.env` | `POSLINK_URL`, `POSLINK_SYSTEM_ID`, `POSLINK_BRANCH` |

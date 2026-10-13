# POSLink (Resonet) — Plan de implementación

**Fecha:** 16/09/2026 — **revisión 2.2**
**Estado (12/10/2026):** **F1 implementada** (sin pantallas): `backend/services/poslink/` (cliente, estados, servicio), `jobs/poslinkBarrido.job.js`, `scripts/sql/poslink_2026-10-12.sql`, `scripts/poslinkProbar.js`, tests en `__tests__/poslinkEstados.test.js`. Probada contra homologación con PosID inventados (venta, consulta, cancelación, candados A y B); falta el terminal id real para un cobro aprobado. También quedó arreglado el flag `admin`/`esAdministrativa` (§5, punto 1).

**Decisiones del 12/10** (para no volver a preguntarlas):
- **N2 (orden fiscal):** la Ley 19.210 obliga a cobrar el neto con débito a consumidor final (Decreto 203/014, art. 6), y el número oficial del CFE lo da SISNET recién al enviarlo desde la Bandeja. Con el POS, a consumidor final, el e-Ticket se emite **antes** de mandar el importe a la terminal. Con crédito o con RUT, se cobra y se factura después, como hoy. Se arma en F2. El 22 % de las facturas en pesos llevan RUT (42 % del monto).
- **N2, cómo se consigue el número antes de cobrar (verificado en el SISNET de pruebas, 12/10):** la API de SISNET separa `obtenerCAE(tipoCFE, caja)`, que reserva el número siguiente y devuelve `{numero, serie, numeroAutorizacion, idInterno}`, de `recepcionCFE`, que emite con ese `wsCAE`. Para un número que no se usa existe **`anularNumerador(wsCAE)`**: responde «OK<serie> <número>», y los números anulados no se reusan (se probaron B-276, B-277 y B-278). Flujo decidido para débito a consumidor final:
  1. Reservar el número con `obtenerCAE(101)`.
  2. Mandar al POS con `InvoiceNumber` y `TaxRefund 1`.
  3. Si se aprueba, emitir con ese mismo `wsCAE`. Si se rechaza, se cancela o el cliente se va, `anularNumerador`.

  Así no queda número salteado sin informar. **Falta verificar** que `recepcionCFE` respete un `wsCAE` reservado minutos antes. **Bloqueado por Resonet:** el POS rechazó TaxRefund 1 con PosResponseCode 22, y falta saber qué cobra y qué informa con la rebaja.
- **N4 (cuenta):** no hay método nuevo. El pago va como Débito (3) o Crédito (4), los métodos que ya usa la caja.
- **N5 cuotas: no. N7 propina: no.** Candado B generalizado: `PosTransaccionReferencias` (ORDEN / RETIRO / DOCUMENTO) en vez de `PosTransaccionOrdenes`.
- **Terminal id real: 22224675**, alta local como `CAJA1`, **ACTIVA**. El POS va por RJ45 a la red del local y sale directo a Resonet: no se conecta a la PC ni al sistema. Lo verificado con ella el 12/10:
  - **Sin captura:** a los 240 s → `ResponseCode 11`, como suponía §4.2.
  - **Capturada y sin tarjeta:** el POS la cancela solo a los ~60 s → `0` + `PosResponseCode CT`, Ticket 0, voucher «TRANSACCION FALLIDA». CT y TO → `CANCELADA`.
  - **Aprobada:** $ 1 con Visa Débito real, contactless → `0` + `00`, `Issuer 34`, Ticket 1 / Lote 1. **`CardAccountType` vino "0" en débito**, así que no distingue: débito/crédito sale del voucher («COMPRA DEBITO ONLINE») o del Anexo 4. El voucher dijo «Sin Nro Factura No Aplica Ley», lo que confirma N2.
  - **El Query de venta no trae `State`** (R15). La confirmación de una reversa tiene que salir del lote o de `processQuery`. Sí trae `VoucherPrintInfoXML`, el voucher listo para imprimir (F2), y `montoDevolucionImpuestos`, que no está en la spec.
- **Corrección de la rev. 2.2:** "PLS no valida el PosID" vale solo para 99999999. Con 99999998 y 12345678 la venta vuelve **999 sin TransactionId**, que el sistema trata como INDETERMINADA.
**Reemplaza a:** `docs/poslink-integracion-plan.md` (07/08/2026), que sigue siendo válido como documento de decisiones comerciales pero quedó desactualizado en la parte técnica: lo que ahí figura como "cierre común a construir" ya existe y está en producción (ver §5).

**Convención de este documento.** Cada afirmación va marcada:
- **[SPEC p.N]** — sale del manual POSLink 1.50 de Resonet, con la página.
- **[COD ruta:linea]** — verificado en el código de este repo.
- **[SUPUESTO]** — suposición, no está ni en la spec ni en el código, y puede estar mal.
- **[ABIERTO Rn/Nn]** — no se sabe y hay que preguntarlo (§7).

### Qué cambió en la revisión 2.2 (16/09, noche): primeras llamadas reales

Se llamó al servidor de homologación con las credenciales recibidas, para descubrir cómo se invoca cada método. Todas las llamadas usaron un `PosID` inventado (`99999999`), así que ninguna pudo llegar a un POS ni mover plata. Lo que se verificó, con la respuesta literal del servidor:

| Prueba | Respuesta | Qué significa |
|---|---|---|
| `GET` a la URL base | HTTP 406 | La base no es un endpoint. El servidor responde JSON de errores con formato Spring. |
| `POST .../processFinancialPurchaseQuery` con un `TransactionId` inventado | HTTP 200, `ResponseCode 110` | **La ruta es `{base}/{nombreDelMétodo}` por POST con JSON.** Y las credenciales pasan: con un `SystemId` inválido la spec prevé `112` **[SPEC p.50]** *(inferido del código devuelto; la spec no documenta el orden de validación)*. |
| Venta con `InvoiceNumber: "PRUEBA1"` | `ResponseCode -100` | `InvoiceNumber` alfanumérico es formato inválido. |
| Venta con `InvoiceNumber: "1234567"` | `ResponseCode 0` + `TransactionId` | Numérico se acepta. |
| Venta **sin** `InvoiceNumber` (y `TaxRefund 0`) | `ResponseCode 0` + `TransactionId` | Con `TaxRefund 0` el campo no es obligatorio en la práctica, aunque la tabla lo liste. |
| Venta con la clave `TransactionDateTime` (la de la tabla) | `ResponseCode -100` | **La clave correcta es `TransactionDateTimeyyyyMMddHHmmssSSS`**, la de los ejemplos. La tabla está mal. Resuelve R3. |
| Consulta de esas dos ventas | `ResponseCode 10`, `RemainingExpirationTime` ≈ 195 | **PLS no valida el `PosID` al registrar.** Aceptó dos ventas para una terminal que no existe y las dejó esperando. |
| `cancelFinancialPurchase` de las dos | `ResponseCode 0` | La cancelación de una venta no capturada funciona. |
| Consulta después de cancelar | **`ResponseCode 999`** | **No devuelve un estado limpio de cancelada: devuelve "Error no determinado".** Ver §4.2. |

Tres de estos hallazgos cambian el diseño:

1. **R17 y R3 quedan resueltas.** Ya no frena nada del lado de Resonet para empezar (§7.0).
2. **Un `PosID` mal cargado no da error: falla en silencio.** La venta queda en el buzón hasta que expira y nadie la toma. Se agrega al riesgo 12 y a F1: cada terminal nueva se valida con una venta de prueba antes de habilitarla.
3. **`999` después de cancelar.** La tabla de §4.2 mandaba todo `999` a `INDETERMINADA`, que escala a un humano. Con este comportamiento, cada cancelación normal terminaría en una alerta falsa. Se agrega la regla en §4.2. Se observó en 2 de 2 casos; conviene confirmarlo con Resonet **[ABIERTO R18]**.

Las dos ventas de prueba se cancelaron en el momento. Los `TransactionId` devueltos tienen 16 dígitos, como los ejemplos de la spec y no como los 19 de su tabla (riesgo 13).

### Qué cambió en la revisión 2.1 (16/09, tarde)

Resonet entregó las credenciales de **homologación**. Tres consecuencias:

1. **`ClientAppId` no es un nombre nuestro.** Lo asigna Resonet y la spec lo define como "Identificador de la caja" **[SPEC p.23]**. La revisión 2 lo usaba como etiqueta interna del equipo (`'TOTEM1'`). Se separan: `PteEtiqueta` es nuestro, `PteClientAppId` es de ellos (§3).
2. **Las preguntas abiertas se ordenan por lo que de verdad frenan** (§7.0). Solo tres bloquean el arranque de F1; la mayoría se contesta probando en homologación cuando llegue la terminal.
3. **F0 tiene estado** (§6): falta el terminal id y el equipo físico.

### Qué cambió respecto de la revisión 1 (15/09)

La revisión 1 la criticaron tres revisores independientes, cada uno con un ángulo: completitud, doble cobro, y verificación de supuestos y citas. Coincidieron en que el esqueleto servía pero el núcleo no. Esta revisión corrige, verificado de nuevo contra el PDF y contra el código:

1. **La máquina de estados no conocía el `ResponseCode 111`**, que es justo lo que devuelve PLS al reconsultar una transacción terminada **[SPEC p.7]**. El job de recuperación no habría podido cerrar nunca la fila que existe para cerrar. Se agregan además 110, 113, 11, 999 y la familia de validación 1xx/-100 **[SPEC p.50]**.
2. **El candado por terminal estaba mal en las dos direcciones.** Incluía `REVERSA_PENDIENTE`, que solo drena con la próxima operación en esa misma terminal **[SPEC p.17]** — o sea, se trababa sola para siempre — y excluía `INDETERMINADA`, que es justo cuando puede haber plata debitada, liberando la terminal para que el cliente pague de nuevo.
3. **No había candado por lo que se cobra.** Dos terminales podían cobrar el mismo pedido sin que fallara nada. Se agrega un segundo candado, por orden.
4. **No había estado final de error.** Un error de validación (el más barato y frecuente de una integración nueva) dejaba la terminal bloqueada.
5. **El aprobado parcial registraba el monto pretendido**, no el autorizado.
6. **La detección de "cobrado y no registrado" estaba al final**, después de poner los tótems desatendidos en producción. Se adelanta a F1.
7. **La premisa "PLS nunca nos llama" se bajó de hecho verificado a pregunta.** La spec documenta un campo `Callback` "Ver documento de callback anexo" en los métodos de anulación y devolución **[SPEC p.34, p.37]**, y ese anexo no lo tenemos.
8. **Doce citas corregidas.** Ver §9.

Y una corrección de fondo sobre lo que se dijo al presentar la revisión 1: el reintento por deadlock **no** es un camino de doble cobro que ya exista en el código. Es seguro hoy. Solo se vuelve peligroso si la llamada al POS queda adentro de su alcance, y la regla de §4.5 existe para impedirlo.

---

## 1. Qué se quiere lograr

Hoy la plata de un retiro se cobra a mano en el mostrador, con un POS desintegrado: la cajera tipea el importe en la terminal, espera el voucher y después lo carga en el sistema. El tótem de autogestión no cobra nada — crea el retiro, imprime el ticket y manda al cliente a la caja: si el retiro no está cubierto, nace en estado 1 y cae en la lista de la cajera **[COD backend/services/retiroService.js:387-497 y backend/controllers/ordenesRetiroController.js:392]**. El objetivo es que el sistema le hable directo a las terminales Resonet: que el importe salga del sistema, que el resultado de la tarjeta vuelva al sistema, y que el cobro quede asentado solo (TransaccionesCaja + Pagos + imputación de deuda + asiento contable + CFE) sin retipeo ni conciliación manual. El destino final son **dos tótems de autoservicio con un Lane cada uno, más el POS de la cajera**, con una caja contable propia para los tótems.

La feature no es "hablar con una API". Es manejar bien el hueco entre "el banco ya le debitó al cliente" y "nuestro sistema se enteró". En el flujo de venta, dejamos la venta en un buzón, la terminal la va a buscar, y nos enteramos del resultado poleando cada 2-3 segundos **[SPEC p.6-7, p.29]**. Si en el medio se corta la red, se reinicia el proceso o el cliente se va, la plata puede estar cobrada y nosotros ciegos. **El peor resultado posible de esta feature es cobrarle dos veces a un cliente**, y en un tótem desatendido no hay nadie que lo note. Por eso el núcleo del plan es la §4 y no la §3 ni la §5: el resto es plomería sobre cosas que ya funcionan.

---

## 2. Topología real

```
  Tótem / Pantalla de caja  ──HTTP (nuestra API)──>  Nuestro backend (Node/Express)
                            <──polling nuestro───

  Nuestro backend  ──REST/HTTPS──>  PLS (POSLink Server de Resonet)
                   <───polling────   (en la VENTA preguntamos nosotros; ver la nota del callback)

  PLS  <──ISO8583 sobre socket TLS 1.2──>  Terminal POS / Lane   [SPEC p.6]
  POS  <──ISO8583──>  Adquirente / sello
```

**Quién inicia qué, verificado en la spec:**

1. El SCA (nosotros) registra la venta en PLS con `processFinancialPurchase` y recibe un `TransactionId` **[SPEC p.23-24]**. Esa respuesta **no** es el resultado del cobro: es el acuse de que la venta quedó en el buzón.
2. La terminal consulta a PLS por su cuenta, disparada por un evento del cliente o por la modalidad Poleo automático cada 2 segundos **[SPEC p.7]**. Si no hay nada para ella, vuelve a reposo **[SPEC p.7]**.
3. Nosotros poleamos `processFinancialPurchaseQuery` cada 2-3 segundos hasta el estado final **[SPEC p.7, p.29]**. El veredicto de la tarjeta está en `PosResponseCode` (Anexo 2), no en `ResponseCode` **[SPEC p.30, p.51]**.
4. La transacción se ata a la terminal por el **número de POS asignado a la caja** (`PosID`) **[SPEC p.7, p.23]**.

**Nota sobre el callback — premisa sin cerrar.** La revisión 1 afirmaba que PLS nunca nos llama. No está verificado. La spec define un campo `Callback`, "URL de callback (Ver documento de callback anexo)", en `processFinancialPurchaseVoidByTicket` y `processFinancialPurchaseRefund` **[SPEC p.34, p.37]**, y ese documento no lo tenemos. En la venta (`processFinancialPurchase`) el campo no aparece, así que el poleo de la venta sí está respaldado. Pero si el anexo describe notificaciones también para la venta, el diseño del disparador cambia (el poller se vuelve respaldo, no mecanismo principal). **[ABIERTO R13]**. Todo lo que sigue asume poleo; la máquina de estados de §4 sirve igual para las dos variantes, porque no depende de cómo nos enteramos sino de qué hacemos con lo que nos enteramos.

**Consecuencias de diseño:**

- **El backend es el único que habla con PLS.** El `SystemId` es el identificador único del cliente **[SPEC p.23]**; aunque la spec no dice que sea secreto **[ABIERTO R2]**, se trata como tal y nunca sale al navegador del tótem.
- **Hay dos poleos anidados.** El backend polea a PLS (2-3 s, por spec). El front polea a nuestro backend (~1-2 s). Precedente: `PaymentResult.jsx` poolea `/web-orders/payment-status/:txId` cada 5 s **[COD src/components/pages/PaymentResult.jsx:294-306]** y `PickupView.jsx` cada 4 s **[COD src/client-portal/modulos/PickupView.jsx:350-370]**.
- **La diferencia estructural con MercadoPago**: MP nos llama por webhook **[COD backend/routes/webOrdersRoutes.js:111]**; en la venta de PLS preguntamos nosotros. El molde de MP se reusa **salvo el disparador**. Lo que viene después (claim atómico, `procesarTransaccion`, ticket a Finanzas) se copia — con la salvedad de §4.5 sobre el guard de idempotencia, que en el flujo que se copia no protege lo que parece.
- **Un tótem = un Lane = un `PosID`, sin grupos.** La spec lo dice textual: "En caso de existir pinpads por caja no será necesario usar grupos de terminales" **[SPEC p.24]**. Con grupo, cualquier terminal del grupo podría levantar la venta **[SPEC p.64]**: la del tótem 1 aparecería en el Lane del tótem 2.

**Problema de identidad a resolver antes:** los dos tótems comparten un único `TOTEM_TOKEN` comparado por igualdad exacta **[COD backend/middleware/totemAuth.js:24-29]**, y si la variable está vacía el middleware **deja pasar todo** **[COD backend/middleware/totemAuth.js:26]**. Sin un token por equipo el backend no sabe a qué Lane mandar la venta.

---

## 3. Modelo de datos

Tres tablas nuevas, más una fila de catálogo. Nada de columnas nuevas en `Pagos`: el único texto libre del cobro es `TransaccionesCaja.TcaObservaciones`, NVarChar(500) **[COD backend/services/cajaService.js:938]**.

`PosTransacciones` es deliberadamente un **espejo de `MercadoPagoTransactions`** (uuid propio, intención serializada, estado, marca de pagado), porque eso habilita el claim atómico que ya funciona en MP **[COD backend/services/mercadoPagoService.js:98-113 y backend/controllers/webOrdersController.js:6906-6925]**.

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Terminales dadas de alta (una fila por pinpad)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE dbo.PosTerminales (
    PteIdTerminal     INT IDENTITY(1,1) PRIMARY KEY,
    PteEtiqueta       VARCHAR(50)   NOT NULL,   -- nombre NUESTRO del equipo: 'TOTEM1' | 'TOTEM2' | 'CAJA1'
    PteClientAppId    VARCHAR(100)  NOT NULL,   -- lo asigna RESONET: "Identificador de la caja" [SPEC p.23]
    PtePosID          VARCHAR(10)   NOT NULL,   -- número de POS que asigna Resonet [SPEC p.7, p.23] (el "terminal id")
    PteBranch         VARCHAR(100)  NOT NULL,   -- lo asigna Resonet: "Identificador de la sucursal" [SPEC p.23]
    PteDescripcion    NVARCHAR(200) NULL,
    PteTipo           VARCHAR(20)   NOT NULL,   -- 'TOTEM' | 'CAJA'
    PteEsCajaTotem    BIT           NOT NULL CONSTRAINT DF_Pte_CajaTotem DEFAULT (0),
    PteActivo         BIT           NOT NULL CONSTRAINT DF_Pte_Activo    DEFAULT (1),
    PteTokenHash      VARBINARY(64) NULL,       -- token por equipo (reemplaza TOTEM_TOKEN único)
    PteFechaAlta      DATETIME      NOT NULL CONSTRAINT DF_Pte_Fecha     DEFAULT (GETDATE()),
    CONSTRAINT UQ_PosTerminales_Etiqueta  UNIQUE (PteEtiqueta),
    -- PteClientAppId SIN unique por ahora: Resonet asignó un solo valor y falta
    -- confirmar si cada tótem y la caja llevan el suyo [ABIERTO R16].
    CONSTRAINT UQ_PosTerminales_PosID     UNIQUE (PtePosID)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Una fila por intento de cobro contra una terminal.
--    Se escribe ANTES de hablar con PLS. Es el libro mayor del cobro físico.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE dbo.PosTransacciones (
    PtxId               BIGINT IDENTITY(1,1) PRIMARY KEY,
    PtxUuid             VARCHAR(100)   NOT NULL,
    PtxIdTerminal       INT            NOT NULL,
    PtxPosID            VARCHAR(10)    NOT NULL,   -- desnormalizado: la terminal puede reasignarse
    PtxTipo             VARCHAR(20)    NOT NULL,   -- 'VENTA' | 'ANULACION' | 'DEVOLUCION'
    PtxEstado           VARCHAR(30)    NOT NULL,   -- ver §4.2. NUNCA los códigos de PLS.

    -- Montos: lo que pedimos y lo que la tarjeta realmente autorizó
    PtxMontoCentesimos           BIGINT NOT NULL,  -- lo enviado a PLS [SPEC p.23]
    PtxMontoAutorizadoCentesimos BIGINT NULL,      -- TotalAmount del Query [SPEC p.29]. Puede ser MENOR (aprobado parcial)
    PtxMonedaISO        VARCHAR(5)     NOT NULL,   -- '858' | '840'
    PtxMonedaId         INT            NOT NULL,
    PtxIntencionJson    NVARCHAR(MAX)  NOT NULL,   -- qué cobrar y a quién (equivalente a OrdersJson de MP)
    PtxClienteId        INT            NULL,
    PtxInvoiceNumber    VARCHAR(7)     NULL,       -- [SPEC p.23] — ver §7 N2

    -- Identificadores de PLS
    PtxTransactionId    VARCHAR(30)    NULL,       -- SIEMPRE string, ver notas
    PtxSTransactionId   VARCHAR(30)    NULL,

    -- Resultado
    PtxResponseCode     INT            NULL,       -- Anexo 1 [SPEC p.50]
    PtxPosResponseCode  VARCHAR(10)    NULL,       -- Anexo 2, ALFANUMÉRICO [SPEC p.51-53]
    PtxState            INT            NULL,       -- Anexo 8 [SPEC p.57]: 10 = reversada, 11 = anulada, 12 = devuelta
    PtxAuthorizationCode VARCHAR(20)   NULL,       -- largo 20 desde V150 [SPEC p.21, p.61]
    PtxTicket           VARCHAR(10)    NULL,       -- necesario para anular [SPEC p.34]
    PtxBatch            VARCHAR(10)    NULL,
    PtxAcquirer         VARCHAR(10)    NULL,       -- necesario para anular [SPEC p.34]
    PtxIssuer           VARCHAR(10)    NULL,
    PtxCardNumber       VARCHAR(50)    NULL,       -- ya enmascarado por PLS [SPEC p.30]
    PtxAcquirerTerminal VARCHAR(10)    NULL,       -- va impreso en el voucher [SPEC p.30]
    PtxRemainingExpTime DECIMAL(10,2)  NULL,       -- último valor visto [SPEC p.29]
    PtxRespuestaJson    NVARCHAR(MAX)  NULL,       -- respuesta FILTRADA (sin datos de tarjetahabiente), ver riesgo 12

    -- Enganche con el cobro registrado
    PtxTcaIdTransaccion INT            NULL,
    PtxPagIdPago        INT            NULL,

    -- Reversa
    PtxDrenaReversaDeId BIGINT         NULL,       -- si esta venta existe para drenar una reversa encolada (§4.4 b)

    -- Control de carrera: cada marca se setea UNA sola vez, con UPDATE ... OUTPUT DELETED
    PtxAprobadaAt       DATETIME       NULL,       -- claim del registro
    PtxRegistradaAt     DATETIME       NULL,
    PtxReversaPedidaAt  DATETIME       NULL,       -- claim de la reversa: nadie reversa dos veces
    PtxUltimoPollAt     DATETIME       NULL,
    PtxIntentosPoll     INT            NOT NULL CONSTRAINT DF_Ptx_Intentos DEFAULT (0),
    PtxRequiereRevision BIT            NOT NULL CONSTRAINT DF_Ptx_Revision DEFAULT (0),
    PtxObservaciones    NVARCHAR(1000) NULL,
    PtxCreatedAt        DATETIME       NOT NULL CONSTRAINT DF_Ptx_Created  DEFAULT (GETDATE()),
    PtxUpdatedAt        DATETIME       NULL,
    CONSTRAINT UQ_PosTransacciones_Uuid UNIQUE (PtxUuid),
    CONSTRAINT FK_PosTransacciones_Terminal FOREIGN KEY (PtxIdTerminal)
        REFERENCES dbo.PosTerminales (PteIdTerminal)
);

CREATE INDEX IX_PosTransacciones_Estado   ON dbo.PosTransacciones (PtxEstado, PtxUltimoPollAt);
CREATE INDEX IX_PosTransacciones_Terminal ON dbo.PosTransacciones (PtxIdTerminal, PtxCreatedAt DESC);
CREATE INDEX IX_PosTransacciones_Tca      ON dbo.PosTransacciones (PtxTcaIdTransaccion);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) CANDADO A — por terminal. Una sola operación en curso por Lane.
--    Solo los estados donde la terminal está OCUPADA o su resultado es DESCONOCIDO.
--    REVERSA_PENDIENTE queda AFUERA a propósito: la reversa solo drena con la próxima
--    operación en esa misma terminal [SPEC p.17]. Si la bloqueara, se trabaría para siempre.
--    Ver §4.4 (b) para cómo se maneja.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX UQ_PosTransacciones_TerminalOcupada
    ON dbo.PosTransacciones (PtxIdTerminal)
    WHERE PtxEstado IN ('CREADA','ENVIADA','ESPERANDO_POS','CAPTURADA',
                        'INDETERMINADA','PENDIENTE_BILLETERA');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) CANDADO B — por lo que se cobra. Una orden no puede estar en dos cobros POS vivos.
--    El candado A no alcanza: con dos tótems, una venta trabada en uno no impide que el
--    cliente vaya al otro y pague de nuevo el mismo pedido, sin que nada falle.
--    Un índice filtrado no puede mirar el estado de otra tabla, así que la marca de
--    "activa" se desnormaliza acá y se apaga en la MISMA transacción SQL que cambia
--    el estado de la PosTransaccion a uno que libera (ver §4.2, columna "Candado B").
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE dbo.PosTransaccionOrdenes (
    PtoId        BIGINT IDENTITY(1,1) PRIMARY KEY,
    PtoIdPtx     BIGINT NOT NULL,
    PtoOrdenId   INT    NOT NULL,
    PtoActiva    BIT    NOT NULL CONSTRAINT DF_Pto_Activa DEFAULT (1),
    CONSTRAINT FK_PosTransaccionOrdenes_Ptx FOREIGN KEY (PtoIdPtx)
        REFERENCES dbo.PosTransacciones (PtxId)
);

CREATE UNIQUE INDEX UQ_PosTransaccionOrdenes_OrdenActiva
    ON dbo.PosTransaccionOrdenes (PtoOrdenId)
    WHERE PtoActiva = 1;
```

**Credenciales.** `SystemId`, `Branch`, `ClientAppId` (en homologación, `1` para todos los equipos) y la URL **no van en ninguna tabla ni en el repo**: van en el `.env` (`POSLINK_URL`, `POSLINK_SYSTEM_ID`, `POSLINK_BRANCH`, `POSLINK_CLIENT_APP_ID`), que está en `.gitignore` **[COD .gitignore:27]**. Las del `.env` local son las de homologación. `PosTerminales` guarda solo lo que distingue un equipo de otro (`PosID`, y `ClientAppId` si resulta ser uno por equipo).

**Notas sobre los tipos:**
- `PtxTransactionId` es **VARCHAR**. La tabla de la spec dice que es de 19 dígitos **[SPEC p.24]**, lo que excede `Number.MAX_SAFE_INTEGER` y `JSON.parse` en Node lo corrompería en silencio. Los tres ejemplos de la spec traen en cambio ids de 16 dígitos, que entran. La contradicción tabla-vs-ejemplo está en el riesgo 13; la decisión no cambia: se usa siempre `StransactionId` (string), que la propia spec duplica para esto **[SPEC p.24]**.
- `PtxPosResponseCode` es **VARCHAR**: existen `CE`, `TP`, `NR`, `OF`, `XX` **[SPEC p.51-53]** y `'00'` no es `0`.
- `PtxMontoAutorizadoCentesimos` existe por el **aprobado parcial**: `PosResponseCode 10` es "Aprobado Parcialmente (CashBack)" **[SPEC p.51]** y el importe real viene en `TotalAmount` del Query **[SPEC p.29]**. Se registra **lo autorizado**, nunca lo pedido.

**Catálogo:** una fila nueva en `dbo.MetodosPagos` ("Tarjeta (POS integrado)"), cuyo id viaja en `pagos[].metodoPagoId` y termina en `Pagos.MPaIdMetodoPago` **[COD backend/services/cajaService.js:1011]**. Es el patrón de Handy (id 9) y MercadoPago (id 10) **[COD backend/controllers/webOrdersController.js:6410 y :7124]**.

**Cuenta contable:** el motor manda los pagos a CAJA_UYU/CAJA_USD **[COD backend/services/cajaService.js:1458 y :1492]**, salvo los métodos de cheque, que van a VALORES_DEPOSITAR **[COD backend/services/cajaService.js:1470]**. Si la tarjeta debe ir a "Deudores por tarjeta", es un caso más en esa rama. **[ABIERTO N4]**

---

## 4. La máquina de estados de un cobro

La premisa: **cobrar dos veces es peor que no cobrar**. Todas las reglas están ordenadas por ese criterio.

### 4.1 Los cinco invariantes

**Invariante 1 — La fila existe antes que el cobro.** Nunca se llama a `processFinancialPurchase` sin haber escrito antes la fila en `PosTransacciones` (estado `CREADA`) y sus filas en `PosTransaccionOrdenes`. Si la escritura falla — incluido que el candado B rechace porque una orden ya está en otro cobro —, no se llama a PLS. MercadoPago hace lo contrario: si el INSERT falla solo loguea y devuelve la preferencia igual **[COD backend/services/mercadoPagoService.js:114-116]**. Tolerable con MP (el cliente todavía no pagó), **no** con un pinpad.

**Invariante 2 — Una sola operación en curso por terminal (candado A).** La reversa de PLS deshace *la última* transacción del POS **[SPEC p.39, p.63]**; con dos ventas concurrentes en el mismo Lane, una reversa podría pegarle a la que no era.

**Invariante 3 — Una orden no está en dos cobros vivos (candado B).** Cubre lo que el candado A no ve: dos terminales distintas cobrando lo mismo.

**Invariante 4 — Cobrado y registrado son dos cosas distintas, y solo uno gana.** `PtxAprobadaAt` se setea con `UPDATE ... OUTPUT DELETED.PtxAprobadaAt`, el mecanismo que resuelve la carrera IPN-vs-webhook en MP **[COD backend/controllers/webOrdersController.js:6906-6925]**. Solo el ganador llama a `procesarTransaccion`. Lo mismo para la reversa con `PtxReversaPedidaAt`: el poller en vivo y el job de barrido pueden mirar la misma fila, y dos reversas sobre "la última transacción" podrían deshacer una venta buena posterior.

**Invariante 5 — La intención se revalida en el momento del claim.** `PtxIntencionJson` se escribe antes de hablar con PLS y puede consumirse minutos u horas después (sobre todo desde el job de barrido). En el medio pudo cambiar el mundo: otra caja cobró una orden en efectivo, se canceló una, nació una -F, cambió el costo. El ganador del claim recalcula el importe adeudado de las órdenes **antes** de `procesarTransaccion`. Si ya no coincide con lo autorizado, **no** registra: pasa a `APROBADA_SIN_REGISTRAR` con ticket a Finanzas. Mejor un humano mirando que una imputación mal hecha.

### 4.2 Estados

La columna **Candado B** dice si el estado mantiene bloqueadas las órdenes. Regla general: se liberan solo cuando es seguro que no hay plata debitada (rechazo, cancelación, reversa confirmada, error de validación) o cuando el cobro ya quedó registrado y los guards de dominio del sistema toman la posta.

| Estado nuestro | Cómo se entra | Qué significa para la plata | Candado A | Candado B |
|---|---|---|---|---|
| `CREADA` | INSERT previo a PLS | Nada cobrado. | Sí | Sí |
| `ENVIADA` | `processFinancialPurchase` devolvió `TransactionId` **[SPEC p.24]** | Venta en el buzón. | Sí | Sí |
| `ERROR_VALIDACION` | `processFinancialPurchase` devolvió `ResponseCode` 100-109, 112 o -100, sin `TransactionId` **[SPEC p.50]** | Nada cobrado: la venta nunca existió en PLS. **Final.** Alerta técnica (es un bug nuestro o un dato mal cargado). | No | No |
| `ESPERANDO_POS` | Query devuelve `ResponseCode 10` **[SPEC p.50]** | El POS no capturó. Cancelable por software **[SPEC p.12]**. | Sí | Sí |
| `CAPTURADA` | Query devuelve `ResponseCode 12` **[SPEC p.50]** | **Zona roja.** El POS la tomó; puede haber ido al adquirente. | Sí | Sí |
| `APROBADA` | Query devuelve `ResponseCode 0` **o 111**, con `PosResponseCode` en `{00,08,10,11,85,OF}` **[SPEC p.7, p.50-52]** | Plata cobrada. Falta registrar. Si fue `10`, cobrada **parcialmente**: vale `TotalAmount` **[SPEC p.29, p.51]**. | No | Sí |
| `PEDIR_AUTORIZACION` | `ResponseCode 0/111` con `PosResponseCode` `01` o `02` ("Contacte al emisor... PEDIR AUTORIZACION") **[SPEC p.51]** | Ni aprobada ni rechazada. En el **tótem** se trata como rechazo: no hay quién llame al emisor. En la **caja**, alerta a la cajera para autorizar a mano. | No | Sí (hasta que resuelva la cajera; en tótem pasa directo a RECHAZADA) |
| `RECHAZADA` | `ResponseCode 0/111` con cualquier otro `PosResponseCode`, incluido `XX` (fuera de tabla) **[SPEC p.53]** | Nada cobrado. **Final.** | No | No |
| `CANCELADA` | `cancelFinancialPurchase` confirmada por un Query posterior, tecla roja del POS, `State` 5 (expirada) o 6 (cancelada) **[SPEC p.33, p.57, p.63]** | Nada cobrado. **Final. Prohibido reversar** **[SPEC p.19]**. | No | No |
| `PENDIENTE_BILLETERA` | `PosResponseCode = 'TP'` **[SPEC p.53]** | Ni aprobado ni rechazado. Verificación manual en el POS **[SPEC p.21]**. | Sí | Sí |
| `REVERSA_PENDIENTE` | Se disparó `processFinancialReverse` (ganando el claim) y PLS acusó 0 **[SPEC p.39]** | El 0 es acuse de **encolado**, no de reversión. Puede tardar hasta 24 h **[SPEC p.63]**. | **No** — ver §4.4 (b) | Sí |
| `REVERSADA` | Una consulta devuelve `State = 10` "Transacción reversada" **[SPEC p.57]** | Plata devuelta. **Final.** | No | No |
| `INDETERMINADA` | Timeout total; `ResponseCode 999` **[SPEC p.50]** o `110` teniendo `TransactionId`; `PosResponseCode` del grupo ciego `91`, `96`, `CE`, `ER`, `NC`, `NR` **[SPEC p.52]** | **No sabemos.** Requiere humano. **Nunca** se cobra de nuevo automáticamente. | Sí | Sí |
| `REGISTRADA` | `procesarTransaccion` commiteó | Cerrado. **Final.** Desde acá protegen los guards de dominio (la orden queda paga). | No | No |
| `APROBADA_SIN_REGISTRAR` | Ganó el claim pero `procesarTransaccion` explotó, o falló la revalidación del invariante 5 | Plata cobrada, sistema sin asiento. Ticket a Finanzas. | No | **Sí** — las órdenes no se vuelven a cobrar hasta que un humano cierre el caso |

**Códigos de `ResponseCode` que no son estados, y qué se hace:**

- **`111` — "Transacción finalizada"** **[SPEC p.50]**. La spec dice: "Si se vuelve a consultar por una transacción finalizada luego de haber obtenido responseCode = 0, PLS devolverá responseCode = 111 junto con datos pertinentes a la transacción autorizada" **[SPEC p.7]**. **Para el poller, final = `{0, 111}`, nunca solo `0`.** Es exactamente lo que va a recibir el job de barrido al retomar una fila después de un corte.
- **`110` — "No existe transacción"** **[SPEC p.50]**. Sin `TransactionId` guardado: la venta nunca llegó a PLS → `CANCELADA`. Con `TransactionId`: existió y ya no está (¿expiró?, ¿se purgó?) → `INDETERMINADA`. **[ABIERTO R10]**
- **`999` después de una cancelación que devolvió `0`** — **verificado en homologación el 16/09 (2 de 2 casos):** la consulta de una venta cancelada con éxito devuelve `999` ("Error no determinado"), no un estado de cancelada. Regla: si tenemos registrado un `cancelFinancialPurchase` con `ResponseCode 0` y la consulta siguiente da `999`, la fila pasa a `CANCELADA`. Un `999` **sin** cancelación previa exitosa sigue yendo a `INDETERMINADA`. Si después de cancelar la consulta da `12` o `0`/`111`, perdimos la carrera de §4.4 (a) y manda ese código. **[ABIERTO R18]**
- **`113` — "Se debe consultar por la transacción"** **[SPEC p.50]**. La spec no define cuándo aparece. Se trata como "seguir poleando". **[ABIERTO R14]**
- **`11` — "Tiempo de transacción excedido, envíe datos nuevamente"** **[SPEC p.50]**. Si llega en el Query con la venta sin capturar, se trata como expirada → `CANCELADA`. **"Envíe datos nuevamente" no se obedece de forma automática**: reenviar es abrir una venta nueva (uuid nuevo, fila nueva, candados de nuevo), y solo con el cliente decidiendo. **[SUPUESTO, ABIERTO R14]**
- **`12` con `NeedToReadCard = true`** significa otra cosa ("el usuario pasó la tarjeta") **[SPEC p.18-19]**; y el `10` del Confirm significa "confirmación aceptada" **[SPEC p.11]**. Un `switch` sobre el código pelado, sin saber de qué método vino, es el bug clásico de esta integración.

**Regla dura: los códigos de PLS nunca son nuestro estado.**

### 4.3 Camino feliz (venta simple, `NeedToReadCard = false`)

Flujo **simple**, sin promociones. El flujo con promociones agrega una confirmación obligatoria con una ventana de 180 segundos compartida entre nuestra decisión y el cliente **[SPEC p.19]**, y cambia la regla de reversa. En un tótem no hay quién decida promociones. **[ABIERTO N5]**

1. Front pide cobrar → backend **calcula el importe desde las órdenes**, no desde lo que mandó el front (riesgo 6) → INSERT `CREADA` + filas del candado B, en una sola transacción SQL corta.
2. `processFinancialPurchase` con `PosID` de la terminal, monto en centésimos como string (`1.200,50` → `"120050"` **[SPEC p.23]**), `Quotas = 1` (con 0 el POS pregunta cuotas en pantalla **[SPEC p.23]**), `Currency` 858/840. Timeout HTTP del cliente 10 s **[SUPUESTO]**: ni la spec ni el código actual fijan uno.
3. Si responde error de validación → `ERROR_VALIDACION` (libera candados). Si responde `TransactionId` → guardarlo como string → `ENVIADA`.
4. Bucle de poleo cada 2,5 s **[SPEC p.29]**, persistiendo `PtxRemainingExpTime`, `PtxUltimoPollAt` y `PtxIntentosPoll`.
5. Al llegar `ResponseCode 0` o `111`: claim atómico sobre `PtxAprobadaAt`. El ganador evalúa `PosResponseCode`, toma `TotalAmount`, revalida la intención (invariante 5) y llama a `procesarTransaccion` con **el monto autorizado**.
6. Voucher/ticket **después** del éxito y en `try/catch`: la lección del print bloqueante ya aplicada en el tótem **[COD src/client-portal/modulos/totem/TotemDashboard.jsx:282-296]**.

### 4.4 Cuando se corta la comunicación

Cuatro escenarios, de menos a más peligroso.

**(a) Se corta antes de que el POS capture — `ESPERANDO_POS`.**
No hay plata movida. Se cancela con `cancelFinancialPurchase` **[SPEC p.33]**, válido mientras el POS no haya tomado la transacción **[SPEC p.12]**. La ventana se cierra sola y sin aviso: el POS en Poleo automático puede levantar la venta en cualquier momento **[SPEC p.12]**. Por eso la cancelación **nunca** se da por hecha al mandarla: se vuelve a polear y el estado real lo dicta el Query siguiente — con la salvedad verificada de que, si la cancelación ganó, ese Query devuelve `999` y no un estado limpio (§4.2).

**(b) Se corta con el POS capturado — `CAPTURADA`.**
Puede haber plata debitada. La regla de la spec: **se manda reversa cuando, poleando, se obtiene `ResponseCode 12` junto con `RemainingExpirationTime = 0`** **[SPEC p.18]**, con `NeedToReadCard` en false.

- **El reloj es el de ellos.** `RemainingExpirationTime` lo calcula POSLink y es el valor de referencia **[SPEC p.18, p.29]**. No baja lineal: arranca en 240, se reinicia a 240 cuando el POS captura, y cae a 70 (tarjeta) o 130 (billetera) al ir al adquirente **[SPEC p.18]**. Un cronómetro propio se desincroniza, y reversar por timeout propio **anula ventas buenas**: la spec advierte que la reversa anula transacciones aprobadas y con voucher impreso **[SPEC p.17]**.
- **Reversa automática solo en los tótems.** Es obligatoria en sistemas autogestionados **[SPEC p.17]**. En la caja, la spec permite no reversar si la cajera puede liberar al cliente y registrar a mano **[SPEC p.17]**: ahí, alerta y decisión humana.
- **La reversa pasa por claim** (`PtxReversaPedidaAt`, invariante 4). Sin eso, el poller y el job de barrido pueden disparar dos.
- **La reversa no es inmediata y no confirma nada.** El POS retorna 0 y la deja encolada; viaja al adquirente "en la siguiente oportunidad que la terminal se comunique en forma online con el host adquirente", comunicación que "se establece cuando la terminal realiza una compra, anulación, devolución o cierre" **[SPEC p.17]**. Puede tardar 24 h **[SPEC p.63]**. La UI **nunca** le dice al cliente "operación revertida" al recibir el 0.

**Cómo sale una terminal de `REVERSA_PENDIENTE` sin trabarse.** Esta es la corrección más importante de la revisión 2. La reversa solo drena con otra operación en esa misma terminal, así que bloquear la terminal mientras hay una reversa pendiente la traba para siempre. Por eso `REVERSA_PENDIENTE` **no** está en el candado A. La regla es de servicio:

1. Se permite abrir una venta nueva en esa terminal. Se marca con `PtxDrenaReversaDeId` apuntando a la fila en reversa.
2. Esa venta es la que hace viajar la reversa: la spec dice que "la reversa deberá enviarse antes que la nueva transacción y se deberá esperar respuesta" **[SPEC p.17]**.
3. "En caso de no haber respuesta no se podrá continuar con la operación" **[SPEC p.17]**: si la venta drenadora no avanza, se cancela limpia y el cliente ve un mensaje de terminal no disponible. No se cobra nada.
4. La fila original pasa a `REVERSADA` recién cuando una consulta devuelve `State = 10` **[SPEC p.57]**. En qué método viene `State` exactamente está por confirmar. **[ABIERTO R15]**
5. Escape manual: el cierre de lote también drena **[SPEC p.17]** y se hace desde el POS **[SPEC p.64]**. Queda escrito como procedimiento operativo.

Mientras tanto el candado B sigue puesto: las órdenes de la venta en reversa no se vuelven a cobrar hasta que se confirme.

**(c) Se corta nuestro proceso (pm2 restart, caída del backend, red del local).**
La fila queda abierta sin nadie poleando. Dos redes:

- **Recuperación al inicio de cada venta.** Antes de abrir una venta nueva en una terminal, el service resuelve las filas abiertas de ese `PosID`: las polea hasta un final o, si corresponde, las reversa.
- **Job de barrido cada 1-2 min.** Hoy existen jobs en el repo — `backend/jobs/contabilidadReconciliacionJob.js` y `backend/jobs/cuadreSaldos.job.js` — pero **ninguno** de MercadoPago, Handy ni POS. Se registra en `jobRegistry` y se arranca desde `server.js`, como los demás **[COD backend/server.js, sección de jobs]**. Tres reglas:
  - Reconoce `111` como final (§4.2). Sin eso, no cierra nunca lo que existe para cerrar.
  - **No inventa reversas desde un reloj.** La condición de reversa (`12` + `RemainingExpirationTime 0`) solo se ve poleando en vivo **[SPEC p.18]**; cuando el job retoma una fila minutos después, la transacción ya pasó a otro estado. El job hace lo que diga el Query **de ahora**: si devuelve `12` con 0, reversa; si devuelve `0`/`111`, registra; si devuelve `110` con `TransactionId`, `INDETERMINADA`.
  - Revalida la intención (invariante 5) antes de registrar cualquier cosa.

**(d) Aprobó el POS y falló nuestro registro — `APROBADA_SIN_REGISTRAR`.**
La plata está cobrada y `procesarTransaccion` explotó (por ejemplo, el guard anti-doble-facturación **[COD backend/services/cajaService.js:815-848]**) o falló la revalidación. **No se reversa**: la spec prohíbe reversar cuando se conoce el resultado **[SPEC p.63]**. El camino es el que el sistema ya usa: `crearTicketFinanzas` **[COD backend/controllers/webOrdersController.js:6101]** + `PtxRequiereRevision = 1`, y anulación o nota de crédito con un humano. El candado B **se mantiene**: las órdenes no se vuelven a cobrar mientras el caso esté abierto.

### 4.5 Los vectores de doble cobro

1. **Reintento HTTP de `processFinancialPurchase`.** Si el POST timeoutea sin respuesta, no sabemos si PLS registró la venta. **Nunca reintentar a ciegas**: la spec no documenta idempotencia **[ABIERTO R4]**. La fila va a `INDETERMINADA`, que mantiene los dos candados puestos. Si se liberaran, el cliente apretaría "Pagar" de nuevo y la terminal lo aceptaría. Se resuelve poleando o con un humano.

2. **El reintento por deadlock.** `conReintentoDeadlock` vuelve a ejecutar `procesarTransaccion` entera ante un error 1205 **[COD backend/controllers/cajaController.js:25-38, usado en :114]**. **Hoy es seguro**: el deadlock revierte la transacción completa, así que reintentar no duplica nada en SQL. Se vuelve peligroso **solo** si la llamada al POS quedara dentro de ese alcance, porque ahí un deadlock dispararía un segundo cobro real. Regla estructural: **la llamada a PLS va completamente fuera de cualquier bloque reintentable y fuera de toda transacción SQL.** Además el poleo dura minutos y `procesarTransaccion` toca muchas tablas con `UPDLOCK` sobre `DeudaDocumento` **[COD backend/services/cajaService.js:895 begin, :1932 commit]**: una transacción abierta durante un poleo bloquearía la planta entera.

3. **El cliente reintenta en el tótem.** Lo frena el candado A mientras la venta está en curso o en duda, y el candado B siempre. **El guard de idempotencia de MercadoPago no alcanza acá**, y conviene decirlo con todas las letras porque la revisión 1 lo citaba como protección: ese guard lee `OrdenesRetiro.PagIdPago` **[COD backend/controllers/webOrdersController.js:7062-7089]**, pero en el flujo `pickup-deferred` — el que F3 copia — el retiro lo crea el propio webhook pocas líneas antes **[COD backend/controllers/webOrdersController.js:6992-7005]**, así que el guard siempre lee un retiro recién nacido sin pago. En esa ruta es decorativo. La protección real son los candados y la revalidación. El formato de observación `Cobro POS (Tx: <uuid>)` igual se mantiene, porque alimenta el detector de segundo cobro en los otros caminos.

4. **Dos terminales cobrando el mismo pedido.** El peor caso porque no requiere ninguna falla: la venta del tótem 1 queda en duda, el cliente se va al tótem 2 o al mostrador y paga de nuevo. Lo frena el candado B.

5. **Cobrado y nunca enterado.** Si PLS aprobó y nuestra fila nunca se enteró (se perdió el `TransactionId`, se cayó todo en el peor momento), ningún mecanismo de los anteriores lo ve, porque todos miran nuestra propia tabla. Lo único que lo detecta es comparar contra lo que PLS dice que se cobró. Por eso la conciliación contra el lote abierto (`processCurrentTransactionsBatchQuery` **[SPEC p.45]**) va en F1, no en F5.

---

## 5. Dónde se engancha en el código existente

**El "cierre común agnóstico del medio de pago" que el plan viejo listaba como obra nueva ya existe y está en producción.** Es el webhook de MercadoPago:

- **El cierre común a copiar:** `procesarTransaccion({ usuarioId: 999, header: { clienteId, tipoDocumento: '07', observaciones: 'Cobro ... (Tx: ...)' }, aplicaciones: [{ tipo: 'ORDEN_RETIRO', referenciaId }], pagos: [{ metodoPagoId: 10, monedaId, montoOriginal, cotizacion: 1 }] })` **[COD backend/controllers/webOrdersController.js:7106-7130]**. Gemelo de Handy: **[COD backend/controllers/webOrdersController.js:6388-6415, `metodoPagoId: 9`]**. De ahí salen TransaccionesCaja, Pagos, imputación, asiento, CFE y `marcarCobranzaPagada`.
- **Claim atómico:** **[COD backend/controllers/webOrdersController.js:6906-6925]**.
- **Detector de segundo cobro por `Tx:`:** **[COD backend/controllers/webOrdersController.js:7062-7089]**. Útil, pero ver §4.5 vector 3: no protege el flujo `pickup-deferred`.
- **Ticket a Finanzas:** **[COD backend/controllers/webOrdersController.js:6101]**.
- **Referencia del pago en el retiro:** `OrdenesRetiro.ReferenciaPagoOnline` **[COD backend/controllers/webOrdersController.js:7135-7139]**.
- **Estado para el front:** `GET /api/web-orders/payment-status/:transactionId` **[COD backend/routes/webOrdersRoutes.js:142]**, que hoy busca en Handy y después en MP. Se le agrega la tercera búsqueda. **Ojo:** es un endpoint público; exponer ahí el estado de un cobro POS por uuid tiene que devolver solo lo mínimo.

**Motor de cobro (no tocar):** `procesarTransaccion` **[COD backend/services/cajaService.js:799]**; `begin` en **:895**, `commit` en **:1932**, `rollback` en **:1957**; `INSERT dbo.Pagos` en **:1011**; `TcaObservaciones` NVarChar(500) en **:938**.

**Archivos nuevos:** `backend/services/poslinkService.js` (cliente REST + máquina de estados), `backend/controllers/poslinkController.js`, `backend/routes/poslinkRoutes.js`, `backend/jobs/poslinkBarrido.job.js` (registrado en `jobRegistry` y arrancado desde `server.js`). Modelo de firma: `createPreference` **[COD backend/services/mercadoPagoService.js:24]**.

**Caja de la cajera:** el POST real es **[COD src/components/pages/CajaTransaccionView.jsx:1420]** (`api.post('/contabilidad/caja/transaccion', ...)`). Ahí se intercala el modal de cobro POS antes de postear, con la referencia en `header.observaciones`. `CajaPanelPago.jsx` no es el punto de enganche del POST. Precedente de dato extra en la línea de pago: `idCheque` se valida en **[COD src/components/pages/CajaTransaccionView.jsx:1391-1395]** y llega a `Pagos.PagIdCheque` en **[COD backend/services/cajaService.js:1011]**.

**Tótem:** hoy no hay ruta de cobro. El bloque TÓTEM son 5 rutas, **4 con `totemAuth`**: `totem-lookup`, `totem-lookup-by-client`, `totem-create-pickup` y `totem-announce`. La quinta, `totem-verify`, va **sin** el middleware a propósito, para poder contestar `{ authorized:false }` y mostrar la pantalla de bloqueo **[COD backend/routes/webOrdersRoutes.js:118-134]**. Las rutas nuevas (`/totem-pagar`, `/totem-pago-estado/:uuid`) van con `totemAuth`, **no** bajo `/api/contabilidad`, que entero está detrás de `verifyToken` **[COD backend/routes/contabilidadRoutes.js:9]** y `soloInternoConRol()` **[COD backend/routes/contabilidadRoutes.js:31]**. La función `createPickup` y su fetch a `totem-create-pickup` están en **[COD src/client-portal/modulos/totem/TotemDashboard.jsx:260-268]**; el botón que la dispara, más abajo en el JSX.

**Dos cosas del sistema que hay que arreglar antes:**

1. **El flag de caja administrativa está partido.** `procesarTransaccion` decide si busca sesión de turno mirando `header.admin` **[COD backend/services/cajaService.js:889]**, pero el bit `EsCajaAdmin` lo setea con `header.admin || header.esAdministrativa` **[COD backend/services/cajaService.js:939]**, y solo mapea `admin → esAdministrativa`, nunca al revés **[COD backend/services/cajaService.js:805]**. Los webhooks de Handy y MP mandan solo `esAdministrativa: true`. El comentario que dice lo contrario **[COD backend/controllers/webOrdersController.js:6385]** es falso. **Cuál es el síntoma real no está cerrado:** la revisión 1 decía que la plata del webhook entra en el arqueo de la cajera; uno de los revisores sostiene lo contrario, que no aparece en ninguno de los dos arqueos. Las dos lecturas salen del mismo código y no se verificó cuál es. **[SUPUESTO — verificar contra un cobro real de MP antes de F0.5]**. Cualquiera de las dos es un bug, y cualquiera de las dos la hereda el tótem si copia el payload tal cual.
2. **La "caja contable" es un booleano, no un catálogo.** `EsCajaAdmin` distingue dos buckets; `SesionesTurno` no tiene columna de caja ni de terminal, y `abrirSesion` devuelve 409 si ya hay una sesión ABIERTA en todo el sistema **[COD backend/controllers/cajaController.js:218-231]**. Una tercera caja implica tocar `getResumenSesion`, `getResumenDiario`, `getMovimientosTurno`, `getReporteCentralAdmin` y `reclasificarCajaMovimiento` **[COD backend/controllers/cajaController.js:277, :311, :328, :434, :4294]**, y leer `SP_CerrarSesionCaja` **[COD backend/controllers/cajaController.js:267]**, que vive en la base y no está en el repo.

**Lo que NO hay que usar de molde:** `pagoService.registrarPagoCompleto` está `@deprecated` y sin callers **[COD backend/services/pagoService.js:4-16]**. `pagosController.realizarPago` **[COD backend/controllers/pagosController.js:31]** inserta `Pagos` a mano sin `TransaccionesCaja`. Y `retiroService.registrarPago` escribe solo Pagos/OrdenesRetiro/cobranza, **sin asiento ni CFE**.

---

## 6. Fases

Criterio: **primero donde hay un humano mirando, después donde no lo hay.** Y la detección de errores antes que la automatización que los produce.

**F0 — Alta con Resonet (bloqueante, no es código).**

*Estado al 16/09:* Resonet entregó credenciales de **homologación** — `SystemId`, `Branch` `1`, `ClientAppId` `1` — y la URL `https://poslink.hm.opos.com.uy/itdServer`, que es exactamente la que la spec publica como "URL del Servicio para homologarse" **[SPEC p.22]**. Ya están en el `.env` local. **Falta:** el terminal id (el `PosID`), que mandan cuando creen la terminal, y el equipo físico, que según Resonet llega la semana siguiente al 16/09. **Producción:** URL y credenciales, todavía no.

Lo que F0 necesitaba en su versión original: `SystemId`, credenciales, URL de producción (la spec solo publica la de homologación: `https://poslink.hm.opos.com.uy/itdServer/` **[SPEC p.22]**), versión de firmware de los Lane, una terminal de prueba física, y **el documento de callback anexo** **[SPEC p.34, p.37]**. Los anexos de códigos de respuesta **sí** están completos en el PDF **[SPEC p.50-53]**; lo que falta es que Resonet diga cuáles son reintentables. Hay ejemplos que contradicen sus propias tablas (el Query no incluye `TransactionId` **[SPEC p.31]**; la venta omite `InvoiceNumber`, que es obligatorio **[SPEC p.25]**; el Confirm manda tres campos marcados "No usar" **[SPEC p.27]**; y los ids de ejemplo tienen 16 dígitos cuando la tabla dice 19 **[SPEC p.24]**). **El PDF no es el contrato; el ambiente de test lo es.**

**F0.5 — Deuda previa (paralelizable con F0).** Verificar cuál es el síntoma real del flag `admin`/`esAdministrativa` (§5) y arreglarlo, y decidir el modelo de la Caja Tótem **[ABIERTO N1]**. Va primero porque todo canal nuevo hereda el problema.

**F1 — Esqueleto sin UI, con detección incluida.** Tablas (las tres, con los dos candados), `poslinkService` con `processFinancialPurchase`, `processFinancialPurchaseQuery`, `cancelFinancialPurchase` y `processFinancialReverse`, la máquina de estados completa de §4 con **todos** los códigos de §4.2, el job de barrido, y **la conciliación básica contra el lote abierto** (`processCurrentTransactionsBatchQuery` **[SPEC p.45]**): comparar lo que PLS dice que se cobró contra `PosTransacciones` y alertar cualquier cobro que no tengamos. Cada terminal se da de alta recién después de una venta de prueba que aparezca en su propia pantalla (PLS no valida el `PosID`, §8 riesgo 12). Se valida contra homologación con la terminal de test, **incluido el ensayo explícito de los cortes de §4.4**: desenchufar red, matar el proceso durante la captura, dejar la tarjeta puesta sin responder, apagar la terminal, y forzar un error de validación. Sin esos ensayos la fase no está terminada, aunque el camino feliz funcione.

**F2 — POS de la cajera.** Stack completo con plata real y un humano al lado que puede apretar la tecla roja **[SPEC p.63]** y liberar al cliente. Valida lo que el tótem va a necesitar: método de pago, cuenta contable, `InvoiceNumber`, CFE. Sin reversas automáticas **[SPEC p.17]**. Los `PEDIR_AUTORIZACION` (`01`/`02`) los resuelve la cajera a mano. Riesgo acotado **por el humano, no por el diseño**: el candado B y la revalidación ya tienen que estar funcionando, porque la cajera también puede cobrar un pedido que otro canal ya cobró.

**F3 — Tótem.** La plata sin nadie mirando. Además de lo de F2: token por dispositivo **[COD backend/middleware/totemAuth.js:24-29]**, cada equipo (`PteEtiqueta`) mapeado a su `PosID` y su `ClientAppId`, reversa automática obligatoria **[SPEC p.17]**, bloquear el lector QR durante el cobro **[COD src/client-portal/modulos/totem/TotemDashboard.jsx:187-190]**, y **recalcular el importe en el backend**: el tótem manda un `totalCost` que suma todas las órdenes sin filtrar `isPaid` **[COD src/client-portal/modulos/totem/TotemDashboard.jsx:266]**, aunque el backend sí manda `isPaid` por orden **[COD backend/controllers/webOrdersController.js:4247]**.

- **Auto-logout.** El tótem cierra la sesión a los 2 minutos **[COD src/client-portal/modulos/totem/TotemApp.jsx:10]**. Hay que congelarlo mientras haya un cobro en curso. **No alcanza con 240 segundos**: ese es solo el primer tramo de `RemainingExpirationTime`, que se reinicia a 240 al capturar y después suma 70 o 130 del adquirente **[SPEC p.18]**. El congelamiento dura hasta que la fila llegue a un estado final, no un número fijo.
- **Orden de operaciones: cobrar primero y crear el retiro después**, como `pickup-deferred` **[COD backend/controllers/webOrdersController.js:6992-7005]**. Si se crea el retiro primero y la tarjeta rechaza, queda un retiro huérfano con órdenes asignadas que no vuelven a aparecer en el lookup del tótem (filtro `OReIdOrdenRetiro IS NULL`). El costo de este orden es que **el guard de MP no protege nada** en esta ruta (§4.5 vector 3). Por eso el orden es aceptable **solo** con los candados y la revalidación funcionando desde F1.

**F4 — Anulación y devolución.** `processFinancialPurchaseVoidByTicket` necesita `TicketNumber` y `Acquirer` de la venta original **[SPEC p.34]** y solo vale con el lote abierto; con el lote cerrado va por devolución **[SPEC p.34, p.62]**. El cierre de lote se hace desde el POS, manual **[SPEC p.64]**, así que nunca sabemos de qué lado estamos: intentar anular y caer a devolución. La devolución pide datos de tarjeta si no se ingresaron **[SPEC p.15]**: necesita al cliente con la tarjeta enfrente. Estos dos métodos son los que traen el campo `Callback` **[SPEC p.34, p.37]**: F4 no arranca sin el anexo **[ABIERTO R13]**. `anularTransaccion` **[COD backend/services/cajaService.js:1973]** no revierte el asiento ni las imputaciones y bloquea si el CFE ya fue aceptado por DGI: un void sobre un cobro ya enviado va por Nota de Crédito.

**F5 — Cierre y conciliación completa.** Lo que ya existe desde F1 es la detección sobre el lote abierto. F5 agrega los reportes: `processQuery` por rango de fechas y `processQueryLastNClose` **[SPEC p.40, p.47]**. Con multi-adquirencia hay que pedir **como mínimo los últimos 2 cierres**, porque un adquirente puede tener dos registros de cierre **[SPEC p.47]**.

**Fuera de alcance:** Cashdro (depende de arqueo por caja, que no existe) y MercadoPago presencial (decisión comercial aparte).

---

## 7. Decisiones abiertas

### 7.0 Qué frena y qué no

De todo lo que sigue, casi nada frena el arranque. Ordenado por cuándo hace falta la respuesta:

**Antes de escribir código de F1** — sin esto no conviene arrancar:
- **N2** — el orden fiscal (qué va primero, la factura o el cobro). Es decisión del negocio y cambia la máquina de estados. **Es lo único que queda.** R16 pasó a producción y R17 se resolvió probando (16/09).

**Se contesta probando en homologación**, cuando llegue la terminal:
- **R4** — idempotencia: mandar la misma venta dos veces y mirar qué devuelve. Es la pregunta más importante para el doble cobro. Se prueba, pero **conviene pedirla igual por escrito**: una prueba muestra qué pasa con dos pedidos idénticos, no qué pasa cuando el primero se cortó sin respuesta.
- **R8** (poleo automático), **R9** (firmware, se lee del equipo), **R10** (cuánto vive una transacción), **R14** (códigos 113 y 11), **R15** (en qué respuesta viene `State`).

**Para fases posteriores:**
- **F2**, primera plata real con la cajera: **N4** (cuenta contable), **N5** (promociones), **N6** (dólares), **N7** (propina).
- **F3**, tótem: **N1** (Caja Tótem), **N3** (devolución de impuestos y RUT), **R5** (reintentables), **R6** (reversas encoladas), **R11** (billeteras `TP`), **N9** (Handy en el selector).
- **F4**, anulación y devolución: **R12** (anular sin tarjeta), **R13** (documento de callback), **N8** (anulación integrada o manual).
- **Salida a producción:** **R1** (URL y credenciales de producción), **R2** (autenticación), **R16** (un `ClientAppId` por equipo o uno para todos).

**Para Resonet:**

- **R1.** URL y credenciales de **producción**. Las de homologación ya las tenemos (16/09) y la URL coincide con **[SPEC p.22]**.
- **R2.** Autenticación. La spec no menciona credenciales, API key, certificado ni firma. ¿El `SystemId` autentica o solo identifica?
- ~~**R3.**~~ **Resuelta 16/09 probando:** la clave es `TransactionDateTimeyyyyMMddHHmmssSSS` (la de los ejemplos); con `TransactionDateTime` el servidor devuelve `-100`. Texto original: nombre real del campo de fecha: la tabla dice `TransactionDateTime`, pero los tres ejemplos usan la clave literal `TransactionDateTimeyyyyMMddHHmmssSSS` **[SPEC p.25, p.27, p.31]**. (El valor de los ejemplos sí tiene los 17 dígitos que pide el formato.)
- **R4.** **Idempotencia.** ¿Qué pasa si se repite `processFinancialPurchase` con los mismos datos? ¿Hay clave de deduplicación? ¿`InvoiceNumber` actúa como tal? **La pregunta más importante de la lista.**
- **R5.** **Qué códigos son reintentables.** Los anexos 1 y 2 están completos en el PDF **[SPEC p.50-53]** pero no clasifican: hay que pedirlo por escrito.
- **R6.** ¿Existe algún método para **ver si una terminal tiene reversas encoladas** o forzar su envío? `State = 10` **[SPEC p.57]** confirma una reversa ya hecha, no una en cola.
- **R8.** **Poleo automático en los Lane**: ¿lo soportan, cómo se configura, y la captura es inmediata? Define si los 240 segundos iniciales **[SPEC p.18]** son reales.
- **R9.** Firmware y política de actualización. El `AuthorizationCode` pasó a 20 en V150 **[SPEC p.21, p.61]** y el formato de `AdditionalData` cambia entre <150 y ≥150 **[SPEC p.60]**. (El largo del BIN también cambió **[SPEC p.61]**, pero solo para ventas con promociones, que este plan no usa.)
- **R10.** ¿Cuánto vive una transacción en PLS sin que el POS la tome? ¿Qué devuelve `cancelFinancialPurchase` fuera de ventana? ¿Cuándo devuelve `110` una transacción que sí existió?
- **R11.** `TP` (billeteras): cuánto dura, cómo se resuelve, si puede terminar aprobada, y si la verificación manual deja el resultado disponible para nosotros **[SPEC p.21, p.53]**.
- **R12.** ¿La anulación puede hacerse sin tarjeta presente? **[SPEC p.13, p.15]**
- **R13.** **Nueva.** El **documento de callback anexo** que la spec referencia en anulación y devolución **[SPEC p.34, p.37]**. ¿Aplica también a la venta? Si aplica, cambia el disparador de §2.
- **R14.** **Nueva.** Semántica exacta de `ResponseCode 113` ("Se debe consultar por la transacción") y de `11` ("envíe datos nuevamente") cuando llegan en el Query **[SPEC p.50]**.
- **R15.** **Nueva.** ¿En qué métodos de consulta viene el campo `State` del Anexo 8 **[SPEC p.57]**? Se lo ve en ejemplos de consulta **[SPEC p.46]**; es lo que confirma `REVERSADA`.
- **R16.** **Nueva (2.1).** ¿Cada tótem y la caja llevan su propio `ClientAppId`, o uno solo para todo? Nos asignaron `1`. La spec lo define como "Identificador de la caja" **[SPEC p.23]**. **Decisión del 16/09: en homologación se prueba todo con `1`, y se define para producción.** No frena nada porque el modelo ya soporta las dos variantes: `PteClientAppId` no tiene restricción de unicidad (§3), así que pasar a uno por equipo es cambiar un valor por fila, no el esquema. Lo único a vigilar: si en pruebas se conectan dos terminales a la vez con el mismo `1`, confirmar que PLS las distingue por `PosID` **[SPEC p.7, p.23]**.
- ~~**R17.**~~ **Resuelta 16/09 probando:** `POST {base}/{nombreDelMétodo}` con cuerpo JSON. Verificado con `processFinancialPurchase`, `processFinancialPurchaseQuery` y `cancelFinancialPurchase`.
- **R18.** **Nueva (2.2).** ¿La consulta de una venta cancelada siempre devuelve `999`? Es lo que se observó (2 de 2 casos). Confirmarlo, y preguntar si hay alguna forma de distinguir "cancelada" de un error real.

**Resuelta desde la revisión 1:** ~~R7~~ (`PosID` fijo vs `terminalGroup`). La spec lo contesta: "En caso de existir pinpads por caja no será necesario usar grupos de terminales" **[SPEC p.24]**.

**Para el negocio / el contador:**

- **N1.** **Caja Tótem**: ¿tercera caja contable de verdad (implica tocar todo el arqueo, §5) o los tótems caen en el bucket administrativo con Handy y MP?
- **N2.** **Orden fiscal. La más urgente.** POSLink quiere `InvoiceNumber` (≤7 caracteres) en el request de la venta **[SPEC p.23]**. Hoy el número de documento se genera **dentro** de `procesarTransaccion`, en la misma transacción SQL que inserta el pago **[COD backend/services/cajaService.js:911 y :1584]**, y `TcaIdTransaccion` tampoco existe antes. **Dato verificado 16/09:** con `TaxRefund 0` el servidor acepta la venta **sin** `InvoiceNumber`, y si se manda tiene que ser numérico (`"PRUEBA1"` da `-100`). O sea que el número de factura solo es imprescindible si se aplica la devolución de impuestos. Tres salidas: (a) pre-reservar el correlativo antes del cobro, (b) mandar un identificador propio y renunciar a la devolución de IVA por esa vía, (c) partir `procesarTransaccion` en dos. Cambia la máquina de estados: hay que elegir antes de escribir el service.
- **N3.** `TaxRefund` y `TaxableAmount`: qué ley aplica y cómo se calcula el gravado con el mix IVA 22/10/exento **[SPEC p.65]**. Con RUT, `TaxRefund` es 0 **[SPEC p.65]**: el tótem tiene que saber si la factura lleva RUT **antes** de mandar al pinpad, y hoy no lo pregunta.
- **N4.** Cuenta contable del cobro con tarjeta: ¿Caja o "Deudores por tarjeta"? **[COD backend/services/cajaService.js:1458, :1492]**
- **N5.** ¿Promociones/cuotas? Si sí, flujo `NeedToReadCard = true`, que cambia la regla de reversa entera **[SPEC p.18-19]**. Recomendación: no, al menos en tótems.
- **N6.** ¿Cobro en dólares por POS? Cambiar la moneda entre el alta y el Confirm devuelve `999` y mata la venta **[SPEC p.26]**.
- **N7.** Propina: el POS no la pide por defecto **[SPEC p.57]**. Habilitada, el monto es editable con la tecla amarilla **[SPEC p.57]** y el importe final puede no coincidir con el enviado. Recomendación: no.
- **N8.** ¿La anulación integrada es requisito de arranque o va después, con anulación manual en el POS + Nota de Crédito como puente?
- **N9.** ¿Handy convive? Es el gateway más extendido del sistema. Define qué medios muestra el selector del tótem.

---

## 8. Riesgos, con el peor caso de cada uno

1. **Doble cobro por reintento.** *Peor caso:* un timeout hace que reintentemos `processFinancialPurchase`, PLS tenía la primera, y el cliente paga dos veces. *Mitigación:* invariantes 1-3, cero reintentos ciegos, `INDETERMINADA` mantiene los dos candados. Depende de **R4**.

2. **Doble cobro por dos terminales.** *Peor caso:* la venta del tótem 1 queda en duda y el cliente paga el mismo pedido en el tótem 2 o en el mostrador. No requiere ninguna falla. *Mitigación:* candado B. **Límite:** el candado B solo ve cobros POS. Un cobro en efectivo o por MercadoPago del mismo pedido lo frena la revalidación del invariante 5, no el candado.

3. **Reversa de una venta buena.** *Peor caso:* cronómetro propio en vez de `RemainingExpirationTime`, reversamos una venta aprobada con voucher, y el cliente se va con la mercadería sin el cargo **[SPEC p.17]**. *Mitigación:* reversar **solo** con `12` + `RemainingExpirationTime 0` observado en vivo **[SPEC p.18]**, nunca desde un reloj, y bajo claim.

4. **Tótem trabado por una reversa encolada.** *Peor caso:* una reversa sin drenar deja la terminal sin poder operar **[SPEC p.17]** durante horas **[SPEC p.63]**. *Mitigación:* `REVERSA_PENDIENTE` fuera del candado A, venta drenadora (§4.4 b), procedimiento de cierre de lote manual como escape. Depende de **R6** y **R15**.

5. **Terminal trabada por nuestro propio candado.** *Peor caso:* un estado que no tiene salida definida queda dentro del candado A y el tótem deja de cobrar hasta que alguien edite la tabla. Era lo que pasaba en la revisión 1 con `REVERSA_PENDIENTE` y con los errores de validación. *Mitigación:* todo estado de §4.2 tiene salida definida; los finales liberan el candado A; el job de barrido alerta cualquier fila abierta más de N minutos.

6. **Plata cobrada sin asiento.** *Peor caso:* el POS aprueba, `procesarTransaccion` explota **[COD backend/services/cajaService.js:815-848]**, y el cobro queda sin CFE, sin imputar, fuera de todo arqueo. *Mitigación:* ticket a Finanzas **[COD backend/controllers/webOrdersController.js:6101]** + `PtxRequiereRevision` + candado B mantenido.

7. **Cobrado y nunca enterado.** *Peor caso:* PLS cobró y nuestra tabla no tiene rastro; nada que mire nuestra tabla lo ve. *Mitigación:* conciliación contra el lote abierto desde **F1** (§4.5 vector 5).

8. **Aprobado parcial registrado como total.** *Peor caso:* `PosResponseCode 10` autorizó menos de lo pedido **[SPEC p.51]**, registramos el importe pedido, y la deuda queda saldada con plata que nunca entró. *Mitigación:* se registra `TotalAmount` **[SPEC p.29]**; si es menor, la diferencia queda como deuda y se marca para revisión.

9. **Confundir `ResponseCode` con `PosResponseCode`.** *Peor caso:* leemos `ResponseCode 0` (o el `10` del Confirm, "confirmación aceptada" **[SPEC p.11]**) como aprobación y entregamos sin cobrar. *Mitigación:* el veredicto sale solo de `PosResponseCode`, con la lista completa `{00,08,10,11,85,OF}` **[SPEC p.51-52]**; todo lo desconocido es rechazo, incluido el comodín `XX` **[SPEC p.53]**. Y no confundir los anexos: `999` es un `ResponseCode` **[SPEC p.50]**, no un `PosResponseCode`.

10. **Cobrar de más en el tótem.** *Peor caso:* se cobra el `totalCost` del front, que suma órdenes ya pagas **[COD src/client-portal/modulos/totem/TotemDashboard.jsx:266]**. *Mitigación:* importe calculado siempre en el backend desde las órdenes.

11. **El síntoma del flag de caja administrativa.** *Peor caso:* la plata del tótem desaparece de los arqueos (o cae en el de la cajera; no está verificado cuál, §5) y el cierre no cuadra sin que nadie entienda por qué. *Mitigación:* F0.5 antes de F3.

12. **Venta al Lane equivocado.** *Peor caso:* los dos tótems comparten token **[COD backend/middleware/totemAuth.js:24-29]** y el importe del tótem 1 aparece en el pinpad del tótem 2, donde otro cliente pone su tarjeta. *Mitigación:* token por dispositivo + cada equipo con su `PosID` y su `ClientAppId`, prerrequisito de F3. **Agravante verificado el 16/09:** PLS no valida el `PosID` al registrar la venta — la acepta aunque la terminal no exista y la deja esperando hasta que expira. Un `PosID` mal cargado no da ningún error: el cliente espera frente a un pinpad que nunca muestra el importe. Por eso cada terminal se habilita recién después de una venta de prueba que se vea en su pantalla.

13. **La spec miente en los ejemplos.** *Peor caso:* se tipa el cliente copiando los JSON del PDF y nada funciona contra el servidor real: el Query no trae `TransactionId` **[SPEC p.31]**, la venta omite un obligatorio **[SPEC p.25]**, el Confirm manda campos "No usar" **[SPEC p.27]**, los ids de ejemplo no coinciden con el largo de la tabla **[SPEC p.24]**, y hay respuestas con JSON inválido **[SPEC p.28, p.46]**. *Mitigación:* F0 con ambiente de test es bloqueante.

14. **Datos de tarjeta en el sistema.** *Peor caso:* se persiste la respuesta cruda del Query, con BIN y últimos 4 en claro, nombre del titular, CI y vencimiento **[SPEC p.30]**. *Mitigación:* `PtxRespuestaJson` guarda la respuesta **filtrada**, definida antes de escribir el parser.

15. **`InvoiceNumber` sin margen.** *Peor caso:* el campo admite 7 caracteres **[SPEC p.23]**; si el correlativo crece de dígitos se rompe en silencio. *Mitigación:* validación explícita de largo antes de enviar, con fallo ruidoso (termina en `ERROR_VALIDACION`, no en terminal trabada).

16. **Duplicar el cierre común.** *Peor caso:* un tercer camino de cobro con un tercer guard, y se repite un incidente de doble cobro como los que ya hubo (`docs/reporte-doble-cobro-rollo-retiro.md`). *Mitigación:* reusar `procesarTransaccion`; los candados y la revalidación son lo nuevo, el registro no.

---

## 9. Citas corregidas desde la revisión 1

Verificadas una por una contra el PDF y el código el 16/09.

| Afirmación de la revisión 1 | Lo que dice la fuente |
|---|---|
| "PLS nunca nos llama", como hecho | No verificado: hay campo `Callback` con documento anexo en anulación y devolución **[SPEC p.34, p.37]**. Bajado a R13. |
| `999` dentro del grupo de `PosResponseCode` ciegos **[SPEC p.52]** | `999` es un `ResponseCode` del Anexo 1 **[SPEC p.50]**. |
| El ejemplo de fecha manda 14 dígitos | Manda 17: `20210902113014668` **[SPEC p.25]**, igual en p.27 y p.31. |
| Faltan los anexos 1 y 2 completos | Están completos **[SPEC p.50-53]**. |
| "No existe ningún job de reconciliación en `backend/jobs/`" | Existen `contabilidadReconciliacionJob.js` y `cuadreSaldos.job.js`; ninguno de pagos online. |
| Correlativo generado en `cajaService.js:1654` | Esa línea está dentro de un bloque comentado (recibo RC desactivado). Quedan :911 y :1584. |
| 5 rutas de tótem con `totemAuth` | 5 rutas, 4 con `totemAuth`; `totem-verify` va sin él a propósito **[COD backend/routes/webOrdersRoutes.js:127]**. |
| Cheque en `cajaService.js:1470-1484` sostiene "todo cae en CAJA" | La rama del cheque está en :1470; lo que sostiene la afirmación son :1458 y :1492. |
| `TcaObservaciones` en `cajaService.js:936` | Está en :938. |
| `soloInternoConRol()` en `contabilidadRoutes.js:30` | Está en :31. |
| "El botón que dispara `createPickup` está en `TotemDashboard.jsx:260-268`" | Ahí está la función y su fetch; el botón está más abajo en el JSX. |
| Tecla roja en **[SPEC p.62]** | Está en p.63; p.62 es el enunciado de la pregunta. |
| R7 abierta | La spec la contesta en p.24. |
| El guard `Tx:` protege el flujo del tótem | En `pickup-deferred` lee un retiro recién creado por el mismo webhook; ahí es decorativo (§4.5). |

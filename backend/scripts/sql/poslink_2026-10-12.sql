-- =====================================================================
-- POSLINK (Resonet) — cobro con tarjeta integrado — esquema base (F1)
-- =====================================================================
-- Plan: docs/poslink-implementacion-plan.md (rev. 2.2), §3 y §4.
--
-- Idempotente: se puede correr las veces que haga falta. El backend además
-- lo crea solo la primera vez que se usa (services/poslink/poslinkService.js),
-- así que correr esto es opcional — sirve para adelantarlo en producción.
--
-- Diferencias con el plan:
--   · El candado B no es solo por orden: PosTransaccionReferencias guarda
--     (tipo, id) para que la caja pueda cobrar retiros, órdenes o documentos.
--   · No hay método de pago nuevo: el cobro se registra como Débito (3) o
--     Crédito (4), los mismos que usa hoy la cajera con el POS sin integrar.
--   · Columnas nuevas: PtxFechaPls (la fecha que se le mandó a PLS),
--     PtxCancelOkAt (cancelación acusada con 0: con eso un 999 posterior se
--     lee como cancelada), PtxTaxRefund y PtxTaxAmountCentesimos.
-- =====================================================================

-- ── 1) Terminales (una fila por pinpad) ────────────────────────────────
IF OBJECT_ID('dbo.PosTerminales', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PosTerminales (
        PteIdTerminal   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PosTerminales PRIMARY KEY,
        PteEtiqueta     VARCHAR(50)   NOT NULL,   -- nombre NUESTRO: 'TOTEM1' | 'TOTEM2' | 'CAJA1'
        PteClientAppId  VARCHAR(100)  NOT NULL,   -- lo asigna Resonet: "Identificador de la caja" [SPEC p.23]
        PtePosID        VARCHAR(10)   NOT NULL,   -- el "terminal id" que asigna Resonet [SPEC p.23]
        PteBranch       VARCHAR(100)  NOT NULL,   -- lo asigna Resonet: "Identificador de la sucursal"
        PteDescripcion  NVARCHAR(200) NULL,
        PteTipo         VARCHAR(20)   NOT NULL,   -- 'TOTEM' | 'CAJA'
        PteEsCajaTotem  BIT           NOT NULL CONSTRAINT DF_Pte_CajaTotem DEFAULT (0),
        -- Una terminal nueva queda INACTIVA hasta que una venta de prueba aparezca en su
        -- propia pantalla: un PosID mal cargado no da "pinpad inválido" (queda esperando
        -- o vuelve 999 sin TransactionId, según el número; homologación 12/10/2026).
        PteActivo       BIT           NOT NULL CONSTRAINT DF_Pte_Activo DEFAULT (0),
        PteTokenHash    VARBINARY(64) NULL,       -- token por equipo (F3, reemplaza TOTEM_TOKEN único)
        PteFechaAlta    DATETIME      NOT NULL CONSTRAINT DF_Pte_Fecha DEFAULT (GETDATE()),
        CONSTRAINT UQ_PosTerminales_Etiqueta UNIQUE (PteEtiqueta),
        CONSTRAINT UQ_PosTerminales_PosID    UNIQUE (PtePosID)
    );
END
GO

-- ── 2) Una fila por intento de cobro. Se escribe ANTES de hablar con PLS ──
IF OBJECT_ID('dbo.PosTransacciones', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PosTransacciones (
        PtxId                        BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PosTransacciones PRIMARY KEY,
        PtxUuid                      VARCHAR(100)   NOT NULL,
        PtxIdTerminal                INT            NOT NULL,
        PtxPosID                     VARCHAR(10)    NOT NULL,   -- desnormalizado: la terminal puede reasignarse
        PtxTipo                      VARCHAR(20)    NOT NULL,   -- 'VENTA' (anulación/devolución: F4)
        PtxEstado                    VARCHAR(30)    NOT NULL,   -- §4.2. NUNCA los códigos de PLS.
        PtxMontoCentesimos           BIGINT         NOT NULL,   -- lo enviado a PLS
        PtxMontoAutorizadoCentesimos BIGINT         NULL,       -- TotalAmount del Query: puede ser MENOR
        PtxMonedaISO                 VARCHAR(5)     NOT NULL,   -- '858' | '840'
        PtxMonedaId                  INT            NOT NULL,   -- 1 | 2
        PtxIntencionJson             NVARCHAR(MAX)  NOT NULL,   -- qué cobrar y a quién
        PtxClienteId                 INT            NULL,
        PtxUsuarioId                 INT            NULL,
        PtxFechaPls                  VARCHAR(17)    NULL,       -- yyyyMMddHHmmssSSS enviado en la venta
        PtxInvoiceNumber             VARCHAR(7)     NULL,
        PtxTaxRefund                 INT            NULL,       -- Anexo 3 [SPEC p.53]: 1 = IVA Ley 19.210
        PtxTaxAmountCentesimos       BIGINT         NULL,       -- devolución de impuestos que informó el Query
        PtxTransactionId             VARCHAR(30)    NULL,       -- SIEMPRE string (puede tener 19 dígitos)
        PtxResponseCode              INT            NULL,       -- Anexo 1, último visto
        PtxPosResponseCode           VARCHAR(10)    NULL,       -- Anexo 2, ALFANUMÉRICO
        PtxState                     INT            NULL,       -- Anexo 8
        PtxAuthorizationCode         VARCHAR(20)    NULL,
        PtxTicket                    VARCHAR(50)    NULL,       -- necesario para anular
        PtxBatch                     VARCHAR(10)    NULL,
        PtxAcquirer                  VARCHAR(10)    NULL,       -- necesario para anular
        PtxIssuer                    VARCHAR(10)    NULL,
        PtxCardNumber                VARCHAR(50)    NULL,       -- ya enmascarado por PLS
        PtxCardAccountType           VARCHAR(20)    NULL,       -- Anexo 6: viene solo en débito
        PtxAcquirerTerminal          VARCHAR(10)    NULL,
        PtxRemainingExpTime          DECIMAL(10,2)  NULL,
        PtxRespuestaJson             NVARCHAR(MAX)  NULL,       -- respuesta FILTRADA (sin nombre ni CI)
        PtxTcaIdTransaccion          INT            NULL,
        PtxPagIdPago                 INT            NULL,
        PtxDrenaReversaDeId          BIGINT         NULL,       -- venta que hace viajar una reversa (§4.4 b)
        PtxCancelOkAt                DATETIME       NULL,
        PtxAprobadaAt                DATETIME       NULL,       -- claim del registro (una sola vez)
        PtxRegistradaAt              DATETIME       NULL,
        PtxReversaPedidaAt           DATETIME       NULL,       -- claim de la reversa (una sola vez)
        PtxUltimoPollAt              DATETIME       NULL,
        PtxIntentosPoll              INT            NOT NULL CONSTRAINT DF_Ptx_Intentos DEFAULT (0),
        PtxRequiereRevision          BIT            NOT NULL CONSTRAINT DF_Ptx_Revision DEFAULT (0),
        PtxObservaciones             NVARCHAR(1000) NULL,
        PtxCreatedAt                 DATETIME       NOT NULL CONSTRAINT DF_Ptx_Created DEFAULT (GETDATE()),
        PtxUpdatedAt                 DATETIME       NULL,
        CONSTRAINT UQ_PosTransacciones_Uuid UNIQUE (PtxUuid),
        CONSTRAINT FK_PosTransacciones_Terminal FOREIGN KEY (PtxIdTerminal)
            REFERENCES dbo.PosTerminales (PteIdTerminal)
    );
    CREATE INDEX IX_PosTransacciones_Estado   ON dbo.PosTransacciones (PtxEstado, PtxUltimoPollAt);
    CREATE INDEX IX_PosTransacciones_Terminal ON dbo.PosTransacciones (PtxIdTerminal, PtxCreatedAt DESC);
    CREATE INDEX IX_PosTransacciones_Tca      ON dbo.PosTransacciones (PtxTcaIdTransaccion);
    CREATE INDEX IX_PosTransacciones_TxId     ON dbo.PosTransacciones (PtxTransactionId);

    -- CANDADO A — una sola operación en curso por terminal. Solo los estados con la terminal
    -- OCUPADA o el resultado DESCONOCIDO. REVERSA_PENDIENTE queda afuera a propósito: la reversa
    -- solo drena con la próxima operación en esa terminal [SPEC p.17]; si bloqueara, se trabaría.
    CREATE UNIQUE INDEX UQ_PosTransacciones_TerminalOcupada
        ON dbo.PosTransacciones (PtxIdTerminal)
        WHERE PtxEstado IN ('CREADA','ENVIADA','ESPERANDO_POS','CAPTURADA','INDETERMINADA','PENDIENTE_BILLETERA');
END
GO

-- ── 3) CANDADO B — lo que se cobra no puede estar en dos cobros POS vivos ──
-- La marca PtrActiva se apaga en la MISMA transacción SQL que pasa el cobro a un
-- estado que libera (ver poslinkEstados.LIBERA_REFERENCIAS).
IF OBJECT_ID('dbo.PosTransaccionReferencias', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PosTransaccionReferencias (
        PtrId     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PosTransaccionReferencias PRIMARY KEY,
        PtrIdPtx  BIGINT      NOT NULL,
        PtrTipo   VARCHAR(20) NOT NULL,   -- 'ORDEN' (OrdenesDeposito) | 'RETIRO' (OrdenesRetiro) | 'DOCUMENTO'
        PtrRefId  INT         NOT NULL,
        PtrActiva BIT         NOT NULL CONSTRAINT DF_Ptr_Activa DEFAULT (1),
        CONSTRAINT FK_PosTransaccionReferencias_Ptx FOREIGN KEY (PtrIdPtx)
            REFERENCES dbo.PosTransacciones (PtxId)
    );
    CREATE UNIQUE INDEX UQ_PosTransaccionReferencias_Activa
        ON dbo.PosTransaccionReferencias (PtrTipo, PtrRefId)
        WHERE PtrActiva = 1;
    CREATE INDEX IX_PosTransaccionReferencias_Ptx ON dbo.PosTransaccionReferencias (PtrIdPtx);
END
GO

-- ── 4) Conciliación contra el lote abierto del POS (plan §4.5 vector 5) ──
-- Un cobro aprobado en el POS que el sistema no tiene se avisa UNA vez: esta tabla
-- evita que el barrido repita el ticket cada vez que mira el lote.
IF OBJECT_ID('dbo.PosConciliacionAlertas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PosConciliacionAlertas (
        PcaTransactionId VARCHAR(30)   NOT NULL CONSTRAINT PK_PosConciliacionAlertas PRIMARY KEY,
        PcaPosID         VARCHAR(10)   NOT NULL,
        PcaMotivo        NVARCHAR(400) NOT NULL,
        PcaJson          NVARCHAR(MAX) NULL,
        PcaCreatedAt     DATETIME      NOT NULL CONSTRAINT DF_Pca_Created DEFAULT (GETDATE())
    );
END
GO

-- ── 5) Factura antes de cobrar (Ley 19.210) ─────────────────────────────
-- El número de CFE se reserva en SISNET (obtenerCAE) antes de mandar el importe al POS, que lo
-- informa como factura. Aprobada: la factura se emite con ese número. Rechazada / cancelada: el
-- número se anula en SISNET (anularNumerador).
--   PtxCaeJson        wsCAE reservado (numero, serie, numeroAutorizacion, idInterno, tipoCFE, caja)
--   PtxCaeEstado      RESERVADO | USADO | ANULADO | ERROR_ANULAR
--   PtxDocIdDocumento documento que salió de este cobro
IF COL_LENGTH('dbo.PosTransacciones', 'PtxCaeJson') IS NULL
    ALTER TABLE dbo.PosTransacciones ADD PtxCaeJson NVARCHAR(500) NULL;
GO
IF COL_LENGTH('dbo.PosTransacciones', 'PtxCaeEstado') IS NULL
    ALTER TABLE dbo.PosTransacciones ADD PtxCaeEstado VARCHAR(20) NULL;
GO
IF COL_LENGTH('dbo.PosTransacciones', 'PtxDocIdDocumento') IS NULL
    ALTER TABLE dbo.PosTransacciones ADD PtxDocIdDocumento INT NULL;
GO

-- Medio de pago de la rebaja: el Estado devuelve la diferencia como crédito fiscal (Decreto 203/014,
-- arts. 9 y 10). INACTIVO para que no aparezca en las listas de la caja: solo lo usa el cobro con POS.
-- cajaService lo encuentra por el nombre y lo manda a la cuenta CUENTA_REDUCCION_IVA (1.2.4 por defecto).
IF NOT EXISTS (SELECT 1 FROM dbo.MetodosPagos WHERE MPaDescripcionMetodo = 'Reducción IVA Ley 19.210')
    INSERT INTO dbo.MetodosPagos (MPaIdMetodoPago, MPaDescripcionMetodo, MPaAfectaCaja, MPaTipo, MPaActivo)
    SELECT ISNULL(MAX(MPaIdMetodoPago), 0) + 1, 'Reducción IVA Ley 19.210', 0, 'ENTRADA', 0 FROM dbo.MetodosPagos;
GO

-- ── 6) La terminal tal como era al cobrar ──────────────────────────────
-- Etiqueta y tipo (CAJA/TOTEM) se copian al crear el cobro: si después la terminal se renombra o pasa
-- de caja a tótem, los cobros viejos no cambian de etiqueta ni de reglas (el tótem reversa solo, la
-- caja no). Visto el 12/10/2026 al pasar CAJA1 a TOTEM1 para probar.
IF COL_LENGTH('dbo.PosTransacciones', 'PtxTerminalEtiqueta') IS NULL
    ALTER TABLE dbo.PosTransacciones ADD PtxTerminalEtiqueta VARCHAR(50) NULL;
GO
IF COL_LENGTH('dbo.PosTransacciones', 'PtxTerminalTipo') IS NULL
    ALTER TABLE dbo.PosTransacciones ADD PtxTerminalTipo VARCHAR(20) NULL;
GO
-- Los cobros anteriores a la columna toman la terminal como está hoy (en producción no hay ninguno).
UPDATE p SET PtxTerminalEtiqueta = t.PteEtiqueta, PtxTerminalTipo = t.PteTipo
FROM dbo.PosTransacciones p JOIN dbo.PosTerminales t ON t.PteIdTerminal = p.PtxIdTerminal
WHERE p.PtxTerminalEtiqueta IS NULL;
GO

-- ── 7) Anulaciones y devoluciones (F4) ────────────────────────────────
-- Una anulación o devolución es otra fila de PosTransacciones (PtxTipo 'ANULACION' | 'DEVOLUCION')
-- que apunta a la venta que deshace.
IF COL_LENGTH('dbo.PosTransacciones', 'PtxVentaOrigenId') IS NULL
    ALTER TABLE dbo.PosTransacciones ADD PtxVentaOrigenId BIGINT NULL;
GO

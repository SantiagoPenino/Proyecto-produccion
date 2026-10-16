-- ============================================================================
-- BILLETERA DE CLIENTE - F0: modelo de cuentas multiples
-- ----------------------------------------------------------------------------
-- Que hace (idempotente, se puede correr mas de una vez):
--   1. CuentasCliente gana 3 columnas:
--        CueNombre       NVARCHAR(100) - etiqueta visible ("Fondo rollos DTF")
--        CueEsPrincipal  BIT           - LA cuenta que usan los flujos automaticos
--        CueRestringida  BIT           - solo se usa eligiendola explicitamente
--   2. Backfill: por cada (cliente, DINERO_UYU/DINERO_USD) marca como principal
--      la cuenta activa MAS VIEJA (menor CueIdCuenta) - es la misma que hoy
--      encuentra obtenerOCrearCuenta, asi el comportamiento no cambia.
--   3. Indice unico filtrado: maximo UNA principal activa por cliente+tipo.
--   4. Nueva tabla CuentasClienteArticulosPermitidos (lista blanca de articulos
--      de una cuenta restringida - espejo de PlanesMetrosArticulosPermitidos).
--   5. Registra TRANSFERENCIA_SALIDA / TRANSFERENCIA_ENTRADA en TiposMovimiento.
-- ============================================================================

-- -- PREVIEW: estado antes de tocar nada -------------------------------------
SELECT 'Cuentas DINERO activas' AS Que, COUNT(*) AS N
FROM   dbo.CuentasCliente
WHERE  CueTipo IN ('DINERO_UYU','DINERO_USD') AND CueActiva = 1;

SELECT 'Clientes con >1 cuenta DINERO activa del mismo tipo' AS Que, COUNT(*) AS N
FROM  (SELECT CliIdCliente, CueTipo
       FROM   dbo.CuentasCliente
       WHERE  CueTipo IN ('DINERO_UYU','DINERO_USD') AND CueActiva = 1
       GROUP  BY CliIdCliente, CueTipo
       HAVING COUNT(*) > 1) d;
GO

-- -- 1. Columnas nuevas ------------------------------------------------------
IF COL_LENGTH('dbo.CuentasCliente', 'CueNombre') IS NULL
    ALTER TABLE dbo.CuentasCliente ADD CueNombre NVARCHAR(100) NULL;

IF COL_LENGTH('dbo.CuentasCliente', 'CueEsPrincipal') IS NULL
    ALTER TABLE dbo.CuentasCliente
        ADD CueEsPrincipal BIT NOT NULL CONSTRAINT DF_CuentasCliente_EsPrincipal DEFAULT (0);

IF COL_LENGTH('dbo.CuentasCliente', 'CueRestringida') IS NULL
    ALTER TABLE dbo.CuentasCliente
        ADD CueRestringida BIT NOT NULL CONSTRAINT DF_CuentasCliente_Restringida DEFAULT (0);
GO

-- -- 2. Backfill de la principal (misma cuenta que hoy encuentra el codigo) --
SET XACT_ABORT ON;
BEGIN TRAN;

;WITH candidatas AS (
    SELECT CueIdCuenta,
           ROW_NUMBER() OVER (PARTITION BY CliIdCliente, CueTipo
                              ORDER BY CueIdCuenta ASC) AS rn
    FROM   dbo.CuentasCliente
    WHERE  CueTipo IN ('DINERO_UYU','DINERO_USD')
      AND  CueActiva = 1
)
UPDATE cc
SET    cc.CueEsPrincipal = 1
OUTPUT inserted.CueIdCuenta, inserted.CliIdCliente, inserted.CueTipo
FROM   dbo.CuentasCliente cc
JOIN   candidatas c ON c.CueIdCuenta = cc.CueIdCuenta
WHERE  c.rn = 1
  AND  cc.CueEsPrincipal = 0;

COMMIT;
GO

-- -- 3. Maximo una principal activa por cliente+tipo -------------------------
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'UX_CuentasCliente_PrincipalPorTipo'
                 AND object_id = OBJECT_ID('dbo.CuentasCliente'))
    CREATE UNIQUE INDEX UX_CuentasCliente_PrincipalPorTipo
        ON dbo.CuentasCliente (CliIdCliente, CueTipo)
        WHERE CueEsPrincipal = 1 AND CueActiva = 1;
GO

-- -- 4. Lista blanca de articulos de una cuenta restringida ------------------
IF OBJECT_ID('dbo.CuentasClienteArticulosPermitidos', 'U') IS NULL
    CREATE TABLE dbo.CuentasClienteArticulosPermitidos (
        CueIdCuenta   INT      NOT NULL,
        ProIdProducto INT      NOT NULL,
        FechaAlta     DATETIME NOT NULL CONSTRAINT DF_CueArtPerm_Fecha DEFAULT (GETDATE()),
        CONSTRAINT PK_CuentasClienteArticulosPermitidos PRIMARY KEY (CueIdCuenta, ProIdProducto),
        CONSTRAINT FK_CueArtPerm_Cuenta FOREIGN KEY (CueIdCuenta)
            REFERENCES dbo.CuentasCliente (CueIdCuenta)
    );
GO

-- -- 5. Tipos de movimiento de transferencia interna -------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.TiposMovimiento WHERE TmoId = 'TRANSFERENCIA_SALIDA')
    INSERT INTO dbo.TiposMovimiento
        (TmoId, TmoNombre, TmoDescripcion, TmoPrefijo, TmoSecuencia,
         TmoAfectaSaldo, TmoGeneraDeuda, TmoAplicaRecurso, TmoRequiereDoc,
         TmoActivo, TmoOrden, TmoFechaAlta)
    VALUES
        ('TRANSFERENCIA_SALIDA', 'Transferencia entre cuentas (salida)',
         'Debito por transferencia interna hacia otra cuenta del mismo cliente.',
         '', NULL, -1, 0, 0, 0, 1, 130, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TiposMovimiento WHERE TmoId = 'TRANSFERENCIA_ENTRADA')
    INSERT INTO dbo.TiposMovimiento
        (TmoId, TmoNombre, TmoDescripcion, TmoPrefijo, TmoSecuencia,
         TmoAfectaSaldo, TmoGeneraDeuda, TmoAplicaRecurso, TmoRequiereDoc,
         TmoActivo, TmoOrden, TmoFechaAlta)
    VALUES
        ('TRANSFERENCIA_ENTRADA', 'Transferencia entre cuentas (entrada)',
         'Credito por transferencia interna desde otra cuenta del mismo cliente.',
         '', NULL, 1, 0, 0, 0, 1, 131, GETDATE());
GO

-- -- 5a. Interruptores por cuenta: descuento automatico + acepta negativo ----
--   CueAutoConsumo (nuevo): al entrar una orden, la cuenta paga sola.
--   CuePuedeNegativo (ya existia): si no alcanza, ON = queda en rojo (rollo);
--                                  OFF = consume lo que hay y el resto va a la principal.
--   Backfill: las restringidas ya creadas quedan auto + negativo (conducta acordada).
IF COL_LENGTH('dbo.CuentasCliente', 'CueAutoConsumo') IS NULL
    ALTER TABLE dbo.CuentasCliente
        ADD CueAutoConsumo BIT NOT NULL CONSTRAINT DF_CuentasCliente_AutoConsumo DEFAULT (0);
GO
UPDATE dbo.CuentasCliente
SET    CueAutoConsumo = 1, CuePuedeNegativo = 1
WHERE  CueRestringida = 1 AND CueEsPrincipal = 0
  AND  (CueAutoConsumo = 0 OR CuePuedeNegativo = 0);
GO

-- -- 5b. Consumo automatico desde cuenta restringida ("rollo en plata") ------
IF NOT EXISTS (SELECT 1 FROM dbo.TiposMovimiento WHERE TmoId = 'CONSUMO_CUENTA')
    INSERT INTO dbo.TiposMovimiento
        (TmoId, TmoNombre, TmoDescripcion, TmoPrefijo, TmoSecuencia,
         TmoAfectaSaldo, TmoGeneraDeuda, TmoAplicaRecurso, TmoRequiereDoc,
         TmoActivo, TmoOrden, TmoFechaAlta)
    VALUES
        ('CONSUMO_CUENTA', 'Consumo de orden (cuenta restringida)',
         'Orden descontada automaticamente de una cuenta restringida de dinero, como el rollo descuenta metros.',
         '', NULL, -1, 0, 0, 0, 1, 132, GETDATE());
GO

-- -- 5c. Modalidad FISCAL de la cuenta ---------------------------------------
--   ANTICIPO_A_FACTURAR (default, = principal): se carga con anticipo/recibo; lo que
--     consume se factura DESPUES con "Facturar consumos" (la factura nace paga).
--   PREPAGO_FACTURADO ("recurso plata", calco del rollo): se carga con "Venta de
--     saldo" (factura + pago al cargar); lo que consume NO se vuelve a facturar.
IF COL_LENGTH('dbo.CuentasCliente', 'CueModalidadFiscal') IS NULL
    ALTER TABLE dbo.CuentasCliente
        ADD CueModalidadFiscal VARCHAR(25) NOT NULL
            CONSTRAINT DF_CuentasCliente_ModalidadFiscal DEFAULT ('ANTICIPO_A_FACTURAR');
GO

-- Medio de pago "Saldo de cuenta": con el se marca paga la factura de consumos
-- (no mueve caja: MPaAfectaCaja = 0). Mismo rol que "Rollo por adelantado".
IF NOT EXISTS (SELECT 1 FROM dbo.MetodosPagos WHERE MPaDescripcionMetodo = 'Saldo de cuenta')
    INSERT INTO dbo.MetodosPagos (MPaIdMetodoPago, MPaDescripcionMetodo, MPaAfectaCaja, MPaTipo, MPaActivo)
    SELECT ISNULL(MAX(MPaIdMetodoPago), 0) + 1, 'Saldo de cuenta', 0, 'ENTRADA', 1 FROM dbo.MetodosPagos;

IF NOT EXISTS (SELECT 1 FROM dbo.TiposMovimiento WHERE TmoId = 'CARGA_PREPAGO')
    INSERT INTO dbo.TiposMovimiento
        (TmoId, TmoNombre, TmoDescripcion, TmoPrefijo, TmoSecuencia,
         TmoAfectaSaldo, TmoGeneraDeuda, TmoAplicaRecurso, TmoRequiereDoc,
         TmoActivo, TmoOrden, TmoFechaAlta)
    VALUES
        ('CARGA_PREPAGO', 'Carga de saldo prepago (facturada)',
         'Venta de saldo: entra plata ya facturada a una cuenta prepago; sus consumos no se facturan.',
         '', NULL, 1, 0, 0, 1, 1, 133, GETDATE());
GO

-- -- VERIFICACION FINAL ------------------------------------------------------
SELECT 'Principales marcadas' AS Que, COUNT(*) AS N
FROM   dbo.CuentasCliente WHERE CueEsPrincipal = 1;

SELECT 'Clientes DINERO activos SIN principal (debe ser 0)' AS Que, COUNT(*) AS N
FROM  (SELECT CliIdCliente, CueTipo
       FROM   dbo.CuentasCliente
       WHERE  CueTipo IN ('DINERO_UYU','DINERO_USD') AND CueActiva = 1
       GROUP  BY CliIdCliente, CueTipo
       HAVING SUM(CASE WHEN CueEsPrincipal = 1 THEN 1 ELSE 0 END) = 0) s;
GO

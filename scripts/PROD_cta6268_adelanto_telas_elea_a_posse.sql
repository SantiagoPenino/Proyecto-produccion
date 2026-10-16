-- ============================================================================
-- PROD: mover la cuenta CTA-USD-6268 "Adelanto Telas" de elea a Posse Gutierrez
-- Santiago. Se creó por error en elea; está en 0 y sin movimientos.
--
-- Qué hace: UPDATE de CuentasCliente.CliIdCliente en la fila 6268 (nada más).
-- Los artículos permitidos (CuentasClienteArticulosPermitidos) van por
-- CueIdCuenta, así que viajan solos con la cuenta.
--
-- Guardas: aborta si la cuenta no es de elea, no es "Adelanto Telas", tiene
-- saldo, tiene movimientos, o si Posse no se encuentra por IDCliente/RUT.
-- ============================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Cue    INT = 6268;
DECLARE @Elea   INT = (SELECT CliIdCliente FROM dbo.Clientes WHERE RTRIM(IDCliente) = 'ELEA');
DECLARE @Posse  INT = (SELECT CliIdCliente FROM dbo.Clientes WHERE RTRIM(IDCliente) = '51814799' AND RTRIM(CioRuc) = '150971030017');

-- Referencia (en local: elea = 257, Posse = 28)
SELECT 'elea'  AS quien, @Elea  AS CliIdCliente
UNION ALL
SELECT 'Posse', @Posse;

SELECT 'ANTES' AS etapa, CueIdCuenta, CliIdCliente, CueNombre, CueTipo, CueSaldoActual,
       CueEsPrincipal, CueRestringida, CueAutoConsumo, CuePuedeNegativo, CueModalidadFiscal
FROM   dbo.CuentasCliente WHERE CueIdCuenta = @Cue;

IF @Elea IS NULL OR @Posse IS NULL
BEGIN RAISERROR('No se encontró elea o Posse en Clientes. No se tocó nada.', 16, 1); RETURN; END;

IF NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente
               WHERE CueIdCuenta = @Cue AND CliIdCliente = @Elea
                 AND CueNombre = N'Adelanto Telas' AND CueEsPrincipal = 0
                 AND ISNULL(CueSaldoActual, 0) = 0)
BEGIN RAISERROR('La cuenta 6268 no es la esperada (elea / Adelanto Telas / secundaria / saldo 0). No se tocó nada.', 16, 1); RETURN; END;

IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta   WHERE CueIdCuenta = @Cue)
   OR EXISTS (SELECT 1 FROM dbo.DocumentosContables WHERE CueIdCuenta = @Cue)
   OR EXISTS (SELECT 1 FROM dbo.DeudaDocumento     WHERE CueIdCuenta = @Cue)
   OR EXISTS (SELECT 1 FROM dbo.ImputacionPago     WHERE CueIdCuenta = @Cue)
   OR EXISTS (SELECT 1 FROM dbo.PlanesMetros       WHERE CueIdCuenta = @Cue)
   OR EXISTS (SELECT 1 FROM dbo.CiclosCredito      WHERE CueIdCuenta = @Cue)
BEGIN RAISERROR('La cuenta 6268 tiene movimientos/documentos. No se tocó nada.', 16, 1); RETURN; END;

BEGIN TRAN;

UPDATE dbo.CuentasCliente
SET    CliIdCliente = @Posse
WHERE  CueIdCuenta = @Cue AND CliIdCliente = @Elea;

SELECT 'DESPUES' AS etapa, cc.CueIdCuenta, cc.CliIdCliente, RTRIM(c.Nombre) AS Cliente,
       cc.CueNombre, cc.CueTipo, cc.CueSaldoActual, cc.CueRestringida,
       (SELECT COUNT(*) FROM dbo.CuentasClienteArticulosPermitidos p WHERE p.CueIdCuenta = cc.CueIdCuenta) AS ArtPermitidos
FROM   dbo.CuentasCliente cc
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
WHERE  cc.CueIdCuenta = @Cue;

COMMIT;
PRINT 'OK: cuenta 6268 "Adelanto Telas" pasó de elea a Posse Gutierrez Santiago.';

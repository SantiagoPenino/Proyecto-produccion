/* ============================================================================
   fix_crossmoneda_pc1451.sql
   ----------------------------------------------------------------------------
   Corrige la ÚNICA anomalía real de cross-moneda detectada en Palmero (ver
   diag_crossmoneda_cliente.sql / diag_crossmoneda_todos_clientes.sql).

   EL PROBLEMA (PC-1451, DocIdDocumento 2243, cliente Palmero 998)
     · Documento: $ 12.159,89  (moneda pesos)
     · Orden real: US$ 517,20 (el trabajo, correcto, cotizado en dólares)
     · Pago (MovIdMovimiento 10323): quedó registrado en la cuenta DINERO_USD
       (CueIdCuenta 90) por 12.159,89 — el mismo NÚMERO que el documento en
       pesos, pero anotado como si fueran dólares. El pago real fue en pesos.

   Esto infla artificialmente la cuenta USD del cliente (aparece cobrando
   US$12.159,89 quien en realidad cobró $12.159,89) y dejaba esa plata sin
   aplicar en la cuenta DINERO_UYU (CueIdCuenta 1115), que es donde
   correspondía.

   EL FIX: reclasificar el movimiento 10323 de la cuenta USD a la cuenta UYU
   (mismo importe, 12.159,89 — no hay conversión, solo estaba en la cuenta
   equivocada) y ajustar el CueSaldoActual cacheado de ambas cuentas por el
   mismo delta. NO se toca ningún otro movimiento ni otro cliente — esto es
   puntual a PC-1451. NO se recalcula CueSaldoActual desde cero (hay otro
   desfasaje mayor en la cuenta USD de Palmero sin diagnosticar todavía).

   Este script IDENTIFICA el movimiento por documento + tipo + importe (no por
   ID fijo) y lo imprime en el preview para que se verifique antes de correr
   el UPDATE. Si no encuentra exactamente 1 movimiento con esas señas, no
   ajusta nada (guard).
   ============================================================================ */

SET NOCOUNT ON;
GO

DECLARE @Doc VARCHAR(20) = 'PC-1451';

-- ── 1. PREVIEW — estado actual ────────────────────────────────────────────
SELECT
    Doc = RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero),
    dc.DocIdDocumento, DocMoneda = moDoc.MonSimbolo, DocTotal = CAST(dc.DocTotal AS DECIMAL(18,2))
FROM dbo.DocumentosContables dc
JOIN dbo.Monedas moDoc ON moDoc.MonIdMoneda = dc.MonIdMoneda
WHERE RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero) = @Doc;

SELECT
    m.MovIdMovimiento, m.CueIdCuenta, cc.CueTipo, m.MovTipo, m.MovImporte, m.MovFecha, m.MovConcepto
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = m.DocIdDocumento
WHERE RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero) = @Doc
ORDER BY m.MovIdMovimiento;

SELECT cc.CueIdCuenta, cc.CueTipo, cc.CueSaldoActual AS SaldoActual_ANTES
FROM dbo.CuentasCliente cc
WHERE cc.CliIdCliente = (SELECT TOP 1 dc.CliIdCliente FROM dbo.DocumentosContables dc
                          WHERE RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero) = @Doc)
  AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');
GO

-- ── 2. EL FIX — descomentar tras revisar el preview ─────────────────────────
/*
BEGIN TRANSACTION;

DECLARE @Doc VARCHAR(20) = 'PC-1451';
DECLARE @DocId INT, @CliId INT, @CuentaUYU INT, @CuentaUSD INT, @MovId INT, @Importe DECIMAL(18,2);

SELECT @DocId = dc.DocIdDocumento, @CliId = dc.CliIdCliente
FROM dbo.DocumentosContables dc
WHERE RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero) = @Doc;

SELECT @CuentaUYU = MAX(CASE WHEN CueTipo = 'DINERO_UYU' THEN CueIdCuenta END),
       @CuentaUSD = MAX(CASE WHEN CueTipo = 'DINERO_USD' THEN CueIdCuenta END)
FROM dbo.CuentasCliente WHERE CliIdCliente = @CliId AND CueTipo IN ('DINERO_UYU','DINERO_USD');

-- El pago mal ubicado: único movimiento PAGO/COBRO del documento que cayó en la cuenta USD
SELECT @MovId = m.MovIdMovimiento, @Importe = m.MovImporte
FROM dbo.MovimientosCuenta m
WHERE m.DocIdDocumento = @DocId AND m.MovTipo IN ('PAGO','COBRO')
  AND m.CueIdCuenta = @CuentaUSD AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

IF @MovId IS NULL OR @CuentaUYU IS NULL OR @CuentaUSD IS NULL
BEGIN
    PRINT '[ABORTA] No se encontró exactamente el movimiento/cuentas esperadas. No se tocó nada.';
    ROLLBACK TRANSACTION;
END
ELSE
BEGIN
    UPDATE dbo.MovimientosCuenta
    SET CueIdCuenta = @CuentaUYU,
        MovObservaciones = LEFT(ISNULL(MovObservaciones + ' | ','')
                           + 'Reclasificado de cuenta USD a UYU: pago de ' + @Doc
                           + ' había caído en moneda distinta a la del documento. fix_crossmoneda_pc1451.sql', 500)
    WHERE MovIdMovimiento = @MovId;

    UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual - @Importe WHERE CueIdCuenta = @CuentaUSD;
    UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + @Importe WHERE CueIdCuenta = @CuentaUYU;

    PRINT '[OK] Movimiento ' + CAST(@MovId AS VARCHAR(10)) + ' (' + CAST(@Importe AS VARCHAR(20)) + ') movido de cuenta '
        + CAST(@CuentaUSD AS VARCHAR(10)) + ' (USD) a cuenta ' + CAST(@CuentaUYU AS VARCHAR(10)) + ' (UYU).';

    -- Verificación: estado después
    SELECT cc.CueIdCuenta, cc.CueTipo, cc.CueSaldoActual AS SaldoActual_DESPUES
    FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @CliId AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');

    --   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
END
*/
GO

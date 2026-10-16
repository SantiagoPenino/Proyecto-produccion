/* ============================================================================
   fix_saldo_martina_berriel.sql
   ----------------------------------------------------------------------------
   Cliente: Martina Berriel (CliIdCliente 896). Dos bugs distintos del
   catálogo (`CATALOGO_BUGS_SALDO_CLIENTES.md`), cada uno en un documento:

   PC-1165 (DocId 1815, $8.800 pesos) — BUG 3 ("Pago Factura Manual Edicion"):
   el cargo real en UYU nunca se generó. Solo quedó el cargo viejo en USD
   (MovId 8306, CIERRE_CICLO, -279,90 — el costo de las órdenes ORIGINALES,
   antes de aplicar el precio/ajuste final), mientras el pago (MovId 8307,
   +8.800) sí está bien, en UYU.
   Comparado contra los otros 3 documentos "sanos" de este mismo cliente
   (DocId 3163, 4060, ambos con el patrón correcto: cargo real en la moneda
   del documento + un cargo en 0 en la otra moneda como marca de
   "convertido") — PC-1165 nunca tuvo ese cargo real generado.

   PC-1570 (DocId 2425, $60.319,02 pesos) — BUG 7 (cargo cross-moneda, mismo
   número sin convertir): el cargo (MovId 11355, VTA_CAJA, -60.319,02) quedó
   en la cuenta USD en vez de UYU, con el número exacto de la factura sin
   convertir. Sin pago registrado (factura vencida, sin cobrar). Por este
   mismo motivo, la fila de `DeudaDocumento` (DDeIdDocumento 3984) se generó
   mal: tomó como "importe original" la suma de las 4 líneas `ORDEN` en USD
   ($2.024,40 — el costo interno de las órdenes) en vez del total real de la
   factura ($60.319,02) — el sistema viene rastreando solo el 3,4% de la
   deuda real de este documento.

   FIX:
   1. PC-1165: pone en 0 el cargo viejo en USD (marca "convertido", igual que
      los documentos bien armados) e inserta el cargo real en UYU por
      -DocTotal.
   2. PC-1570: reclasifica el cargo a la cuenta UYU (el número ya es
      correcto, solo estaba en la cuenta que no correspondía) y corrige la
      fila de `DeudaDocumento` (importe original y pendiente = $60.319,02,
      cuenta = UYU).
   3. Recalcula MovSaldoPosterior/CueSaldoActual de ambas cuentas.

   Probado con ROLLBACK contra la réplica local: después del fix, cuenta USD
   queda en -$2.680,50 (= deuda viva real, DocId 816, factura sin cobrar no
   relacionada con este bug) y cuenta UYU en -$81.598,43 (= deuda viva real:
   PC-1570 $60.319,02 + otras facturas ya existentes $21.279,41). Las dos
   cuentas cierran EXACTO contra su deuda viva (diferencia $0,00).
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @Cli INT = 896;
DECLARE @CuentaUYU INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_UYU');
DECLARE @CuentaUSD INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_USD');

-- ── 1. PREVIEW ───────────────────────────────────────────────────────────
SELECT m.MovIdMovimiento, cc.CueTipo, m.MovTipo, m.MovImporte, m.MovAnulado, m.DocIdDocumento
FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE m.DocIdDocumento IN (1815, 2425) ORDER BY m.DocIdDocumento, m.MovFecha;

SELECT * FROM dbo.DeudaDocumento WHERE DDeIdDocumento = 3984;

SELECT cc.CueTipo,
    (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) AS SaldoEnVivo_ANTES,
    (SELECT CAST(ISNULL(SUM(dd.DDeImportePendiente),0) AS DECIMAL(18,2)) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA')) AS DeudaViva
FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');
GO

-- ── 2. EL FIX — descomentar tras confirmar el preview ───────────────────────
/*
BEGIN TRANSACTION;

DECLARE @Cli INT = 896;
DECLARE @CuentaUYU INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_UYU');
DECLARE @CuentaUSD INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_USD');
DECLARE @OK BIT = 1;

IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE MovIdMovimiento=8306 AND DocIdDocumento=1815 AND CueIdCuenta=@CuentaUSD AND MovTipo='CIERRE_CICLO' AND MovImporte=-279.90 AND (MovAnulado IS NULL OR MovAnulado=0))
    SET @OK = 0;
IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE MovIdMovimiento=11355 AND DocIdDocumento=2425 AND CueIdCuenta=@CuentaUSD AND MovTipo='VTA_CAJA' AND MovImporte=-60319.02 AND (MovAnulado IS NULL OR MovAnulado=0))
    SET @OK = 0;
IF NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento WHERE DDeIdDocumento=3984 AND DocIdDocumento=2425 AND DDeImporteOriginal=2024.40 AND DDeImportePendiente=2024.40 AND CueIdCuenta=@CuentaUSD)
    SET @OK = 0;

IF @OK = 0
BEGIN
    PRINT '[ABORTA] El estado ya no coincide con el diagnóstico. No se tocó nada.';
    ROLLBACK TRANSACTION;
END
ELSE
BEGIN
    -- PC-1165: poner en 0 el cargo viejo en USD e insertar el cargo real en UYU
    UPDATE dbo.MovimientosCuenta
    SET MovImporte = 0,
        MovObservaciones = LEFT(ISNULL(MovObservaciones + ' | ','') + 'Puesto en 0: se generó el cargo correcto en UYU. fix_saldo_martina_berriel.sql', 500)
    WHERE MovIdMovimiento = 8306;

    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior, DocIdDocumento, MovFecha, MovUsuarioAlta, MovAnulado, MovObservaciones, CicIdCiclo)
    SELECT @CuentaUYU, 'CIERRE_CICLO', 'Facturado (cargo faltante en la moneda del documento)', -dc.DocTotal, 0, dc.DocIdDocumento,
           '2026-06-25 13:44:32.223', 11, 0,
           'Cargo en UYU que faltaba (BUG 3): el cargo original quedó en USD sin convertir. fix_saldo_martina_berriel.sql', dc.CicIdCiclo
    FROM dbo.DocumentosContables dc WHERE dc.DocIdDocumento = 1815;

    PRINT '[OK] PC-1165: cargo insertado en UYU.';

    -- PC-1570: reclasificar el cargo a UYU
    UPDATE dbo.MovimientosCuenta
    SET CueIdCuenta = @CuentaUYU,
        MovObservaciones = LEFT(ISNULL(MovObservaciones + ' | ','') + 'Reclasificado a la cuenta UYU (moneda del documento PC-1570). fix_saldo_martina_berriel.sql', 500)
    WHERE MovIdMovimiento = 11355;

    PRINT '[OK] PC-1570: cargo reclasificado a UYU.';

    -- PC-1570: corregir la fila de DeudaDocumento (estaba calculada con el importe de las órdenes en USD, no el total real)
    UPDATE dbo.DeudaDocumento
    SET DDeImporteOriginal = 60319.02, DDeImportePendiente = 60319.02, CueIdCuenta = @CuentaUYU
    WHERE DDeIdDocumento = 3984;

    PRINT '[OK] PC-1570: DeudaDocumento corregida.';

    -- Recomputar MovSaldoPosterior
    ;WITH ord AS (
        SELECT mc.MovIdMovimiento,
               SUM(mc.MovImporte) OVER (PARTITION BY mc.CueIdCuenta ORDER BY mc.MovFecha, mc.MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS run
        FROM dbo.MovimientosCuenta mc
        WHERE mc.CueIdCuenta IN (@CuentaUYU, @CuentaUSD) AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
    )
    UPDATE mc SET mc.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta mc JOIN ord ON ord.MovIdMovimiento = mc.MovIdMovimiento;

    -- Recomputar CueSaldoActual
    UPDATE cc SET cc.CueSaldoActual = x.s
    FROM dbo.CuentasCliente cc
    JOIN (SELECT mc.CueIdCuenta, SUM(mc.MovImporte) AS s
          FROM dbo.MovimientosCuenta mc
          WHERE mc.CueIdCuenta IN (@CuentaUYU, @CuentaUSD) AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
          GROUP BY mc.CueIdCuenta) x ON x.CueIdCuenta = cc.CueIdCuenta;

    PRINT '[OK] Saldos recalculados.';

    -- ── 3. VERIFICACIÓN ──────────────────────────────────────────────────
    SELECT cc.CueTipo,
        SaldoEnVivo_DESPUES = (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),
        DeudaViva = (SELECT ISNULL(SUM(dd.DDeImportePendiente),0) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA'))
    FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');

    --   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
END
*/
GO

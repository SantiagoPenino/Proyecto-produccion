/* ============================================================================
   diag_anulados_sin_revertir.sql   —   SOLO LECTURA
   ----------------------------------------------------------------------------
   Busca, para UN cliente, documentos ANULADOS que todavía tienen movimientos
   de plata VIVOS (MovAnulado=0) contando en el saldo — la firma exacta del
   bug "anulados sin revertir" (ver project_ciclo_anticipo_facturacion).

   También busca el caso más sutil: pares de movimientos relacionados (ej.
   PAGO_CRUZADO cruzando UYU/USD) donde UN lado se anuló y el otro no —
   ahí el anulado quedó a medias.
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @Cli INT = 998;  -- Palmero

-- ── 1. Movimientos VIVOS atados a un documento ANULADO ──────────────────────
-- Si esto da filas, es plata que SIGUE contando pese a que el documento que
-- la originó está cancelado.
SELECT
    m.MovIdMovimiento, m.MovFecha, cc.CueTipo, m.MovTipo, m.MovImporte,
    Doc = RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero), dc.DocEstado,
    LEFT(ISNULL(m.MovConcepto,''),60) AS Concepto
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = m.DocIdDocumento
WHERE cc.CliIdCliente = @Cli
  AND dc.DocEstado = 'ANULADO'
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
ORDER BY m.MovFecha;

-- ── 2. Pares PAGO_CRUZADO donde un lado se anuló y el otro no ───────────────
-- Cruza por fecha+segundo (mismo instante, es como se generan los pares) y
-- marca cuando el estado de anulado no coincide entre las dos patas.
;WITH cruzados AS (
    SELECT m.MovIdMovimiento, m.MovFecha, cc.CueTipo, m.MovImporte, m.MovAnulado, m.DocIdDocumento,
           LEFT(ISNULL(m.MovConcepto,''),60) AS Concepto
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE cc.CliIdCliente = @Cli AND m.MovTipo = 'PAGO_CRUZADO'
)
SELECT
    a.MovIdMovimiento AS MovId_UYU, a.MovImporte AS Importe_UYU, a.MovAnulado AS Anulado_UYU,
    b.MovIdMovimiento AS MovId_USD, b.MovImporte AS Importe_USD, b.MovAnulado AS Anulado_USD,
    a.MovFecha, a.Concepto
FROM cruzados a
JOIN cruzados b ON b.CueTipo <> a.CueTipo
    AND ABS(DATEDIFF(SECOND, a.MovFecha, b.MovFecha)) <= 1
WHERE a.CueTipo = 'DINERO_UYU'
  AND a.MovAnulado <> b.MovAnulado  -- ← acá está la inconsistencia
ORDER BY a.MovFecha;

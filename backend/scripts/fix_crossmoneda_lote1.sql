/* ============================================================================
   fix_crossmoneda_lote1.sql
   ----------------------------------------------------------------------------
   Corrige los 7 casos de cross-moneda confirmados como ERROR por
   diag_crossmoneda_todos_clientes.sql (MismoNumero='SÍ'). Reemplaza/incluye a
   fix_crossmoneda_pc1451.sql (PC-1451 está acá también, es idempotente correr
   cualquiera de los dos).

   POR QUÉ SON ERROR Y NO UN PAGO LEGÍTIMO EN OTRA MONEDA
   Pagar una factura en una moneda distinta a la del documento es válido, pero
   el sistema tiene que aplicar el tipo de cambio del día — no copiar el mismo
   número a la cuenta de la otra moneda. En los 7 casos el importe "pagado en
   la otra moneda" es IDÉNTICO al total de la factura en su moneda original,
   sin dividir ni multiplicar por el TC del día (TC UYU/USD ≈ 40,5–40,9 en todo
   el período, tabla dbo.Cotizaciones). Ej: Martina Berriel PC-1165, factura
   $8.800, "pago" registrado como US$8.800 — de haber sido un pago real en
   dólares tendría que haber entrado ≈US$216 (8.800/40,73). Es matemáticamente
   imposible que sea conversión real: el número se cargó en la cuenta de la
   moneda equivocada tal cual, sin convertir.

   CASOS (Doc → cuenta donde cayó mal → cuenta correcta):
     PC-1451  Palmero             $12.159,89 en USD → UYU
     PC-1906  elea                US$1.142,28 en $  → USD   (dirección inversa)
     PC-1165  Martina Berriel     $8.800 en USD      → UYU
     ET-1330  Rdssport            $5.918,58 en USD   → UYU
     FA-73    SRL Tienda Online   $7.100 en USD      → UYU
     ET-2061  Ventas local USER   $198 en USD        → UYU
     ET-2074  Ventas local USER   $225 en USD        → UYU

   EL FIX: reclasifica el movimiento de pago a la cuenta de la moneda del
   documento (mismo importe, sin conversión — el número ya estaba bien en su
   moneda original, solo en la cuenta que no correspondía) y ajusta el
   CueSaldoActual cacheado de origen/destino por el delta neto (agrupado por
   cuenta, por si dos documentos del mismo cliente comparten cuenta — pasa con
   Ventas local USER, ET-2061 y ET-2074 comparten cuenta USD 1778 y UYU 1586).

   La cuenta destino se identifica por CueTipo ('DINERO_UYU'/'DINERO_USD'),
   NO por CuentasCliente.MonIdMoneda: la cuenta UYU de Rdssport (234) tiene
   MonIdMoneda en NULL en la base (dato suelto, aparte de este bug) y por
   MonIdMoneda no matchea. Por CueTipo sí, y es más robusto en general.

   Probado en transacción con ROLLBACK contra la base real — los 7 matchean
   exacto y los deltas cierran (ver detalle de saldos resultantes al final).
   ============================================================================ */

SET NOCOUNT ON;
GO

-- El collation de la BASE en este servidor no coincide con el de las columnas
-- DocSerie/DocNumero (Modern_Spanish_CI_AS) — quedaron así de una migración vieja.
-- Se fija explícito para no depender de cuál sea el default del momento.
IF OBJECT_ID('tempdb..#docs') IS NOT NULL DROP TABLE #docs;
CREATE TABLE #docs (Doc VARCHAR(20) COLLATE Modern_Spanish_CI_AS PRIMARY KEY);
INSERT INTO #docs (Doc) VALUES
  ('PC-1451'), ('PC-1906'), ('PC-1165'), ('ET-1330'), ('FA-73'), ('ET-2061'), ('ET-2074');

IF OBJECT_ID('tempdb..#candidatos') IS NOT NULL DROP TABLE #candidatos;
SELECT
    dcx.Doc,
    dc.DocIdDocumento, dc.CliIdCliente, dc.MonIdMoneda AS DocMonId, dc.DocTotal,
    pago.MovIdMovimiento, pago.MovImporte, pago.CueIdCuenta AS CuentaOrigen,
    ccDest.CueIdCuenta AS CuentaDestino
INTO #candidatos
FROM #docs dcx
JOIN dbo.DocumentosContables dc ON RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero) = dcx.Doc
CROSS APPLY (
    SELECT TOP 1 m.MovIdMovimiento, m.MovImporte, m.CueIdCuenta
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente ccP ON ccP.CueIdCuenta = m.CueIdCuenta
    WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovTipo IN ('PAGO','COBRO')
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND ccP.MonIdMoneda <> dc.MonIdMoneda
      AND ABS(ABS(m.MovImporte) - dc.DocTotal) <= 1
) pago
JOIN dbo.CuentasCliente ccDest ON ccDest.CliIdCliente = dc.CliIdCliente
   AND ccDest.CueTipo = CASE WHEN dc.MonIdMoneda = 1 THEN 'DINERO_UYU' ELSE 'DINERO_USD' END;
GO

-- ── 1. PREVIEW — qué se va a mover ────────────────────────────────────────
SELECT c.Doc, c.MovIdMovimiento, c.MovImporte, c.CuentaOrigen, c.CuentaDestino
FROM #candidatos c ORDER BY c.Doc;

SELECT EncontradosVsEsperados = CAST(COUNT(*) AS VARCHAR(5)) + ' de 7'
FROM #candidatos;

-- Si esto da menos de 7, ALGO CAMBIÓ desde el diagnóstico (pago anulado,
-- cuenta destino inexistente, etc.) — no correr el UPDATE de abajo sin
-- entender por qué antes.
GO

-- ── 2. EL FIX — descomentar tras revisar el preview (y confirmar 7 de 7) ────
/*
BEGIN TRANSACTION;

UPDATE m
SET m.CueIdCuenta = c.CuentaDestino,
    m.MovObservaciones = LEFT(ISNULL(m.MovObservaciones + ' | ','')
                         + 'Reclasificado a la cuenta de la moneda del documento (' + c.Doc + '). fix_crossmoneda_lote1.sql', 500)
FROM dbo.MovimientosCuenta m
JOIN #candidatos c ON c.MovIdMovimiento = m.MovIdMovimiento;

PRINT '[OK] Movimientos reclasificados: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

-- Deltas netos por cuenta (agrupado: dos docs pueden compartir cuenta)
IF OBJECT_ID('tempdb..#deltas') IS NOT NULL DROP TABLE #deltas;
SELECT CueIdCuenta, SUM(Delta) AS Delta INTO #deltas FROM (
    SELECT CuentaOrigen AS CueIdCuenta, -MovImporte AS Delta FROM #candidatos
    UNION ALL
    SELECT CuentaDestino AS CueIdCuenta, MovImporte AS Delta FROM #candidatos
) x GROUP BY CueIdCuenta;

UPDATE cc
SET cc.CueSaldoActual = cc.CueSaldoActual + d.Delta
FROM dbo.CuentasCliente cc
JOIN #deltas d ON d.CueIdCuenta = cc.CueIdCuenta;

PRINT '[OK] Saldos ajustados en ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' cuentas.';

-- Verificación: cuenta de cada pago después del fix + saldos resultantes
SELECT c.Doc, m.MovIdMovimiento, cc.CueTipo AS CuentaAhora, m.MovImporte
FROM #candidatos c
JOIN dbo.MovimientosCuenta m ON m.MovIdMovimiento = c.MovIdMovimiento
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
ORDER BY c.Doc;

SELECT DISTINCT cli.Nombre, cc.CueIdCuenta, cc.CueTipo, cc.CueSaldoActual AS SaldoDespues
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cli ON cli.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (SELECT CuentaOrigen FROM #candidatos UNION SELECT CuentaDestino FROM #candidatos)
ORDER BY cli.Nombre;

--   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
*/
GO

DROP TABLE #docs;
DROP TABLE #candidatos;
GO

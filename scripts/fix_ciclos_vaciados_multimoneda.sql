-- FIX ciclos VACIADOS por la pre-factura multimoneda - 4/9/2026 (idempotente, correr las veces que haga falta)
-- Caso GLIDE SAS: la unica orden en pesos (ciclo UYU #381, $243) se traslado a la cuenta USD y se
-- facturo ahi; el ciclo en pesos quedaba ABIERTO y vacio con el total viejo. El codigo nuevo
-- (emitirFacturaAnticipo) ya los cierra y abre el siguiente; este script repara los que quedaron
-- de antes, con la MISMA logica:
--   candidato = ciclo ABIERTO, con total > 0, SIN ordenes pendientes propias, y con evidencia de
--   traslado desde su cuenta ("[MULTIMONEDA] Trasladado de la cuenta <CueId> (...)").
-- Abrir en SSMS con File -> Open y ejecutar contra SecureAppDB.
SET XACT_ABORT ON;
BEGIN TRAN;

IF OBJECT_ID('tempdb..#cand') IS NOT NULL DROP TABLE #cand;
SELECT c.CicIdCiclo, c.CueIdCuenta, c.CliIdCliente, c.CicTotalOrdenes,
       (SELECT TOP 1 d.DocSerie + '-' + CAST(d.DocNumero AS VARCHAR(20))
        FROM dbo.MovimientosCuenta t
        JOIN dbo.DocumentosContables d ON d.DocIdDocumento = t.DocIdDocumento
        WHERE t.MovObservaciones LIKE '%MULTIMONEDA] Trasladado de la cuenta ' + CAST(c.CueIdCuenta AS VARCHAR(20)) + ' (%'
          AND t.DocIdDocumento IS NOT NULL
        ORDER BY t.MovIdMovimiento DESC) AS DocDestino,
       (SELECT TOP 1 CAST(t.CueIdCuenta AS VARCHAR(20))
        FROM dbo.MovimientosCuenta t
        WHERE t.MovObservaciones LIKE '%MULTIMONEDA] Trasladado de la cuenta ' + CAST(c.CueIdCuenta AS VARCHAR(20)) + ' (%'
        ORDER BY t.MovIdMovimiento DESC) AS CuentaDestino
INTO #cand
FROM dbo.CiclosCredito c
WHERE c.CicEstado = 'ABIERTO'
  AND ISNULL(c.CicTotalOrdenes, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                  WHERE m.CicIdCiclo = c.CicIdCiclo AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
                    AND m.DocIdDocumento IS NULL AND (m.MovAnulado IS NULL OR m.MovAnulado = 0))
  AND EXISTS (SELECT 1 FROM dbo.MovimientosCuenta t
              WHERE t.MovObservaciones LIKE '%MULTIMONEDA] Trasladado de la cuenta ' + CAST(c.CueIdCuenta AS VARCHAR(20)) + ' (%'
                AND t.MovTipo IN ('ORDEN','ORDEN_ANTICIPO'));

SELECT 'CANDIDATOS' AS Paso, * FROM #cand;

-- 1) Cerrar los vaciados (como cerrarCicloCompleto, sin factura propia)
UPDATE c
SET CicEstado = 'CERRADO', CicSaldoFacturar = 0, CicTotalOrdenes = 0,
    CicNumeroFactura = ISNULL(k.DocDestino, c.CicNumeroFactura),
    CicFechaFactura = GETDATE(), CicFechaCierre = GETDATE(),
    CicUsuarioCierre = ISNULL(c.CicUsuarioCierre, 1),
    CicObservaciones = LEFT(LTRIM(ISNULL(c.CicObservaciones, '') + ' Vaciado por pre-factura multimoneda: sus ordenes se facturaron en '
                            + ISNULL(k.DocDestino, 'otro documento') + ' desde la cuenta ' + ISNULL(k.CuentaDestino, '?') + ' (reparado por script 4/9/2026).'), 500)
FROM dbo.CiclosCredito c
JOIN #cand k ON k.CicIdCiclo = c.CicIdCiclo;

-- 2) Abrir el siguiente ciclo de esa cuenta si no quedo ninguno abierto (como abrirCicloPorCuenta)
INSERT INTO dbo.CiclosCredito (CueIdCuenta, CliIdCliente, CicFechaInicio, CicFechaCierre, CicDiasAprobados, CicTotalOrdenes, CicTotalPagos, CicEstado, CicUsuarioApertura)
SELECT k.CueIdCuenta, k.CliIdCliente, GETDATE(), NULL, ISNULL(cc.CueDiasCiclo, 7), 0, 0, 'ABIERTO', 1
FROM #cand k
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = k.CueIdCuenta
WHERE NOT EXISTS (SELECT 1 FROM dbo.CiclosCredito x WHERE x.CueIdCuenta = k.CueIdCuenta AND x.CicEstado = 'ABIERTO');

SELECT 'RESULTADO' AS Paso, c.CicIdCiclo, c.CueIdCuenta, c.CicEstado, c.CicTotalOrdenes, c.CicNumeroFactura, c.CicObservaciones
FROM dbo.CiclosCredito c
WHERE c.CicIdCiclo IN (SELECT CicIdCiclo FROM #cand)
   OR (c.CueIdCuenta IN (SELECT CueIdCuenta FROM #cand) AND c.CicEstado = 'ABIERTO');

COMMIT;

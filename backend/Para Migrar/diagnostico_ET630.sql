-- Diagnóstico ET-630 (Pimpia26)
-- Paso 1: ver header + líneas actuales
SELECT
    dc.DocIdDocumento,
    dc.DocTotal,
    dc.DocSubtotal,
    dc.DocImpuestos,
    SUM(dcd.DcdTotal) OVER (PARTITION BY dcd.DocIdDocumento) AS SumaLineas,
    dcd.DcdIdDetalle,
    dcd.DcdNomItem,
    dcd.DcdCantidad,
    dcd.DcdPrecioUnitario,
    dcd.DcdSubtotal,
    dcd.DcdImpuestos,
    dcd.DcdTotal
FROM dbo.DocumentosContables dc
JOIN dbo.DocumentosContablesDetalle dcd ON dc.DocIdDocumento = dcd.DocIdDocumento
WHERE dc.DocSerie = 'ET' AND dc.DocNumero = '630'
ORDER BY dcd.DcdIdDetalle;

-- Paso 2: ver los movimientos del ciclo de esa factura
-- (para saber qué saldoFacturar usó el sistema al cerrar)
SELECT
    m.MovIdMovimiento,
    m.MovTipo,
    m.MovConcepto,
    m.MovImporte,
    m.DocIdDocumento,
    m.MovAnulado
FROM dbo.DocumentosContables dc
JOIN dbo.MovimientosCuenta m ON m.DocIdDocumento = dc.DocIdDocumento
WHERE dc.DocSerie = 'ET' AND dc.DocNumero = '630'
ORDER BY m.MovIdMovimiento;

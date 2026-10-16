-- ============================================================================
-- VER QUÉ HAY EN "SIN ÁREA / SIN SECTOR ASIGNADO" EN VENTAS (05-10-2026)
-- Solo lectura. Cambiar el rango de fechas abajo. Mismo universo que Ventas por
-- Área: facturas + tickets + Pedidos Caja, no anulados, sin notas.
-- Una línea está "sin área" cuando DcdArea está vacío y tampoco se puede deducir
-- del prefijo del código de orden.
-- ============================================================================
DECLARE @Desde DATE = '2026-09-01', @Hasta DATE = '2026-09-30';

-- 1) Resumen por concepto (lo que más pesa primero)
SELECT CASE WHEN dc.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
       LEFT(LTRIM(RTRIM(dcd.DcdNomItem)), 60) AS Concepto,
       RTRIM(dc.DocTipo) AS TipoDocumento,
       COUNT(*) AS Lineas, COUNT(DISTINCT dc.DocIdDocumento) AS Documentos,
       SUM(dcd.DcdTotal) AS ImporteConIVA
FROM dbo.DocumentosContables dc
JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DocIdDocumento = dc.DocIdDocumento
WHERE dc.DocEstado <> 'ANULADO'
  AND (((dc.DocTipo LIKE '%Factura%' OR dc.DocTipo LIKE '%Ticket%') AND dc.DocTipo NOT LIKE '%Nota%') OR RTRIM(dc.DocTipo) = 'Pedidos Caja')
  AND dc.DocFechaEmision >= @Desde AND dc.DocFechaEmision < DATEADD(DAY, 1, @Hasta)
  AND NULLIF(LTRIM(RTRIM(dcd.DcdArea)), '') IS NULL
GROUP BY dc.MonIdMoneda, LEFT(LTRIM(RTRIM(dcd.DcdNomItem)), 60), RTRIM(dc.DocTipo)
ORDER BY Moneda, ImporteConIVA DESC;

-- 2) Detalle línea por línea (con quién lo emitió y a quién)
SELECT dc.DocIdDocumento, RTRIM(dc.DocTipo) AS Tipo, RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR) AS Nro,
       CONVERT(CHAR(10), dc.DocFechaEmision, 120) AS Fecha,
       CASE WHEN dc.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
       RTRIM(ISNULL(cli.Nombre, dc.DocCliNombre)) AS Cliente,
       dcd.DcdNomItem AS Concepto, dcd.OrdCodigoOrden, dcd.DcdCantidad, dcd.DcdTotal AS ImporteConIVA,
       dc.DocUsuarioAlta AS UsuarioQueEmitio, dc.CfeEstado
FROM dbo.DocumentosContables dc
JOIN dbo.DocumentosContablesDetalle dcd ON dcd.DocIdDocumento = dc.DocIdDocumento
LEFT JOIN dbo.Clientes cli ON cli.CliIdCliente = dc.CliIdCliente
WHERE dc.DocEstado <> 'ANULADO'
  AND (((dc.DocTipo LIKE '%Factura%' OR dc.DocTipo LIKE '%Ticket%') AND dc.DocTipo NOT LIKE '%Nota%') OR RTRIM(dc.DocTipo) = 'Pedidos Caja')
  AND dc.DocFechaEmision >= @Desde AND dc.DocFechaEmision < DATEADD(DAY, 1, @Hasta)
  AND NULLIF(LTRIM(RTRIM(dcd.DcdArea)), '') IS NULL
ORDER BY dcd.DcdTotal DESC;

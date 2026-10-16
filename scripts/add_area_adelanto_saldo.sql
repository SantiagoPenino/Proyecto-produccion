-- ============================================================================
-- ÁREA / SECTOR "ADELANTO DE SALDO" EN LOS REPORTES DE VENTAS (05-10-2026)
-- La plata que el cliente paga por adelantado (carga de saldo de la billetera,
-- beneficios prepagos, "Saldo anticipado" facturado a mano) no es de ningún área
-- productiva y caía en "Sin área" / "Sin sector asignado". Ahora los reportes la
-- muestran como área 'Adelanto de Saldo' (el backend ya la reconoce por el concepto
-- de la línea aunque DcdArea esté vacío). Este script:
--   1) crea el sector comercial "Adelanto de Saldo" y le asigna esa área, para que
--      en la vista por sectores salga con nombre propio y no en "Sin sector asignado";
--   2) estampa DcdArea = 'Adelanto de Saldo' en las líneas ya emitidas (queda
--      guardado en el dato, no solo deducido).
-- Idempotente. Sin el paso 1 el reporte igual funciona por área; el sector es opcional.
-- ============================================================================

-- 1) Sector + mapeo ----------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.Sectores WHERE SecId = 'ADELANTO')
    INSERT INTO dbo.Sectores (SecId, SecNombre, SecOrden, SecActivo) VALUES ('ADELANTO', N'Adelanto de Saldo', 100, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.SectorMapeo WHERE SmaTipo = 'AREA' AND SmaClave = 'Adelanto de Saldo')
    INSERT INTO dbo.SectorMapeo (SmaTipo, SmaClave, SecId, SmaActivo) VALUES ('AREA', 'Adelanto de Saldo', 'ADELANTO', 1);
PRINT 'Sector ADELANTO y mapeo del área listos.';

-- 2) PREVIEW: líneas que se van a estampar -----------------------------------
SELECT dc.DocIdDocumento, RTRIM(dc.DocTipo) AS Tipo, RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR) AS Nro,
       CONVERT(CHAR(10), dc.DocFechaEmision, 120) AS Fecha, CASE WHEN dc.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
       dcd.DcdNomItem, dcd.DcdTotal, dcd.DcdArea
FROM dbo.DocumentosContablesDetalle dcd
JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = dcd.DocIdDocumento
WHERE NULLIF(LTRIM(RTRIM(dcd.DcdArea)), '') IS NULL
  AND (LTRIM(dcd.DcdNomItem) LIKE 'Cr_dito prepago de servicios%' OR UPPER(LTRIM(RTRIM(dcd.DcdNomItem))) = 'SALDO ANTICIPADO')
ORDER BY dc.DocFechaEmision;

-- 3) Estampar ----------------------------------------------------------------
UPDATE dcd
SET    dcd.DcdArea = 'Adelanto de Saldo'
FROM   dbo.DocumentosContablesDetalle dcd
WHERE  NULLIF(LTRIM(RTRIM(dcd.DcdArea)), '') IS NULL
  AND (LTRIM(dcd.DcdNomItem) LIKE 'Cr_dito prepago de servicios%' OR UPPER(LTRIM(RTRIM(dcd.DcdNomItem))) = 'SALDO ANTICIPADO');
PRINT CONCAT('Líneas estampadas como Adelanto de Saldo: ', @@ROWCOUNT);

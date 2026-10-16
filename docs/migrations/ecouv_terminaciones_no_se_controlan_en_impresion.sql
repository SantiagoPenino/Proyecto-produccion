-- =====================================================================
-- ECOUV — Las terminaciones no se controlan en el área de IMPRESIÓN (30/07/2026)
--
-- Cada terminación genera una línea en ServiciosExtraOrden para poder
-- facturarla. El control de impresión lista los servicios como ítems a
-- contar, así que esas líneas aparecían en la pantalla de Control de
-- ECOUV con su propio contador (0/4, 0/1) y sumaban al progreso de la
-- orden: el operario de impresión tenía que "controlar" ojales que ni
-- siquiera están hechos todavía.
--
-- En impresión solo se controla el ARCHIVO. El trabajo de terminación se
-- controla en su área (checklist de OrdenTerminaciones). La línea queda
-- cerrada de entrada: existe únicamente para el cobro.
--
-- Código: webOrdersController / prendasOrdersController las insertan ya
-- en 'OK', y productionFileController las excluye del listado de control.
--
-- Idempotente.
-- =====================================================================

-- Antes
SELECT COUNT(*) AS TerminacionesPendientesEnControl
FROM ServiciosExtraOrden
WHERE ISNULL(Observacion, '') LIKE N'%rminaci%por archivo%'
  AND ISNULL(Estado, '') <> 'OK';
GO

UPDATE ServiciosExtraOrden
SET Estado = 'OK',
    Controlcopias = Cantidad
WHERE ISNULL(Observacion, '') LIKE N'%rminaci%por archivo%'
  AND ISNULL(Estado, '') <> 'OK';

PRINT CONCAT('Lineas de terminacion cerradas (no se controlan en impresion): ', @@ROWCOUNT);
GO

-- Verificación
SELECT S.ServicioID, S.OrdenID, LTRIM(RTRIM(O.CodigoOrden)) AS Orden,
       S.Descripcion, S.Cantidad, S.Estado, S.Controlcopias
FROM ServiciosExtraOrden S
LEFT JOIN Ordenes O ON O.OrdenID = S.OrdenID
WHERE ISNULL(S.Observacion, '') LIKE N'%rminaci%por archivo%'
ORDER BY S.ServicioID DESC;
GO

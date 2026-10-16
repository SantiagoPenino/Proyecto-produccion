-- revision-planes-mixtos-dtf-uv.sql
-- Revisa todos los planes activos de DTF o UV y verifica que tengan
-- los 3 productos en articulosPermitidos (plan mixto completo).
--
--   247  DTF textil COMUN
--   255  DTF para rigidos UV (57cm)
--   479  UV (PARA RIGIDOS 0,27)
--
-- @APPLY = 0 -> solo muestra el diagnostico, no escribe nada (default)
-- @APPLY = 1 -> agrega los productos faltantes

SET NOCOUNT ON;
DECLARE @APPLY BIT = 0;

DECLARE @ProId247 INT = 247;
DECLARE @ProId255 INT = 255;
DECLARE @ProId479 INT = 479;

-- Verificar que existan en la base
IF NOT EXISTS (SELECT 1 FROM dbo.Articulos WHERE ProIdProducto = @ProId247)
    BEGIN PRINT 'ERROR: ProId 247 (DTF textil COMUN) no encontrado.'; RETURN; END;
IF NOT EXISTS (SELECT 1 FROM dbo.Articulos WHERE ProIdProducto = @ProId255)
    BEGIN PRINT 'ERROR: ProId 255 (DTF UV 57cm) no encontrado.'; RETURN; END;
IF NOT EXISTS (SELECT 1 FROM dbo.Articulos WHERE ProIdProducto = @ProId479)
    BEGIN PRINT 'ERROR: ProId 479 (UV RIGIDOS 0,27) no encontrado.'; RETURN; END;

-- Diagnostico
PRINT '=== PLANES DTF/UV ACTIVOS ===';
PRINT '';

SELECT
    pm.PlaIdPlan,
    c.Nombre                                                            AS Cliente,
    art.Descripcion                                                     AS ProductoPrincipal,
    pm.PlaCantidadTotal,
    pm.PlaCantidadUsada,
    pm.PlaCantidadTotal - pm.PlaCantidadUsada                          AS Disponible,
    CASE WHEN EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos
                      WHERE PlaIdPlan = pm.PlaIdPlan AND ProIdProducto = @ProId247)
         THEN 'SI' ELSE 'NO' END                                       AS [DTF-247],
    CASE WHEN EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos
                      WHERE PlaIdPlan = pm.PlaIdPlan AND ProIdProducto = @ProId255)
         THEN 'SI' ELSE 'NO' END                                       AS [UV-255],
    CASE WHEN EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos
                      WHERE PlaIdPlan = pm.PlaIdPlan AND ProIdProducto = @ProId479)
         THEN 'SI' ELSE 'NO' END                                       AS [UV-479],
    CASE
        WHEN EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = pm.PlaIdPlan AND ProIdProducto = @ProId247)
         AND EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = pm.PlaIdPlan AND ProIdProducto = @ProId255)
         AND EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = pm.PlaIdPlan AND ProIdProducto = @ProId479)
        THEN 'OK - MIXTO COMPLETO'
        ELSE 'FALTA CONFIGURAR'
    END                                                                 AS Estado
FROM dbo.PlanesMetros pm
JOIN dbo.Clientes  c   ON c.CliIdCliente    = pm.CliIdCliente
JOIN dbo.Articulos art ON art.ProIdProducto = pm.ProIdProducto
WHERE pm.PlaActivo = 1
  AND pm.ProIdProducto IN (@ProId247, @ProId255, @ProId479)
ORDER BY Estado DESC, c.Nombre;

IF @APPLY = 0
BEGIN
    PRINT '';
    PRINT '*** DRY-RUN: cambia @APPLY = 1 para corregir los que faltan.';
    RETURN;
END;

-- Aplicar: agregar los 3 productos a cada plan que los necesite
PRINT '';
PRINT '=== APLICANDO CORRECCIONES ===';

DECLARE @PlaIdPlan INT;
DECLARE @NombreCli VARCHAR(200);

DECLARE cur CURSOR FAST_FORWARD FOR
    SELECT pm.PlaIdPlan, c.Nombre
    FROM dbo.PlanesMetros pm
    JOIN dbo.Clientes c ON c.CliIdCliente = pm.CliIdCliente
    WHERE pm.PlaActivo = 1
      AND pm.ProIdProducto IN (@ProId247, @ProId255, @ProId479)
    ORDER BY c.Nombre;

OPEN cur;
FETCH NEXT FROM cur INTO @PlaIdPlan, @NombreCli;

WHILE @@FETCH_STATUS = 0
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = @PlaIdPlan AND ProIdProducto = @ProId247)
    BEGIN
        INSERT INTO dbo.PlanesMetrosArticulosPermitidos (PlaIdPlan, ProIdProducto) VALUES (@PlaIdPlan, @ProId247);
        PRINT 'Plan ' + CAST(@PlaIdPlan AS VARCHAR) + ' (' + @NombreCli + '): DTF-247 agregado';
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = @PlaIdPlan AND ProIdProducto = @ProId255)
    BEGIN
        INSERT INTO dbo.PlanesMetrosArticulosPermitidos (PlaIdPlan, ProIdProducto) VALUES (@PlaIdPlan, @ProId255);
        PRINT 'Plan ' + CAST(@PlaIdPlan AS VARCHAR) + ' (' + @NombreCli + '): UV-255 agregado';
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = @PlaIdPlan AND ProIdProducto = @ProId479)
    BEGIN
        INSERT INTO dbo.PlanesMetrosArticulosPermitidos (PlaIdPlan, ProIdProducto) VALUES (@PlaIdPlan, @ProId479);
        PRINT 'Plan ' + CAST(@PlaIdPlan AS VARCHAR) + ' (' + @NombreCli + '): UV-479 agregado';
    END;

    FETCH NEXT FROM cur INTO @PlaIdPlan, @NombreCli;
END;

CLOSE cur; DEALLOCATE cur;

PRINT '';
PRINT 'Listo. Todos los planes DTF/UV activos son ahora mixtos completos.';

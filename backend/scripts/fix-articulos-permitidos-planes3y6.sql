-- fix-articulos-permitidos-planes-dtf-uv.sql
-- Agrega los productos cruzados a los 3 planes afectados para que
-- futuras ordenes DTF/UV se descuenten del plan y no generen deuda.
-- Seguro correrlo mas de una vez (IF NOT EXISTS en cada insert).
--
--   Plan 1  Florencia Sklofsky   (UV RIGIDOS)  le falta: DTF textil COMUN
--   Plan 3  Valentina Rodriguez  (DTF COMUN)   le falta: UV RIGIDOS
--   Plan 6  Diseno Basico SRL    (DTF COMUN)   le falta: UV RIGIDOS

SET NOCOUNT ON;

DECLARE @ProIdDTF INT;
DECLARE @ProIdUV  INT;

SELECT @ProIdDTF = ProIdProducto FROM dbo.Articulos WHERE Descripcion = 'DTF textil COMUN';
SELECT @ProIdUV  = ProIdProducto FROM dbo.Articulos WHERE Descripcion = 'UV (PARA RIGIDOS 0,27)';

IF @ProIdDTF IS NULL BEGIN PRINT 'ERROR: DTF textil COMUN no encontrado en Articulos.'; RETURN; END;
IF @ProIdUV  IS NULL BEGIN PRINT 'ERROR: UV (PARA RIGIDOS 0,27) no encontrado en Articulos.'; RETURN; END;

PRINT 'DTF COMUN  ProId = ' + CAST(@ProIdDTF AS VARCHAR);
PRINT 'UV RIGIDOS ProId = ' + CAST(@ProIdUV  AS VARCHAR);
PRINT '';

-- Plan 1 - Florencia Sklofsky (plan UV, falta DTF COMUN)
IF NOT EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = 1 AND ProIdProducto = @ProIdDTF)
BEGIN
    INSERT INTO dbo.PlanesMetrosArticulosPermitidos (PlaIdPlan, ProIdProducto) VALUES (1, @ProIdDTF);
    PRINT 'Plan 1  (Florencia Sklofsky) : DTF COMUN  agregado OK';
END
ELSE
    PRINT 'Plan 1  (Florencia Sklofsky) : DTF COMUN  ya estaba, omitido';

-- Plan 3 - Valentina Rodriguez (plan DTF, falta UV RIGIDOS)
IF NOT EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = 3 AND ProIdProducto = @ProIdUV)
BEGIN
    INSERT INTO dbo.PlanesMetrosArticulosPermitidos (PlaIdPlan, ProIdProducto) VALUES (3, @ProIdUV);
    PRINT 'Plan 3  (Valentina Rodriguez): UV RIGIDOS agregado OK';
END
ELSE
    PRINT 'Plan 3  (Valentina Rodriguez): UV RIGIDOS ya estaba, omitido';

-- Plan 6 - Diseno Basico SRL (plan DTF, falta UV RIGIDOS)
IF NOT EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan = 6 AND ProIdProducto = @ProIdUV)
BEGIN
    INSERT INTO dbo.PlanesMetrosArticulosPermitidos (PlaIdPlan, ProIdProducto) VALUES (6, @ProIdUV);
    PRINT 'Plan 6  (Diseno Basico SRL)  : UV RIGIDOS agregado OK';
END
ELSE
    PRINT 'Plan 6  (Diseno Basico SRL)  : UV RIGIDOS ya estaba, omitido';

PRINT '';
PRINT 'Listo. Nuevas ordenes DTF/UV se descuentan correctamente de estos planes.';

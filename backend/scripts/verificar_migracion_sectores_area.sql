/* =====================================================================
   VERIFICACIÓN (solo lectura): ¿están aplicados los 4 scripts de
   sectores comerciales + área en la línea de factura?
   ---------------------------------------------------------------------
       1. add_Sectores_Comerciales.sql
       2. add_ArticuloClasificacion.sql
       3. add_DcdArea.sql
       4. add_SP_EstamparAreaLineas.sql

   Correr en la base a verificar. NO modifica nada.

   OJO con el diseño: ninguna tabla/columna nueva se nombra directamente
   fuera de sp_executesql. SQL Server compila el batch ENTERO antes de
   ejecutarlo, así que mencionar dbo.ArticuloClasificacion o DcdArea en
   una base que todavía no los tiene rompe todo el script con "Invalid
   object/column name" — aunque el IF que los usa nunca llegue a entrar.
   Con SQL dinámico, cada consulta se compila recién si corresponde.
   ===================================================================== */

SET NOCOUNT ON;

DECLARE @n INT, @tot INT, @fecha VARCHAR(20);

CREATE TABLE #chk (
    Orden    INT,
    Script   VARCHAR(60),
    Verifica VARCHAR(80),
    Estado   VARCHAR(10),
    Detalle  VARCHAR(200)
);

/* ── 1. add_Sectores_Comerciales.sql ─────────────────────────────────── */
IF OBJECT_ID('dbo.Sectores') IS NULL
    INSERT #chk VALUES (1, '1. add_Sectores_Comerciales.sql', 'Tabla Sectores', 'FALTA', 'La tabla no existe');
ELSE
BEGIN
    EXEC sp_executesql N'SELECT @o = COUNT(*) FROM dbo.Sectores', N'@o INT OUTPUT', @o = @n OUTPUT;
    INSERT #chk VALUES (1, '1. add_Sectores_Comerciales.sql', 'Tabla Sectores', 'OK',
                        CAST(@n AS VARCHAR(20)) + ' sectores (esperado 9)');
END

IF OBJECT_ID('dbo.SectorMapeo') IS NULL
    INSERT #chk VALUES (2, '1. add_Sectores_Comerciales.sql', 'Tabla SectorMapeo', 'FALTA', 'La tabla no existe');
ELSE
BEGIN
    EXEC sp_executesql N'SELECT @o = COUNT(*) FROM dbo.SectorMapeo WHERE SmaActivo = 1', N'@o INT OUTPUT', @o = @n OUTPUT;
    INSERT #chk VALUES (2, '1. add_Sectores_Comerciales.sql', 'Tabla SectorMapeo', 'OK',
                        CAST(@n AS VARCHAR(20)) + ' áreas mapeadas a un sector (esperado 11)');
END

/* ── 2. add_ArticuloClasificacion.sql ────────────────────────────────── */
IF OBJECT_ID('dbo.ArticuloClasificacion') IS NULL
    INSERT #chk VALUES (3, '2. add_ArticuloClasificacion.sql', 'Tabla ArticuloClasificacion', 'FALTA', 'La tabla no existe');
ELSE
BEGIN
    EXEC sp_executesql N'SELECT @o = COUNT(*) FROM dbo.ArticuloClasificacion WHERE AclArea IS NOT NULL',
                       N'@o INT OUTPUT', @o = @n OUTPUT;
    SELECT @tot = COUNT(*) FROM dbo.Articulos;
    INSERT #chk VALUES (3, '2. add_ArticuloClasificacion.sql', 'Tabla ArticuloClasificacion', 'OK',
                        CAST(@n AS VARCHAR(20)) + ' de ' + CAST(@tot AS VARCHAR(20)) + ' artículos clasificados');
END

/* ── 3. add_DcdArea.sql ──────────────────────────────────────────────── */
INSERT #chk
SELECT 4, '3. add_DcdArea.sql', 'Columna DcdArea',
       CASE WHEN COL_LENGTH('dbo.DocumentosContablesDetalle', 'DcdArea') IS NULL THEN 'FALTA' ELSE 'OK' END,
       CASE WHEN COL_LENGTH('dbo.DocumentosContablesDetalle', 'DcdArea') IS NULL THEN 'La columna no existe' ELSE 'Existe' END;

INSERT #chk
SELECT 5, '3. add_DcdArea.sql', 'Columnas DcdVariante / DcdProIdProducto',
       CASE WHEN COL_LENGTH('dbo.DocumentosContablesDetalle', 'DcdVariante') IS NULL
              OR COL_LENGTH('dbo.DocumentosContablesDetalle', 'DcdProIdProducto') IS NULL THEN 'FALTA' ELSE 'OK' END,
       CASE WHEN COL_LENGTH('dbo.DocumentosContablesDetalle', 'DcdVariante') IS NULL
              OR COL_LENGTH('dbo.DocumentosContablesDetalle', 'DcdProIdProducto') IS NULL
            THEN 'Falta alguna de las dos' ELSE 'Existen las dos' END;

INSERT #chk
SELECT 6, '3. add_DcdArea.sql', 'Índice IX_DCD_Area',
       CASE WHEN NOT EXISTS (SELECT 1 FROM sys.indexes
                             WHERE name = 'IX_DCD_Area' AND object_id = OBJECT_ID('dbo.DocumentosContablesDetalle'))
            THEN 'FALTA' ELSE 'OK' END,
       CASE WHEN NOT EXISTS (SELECT 1 FROM sys.indexes
                             WHERE name = 'IX_DCD_Area' AND object_id = OBJECT_ID('dbo.DocumentosContablesDetalle'))
            THEN 'El índice no existe' ELSE 'Existe' END;

/* Cobertura del backfill (solo si la columna ya existe) */
IF COL_LENGTH('dbo.DocumentosContablesDetalle', 'DcdArea') IS NULL
    INSERT #chk VALUES (7, '3. add_DcdArea.sql', 'Backfill del histórico', 'FALTA',
                        'Sin la columna DcdArea no hay backfill que medir');
ELSE
BEGIN
    DECLARE @con INT, @sin INT;
    EXEC sp_executesql N'
        SELECT @oc = SUM(CASE WHEN dcd.DcdArea IS NOT NULL THEN 1 ELSE 0 END),
               @os = SUM(CASE WHEN dcd.DcdArea IS NULL THEN 1 ELSE 0 END)
        FROM dbo.DocumentosContablesDetalle dcd
        JOIN dbo.DocumentosContables doc WITH(NOLOCK) ON doc.DocIdDocumento = dcd.DocIdDocumento
        WHERE (((doc.DocTipo LIKE ''%Factura%'' OR doc.DocTipo LIKE ''%Ticket%'') AND doc.DocTipo NOT LIKE ''%Nota%'')
                OR RTRIM(doc.DocTipo) = ''Pedidos Caja'')
          AND doc.DocEstado <> ''ANULADO'';',
        N'@oc INT OUTPUT, @os INT OUTPUT', @oc = @con OUTPUT, @os = @sin OUTPUT;

    INSERT #chk VALUES (7, '3. add_DcdArea.sql', 'Backfill del histórico',
        CASE WHEN ISNULL(@con, 0) = 0 THEN 'FALTA' ELSE 'OK' END,
        CAST(ISNULL(@con, 0) AS VARCHAR(20)) + ' líneas de venta con área, ' +
        CAST(ISNULL(@sin, 0) AS VARCHAR(20)) + ' sin área (' +
        CAST(CAST(100.0 * ISNULL(@con, 0) / NULLIF(ISNULL(@con, 0) + ISNULL(@sin, 0), 0) AS DECIMAL(5, 2)) AS VARCHAR(10)) +
        '% cubierto, esperado ~99,8%)');
END

/* ── 4. add_SP_EstamparAreaLineas.sql ────────────────────────────────── */
IF OBJECT_ID('dbo.SP_EstamparAreaLineasDocumento', 'P') IS NULL
    INSERT #chk VALUES (8, '4. add_SP_EstamparAreaLineas.sql', 'Procedimiento SP_EstamparAreaLineasDocumento',
                        'FALTA', 'El procedimiento no existe');
ELSE
BEGIN
    SELECT @fecha = CONVERT(VARCHAR(16), create_date, 120)
    FROM sys.objects WHERE object_id = OBJECT_ID('dbo.SP_EstamparAreaLineasDocumento');
    INSERT #chk VALUES (8, '4. add_SP_EstamparAreaLineas.sql', 'Procedimiento SP_EstamparAreaLineasDocumento',
                        'OK', 'Creado el ' + @fecha);
END

/* ── Resultado ───────────────────────────────────────────────────────── */
SELECT Orden, Script, Verifica, Estado, Detalle FROM #chk ORDER BY Orden;

SELECT CASE WHEN EXISTS (SELECT 1 FROM #chk WHERE Estado = 'FALTA')
            THEN 'HAY PASOS SIN APLICAR — mirá las filas con FALTA y corré esos scripts en orden'
            ELSE 'TODO APLICADO' END AS Resumen;

DROP TABLE #chk;

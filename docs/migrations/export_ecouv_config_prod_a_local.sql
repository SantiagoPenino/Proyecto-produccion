-- =====================================================================
-- EXPORT CONFIG ECOUV: PRODUCCIÓN → LOCAL (03/08/2026)
--
-- QUÉ HACE: se corre en PRODUCCIÓN (SOLO LECTURA, no modifica nada) y
-- devuelve como texto un script T-SQL listo para ejecutar en LOCAL.
-- Cubre toda la config de la pantalla "Configuración EcoUV":
--   1) Terminaciones          (catálogo: unidad, manera de aplicación, activo)
--   2) MaterialTerminaciones  (matriz material ↔ terminación)
--   3) articulos              (artículos de productos terminados, grupo 1.3)
--   4) ProductosTerminados    (ficha: medidas, borde, material, tinta)
--   5) ProductoTerminadoTerminaciones (terminaciones incluidas)
--   6) PreciosBase            (precio directo de terminaciones y prod. term.)
--
-- El script generado matchea por CLAVES NATURALES (Nombre de terminación /
-- CodArticulo), así que no importa que los IDENTITY difieran entre bases.
--
-- CÓMO USARLO (SSMS en producción):
--   1) Resultados en texto: Ctrl+T.
--   2) Subir el máximo por columna: Herramientas > Opciones > Resultados de
--      consulta > SQL Server > Resultados en texto > "Número máximo de
--      caracteres" = 8192 (si queda en 256 las líneas salen cortadas).
--   3) Ejecutar este script y copiar TODO el resultado.
--   4) Pegar y ejecutar en LOCAL. Los encabezados salen como "--" a
--      propósito: son comentarios, no hay que borrarlos.
--
-- PRE-REQUISITO EN LOCAL: tener corridas las migraciones
--   ecouv_variantes_terminaciones.sql (tablas + variantes 1.1.3.x)
--   ecouv_param_cliente_terminacion.sql (columna ParamCliente)
--
-- NOTAS:
--   · Secciones 2 y 5 hacen RECARGA COMPLETA (DELETE + INSERT) en local:
--     la matriz y las terminaciones incluidas quedan idénticas a prod.
--   · Sección 3 usa IDENTITY_INSERT para conservar ProIdProducto
--     (CodArticulo = ProIdProducto en los productos terminados creados
--     desde la app). Si en local ese ProIdProducto ya lo usa OTRO artículo,
--     esa fila falla y se resuelve a mano.
-- =====================================================================
SET NOCOUNT ON;

-- ---------------------------------------------------------------------
-- 1) TERMINACIONES (upsert por Nombre)
-- ---------------------------------------------------------------------
SELECT stmt AS [--] FROM (
    SELECT CAST(0 AS bigint) AS ord, CAST(N'-- ===== 1) Terminaciones =====' AS nvarchar(max)) AS stmt
    UNION ALL
    SELECT ROW_NUMBER() OVER (ORDER BY Nombre),
        N'IF EXISTS (SELECT 1 FROM Terminaciones WHERE LTRIM(RTRIM(Nombre)) = N''' + REPLACE(LTRIM(RTRIM(Nombre)), '''', '''''') + N''') '
      + N'UPDATE Terminaciones SET '
      + N'CodArticulo = '   + CASE WHEN CodArticulo IS NULL THEN N'NULL' ELSE N'''' + LTRIM(RTRIM(CodArticulo)) + N'''' END
      + N', UnidadCobro = ''' + LTRIM(RTRIM(ISNULL(UnidadCobro, 'U'))) + N''''
      + N', Activo = '        + CAST(ISNULL(Activo, 1) AS nvarchar(1))
      + N', Ubicaciones = '   + CASE WHEN Ubicaciones IS NULL THEN N'NULL' ELSE N'''' + LTRIM(RTRIM(Ubicaciones)) + N'''' END
      + N', ReglaCantidad = ' + CASE WHEN ReglaCantidad IS NULL THEN N'NULL' ELSE N'''' + LTRIM(RTRIM(ReglaCantidad)) + N'''' END
      + N', ParamCantidad = ' + ISNULL(CONVERT(nvarchar(20), ParamCantidad), N'NULL')
      + N', ClienteElige = '  + CAST(ISNULL(ClienteElige, 1) AS nvarchar(1))
      + N' WHERE LTRIM(RTRIM(Nombre)) = N''' + REPLACE(LTRIM(RTRIM(Nombre)), '''', '''''') + N''' '
      + N'ELSE INSERT INTO Terminaciones (Nombre, CodArticulo, UnidadCobro, Activo, Ubicaciones, ReglaCantidad, ParamCantidad, ClienteElige) VALUES ('
      + N'N''' + REPLACE(LTRIM(RTRIM(Nombre)), '''', '''''') + N''', '
      + CASE WHEN CodArticulo IS NULL THEN N'NULL' ELSE N'''' + LTRIM(RTRIM(CodArticulo)) + N'''' END + N', '
      + N'''' + LTRIM(RTRIM(ISNULL(UnidadCobro, 'U'))) + N''', '
      + CAST(ISNULL(Activo, 1) AS nvarchar(1)) + N', '
      + CASE WHEN Ubicaciones IS NULL THEN N'NULL' ELSE N'''' + LTRIM(RTRIM(Ubicaciones)) + N'''' END + N', '
      + CASE WHEN ReglaCantidad IS NULL THEN N'NULL' ELSE N'''' + LTRIM(RTRIM(ReglaCantidad)) + N'''' END + N', '
      + ISNULL(CONVERT(nvarchar(20), ParamCantidad), N'NULL') + N', '
      + CAST(ISNULL(ClienteElige, 1) AS nvarchar(1)) + N');'
    FROM Terminaciones
) X ORDER BY ord;
GO

-- ---------------------------------------------------------------------
-- 2) MATERIALTERMINACIONES (recarga completa; TerminacionID resuelto
--    en local por Nombre)
-- ---------------------------------------------------------------------
SELECT stmt AS [--] FROM (
    SELECT CAST(0 AS bigint) AS ord, CAST(N'-- ===== 2) MaterialTerminaciones (recarga completa) =====' AS nvarchar(max)) AS stmt
    UNION ALL
    SELECT 1, N'DELETE FROM MaterialTerminaciones;'
    UNION ALL
    SELECT 1 + ROW_NUMBER() OVER (ORDER BY MT.CodArticulo, T.Nombre),
        N'INSERT INTO MaterialTerminaciones (CodArticulo, TerminacionID) '
      + N'SELECT ''' + LTRIM(RTRIM(MT.CodArticulo)) + N''', T.TerminacionID FROM Terminaciones T '
      + N'WHERE LTRIM(RTRIM(T.Nombre)) = N''' + REPLACE(LTRIM(RTRIM(T.Nombre)), '''', '''''') + N''';'
    FROM MaterialTerminaciones MT
    INNER JOIN Terminaciones T ON T.TerminacionID = MT.TerminacionID
) X ORDER BY ord;
GO

-- ---------------------------------------------------------------------
-- 3) ARTÍCULOS DE PRODUCTOS TERMINADOS (grupo 1.3, variantes con
--    TipoStock = PRODUCTO_TERMINADO). Inserta los que falten en local
--    conservando ProIdProducto; si ya existen, sincroniza nombre,
--    variante y visibilidad.
-- ---------------------------------------------------------------------
SELECT stmt AS [--] FROM (
    SELECT CAST(0 AS bigint) AS ord, CAST(N'-- ===== 3) Articulos de productos terminados =====' AS nvarchar(max)) AS stmt
    UNION ALL
    SELECT ROW_NUMBER() OVER (ORDER BY A.CodArticulo),
        N'IF NOT EXISTS (SELECT 1 FROM articulos WHERE LTRIM(RTRIM(CodArticulo)) = ''' + LTRIM(RTRIM(A.CodArticulo)) + N''' AND LTRIM(RTRIM(CodStock)) LIKE ''1.1.3.%'') '
      + N'BEGIN SET IDENTITY_INSERT articulos ON; '
      + N'INSERT INTO articulos (ProIdProducto, CodArticulo, IDProdReact, Descripcion, CodStock, Grupo, SupFlia, Mostrar, anchoimprimible, LLEVAPAPEL, MonIdMoneda, borrar) VALUES ('
      + CAST(A.ProIdProducto AS nvarchar(20)) + N', '
      + N'''' + LTRIM(RTRIM(A.CodArticulo)) + N''', '
      + ISNULL(CAST(A.IDProdReact AS nvarchar(20)), N'NULL') + N', '
      + N'''' + REPLACE(LTRIM(RTRIM(ISNULL(A.Descripcion, ''))), '''', '''''') + N''', '
      + N'''' + LTRIM(RTRIM(A.CodStock)) + N''', '
      + N'''' + LTRIM(RTRIM(ISNULL(A.Grupo, '1.3'))) + N''', '
      + N'''' + LTRIM(RTRIM(ISNULL(A.SupFlia, '1'))) + N''', '
      + CAST(ISNULL(A.Mostrar, 1) AS nvarchar(1)) + N', '
      + ISNULL(CONVERT(nvarchar(20), A.anchoimprimible), N'0') + N', '
      + ISNULL(CAST(A.LLEVAPAPEL AS nvarchar(10)), N'0') + N', '
      + ISNULL(CAST(A.MonIdMoneda AS nvarchar(10)), N'NULL') + N', '
      + ISNULL(CAST(A.borrar AS nvarchar(10)), N'0')
      + N'); SET IDENTITY_INSERT articulos OFF; END '
      + N'ELSE UPDATE articulos SET '
      + N'Descripcion = ''' + REPLACE(LTRIM(RTRIM(ISNULL(A.Descripcion, ''))), '''', '''''') + N''', '
      + N'CodStock = ''' + LTRIM(RTRIM(A.CodStock)) + N''', '
      + N'Mostrar = ' + CAST(ISNULL(A.Mostrar, 1) AS nvarchar(1))
      + N' WHERE LTRIM(RTRIM(CodArticulo)) = ''' + LTRIM(RTRIM(A.CodArticulo)) + N''' AND LTRIM(RTRIM(CodStock)) LIKE ''1.1.3.%'';'
    FROM articulos A
    INNER JOIN StockArt S ON LTRIM(RTRIM(S.CodStock)) = LTRIM(RTRIM(A.CodStock))
        AND ISNULL(S.TipoStock, 'MATERIAL') = 'PRODUCTO_TERMINADO'
        AND LTRIM(RTRIM(S.Grupo)) = '1.3'
) X ORDER BY ord;
GO

-- ---------------------------------------------------------------------
-- 4) PRODUCTOSTERMINADOS (ficha; upsert por CodArticulo)
-- ---------------------------------------------------------------------
SELECT stmt AS [--] FROM (
    SELECT CAST(0 AS bigint) AS ord, CAST(N'-- ===== 4) ProductosTerminados (ficha) =====' AS nvarchar(max)) AS stmt
    UNION ALL
    SELECT ROW_NUMBER() OVER (ORDER BY CodArticulo),
        N'IF EXISTS (SELECT 1 FROM ProductosTerminados WHERE LTRIM(RTRIM(CodArticulo)) = ''' + LTRIM(RTRIM(CodArticulo)) + N''') '
      + N'UPDATE ProductosTerminados SET '
      + N'AnchoM = '  + ISNULL(CONVERT(nvarchar(20), AnchoM), N'NULL')
      + N', AltoM = ' + ISNULL(CONVERT(nvarchar(20), AltoM), N'NULL')
      + N', BordeCm = ' + ISNULL(CONVERT(nvarchar(20), BordeCm), N'NULL')
      + N', MaterialCodArticulo = ' + CASE WHEN MaterialCodArticulo IS NULL THEN N'NULL' ELSE N'''' + LTRIM(RTRIM(MaterialCodArticulo)) + N'''' END
      + N', Tinta = ' + CASE WHEN Tinta IS NULL THEN N'NULL' ELSE N'''' + REPLACE(LTRIM(RTRIM(Tinta)), '''', '''''') + N'''' END
      + N', Activo = ' + CAST(ISNULL(Activo, 1) AS nvarchar(1))
      + N' WHERE LTRIM(RTRIM(CodArticulo)) = ''' + LTRIM(RTRIM(CodArticulo)) + N''' '
      + N'ELSE INSERT INTO ProductosTerminados (CodArticulo, AnchoM, AltoM, BordeCm, MaterialCodArticulo, Tinta, Activo) VALUES ('
      + N'''' + LTRIM(RTRIM(CodArticulo)) + N''', '
      + ISNULL(CONVERT(nvarchar(20), AnchoM), N'NULL') + N', '
      + ISNULL(CONVERT(nvarchar(20), AltoM), N'NULL') + N', '
      + ISNULL(CONVERT(nvarchar(20), BordeCm), N'NULL') + N', '
      + CASE WHEN MaterialCodArticulo IS NULL THEN N'NULL' ELSE N'''' + LTRIM(RTRIM(MaterialCodArticulo)) + N'''' END + N', '
      + CASE WHEN Tinta IS NULL THEN N'NULL' ELSE N'''' + REPLACE(LTRIM(RTRIM(Tinta)), '''', '''''') + N'''' END + N', '
      + CAST(ISNULL(Activo, 1) AS nvarchar(1)) + N');'
    FROM ProductosTerminados
) X ORDER BY ord;
GO

-- ---------------------------------------------------------------------
-- 5) PRODUCTOTERMINADOTERMINACIONES (recarga completa; IDs resueltos en
--    local por CodArticulo del producto y Nombre de la terminación)
--    Si PROD todavía no tiene la columna ParamCliente y este batch da
--    "Invalid column name", reemplazar PTT.ParamCliente por NULL abajo.
-- ---------------------------------------------------------------------
SELECT stmt AS [--] FROM (
    SELECT CAST(0 AS bigint) AS ord, CAST(N'-- ===== 5) ProductoTerminadoTerminaciones (recarga completa) =====' AS nvarchar(max)) AS stmt
    UNION ALL
    SELECT 1, N'DELETE FROM ProductoTerminadoTerminaciones;'
    UNION ALL
    SELECT 1 + ROW_NUMBER() OVER (ORDER BY P.CodArticulo, T.Nombre),
        N'INSERT INTO ProductoTerminadoTerminaciones (ProductoID, TerminacionID, Cantidad, Ubicacion, ParamCliente) '
      + N'SELECT P.ID, T.TerminacionID, ' + ISNULL(CONVERT(nvarchar(20), PTT.Cantidad), N'1') + N', '
      + CASE WHEN PTT.Ubicacion IS NULL THEN N'NULL' ELSE N'''' + LTRIM(RTRIM(PTT.Ubicacion)) + N'''' END + N', '
      + ISNULL(CONVERT(nvarchar(20), PTT.ParamCliente), N'NULL')
      + N' FROM ProductosTerminados P CROSS JOIN Terminaciones T '
      + N'WHERE LTRIM(RTRIM(P.CodArticulo)) = ''' + LTRIM(RTRIM(P.CodArticulo)) + N''' '
      + N'AND LTRIM(RTRIM(T.Nombre)) = N''' + REPLACE(LTRIM(RTRIM(T.Nombre)), '''', '''''') + N''';'
    FROM ProductoTerminadoTerminaciones PTT
    INNER JOIN ProductosTerminados P ON P.ID = PTT.ProductoID
    INNER JOIN Terminaciones T ON T.TerminacionID = PTT.TerminacionID
) X ORDER BY ord;
GO

-- ---------------------------------------------------------------------
-- 6) PRECIOSBASE (precio directo de terminaciones y productos terminados;
--    upsert por CodArticulo, mismo criterio que la app: TOP 1 por
--    UltimaActualizacion)
-- ---------------------------------------------------------------------
SELECT stmt AS [--] FROM (
    SELECT CAST(0 AS bigint) AS ord, CAST(N'-- ===== 6) PreciosBase (precios directos) =====' AS nvarchar(max)) AS stmt
    UNION ALL
    SELECT ROW_NUMBER() OVER (ORDER BY C.Cod),
        N'UPDATE PreciosBase SET Precio = ' + CONVERT(nvarchar(30), PB.Precio)
      + N', Moneda = ''' + LTRIM(RTRIM(ISNULL(PB.Moneda, 'UYU'))) + N''''
      + N', MonIdMoneda = ' + ISNULL(CAST(PB.MonIdMoneda AS nvarchar(10)), N'1')
      + N', UltimaActualizacion = GETDATE()'
      + N' WHERE LTRIM(RTRIM(CodArticulo)) = ''' + C.Cod + N'''; '
      + N'IF @@ROWCOUNT = 0 INSERT INTO PreciosBase (CodArticulo, Precio, Moneda, MonIdMoneda, UltimaActualizacion, ProIdProducto) VALUES ('
      + N'''' + C.Cod + N''', '
      + CONVERT(nvarchar(30), PB.Precio) + N', '
      + N'''' + LTRIM(RTRIM(ISNULL(PB.Moneda, 'UYU'))) + N''', '
      + ISNULL(CAST(PB.MonIdMoneda AS nvarchar(10)), N'1') + N', GETDATE(), '
      + N'(SELECT TOP 1 ProIdProducto FROM articulos WHERE LTRIM(RTRIM(CodArticulo)) = ''' + C.Cod
      + N''' ORDER BY CASE WHEN LTRIM(RTRIM(CodStock)) LIKE ''1.1.3.%'' THEN 0 ELSE 1 END));'
    FROM (
        SELECT DISTINCT LTRIM(RTRIM(CodArticulo)) AS Cod
        FROM Terminaciones WHERE CodArticulo IS NOT NULL AND LTRIM(RTRIM(CodArticulo)) <> ''
        UNION
        SELECT DISTINCT LTRIM(RTRIM(A.CodArticulo))
        FROM articulos A
        INNER JOIN StockArt S ON LTRIM(RTRIM(S.CodStock)) = LTRIM(RTRIM(A.CodStock))
            AND ISNULL(S.TipoStock, 'MATERIAL') = 'PRODUCTO_TERMINADO'
            AND LTRIM(RTRIM(S.Grupo)) = '1.3'
    ) C
    CROSS APPLY (
        SELECT TOP 1 PB.Precio, PB.Moneda, PB.MonIdMoneda
        FROM PreciosBase PB
        WHERE LTRIM(RTRIM(PB.CodArticulo)) = C.Cod
        ORDER BY PB.UltimaActualizacion DESC
    ) PB
) X ORDER BY ord;
GO

-- ---------------------------------------------------------------------
-- VERIFICACIÓN (correr en LOCAL después de aplicar el script generado,
-- y comparar contra los mismos números de PROD)
-- ---------------------------------------------------------------------
-- SELECT (SELECT COUNT(*) FROM Terminaciones WHERE Activo = 1)        AS TerminacionesActivas,
--        (SELECT COUNT(*) FROM MaterialTerminaciones)                 AS MatrizMaterialTerm,
--        (SELECT COUNT(*) FROM ProductosTerminados)                   AS FichasProductoTerminado,
--        (SELECT COUNT(*) FROM ProductoTerminadoTerminaciones)        AS TerminacionesIncluidas;

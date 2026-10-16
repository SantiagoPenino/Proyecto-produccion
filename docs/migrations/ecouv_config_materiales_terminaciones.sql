-- =====================================================================
-- ECOUV — Configuración de materiales y terminaciones (30/07/2026)
--
-- Reglas de negocio definidas por el usuario:
--   · Las lonas son las que llevan SOLDADURA, OJALES y BOLSILLO.
--   · Banner PET y Back pet son MATERIALES, no terminaciones.
--   · Roll up aluminio  → se imprime en Banner PET.
--   · Roll up plástico  → se imprime en lona.
--   · Columneras y Pasacalles → lona, con palos y soldadura (ya cargado).
--
-- El MATERIAL de cada producto terminado lo carga el usuario desde el
-- gestor de Productos Terminados: este script NO toca esa columna.
--
-- Idempotente: se puede correr varias veces.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TERMINACIÓN NUEVA: Bolsillo (canal para pasar caño o soga)
--    Se cobra por METRO, igual que la soldadura. Queda SIN artículo de
--    facturación: vincularlo desde el modal de Terminaciones ECOUV.
-- ---------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM Terminaciones WHERE LTRIM(RTRIM(Nombre)) = N'Bolsillo')
BEGIN
    INSERT INTO Terminaciones (Nombre, CodArticulo, UnidadCobro, Activo,
                               Ubicaciones, ReglaCantidad, ParamCantidad, ClienteElige)
    VALUES (N'Bolsillo', NULL, 'M', 1,
            'ARRIBA,ABAJO,ARRIBA_ABAJO,IZQUIERDA,DERECHA,COSTADOS,PERIMETRO',
            'METROS_TRAMO', NULL, 1);
    PRINT 'Terminación Bolsillo creada (falta vincularle el artículo de facturación y el precio)';
END
ELSE PRINT 'Terminación Bolsillo ya existe';
GO

-- Bolsillo se ofrece en TODAS las lonas
INSERT INTO MaterialTerminaciones (CodArticulo, TerminacionID)
SELECT A.Cod, T.TerminacionID
FROM (VALUES ('1590'),('1627'),('1628'),('1604'),('480'),('1587')) AS A(Cod)
CROSS JOIN (SELECT TerminacionID FROM Terminaciones WHERE LTRIM(RTRIM(Nombre)) = N'Bolsillo') T
WHERE NOT EXISTS (
    SELECT 1 FROM MaterialTerminaciones MT
    WHERE LTRIM(RTRIM(MT.CodArticulo)) = A.Cod AND MT.TerminacionID = T.TerminacionID);
PRINT CONCAT('Bolsillo vinculado a lonas: ', @@ROWCOUNT, ' nuevos vínculos');
GO

-- ---------------------------------------------------------------------
-- 2. Ubicaciones IZQUIERDA / DERECHA (un solo costado) en las
--    terminaciones que se aplican sobre bordes.
-- ---------------------------------------------------------------------
UPDATE Terminaciones
SET Ubicaciones = 'ARRIBA,ABAJO,ARRIBA_ABAJO,IZQUIERDA,DERECHA,COSTADOS,PERIMETRO'
WHERE LTRIM(RTRIM(Nombre)) IN (N'Colocación de ojales', N'Soldadura de lona', N'Bolsillo')
  AND ISNULL(Ubicaciones, '') NOT LIKE '%IZQUIERDA%';
PRINT CONCAT('Terminaciones con ubicaciones ampliadas: ', @@ROWCOUNT);
GO

-- ---------------------------------------------------------------------
-- 3. BANNER PET y BACK PET pasan a ser MATERIALES
--    Sus artículos se mueven de "Materiales Extra Gran Formato"
--    (1.1.3.2, tipo TERMINACION) a "Papel y PET" (1.1.3.6, MATERIAL).
--    Se filtra por CodStock porque el CodArticulo se repite entre grupos.
-- ---------------------------------------------------------------------
UPDATE articulos
SET CodStock = '1.1.3.6'
WHERE LTRIM(RTRIM(CodArticulo)) IN ('1585', '1584', '28')
  AND LTRIM(RTRIM(CodStock)) = '1.1.3.2';
PRINT CONCAT('Artículos movidos a Papel y PET: ', @@ROWCOUNT);
GO

-- Y salen del catálogo de terminaciones (se desactivan, no se borran:
-- pueden estar referenciados por órdenes históricas).
DELETE MT FROM MaterialTerminaciones MT
INNER JOIN Terminaciones T ON T.TerminacionID = MT.TerminacionID
WHERE LTRIM(RTRIM(T.Nombre)) IN (N'Banner Pet mate (0,91)', N'Banner Pet semibrillo (0,91)', N'Back pet');
PRINT CONCAT('Vínculos material-terminación eliminados (eran materiales): ', @@ROWCOUNT);

UPDATE Terminaciones SET Activo = 0
WHERE LTRIM(RTRIM(Nombre)) IN (N'Banner Pet mate (0,91)', N'Banner Pet semibrillo (0,91)', N'Back pet')
  AND Activo = 1;
PRINT CONCAT('Terminaciones desactivadas (son materiales): ', @@ROWCOUNT);
GO

-- ---------------------------------------------------------------------
-- 4. ROLL UPS: cada uno con su material real
--    aluminio → Banner PET   ·   plástico → lonas
--    (hoy los dos apuntaban a Papel Fotográfico / PET Backlight)
-- ---------------------------------------------------------------------
DELETE MT FROM MaterialTerminaciones MT
INNER JOIN Terminaciones T ON T.TerminacionID = MT.TerminacionID
WHERE LTRIM(RTRIM(T.Nombre)) IN (N'Roll up aluminio', N'Roll up plástico');
PRINT CONCAT('Vínculos viejos de roll ups eliminados: ', @@ROWCOUNT);

-- Roll up aluminio → Banner Pet mate y semibrillo
INSERT INTO MaterialTerminaciones (CodArticulo, TerminacionID)
SELECT A.Cod, T.TerminacionID
FROM (VALUES ('1585'),('1584')) AS A(Cod)
CROSS JOIN (SELECT TerminacionID FROM Terminaciones WHERE LTRIM(RTRIM(Nombre)) = N'Roll up aluminio') T
WHERE NOT EXISTS (SELECT 1 FROM MaterialTerminaciones MT
                  WHERE LTRIM(RTRIM(MT.CodArticulo)) = A.Cod AND MT.TerminacionID = T.TerminacionID);

-- Roll up plástico → todas las lonas
INSERT INTO MaterialTerminaciones (CodArticulo, TerminacionID)
SELECT A.Cod, T.TerminacionID
FROM (VALUES ('1590'),('1627'),('1628'),('1604'),('480'),('1587')) AS A(Cod)
CROSS JOIN (SELECT TerminacionID FROM Terminaciones WHERE LTRIM(RTRIM(Nombre)) = N'Roll up plástico') T
WHERE NOT EXISTS (SELECT 1 FROM MaterialTerminaciones MT
                  WHERE LTRIM(RTRIM(MT.CodArticulo)) = A.Cod AND MT.TerminacionID = T.TerminacionID);
PRINT 'Roll ups revinculados';
GO

-- ---------------------------------------------------------------------
-- 5. Bastidor de hierro: estaba INACTIVO y es la terminación incluida de
--    los 18 cuadros canvas. Inactiva = no se registra en la orden, así
--    que el taller nunca la veía en su checklist.
-- ---------------------------------------------------------------------
UPDATE Terminaciones SET Activo = 1
WHERE LTRIM(RTRIM(Nombre)) = N'Bastidor de hierro' AND Activo = 0;
PRINT CONCAT('Bastidor de hierro activado: ', @@ROWCOUNT);
GO

-- ---------------------------------------------------------------------
-- 6. Limpieza: el "Cuadro canvas 1.60 x 80" (art. 132) tenía cargado
--    "Roll up plástico" como terminación incluida — resto de una prueba.
-- ---------------------------------------------------------------------
DELETE PTT
FROM ProductoTerminadoTerminaciones PTT
INNER JOIN ProductosTerminados P ON P.ID = PTT.ProductoID
INNER JOIN Terminaciones T ON T.TerminacionID = PTT.TerminacionID
WHERE LTRIM(RTRIM(P.CodArticulo)) = '132'
  AND LTRIM(RTRIM(T.Nombre)) = N'Roll up plástico';
PRINT CONCAT('Terminación de prueba quitada del cuadro canvas: ', @@ROWCOUNT);
GO

-- =====================================================================
-- VERIFICACIÓN
-- =====================================================================
SELECT LTRIM(RTRIM(T.Nombre)) AS Terminacion, T.UnidadCobro, T.Activo,
       T.Ubicaciones, T.ReglaCantidad,
       (SELECT COUNT(*) FROM MaterialTerminaciones MT WHERE MT.TerminacionID = T.TerminacionID) AS Materiales
FROM Terminaciones T ORDER BY T.Activo DESC, T.Nombre;

SELECT LTRIM(RTRIM(S.Articulo)) AS Variante, S.TipoStock,
       LTRIM(RTRIM(A.CodArticulo)) AS Cod, LTRIM(RTRIM(A.Descripcion)) AS Articulo
FROM articulos A
JOIN StockArt S ON LTRIM(RTRIM(S.CodStock)) = LTRIM(RTRIM(A.CodStock))
WHERE LTRIM(RTRIM(A.CodArticulo)) IN ('1585','1584','28');
GO

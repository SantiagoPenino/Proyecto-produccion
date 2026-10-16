/* =====================================================================================
   PORTAL ECOUV — reparar las fichas de Productos Terminados que traban la subida
   15-sep-2026 · Correr DESPUÉS de diag_productos_terminados_portal.sql
   Idempotente: solo INSERTA las fichas que faltan. NO pisa ninguna ficha existente.

   Las medidas son las que hoy tiene LOCAL. Revisá la lista antes de correr: si en
   producción alguna medida es otra, corregila acá primero.
   ===================================================================================== */

SET NOCOUNT ON;

DECLARE @Fichas TABLE (
    CodArticulo VARCHAR(50) PRIMARY KEY,
    AnchoM DECIMAL(9,3) NULL,
    AltoM  DECIMAL(9,3) NULL,
    BordeCm DECIMAL(9,2) NULL,
    MaterialCodArticulo VARCHAR(50) NULL,
    Tinta VARCHAR(50) NULL
);

INSERT INTO @Fichas (CodArticulo, AnchoM, AltoM, BordeCm, MaterialCodArticulo, Tinta) VALUES
    ('1610', 0.77, 0.5, NULL, N'1587', NULL),   -- Columnera 0,77 x 0,50 + Palo
    ('1620', 1, 1, 5, N'498', N'Ecosolvente'),   -- Cuadro canvas 1,00 x 1,00
    ('1625', 1.1, 0.5, 5, N'498', N'Ecosolvente'),   -- Cuadro canvas 1,10 x 50
    ('500', 1.15, 1.15, 5, N'498', N'Ecosolvente'),   -- Cuadro canvas 1,15 x 1,15
    ('1626', 1.2, 0.8, 5, N'498', N'Ecosolvente'),   -- Cuadro canvas 1,20 x 80
    ('144', 1.4, 1, 5, N'498', N'Ecosolvente'),   -- Cuadro canvas 1,40 x 1,00
    ('131', 1.4, 0.6, 5, N'498', N'Ecosolvente'),   -- Cuadro canvas 1.40 x 60
    ('1616', 0.25, 0.25, 5, N'498', N'Ecosolvente'),   -- Cuadro canvas 25 x 25
    ('127', 0.35, 0.15, 5, N'498', N'Ecosolvente'),   -- Cuadro canvas 35 x 15
    ('1617', 0.4, 0.4, 5, N'498', N'Ecosolvente'),   -- Cuadro canvas 40 x 40
    ('1623', 0.5, 0.3, 5, N'498', N'Ecosolvente'),   -- Cuadro canvas 50 x 30
    ('1618', 0.6, 0.6, 5, N'498', N'Ecosolvente'),   -- Cuadro canvas 60 x 60
    ('1624', 0.7, 0.5, 5, N'498', N'Ecosolvente'),   -- Cuadro canvas 70 x 50
    ('1619', 0.8, 0.8, 5, N'498', N'Ecosolvente'),   -- Cuadro canvas 80 x 80
    ('1611', 0.77, 1, NULL, N'1587', N'Ecosolvente'),   -- Pasacalles 0,77 x 1,00 + Palo
    ('1612', 0.77, 2, NULL, N'1587', N'Ecosolvente'),   -- Pasacalles 0,77 x 2,00  + Palo
    ('1613', 0.77, 3, NULL, N'1587', N'Ecosolvente'),   -- Pasacalles 0,77 x 3,00 + Palo
    ('1602', 0.78, 2, NULL, N'1585', N'Ecosolvente'),   -- Roll up aluminio + (Banner Pet mate - 0,78)
    ('499', 0.78, 2, NULL, N'1587', N'Ecosolvente')   -- Roll up PVC + (Lona Frontlight  0,78x2,00);

-- 1) Las que FALTAN: se crean activas.
INSERT INTO dbo.ProductosTerminados (CodArticulo, AnchoM, AltoM, BordeCm, MaterialCodArticulo, Tinta, Activo)
SELECT F.CodArticulo, F.AnchoM, F.AltoM, F.BordeCm, F.MaterialCodArticulo, F.Tinta, 1
FROM @Fichas F
WHERE NOT EXISTS (SELECT 1 FROM dbo.ProductosTerminados P
                  WHERE LTRIM(RTRIM(P.CodArticulo)) = LTRIM(RTRIM(F.CodArticulo)));
PRINT CONCAT('Fichas creadas: ', @@ROWCOUNT);

-- 2) Las que existen pero están INACTIVAS o SIN AnchoM: se avisan, NO se tocan solas.
--    (Si alguna se desactivó a propósito, reactivarla la volvería a publicar en el portal.)
SELECT LTRIM(RTRIM(P.CodArticulo)) AS CodArticulo, P.AnchoM, P.AltoM, P.Activo,
       'Revisar a mano: ficha existente inactiva o sin AnchoM' AS Nota
FROM dbo.ProductosTerminados P
INNER JOIN @Fichas F ON LTRIM(RTRIM(P.CodArticulo)) = LTRIM(RTRIM(F.CodArticulo))
WHERE P.Activo = 0 OR P.AnchoM IS NULL;

-- 3) Verificación final: volver a correr el diagnóstico y que no quede ningún 'TRABA'.

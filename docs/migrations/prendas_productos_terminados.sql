/* =====================================================================
   PRENDAS — alta de productos terminados en Articulos
   ---------------------------------------------------------------------
   Idempotente: se puede correr varias veces sin duplicar.

   Qué hace:
     A. Crea la variante StockArt '2.2.1.3' = "Prendas", TipoStock =
        'PRODUCTO_TERMINADO'. Va aparte de '2.2.1.2' (donde conviven los
        auriculares/maquinitas) para que las prendas queden separadas.
     B. Da de alta 57 artículos PR-001..PR-057 con el patrón de los PT-*
        existentes: SupFlia '2', Grupo '2.1', moneda 1 (pesos), Mostrar 1.

   Nomenclatura de la lista (tal cual la pasó el usuario):
     FP    = full print        B = bordado        DTF = DTF
     stock = prenda de stock   STW = ...
   Los precios quedan NULL — cargarlos por SYNC PRECIOS / planilla.

   OJO: 'Articulos' normalmente viene del ERP y la app no la escribe. En
   producción el alta puede ir por Macrosoft en vez de este script.
   ===================================================================== */

-- ── A. Variante StockArt ────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.StockArt WHERE LTRIM(RTRIM(CodStock)) = '2.2.1.3')
BEGIN
    INSERT INTO dbo.StockArt (SupFlia, Grupo, CodStock, Ref, Articulo, Marcado, UM, Mostrar, TipoStock)
    VALUES ('2', '2.1', '2.2.1.3', '3', 'Prendas', 0, 'U', 1, 'PRODUCTO_TERMINADO');
END
ELSE
BEGIN
    UPDATE dbo.StockArt
       SET TipoStock = 'PRODUCTO_TERMINADO', Mostrar = 1
     WHERE LTRIM(RTRIM(CodStock)) = '2.2.1.3';
END
GO

-- ── B. Artículos ────────────────────────────────────────────────────
DECLARE @Prendas TABLE (Cod VARCHAR(20), Descripcion VARCHAR(255));

INSERT INTO @Prendas (Cod, Descripcion) VALUES
 ('PR-001','Camiseta futbol FP'),
 ('PR-002','Camiseta basket FP'),
 ('PR-003','Camiseta voley FP'),
 ('PR-004','Camiseta y short futbol FP'),
 ('PR-005','Camiseta y short basket FP'),
 ('PR-006','Camiseta y short voley FP'),
 ('PR-007','Camiseta short y medias futbol FP'),
 ('PR-008','Camiseta futbol FP+B'),
 ('PR-009','Camiseta basket FP+B'),
 ('PR-010','Camiseta voley FP+B'),
 ('PR-011','Camiseta y short futbol FP+B'),
 ('PR-012','Camiseta y short basket FP+B'),
 ('PR-013','Camiseta y short voley FP+B'),
 ('PR-014','Camiseta short y medias futbol FP+B'),
 ('PR-015','Camiseta futbol FP+B+DTF'),
 ('PR-016','Camiseta basket FP+B+DTF'),
 ('PR-017','Camiseta voley FP+B+DTF'),
 ('PR-018','Camiseta y short futbol FP+B+DTF'),
 ('PR-019','Camiseta y short basket FP+B+DTF'),
 ('PR-020','Camiseta y short voley FP+B+DTF'),
 ('PR-021','Camiseta short y medias futbol FP+B+DTF'),
 ('PR-022','Camiseta futbol FP+DTF'),
 ('PR-023','Camiseta basket FP+DTF'),
 ('PR-024','Camiseta voley FP+DTF'),
 ('PR-025','Camiseta y short futbol FP+DTF'),
 ('PR-026','Camiseta y short basket FP+DTF'),
 ('PR-027','Camiseta y short voley FP+DTF'),
 ('PR-028','Camiseta short y medias futbol FP+DTF'),
 ('PR-029','Bandera personalizada FP'),
 ('PR-030','Bandera confeccionada con diseño'),
 ('PR-031','Short stock+DTF'),
 ('PR-032','Short stock+B'),
 ('PR-033','Short stock+B+DTF'),
 ('PR-034','Short FP'),
 ('PR-035','Short FP+B'),
 ('PR-036','Short FP+DTF'),
 ('PR-037','Short FP+B+DTF'),
 ('PR-038','Gorro de lana +DTF'),
 ('PR-039','Gorro de lana +B'),
 ('PR-040','Gorro de visera +DTF'),
 ('PR-041','Gorro de visera +B'),
 ('PR-042','Gorro de visera +B+DTF'),
 ('PR-043','Imp Remera Algodon +DTF'),
 ('PR-044','Imp Remera Algodon +B'),
 ('PR-045','Imp Remera Algodon +DTF+B'),
 ('PR-046','Imp Remera Algodon STW +DTF'),
 ('PR-047','Imp Remera Algodon STW +B'),
 ('PR-048','Imp Remera Algodon STW +DTF+B'),
 ('PR-049','Imp Remera Polo +DTF'),
 ('PR-050','Imp Remera Polo +B'),
 ('PR-051','Imp Remera Polo +DTF+B'),
 ('PR-052','Imp Canguro +DTF'),
 ('PR-053','Imp Canguro +B'),
 ('PR-054','Imp Canguro +DTF+B'),
 ('PR-055','Imp Canguro STW +DTF'),
 ('PR-056','Imp Canguro STW +B'),
 ('PR-057','Imp Canguro STW +DTF+B');

INSERT INTO dbo.Articulos
    (CodArticulo, Descripcion, SupFlia, Grupo, CodStock, Mostrar, MonIdMoneda, borrar)
SELECT p.Cod, p.Descripcion, '2', '2.1', '2.2.1.3', 1, 1, 0
FROM @Prendas p
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.Articulos a
    WHERE LTRIM(RTRIM(a.CodArticulo)) = p.Cod
);
GO

-- ── Verificación ────────────────────────────────────────────────────
SELECT COUNT(*) AS PrendasCargadas
FROM dbo.Articulos a
INNER JOIN dbo.StockArt sa ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
WHERE ISNULL(sa.TipoStock,'MATERIAL') = 'PRODUCTO_TERMINADO'
  AND LTRIM(RTRIM(a.CodStock)) = '2.2.1.3';
GO

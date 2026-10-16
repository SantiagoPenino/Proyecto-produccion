-- =====================================================================
-- F1 — Producción principal genérica del producto (29-sep-2026)
-- =====================================================================
-- Propuesta: docs/Configurador/PROPUESTA_modelo_generico_productos.md (D1, 5b, 5c, 5f-bis)
-- Solo AGREGA columnas a ProductoVentaConfig. No toca ECOUV ni ninguna tabla existente.
-- Idempotente: se puede correr N veces. Correr ANTES del deploy del backend.
--
--   TecnicaPrincipal  área que produce el producto (SB, DIRECTA, ECOUV, DF…) — AreaID_Interno de ConfigMapeoERP
--   AnchoM/AltoM      medida fija del producto (bandera, funda, cuadro) en metros; NULL = no tiene
--   BordeCm           borde/demasía en cm (cuadros con bastidor), NULL = no aplica
--   UM                cómo se cuenta el producto en la orden: u | m | m2
--   Molde             molde de TizadaPro: OBLIGATORIO (prendas) | OPCIONAL (windflag: molde o archivo a medida) | NO (cuadros, stock)
--   VisiblePortal / VisibleTienda / VisibleInterno   canales (con Estado = PUBLICADO). En F1 solo se guardan;
--                     los lectores siguen con sus flags viejos. Puente: VisibleTienda → TiendaProductos.Publicado.
-- =====================================================================
SET NOCOUNT ON;

IF COL_LENGTH('dbo.ProductoVentaConfig', 'TecnicaPrincipal') IS NULL
    ALTER TABLE dbo.ProductoVentaConfig ADD TecnicaPrincipal VARCHAR(10) NULL;
IF COL_LENGTH('dbo.ProductoVentaConfig', 'AnchoM') IS NULL
    ALTER TABLE dbo.ProductoVentaConfig ADD AnchoM DECIMAL(10,3) NULL;
IF COL_LENGTH('dbo.ProductoVentaConfig', 'AltoM') IS NULL
    ALTER TABLE dbo.ProductoVentaConfig ADD AltoM DECIMAL(10,3) NULL;
IF COL_LENGTH('dbo.ProductoVentaConfig', 'BordeCm') IS NULL
    ALTER TABLE dbo.ProductoVentaConfig ADD BordeCm DECIMAL(6,2) NULL;
IF COL_LENGTH('dbo.ProductoVentaConfig', 'UM') IS NULL
    ALTER TABLE dbo.ProductoVentaConfig ADD UM VARCHAR(3) NOT NULL CONSTRAINT DF_PVC_UM DEFAULT ('u');
IF COL_LENGTH('dbo.ProductoVentaConfig', 'Molde') IS NULL
    ALTER TABLE dbo.ProductoVentaConfig ADD Molde VARCHAR(12) NOT NULL CONSTRAINT DF_PVC_Molde DEFAULT ('OBLIGATORIO');
IF COL_LENGTH('dbo.ProductoVentaConfig', 'VisiblePortal') IS NULL
    ALTER TABLE dbo.ProductoVentaConfig ADD VisiblePortal BIT NOT NULL CONSTRAINT DF_PVC_VisPortal DEFAULT (0);
IF COL_LENGTH('dbo.ProductoVentaConfig', 'VisibleTienda') IS NULL
    ALTER TABLE dbo.ProductoVentaConfig ADD VisibleTienda BIT NOT NULL CONSTRAINT DF_PVC_VisTienda DEFAULT (0);
IF COL_LENGTH('dbo.ProductoVentaConfig', 'VisibleInterno') IS NULL
    ALTER TABLE dbo.ProductoVentaConfig ADD VisibleInterno BIT NOT NULL CONSTRAINT DF_PVC_VisInterno DEFAULT (1);
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PVC_Molde')
    ALTER TABLE dbo.ProductoVentaConfig WITH NOCHECK ADD CONSTRAINT CK_PVC_Molde CHECK (Molde IN ('OBLIGATORIO', 'OPCIONAL', 'NO'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PVC_UM')
    ALTER TABLE dbo.ProductoVentaConfig WITH NOCHECK ADD CONSTRAINT CK_PVC_UM CHECK (UM IN ('u', 'm', 'm2'));
GO

-- ---------------------------------------------------------------------
-- Backfill: SOLO la primera vez (cuando ninguna fila tiene técnica principal todavía).
-- Confeccionados → SB con molde OBLIGATORIO (es lo que el sistema asumía hasta hoy).
-- Combos y productos del local → sin técnica principal, molde NO.
-- VisibleTienda = lo que hoy está publicado en la tienda; VisibleInterno = 1 (hoy el interno ve todo).
-- ---------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.ProductoVentaConfig WHERE TecnicaPrincipal IS NOT NULL)
BEGIN
    UPDATE dbo.ProductoVentaConfig
       SET TecnicaPrincipal = 'SB', Molde = 'OBLIGATORIO'
     WHERE ISNULL(EsCombo, 0) = 0 AND OrigenTipo IN ('CONFECCIONADO', 'AMBOS', 'CLIENTE');

    UPDATE dbo.ProductoVentaConfig
       SET Molde = 'NO'
     WHERE ISNULL(EsCombo, 0) = 1 OR OrigenTipo = 'LOCAL';

    UPDATE dbo.ProductoVentaConfig SET VisibleInterno = 1, VisiblePortal = 0;

    IF OBJECT_ID('dbo.TiendaProductos', 'U') IS NOT NULL
        UPDATE vc SET VisibleTienda = ISNULL(tp.Publicado, 0)
          FROM dbo.ProductoVentaConfig vc
          LEFT JOIN dbo.TiendaProductos tp ON tp.ProIdProducto = vc.ProIdProducto;

    PRINT 'F1: backfill inicial aplicado (TecnicaPrincipal SB para confeccionados, Molde, visibilidad).';
END
ELSE
    PRINT 'F1: backfill ya aplicado antes, no se toca.';
GO

-- Verificación
SELECT TecnicaPrincipal, Molde, COUNT(*) AS Productos, SUM(CAST(VisibleTienda AS INT)) AS EnTienda, SUM(CAST(VisibleInterno AS INT)) AS EnInterno
  FROM dbo.ProductoVentaConfig GROUP BY TecnicaPrincipal, Molde ORDER BY TecnicaPrincipal, Molde;
GO

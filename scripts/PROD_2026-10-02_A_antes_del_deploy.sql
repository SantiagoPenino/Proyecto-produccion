/* ============================================================================
   PRODUCCIÓN — A) ANTES DEL DEPLOY del backend/frontend (02-oct-2026)
   Según el diagnóstico de producción del 02-oct: faltan 2b, 2c y 2e.
   Los tres son idempotentes (se pueden correr dos veces sin efecto) y solo AGREGAN:
   el backend que está hoy en producción sigue funcionando igual con esto corrido.
     2b  columnas de producción principal en ProductoVentaConfig (+ carga inicial la primera vez)
     2c  tabla ProductoAccesorios + columna WmsDepositoId en PedidosCobranzaDetalle
     2e  Areas.Entrega = TELA para DIRECTA y ECOUV (+ repara requisitos de tela ya recibidos en Corte)
   ============================================================================ */
USE [SecureAppDB];
GO

/* ████████████████████████████████████████████████████████████████████████████
   PASO 2b — docs/migrations/configurador_f1_produccion_principal.sql
   ████████████████████████████████████████████████████████████████████████████ */
PRINT '';
PRINT '=== PASO 2b: docs/migrations/configurador_f1_produccion_principal.sql ===';
GO
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
GO

/* ████████████████████████████████████████████████████████████████████████████
   PASO 2c — docs/migrations/configurador_accesorios.sql
   ████████████████████████████████████████████████████████████████████████████ */
PRINT '';
PRINT '=== PASO 2c: docs/migrations/configurador_accesorios.sql ===';
GO
-- =====================================================================================
-- Configurador · ACCESORIOS Y ESTRUCTURA de un producto fabricado (30-sep-2026)
-- Un producto fabricado (ej. windflag) puede llevar artículos de STOCK del WMS que salen
-- con él (mástil, base, funda…). Se cargan en el configurador, paso "Accesorios y estructura".
-- Tabla propia, separada de ProductoComboItems, para que un producto con accesorios NO se
-- trate como combo (explotarCombos, tienda, composición).
--   Obligatorio: 1 = siempre va · 0 = opcional, lo elige quien carga el pedido.
--   Cobro: INCLUIDO = dentro del precio del producto · APARTE = se cobra a precio de lista.
--   Cantidad: unidades del accesorio POR UNIDAD del producto (2 unidades de windflag × 1 = 2 mástiles).
-- Idempotente. Solo agrega; no toca nada existente.
-- =====================================================================================
SET NOCOUNT ON;

IF OBJECT_ID('dbo.ProductoAccesorios', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductoAccesorios (
        ID                INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto     INT NOT NULL,                       -- el producto fabricado (Articulos.ProIdProducto)
        ItemProIdProducto INT NOT NULL,                       -- el artículo de stock
        WmsVarianteId     INT NULL,                           -- variante fija; NULL = se elige al cargar el pedido
        Cantidad          INT NOT NULL DEFAULT 1,             -- por unidad del producto
        Obligatorio       BIT NOT NULL DEFAULT 1,
        Cobro             VARCHAR(10) NOT NULL DEFAULT 'INCLUIDO',
        Orden             INT NULL,
        CONSTRAINT CK_ProductoAccesorios_Cobro CHECK (Cobro IN ('INCLUIDO', 'APARTE')),
        INDEX IX_ProductoAccesorios_Prod (ProIdProducto)
    );
    PRINT 'ProductoAccesorios creada.';
END
ELSE
    PRINT 'ProductoAccesorios ya existía. Sin cambios.';

GO

-- ── Depósito del WMS de donde se retira cada accesorio ──────────────────────────────────
-- NULL = depósito de ventas (WMS_DEPOSITO_LOCAL_ID, hoy 5). Un mástil puede vivir en el Centro
-- de stock general (1) o en ECOUV (3): el configurador lo dice y la venta VEN- lo respeta.
IF COL_LENGTH('dbo.ProductoAccesorios', 'WmsDepositoId') IS NULL
    ALTER TABLE dbo.ProductoAccesorios ADD WmsDepositoId INT NULL;
-- La línea de la venta guarda de qué depósito sale, para que el descuento de stock (confirmar
-- retiro en Logística WMS) pegue en ese depósito y no siempre en el de ventas.
IF COL_LENGTH('dbo.PedidosCobranzaDetalle', 'WmsDepositoId') IS NULL
    ALTER TABLE dbo.PedidosCobranzaDetalle ADD WmsDepositoId INT NULL;
PRINT 'Columnas WmsDepositoId listas.';
GO

/* ████████████████████████████████████████████████████████████████████████████
   PASO 2e — docs/migrations/areas_entrega_directa_ecouv.sql
   ████████████████████████████████████████████████████████████████████████████ */
PRINT '';
PRINT '=== PASO 2e: docs/migrations/areas_entrega_directa_ecouv.sql ===';
GO
-- =====================================================================================
-- Impresión Directa / Gran formato entregan TELA (30-sep-2026)
-- El auto-cumplimiento del requisito "Tela para Corte" (TWC) al hacer check-in del bulto mira
-- Areas.Entrega del área de origen del remito. SB tiene 'TELA'; DIRECTA y ECOUV estaban en NULL,
-- así que la tela impresa llegaba a Corte y el requisito quedaba "Pendiente" (bloqueante) para
-- siempre. El código además tenía un fallback solo para SB (ya corregido).
-- 1) Configura Entrega = 'TELA' para DIRECTA y ECOUV.
-- 2) Repara lo ya recibido: órdenes de TWC con requisito TELA pendiente cuyo bulto de origen
--    (LiberaCuandoOrdenID, área DIRECTA/ECOUV) ya está EN_STOCK en TWC → CUMPLIDO.
-- Idempotente.
-- =====================================================================================
SET NOCOUNT ON;

UPDATE dbo.Areas SET Entrega = 'TELA'
WHERE LTRIM(RTRIM(AreaID)) IN ('DIRECTA', 'ECOUV') AND (Entrega IS NULL OR LTRIM(RTRIM(Entrega)) = '');
PRINT CONCAT('Areas.Entrega = TELA aplicado a: ', @@ROWCOUNT, ' área(s)');

-- Vista previa de la reparación
SELECT o.OrdenID, o.CodigoOrden, o.AreaID, org.CodigoOrden AS Origen, org.AreaID AS AreaOrigen,
       (SELECT COUNT(*) FROM dbo.Logistica_Bultos lb WHERE lb.OrdenID = org.OrdenID AND lb.UbicacionActual = o.AreaID AND lb.Estado = 'EN_STOCK') AS BultosEnArea
FROM dbo.Ordenes o
JOIN dbo.Ordenes org ON org.OrdenID = o.LiberaCuandoOrdenID
WHERE o.AreaID = 'TWC' AND org.AreaID IN ('DIRECTA', 'ECOUV')
  AND o.Estado NOT IN ('CANCELADO', 'Finalizado', 'Entregado')
  AND EXISTS (SELECT 1 FROM dbo.Logistica_Bultos lb WHERE lb.OrdenID = org.OrdenID AND lb.UbicacionActual = o.AreaID AND lb.Estado = 'EN_STOCK')
  AND NOT EXISTS (SELECT 1 FROM dbo.OrdenCumplimientoRequisitos c
                  JOIN dbo.ConfigRequisitosProduccion r ON r.RequisitoID = c.RequisitoID
                  WHERE c.OrdenID = o.OrdenID AND r.AreaID = 'TWC' AND r.CodigoRequisito = 'TELA' AND c.Estado = 'CUMPLIDO');

MERGE dbo.OrdenCumplimientoRequisitos AS target
USING (
    SELECT o.OrdenID, r.AreaID, r.RequisitoID,
           CONCAT('Recibido en TWC desde ', LTRIM(RTRIM(org.AreaID)), ' (', LTRIM(RTRIM(org.CodigoOrden)), ') — reparación areas_entrega_directa_ecouv.sql') AS Obs
    FROM dbo.Ordenes o
    JOIN dbo.Ordenes org ON org.OrdenID = o.LiberaCuandoOrdenID
    JOIN dbo.ConfigRequisitosProduccion r ON r.AreaID = 'TWC' AND r.CodigoRequisito = 'TELA'
    WHERE o.AreaID = 'TWC' AND org.AreaID IN ('DIRECTA', 'ECOUV')
      AND o.Estado NOT IN ('CANCELADO', 'Finalizado', 'Entregado')
      AND EXISTS (SELECT 1 FROM dbo.Logistica_Bultos lb WHERE lb.OrdenID = org.OrdenID AND lb.UbicacionActual = o.AreaID AND lb.Estado = 'EN_STOCK')
) AS source
ON (target.OrdenID = source.OrdenID AND target.RequisitoID = source.RequisitoID)
WHEN MATCHED AND target.Estado <> 'CUMPLIDO' THEN
    UPDATE SET Estado = 'CUMPLIDO', FechaCumplimiento = GETDATE(), Observaciones = source.Obs
WHEN NOT MATCHED THEN
    INSERT (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
    VALUES (source.OrdenID, source.AreaID, source.RequisitoID, 'CUMPLIDO', GETDATE(), source.Obs);
PRINT CONCAT('Requisitos TELA de Corte reparados: ', @@ROWCOUNT);
GO

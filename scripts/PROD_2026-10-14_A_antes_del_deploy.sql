/* ============================================================================
   PRODUCCIÓN — A) ANTES DEL DEPLOY del backend/frontend (14-oct-2026)
   Según el diagnóstico de producción del 14-oct (scripts/diagnostico_prod_configurador_14oct.sql).
   Todos idempotentes (se pueden correr dos veces sin efecto) y solo AGREGAN o completan:
   el backend que está hoy en producción sigue funcionando igual con esto corrido.
     1  accesorios de stock (2c): tabla ProductoAccesorios + WmsDepositoId
     2  Areas.Entrega = TELA para DIRECTA y ECOUV (2e) + repara requisitos de tela ya recibidos en Corte
     3  variantes por modelo: completa el script (borra TecnicasPropias/SeccionesPropias, que quedaron de un diseño descartado)
     4  pedidos que arma el cliente desde la tienda: SolicitudesVendedor.Origen + PortalConfirmado
     5  productos a medida: ProductoVentaConfig.AMedidaJson
     6  archivos de impresión por producto: ProductoVentaConfig.TizadaMesasModo
     7  avíos por talle: ProductoAvios.VariaPorTalle + ProductoAviosTalle + AvioID en los pasos de costura
   Después del deploy: scripts/PROD_2026-10-02_B_despues_del_deploy.sql (requisitos 2f y 2g), que sigue vigente.
   ============================================================================ */
USE [SecureAppDB];
GO

/* ████████████████████████████████████████████████████████████████████████████
   PASO 1 (2c) — docs/migrations/configurador_accesorios.sql
   ████████████████████████████████████████████████████████████████████████████ */
PRINT '';
PRINT '=== PASO 1 (2c): docs/migrations/configurador_accesorios.sql ===';
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
   PASO 2 (2e) — docs/migrations/areas_entrega_directa_ecouv.sql
   ████████████████████████████████████████████████████████████████████████████ */
PRINT '';
PRINT '=== PASO 2 (2e): docs/migrations/areas_entrega_directa_ecouv.sql ===';
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

/* ████████████████████████████████████████████████████████████████████████████
   PASO 3 — docs/migrations/configurador_variantes.sql
   ████████████████████████████████████████████████████████████████████████████ */
PRINT '';
PRINT '=== PASO 3: docs/migrations/configurador_variantes.sql ===';
GO
/* ══════════════════════════════════════════════════════════════════════════
   CONFIGURADOR DE PRODUCTOS — PRODUCTO PADRE Y VARIANTES (12-oct-2026)
   ══════════════════════════════════════════════════════════════════════════
   Árbol:  Familia → Etiqueta → PRODUCTO PADRE → VARIANTES
   Ej.:    Camisetas → Básquet → Camiseta Basket (CAM-BAS-01)
                                   ├ Cuello Redondo Costadillo Grueso (CAM-BAS-01-01)
                                   └ Cuello V Común Costadillo Fino    (CAM-BAS-01-02)

   - El PADRE es un producto común: molde de TizadaPro, telas, técnicas, apliques,
     accesorios, ficha, avíos, costuras y precio base.
   - Cada VARIANTE es un ARTÍCULO más (su código, su nombre, su foto, su estado),
     que apunta a su padre y a UN modelo del molde del padre. Nace como COPIA del
     padre (técnicas, telas, apliques, accesorios, ficha, avíos, costuras, precio)
     y después se edita como cualquier artículo. El molde, el modelo y la
     producción principal son los del padre y no se cambian. Las técnicas, sus
     opciones, las telas y los accesorios solo pueden ser de los que tiene el padre.

   Qué hace (idempotente, no borra datos de producción):
     A. ProductoVentaConfig.PadreProIdProducto  (NULL = no es variante)
     B. ProductoVentaConfig.ModeloClave         (modelo del molde del padre)
     C. Limpieza de columnas de versiones anteriores (solo existían en LOCAL).
     D. Índice único: un modelo del padre = una sola variante.
     E. Verificación.

   Orden de deploy: correr ESTE script ANTES del backend. El backend tolera que
   falte: sin las columnas no muestra el paso "Variantes".
   Correrlo dos veces no cambia nada la segunda vez.
   ══════════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
GO

/* ── A. Padre de la variante ───────────────────────────────────────────── */
IF COL_LENGTH('dbo.ProductoVentaConfig', 'PadreProIdProducto') IS NULL
BEGIN
    ALTER TABLE dbo.ProductoVentaConfig ADD PadreProIdProducto INT NULL;
    PRINT 'A. Columna ProductoVentaConfig.PadreProIdProducto agregada.';
END
ELSE PRINT 'A. ProductoVentaConfig.PadreProIdProducto ya existía.';
GO

/* ── B. Modelo del molde que es esta variante ──────────────────────────── */
IF COL_LENGTH('dbo.ProductoVentaConfig', 'ModeloClave') IS NULL
BEGIN
    ALTER TABLE dbo.ProductoVentaConfig ADD ModeloClave NVARCHAR(96) NULL;
    PRINT 'B. Columna ProductoVentaConfig.ModeloClave agregada.';
END
ELSE PRINT 'B. ProductoVentaConfig.ModeloClave ya existía.';
GO

/* ── C. Limpieza de versiones anteriores (solo se corrieron en LOCAL el 12-oct) ── */
IF COL_LENGTH('dbo.ProductoVentaConfig', 'TecnicasPropias') IS NOT NULL
BEGIN
    IF OBJECT_ID('dbo.DF_ProductoVentaConfig_TecnicasPropias', 'D') IS NOT NULL
        ALTER TABLE dbo.ProductoVentaConfig DROP CONSTRAINT DF_ProductoVentaConfig_TecnicasPropias;
    ALTER TABLE dbo.ProductoVentaConfig DROP COLUMN TecnicasPropias;
    PRINT 'C. Se quitó TecnicasPropias (versión anterior).';
END
IF COL_LENGTH('dbo.ProductoVentaConfig', 'SeccionesPropias') IS NOT NULL
BEGIN
    ALTER TABLE dbo.ProductoVentaConfig DROP COLUMN SeccionesPropias;
    PRINT 'C. Se quitó SeccionesPropias (versión anterior).';
END
GO

/* ── D. Un modelo del padre = una sola variante ────────────────────────── */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ProductoVentaConfig_PadreModelo' AND object_id = OBJECT_ID('dbo.ProductoVentaConfig'))
BEGIN
    CREATE UNIQUE INDEX UQ_ProductoVentaConfig_PadreModelo
        ON dbo.ProductoVentaConfig (PadreProIdProducto, ModeloClave)
        WHERE PadreProIdProducto IS NOT NULL;
    PRINT 'D. Índice único UQ_ProductoVentaConfig_PadreModelo creado.';
END
ELSE PRINT 'D. UQ_ProductoVentaConfig_PadreModelo ya existía.';
GO

/* ── E. Verificación ───────────────────────────────────────────────────── */
SELECT
    CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'PadreProIdProducto') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS PadreProIdProducto,
    CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'ModeloClave')        IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS ModeloClave,
    CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ProductoVentaConfig_PadreModelo') THEN 'OK' ELSE 'FALTA' END AS IndiceUnico;
GO
GO

/* ████████████████████████████████████████████████████████████████████████████
   PASO 4 — scripts/add_solicitudes_portal.sql
   ████████████████████████████████████████████████████████████████████████████ */
PRINT '';
PRINT '=== PASO 4: scripts/add_solicitudes_portal.sql ===';
GO
/* ============================================================================
   add_solicitudes_portal.sql
   Pedidos que arma el CLIENTE desde la Tienda del portal (autogestión) con un producto que tiene
   molde de TIZADA PRO: el cliente sube el arte, elige la tela, carga la lista de jugadores y el arte
   de los extras; al confirmar sale solo a TIZADA PRO y, cuando vuelve la tizada, el pedido se arma solo.

   Por dentro es una Solicitud más (dbo.SolicitudesVendedor): así usa las mismas piezas y telas, la
   misma lista de talles, los mismos editables, el mismo envío a TIZADA y la misma conversión a pedido.
   El vendedor la ve en Ventas › Solicitudes con la marca "Portal" (queda a nombre del asesor del cliente).

   Se puede correr más de una vez. Agrega DOS columnas a dbo.SolicitudesVendedor y no toca datos:
     Origen           'VENDEDOR' (todas las que existen) | 'PORTAL' (las que arma el cliente)
     PortalConfirmado cuándo el cliente tocó "Confirmar pedido". NULL = todavía la está armando
                      (borrador: no aparece en la lista de Solicitudes del vendedor).
   ============================================================================ */
SET NOCOUNT ON;

IF COL_LENGTH('dbo.SolicitudesVendedor', 'Origen') IS NULL
BEGIN
  ALTER TABLE dbo.SolicitudesVendedor ADD Origen varchar(10) NOT NULL
    CONSTRAINT DF_SolVen_Origen DEFAULT ('VENDEDOR') WITH VALUES;
  PRINT 'Columna SolicitudesVendedor.Origen agregada (todas las existentes quedan en VENDEDOR)';
END

IF OBJECT_ID('dbo.CK_SolVen_Origen', 'C') IS NULL
BEGIN
  EXEC('ALTER TABLE dbo.SolicitudesVendedor ADD CONSTRAINT CK_SolVen_Origen CHECK (Origen IN (''VENDEDOR'', ''PORTAL''))');
  PRINT 'Restricción CK_SolVen_Origen creada';
END

IF COL_LENGTH('dbo.SolicitudesVendedor', 'PortalConfirmado') IS NULL
BEGIN
  ALTER TABLE dbo.SolicitudesVendedor ADD PortalConfirmado datetime NULL;
  PRINT 'Columna SolicitudesVendedor.PortalConfirmado agregada';
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SolVen_Portal' AND object_id = OBJECT_ID('dbo.SolicitudesVendedor'))
BEGIN
  EXEC('CREATE INDEX IX_SolVen_Portal ON dbo.SolicitudesVendedor (Origen, CodCliente, Estado) INCLUDE (PortalConfirmado)');
  PRINT 'Índice IX_SolVen_Portal creado';
END

PRINT 'add_solicitudes_portal.sql: OK';
GO

/* ████████████████████████████████████████████████████████████████████████████
   PASO 5 — docs/migrations/configurador_a_medida.sql
   ████████████████████████████████████████████████████████████████████████████ */
PRINT '';
PRINT '=== PASO 5: docs/migrations/configurador_a_medida.sql ===';
GO
/* ══════════════════════════════════════════════════════════════════════════
   CONFIGURADOR DE PRODUCTOS — PRODUCTOS A MEDIDA DE TIZADA PRO (13-oct-2026)
   ══════════════════════════════════════════════════════════════════════════
   Pañuelos, toallas, banderas, banderines: UNA pieza sin talles cuya medida la
   dice cada pedido. TIZADA PRO arma el molde con esa medida (le suma el margen
   para coser) y marca dónde van las tiras.

   El producto queda vinculado a una VARIABLE a medida de TIZADA (GET /variables
   la trae con el bloque "a_medida") y guarda qué ofrece de ella:
     formas permitidas y por defecto, punta del triángulo, terminación del borde,
     medida libre (mínimo/máximo) o medidas fijas, telas, tiras por defecto.

   Qué hace (idempotente, no borra nada):
     A. ProductoVentaConfig.AMedidaJson  NVARCHAR(MAX) NULL  (NULL = no es a medida)
     B. Verificación.

   Orden de deploy: correr ESTE script ANTES del backend. El backend tolera que
   falte: sin la columna no muestra la sección "A medida".
   ══════════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
GO

/* A. Columna */
IF COL_LENGTH('dbo.ProductoVentaConfig', 'AMedidaJson') IS NULL
BEGIN
    ALTER TABLE dbo.ProductoVentaConfig ADD AMedidaJson NVARCHAR(MAX) NULL;
    PRINT 'A. ProductoVentaConfig.AMedidaJson creada.';
END
ELSE PRINT 'A. ProductoVentaConfig.AMedidaJson ya existía.';
GO

/* B. Verificación */
SELECT CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'AMedidaJson') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS AMedidaJson,
       (SELECT COUNT(*) FROM dbo.ProductoVentaConfig WHERE AMedidaJson IS NOT NULL) AS ProductosAMedida;
GO
GO

/* ████████████████████████████████████████████████████████████████████████████
   PASO 6 — docs/migrations/configurador_tizadapro_mesas.sql
   ████████████████████████████████████████████████████████████████████████████ */
PRINT '';
PRINT '=== PASO 6: docs/migrations/configurador_tizadapro_mesas.sql ===';
GO
/* ══════════════════════════════════════════════════════════════════════════
   CONFIGURADOR DE PRODUCTOS — CÓMO ARMA TIZADA PRO LOS ARCHIVOS (14-oct-2026)
   ══════════════════════════════════════════════════════════════════════════
   Por producto, cómo pide la tizada (mesas.modo del pedido a TIZADA PRO):
     NULL           = automático: lo del .env (a medida: TIZADAPRO_MESAS_MODO_A_MEDIDA;
                      prendas: TIZADAPRO_MESAS_MODO)
     'normal'       = TIZADA acomoda todo: un archivo por mesa (las mesas iguales salen repetidas)
     'una_por_fila' = un archivo por fila de la lista (por diseño, en los productos a medida)
                      y la cantidad vuelve como COPIAS de ese archivo (ej. 1 archivo × 15)

   Qué hace (idempotente, no borra nada):
     A. ProductoVentaConfig.TizadaMesasModo VARCHAR(20) NULL
     B. Verificación.

   Orden de deploy: correr ESTE script ANTES del backend. Sin la columna el backend
   sigue con lo del .env y el configurador no muestra la opción.
   ══════════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
GO

IF COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaMesasModo') IS NULL
BEGIN
    ALTER TABLE dbo.ProductoVentaConfig ADD TizadaMesasModo VARCHAR(20) NULL;
    PRINT 'A. ProductoVentaConfig.TizadaMesasModo creada.';
END
ELSE PRINT 'A. ProductoVentaConfig.TizadaMesasModo ya existía.';
GO

SELECT CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaMesasModo') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS TizadaMesasModo,
       (SELECT COUNT(*) FROM dbo.ProductoVentaConfig WHERE TizadaMesasModo IS NOT NULL) AS ProductosConModo;
GO
GO

/* ████████████████████████████████████████████████████████████████████████████
   PASO 7 — docs/migrations/configurador_ficha_avios_talle.sql
   ████████████████████████████████████████████████████████████████████████████ */
PRINT '';
PRINT '=== PASO 7: docs/migrations/configurador_ficha_avios_talle.sql ===';
GO
-- ════════════════════════════════════════════════════════════════════
--  CONFIGURADOR — Ficha técnica: avíos por talle y avío de cada paso (09-oct-2026)
-- ════════════════════════════════════════════════════════════════════
--  Primera parte de la propuesta "Mejoras para las fichas técnicas del ERP" (07-oct).
--
--  Antes: la medida de un avío era texto libre ("S–M 55 cm · L–XXL 60 cm") y cada
--  paso de costura no decía qué avío usa.
--  Ahora:
--    A. dbo.ProductoAvios + VariaPorTalle: el avío es "medida única" (como hasta
--       ahora: Cantidad + Medida) o varía por talle.
--    B. dbo.ProductoAviosTalle (NUEVA): el valor de cada talle. Según la unidad
--       del avío en el catálogo (dbo.CatalogoAvios.Unidad), el valor es la medida
--       (m, cm) o la cantidad (u, par). AvioID, si viene, es el artículo de ese
--       talle cuando cambia (cierre de 15 cm en S–M, de 18 cm en L–XXL).
--       Cuelga del producto + el Orden de la línea en ProductoAvios: las filas de
--       ProductoAvios se borran y se vuelven a crear en cada Guardar (cambian de
--       ID, el Orden no). Orden = posición del talle en el molde, para imprimir.
--    C. dbo.ProductoFichaDisenoCosturas + AvioID: el avío que usa el paso (al
--       catálogo, no a la línea del producto, por lo mismo de arriba).
--
--  Los talles se guardan por nombre, tal como vienen del molde de TizadaPro.
--  Los avíos son informativos (ficha, PDF, bandeja de Costura): no mueven stock.
--
--  Idempotente: se puede correr más de una vez. El backend funciona ANTES y
--  DESPUÉS de correrlo (detecta las columnas y la tabla nuevas).
-- ════════════════════════════════════════════════════════════════════

-- ── A. Avío por talle o medida única ───────────────────────────────
IF COL_LENGTH('dbo.ProductoAvios', 'VariaPorTalle') IS NULL
    ALTER TABLE dbo.ProductoAvios
        ADD VariaPorTalle BIT NOT NULL CONSTRAINT DF_ProductoAvios_VariaPorTalle DEFAULT 0;
GO

-- ── B. Valor de cada talle ─────────────────────────────────────────
IF OBJECT_ID('dbo.ProductoAviosTalle', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductoAviosTalle (
        ID            INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto INT            NOT NULL,
        AvioOrden     INT            NOT NULL,   -- ProductoAvios.Orden de la línea
        Talle         NVARCHAR(96)   NOT NULL,   -- como en TizadaProMoldePiezas.Talle
        Valor         DECIMAL(10, 2) NULL,       -- medida (m, cm) o cantidad (u, par), según CatalogoAvios.Unidad
        AvioID        INT            NULL,       -- artículo de ese talle si cambia (NULL = el de la línea)
        Orden         INT            NULL,       -- posición del talle en el molde
        CONSTRAINT UQ_ProductoAviosTalle UNIQUE (ProIdProducto, AvioOrden, Talle),
        INDEX IX_ProductoAviosTalle_Producto (ProIdProducto)
    );
    PRINT 'Tabla ProductoAviosTalle creada.';
END
GO

-- ── C. Avío que usa cada paso de costura ───────────────────────────
IF COL_LENGTH('dbo.ProductoFichaDisenoCosturas', 'AvioID') IS NULL
    ALTER TABLE dbo.ProductoFichaDisenoCosturas ADD AvioID INT NULL;
GO

IF OBJECT_ID('dbo.CatalogoAvios', 'U') IS NOT NULL
   AND OBJECT_ID('dbo.FK_ProdFDCosturas_Avio', 'F') IS NULL
    ALTER TABLE dbo.ProductoFichaDisenoCosturas
        ADD CONSTRAINT FK_ProdFDCosturas_Avio FOREIGN KEY (AvioID) REFERENCES dbo.CatalogoAvios (AvioID);
GO

IF OBJECT_ID('dbo.CatalogoAvios', 'U') IS NOT NULL
   AND OBJECT_ID('dbo.FK_ProdAviosTalle_Avio', 'F') IS NULL
    ALTER TABLE dbo.ProductoAviosTalle
        ADD CONSTRAINT FK_ProdAviosTalle_Avio FOREIGN KEY (AvioID) REFERENCES dbo.CatalogoAvios (AvioID);
GO

-- Verificación
SELECT COL_LENGTH('dbo.ProductoAvios', 'VariaPorTalle')             AS ProductoAvios_VariaPorTalle,
       OBJECT_ID('dbo.ProductoAviosTalle', 'U')                       AS ProductoAviosTalle,
       COL_LENGTH('dbo.ProductoFichaDisenoCosturas', 'AvioID')        AS Costuras_AvioID;
GO

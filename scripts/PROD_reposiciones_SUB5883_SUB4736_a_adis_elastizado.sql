-- ============================================================================
-- PROD_reposiciones_SUB5883_SUB4736_a_adis_elastizado.sql  (v2 - con COMMIT)
-- ----------------------------------------------------------------------------
-- Pedido (12-oct-2026): las reposiciones SUB-5883-R1 y SUB-4736-R1 nacieron con
-- NeoStretch (1,83) (la -R clona el material de la madre) y el material correcto
-- es Adis Elastizado (1,83).
--
-- Qué hace, solo sobre esas dos -R:
--   - Ordenes: Material, CodArticulo, ProIdProducto e IdProductoReact pasan a los
--     del artículo Adis Elastizado (1,83).
--   - OrdenesDeposito: si alguna ya estuviera ingresada, le cambia ProIdProducto.
--   - PedidosCobranzaDetalle: si tienen línea SIN importe, le cambia CodArticulo /
--     ProIdProducto. Las líneas con importe NO se tocan (se avisa por PRINT).
-- NO toca las madres (SUB-5883 / SUB-4736, finalizadas), ni importes, ni la
-- bobina o el lote asignados (se muestran en el ANTES para revisarlos a mano).
--
-- v2: termina en COMMIT. Todo va en TRY/CATCH con XACT_ABORT: ante cualquier
-- error hace ROLLBACK solo y no deja la transacción abierta. No arranca si la
-- ventana ya tiene una transacción abierta. Si las órdenes ya están en Adis
-- Elastizado, avisa y no hace nada (se puede volver a correr sin riesgo).
--
-- Uso: correr el script COMPLETO (sin seleccionar líneas).
-- ============================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF @@TRANCOUNT > 0
BEGIN
    RAISERROR('Esta ventana ya tiene una transacción abierta (@@TRANCOUNT > 0). Cerrarla con ROLLBACK antes de correr el script.', 16, 1);
    RETURN;
END

DECLARE @Ordenes TABLE (CodigoOrden NVARCHAR(100) PRIMARY KEY);
INSERT INTO @Ordenes VALUES (N'SUB-5883-R1'), (N'SUB-4736-R1');

-- Artículo destino. Si queda NULL se busca por descripción exacta (tiene que haber uno solo).
-- Si el script corta acá, elegir el ProIdProducto correcto de la lista de candidatos.
DECLARE @ProIdNuevo INT = NULL;

DECLARE @Ids TABLE (OrdenID INT PRIMARY KEY);
DECLARE @Pend INT, @n INT;

BEGIN TRY
    -- 0) Candidatos del artículo destino
    SELECT ProIdProducto, IDProdReact, LTRIM(RTRIM(CodArticulo)) AS CodArticulo,
           LTRIM(RTRIM(CodStock)) AS CodStock, LTRIM(RTRIM(Descripcion)) AS Descripcion
    FROM Articulos
    WHERE Descripcion LIKE N'%Adis Elastizado%'
    ORDER BY ProIdProducto;

    IF @ProIdNuevo IS NULL
    BEGIN
        IF (SELECT COUNT(*) FROM Articulos WHERE LTRIM(RTRIM(Descripcion)) = N'Adis Elastizado (1,83)') <> 1
            THROW 50001, N'No hay exactamente un artículo "Adis Elastizado (1,83)". Elegir de la lista y cargarlo en @ProIdNuevo.', 1;
        SELECT @ProIdNuevo = ProIdProducto FROM Articulos WHERE LTRIM(RTRIM(Descripcion)) = N'Adis Elastizado (1,83)';
    END

    IF NOT EXISTS (SELECT 1 FROM Articulos WHERE ProIdProducto = @ProIdNuevo)
        THROW 50002, N'@ProIdNuevo no existe en Articulos.', 1;

    INSERT INTO @Ids
    SELECT o.OrdenID FROM Ordenes o JOIN @Ordenes x ON x.CodigoOrden = o.CodigoOrden;

    IF (SELECT COUNT(*) FROM @Ids) <> 2
        THROW 50003, N'No se encontraron las 2 órdenes (revisar los códigos).', 1;

    -- Órdenes que todavía no tienen el artículo nuevo
    SELECT @Pend = COUNT(*)
    FROM Ordenes o JOIN @Ids i ON i.OrdenID = o.OrdenID
    WHERE ISNULL(o.ProIdProducto, -1) <> @ProIdNuevo;

    IF @Pend = 0
    BEGIN
        PRINT 'Las 2 órdenes ya tienen Adis Elastizado (1,83). No hay nada para hacer.';
        SELECT o.OrdenID, o.CodigoOrden, o.Material, o.CodArticulo, o.ProIdProducto, o.IdProductoReact
        FROM Ordenes o JOIN @Ids i ON i.OrdenID = o.OrdenID
        ORDER BY o.CodigoOrden;
        RETURN;
    END

    BEGIN TRAN;

    -- ANTES
    SELECT o.OrdenID, o.CodigoOrden, o.AreaID, o.Estado, o.EstadoenArea,
           o.Material, o.CodArticulo, o.ProIdProducto, o.IdProductoReact, o.Variante,
           RTRIM(a.Descripcion) AS DescArticuloActual,
           o.RolloID, o.BobinaTelaID, o.CostoTotal
    FROM Ordenes o
    JOIN @Ids i            ON i.OrdenID = o.OrdenID
    LEFT JOIN Articulos a  ON a.ProIdProducto = o.ProIdProducto
    ORDER BY o.CodigoOrden;

    SELECT 'Deposito' AS Tabla, od.OrdIdOrden, od.OrdCodigoOrden, od.ProIdProducto
    FROM OrdenesDeposito od JOIN @Ordenes x ON x.CodigoOrden = od.OrdCodigoOrden;

    SELECT 'Cobranza' AS Tabla, d.PedidoCobranzaID, d.OrdenID, d.CodArticulo, d.ProIdProducto, d.Cantidad, d.PrecioUnitario, d.Subtotal
    FROM PedidosCobranzaDetalle d JOIN @Ids i ON i.OrdenID = d.OrdenID;

    -- 1) Ordenes (solo las pendientes, y solo si hoy están en NeoStretch)
    UPDATE o
    SET o.Material        = LTRIM(RTRIM(a.Descripcion)),
        o.CodArticulo     = LTRIM(RTRIM(a.CodArticulo)),
        o.ProIdProducto   = a.ProIdProducto,
        o.IdProductoReact = a.IDProdReact
    FROM Ordenes o
    JOIN @Ids i      ON i.OrdenID = o.OrdenID
    JOIN Articulos a ON a.ProIdProducto = @ProIdNuevo
    WHERE ISNULL(o.ProIdProducto, -1) <> @ProIdNuevo
      AND o.Material LIKE N'%NeoStretch%';

    SET @n = @@ROWCOUNT;
    PRINT CONCAT('Ordenes corregidas: ', @n, ' (esperado: ', @Pend, ')');
    IF @n <> @Pend
        THROW 50004, N'Alguna orden pendiente no está en NeoStretch: no se cambió nada (ROLLBACK).', 1;

    -- 2) Depósito (si ya estuvieran ingresadas)
    UPDATE od
    SET od.ProIdProducto = @ProIdNuevo
    FROM OrdenesDeposito od
    JOIN @Ordenes x ON x.CodigoOrden = od.OrdCodigoOrden
    WHERE ISNULL(od.ProIdProducto, -1) <> @ProIdNuevo;
    PRINT CONCAT('OrdenesDeposito corregidas: ', @@ROWCOUNT);

    -- 3) Cobranza: solo líneas sin importe (las -R nacen con costo 0)
    UPDATE d
    SET d.CodArticulo   = LTRIM(RTRIM(a.CodArticulo)),
        d.ProIdProducto = a.ProIdProducto
    FROM PedidosCobranzaDetalle d
    JOIN @Ids i      ON i.OrdenID = d.OrdenID
    JOIN Articulos a ON a.ProIdProducto = @ProIdNuevo
    WHERE ISNULL(d.Subtotal, 0) = 0
      AND ISNULL(d.ProIdProducto, -1) <> @ProIdNuevo;
    PRINT CONCAT('PedidosCobranzaDetalle corregidas (sin importe): ', @@ROWCOUNT);

    IF EXISTS (SELECT 1 FROM PedidosCobranzaDetalle d JOIN @Ids i ON i.OrdenID = d.OrdenID WHERE ISNULL(d.Subtotal, 0) <> 0)
        PRINT 'ATENCION: hay líneas de cobranza CON importe para estas órdenes; no se tocaron (revisar precio a mano).';

    -- DESPUÉS (las 2 con Adis Elastizado (1,83))
    SELECT o.OrdenID, o.CodigoOrden, o.Material, o.CodArticulo, o.ProIdProducto, o.IdProductoReact,
           RTRIM(a.Descripcion) AS DescArticulo
    FROM Ordenes o
    JOIN @Ids i           ON i.OrdenID = o.OrdenID
    LEFT JOIN Articulos a ON a.ProIdProducto = o.ProIdProducto
    ORDER BY o.CodigoOrden;

    COMMIT TRAN;
    PRINT 'OK: cambios guardados (COMMIT).';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT 'ERROR: no se guardó nada (ROLLBACK).';
    THROW;
END CATCH;

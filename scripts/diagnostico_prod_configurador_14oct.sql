/* ============================================================================
   DIAGNÓSTICO PRODUCCIÓN — configurador + flujo de prendas, al 14-oct-2026
   SOLO LECTURA: no crea, no modifica ni borra nada. Correr entero en SSMS.
   Cada fila dice qué script es y si su huella ya está en la base.
     OK      = ya está
     FALTA   = hay que correr ese script
     REVISAR = mirar el detalle
   Columna Cuando: si el script va ANTES o DESPUÉS del deploy del backend.
   Reemplaza al diagnóstico del 01-oct: suma todo lo de octubre (costuras paso a
   paso, avíos por talle, variantes por modelo, a medida, mesas TIZADA, pedidos
   desde la tienda, envíos a TIZADA, usuario de lectura de TizadaPro).
   ============================================================================ */
USE [SecureAppDB];
SET NOCOUNT ON;

DECLARE @r TABLE (Orden INT, Script NVARCHAR(130), Chequeo NVARCHAR(220), Estado VARCHAR(10), Cuando VARCHAR(22), Detalle NVARCHAR(400));
DECLARE @n INT;

/* ─────────────── 02-oct: pendientes de antes ─────────────── */
INSERT @r SELECT 10, 'docs/migrations/configurador_f1_produccion_principal.sql (2b)', 'ProductoVentaConfig: TecnicaPrincipal, AnchoM, AltoM, UM, Molde, Visible*',
    CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','TecnicaPrincipal') IS NOT NULL AND COL_LENGTH('dbo.ProductoVentaConfig','Molde') IS NOT NULL
              AND COL_LENGTH('dbo.ProductoVentaConfig','VisibleTienda') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES', '';
INSERT @r SELECT 11, 'docs/migrations/configurador_accesorios.sql (2c)', 'Tabla ProductoAccesorios + WmsDepositoId (también en PedidosCobranzaDetalle)',
    CASE WHEN OBJECT_ID('dbo.ProductoAccesorios','U') IS NOT NULL AND COL_LENGTH('dbo.ProductoAccesorios','WmsDepositoId') IS NOT NULL
              AND COL_LENGTH('dbo.PedidosCobranzaDetalle','WmsDepositoId') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES',
    N'sin esto el paso "Cantidad y accesorios" del configurador guarda vacío y los pedidos no generan accesorios';
SELECT @n = COUNT(*) FROM dbo.Areas WHERE LTRIM(RTRIM(AreaID)) IN ('DIRECTA','ECOUV') AND LTRIM(RTRIM(ISNULL(Entrega,''))) = 'TELA';
INSERT @r SELECT 12, 'docs/migrations/areas_entrega_directa_ecouv.sql (2e)', 'Areas.Entrega = TELA para DIRECTA y ECOUV',
    CASE WHEN @n >= 2 THEN 'OK' ELSE 'FALTA' END, 'ANTES o DESPUÉS', CONCAT(@n, ' de 2 áreas');
SELECT @n = COUNT(*) FROM dbo.ConfigRequisitosProduccion WHERE AreaID = 'PRO' AND CodigoRequisito = 'ACCESORIOS';
INSERT @r SELECT 13, 'docs/migrations/requisito_accesorios_pro.sql (2f)', 'Requisito PRO / ACCESORIOS',
    CASE WHEN @n > 0 THEN 'OK' ELSE 'FALTA' END, 'DESPUÉS', N'con el backend viejo aparecería "Pendiente" en todas las órdenes PRO';
SELECT @n = COUNT(*) FROM dbo.ConfigRequisitosProduccion WHERE AreaID = 'EST' AND CodigoRequisito = 'TPU';
INSERT @r SELECT 14, 'docs/migrations/requisito_tpu_estampado.sql (2g)', 'Requisito EST / TPU ("TPU a Estampar")',
    CASE WHEN @n > 0 THEN 'OK' ELSE 'FALTA' END, 'DESPUÉS', N'con el backend viejo los Estampados de TPU quedarían trabados';
SELECT @n = COUNT(*) FROM dbo.ConfigRequisitosProduccion WHERE AreaID = 'EST' AND Descripcion = 'Prendas a Etampar';
INSERT @r SELECT 15, 'docs/migrations/requisito_tpu_estampado.sql (2g)', 'Texto "Prendas a Etampar" corregido',
    CASE WHEN @n = 0 THEN 'OK' ELSE 'FALTA' END, 'DESPUÉS', '';
INSERT @r SELECT 16, 'scripts/PROD_2026-10-02_A_antes_del_deploy.sql', 'Resumen: A = 2b + 2c + 2e  ·  B = 2f + 2g',
    'REVISAR', 'A antes · B después', N'si arriba dice FALTA, correr A antes del deploy y B después (los dos son idempotentes)';

/* ─────────────── 05-oct: costuras paso a paso + envíos a TIZADA ─────────────── */
INSERT @r SELECT 20, 'docs/migrations/configurador_costuras_paso_a_paso.sql', 'Tabla MaquinasCostura (tipos de máquina)',
    CASE WHEN OBJECT_ID('dbo.MaquinasCostura','U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES o DESPUÉS', '';
INSERT @r SELECT 21, 'docs/migrations/configurador_costuras_paso_a_paso.sql', 'CosturasISO: Descripcion, ImagenUrl, MaquinaCosturaID',
    CASE WHEN COL_LENGTH('dbo.CosturasISO','Descripcion') IS NOT NULL AND COL_LENGTH('dbo.CosturasISO','MaquinaCosturaID') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES o DESPUÉS', '';
INSERT @r SELECT 22, 'docs/migrations/configurador_costuras_paso_a_paso.sql', 'ProductoFichaDisenoCosturas: Etapa(60), Descripcion, MaquinaCosturaID, TiempoMin, Observaciones, ImagenUrl; CodigoISO acepta NULL',
    CASE WHEN COL_LENGTH('dbo.ProductoFichaDisenoCosturas','Etapa') IS NULL OR COL_LENGTH('dbo.ProductoFichaDisenoCosturas','TiempoMin') IS NULL THEN 'FALTA'
         WHEN COL_LENGTH('dbo.ProductoFichaDisenoCosturas','Etapa') < 60 THEN 'REVISAR'
         WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ProductoFichaDisenoCosturas' AND COLUMN_NAME = 'CodigoISO' AND IS_NULLABLE = 'NO') THEN 'REVISAR'
         ELSE 'OK' END, 'ANTES o DESPUÉS',
    CASE WHEN COL_LENGTH('dbo.ProductoFichaDisenoCosturas','Etapa') IS NOT NULL AND COL_LENGTH('dbo.ProductoFichaDisenoCosturas','Etapa') < 60 THEN N'Etapa es más corta que 60: volver a correr el script (la agranda)'
         WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ProductoFichaDisenoCosturas' AND COLUMN_NAME = 'CodigoISO' AND IS_NULLABLE = 'NO') THEN N'CodigoISO sigue obligatorio: no se pueden guardar pasos sin costura'
         ELSE '' END;
INSERT @r SELECT 23, 'scripts/add_tizadapro_envios.sql', 'Tabla TizadaProEnvios (registro de envíos a TIZADA)',
    CASE WHEN OBJECT_ID('dbo.TizadaProEnvios','U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES', N'sin la tabla no se puede enviar a TIZADA desde la solicitud';
INSERT @r SELECT 24, 'docs/migrations/cargar_pasos_costura_*.sql (opcional)', 'Datos: pasos de costura cargados en algún producto',
    CASE WHEN OBJECT_ID('dbo.MaquinasCostura','U') IS NULL THEN 'REVISAR' ELSE 'OK' END, 'DESPUÉS', N'son cargas de ejemplo (windflag pluma, camiseta básquet); solo si querés esos datos. Requieren el script de paso a paso';

/* ─────────────── 09-oct: avíos por talle ─────────────── */
INSERT @r SELECT 30, 'docs/migrations/configurador_ficha_avios_talle.sql', 'ProductoAvios.VariaPorTalle + tabla ProductoAviosTalle + ProductoFichaDisenoCosturas.AvioID',
    CASE WHEN COL_LENGTH('dbo.ProductoAvios','VariaPorTalle') IS NOT NULL AND OBJECT_ID('dbo.ProductoAviosTalle','U') IS NOT NULL
              AND COL_LENGTH('dbo.ProductoFichaDisenoCosturas','AvioID') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES o DESPUÉS',
    N'el backend funciona antes y después (detecta las columnas); correrlo después del de costuras paso a paso';

/* ─────────────── 12-oct: producto padre + variantes por modelo ─────────────── */
INSERT @r SELECT 40, 'docs/migrations/configurador_variantes.sql', 'ProductoVentaConfig.PadreProIdProducto + ModeloClave + índice único padre+modelo',
    CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','PadreProIdProducto') IS NULL OR COL_LENGTH('dbo.ProductoVentaConfig','ModeloClave') IS NULL THEN 'FALTA'
         WHEN NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ProductoVentaConfig_PadreModelo' AND object_id = OBJECT_ID('dbo.ProductoVentaConfig')) THEN 'REVISAR'
         ELSE 'OK' END, 'ANTES',
    CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','PadreProIdProducto') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ProductoVentaConfig_PadreModelo' AND object_id = OBJECT_ID('dbo.ProductoVentaConfig')) THEN N'faltan el índice único: volver a correr el script'
         ELSE N'sin esto no se pueden crear variantes por modelo' END;
INSERT @r SELECT 41, 'docs/migrations/configurador_variantes.sql', 'Columnas de versiones anteriores (TecnicasPropias, SeccionesPropias) eliminadas',
    CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','TecnicasPropias') IS NULL AND COL_LENGTH('dbo.ProductoVentaConfig','SeccionesPropias') IS NULL THEN 'OK' ELSE 'REVISAR' END, 'ANTES',
    CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','TecnicasPropias') IS NULL AND COL_LENGTH('dbo.ProductoVentaConfig','SeccionesPropias') IS NULL THEN '' ELSE N'quedaron columnas de un diseño descartado; el script las borra' END;
INSERT @r SELECT 42, 'scripts/add_solicitudes_portal.sql', 'SolicitudesVendedor.Origen (VENDEDOR/PORTAL) + PortalConfirmado',
    CASE WHEN COL_LENGTH('dbo.SolicitudesVendedor','Origen') IS NOT NULL AND COL_LENGTH('dbo.SolicitudesVendedor','PortalConfirmado') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES',
    N'sin esto "Armar mi pedido" en la tienda del portal no funciona';

/* ─────────────── 13/14-oct: a medida, mesas TIZADA, usuario de lectura ─────────────── */
INSERT @r SELECT 50, 'docs/migrations/configurador_a_medida.sql', 'ProductoVentaConfig.AMedidaJson (productos a medida)',
    CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','AMedidaJson') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES', N'sin esto el tipo de molde "A medida" no se puede guardar';
INSERT @r SELECT 51, 'docs/migrations/configurador_tizadapro_mesas.sql', 'ProductoVentaConfig.TizadaMesasModo (archivos de impresión por producto)',
    CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','TizadaMesasModo') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES o DESPUÉS', N'el backend funciona sin la columna (usa el valor del .env)';
INSERT @r SELECT 52, 'docs/migrations/PROD_tizadapro_usuario_lectura.sql', 'Login tizadapro_lectura (solo lectura sobre la base TizadaPro)',
    CASE WHEN EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'tizadapro_lectura') THEN 'OK' ELSE 'REVISAR' END, 'cuando se use',
    CASE WHEN EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'tizadapro_lectura') THEN N'falta confirmar que tiene db_datareader en TizadaPro'
         ELSE N'solo hace falta si el backend va a leer la base TizadaPro con un usuario propio en vez de sa' END;
INSERT @r SELECT 53, 'permiso de lectura (base TizadaPro)', 'Base TizadaPro en esta instancia',
    CASE WHEN DB_ID('TizadaPro') IS NOT NULL THEN 'OK' ELSE 'REVISAR' END, 'ANTES',
    CASE WHEN DB_ID('TizadaPro') IS NULL THEN N'no hay base TizadaPro acá (o TIZADAPRO_DB apunta a otra instancia)' ELSE '' END;

/* ─────────────── Datos: qué hay cargado con lo nuevo (informativo) ─────────────── */
IF COL_LENGTH('dbo.ProductoVentaConfig','PadreProIdProducto') IS NOT NULL
BEGIN
    DECLARE @sql NVARCHAR(400) = N'SELECT @n = COUNT(*) FROM dbo.ProductoVentaConfig WHERE PadreProIdProducto IS NOT NULL';
    EXEC sp_executesql @sql, N'@n INT OUTPUT', @n = @n OUTPUT;
    INSERT @r SELECT 60, '(datos)', 'Variantes por modelo ya creadas', 'OK', '', CONCAT(@n, ' variante(s)');
END
IF OBJECT_ID('dbo.MaquinasCostura','U') IS NOT NULL
BEGIN
    DECLARE @sql2 NVARCHAR(400) = N'SELECT @n = COUNT(*) FROM dbo.ProductoFichaDisenoCosturas WHERE TiempoMin IS NOT NULL';
    EXEC sp_executesql @sql2, N'@n INT OUTPUT', @n = @n OUTPUT;
    INSERT @r SELECT 61, '(datos)', 'Pasos de costura con tiempo cargado', 'OK', '', CONCAT(@n, ' paso(s)');
END
SELECT @n = COUNT(*) FROM dbo.Articulos WHERE CodArticulo LIKE 'PR-%';
INSERT @r SELECT 62, '(datos)', 'Artículos PR-0xx (los que reemplaza padre + variantes)', CASE WHEN @n = 0 THEN 'OK' ELSE 'REVISAR' END, '', CONCAT(@n, ' artículo(s); decidir cuáles se borran, con respaldo');
SELECT @n = COUNT(*) FROM dbo.Articulos a WHERE a.CodArticulo LIKE '[A-Z][A-Z][A-Z]-[A-Z][A-Z][A-Z]-[0-9][0-9]%' OR a.CodArticulo LIKE '[A-Z][A-Z][A-Z]-[0-9][0-9]%';
INSERT @r SELECT 63, '(datos)', 'Artículos con código nuevo FAM-ETQ-NN', 'OK', '', CONCAT(@n, ' artículo(s)');

/* ─────────────── RESULTADO: primero lo que falta ─────────────── */
SELECT Estado, Cuando, Script, Chequeo, Detalle
FROM @r
ORDER BY CASE Estado WHEN 'FALTA' THEN 0 WHEN 'REVISAR' THEN 1 ELSE 2 END, Orden;

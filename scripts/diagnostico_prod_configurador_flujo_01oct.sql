/* ============================================================================
   DIAGNÓSTICO PRODUCCIÓN — configurador de productos + flujo de prendas (01-oct-2026)
   SOLO LECTURA: no crea, no modifica ni borra nada. Correr entero en SSMS.
   Cada fila dice qué script es y si su huella ya está en la base.
     OK      = ya está
     FALTA   = hay que correr ese script
     REVISAR = mirar el detalle (casos de datos, o no se pudo evaluar)
   La columna Cuando dice si el script va ANTES o DESPUÉS del deploy del backend.
   ============================================================================ */
USE [SecureAppDB];
SET NOCOUNT ON;

DECLARE @r TABLE (Paso VARCHAR(4), Script NVARCHAR(120), Chequeo NVARCHAR(200), Estado VARCHAR(10), Cuando VARCHAR(20), Detalle NVARCHAR(400));
DECLARE @n INT, @sql NVARCHAR(MAX), @err NVARCHAR(300);

/* ─────────────── 0) BASE DEL CONFIGURADOR (configurador_productos.sql) ─────────────── */
INSERT @r SELECT '0', 'docs/migrations/configurador_productos.sql', 'Tabla ProductoVentaConfig',
    CASE WHEN OBJECT_ID('dbo.ProductoVentaConfig','U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES', '';
INSERT @r SELECT '0', 'docs/migrations/configurador_productos.sql', 'Tabla ProductoTerminadoServicios + columnas Modo / Cobro',
    CASE WHEN OBJECT_ID('dbo.ProductoTerminadoServicios','U') IS NULL THEN 'FALTA'
         WHEN COL_LENGTH('dbo.ProductoTerminadoServicios','Modo') IS NULL OR COL_LENGTH('dbo.ProductoTerminadoServicios','Cobro') IS NULL THEN 'FALTA' ELSE 'OK' END, 'ANTES',
    CASE WHEN OBJECT_ID('dbo.ProductoTerminadoServicios','U') IS NOT NULL AND COL_LENGTH('dbo.ProductoTerminadoServicios','Modo') IS NULL THEN N'la tabla existe pero le faltan Modo/Cobro' ELSE '' END;
INSERT @r SELECT '0', 'docs/migrations/configurador_productos.sql', 'Tablas TecnicaOpciones + ProductoTecnicaOpciones',
    CASE WHEN OBJECT_ID('dbo.TecnicaOpciones','U') IS NOT NULL AND OBJECT_ID('dbo.ProductoTecnicaOpciones','U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES', '';
INSERT @r SELECT '0', 'docs/migrations/configurador_productos.sql', 'Tablas ProductoOrigenVariantes + ProductoApliques',
    CASE WHEN OBJECT_ID('dbo.ProductoOrigenVariantes','U') IS NOT NULL AND OBJECT_ID('dbo.ProductoApliques','U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES', '';
INSERT @r SELECT '0', 'docs/migrations/configurador_productos.sql', 'COMBOS: ProductoComboItems + ProductoComboItemServicios + ProductoVentaConfig.EsCombo',
    CASE WHEN OBJECT_ID('dbo.ProductoComboItems','U') IS NOT NULL AND OBJECT_ID('dbo.ProductoComboItemServicios','U') IS NOT NULL
              AND COL_LENGTH('dbo.ProductoVentaConfig','EsCombo') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES',
    CONCAT(CASE WHEN OBJECT_ID('dbo.ProductoComboItems','U') IS NULL THEN 'falta ProductoComboItems. ' ELSE '' END,
           CASE WHEN OBJECT_ID('dbo.ProductoComboItemServicios','U') IS NULL THEN 'falta ProductoComboItemServicios. ' ELSE '' END,
           CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','EsCombo') IS NULL THEN 'falta la columna EsCombo.' ELSE '' END);
INSERT @r SELECT '0', 'docs/migrations/configurador_productos.sql', 'Ficha de diseño: CosturasISO + ProductoFichaDiseno (+Anotaciones, Extra, Costuras)',
    CASE WHEN OBJECT_ID('dbo.CosturasISO','U') IS NOT NULL AND OBJECT_ID('dbo.ProductoFichaDiseno','U') IS NOT NULL
              AND OBJECT_ID('dbo.ProductoFichaDisenoAnotaciones','U') IS NOT NULL AND OBJECT_ID('dbo.ProductoFichaDisenoExtra','U') IS NOT NULL
              AND OBJECT_ID('dbo.ProductoFichaDisenoCosturas','U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES', '';
INSERT @r SELECT '0', 'docs/migrations/add_ComboItemID_ordenes.sql', 'Ordenes.ComboItemID',
    CASE WHEN COL_LENGTH('dbo.Ordenes','ComboItemID') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES', '';
INSERT @r SELECT '0', 'docs/migrations/add_ComboPedidoNoDocERP_ordenes.sql', 'Ordenes.ComboPedidoNoDocERP',
    CASE WHEN COL_LENGTH('dbo.Ordenes','ComboPedidoNoDocERP') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES', '';

/* ─────────────── 2) TIZADAPRO EN EL CONFIGURADOR (configurador_tizadapro.sql) ─────────────── */
INSERT @r SELECT '2', 'docs/migrations/configurador_tizadapro.sql', 'ProductoVentaConfig.TizadaProMoldeRef + ProductoModelos + ProductoTelas',
    CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','TizadaProMoldeRef') IS NOT NULL AND OBJECT_ID('dbo.ProductoModelos','U') IS NOT NULL
              AND OBJECT_ID('dbo.ProductoTelas','U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES', '';
INSERT @r SELECT '2', 'docs/migrations/configurador_tizadapro.sql', 'ProductoAvios (+AvioID) + TizadaProMoldePiezas + CatalogoAvios',
    CASE WHEN OBJECT_ID('dbo.ProductoAvios','U') IS NOT NULL AND COL_LENGTH('dbo.ProductoAvios','AvioID') IS NOT NULL
              AND OBJECT_ID('dbo.TizadaProMoldePiezas','U') IS NOT NULL AND OBJECT_ID('dbo.CatalogoAvios','U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES', '';
INSERT @r SELECT '2', 'docs/migrations/configurador_tizadapro.sql', 'Limpieza de lo descartado (Moldes, ComponenteOpciones, ProductoComponentes, ProductoVariantes, PiezasPrenda)',
    CASE WHEN OBJECT_ID('dbo.Moldes','U') IS NULL AND OBJECT_ID('dbo.ComponenteOpciones','U') IS NULL AND OBJECT_ID('dbo.ProductoComponentes','U') IS NULL
              AND OBJECT_ID('dbo.ProductoVariantes','U') IS NULL AND OBJECT_ID('dbo.PiezasPrenda','U') IS NULL THEN 'OK' ELSE 'REVISAR' END, 'ANTES',
    CASE WHEN OBJECT_ID('dbo.Moldes','U') IS NULL AND OBJECT_ID('dbo.ComponenteOpciones','U') IS NULL AND OBJECT_ID('dbo.ProductoComponentes','U') IS NULL
              AND OBJECT_ID('dbo.ProductoVariantes','U') IS NULL AND OBJECT_ID('dbo.PiezasPrenda','U') IS NULL THEN ''
         ELSE N'OJO: este script BORRA esas tablas. Siguen existiendo: mirar si tienen datos antes de correrlo.' END;
INSERT @r SELECT '1', 'permiso de lectura (sección C de scripts/add_solicitudes_tizadapro.sql)', 'Base TizadaPro en esta instancia',
    CASE WHEN DB_ID('TizadaPro') IS NOT NULL THEN 'OK' ELSE 'REVISAR' END, 'ANTES',
    CASE WHEN DB_ID('TizadaPro') IS NULL THEN N'no hay base TizadaPro acá (o TIZADAPRO_DB apunta a otra). Además el usuario del backend necesita db_datareader en ella.'
         ELSE N'la base existe; falta confirmar a mano que el usuario del backend tiene db_datareader en ella' END;

/* ─────────────── 2b) F1: PRODUCCIÓN PRINCIPAL (configurador_f1_produccion_principal.sql) ─────────────── */
INSERT @r SELECT '2b', 'docs/migrations/configurador_f1_produccion_principal.sql', 'ProductoVentaConfig: TecnicaPrincipal, AnchoM, AltoM, BordeCm, UM, Molde, VisiblePortal/Tienda/Interno',
    CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','TecnicaPrincipal') IS NOT NULL AND COL_LENGTH('dbo.ProductoVentaConfig','AnchoM') IS NOT NULL
              AND COL_LENGTH('dbo.ProductoVentaConfig','AltoM') IS NOT NULL AND COL_LENGTH('dbo.ProductoVentaConfig','BordeCm') IS NOT NULL
              AND COL_LENGTH('dbo.ProductoVentaConfig','UM') IS NOT NULL AND COL_LENGTH('dbo.ProductoVentaConfig','Molde') IS NOT NULL
              AND COL_LENGTH('dbo.ProductoVentaConfig','VisiblePortal') IS NOT NULL AND COL_LENGTH('dbo.ProductoVentaConfig','VisibleTienda') IS NOT NULL
              AND COL_LENGTH('dbo.ProductoVentaConfig','VisibleInterno') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES',
    CONCAT('faltan: ',
        CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','TecnicaPrincipal') IS NULL THEN 'TecnicaPrincipal ' ELSE '' END,
        CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','AnchoM') IS NULL THEN 'AnchoM ' ELSE '' END,
        CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','AltoM') IS NULL THEN 'AltoM ' ELSE '' END,
        CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','BordeCm') IS NULL THEN 'BordeCm ' ELSE '' END,
        CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','UM') IS NULL THEN 'UM ' ELSE '' END,
        CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','Molde') IS NULL THEN 'Molde ' ELSE '' END,
        CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','VisiblePortal') IS NULL THEN 'VisiblePortal ' ELSE '' END,
        CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','VisibleTienda') IS NULL THEN 'VisibleTienda ' ELSE '' END,
        CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','VisibleInterno') IS NULL THEN 'VisibleInterno ' ELSE '' END);
UPDATE @r SET Detalle = '' WHERE Paso = '2b' AND Estado = 'OK';

/* ─────────────── 2c) ACCESORIOS DE STOCK (configurador_accesorios.sql) ─────────────── */
INSERT @r SELECT '2c', 'docs/migrations/configurador_accesorios.sql', 'Tabla ProductoAccesorios',
    CASE WHEN OBJECT_ID('dbo.ProductoAccesorios','U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES', '';
INSERT @r SELECT '2c', 'docs/migrations/configurador_accesorios.sql', 'ProductoAccesorios.WmsDepositoId',
    CASE WHEN COL_LENGTH('dbo.ProductoAccesorios','WmsDepositoId') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES', '';
INSERT @r SELECT '2c', 'docs/migrations/configurador_accesorios.sql', 'PedidosCobranzaDetalle.WmsDepositoId',
    CASE WHEN COL_LENGTH('dbo.PedidosCobranzaDetalle','WmsDepositoId') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES', '';

/* ─────────────── 3) TIZADAS EN LA SOLICITUD (add_solicitudes_tizadapro.sql) ─────────────── */
INSERT @r SELECT '3', 'scripts/add_solicitudes_tizadapro.sql', 'Tabla SolicitudesVendedorTizadas',
    CASE WHEN OBJECT_ID('dbo.SolicitudesVendedorTizadas','U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES', '';
INSERT @r SELECT '3', 'scripts/add_solicitudes_tizadapro.sql', 'SolicitudesVendedorArchivos.TizadaID / TizadaHoja',
    CASE WHEN COL_LENGTH('dbo.SolicitudesVendedorArchivos','TizadaID') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, 'ANTES',
    CASE WHEN OBJECT_ID('dbo.SolicitudesVendedorArchivos','U') IS NULL THEN N'ni siquiera existe SolicitudesVendedorArchivos (falta add_solicitudes_vendedor.sql)' ELSE '' END;

/* ─────────────── CONFIGURACIÓN DE DATOS (requisitos y áreas) ─────────────── */
BEGIN TRY
    SET @sql = N'SELECT @n = COUNT(*) FROM dbo.Areas WHERE LTRIM(RTRIM(AreaID)) IN (''DIRECTA'',''ECOUV'') AND LTRIM(RTRIM(ISNULL(Entrega,''''))) = ''TELA''';
    EXEC sp_executesql @sql, N'@n INT OUTPUT', @n = @n OUTPUT;
    INSERT @r SELECT '2e', 'docs/migrations/areas_entrega_directa_ecouv.sql', 'Areas.Entrega = TELA para DIRECTA y ECOUV',
        CASE WHEN @n >= 2 THEN 'OK' ELSE 'FALTA' END, 'ANTES o DESPUÉS', CONCAT(@n, ' de 2 áreas configuradas');
END TRY BEGIN CATCH
    INSERT @r SELECT '2e', 'docs/migrations/areas_entrega_directa_ecouv.sql', 'Areas.Entrega = TELA para DIRECTA y ECOUV', 'REVISAR', '', CONCAT('no se pudo evaluar: ', ERROR_MESSAGE());
END CATCH;

BEGIN TRY
    SET @sql = N'SELECT @n = COUNT(*) FROM dbo.ConfigRequisitosProduccion WHERE AreaID = ''PRO'' AND CodigoRequisito = ''ACCESORIOS''';
    EXEC sp_executesql @sql, N'@n INT OUTPUT', @n = @n OUTPUT;
    INSERT @r SELECT '2f', 'docs/migrations/requisito_accesorios_pro.sql', 'Requisito PRO / ACCESORIOS',
        CASE WHEN @n > 0 THEN 'OK' ELSE 'FALTA' END, 'ANTES o DESPUÉS', '';
END TRY BEGIN CATCH
    INSERT @r SELECT '2f', 'docs/migrations/requisito_accesorios_pro.sql', 'Requisito PRO / ACCESORIOS', 'REVISAR', '', CONCAT('no se pudo evaluar: ', ERROR_MESSAGE());
END CATCH;

BEGIN TRY
    SET @sql = N'SELECT @n = COUNT(*) FROM dbo.ConfigRequisitosProduccion WHERE AreaID = ''EST'' AND CodigoRequisito = ''TPU''';
    EXEC sp_executesql @sql, N'@n INT OUTPUT', @n = @n OUTPUT;
    INSERT @r SELECT '2g', 'docs/migrations/requisito_tpu_estampado.sql', 'Requisito EST / TPU ("TPU a Estampar")',
        CASE WHEN @n > 0 THEN 'OK' ELSE 'FALTA' END, 'DESPUÉS',
        N'correr DESPUÉS del deploy del backend: con el backend viejo los Estampados de TPU quedarían trabados';
    SET @sql = N'SELECT @n = COUNT(*) FROM dbo.ConfigRequisitosProduccion WHERE AreaID = ''EST'' AND Descripcion = ''Prendas a Etampar''';
    EXEC sp_executesql @sql, N'@n INT OUTPUT', @n = @n OUTPUT;
    INSERT @r SELECT '2g', 'docs/migrations/requisito_tpu_estampado.sql', 'Texto "Prendas a Etampar" corregido',
        CASE WHEN @n = 0 THEN 'OK' ELSE 'FALTA' END, 'DESPUÉS', '';
END TRY BEGIN CATCH
    INSERT @r SELECT '2g', 'docs/migrations/requisito_tpu_estampado.sql', 'Requisito EST / TPU', 'REVISAR', '', CONCAT('no se pudo evaluar: ', ERROR_MESSAGE());
END CATCH;

/* ─────────────── REPARACIONES DE DATOS (cuenta los casos; 0 = nada para arreglar) ─────────────── */
BEGIN TRY
    SET @sql = N'SELECT @n = COUNT(*) FROM dbo.ServiciosExtraOrden S JOIN dbo.Ordenes O ON O.OrdenID = S.OrdenID
                 WHERE O.AreaID IN (''DIRECTA'', ''ECOUV'') AND S.Observacion = ''Generado desde WebOrder''
                   AND EXISTS (SELECT 1 FROM dbo.ArchivosOrden A WHERE A.OrdenID = O.OrdenID AND LTRIM(RTRIM(A.CodigoArticulo)) = LTRIM(RTRIM(S.CodArt)))';
    EXEC sp_executesql @sql, N'@n INT OUTPUT', @n = @n OUTPUT;
    INSERT @r SELECT '2d', 'docs/migrations/limpiar_linea_fantasma_directa_ecouv.sql', 'Líneas duplicadas de impresión en pedidos DIRECTA / ECOUV',
        CASE WHEN @n = 0 THEN 'OK' ELSE 'REVISAR' END, 'DESPUÉS', CONCAT(@n, ' línea(s) para borrar');
END TRY BEGIN CATCH
    INSERT @r SELECT '2d', 'docs/migrations/limpiar_linea_fantasma_directa_ecouv.sql', 'Líneas duplicadas de impresión en pedidos DIRECTA / ECOUV', 'REVISAR', 'DESPUÉS', CONCAT('no se pudo evaluar: ', ERROR_MESSAGE());
END CATCH;

BEGIN TRY
    SET @sql = N'SELECT @n = COUNT(*) FROM dbo.Ordenes h
                 WHERE UPPER(LTRIM(RTRIM(h.AreaID))) = ''EST''
                   AND h.NoDocERP IS NOT NULL AND LTRIM(RTRIM(CAST(h.NoDocERP AS VARCHAR(50)))) <> ''''
                   AND UPPER(LTRIM(RTRIM(ISNULL(h.Estado, '''')))) <> ''CANCELADO''
                   AND UPPER(LTRIM(RTRIM(ISNULL(h.EstadoenArea, '''')))) = ''PRONTO''
                   AND (h.CodigoOrden IS NULL OR h.CodigoOrden NOT LIKE ''%-F%'')
                   AND NOT EXISTS (SELECT 1 FROM dbo.Logistica_Bultos b WHERE b.OrdenID = h.OrdenID AND ISNULL(b.Estado, '''') <> ''CANCELADO'')
                   AND EXISTS (SELECT 1 FROM dbo.Ordenes p
                               WHERE p.NoDocERP = h.NoDocERP AND p.AreaID = h.AreaID AND p.OrdenID <> h.OrdenID
                                 AND UPPER(LTRIM(RTRIM(ISNULL(p.Estado, '''')))) <> ''CANCELADO''
                                 AND UPPER(LTRIM(RTRIM(ISNULL(p.EstadoenArea, '''')))) IN (''EN TRANSITO'', ''RECIBIDO EN DESTINO'')
                                 AND EXISTS (SELECT 1 FROM dbo.Logistica_Bultos b WHERE b.OrdenID = p.OrdenID AND ISNULL(b.Estado, '''') <> ''CANCELADO''))';
    EXEC sp_executesql @sql, N'@n INT OUTPUT', @n = @n OUTPUT;
    INSERT @r SELECT '2h', 'docs/migrations/reparar_estampado_hermana_sin_bulto.sql', 'Estampados "Pronto" sin bulto cuyo bulto hermano ya viajó',
        CASE WHEN @n = 0 THEN 'OK' ELSE 'REVISAR' END, 'DESPUÉS', CONCAT(@n, ' orden(es) para regularizar');
END TRY BEGIN CATCH
    INSERT @r SELECT '2h', 'docs/migrations/reparar_estampado_hermana_sin_bulto.sql', 'Estampados "Pronto" sin bulto cuyo bulto hermano ya viajó', 'REVISAR', 'DESPUÉS', CONCAT('no se pudo evaluar: ', ERROR_MESSAGE());
END CATCH;

/* ─────────────── RESULTADO: primero lo que falta ─────────────── */
SELECT Estado, Paso, Cuando, Script, Chequeo, Detalle
FROM @r
ORDER BY CASE Estado WHEN 'FALTA' THEN 0 WHEN 'REVISAR' THEN 1 ELSE 2 END, Paso, Script;

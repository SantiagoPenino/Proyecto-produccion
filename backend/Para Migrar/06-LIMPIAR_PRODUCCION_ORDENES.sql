USE [SecureAppDB];
GO

-- ============================================================================
-- SCRIPT DE LIMPIEZA DE PRODUCCIÓN (ÓRDENES, COBRANZAS Y LOGÍSTICA)
-- ============================================================================

PRINT '=== INICIANDO LIMPIEZA DE ÓRDENES Y COBRANZAS ===';

-- ----------------------------------------------------------------------------
-- 1. LIMPIAR DEPENDENCIAS DE LAS ÓRDENES PRIMERO
-- ----------------------------------------------------------------------------
DELETE FROM dbo.ArchivosOrden;
DELETE FROM dbo.ArchivosReferencia;
DELETE FROM dbo.ServiciosExtraOrden;

-- ----------------------------------------------------------------------------
-- 2. LIMPIAR CABECERA DE ÓRDENES, BITÁCORAS Y ETIQUETAS
-- ----------------------------------------------------------------------------
DELETE FROM dbo.BitacoraInsumosMaquina;
DELETE FROM dbo.BitacoraProduccion;
DELETE FROM dbo.HistorialOrdenes;
DELETE FROM dbo.Rollos;
DELETE FROM dbo.Ordenes;
DELETE FROM dbo.Etiquetas;

-- ----------------------------------------------------------------------------
-- 3. LIMPIAR PEDIDOS DE COBRANZA (DETALLE PRIMERO)
-- ----------------------------------------------------------------------------
DELETE FROM dbo.PedidosCobranzaDetalle;
DELETE FROM dbo.PedidosCobranza;

-- ----------------------------------------------------------------------------
-- 4. LIMPIEZA PARCIAL DE LOGÍSTICA
-- ----------------------------------------------------------------------------
-- Nota: En logística, primero se borran los items dependientes de los envíos.
DELETE FROM dbo.Logistica_EnvioItems WHERE EnvioID < 76;
DELETE FROM dbo.Logistica_Envios WHERE AREAORIGENID <> 'LOGISTICA_ENCOMIENDAS';
DELETE FROM dbo.Logistica_Bultos WHERE Tipocontenido <> 'ENCOMIENDA';


-- ----------------------------------------------------------------------------
-- 5. RESETEAR LOS IDENTIFICADORES (IDs)
-- ----------------------------------------------------------------------------
-- Solo reseteamos los contadores de las tablas que fueron vaciadas completamente.
-- (Las de logística no se resetean porque el borrado fue parcial con "WHERE").

BEGIN TRY DBCC CHECKIDENT ('dbo.ArchivosOrden', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.ArchivosReferencia', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.ServiciosExtraOrden', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.BitacoraInsumosMaquina', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.BitacoraProduccion', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.HistorialOrdenes', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.Rollos', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.Ordenes', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.Etiquetas', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.PedidosCobranzaDetalle', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.PedidosCobranza', RESEED, 0); END TRY BEGIN CATCH END CATCH;

PRINT '=== LIMPIEZA DE PRODUCCIÓN COMPLETADA 💪 ===';
GO

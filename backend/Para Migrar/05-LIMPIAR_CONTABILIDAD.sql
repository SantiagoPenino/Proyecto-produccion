USE [SecureAppDB];
GO

-- ============================================================================
-- SCRIPT DE LIMPIEZA TOTAL: CONTABILIDAD, CAJA Y ASIENTOS
-- ============================================================================

PRINT '=== INICIANDO LAVADO DE CONTABILIDAD Y CAJA ===';

-- ----------------------------------------------------------------------------
-- 1. LIMPIAR CRUCES Y DETALLES (TABLAS DEPENDIENTES DE TRANSACCIONES)
-- ----------------------------------------------------------------------------
DELETE FROM dbo.ImputacionPago;
DELETE FROM dbo.TransaccionDetalle;
DELETE FROM dbo.AjustesDocumento;

-- ----------------------------------------------------------------------------
-- 2. LIMPIAR ASIENTOS CONTABLES (DETALLES PRIMERO, LUEGO CABECERA)
-- ----------------------------------------------------------------------------
DELETE FROM dbo.Cont_AsientosDetalle;
DELETE FROM dbo.Cont_AsientosCabecera;

-- ----------------------------------------------------------------------------
-- 3. LIMPIAR DOCUMENTOS, PLANES, CICLOS Y DEUDAS
-- ----------------------------------------------------------------------------
-- IMPORTANTE: Primero se borra el detalle del documento, luego la cabecera.
DELETE FROM dbo.DocumentosContablesDetalle;
DELETE FROM dbo.DocumentosContables;
DELETE FROM dbo.DeudaDocumento;
DELETE FROM dbo.PlanesMetros;
DELETE FROM dbo.CiclosCredito;

-- ----------------------------------------------------------------------------
-- 4. LIMPIAR MOVIMIENTOS DE CAJA, EGRESOS, AUTORIZACIONES Y TURNOS
-- ----------------------------------------------------------------------------
DELETE FROM dbo.TransaccionesCaja;
DELETE FROM dbo.EgresosCaja;
DELETE FROM dbo.AutorizacionesSinPago;
-- Historial de turnos de caja se borra al final de los movimientos de caja
DELETE FROM dbo.SesionesTurno;

-- ----------------------------------------------------------------------------
-- 5. LIMPIAR MOVIMIENTOS CONTABLES Y ESTADOS DE CUENTA
-- ----------------------------------------------------------------------------
DELETE FROM dbo.MovimientosCuenta;
DELETE FROM dbo.ColaEstadosCuenta;

-- ----------------------------------------------------------------------------
-- 6. MAESTRO DE CUENTAS CLIENTES (OPCIONES DE LIMPIEZA)
-- ----------------------------------------------------------------------------
-- OPCIÓN A (Borrado Total): Borra todos los perfiles contables de los clientes.
DELETE FROM dbo.CuentasCliente;

-- OPCIÓN B (Puesta a cero): Si NO quieres borrar los clientes, comenta el DELETE de arriba 
-- y descomenta este UPDATE para simplemente dejar su saldo en 0.
-- UPDATE dbo.CuentasCliente SET CueSaldoActual = 0, CueSaldoVencido = 0, CuePlazoFavorable = 0;

-- ----------------------------------------------------------------------------
-- 7. REINICIAR FOLIOS/SECUENCIALES DE FACTURAS Y TICKETS
-- ----------------------------------------------------------------------------
UPDATE dbo.SecuenciaDocumentos SET SecUltimoNumero = 0; 

-- ----------------------------------------------------------------------------
-- 8. RESETEAR LOS IDENTIFICADORES (IDs) PARA QUE VUELVAN A INICIAR EN 1
-- ----------------------------------------------------------------------------
-- Se envuelve en TRY CATCH por si alguna tabla está vacía y DBCC lanza un warning menor
BEGIN TRY DBCC CHECKIDENT ('dbo.ImputacionPago', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.TransaccionDetalle', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.AjustesDocumento', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.Cont_AsientosDetalle', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.Cont_AsientosCabecera', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.DocumentosContablesDetalle', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.DocumentosContables', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.DeudaDocumento', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.PlanesMetros', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.CiclosCredito', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.TransaccionesCaja', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.EgresosCaja', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.AutorizacionesSinPago', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.SesionesTurno', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.MovimientosCuenta', RESEED, 0); END TRY BEGIN CATCH END CATCH;
BEGIN TRY DBCC CHECKIDENT ('dbo.ColaEstadosCuenta', RESEED, 0); END TRY BEGIN CATCH END CATCH;

-- Si decides usar la Opcion B arriba, DEBES COMENTAR la siguiente linea de Reseed:
BEGIN TRY DBCC CHECKIDENT ('dbo.CuentasCliente', RESEED, 0); END TRY BEGIN CATCH END CATCH;

PRINT '=== LAVADO DE CONTABILIDAD Y CAJA COMPLETADO 💪 ===';
GO

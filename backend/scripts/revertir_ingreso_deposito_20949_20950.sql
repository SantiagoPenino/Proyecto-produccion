-- LOCAL: deshace la recepción en Depósito de PRO-20949 (REM-314163) y PRO-20950 (REM-531669)
-- para volver a recibirlos y comprobar importe, cantidad, producto y cargo en cuenta.
-- NO correr en producción.

IF @@SERVERNAME <> 'DESKTOP-C9Q4F0F\SQLEXPRESS' BEGIN RAISERROR('No es la base local', 16, 1); RETURN; END
IF EXISTS (SELECT 1 FROM ImputacionPago WHERE DDeIdDocumento = 12601) BEGIN RAISERROR('La deuda 12601 tiene pagos imputados', 16, 1); RETURN; END
IF EXISTS (SELECT 1 FROM OrdenesDeposito WHERE OrdIdOrden IN (168931, 168932) AND (PagIdPago IS NOT NULL OR OReIdOrdenRetiro IS NOT NULL))
    BEGIN RAISERROR('Alguna fila de depósito ya tiene pago o retiro', 16, 1); RETURN; END

BEGIN TRAN;

-- Cobro mal hecho (PRO-20949 cargó 297; PRO-20950 no cargó nada)
DELETE FROM DeudaDocumento    WHERE DDeIdDocumento = 12601 AND OrdIdOrden = 23997;
DELETE FROM MovimientosCuenta WHERE MovIdMovimiento = 48393 AND OrdIdOrden = 23997;
UPDATE PedidosCobranza SET MontoContabilizado = 0, MetrosContabilizados = 0 WHERE ID IN (29714, 29715);

-- Filas de depósito (aviso WSP incluido)
DELETE FROM HistoricoEstadosOrdenes WHERE OrdIdOrden IN (168931, 168932);
DELETE FROM OrdenesDeposito         WHERE OrdIdOrden IN (168931, 168932);

-- Estado de las órdenes como antes de recibir
UPDATE Ordenes SET Estado = 'Produccion', EstadoenArea = 'En transito'         WHERE OrdenID IN (23997, 24000);  -- PRO madres
UPDATE Ordenes SET Estado = 'Produccion', EstadoenArea = 'Recibido en Destino' WHERE OrdenID IN (23996, 23999);  -- BOR
DELETE FROM HistorialOrdenes WHERE HistorialID IN (211059, 211060, 211062, 211063, 211064, 211065)
                               AND OrdenID IN (23996, 23997, 23999, 24000);                                      -- Ingresado / Avisado

-- Remitos y bultos otra vez en viaje
UPDATE Logistica_Bultos     SET Estado = 'EN_TRANSITO', UbicacionActual = 'TRANSITO' WHERE BultoID IN (26948, 26949);
UPDATE Logistica_EnvioItems SET EstadoRecepcion = 'PENDIENTE', FechaEscaneo = NULL   WHERE ItemID IN (23937, 23938);
UPDATE Logistica_Envios     SET Estado = 'ESPERANDO_RETIRO', FechaLlegada = NULL, UsuarioReceptor = NULL WHERE EnvioID IN (2417, 2418);
DELETE FROM MovimientosLogistica WHERE MovimientoID IN (60744, 60745);

-- Control: tiene que dar 0 filas de depósito, 0 deuda, remitos ESPERANDO_RETIRO
SELECT 'deposito' t, COUNT(*) n FROM OrdenesDeposito WHERE OrdCodigoOrden IN ('PRO-20949', 'PRO-20950')
UNION ALL SELECT 'deuda', COUNT(*) FROM DeudaDocumento WHERE OrdIdOrden IN (23997, 24000)
UNION ALL SELECT 'remitos esperando', COUNT(*) FROM Logistica_Envios WHERE EnvioID IN (2417, 2418) AND Estado = 'ESPERANDO_RETIRO';

-- Si da deposito 0, deuda 0, remitos esperando 2:
-- COMMIT;
-- si no:
-- ROLLBACK;

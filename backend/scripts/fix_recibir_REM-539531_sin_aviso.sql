-- =====================================================================
-- Marcar el remito REM-539531 (ECOUV -> DEPOSITO) como RECIBIDO.
-- Trae 1 bulto: EUV-20891-R1 (repo), etiqueta 20891/B23083.
--
-- SOLO logística: ítem ESCANEADO, bulto EN_STOCK en el destino y remito
-- RECIBIDO_TOTAL. NO cambia el estado de la orden ni dispara nada, así que
-- NO se avisa al cliente.
--
-- Corre en transacción. Si alguna guarda falla, hace ROLLBACK y no toca nada.
-- =====================================================================
SET XACT_ABORT ON;

DECLARE @Remito VARCHAR(50) = 'REM-539531';

-- ---------- DIAGNÓSTICO (antes) ----------
SELECT e.EnvioID, e.CodigoRemito, e.AreaOrigenID, e.AreaDestinoID, e.Estado AS EstadoRemito,
       i.BultoID, i.EstadoRecepcion, b.CodigoEtiqueta, b.Tipocontenido, b.Estado AS EstadoBulto, b.UbicacionActual
FROM Logistica_Envios e
JOIN Logistica_EnvioItems i ON i.EnvioID = e.EnvioID
JOIN Logistica_Bultos b     ON b.BultoID = i.BultoID
WHERE e.CodigoRemito = @Remito;

-- ---------- FIX ----------
BEGIN TRAN;

DECLARE @EnvioID INT, @Destino VARCHAR(50), @n INT;

SELECT @EnvioID = EnvioID, @Destino = AreaDestinoID FROM Logistica_Envios WHERE CodigoRemito = @Remito;
SELECT @n = COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = @EnvioID;

IF @EnvioID IS NULL OR @n <> 1
BEGIN
    ROLLBACK;
    RAISERROR('Se esperaba el remito %s con 1 bulto y hay %d. No se tocó nada.', 16, 1, @Remito, @n);
    RETURN;
END

-- 1) Ítem recibido (mismo valor que pone el check-in al escanear)
UPDATE Logistica_EnvioItems SET EstadoRecepcion = 'ESCANEADO', FechaEscaneo = GETDATE()
WHERE EnvioID = @EnvioID AND EstadoRecepcion = 'PENDIENTE';

-- 2) Bulto en stock en el destino (DEPOSITO)
UPDATE b SET Estado = 'EN_STOCK', UbicacionActual = @Destino
FROM Logistica_Bultos b JOIN Logistica_EnvioItems i ON i.BultoID = b.BultoID
WHERE i.EnvioID = @EnvioID;

-- 3) Traza
INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, FechaHora, Observaciones, EstadoAnterior, EstadoNuevo, EsRecepcion)
SELECT b.CodigoEtiqueta, 'INGRESO', @Destino, 1, GETDATE(), 'Recepción de ' + @Remito + ' por script (repo, sin aviso al cliente)', 'EN_TRANSITO', 'EN_STOCK', 1
FROM Logistica_Bultos b JOIN Logistica_EnvioItems i ON i.BultoID = b.BultoID
WHERE i.EnvioID = @EnvioID;

-- 4) Remito recibido
UPDATE Logistica_Envios SET Estado = 'RECIBIDO_TOTAL', UsuarioReceptor = 1, FechaLlegada = GETDATE()
WHERE EnvioID = @EnvioID;

-- ---------- VERIFICACIÓN ----------
SELECT e.CodigoRemito, e.Estado AS EstadoRemito, i.EstadoRecepcion, b.CodigoEtiqueta, b.Estado AS EstadoBulto, b.UbicacionActual
FROM Logistica_Envios e
JOIN Logistica_EnvioItems i ON i.EnvioID = e.EnvioID
JOIN Logistica_Bultos b     ON b.BultoID = i.BultoID
WHERE e.EnvioID = @EnvioID;

COMMIT;
-- Si algo no cierra en la verificación: cambiar COMMIT por ROLLBACK y volver a correr.

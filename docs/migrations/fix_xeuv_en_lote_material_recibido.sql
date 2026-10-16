-- ============================================================================
-- FIX PROD: hermana XEUV metida en un LOTE -> el check-in de TERMINAC no la toma
-- Caso: XEUV-12044 (remito recibido, pero la orden sigue "En Lote")
--
-- POR QUE PASA: el gancho del check-in en Terminaciones solo mueve hermanas que
-- estan en 'Pendiente' (a proposito, para no pisar ordenes ya trabajadas).
-- Si alguien asigno la XEUV a un lote (Mesa de Armado / Planeacion), quedo
-- 'En Lote' y el check-in la saltea. Las XEUV no se planifican en lotes:
-- no tienen archivo de impresion, son ordenes de trabajo manual.
--
-- QUE HACE: la saca del lote y la deja como la hubiera dejado el check-in:
-- Estado general 'Produccion' + EstadoenArea 'Material Recibido' + historial.
-- Idempotente: si ya esta en 'Material Recibido' (o cancelada) no toca nada.
-- ============================================================================

-- ---------- 1) DIAGNOSTICO (solo lectura, correr primero) ----------
SELECT OrdenID, CodigoOrden, AreaID, Estado, EstadoenArea, RolloID, Secuencia,
       MaquinaID, ProximoServicio, NoDocERP
FROM Ordenes
WHERE CodigoOrden IN ('XEUV-12044', 'EUV-12044');

SELECT TOP 12 h.Estado, h.FechaInicio, h.Usuario, h.Detalle
FROM HistorialOrdenes h
WHERE h.OrdenID = (SELECT OrdenID FROM Ordenes WHERE CodigoOrden = 'XEUV-12044')
ORDER BY h.FechaInicio DESC;

-- ---------- 2) CORRECCION ----------
BEGIN TRAN;

DECLARE @OID INT = (SELECT OrdenID FROM Ordenes
                    WHERE CodigoOrden = 'XEUV-12044' AND AreaID = 'TERMINAC'
                      AND Estado NOT IN ('Cancelado','CANCELADO'));

IF @OID IS NOT NULL AND EXISTS (
        SELECT 1 FROM Ordenes
        WHERE OrdenID = @OID
          AND ISNULL(EstadoenArea,'Pendiente') NOT IN ('Material Recibido','En Terminaciones','Control y Calidad','Pronto'))
BEGIN
    UPDATE Ordenes
    SET RolloID = NULL, Secuencia = NULL, MaquinaID = NULL,
        Estado = 'Produccion',                -- padre de 'Material Recibido' en ConfigEstados
        EstadoenArea = 'Material Recibido'
    WHERE OrdenID = @OID;

    INSERT INTO dbo.HistorialOrdenes (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
    VALUES (@OID, 'Material Recibido', GETDATE(), GETDATE(), 'Sistema',
            'Material impreso recibido en Terminaciones (ajuste: la orden estaba En Lote y el check-in no la tomo)');

    PRINT 'XEUV-12044 -> Material Recibido (fuera del lote).';
END
ELSE
    PRINT 'Sin cambios: la orden no existe, esta cancelada o ya avanzo de estado.';

COMMIT;

-- ---------- 3) VERIFICACION ----------
SELECT OrdenID, CodigoOrden, Estado, EstadoenArea, RolloID
FROM Ordenes WHERE CodigoOrden = 'XEUV-12044';

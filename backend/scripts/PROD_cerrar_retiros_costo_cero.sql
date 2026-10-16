/* =====================================================================================
   CERRAR retiros cuyas órdenes pendientes valen TODAS $0 (reposiciones -R/-F, cubiertas
   por plan, etc.). Caso RW-29873 / SUB-26499-R1 (02-oct-2026).

   Desde el commit f08e495 (29-sep) crearRetiro ya los crea cubiertos: estado Abonado y
   PagIdPago = 0 (centinela "cubierto sin efectivo"). Este script deja IGUAL a los que se
   crearon antes y quedaron en Caja esperando un cobro de $0:
     - OrdenesDeposito.PagIdPago = 0   en las órdenes del retiro sin pago y con costo <= 0
     - OrdenesRetiro.PagIdPago   = 0
     - Estado del retiro: 1 Ingresado / 2 Pasar por caja → 3 Abonado
                          7 Empaquetado sin abonar        → 8 Empaquetado y abonado
                          el resto (Entregado, En viaje, Autorizado…) no se toca
       + HistoricoEstadosOrdenesRetiro solo si cambia el estado.
   NO crea documentos, ni pagos, ni movimientos de cuenta. Solo retiros donde NINGUNA orden
   pendiente tiene costo > 0 (si una tiene importe, el retiro queda como está).

   @Aplicar = 0 → muestra qué haría y hace ROLLBACK.   @Aplicar = 1 → COMMIT.
   @Solo    = un OReIdOrdenRetiro para hacer uno solo (ej. 29873). NULL = todos.
   ===================================================================================== */
USE [SecureAppDB];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar BIT = 0;
DECLARE @Solo    INT = 29873;      -- primero uno; después NULL para todos
DECLARE @Usuario INT = 70;         -- usuario que queda en el historial (70 = Sistema)

IF OBJECT_ID('tempdb..#Cand') IS NOT NULL DROP TABLE #Cand;

SELECT r.OReIdOrdenRetiro, r.FormaRetiro, r.OReEstadoActual AS EstadoAntes,
       CASE r.OReEstadoActual WHEN 1 THEN 3 WHEN 2 THEN 3 WHEN 7 THEN 8 ELSE r.OReEstadoActual END AS EstadoDespues,
       r.OReFechaAlta,
       (SELECT COUNT(*) FROM OrdenesDeposito od WHERE od.OReIdOrdenRetiro = r.OReIdOrdenRetiro AND od.PagIdPago IS NULL) AS OrdenesSinPago,
       (SELECT STRING_AGG(od.OrdCodigoOrden, ', ') FROM OrdenesDeposito od WHERE od.OReIdOrdenRetiro = r.OReIdOrdenRetiro AND od.PagIdPago IS NULL) AS Ordenes
INTO #Cand
FROM OrdenesRetiro r
WHERE r.OReEstadoActual <> 6
  AND r.PagIdPago IS NULL
  AND (@Solo IS NULL OR r.OReIdOrdenRetiro = @Solo)
  AND EXISTS     (SELECT 1 FROM OrdenesDeposito od WHERE od.OReIdOrdenRetiro = r.OReIdOrdenRetiro AND od.PagIdPago IS NULL)
  AND NOT EXISTS (SELECT 1 FROM OrdenesDeposito od WHERE od.OReIdOrdenRetiro = r.OReIdOrdenRetiro AND od.PagIdPago IS NULL
                                                    AND ISNULL(od.OrdCostoFinal, 0) > 0);

SELECT 'CANDIDATOS' AS Bloque, c.*, e1.EORNombreEstado AS NombreAntes, e2.EORNombreEstado AS NombreDespues
FROM #Cand c
LEFT JOIN EstadosOrdenesRetiro e1 ON e1.EORIdEstadoOrden = c.EstadoAntes
LEFT JOIN EstadosOrdenesRetiro e2 ON e2.EORIdEstadoOrden = c.EstadoDespues
ORDER BY c.OReFechaAlta;

BEGIN TRY
    BEGIN TRAN;

    UPDATE od SET od.PagIdPago = 0
    FROM OrdenesDeposito od
    JOIN #Cand c ON c.OReIdOrdenRetiro = od.OReIdOrdenRetiro
    WHERE od.PagIdPago IS NULL AND ISNULL(od.OrdCostoFinal, 0) <= 0;
    DECLARE @Ord INT = @@ROWCOUNT;

    INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
    SELECT c.OReIdOrdenRetiro, c.EstadoDespues, GETDATE(), @Usuario
    FROM #Cand c WHERE c.EstadoDespues <> c.EstadoAntes;
    DECLARE @Hist INT = @@ROWCOUNT;

    UPDATE r SET r.PagIdPago = 0,
                 r.OReEstadoActual = c.EstadoDespues,
                 r.OReFechaEstadoActual = CASE WHEN c.EstadoDespues <> c.EstadoAntes THEN GETDATE() ELSE r.OReFechaEstadoActual END
    FROM OrdenesRetiro r
    JOIN #Cand c ON c.OReIdOrdenRetiro = r.OReIdOrdenRetiro
    WHERE r.PagIdPago IS NULL;
    DECLARE @Ret INT = @@ROWCOUNT;

    SELECT 'RESULTADO' AS Bloque, @Ret AS RetirosCerrados, @Ord AS OrdenesMarcadas, @Hist AS CambiosDeEstado;

    -- Control: ninguno de los candidatos tiene que seguir en la lista de Caja
    SELECT 'SIGUEN EN CAJA (debe dar 0)' AS Bloque, COUNT(*) AS Cant
    FROM #Cand c JOIN OrdenesRetiro r ON r.OReIdOrdenRetiro = c.OReIdOrdenRetiro
    WHERE r.PagIdPago IS NULL
       OR EXISTS (SELECT 1 FROM OrdenesDeposito od WHERE od.OReIdOrdenRetiro = r.OReIdOrdenRetiro AND od.PagIdPago IS NULL);

    IF @Aplicar = 1 BEGIN COMMIT TRAN; PRINT 'APLICADO.'; END
    ELSE BEGIN ROLLBACK TRAN; PRINT 'SIMULACION (@Aplicar = 0): ROLLBACK, no quedó nada cambiado.'; END
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;

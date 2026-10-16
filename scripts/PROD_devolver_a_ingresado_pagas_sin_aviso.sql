/* ============================================================================
   PROD — Órdenes pagadas con billetera / saldo a favor que quedaron en
   "Pronto para entregar" (7) SIN haberse avisado por WhatsApp.

   Causa (arreglada en código 28-sep-2026): al pagar con billetera o saldo, el motor
   pasaba la orden 1 → 7 y el cron de WhatsApp solo avisa las que están en 1.
   Ahora el pago no toca el estado.

   Qué hace: devuelve esas órdenes a Ingresado (1). El cron las avisa en la próxima
   vuelta (respetando pedido completo y bultos) y las pasa a Avisado (6).
   El pago NO se pierde: vive en MovimientosCuenta, no en el estado.

   Cómo se reconocen (huella del motor): estado 7, nunca avisadas, sin PagIdPago
   (no pasaron por caja), sin retiro, y SIN fila 7 en HistoricoEstadosOrdenes (la
   auditoría "A depósito" y los anticipos sí la escriben; el motor no).

   1) Correr con @SoloVista = 1 y revisar la lista.
   2) Si está bien, @SoloVista = 0.
   ============================================================================ */
SET NOCOUNT ON;
DECLARE @SoloVista BIT = 1;
DECLARE @DiasMax   INT = 60;   -- no despertar órdenes más viejas que esto

IF OBJECT_ID('tempdb..#afectadas') IS NOT NULL DROP TABLE #afectadas;

SELECT od.OrdIdOrden, od.OrdCodigoOrden, od.CliIdCliente, c.Nombre AS Cliente,
       od.OrdNombreTrabajo, od.OrdCostoFinal, od.OrdFechaIngresoOrden, od.OrdFechaEstadoActual,
       CASE WHEN EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                         WHERE m.OrdIdOrden = od.OrdIdOrden AND m.MovTipo = 'CONSUMO_CUENTA'
                           AND ISNULL(m.MovAnulado, 0) = 0)
            THEN 'billetera' ELSE 'saldo a favor / otro' END AS PagadaCon
INTO #afectadas
FROM dbo.OrdenesDeposito od
LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = od.CliIdCliente
WHERE od.OrdEstadoActual = 7
  AND ISNULL(od.OrdAvisoWsp, 0) = 0
  AND od.PagIdPago IS NULL
  AND od.OReIdOrdenRetiro IS NULL
  AND od.OrdFechaIngresoOrden >= DATEADD(DAY, -@DiasMax, GETDATE())
  AND NOT EXISTS (SELECT 1 FROM dbo.HistoricoEstadosOrdenes h WITH(NOLOCK)
                  WHERE h.OrdIdOrden = od.OrdIdOrden AND h.EOrIdEstadoOrden = 7);

SELECT * FROM #afectadas ORDER BY Cliente, OrdFechaIngresoOrden;
SELECT COUNT(*) AS Total, SUM(CASE WHEN PagadaCon = 'billetera' THEN 1 ELSE 0 END) AS PorBilletera FROM #afectadas;

IF @SoloVista = 0
BEGIN
    BEGIN TRAN;
    UPDATE od
       SET od.OrdEstadoActual = 1, od.OrdFechaEstadoActual = GETDATE()
    FROM dbo.OrdenesDeposito od
    JOIN #afectadas a ON a.OrdIdOrden = od.OrdIdOrden
    WHERE od.OrdEstadoActual = 7;     -- por si cambió entre la vista y el update
    PRINT CONCAT('Devueltas a Ingresado: ', @@ROWCOUNT);
    COMMIT;
END
ELSE
    PRINT 'SoloVista = 1 → no se modificó nada.';

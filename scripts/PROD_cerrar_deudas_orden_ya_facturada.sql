-- ============================================================================
-- CERRAR DEUDAS POR ORDEN CUYA ORDEN YA FUE FACTURADA (28-09-2026)
-- Caso Micaela Tripicchio / SUB-20323: la orden se facturó en el e-Ticket ET-8100
-- (Serie A 52918, 10/9/2026) y se cobró por Mercado Pago (RT-26990), pero la fila
-- de DeudaDocumento POR ORDEN (OrdIdOrden con DocIdDocumento NULL) quedó VENCIDO
-- para siempre: la caja estampaba el documento en el movimiento ORDEN de la cuenta
-- y nunca cerraba la deuda por orden. Antigüedad de Deuda y Cobranzas la mostraban
-- como "orden sin facturar, vencida".
--
-- Criterio: la orden está facturada si su movimiento ORDEN (MovimientosCuenta,
-- misma cuenta) tiene DocIdDocumento estampado y ese documento no está anulado.
-- Se cierra igual que hace cancelarDeuda (CANCELADA, pendiente 0) y se anota el
-- documento en DDeObservaciones. NO toca saldos ni movimientos.
-- El código nuevo (contabilidadService.cerrarDeudasPorOrdenFacturada) evita que
-- vuelva a pasar; los reportes además excluyen estas filas aunque queden abiertas.
--
-- En local (28-sep): 1.701 filas, US$ 48.868 + $ 50.344, TODAS con documento pagado.
--
-- USO: 1) correr el bloque PREVIEW y revisar la lista;
--      2) correr el bloque FIX (queda en ROLLBACK: cambiar a COMMIT cuando conforme).
-- ============================================================================

-- ─── PREVIEW ────────────────────────────────────────────────────────────────
;WITH Afectadas AS (
    SELECT d.DDeIdDocumento, d.CueIdCuenta, d.OrdIdOrden, d.DDeImportePendiente, d.DDeEstado, d.DDeFechaEmision,
           mv.DocIdDocumento
    FROM dbo.DeudaDocumento d
    CROSS APPLY (
        SELECT TOP 1 mf.DocIdDocumento
        FROM dbo.MovimientosCuenta mf
        JOIN dbo.DocumentosContables df ON df.DocIdDocumento = mf.DocIdDocumento AND df.DocEstado <> 'ANULADO'
        WHERE mf.MovTipo = 'ORDEN' AND mf.OrdIdOrden = d.OrdIdOrden AND mf.CueIdCuenta = d.CueIdCuenta
          AND ISNULL(mf.MovAnulado, 0) = 0 AND mf.DocIdDocumento IS NOT NULL
        ORDER BY mf.MovIdMovimiento DESC
    ) mv
    WHERE d.DocIdDocumento IS NULL AND d.OrdIdOrden IS NOT NULL
      AND d.DDeEstado IN ('PENDIENTE', 'VENCIDO', 'PARCIAL')
)
SELECT a.DDeIdDocumento, RTRIM(cli.Nombre) AS Cliente, cc.CueTipo,
       COALESCE(od.OrdCodigoOrden, o.CodigoOrden) AS Orden,
       a.DDeImportePendiente AS Pendiente, a.DDeEstado, CONVERT(CHAR(10), a.DDeFechaEmision, 120) AS EmisionDeuda,
       RTRIM(dc.DocTipo) + ' ' + RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR) AS Documento,
       dc.CfeNumeroOficial, CONVERT(CHAR(10), dc.DocFechaEmision, 120) AS FechaDoc, dc.DocTotal, dc.DocPagado, dc.CfeEstado
FROM Afectadas a
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = a.CueIdCuenta
JOIN dbo.Clientes cli ON cli.CliIdCliente = cc.CliIdCliente
JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = a.DocIdDocumento
LEFT JOIN dbo.Ordenes o ON o.OrdenID = a.OrdIdOrden
LEFT JOIN dbo.OrdenesDeposito od ON od.OrdIdOrden = a.OrdIdOrden
ORDER BY cli.Nombre, a.DDeFechaEmision;

-- Resumen
;WITH Afectadas AS (
    SELECT d.DDeIdDocumento, d.CueIdCuenta, d.DDeImportePendiente, mv.DocIdDocumento
    FROM dbo.DeudaDocumento d
    CROSS APPLY (
        SELECT TOP 1 mf.DocIdDocumento
        FROM dbo.MovimientosCuenta mf
        JOIN dbo.DocumentosContables df ON df.DocIdDocumento = mf.DocIdDocumento AND df.DocEstado <> 'ANULADO'
        WHERE mf.MovTipo = 'ORDEN' AND mf.OrdIdOrden = d.OrdIdOrden AND mf.CueIdCuenta = d.CueIdCuenta
          AND ISNULL(mf.MovAnulado, 0) = 0 AND mf.DocIdDocumento IS NOT NULL
        ORDER BY mf.MovIdMovimiento DESC
    ) mv
    WHERE d.DocIdDocumento IS NULL AND d.OrdIdOrden IS NOT NULL
      AND d.DDeEstado IN ('PENDIENTE', 'VENCIDO', 'PARCIAL')
)
SELECT cc.CueTipo, CASE WHEN dc.DocPagado = 1 THEN 'documento pagado' ELSE 'documento NO pagado' END AS Situacion,
       COUNT(*) AS Deudas, SUM(a.DDeImportePendiente) AS Pendiente
FROM Afectadas a
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = a.CueIdCuenta
JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = a.DocIdDocumento
GROUP BY cc.CueTipo, CASE WHEN dc.DocPagado = 1 THEN 'documento pagado' ELSE 'documento NO pagado' END;

-- ─── FIX ────────────────────────────────────────────────────────────────────
BEGIN TRAN;

UPDATE d
SET    d.DDeEstado = 'CANCELADA',
       d.DDeImportePendiente = 0,
       d.DDeObservaciones = LEFT(CONCAT(ISNULL(d.DDeObservaciones + ' | ', ''),
                                 'Orden facturada en documento #', mv.DocIdDocumento,
                                 ' (script PROD_cerrar_deudas_orden_ya_facturada, ', CONVERT(CHAR(10), GETDATE(), 120), ')'), 500)
FROM dbo.DeudaDocumento d
CROSS APPLY (
    SELECT TOP 1 mf.DocIdDocumento
    FROM dbo.MovimientosCuenta mf
    JOIN dbo.DocumentosContables df ON df.DocIdDocumento = mf.DocIdDocumento AND df.DocEstado <> 'ANULADO'
    WHERE mf.MovTipo = 'ORDEN' AND mf.OrdIdOrden = d.OrdIdOrden AND mf.CueIdCuenta = d.CueIdCuenta
      AND ISNULL(mf.MovAnulado, 0) = 0 AND mf.DocIdDocumento IS NOT NULL
    ORDER BY mf.MovIdMovimiento DESC
) mv
WHERE d.DocIdDocumento IS NULL AND d.OrdIdOrden IS NOT NULL
  AND d.DDeEstado IN ('PENDIENTE', 'VENCIDO', 'PARCIAL');

PRINT CONCAT('Deudas por orden cerradas: ', @@ROWCOUNT);

ROLLBACK TRAN;   -- ← cambiar por COMMIT TRAN cuando el preview esté conforme

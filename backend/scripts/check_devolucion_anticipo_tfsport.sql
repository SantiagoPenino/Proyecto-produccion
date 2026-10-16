/* ═══════════════════════════════════════════════════════════════════════════
   SOLO LECTURA — Buscar el rastro de una devolución del anticipo de Tamara Flores
   (RC-11, US$4.363,43, 23/06/2026) en PRODUCCIÓN. No modifica nada.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

-- 1) Egresos de caja que mencionen a la clienta o coincidan en monto/fecha
SELECT EgrIdEgreso, EgrFecha, EgrConcepto, EgrProveedor, EgrMonto, EgrMoneda,
       EgrEstado, EgrTipoEgreso, EgrObservaciones, DocIdDocumento
FROM   dbo.EgresosCaja
WHERE  (EgrProveedor LIKE '%amara%' OR EgrProveedor LIKE '%TF SPORT%'
        OR EgrConcepto LIKE '%amara%' OR EgrObservaciones LIKE '%amara%')
   OR  (EgrFecha >= '2026-06-23' AND EgrFecha <= '2026-06-27'
        AND EgrMonto IN (4363.43, 2920.68, 4377.98, 2169.87, 7838.86))
ORDER BY EgrFecha;

-- 2) ¿La transacción del recibo RC-11 (el anticipo) tiene algo raro? (anulación, etc.)
SELECT dc.DocIdDocumento, dc.DocSerie, dc.DocNumero, dc.DocTotal, dc.DocEstado, dc.TcaIdTransaccion
FROM   dbo.DocumentosContables dc WHERE dc.DocIdDocumento = 1519;

-- 3) Movimientos de tipo reverso/devolución/nota de crédito en la cuenta USD de la clienta
SELECT m.MovIdMovimiento, m.MovFecha, m.MovTipo, m.MovImporte, m.MovConcepto, m.MovObservaciones, m.MovAnulado
FROM   dbo.MovimientosCuenta m
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
WHERE  c.IDCliente = 'TF SPORT'
  AND  m.MovTipo IN ('DEVOLUCION','REVERSO','NOTA_CREDITO','NOTA_DEBITO')
ORDER BY m.MovFecha;

-- 4) Las 3 órdenes/documentos cancelados el 24/06 (PC-1117, A-13, A-14): buscar
--    cualquier nota de anulación que mencione devolución o reintegro
SELECT DocIdDocumento, DocSerie, DocNumero, DocTotal, DocEstado, DocFechaEmision
FROM   dbo.DocumentosContables
WHERE  DocIdDocumento IN (1725, 1742, 1753);

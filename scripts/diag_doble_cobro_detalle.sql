/* ============================================================================
   diag_doble_cobro_detalle.sql            SOLO LECTURA — no escribe nada
   ----------------------------------------------------------------------------
   Complemento del panel /admin/cron, sección "Cobro doble: pago por orden y
   por documento". Ese panel solo suma; este script baja al detalle: por cada
   documento marcado, muestra los movimientos de PAGO uno al lado del otro
   (fecha, hora, usuario, PagIdPago, importe) para poder decidir a ojo si son
   el MISMO pago contado dos veces o si de verdad hubo dos cobros distintos.

   Cómo leer el resultado:
     - Grupo = 'ORDEN'     -> el pago quedó atado a la orden (MovTipo PAGO/
                              PAGO_CRUZADO, sin DocIdDocumento).
     - Grupo = 'DOCUMENTO' -> el pago quedó atado al documento (PAGO/
                              PAGO_CRUZADO/ANTICIPO, con DocIdDocumento).
     Si dentro de un mismo Doc las filas de ambos grupos comparten el MISMO
     PagIdPago (o, en su defecto, misma fecha/hora, mismo usuario, mismo
     importe) -> es un único cobro de caja real que el sistema anotó dos
     veces en el libro (el bug). Si el PagIdPago difiere y las fechas/
     usuarios también difieren, revisar caso a caso antes de tocar nada:
     puede ser un documento que agrupa varias órdenes y el "doble" es solo
     una de ellas, o dos cobros realmente distintos.

   NO corre ningún UPDATE/DELETE. Para corregir un caso puntual hay que
   anularlo a mano desde la pantalla correspondiente (o pedir un script
   dedicado), nunca borrando filas de MovimientosCuenta directamente.
   ============================================================================ */

SET NOCOUNT ON;

DECLARE @Top INT = 20;   -- mismo techo que usa el panel; poner NULL para ver todo

WITH OrdDoc AS (
    SELECT DISTINCT o.OrdIdOrden, o.DocIdDocumento, o.CueIdCuenta FROM dbo.MovimientosCuenta o WITH(NOLOCK)
    WHERE o.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND o.DocIdDocumento IS NOT NULL AND (o.MovAnulado IS NULL OR o.MovAnulado = 0)
), PagoOrden AS (
    SELECT p.OrdIdOrden, p.CueIdCuenta, Importe = SUM(p.MovImporte) FROM dbo.MovimientosCuenta p WITH(NOLOCK)
    WHERE p.MovTipo IN ('PAGO','PAGO_CRUZADO') AND p.MovImporte > 0 AND p.DocIdDocumento IS NULL AND p.OrdIdOrden IS NOT NULL
      AND (p.MovAnulado IS NULL OR p.MovAnulado = 0)
    GROUP BY p.OrdIdOrden, p.CueIdCuenta
), PagoDoc AS (
    SELECT d.DocIdDocumento, d.CueIdCuenta, Importe = SUM(d.MovImporte) FROM dbo.MovimientosCuenta d WITH(NOLOCK)
    WHERE d.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO') AND d.MovImporte > 0 AND d.DocIdDocumento IS NOT NULL
      AND (d.MovAnulado IS NULL OR d.MovAnulado = 0)
    GROUP BY d.DocIdDocumento, d.CueIdCuenta
), Marcados AS (
    SELECT TOP (ISNULL(@Top, 100000))
           od.DocIdDocumento, od.OrdIdOrden, od.CueIdCuenta,
           dc.DocSerie, dc.DocNumero, PagoOrdenTotal = SUM(po.Importe)
    FROM OrdDoc od
    JOIN PagoOrden po ON po.OrdIdOrden = od.OrdIdOrden AND po.CueIdCuenta = od.CueIdCuenta
    JOIN PagoDoc  pd ON pd.DocIdDocumento = od.DocIdDocumento AND pd.CueIdCuenta = od.CueIdCuenta
    JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = od.DocIdDocumento
    WHERE RTRIM(dc.DocSerie) IN ('PC','ET','FA') AND ISNULL(dc.DocEstado,'') <> 'ANULADO'
    GROUP BY od.DocIdDocumento, od.OrdIdOrden, od.CueIdCuenta, dc.DocSerie, dc.DocNumero
    ORDER BY SUM(po.Importe) DESC
)
SELECT
    Doc      = RTRIM(mk.DocSerie) + '-' + CAST(mk.DocNumero AS VARCHAR),
    Cliente  = RTRIM(c.Nombre),
    OrdIdOrden = mk.OrdIdOrden,
    Grupo    = CASE WHEN m.DocIdDocumento IS NULL THEN 'ORDEN' ELSE 'DOCUMENTO' END,
    MovId    = m.MovIdMovimiento,
    Fecha    = m.MovFecha,
    Usuario  = RTRIM(ISNULL(u.Usuario,'?')),
    m.MovTipo,
    PagIdPago = m.PagIdPago,   -- mismo PagIdPago en ambas filas = mismo pago de caja duplicado en el libro
    Importe  = CAST(m.MovImporte AS DECIMAL(18,2)),
    Concepto = LEFT(m.MovConcepto, 80)
FROM Marcados mk
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = mk.CueIdCuenta
JOIN dbo.Clientes c        WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
JOIN dbo.MovimientosCuenta m WITH(NOLOCK)
     ON m.CueIdCuenta = mk.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
     AND m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO') AND m.MovImporte > 0
     AND ( (m.DocIdDocumento IS NULL AND m.OrdIdOrden = mk.OrdIdOrden)
           OR (m.DocIdDocumento = mk.DocIdDocumento) )
LEFT JOIN dbo.Usuarios u WITH(NOLOCK) ON u.IdUsuario = m.MovUsuarioAlta
ORDER BY mk.PagoOrdenTotal DESC, mk.DocIdDocumento, Grupo, m.MovFecha;

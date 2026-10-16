/* ============================================================================
   diag_cobro_doble_todos_por_tipo.sql     SOLO LECTURA — no escribe nada
   ----------------------------------------------------------------------------
   Lista TODOS los casos confirmados de cobro doble billetera+caja (misma
   deteccion precisa que fix_cobro_doble_fantasma_cliente.sql: cobertura
   interna sin PagIdPago + pago real con PagIdPago que juntos superan el
   total del documento), con el CLIENTE y su TIPO, para poder priorizar los
   clientes Comunes primero (esos tienen que quedar en cero seguro; los
   Semanales/Rollo pueden tener deuda viva legitima, hay que mirarlos con
   mas cuidado antes de tocarles nada).
   ============================================================================ */

SET NOCOUNT ON;

;WITH OrdDoc AS (
    SELECT DISTINCT o.OrdIdOrden, o.DocIdDocumento, o.CueIdCuenta FROM dbo.MovimientosCuenta o WITH(NOLOCK)
    WHERE o.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND o.DocIdDocumento IS NOT NULL AND (o.MovAnulado IS NULL OR o.MovAnulado = 0)
), PagoOrden AS (
    SELECT p.OrdIdOrden, p.CueIdCuenta, Importe = SUM(p.MovImporte) FROM dbo.MovimientosCuenta p WITH(NOLOCK)
    WHERE p.MovTipo IN ('PAGO','PAGO_CRUZADO') AND p.MovImporte > 0 AND p.DocIdDocumento IS NULL AND p.OrdIdOrden IS NOT NULL
      AND p.PagIdPago IS NULL
      AND (p.MovAnulado IS NULL OR p.MovAnulado = 0)
    GROUP BY p.OrdIdOrden, p.CueIdCuenta
), PagoDoc AS (
    SELECT d.DocIdDocumento, d.CueIdCuenta, Importe = SUM(d.MovImporte) FROM dbo.MovimientosCuenta d WITH(NOLOCK)
    WHERE d.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO') AND d.MovImporte > 0 AND d.DocIdDocumento IS NOT NULL
      AND d.PagIdPago IS NOT NULL
      AND (d.MovAnulado IS NULL OR d.MovAnulado = 0)
    GROUP BY d.DocIdDocumento, d.CueIdCuenta
), Confirmados AS (
    SELECT od.OrdIdOrden, od.DocIdDocumento, od.CueIdCuenta, cc.CliIdCliente,
           Doc = RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR),
           DocTotal = dc.DocTotal,
           PagoOrdenImp = SUM(po.Importe), PagoDocImp = MAX(pd.Importe),
           Duplicado = CASE WHEN SUM(po.Importe) <= MAX(pd.Importe) THEN SUM(po.Importe) ELSE MAX(pd.Importe) END
    FROM OrdDoc od
    JOIN PagoOrden po ON po.OrdIdOrden = od.OrdIdOrden AND po.CueIdCuenta = od.CueIdCuenta
    JOIN PagoDoc  pd ON pd.DocIdDocumento = od.DocIdDocumento AND pd.CueIdCuenta = od.CueIdCuenta
    JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = od.DocIdDocumento
    JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = od.CueIdCuenta
    WHERE RTRIM(dc.DocSerie) IN ('PC','ET','FA') AND ISNULL(dc.DocEstado,'') <> 'ANULADO'
      -- SOLO cuando la cobertura + el pago real juntos superan el total del doc
      -- (si suman igual o menos, ya vimos que el documento cerro bien, no es duplicado real)
      -- y no volver a listar una orden que YA se corrigio (el movimiento original
      -- de cobertura queda en la base tal cual, solo se le agrega un ajuste al lado)
      AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta yac WITH(NOLOCK)
                      WHERE yac.OrdIdOrden = od.OrdIdOrden
                        AND yac.MovConcepto LIKE N'Correccion cobro doble billetera+caja%'
                        AND (yac.MovAnulado IS NULL OR yac.MovAnulado = 0))
    GROUP BY od.OrdIdOrden, od.DocIdDocumento, od.CueIdCuenta, cc.CliIdCliente, dc.DocSerie, dc.DocNumero, dc.DocTotal
    HAVING SUM(po.Importe) + MAX(pd.Importe) > dc.DocTotal + 1
)
SELECT
    Cliente = RTRIM(c.Nombre),
    Tipo = CASE c.TClIdTipoCliente WHEN 1 THEN 'Comun' WHEN 2 THEN 'Semanal' WHEN 3 THEN 'Rollo' WHEN 4 THEN 'Deudor' ELSE 'sin tipo' END,
    f.CliIdCliente, f.OrdIdOrden, f.Doc,
    Duplicado = CAST(f.Duplicado AS DECIMAL(18,2))
FROM Confirmados f
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = f.CliIdCliente
ORDER BY CASE c.TClIdTipoCliente WHEN 1 THEN 0 ELSE 1 END, f.CliIdCliente, f.Duplicado DESC;

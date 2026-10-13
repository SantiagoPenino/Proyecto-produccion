-- Repaso de las órdenes sin cobrar de Matías Siri, setiembre 2026. SOLO LECTURA: no cambia nada.
-- Para correr en producción (SSMS): seleccionar todo y F5. Devuelve 4 grillas.
-- La base guarda las fechas en UTC: 03:00 UTC = medianoche de Uruguay.
SET NOCOUNT ON;
DROP TABLE IF EXISTS #RepasoSiri;

DECLARE @Desde DATETIME = '2026-09-01T03:00:00';
-- Corte en la hora de la foto (30/09 13:27), para comparar las mismas órdenes.
-- Para ver setiembre entero, cambiarlo por '2026-10-01T03:00:00'.
DECLARE @Hasta DATETIME = '2026-09-30T16:27:25';
DECLARE @Cedula NVARCHAR(50) = (SELECT TOP 1 LTRIM(RTRIM(CAST(Cedula AS NVARCHAR(50)))) FROM dbo.Trabajadores
                                WHERE LTRIM(RTRIM(UPPER(ISNULL([Área], '')))) = 'VENTAS' AND Nombre LIKE '%Siri%');

SELECT od.OrdIdOrden, od.OrdCodigoOrden, LTRIM(RTRIM(od.OrdCodigoOrden)) AS Orden, od.CliIdCliente,
       LTRIM(RTRIM(c.Nombre)) AS Cliente, c.TClIdTipoCliente AS TipoCliente, od.OrdEstadoActual AS Estado,
       od.MonIdMoneda, CAST(ISNULL(od.OrdCostoFinal, 0) AS DECIMAL(18,2)) AS Importe, od.PagIdPago,
       cob.Cobrada, gr.Grupo, gr.Motivo
INTO #RepasoSiri
FROM dbo.OrdenesDeposito od WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = od.CliIdCliente
-- ¿Cobrada? Mismo criterio que la pantalla nueva de Ventas por vendedor
OUTER APPLY (
  SELECT
    MAX(CASE WHEN m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND ABS(m.MovImporte) > 0.01
                  AND ISNULL(m.MovObservaciones, '') NOT LIKE 'CUBIERTO%' AND m.CicIdCiclo IS NOT NULL
             THEN 1 ELSE 0 END) AS CargoDeCiclo,
    MAX(CASE WHEN m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND ABS(m.MovImporte) > 0.01
                  AND ISNULL(m.MovObservaciones, '') NOT LIKE 'CUBIERTO%' AND fp.Paga IS NULL
             THEN 1 ELSE 0 END) AS CargoPendiente,
    MAX(CASE WHEN (m.MovTipo = 'ENTREGA' AND (m.MovObservaciones LIKE 'Plan #%'
                                               OR m.MovObservaciones LIKE 'Exceso s/ Plan%'
                                               OR m.MovObservaciones LIKE 'Negativo retroactivo%'))
               OR (m.MovTipo = 'CONSUMO_CUENTA' AND m.MovObservaciones LIKE 'CUBIERTO[_]CUENTA[_]%')
               OR (m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND m.MovObservaciones LIKE 'CUBIERTO%')
               OR (m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND fp.Paga = 1)
             THEN 1 ELSE 0 END) AS CubiertaOPaga
  FROM (SELECT od.OrdIdOrden AS Id
        UNION ALL SELECT o.OrdenID FROM dbo.Ordenes o WITH(NOLOCK) WHERE o.CodigoOrden = od.OrdCodigoOrden) ids
  JOIN dbo.MovimientosCuenta m WITH(NOLOCK) ON m.OrdIdOrden = ids.Id
  JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta AND cc.CliIdCliente = od.CliIdCliente
  OUTER APPLY (
    SELECT TOP 1 1 AS Paga
    FROM dbo.DocumentosContables dc WITH(NOLOCK)
    WHERE dc.DocIdDocumento = m.DocIdDocumento
      AND ISNULL(dc.DocEstado, '') <> 'ANULADO'
      AND NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento d WITH(NOLOCK)
                      WHERE d.DocIdDocumento = dc.DocIdDocumento
                        AND d.DDeEstado NOT IN ('ANULADO', 'CANCELADA', 'CANCELADO')
                        AND d.DDeImportePendiente > 0.01)
      AND (dc.DocPagado = 1
           OR EXISTS (SELECT 1 FROM dbo.DeudaDocumento d WITH(NOLOCK)
                      WHERE d.DocIdDocumento = dc.DocIdDocumento
                        AND d.DDeEstado NOT IN ('ANULADO', 'CANCELADA', 'CANCELADO')))
  ) fp
  WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    AND (od.PagIdPago IS NULL OR od.PagIdPago = 0)
) ev
CROSS APPLY (SELECT CASE
    WHEN od.PagIdPago > 0 THEN 1
    WHEN od.PagIdPago = 0 AND ISNULL(ev.CargoDeCiclo, 0) = 0 THEN 1
    WHEN ev.CubiertaOPaga = 1 AND ISNULL(ev.CargoPendiente, 0) = 0 THEN 1
    ELSE 0 END AS Cobrada) cob
-- Dónde están sus cargos vivos: ciclo abierto, factura, o nada
OUTER APPLY (
  SELECT SUM(x.Vivo) AS Vivos, SUM(x.Anulado) AS Anulados,
         MAX(CASE WHEN x.Vivo = 1 AND x.MovConcepto LIKE '%REVERSA AUT%' THEN 1 ELSE 0 END) AS Reversa,
         MAX(CASE WHEN x.Vivo = 1 AND x.CicEstado = 'ABIERTO' AND x.DocIdDocumento IS NULL THEN 1 ELSE 0 END) AS CicloAbierto,
         MAX(CASE WHEN x.Vivo = 1 AND x.CicEstado = 'ABIERTO' AND x.DocIdDocumento IS NULL AND x.CicFechaInicio < '2026-09-23' THEN 1 ELSE 0 END) AS CicloViejo,
         MAX(CASE WHEN x.Vivo = 1 AND x.CicIdCiclo IS NOT NULL AND x.CicEstado <> 'ABIERTO' THEN 1 ELSE 0 END) AS CicloCerrado,
         MAX(CASE WHEN x.Vivo = 1 AND x.DocIdDocumento IS NOT NULL THEN 1 ELSE 0 END) AS ConFactura,
         MAX(CASE WHEN x.Vivo = 1 AND x.DocIdDocumento IS NOT NULL AND x.DocFechaEmision < '2026-09-28T03:00:00' THEN 1 ELSE 0 END) AS FacturaVieja
  FROM (SELECT m.MovConcepto, m.CicIdCiclo, cic.CicEstado, cic.CicFechaInicio, m.DocIdDocumento, dc.DocFechaEmision,
               CASE WHEN m.MovAnulado = 1 THEN 1 ELSE 0 END AS Anulado,
               CASE WHEN ISNULL(m.MovAnulado, 0) = 0 AND ABS(m.MovImporte) > 0.01
                         AND ISNULL(m.MovObservaciones, '') NOT LIKE 'CUBIERTO%' THEN 1 ELSE 0 END AS Vivo
        FROM (SELECT od.OrdIdOrden AS Id
              UNION ALL SELECT o.OrdenID FROM dbo.Ordenes o WITH(NOLOCK) WHERE o.CodigoOrden = od.OrdCodigoOrden) ids
        JOIN dbo.MovimientosCuenta m WITH(NOLOCK) ON m.OrdIdOrden = ids.Id
        JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta AND cc.CliIdCliente = od.CliIdCliente
        LEFT JOIN dbo.CiclosCredito cic WITH(NOLOCK) ON cic.CicIdCiclo = m.CicIdCiclo
        LEFT JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = m.DocIdDocumento
        WHERE m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')) x
) g
CROSS APPLY (SELECT
  CASE WHEN cob.Cobrada = 1 THEN '0 cobrada'
       WHEN ISNULL(od.OrdCostoFinal, 0) <= 0.01 AND ISNULL(g.Vivos, 0) = 0 THEN '6 para revisar'
       WHEN ISNULL(c.TClIdTipoCliente, 0) <> 2 AND ISNULL(od.OrdEstadoActual, 0) <> 9 THEN '5 no semanal, sin retirar'
       WHEN ISNULL(g.Vivos, 0) = 0 THEN '6 para revisar'
       WHEN g.Reversa = 1 THEN '6 para revisar'
       WHEN g.CicloAbierto = 1 AND ISNULL(c.TClIdTipoCliente, 0) <> 2 THEN '6 para revisar'
       WHEN g.CicloAbierto = 1 AND g.CicloViejo = 1 THEN '4 ciclo abierto desde antes del 23/09, sin facturar'
       WHEN g.CicloAbierto = 1 THEN '3 ciclo abierto desde el 23/09, sin facturar'
       WHEN g.ConFactura = 1 AND g.FacturaVieja = 1 THEN '1 factura anterior al 28/09, impaga'
       WHEN g.ConFactura = 1 THEN '2 factura del 28/09 en adelante, impaga'
       ELSE '6 para revisar' END AS Grupo,
  CASE WHEN cob.Cobrada = 1 THEN ''
       WHEN ISNULL(od.OrdCostoFinal, 0) <= 0.01 AND ISNULL(g.Vivos, 0) = 0 THEN 'importe 0'
       WHEN ISNULL(c.TClIdTipoCliente, 0) <> 2 AND ISNULL(od.OrdEstadoActual, 0) <> 9 THEN ''
       WHEN ISNULL(g.Vivos, 0) = 0 AND od.OrdCodigoOrden LIKE '% (%/%)%' THEN 'sin cargo: parte de un pedido dividido'
       WHEN ISNULL(g.Vivos, 0) = 0 AND g.Anulados > 0 THEN 'sin cargo: el cargo está anulado'
       WHEN ISNULL(g.Vivos, 0) = 0 THEN 'sin cargo: nunca se cargó'
       WHEN g.Reversa = 1 THEN 'débito de la reversa automática'
       WHEN g.CicloAbierto = 1 AND ISNULL(c.TClIdTipoCliente, 0) <> 2 THEN 'cliente no semanal con ciclo abierto'
       WHEN g.CicloAbierto = 1 OR g.ConFactura = 1 THEN ''
       WHEN g.CicloCerrado = 1 THEN 'cargo en un ciclo cerrado, sin factura'
       ELSE 'entregada con la deuda de la orden sin pagar' END AS Motivo) gr
WHERE od.OrdFechaIngresoOrden >= @Desde AND od.OrdFechaIngresoOrden < @Hasta
  AND LTRIM(RTRIM(c.VendedorID)) = @Cedula
  AND od.OrdCodigoOrden NOT LIKE '%-R%' AND od.OrdCodigoOrden NOT LIKE '%-F%'
  AND (od.OrdEstadoActual IS NULL OR od.OrdEstadoActual NOT IN (10, 11));

-- 1) Resumen por grupo, al lado de lo que había en la foto del 30/09 13:27
SELECT a.Grupo, f.OrdenesFoto, a.Ordenes AS OrdenesAhora, a.Ordenes - f.OrdenesFoto AS Diferencia, a.USD, a.Pesos
FROM (SELECT Grupo, COUNT(*) AS Ordenes,
             CAST(SUM(CASE WHEN MonIdMoneda = 2 THEN Importe ELSE 0 END) AS DECIMAL(18,2)) AS USD,
             CAST(SUM(CASE WHEN ISNULL(MonIdMoneda, 1) <> 2 THEN Importe ELSE 0 END) AS DECIMAL(18,2)) AS Pesos
      FROM #RepasoSiri GROUP BY Grupo) a
LEFT JOIN (VALUES ('0', 1383), ('1', 146), ('2', 111), ('3', 141), ('4', 113), ('5', 72), ('6', 28)) f(G, OrdenesFoto)
       ON f.G = LEFT(a.Grupo, 1)
ORDER BY a.Grupo;

-- 2) Facturas anteriores al 28/09 con órdenes de setiembre: las que siguen impagas y las que se cobraron después de la foto
SELECT x.Cliente, CONCAT(dc.DocSerie, '-', LTRIM(RTRIM(dc.DocNumero))) AS Factura,
       CONVERT(VARCHAR(10), DATEADD(HOUR, -3, dc.DocFechaEmision), 103) AS Emitida,
       CASE WHEN dc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END AS Moneda,
       CAST(dc.DocTotal AS DECIMAL(18,2)) AS Total, d.DDeEstado AS Estado,
       CAST(d.DDeImportePendiente AS DECIMAL(18,2)) AS Pendiente,
       CONVERT(VARCHAR(16), DATEADD(HOUR, -3, d.DDeFechaCobro), 120) AS CobradaEl,
       x.Ordenes AS OrdenesDeSetiembre
FROM (SELECT m.DocIdDocumento, MIN(r.Cliente) AS Cliente, COUNT(DISTINCT r.OrdIdOrden) AS Ordenes
      FROM #RepasoSiri r
      CROSS APPLY (SELECT r.OrdIdOrden AS Id
                   UNION ALL SELECT o.OrdenID FROM dbo.Ordenes o WITH(NOLOCK) WHERE o.CodigoOrden = r.OrdCodigoOrden) ids
      JOIN dbo.MovimientosCuenta m WITH(NOLOCK) ON m.OrdIdOrden = ids.Id
      JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta AND cc.CliIdCliente = r.CliIdCliente
      WHERE m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO') AND ISNULL(m.MovAnulado, 0) = 0 AND ABS(m.MovImporte) > 0.01
        AND ISNULL(m.MovObservaciones, '') NOT LIKE 'CUBIERTO%'
        AND m.DocIdDocumento IS NOT NULL AND (r.PagIdPago IS NULL OR r.PagIdPago = 0)
      GROUP BY m.DocIdDocumento) x
JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = x.DocIdDocumento
OUTER APPLY (SELECT TOP 1 dd.DDeEstado, dd.DDeImportePendiente, dd.DDeFechaCobro
             FROM dbo.DeudaDocumento dd WITH(NOLOCK)
             WHERE dd.DocIdDocumento = dc.DocIdDocumento AND dd.DDeEstado NOT IN ('ANULADO', 'CANCELADA', 'CANCELADO')
             ORDER BY dd.DDeIdDocumento DESC) d
WHERE dc.DocFechaEmision < '2026-09-28T03:00:00'
  AND (d.DDeImportePendiente > 0.01 OR d.DDeFechaCobro >= '2026-09-30T16:27:25')
ORDER BY x.Cliente, dc.DocFechaEmision;

-- 3) Ciclos de semanales abiertos desde antes del 23/09: los que siguen abiertos y los que se cerraron después de la foto
SELECT x.Cliente, cic.CicIdCiclo AS Ciclo,
       CASE WHEN cc.CueTipo = 'DINERO_USD' THEN 'US$' ELSE '$' END AS Moneda,
       CONVERT(VARCHAR(10), cic.CicFechaInicio, 103) AS AbiertoDesde, cic.CicEstado AS Estado,
       CONVERT(VARCHAR(16), DATEADD(HOUR, -3, cic.CicFechaCierre), 120) AS CerradoEl,
       LTRIM(RTRIM(cic.CicNumeroFactura)) AS Factura,
       x.Ordenes AS OrdenesDeSetiembre, CAST(x.Importe AS DECIMAL(18,2)) AS ImporteDeEsasOrdenes
FROM (SELECT m.CicIdCiclo, MIN(r.Cliente) AS Cliente, COUNT(DISTINCT r.OrdIdOrden) AS Ordenes, SUM(ABS(m.MovImporte)) AS Importe
      FROM #RepasoSiri r
      CROSS APPLY (SELECT r.OrdIdOrden AS Id
                   UNION ALL SELECT o.OrdenID FROM dbo.Ordenes o WITH(NOLOCK) WHERE o.CodigoOrden = r.OrdCodigoOrden) ids
      JOIN dbo.MovimientosCuenta m WITH(NOLOCK) ON m.OrdIdOrden = ids.Id
      JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta AND cc.CliIdCliente = r.CliIdCliente
      WHERE m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO') AND ISNULL(m.MovAnulado, 0) = 0 AND ABS(m.MovImporte) > 0.01
        AND ISNULL(m.MovObservaciones, '') NOT LIKE 'CUBIERTO%'
        AND m.CicIdCiclo IS NOT NULL AND r.TipoCliente = 2
      GROUP BY m.CicIdCiclo) x
JOIN dbo.CiclosCredito cic WITH(NOLOCK) ON cic.CicIdCiclo = x.CicIdCiclo
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = cic.CueIdCuenta
WHERE cic.CicFechaInicio < '2026-09-23'
  AND (cic.CicEstado = 'ABIERTO' OR cic.CicFechaCierre >= '2026-09-30T16:27:25')
ORDER BY x.Cliente, cic.CicFechaInicio;

-- 4) Para revisar: las 28 de la foto (cómo están ahora) y las que aparecieron después
SELECT COALESCE(r.Orden, f.Orden) AS Orden, r.Cliente,
       CASE WHEN r.Orden IS NULL THEN NULL WHEN r.MonIdMoneda = 2 THEN 'US$' ELSE '$' END AS Moneda, r.Importe,
       CASE WHEN f.Orden IS NOT NULL THEN 'sí' ELSE 'no' END AS EnLaFoto,
       CASE WHEN r.Orden IS NULL THEN 'ya no cuenta como venta del mes'
            WHEN r.Cobrada = 1 THEN 'cobrada' ELSE r.Grupo END AS Ahora,
       r.Motivo
FROM (VALUES
        ('VEN-2388'), ('EUV-20137'), ('EMB-4349'), ('SUB-20658'), ('SUB-20538'), ('SUB-21021'), ('SUB-22697'),
        ('SUB-25092'), ('SUB-25818'), ('SUB-25819'), ('SUB-28566'), ('SUB-28163'), ('DTF-20399'), ('DTF-22148'),
        ('DTF-19705'), ('DTF-20856'), ('DTF-20855'), ('EUV-20836'), ('DTF-21749'), ('SUB-27325'), ('SUB-26861'),
        ('SUB-27644'), ('SUB-20229 (2/2)'), ('SUB-20553 (1/2)'), ('SUB-23071 (1/2)'), ('SUB-25691 (2/2)'), ('DTF-22364'), ('SUB-26273')
     ) f(Orden)
FULL OUTER JOIN #RepasoSiri r ON r.Orden = f.Orden
WHERE f.Orden IS NOT NULL OR r.Grupo LIKE '6%'
ORDER BY EnLaFoto DESC, Ahora, r.Motivo, r.Cliente, Orden;

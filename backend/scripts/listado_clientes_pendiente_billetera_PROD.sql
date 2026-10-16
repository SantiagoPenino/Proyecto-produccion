-- SOLO LECTURA — correr directo en producción (SSMS), no modifica nada.
-- Listado de TODOS los clientes con Pendiente y Billetera en ambas monedas + Tipo de cliente.
-- Misma lógica que usa el Panel 360 del Cliente (dedup de DeudaDocumento) y el saldo
-- EN VIVO de las cuentas de dinero (NO el CueSaldoActual cacheado, que puede estar mal).
-- Resultado: un cliente por fila. Clic derecho en el grid de resultados -> "Save Results As..." para exportar a CSV/Excel.

;WITH docs AS (
  SELECT dc.CliIdCliente, dc.DocEstado, dc.DocPagado,
         CAST(dc.DocTotal AS DECIMAL(18,2)) AS DocTotal,
         dc.MonIdMoneda, pv.PendVivo, pv.OrigVivo
  FROM dbo.DocumentosContables dc WITH(NOLOCK)
  OUTER APPLY (
    SELECT TOP 1 dd.DDeImportePendiente AS PendVivo, dd.DDeImporteOriginal AS OrigVivo
    FROM dbo.DeudaDocumento dd WITH(NOLOCK)
    WHERE dd.DocIdDocumento = dc.DocIdDocumento
      AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA','PAGADO','CANCELADO','ANULADO')
    ORDER BY CASE WHEN ABS(dd.DDeImporteOriginal - dc.DocTotal) <= 2.0 THEN 0 ELSE 1 END,
             dd.DDeImportePendiente ASC, ABS(dd.DDeImporteOriginal - dc.DocTotal) ASC, dd.DDeIdDocumento
  ) pv
  WHERE dc.DocTipo NOT LIKE '%ecibo%' AND dc.DocTipo NOT LIKE '%greso%'
),
calc AS (
  SELECT CliIdCliente, MonIdMoneda,
    CASE
      WHEN DocEstado LIKE '%ANULAD%' THEN 0
      WHEN PendVivo IS NOT NULL THEN
        CASE WHEN PendVivo < 0 THEN 0
             WHEN PendVivo > ISNULL(OrigVivo, DocTotal) THEN ISNULL(OrigVivo, DocTotal)
             ELSE PendVivo END
      WHEN DocPagado = 1 THEN 0
      ELSE ISNULL(OrigVivo, DocTotal)
    END AS Pendiente
  FROM docs
),
pendientePorCliente AS (
  SELECT CliIdCliente,
         SUM(CASE WHEN MonIdMoneda = 1 THEN Pendiente ELSE 0 END) AS PendientePesos,
         SUM(CASE WHEN MonIdMoneda = 2 THEN Pendiente ELSE 0 END) AS PendienteDolares
  FROM calc
  WHERE Pendiente > 0.01
  GROUP BY CliIdCliente
),
billeteraPorCuenta AS (
  SELECT cc.CliIdCliente, cc.MonIdMoneda,
         ISNULL((
           SELECT SUM(m.MovImporte)
           FROM dbo.MovimientosCuenta m WITH(NOLOCK)
           WHERE m.CueIdCuenta = cc.CueIdCuenta
             AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
             AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')
         ), 0) AS Saldo
  FROM dbo.CuentasCliente cc
  WHERE cc.CueTipo IN ('DINERO_UYU', 'DINERO_USD')
),
billeteraPorCliente AS (
  SELECT CliIdCliente,
         SUM(CASE WHEN MonIdMoneda = 1 THEN Saldo ELSE 0 END) AS BilleteraPesos,
         SUM(CASE WHEN MonIdMoneda = 2 THEN Saldo ELSE 0 END) AS BilleteraDolares
  FROM billeteraPorCuenta
  GROUP BY CliIdCliente
)
SELECT
  RTRIM(ISNULL(c.NombreFantasia, c.Nombre))       AS Cliente,
  RTRIM(c.IDCliente)                              AS IDCliente,
  ISNULL(RTRIM(tc.TClDescripcion), 'Sin tipo')    AS Tipo,
  CAST(ISNULL(p.PendientePesos, 0)   AS DECIMAL(18,2)) AS [Pendiente $],
  CAST(ISNULL(p.PendienteDolares, 0) AS DECIMAL(18,2)) AS [Pendiente US$],
  CAST(ISNULL(b.BilleteraPesos, 0)   AS DECIMAL(18,2)) AS [Billetera $],
  CAST(ISNULL(b.BilleteraDolares, 0) AS DECIMAL(18,2)) AS [Billetera US$]
FROM dbo.Clientes c
LEFT JOIN dbo.TiposClientes tc          ON tc.TClIdTipoCliente = c.TClIdTipoCliente
LEFT JOIN pendientePorCliente p         ON p.CliIdCliente = c.CliIdCliente
LEFT JOIN billeteraPorCliente b         ON b.CliIdCliente = c.CliIdCliente
WHERE EXISTS (SELECT 1 FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = c.CliIdCliente)
ORDER BY Cliente;

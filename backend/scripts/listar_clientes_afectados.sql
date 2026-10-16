/* ============================================================
   LISTA los clientes con desfasaje entre el estado de cuenta y sus facturas
   (línea CIERRE_CICLO/VTA_CAJA con |MovImporte| != DocTotal).
   Clasifica por variante:
     A = libro mayor infló (|MovImporte| > DocTotal, factura consistente)
     B = libro mayor facturó de menos (factura consistente)
     C = factura inconsistente (DocTotal != suma de sus líneas)
   Solo lectura. El IDCliente es el que se usa en fix_saldo_por_cliente.sql.
   ============================================================ */
WITH desf AS (
  SELECT cc.CliIdCliente,
         RTRIM(cli.IDCliente)      AS IDCliente,
         RTRIM(cli.NombreFantasia) AS Cliente,
         CAST(ABS(m.MovImporte) - doc.DocTotal AS DECIMAL(18,4)) AS Diferencia,
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento = doc.DocIdDocumento)
             OR ABS(doc.DocTotal - ISNULL((SELECT SUM(d.DcdTotal) FROM dbo.DocumentosContablesDetalle d
                                           WHERE d.DocIdDocumento = doc.DocIdDocumento), 0)) > 0.05
           THEN 'C'
           WHEN ABS(m.MovImporte) - doc.DocTotal > 0 THEN 'A'
           ELSE 'B'
         END AS Variante
  FROM dbo.MovimientosCuenta   m
  JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = m.DocIdDocumento
  JOIN dbo.CuentasCliente      cc  ON cc.CueIdCuenta     = m.CueIdCuenta
  JOIN dbo.Clientes            cli ON cli.CliIdCliente   = cc.CliIdCliente
  WHERE m.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    AND m.MovImporte <> 0
    AND (doc.DocEstado IS NULL OR doc.DocEstado NOT LIKE '%ANULAD%')
    AND ISNULL(doc.MonIdMoneda, cc.MonIdMoneda) = cc.MonIdMoneda
    AND ABS(ABS(m.MovImporte) - doc.DocTotal) > 0.01
)
SELECT
    CliIdCliente,
    IDCliente,
    Cliente,
    SUM(CASE WHEN Variante = 'A' THEN 1 ELSE 0 END) AS A,
    SUM(CASE WHEN Variante = 'B' THEN 1 ELSE 0 END) AS B,
    SUM(CASE WHEN Variante = 'C' THEN 1 ELSE 0 END) AS C,
    COUNT(*)                                        AS Total,
    CAST(SUM(Diferencia) AS DECIMAL(18,2))          AS AjusteSaldoEstimado
FROM desf
GROUP BY CliIdCliente, IDCliente, Cliente
ORDER BY
    (CASE WHEN SUM(CASE WHEN Variante='C' THEN 1 ELSE 0 END) > 0 THEN 2 ELSE 0 END)
  + (CASE WHEN SUM(CASE WHEN Variante='B' THEN 1 ELSE 0 END) > 0 THEN 1 ELSE 0 END),
    Cliente;

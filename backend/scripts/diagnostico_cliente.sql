/* ============================================================
   DIAGNÓSTICO DE UN CLIENTE — correr en SSMS. SOLO LECTURA (no modifica nada).
   Poné el código en @IDCliente y ejecutá (F5). Devuelve 5 grillas de resultado.
   Es el gemelo SQL de diagnostico_cliente.js (por si no querés usar Node).
   ============================================================ */

DECLARE @IDCliente VARCHAR(50) = 'capa';   -- <<<<<<<< CAMBIAR por cada cliente

SET NOCOUNT ON;

DECLARE @CliId INT = (SELECT TOP 1 CliIdCliente FROM dbo.Clientes WHERE RTRIM(IDCliente) = @IDCliente);

/* ---- 0) Cliente ---- */
SELECT @IDCliente AS IDCliente, @CliId AS CliIdCliente,
       (SELECT RTRIM(NombreFantasia) FROM dbo.Clientes WHERE CliIdCliente = @CliId) AS Nombre;

/* ---- 1) CUENTAS: saldo actual (ledger) vs saldo corregido (la factura manda) ---- */
SELECT cc.CueIdCuenta, RTRIM(cc.CueTipo) AS Tipo,
  CAST(ISNULL((SELECT SUM(mm.MovImporte) FROM dbo.MovimientosCuenta mm
       WHERE mm.CueIdCuenta = cc.CueIdCuenta AND (mm.MovAnulado IS NULL OR mm.MovAnulado = 0)
         AND mm.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)) AS SaldoActual,
  CAST(ISNULL((SELECT SUM(CASE
         WHEN mm.MovTipo IN ('CIERRE_CICLO','VTA_CAJA') AND mm.MovImporte <> 0 AND dc.DocIdDocumento IS NOT NULL
              AND ISNULL(dc.MonIdMoneda, cc2.MonIdMoneda) = cc2.MonIdMoneda
              AND (dc.DocEstado IS NULL OR dc.DocEstado NOT LIKE '%ANULAD%')
              AND ABS(ABS(mm.MovImporte) - dc.DocTotal) > 0.01
         THEN -dc.DocTotal ELSE mm.MovImporte END)
       FROM dbo.MovimientosCuenta mm
       LEFT JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = mm.DocIdDocumento
       JOIN dbo.CuentasCliente cc2 ON cc2.CueIdCuenta = mm.CueIdCuenta
       WHERE mm.CueIdCuenta = cc.CueIdCuenta AND (mm.MovAnulado IS NULL OR mm.MovAnulado = 0)
         AND mm.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)) AS SaldoCorregido
FROM dbo.CuentasCliente cc
WHERE cc.CliIdCliente = @CliId AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD')
ORDER BY Tipo;

/* ---- 2) DESFASAJES: línea de facturación (ledger) vs factura (DocTotal) ---- */
SELECT
    RTRIM(doc.DocSerie) + '-' + RTRIM(CAST(doc.DocNumero AS VARCHAR)) AS Comprobante,
    m.MovTipo, m.MovIdMovimiento AS MovId,
    CAST(m.MovImporte AS DECIMAL(18,2))    AS LedgerAhora,
    CAST(-doc.DocTotal AS DECIMAL(18,2))   AS Correccion,
    CAST(doc.DocTotal AS DECIMAL(18,2))    AS DocTotal,
    CAST(ISNULL((SELECT SUM(d.DcdTotal) FROM dbo.DocumentosContablesDetalle d
                 WHERE d.DocIdDocumento = doc.DocIdDocumento), 0) AS DECIMAL(18,2)) AS SumaLineas,
    CASE WHEN NOT EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento = doc.DocIdDocumento)
              OR ABS(doc.DocTotal - ISNULL((SELECT SUM(d.DcdTotal) FROM dbo.DocumentosContablesDetalle d
                                            WHERE d.DocIdDocumento = doc.DocIdDocumento), 0)) > 0.05
         THEN 'C' WHEN ABS(m.MovImporte) - doc.DocTotal > 0 THEN 'A' ELSE 'B' END AS Variante,
    (SELECT COUNT(*) FROM dbo.MovimientosCuenta m2 WHERE m2.DocIdDocumento = doc.DocIdDocumento
       AND m2.MovTipo IN ('CIERRE_CICLO','VTA_CAJA') AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0)
       AND m2.MovImporte <> 0) AS NLineas
FROM dbo.MovimientosCuenta m
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = m.DocIdDocumento
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @CliId AND m.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND m.MovImporte <> 0
  AND (doc.DocEstado IS NULL OR doc.DocEstado NOT LIKE '%ANULAD%')
  AND ISNULL(doc.MonIdMoneda, cc.MonIdMoneda) = cc.MonIdMoneda
  AND ABS(ABS(m.MovImporte) - doc.DocTotal) > 0.01
ORDER BY Variante, Comprobante;

/* ---- 3) DeudaDocumento DUPLICADAS (afecta el cobro; la que = factura es la buena) ---- */
;WITH dup AS (
    SELECT d.DocIdDocumento
    FROM dbo.DeudaDocumento d
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = d.CueIdCuenta
    WHERE cc.CliIdCliente = @CliId AND d.DocIdDocumento IS NOT NULL
      AND d.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND d.DDeImportePendiente > 0.01
    GROUP BY d.DocIdDocumento HAVING COUNT(*) > 1
)
SELECT RTRIM(doc.DocSerie) + '-' + RTRIM(CAST(doc.DocNumero AS VARCHAR)) AS Comprobante,
       d.DDeIdDocumento AS DDeId, d.DDeEstado,
       CAST(d.DDeImporteOriginal AS DECIMAL(18,2))  AS Orig,
       CAST(d.DDeImportePendiente AS DECIMAL(18,2)) AS Pend,
       CAST(doc.DocTotal AS DECIMAL(18,2)) AS DocTotal,
       CASE WHEN ABS(d.DDeImporteOriginal - doc.DocTotal) <= 2 THEN 'coincide con factura' ELSE 'FANTASMA (cancelar)' END AS Nota
FROM dbo.DeudaDocumento d
JOIN dup ON dup.DocIdDocumento = d.DocIdDocumento
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = d.DocIdDocumento
WHERE d.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND d.DDeImportePendiente > 0.01
ORDER BY Comprobante, d.DDeIdDocumento;

/* ---- 4) ÓRDENES EN LIMBO (anuladas / huérfanas, sin documento) ---- */
SELECT m.MovIdMovimiento AS MovId, ISNULL(mo.MonSimbolo,'?') AS Mon,
       CAST(ABS(m.MovImporte) AS DECIMAL(18,2)) AS Importe, m.CicIdCiclo AS Ciclo,
       CONVERT(varchar(10), m.MovFecha, 23) AS Fecha, LEFT(LTRIM(RTRIM(m.MovConcepto)),40) AS Concepto
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
LEFT JOIN dbo.Monedas mo ON mo.MonIdMoneda = cc.MonIdMoneda
WHERE cc.CliIdCliente = @CliId AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND m.MovAnulado = 1
ORDER BY m.MovIdMovimiento DESC;

/* Interpretación rápida:
   - Grilla 1: si SaldoActual != SaldoCorregido, el cliente necesita el fix. SaldoCorregido = como quedará.
   - Grilla 2: cada doc a corregir. Variante A/B = seguro (si NLineas=1). Variante C = re-facturar antes.
   - Grilla 3: filas de deuda duplicadas (la 'FANTASMA' es la que sobra en el cobro).
   - Grilla 4: órdenes anuladas/huérfanas (informativo).
   Para corregir: fix_saldo_por_cliente.sql con el mismo @IDCliente. */

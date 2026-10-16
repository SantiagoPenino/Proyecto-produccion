/* ═══════════════════════════════════════════════════════════════════════════
   DIAGNÓSTICO SOLO LECTURA — Favio Curbelo (FVR), cuenta USD  ·  28-jul-2026
   No modifica nada. Correr y pasar el resultado.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

-- 1) Todos los movimientos de dinero (no-ORDEN) de la cuenta USD de Favio Curbelo
SELECT m.MovIdMovimiento, m.MovTipo, LEFT(m.MovConcepto,50) AS Concepto, m.MovImporte,
       m.DocIdDocumento, CONVERT(varchar(16), m.MovFecha, 120) AS Fecha, m.MovAnulado
FROM   dbo.MovimientosCuenta m
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
WHERE  LTRIM(RTRIM(c.IDCliente)) = 'FVR' AND cc.CueTipo = 'DINERO_USD'
  AND  m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
ORDER BY m.MovIdMovimiento;

-- 2) Deudas vivas de esa cuenta (debe incluir la FA-332 nueva)
SELECT d.DDeIdDocumento, d.DocIdDocumento,
       LTRIM(RTRIM(dc.DocSerie))+'-'+LTRIM(RTRIM(dc.DocNumero)) AS Doc,
       dc.DocTotal, d.DDeImporteOriginal, d.DDeImportePendiente, d.DDeEstado,
       CONVERT(varchar(10), d.DDeFechaEmision, 120) AS DeudaEmi
FROM   dbo.DeudaDocumento d
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = d.CueIdCuenta
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = d.DocIdDocumento
WHERE  LTRIM(RTRIM(c.IDCliente)) = 'FVR' AND cc.CueTipo = 'DINERO_USD'
  AND  d.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
ORDER BY d.DDeIdDocumento;

-- 3) Billetera recalculada (debe coincidir con lo que muestra el 360)
SELECT CAST(SUM(CASE WHEN m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                      THEN m.MovImporte END) AS DECIMAL(18,2)) AS Billetera
FROM   dbo.MovimientosCuenta m
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
WHERE  LTRIM(RTRIM(c.IDCliente)) = 'FVR' AND cc.CueTipo = 'DINERO_USD';

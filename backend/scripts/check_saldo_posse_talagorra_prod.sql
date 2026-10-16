/* ═══════════════════════════════════════════════════════════════════════════
   SOLO LECTURA — Saldos de TALAGORRA / Posse Gutierrez Santiago  (RUC 150971030017)
   Para correr en PRODUCCIÓN (SecureAppDB). No modifica nada.
   7-ago-2026. Sirve para comparar contra lo que da la réplica local.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

DECLARE @Cli INT = (SELECT TOP 1 CliIdCliente FROM dbo.Clientes WHERE CioRuc LIKE '%150971030017%');
SELECT @Cli AS CliIdCliente_detectado;

/* ── 1) Cuentas del cliente: saldo GUARDADO ───────────────────────────────── */
SELECT cc.CueIdCuenta, cc.CueTipo, cc.CueSaldoActual AS SaldoGuardado,
       mo.MonSimbolo, cc.ProIdProducto
FROM   dbo.CuentasCliente cc
LEFT   JOIN dbo.Monedas mo ON mo.MonIdMoneda = cc.MonIdMoneda
WHERE  cc.CliIdCliente = @Cli
ORDER  BY cc.CueTipo;

/* ── 2) Saldo REAL vs guardado (el real excluye los movimientos ORDEN, que ya
        están representados en el CIERRE_CICLO / VTA_CAJA de su factura) ────── */
SELECT cc.CueIdCuenta, cc.CueTipo,
       cc.CueSaldoActual AS SaldoGuardado,
       CAST(SUM(CASE WHEN m.MovTipo NOT LIKE 'ORDEN%'
                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                     THEN m.MovImporte END) AS DECIMAL(18,2)) AS SaldoReal,
       CAST(cc.CueSaldoActual
            - SUM(CASE WHEN m.MovTipo NOT LIKE 'ORDEN%'
                        AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       THEN m.MovImporte END) AS DECIMAL(18,2)) AS Diferencia
FROM   dbo.CuentasCliente cc
JOIN   dbo.MovimientosCuenta m ON m.CueIdCuenta = cc.CueIdCuenta
WHERE  cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_USD','DINERO_UYU')
GROUP  BY cc.CueIdCuenta, cc.CueTipo, cc.CueSaldoActual;

/* ── 3) De qué se compone el saldo, por tipo de movimiento ─────────────────── */
SELECT cc.CueTipo, m.MovTipo,
       CASE WHEN m.MovTipo LIKE 'ORDEN%' AND m.DocIdDocumento IS NULL THEN 'ORDEN sin facturar (ciclo abierto)'
            WHEN m.MovTipo LIKE 'ORDEN%'                              THEN 'ORDEN ya facturada (NO suma)'
            ELSE '' END AS Detalle,
       COUNT(*) AS Movs, CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) AS Total
FROM   dbo.MovimientosCuenta m
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE  cc.CliIdCliente = @Cli AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
GROUP  BY cc.CueTipo, m.MovTipo,
         CASE WHEN m.MovTipo LIKE 'ORDEN%' AND m.DocIdDocumento IS NULL THEN 'ORDEN sin facturar (ciclo abierto)'
              WHEN m.MovTipo LIKE 'ORDEN%'                              THEN 'ORDEN ya facturada (NO suma)'
              ELSE '' END
ORDER  BY cc.CueTipo, m.MovTipo;

/* ── 4) Estado de cuenta: TODOS los movimientos que mueven plata, con saldo corrido ── */
SELECT m.MovIdMovimiento, CONVERT(VARCHAR(16), m.MovFecha, 120) AS Fecha, m.MovTipo,
       m.MovImporte,
       CAST(SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta
                                    ORDER BY m.MovFecha, m.MovIdMovimiento
                                    ROWS UNBOUNDED PRECEDING) AS DECIMAL(18,2)) AS SaldoCorrido,
       m.DocIdDocumento, m.PagIdPago, LEFT(m.MovConcepto, 60) AS Concepto
FROM   dbo.MovimientosCuenta m
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE  cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_USD','DINERO_UYU')
  AND  m.MovTipo NOT LIKE 'ORDEN%' AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
ORDER  BY m.CueIdCuenta, m.MovFecha, m.MovIdMovimiento;

/* ── 5) Deudas: TODAS (aunque estén en 0) ─────────────────────────────────── */
SELECT dd.DDeIdDocumento, dd.CueIdCuenta, dd.DocIdDocumento,
       dc.DocSerie + '-' + CAST(dc.DocNumero AS VARCHAR(20)) AS Doc,
       dc.DocTipo, dc.DocTotal, CONVERT(VARCHAR(10), dc.DocFechaEmision, 23) AS Emision,
       dc.DocEstado, dc.DocPagado,
       dd.DDeImporteOriginal, dd.DDeImportePendiente, dd.DDeEstado
FROM   dbo.DeudaDocumento dd
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
LEFT   JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = dd.DocIdDocumento
WHERE  cc.CliIdCliente = @Cli
ORDER  BY dd.DDeIdDocumento DESC;

/* ── 6) Deudas DUPLICADAS (mismo documento con 2+ filas) ───────────────────── */
SELECT dd.DocIdDocumento, COUNT(*) AS Filas,
       SUM(dd.DDeImporteOriginal)  AS OriginalTotal,
       SUM(dd.DDeImportePendiente) AS PendienteTotal
FROM   dbo.DeudaDocumento dd
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
WHERE  cc.CliIdCliente = @Cli AND dd.DocIdDocumento IS NOT NULL
GROUP  BY dd.DocIdDocumento
HAVING COUNT(*) > 1;

/* ── 7) Órdenes cargadas DOS VECES a la cuenta (bug doble cargo) ───────────── */
SELECT m.MovConcepto, m.MovImporte, COUNT(*) AS Veces,
       MIN(m.MovIdMovimiento) AS PrimerMov, MAX(m.MovIdMovimiento) AS UltimoMov,
       CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) AS TotalCargado
FROM   dbo.MovimientosCuenta m
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE  cc.CliIdCliente = @Cli AND m.MovTipo LIKE 'ORDEN%'
  AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
GROUP  BY m.MovConcepto, m.MovImporte
HAVING COUNT(*) > 1
ORDER  BY SUM(m.MovImporte);

/* ── 8) Movimientos ANULADOS (por si el saldo guardado nunca los revirtió) ─── */
SELECT m.CueIdCuenta, m.MovIdMovimiento, CONVERT(VARCHAR(16), m.MovFecha, 120) AS Fecha,
       m.MovTipo, m.MovImporte, m.DocIdDocumento, LEFT(m.MovConcepto, 60) AS Concepto
FROM   dbo.MovimientosCuenta m
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE  cc.CliIdCliente = @Cli AND m.MovAnulado = 1
ORDER  BY m.MovIdMovimiento;

/* ── 9) Cuenta de METROS (rollo por adelantado) ────────────────────────────── */
SELECT cc.CueIdCuenta, cc.CueTipo, cc.CueSaldoActual AS MetrosGuardados,
       CAST(SUM(CASE WHEN (m.MovAnulado IS NULL OR m.MovAnulado=0) THEN m.MovImporte END) AS DECIMAL(18,2)) AS MetrosReales
FROM   dbo.CuentasCliente cc
LEFT   JOIN dbo.MovimientosCuenta m ON m.CueIdCuenta = cc.CueIdCuenta
WHERE  cc.CliIdCliente = @Cli AND cc.CueTipo NOT IN ('DINERO_USD','DINERO_UYU')
GROUP  BY cc.CueIdCuenta, cc.CueTipo, cc.CueSaldoActual;

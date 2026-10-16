/* ═══════════════════════════════════════════════════════════════════════════
   PREVIEW — Bucket A (2ª tanda): duplicados exactos en documentos cross-moneda
   ───────────────────────────────────────────────────────────────────────────
   SOLO LECTURA. No escribe nada. No abre transacción.
   Es el PASO 1 de fix_deudas_duplicadas_bucketA2_crossmoneda.sql, aislado,
   para mirar tranquilo antes de tocar nada.

   Criterio: (documento, cuenta) con más de una deuda VIVA del MISMO importe,
   y cuyo cargo EN ESA CUENTA coincide con el total del documento
   (o sea: el saldo del cliente está sano y lo único repetido es la fila de deuda).
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#cand') IS NOT NULL DROP TABLE #cand;

SELECT dd.DocIdDocumento,
       dd.CueIdCuenta,
       dd.DDeImporteOriginal,
       CONCAT(dc.DocSerie,'-',dc.DocNumero) AS Documento,
       dc.DocTotal,
       COUNT(*) AS FilasVivas
INTO   #cand
FROM   dbo.DeudaDocumento dd
JOIN   dbo.DocumentosContables dc ON dc.DocIdDocumento = dd.DocIdDocumento
WHERE  dd.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')
GROUP  BY dd.DocIdDocumento, dd.CueIdCuenta, dd.DDeImporteOriginal,
          dc.DocSerie, dc.DocNumero, dc.DocTotal
HAVING COUNT(*) > 1
   AND ABS(
         ISNULL((SELECT SUM(ABS(m.MovImporte))
                 FROM   dbo.MovimientosCuenta m
                 WHERE  m.DocIdDocumento = dd.DocIdDocumento
                   AND  m.CueIdCuenta    = dd.CueIdCuenta
                   AND  m.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','AJUSTE','FACTURA')
                   AND  ISNULL(m.MovAnulado, 0) = 0), 0)
         - dc.DocTotal
       ) <= 0.01;

/* ── 1) Qué documentos entran, con CLIENTE ────────────────────────────────── */
SELECT cl.Nombre                AS Cliente,
       c.Documento,
       dc.DocTipo,
       dc.DocFechaEmision,
       c.DocTotal,
       cc.CueTipo               AS Cuenta,
       c.CueIdCuenta,
       c.FilasVivas             AS DeudasVivas,
       c.DDeImporteOriginal     AS ImporteDeCadaUna,
       c.FilasVivas * c.DDeImporteOriginal AS PendienteQueMuestraHoy,
       dc.DocPagado
FROM   #cand c
JOIN   dbo.DocumentosContables dc ON dc.DocIdDocumento = c.DocIdDocumento
JOIN   dbo.CuentasCliente      cc ON cc.CueIdCuenta    = c.CueIdCuenta
LEFT JOIN dbo.Clientes         cl ON cl.CliIdCliente   = cc.CliIdCliente
ORDER  BY cl.Nombre, c.Documento;

/* ── 2) Fila por fila: cuál se conserva y cuál se cancelaría ──────────────── */
SELECT cl.Nombre AS Cliente,
       c.Documento,
       dd.DDeIdDocumento,
       dd.CueIdCuenta,
       cc.CueTipo,
       dd.DDeEstado,
       dd.DDeImporteOriginal,
       dd.DDeImportePendiente,
       dd.DDeFechaEmision,
       dd.DDeFechaVencimiento,
       CASE WHEN ROW_NUMBER() OVER (
              PARTITION BY dd.DocIdDocumento, dd.CueIdCuenta, dd.DDeImporteOriginal
              ORDER BY dd.DDeImportePendiente ASC, dd.DDeIdDocumento ASC) = 1
            THEN 'SE CONSERVA' ELSE 'SE CANCELA' END AS Accion
FROM   dbo.DeudaDocumento dd
JOIN   #cand c ON c.DocIdDocumento     = dd.DocIdDocumento
              AND c.CueIdCuenta        = dd.CueIdCuenta
              AND c.DDeImporteOriginal = dd.DDeImporteOriginal
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta  = dd.CueIdCuenta
LEFT JOIN dbo.Clientes    cl ON cl.CliIdCliente = cc.CliIdCliente
WHERE  dd.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')
ORDER  BY cl.Nombre, c.Documento, dd.DDeIdDocumento;

/* ── 3) Control: ¿alguna fila a cancelar recibió cobros? ──────────────────── */
SELECT 'ALERTA - fila a cancelar CON cobros imputados' AS Aviso,
       cl.Nombre AS Cliente, c.Documento, dd.DDeIdDocumento,
       dd.DDeImporteOriginal, dd.DDeImportePendiente
FROM   dbo.DeudaDocumento dd
JOIN   #cand c ON c.DocIdDocumento     = dd.DocIdDocumento
              AND c.CueIdCuenta        = dd.CueIdCuenta
              AND c.DDeImporteOriginal = dd.DDeImporteOriginal
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta  = dd.CueIdCuenta
LEFT JOIN dbo.Clientes    cl ON cl.CliIdCliente = cc.CliIdCliente
WHERE  dd.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')
  AND  dd.DDeImportePendiente < dd.DDeImporteOriginal - 0.01
ORDER  BY cl.Nombre;
-- Si esto devuelve filas: PARAR. Hay que mirarlas a mano.

/* ── 4) El saldo de esas cuentas HOY (para comparar después del fix) ──────── */
SELECT DISTINCT cl.Nombre AS Cliente, cc.CueIdCuenta, cc.CueTipo, cc.CueSaldoActual
FROM   #cand c
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta  = c.CueIdCuenta
LEFT JOIN dbo.Clientes    cl ON cl.CliIdCliente = cc.CliIdCliente
ORDER  BY cl.Nombre;
-- El fix NO toca movimientos ni saldo: estos números tienen que quedar IGUALES.

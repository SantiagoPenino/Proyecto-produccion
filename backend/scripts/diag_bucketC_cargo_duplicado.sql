/* ═══════════════════════════════════════════════════════════════════════════
   DIAGNÓSTICO — Bucket C: el CARGO en cuenta corriente también está duplicado
   ───────────────────────────────────────────────────────────────────────────
   SOLO LECTURA. No modifica nada.

   A diferencia del bucket A (donde solo sobraba la fila en DeudaDocumento y el
   saldo estaba sano), acá el documento generó DOS movimientos de cargo en
   MovimientosCuenta → el CueSaldoActual del cliente está INFLADO de verdad.
   Anular la deuda sobrante NO alcanza: hay que revertir el movimiento duplicado
   y ajustar el saldo por el delta.

   Casos detectados el 22-jul-2026:
     PC-2515  DocId 4950  DocTotal  53.279,60  Cargos 106.559,20  → exacto 2x
     PC-2442  DocId 4814  DocTotal  17.279,54  Cargos  34.559,08  → exacto 2x
     PC-2327  DocId 4629  DocTotal  28.247,60  Cargos  56.495,20  → exacto 2x
     PC-2220  DocId 4462  DocTotal  33.479,61  Cargos  66.959,22  → exacto 2x
     PC-1932  DocId 3153  DocTotal  81.898,47  Cargos 110.832,00  → +28.933,53 (NO es 2x)
     PC-2082  DocId 4014  DocTotal     340,00  Cargos       8,50  → cargo DE MENOS (-331,50)

   Los dos últimos NO son duplicación limpia: tratarlos aparte, uno por uno.
   (PC-2220 ya tiene historia previa: ver fix_pago_mal_aplicado_pc2220.sql)
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

DECLARE @Docs TABLE (DocIdDocumento INT);
INSERT INTO @Docs VALUES (4950), (4814), (4629), (4462), (3153), (4014);

/* ───────────────────────────────────────────────────────────────────────────
   1) Resumen por documento: qué dice el documento vs qué hay en la cuenta
   ─────────────────────────────────────────────────────────────────────────── */
SELECT CONCAT(dc.DocSerie,'-',dc.DocNumero) AS Documento,
       cl.Nombre                            AS Cliente,
       dc.DocFechaEmision, dc.DocTotal, dc.MonIdMoneda, dc.DocEstado, dc.DocPagado,
       (SELECT COUNT(*) FROM dbo.MovimientosCuenta m
         WHERE m.DocIdDocumento = dc.DocIdDocumento
           AND m.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','AJUSTE','FACTURA'))        AS CantCargos,
       (SELECT ISNULL(SUM(ABS(m.MovImporte)),0) FROM dbo.MovimientosCuenta m
         WHERE m.DocIdDocumento = dc.DocIdDocumento
           AND m.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','AJUSTE','FACTURA'))        AS CargosCuenta,
       (SELECT ISNULL(SUM(m.MovImporte),0) FROM dbo.MovimientosCuenta m
         WHERE m.DocIdDocumento = dc.DocIdDocumento
           AND m.MovTipo IN ('PAGO','COBRO'))                                      AS CobrosCuenta,
       (SELECT ISNULL(SUM(d.DDeImporteOriginal),0) FROM dbo.DeudaDocumento d
         WHERE d.DocIdDocumento = dc.DocIdDocumento
           AND d.DDeEstado NOT IN ('ANULADO','ANULADA','CANCELADO','CANCELADA'))   AS DeudaOriginalViva
FROM   dbo.DocumentosContables dc
JOIN   @Docs t          ON t.DocIdDocumento = dc.DocIdDocumento
LEFT JOIN dbo.Clientes cl ON cl.CliIdCliente = dc.CliIdCliente
ORDER  BY dc.DocFechaEmision DESC;

/* ───────────────────────────────────────────────────────────────────────────
   2) LOS MOVIMIENTOS, uno por uno. Acá se decide cuál es el bueno y cuál sobra.
      Mirar: MovFecha (¿segundos de diferencia = doble ejecución?), CueIdCuenta
      (¿la misma cuenta o dos monedas?), MovConcepto, CicIdCiclo.
   ─────────────────────────────────────────────────────────────────────────── */
SELECT CONCAT(dc.DocSerie,'-',dc.DocNumero) AS Documento,
       m.MovIdMovimiento, m.CueIdCuenta, cc.CueTipo,
       m.MovTipo, m.MovFecha, m.MovImporte, m.MovSaldoPosterior, m.MovAnulado,
       m.OrdIdOrden, m.OReIdOrdenRetiro, m.PagIdPago, m.CicIdCiclo,
       m.MovConcepto, m.MovRefExterna, m.MovObservaciones
FROM   dbo.MovimientosCuenta m
JOIN   @Docs t              ON t.DocIdDocumento = m.DocIdDocumento
JOIN   dbo.DocumentosContables dc ON dc.DocIdDocumento = m.DocIdDocumento
LEFT JOIN dbo.CuentasCliente cc   ON cc.CueIdCuenta   = m.CueIdCuenta
ORDER  BY dc.DocNumero, m.MovFecha, m.MovIdMovimiento;

/* ───────────────────────────────────────────────────────────────────────────
   3) Las deudas de esos documentos (para no arreglar la mitad del problema)
   ─────────────────────────────────────────────────────────────────────────── */
SELECT CONCAT(dc.DocSerie,'-',dc.DocNumero) AS Documento,
       d.DDeIdDocumento, d.CueIdCuenta, d.OrdIdOrden, d.DDeEstado,
       d.DDeImporteOriginal, d.DDeImportePendiente,
       d.DDeFechaEmision, d.DDeFechaVencimiento
FROM   dbo.DeudaDocumento d
JOIN   @Docs t              ON t.DocIdDocumento = d.DocIdDocumento
JOIN   dbo.DocumentosContables dc ON dc.DocIdDocumento = d.DocIdDocumento
ORDER  BY dc.DocNumero, d.DDeIdDocumento;

/* ───────────────────────────────────────────────────────────────────────────
   4) Impacto en el saldo: cuánto está inflada cada cuenta por estos documentos
      Delta = lo que se cargó de más. Es lo que habría que descontar del
      CueSaldoActual junto con la reversa del movimiento.
   ─────────────────────────────────────────────────────────────────────────── */
SELECT cc.CueIdCuenta, cc.CueTipo, cl.Nombre AS Cliente, cc.CueSaldoActual,
       SUM(x.Delta)                          AS CargadoDeMas,
       cc.CueSaldoActual + SUM(x.Delta)      AS SaldoSiSeCorrige
FROM (
    SELECT m.CueIdCuenta,
           ISNULL(SUM(ABS(m.MovImporte)),0) - MIN(dc.DocTotal) AS Delta
    FROM   dbo.MovimientosCuenta m
    JOIN   @Docs t              ON t.DocIdDocumento = m.DocIdDocumento
    JOIN   dbo.DocumentosContables dc ON dc.DocIdDocumento = m.DocIdDocumento
    WHERE  m.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','AJUSTE','FACTURA')
    GROUP  BY m.CueIdCuenta, m.DocIdDocumento
) x
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = x.CueIdCuenta
LEFT JOIN dbo.Clientes cl    ON cl.CliIdCliente = cc.CliIdCliente
GROUP  BY cc.CueIdCuenta, cc.CueTipo, cl.Nombre, cc.CueSaldoActual
ORDER  BY ABS(SUM(x.Delta)) DESC;

/* ───────────────────────────────────────────────────────────────────────────
   5) ¿El asiento contable también salió duplicado?
      Si el movimiento duplicado arrastró asiento, revertir uno sin el otro
      descuadra el libro mayor.
   ─────────────────────────────────────────────────────────────────────────── */
SELECT CONCAT(dc.DocSerie,'-',dc.DocNumero) AS Documento,
       dc.AsiIdAsiento    AS AsientoDelDocumento,
       ac.AsiId, ac.AsiFecha, ac.AsiConcepto, ac.AsiEstado, ac.SysOrigen, ac.TcaIdTransaccion,
       ad.CueId, ad.DetDebeUYU, ad.DetHaberUYU, ad.DetImporteOriginal
FROM   dbo.DocumentosContables dc
JOIN   @Docs t ON t.DocIdDocumento = dc.DocIdDocumento
LEFT JOIN dbo.Cont_AsientosCabecera ac
       ON ac.TcaIdTransaccion = dc.TcaIdTransaccion
       OR ac.AsiId            = dc.AsiIdAsiento
LEFT JOIN dbo.Cont_AsientosDetalle ad ON ad.AsiId = ac.AsiId
ORDER  BY dc.DocNumero, ac.AsiId;

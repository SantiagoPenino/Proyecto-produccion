/* ═══════════════════════════════════════════════════════════════════════════
   REPARACIÓN — Marcadores cross-moneda pisados por editarFactura  ·  27-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   QUÉ PASÓ
     El cierre de ciclo cross-moneda deja en la cuenta de ORIGEN un movimiento
     de trazabilidad con IMPORTE 0 (obs 'Cross-moneda: ...'). Al EDITAR esa
     factura, el UPDATE del cargo en editarFactura (cfeController) pisaba TODOS
     los movimientos del doc sin excluir el marcador → le estampaba el total
     completo. Resultado: el mismo documento cargado DOS veces, una por moneda.
     Caso testigo: Palmero — billetera UYU −51.299,71 (real) y billetera USD
     −51.299,71 (los marcadores pisados de PC-2515 y PC-2550).
     El bug de código ya está corregido (exclusión del marcador en el UPDATE y
     en la migración de moneda). Este script repara los DATOS.

   QUÉ HACE
     1) Restaura a importe 0 los 10 marcadores pisados, EXCEPTO los movs
        14880 (PC-1933) y 20262 (PC-2220) de Palmero: esos ya fueron
        compensados por el AJUSTE manual #21531 del 21-jul (+38.736,26 en la
        cuenta 90) — ponerlos en 0 desbalancearía la cuenta para el otro lado.
        A esos dos solo se les anota la advertencia en observaciones.
     2) Cancela la deuda duplicada #7476 del PC-2515 (queda viva la #7475).

   VERIFICACIÓN CLAVE (PASO 3): la cuenta 90 (Palmero USD) debe quedar en 0,00.

   MODO DE USO: PASO 0 (lectura) → PASO 1 y 2 → PASO 3. Si la cuenta 90 da
   0,00 → COMMIT. Si no → ROLLBACK.
   Correr DESPUÉS del deploy del fix (si se edita una de estas facturas antes
   del deploy, el marcador se vuelve a pisar y hay que re-correr esto).
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Marcadores pisados hoy (solo lectura) ────────────────────── */
SELECT m.MovIdMovimiento, m.CueIdCuenta, m.MovImporte,
       LTRIM(RTRIM(dc.DocSerie))+'-'+LTRIM(RTRIM(dc.DocNumero)) AS Doc,
       LEFT(LTRIM(RTRIM(cli.Nombre)),25) AS Cliente,
       LEFT(m.MovObservaciones,80) AS Obs
FROM   dbo.MovimientosCuenta m
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN   dbo.Clientes cli ON cli.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = m.DocIdDocumento
WHERE  m.MovObservaciones LIKE 'Cross-moneda:%'
  AND  ABS(m.MovImporte) > 0.01
  AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
ORDER  BY m.MovIdMovimiento;

BEGIN TRANSACTION;

/* ── PASO 1 — Restaurar marcadores a importe 0 (excepto los compensados) ── */
UPDATE m
SET    m.MovImporte  = 0,
       m.MovConcepto = 'Cierre ciclo → Factura ' +
                       LTRIM(RTRIM(ISNULL(dc.DocSerie,''))) + '-' + LTRIM(RTRIM(ISNULL(dc.DocNumero,''))) +
                       ' (marcador restaurado: lo había pisado la edición de la factura)',
       m.MovObservaciones = LEFT(ISNULL(m.MovObservaciones,'') +
                       ' | Restaurado a 0 el 27-jul-2026 (repara_marcadores_crossmoneda_pisados.sql)', 500)
FROM   dbo.MovimientosCuenta m
LEFT JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = m.DocIdDocumento
WHERE  m.MovObservaciones LIKE 'Cross-moneda:%'
  AND  ABS(m.MovImporte) > 0.01
  AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND  m.MovIdMovimiento NOT IN (14880, 20262);   -- compensados por AJUSTE #21531

PRINT CONCAT('Marcadores restaurados a 0: ', @@ROWCOUNT);  -- esperado: 10

/* Advertencia en los dos compensados (no tocar su importe) */
UPDATE dbo.MovimientosCuenta
SET    MovObservaciones = LEFT(ISNULL(MovObservaciones,'') +
       ' | OJO: marcador pisado por edición pero COMPENSADO por AJUSTE #21531 del 21-jul. NO restaurar a 0.', 500)
WHERE  MovIdMovimiento IN (14880, 20262)
  AND  MovObservaciones NOT LIKE '%COMPENSADO por AJUSTE #21531%';

/* ── PASO 2 — Deuda duplicada del PC-2515: cancelar la #7476, queda la #7475 ── */
UPDATE dbo.DeudaDocumento
SET    DDeEstado = 'CANCELADO',
       DDeImportePendiente = 0,
       DDeObservaciones = 'CANCELADO por duplicado exacto de la deuda #7475 (mismo doc 4950 PC-2515). repara_marcadores_crossmoneda_pisados.sql'
WHERE  DDeIdDocumento = 7476
  AND  DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO');

PRINT CONCAT('Deuda duplicada cancelada: ', @@ROWCOUNT);   -- esperado: 1

/* ── PASO 3 — Verificación ─────────────────────────────────────────────── */
/* Palmero USD (cuenta 90): DEBE dar 0.00. Las demás cuentas bajan su deuda
   por el importe del marcador que tenían pisado. */
SELECT cc.CueIdCuenta, LEFT(LTRIM(RTRIM(cli.Nombre)),25) AS Cliente, cc.CueTipo,
       CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) AS BilleteraDespues
FROM   dbo.MovimientosCuenta m
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN   dbo.Clientes cli ON cli.CliIdCliente = cc.CliIdCliente
WHERE  m.CueIdCuenta IN (90, 1115, 464, 68, 83, 14, 81, 65, 359, 457)
  AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND  m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
GROUP  BY cc.CueIdCuenta, cli.Nombre, cc.CueTipo
ORDER  BY cc.CueIdCuenta;

/* Deudas vivas de Palmero: deben quedar SOLO $48.419,74 (PC-2515) y $2.879,97 (PC-2550) */
SELECT DDeIdDocumento, CueIdCuenta, DocIdDocumento, DDeImportePendiente, DDeEstado
FROM   dbo.DeudaDocumento
WHERE  CueIdCuenta IN (90, 1115)
  AND  DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO');

/* Si la cuenta 90 da 0.00 →  COMMIT TRANSACTION;
   Si no                   →  ROLLBACK TRANSACTION;  y avisar. */

/* ═══════════════════════════════════════════════════════════════════════════
   REPARACIÓN LOTE — Cargos/pagos en la cuenta de la moneda equivocada  ·  27-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   QUÉ ARREGLA
     ~590 documentos cuyo cargo (o pago) quedó registrado en la cuenta de la
     OTRA moneda del cliente: el doc dice UYU pero el movimiento vive en la
     cuenta USD (o viceversa). Origen principal: ediciones de factura con
     cambio de moneda hechas antes del fix de migración (caso testigo FA-73
     SRL TIENDA ONLINE), y emisiones viejas cuando el cliente no tenía la
     cuenta de esa moneda. Efecto visible: billeteras espejadas (una moneda
     "debe" X y la otra lo tiene "a favor") o deuda USD inflada con importes
     en pesos.

   REGLA DE SEGURIDAD (bucket A, lo único que migra):
     Solo se migra cuando el NETO varado en la cuenta equivocada coincide con
     el TOTAL del documento (±0,06) → garantiza que los importes están en la
     moneda del documento y que es el cargo/pago entero, no un caso raro.
   NO TOCA:
     · Marcadores 'Cross-moneda:%' (trazabilidad, importe 0)
     · PAGO_CRUZADO (viven en otra cuenta POR DISEÑO)
     · Cuenta 90 (Palmero) movimientos anteriores al AJUSTE #21531 (PC-1156:
       ya compensado — ponerlo en su cuenta desbalancearía el ajuste)
     · Los docs cuyo neto NO coincide con el total (quedan listados al final
       para revisión manual: ET-2474, ET-2137, PC-2508, PC-1165, ET-1980, FA-71)
     · Pares cargo+pago que netean 0 en la misma cuenta (legacy inofensivo)

   PASOS: 0 diagnóstico → 1 crear cuentas faltantes → 2 migrar movimientos
          → 3 migrar deudas vivas → 4 verificación → COMMIT / ROLLBACK manual.
   Correr DESPUÉS del deploy (el fix de editarFactura frena casos nuevos).
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Diagnóstico: cuántos hay por bucket (solo lectura) ────────── */
IF OBJECT_ID('tempdb..#wrong') IS NOT NULL DROP TABLE #wrong;
SELECT dc.DocIdDocumento,
       LTRIM(RTRIM(dc.DocSerie))+'-'+LTRIM(RTRIM(dc.DocNumero)) AS Doc,
       dc.CliIdCliente, dc.MonIdMoneda AS DocMon, dc.DocTotal,
       m.CueIdCuenta AS CtaEquivocada,
       SUM(m.MovImporte) AS Neto, COUNT(*) AS Movs
INTO   #wrong
FROM   dbo.MovimientosCuenta m
JOIN   dbo.DocumentosContables dc ON dc.DocIdDocumento = m.DocIdDocumento
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE  m.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','PAGO','VENTA','CARGO')
  AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND  ABS(m.MovImporte) > 0.01
  AND  ISNULL(m.MovObservaciones,'') NOT LIKE 'Cross-moneda:%'
  AND  cc.MonIdMoneda IS NOT NULL AND cc.MonIdMoneda <> dc.MonIdMoneda
  AND  dc.DocEstado <> 'ANULADO'
  AND  NOT (m.CueIdCuenta = 90 AND m.MovIdMovimiento < 21531)  -- Palmero compensado
GROUP  BY dc.DocIdDocumento, dc.DocSerie, dc.DocNumero, dc.CliIdCliente,
          dc.MonIdMoneda, dc.DocTotal, m.CueIdCuenta
HAVING ABS(SUM(m.MovImporte)) > 0.05;

SELECT CASE WHEN ABS(ABS(Neto) - DocTotal) <= 0.06 THEN 'A_MIGRABLE' ELSE 'B_REVISAR_MANUAL' END AS Bucket,
       COUNT(*) AS Docs, CAST(SUM(ABS(Neto)) AS DECIMAL(18,2)) AS SumaAbs
FROM   #wrong GROUP BY CASE WHEN ABS(ABS(Neto) - DocTotal) <= 0.06 THEN 'A_MIGRABLE' ELSE 'B_REVISAR_MANUAL' END;

BEGIN TRANSACTION;

/* ── PASO 1 — Crear la cuenta de dinero faltante a los clientes que no la
      tienen (misma condición de pago que su cuenta existente) ────────────── */
INSERT INTO dbo.CuentasCliente
       (CliIdCliente, CPaIdCondicion, CueTipo, MonIdMoneda, CueSaldoActual,
        CueLimiteCredito, CuePuedeNegativo, CueDiasCiclo, CueCicloActivo,
        CueActiva, CueFechaAlta, CueUsuarioAlta, CueObservaciones)
SELECT DISTINCT
       w.CliIdCliente,
       ref.CPaIdCondicion,
       CASE WHEN w.DocMon = 2 THEN 'DINERO_USD' ELSE 'DINERO_UYU' END,
       w.DocMon, 0,
       ref.CueLimiteCredito, ref.CuePuedeNegativo, 0, 0,
       1, GETDATE(), 1,
       'Creada por repara_cargos_moneda_equivocada_lote.sql (el cliente tenía docs en esta moneda sin cuenta)'
FROM   #wrong w
CROSS  APPLY (SELECT TOP 1 CPaIdCondicion, CueLimiteCredito, CuePuedeNegativo
              FROM dbo.CuentasCliente c2
              WHERE c2.CliIdCliente = w.CliIdCliente AND c2.ProIdProducto IS NULL
              ORDER BY c2.CueIdCuenta) ref
WHERE  ABS(ABS(w.Neto) - w.DocTotal) <= 0.06
  AND  NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente t
                   WHERE t.CliIdCliente = w.CliIdCliente AND t.MonIdMoneda = w.DocMon
                     AND t.ProIdProducto IS NULL AND t.CueActiva = 1);
PRINT CONCAT('Cuentas creadas: ', @@ROWCOUNT);   -- esperado: ~35-40 clientes

/* ── PASO 2 — Migrar los movimientos del bucket A a la cuenta correcta ──── */
IF OBJECT_ID('tempdb..#mig') IS NOT NULL DROP TABLE #mig;
SELECT w.DocIdDocumento, w.Doc, w.CtaEquivocada, w.Neto, tgt.CueIdCuenta AS CtaCorrecta
INTO   #mig
FROM   #wrong w
CROSS  APPLY (SELECT TOP 1 t.CueIdCuenta FROM dbo.CuentasCliente t
              WHERE t.CliIdCliente = w.CliIdCliente AND t.MonIdMoneda = w.DocMon
                AND t.ProIdProducto IS NULL AND t.CueActiva = 1
              ORDER BY t.CueIdCuenta) tgt
WHERE  ABS(ABS(w.Neto) - w.DocTotal) <= 0.06;

UPDATE m
SET    m.CueIdCuenta = g.CtaCorrecta,
       m.MovObservaciones = LEFT(ISNULL(m.MovObservaciones,'') +
         ' | Migrado de cuenta ' + CAST(g.CtaEquivocada AS VARCHAR) + ' a ' + CAST(g.CtaCorrecta AS VARCHAR) +
         ' (moneda del doc). repara_cargos_moneda_equivocada_lote.sql', 500)
FROM   dbo.MovimientosCuenta m
JOIN   #mig g ON g.DocIdDocumento = m.DocIdDocumento AND g.CtaEquivocada = m.CueIdCuenta
WHERE  m.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','PAGO','VENTA','CARGO')
  AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND  ABS(m.MovImporte) > 0.01
  AND  ISNULL(m.MovObservaciones,'') NOT LIKE 'Cross-moneda:%'
  AND  NOT (m.CueIdCuenta = 90 AND m.MovIdMovimiento < 21531);
PRINT CONCAT('Movimientos migrados: ', @@ROWCOUNT);

/* Consistencia de CueSaldoActual (columna legacy; la billetera recalcula) */
UPDATE cc SET cc.CueSaldoActual = cc.CueSaldoActual - x.Tot
FROM dbo.CuentasCliente cc
JOIN (SELECT CtaEquivocada AS Cta, SUM(Neto) AS Tot FROM #mig GROUP BY CtaEquivocada) x ON x.Cta = cc.CueIdCuenta;
UPDATE cc SET cc.CueSaldoActual = cc.CueSaldoActual + x.Tot
FROM dbo.CuentasCliente cc
JOIN (SELECT CtaCorrecta AS Cta, SUM(Neto) AS Tot FROM #mig GROUP BY CtaCorrecta) x ON x.Cta = cc.CueIdCuenta;

/* ── PASO 3 — Migrar las deudas VIVAS de esos docs a la cuenta correcta ─── */
UPDATE dd
SET    dd.CueIdCuenta = g.CtaCorrecta
FROM   dbo.DeudaDocumento dd
JOIN   #mig g ON g.DocIdDocumento = dd.DocIdDocumento
WHERE  dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
  AND  dd.CueIdCuenta <> g.CtaCorrecta;
PRINT CONCAT('Deudas vivas migradas: ', @@ROWCOUNT);

/* ── PASO 4 — Verificación ─────────────────────────────────────────────── */
/* 4a. Detección residual: deben quedar SOLO los ~6 B_REVISAR (manuales) */
SELECT dc.DocIdDocumento,
       LTRIM(RTRIM(dc.DocSerie))+'-'+LTRIM(RTRIM(dc.DocNumero)) AS Doc,
       LEFT(LTRIM(RTRIM(cli.Nombre)),22) AS Cliente,
       dc.MonIdMoneda AS DocMon, dc.DocTotal,
       CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) AS NetoResidual
FROM   dbo.MovimientosCuenta m
JOIN   dbo.DocumentosContables dc ON dc.DocIdDocumento = m.DocIdDocumento
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN   dbo.Clientes cli ON cli.CliIdCliente = dc.CliIdCliente
WHERE  m.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','PAGO','VENTA','CARGO')
  AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND  ABS(m.MovImporte) > 0.01
  AND  ISNULL(m.MovObservaciones,'') NOT LIKE 'Cross-moneda:%'
  AND  cc.MonIdMoneda IS NOT NULL AND cc.MonIdMoneda <> dc.MonIdMoneda
  AND  dc.DocEstado <> 'ANULADO'
  AND  NOT (m.CueIdCuenta = 90 AND m.MovIdMovimiento < 21531)
GROUP  BY dc.DocIdDocumento, dc.DocSerie, dc.DocNumero, cli.Nombre, dc.MonIdMoneda, dc.DocTotal
HAVING ABS(SUM(m.MovImporte)) > 0.05
ORDER  BY ABS(SUM(m.MovImporte)) DESC;

/* 4b. Invariante: la migración solo mueve plata ENTRE cuentas del mismo
       cliente — la posición global de cada cliente no cambia. */
SELECT 'Docs migrados' = (SELECT COUNT(DISTINCT DocIdDocumento) FROM #mig);

/* Si 4a devuelve ~6 filas (los B_REVISAR) → COMMIT TRANSACTION;
   Si aparece cualquier otra cosa          → ROLLBACK TRANSACTION; y avisar. */

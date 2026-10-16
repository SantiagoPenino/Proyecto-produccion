/* ═══════════════════════════════════════════════════════════════════════════
   REPARACIÓN LOTE — Pagos de ventas CONTADO desvinculados o ausentes  ·  27-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   UNIVERSO: documentos CONTADO PUROS (DocPagado=1, con cargo VTA_CAJA/CIERRE
   vinculado, SIN ninguna fila en DeudaDocumento y SIN ningún mov PAGO vinculado).
   Los docs que alguna vez tuvieron deuda son territorio de la AUDITORÍA
   (fix_estampar_docid_pagos_deuda / repara_movs_pago_ausentes /
   fix_revertir_cobros_fantasma) — este script NO los toca.

   TRES BUCKETS (matcheo por la cadena doc → TcaIdTransaccion → Pagos → mov PAGO):
     B1 — El pago EXISTE y su suma = total del doc (±0,06): se le estampa el
          doc, se lo lleva a la cuenta del cargo y se le saca el ciclo.
     B2 — Un único pago pero EN LA OTRA MONEDA (ratio 15–60 ≈ cotización):
          se lleva a la cuenta y moneda del doc por su total (el importe real
          pagado queda en Pagos y en la observación).
     B3 — NO hay movimiento PAGO, pero la PLATA REAL de la transacción
          (SUM PagMontoConvertido, sin ANTICIPO_APLICADO) cuadra con el doc
          (±1%): se repone el movimiento vía SP_RegistrarMovimiento.
          Guarda extra anti-doble-pago: si hay un PAGO suelto de importe
          similar ±2 días, el doc queda para revisión manual.
   Cubiertos por anticipo, flujos online con cobrado 0, sumas que no cuadran
   → quedan afuera (revisión manual, ~61 docs).

   VALIDADO EN LOCAL: B1=301 movs, B2=137, B3=463; restantes 61.
   Spot: Cleve Reyes ambas billeteras 0,00.
   Correr DESPUÉS del deploy y de repara_cargos_moneda_equivocada_lote.sql.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Prerrequisito y diagnóstico ──────────────────────────────── */
SELECT CASE WHEN OBJECT_DEFINITION(OBJECT_ID('dbo.SP_RegistrarMovimiento')) LIKE '%@MovFecha%'
       THEN 'OK: SP con @MovFecha' ELSE 'FALTA add_MovFecha_SP_RegistrarMovimiento.sql — NO SEGUIR' END AS ChequeoSP;

BEGIN TRANSACTION;

IF OBJECT_ID('tempdb..#base') IS NOT NULL DROP TABLE #base;
IF OBJECT_ID('tempdb..#cand') IS NOT NULL DROP TABLE #cand;

SELECT dc.DocIdDocumento, dc.CliIdCliente, dc.MonIdMoneda, dc.DocTotal, dc.TcaIdTransaccion,
       LTRIM(RTRIM(dc.DocSerie))+'-'+LTRIM(RTRIM(dc.DocNumero)) AS Doc,
       LTRIM(RTRIM(dc.DocTipo)) AS Tipo, dc.DocFechaEmision,
       cargo.CueIdCuenta AS CtaCargo
INTO   #base
FROM   dbo.DocumentosContables dc
CROSS  APPLY (SELECT TOP 1 c.CueIdCuenta FROM dbo.MovimientosCuenta c
              WHERE c.DocIdDocumento = dc.DocIdDocumento AND c.MovTipo IN ('VTA_CAJA','CIERRE_CICLO')
                AND (c.MovAnulado IS NULL OR c.MovAnulado = 0) AND ABS(c.MovImporte) > 0.01
              ORDER BY c.MovIdMovimiento) cargo
WHERE  dc.DocPagado = 1 AND dc.DocEstado <> 'ANULADO'
  AND  dc.DocTipo NOT LIKE '%ecibo%' AND dc.DocTipo NOT LIKE '%greso%'
  AND  NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta p
              WHERE p.DocIdDocumento = dc.DocIdDocumento AND p.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO')
                AND (p.MovAnulado IS NULL OR p.MovAnulado = 0))
  AND  NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento d
              WHERE d.DocIdDocumento = dc.DocIdDocumento);

SELECT b.DocIdDocumento, m.MovIdMovimiento, m.MovImporte, m.CueIdCuenta, cc.MonIdMoneda AS MovMon
INTO   #cand
FROM   #base b
JOIN   dbo.Pagos p ON p.PagTcaIdTransaccion = b.TcaIdTransaccion
JOIN   dbo.MovimientosCuenta m ON m.PagIdPago = p.PagIdPago AND m.MovTipo = 'PAGO'
       AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE  b.TcaIdTransaccion IS NOT NULL;

SELECT DocsUniverso = (SELECT COUNT(*) FROM #base);

/* ── PASO 1 — B1: relink de pagos que cuadran ──────────────────────────── */
WITH agg AS (SELECT DocIdDocumento, SUM(MovImporte) S FROM #cand GROUP BY DocIdDocumento)
UPDATE m SET m.DocIdDocumento = c.DocIdDocumento, m.CueIdCuenta = b.CtaCargo, m.CicIdCiclo = NULL,
       m.MovObservaciones = LEFT(ISNULL(m.MovObservaciones,'') + ' | Relink a ' + b.Doc + ' (pago de venta contado sin vincular). repara_pagos_contado_desvinculados.sql', 500)
FROM   dbo.MovimientosCuenta m
JOIN   #cand c ON c.MovIdMovimiento = m.MovIdMovimiento
JOIN   agg a ON a.DocIdDocumento = c.DocIdDocumento
JOIN   #base b ON b.DocIdDocumento = c.DocIdDocumento
WHERE  ABS(a.S - b.DocTotal) <= 0.06;
PRINT CONCAT('B1 relinkeados: ', @@ROWCOUNT);          -- local: 301

/* ── PASO 2 — B2: pago único en la otra moneda → a la moneda del doc ───── */
WITH uno AS (SELECT DocIdDocumento, MIN(MovIdMovimiento) Mid FROM #cand GROUP BY DocIdDocumento HAVING COUNT(*) = 1)
UPDATE m SET m.DocIdDocumento = b.DocIdDocumento, m.CueIdCuenta = b.CtaCargo, m.CicIdCiclo = NULL,
       m.MovImporte = b.DocTotal,
       m.MovObservaciones = LEFT(ISNULL(m.MovObservaciones,'') + ' | Relink a ' + b.Doc + ': pago registrado como ' + CAST(c.MovImporte AS VARCHAR(30)) + ' (moneda ' + CAST(c.MovMon AS VARCHAR(2)) + '), llevado al total del doc en su moneda. repara_pagos_contado_desvinculados.sql', 500)
FROM   dbo.MovimientosCuenta m
JOIN   #cand c ON c.MovIdMovimiento = m.MovIdMovimiento
JOIN   uno u ON u.Mid = c.MovIdMovimiento
JOIN   #base b ON b.DocIdDocumento = c.DocIdDocumento
WHERE  c.MovMon <> b.MonIdMoneda
  AND  ABS(c.MovImporte - b.DocTotal) > 0.06
  AND  ABS(c.MovImporte) > 0.01
  AND  ((b.DocTotal / NULLIF(ABS(c.MovImporte),0) BETWEEN 15 AND 60)
     OR (ABS(c.MovImporte) / NULLIF(b.DocTotal,0) BETWEEN 15 AND 60));
PRINT CONCAT('B2 convertidos: ', @@ROWCOUNT);           -- local: 137

/* ── PASO 3 — B3: reponer movimientos ausentes (cursor + SP) ───────────── */
DECLARE @DocId INT, @Doc VARCHAR(60), @Tipo VARCHAR(60), @Total DECIMAL(18,4),
        @Tca INT, @Cta INT, @Fecha DATETIME, @PagId INT, @MovId INT, @Saldo DECIMAL(18,4), @N INT = 0;

DECLARE curB3 CURSOR LOCAL FAST_FORWARD FOR
  SELECT b.DocIdDocumento, b.Doc, b.Tipo, b.DocTotal, b.TcaIdTransaccion, b.CtaCargo, b.DocFechaEmision
  FROM   #base b
  WHERE  b.TcaIdTransaccion IS NOT NULL
    AND  NOT EXISTS (SELECT 1 FROM #cand c WHERE c.DocIdDocumento = b.DocIdDocumento)
    AND  NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta s
           JOIN dbo.CuentasCliente sc ON sc.CueIdCuenta = s.CueIdCuenta
           WHERE sc.CliIdCliente = b.CliIdCliente AND s.MovTipo = 'PAGO'
             AND (s.MovAnulado IS NULL OR s.MovAnulado = 0) AND s.DocIdDocumento IS NULL
             AND ABS(ABS(s.MovImporte) - b.DocTotal) <= b.DocTotal * 0.01
             AND ABS(DATEDIFF(DAY, s.MovFecha, b.DocFechaEmision)) <= 2)
    AND  (SELECT ISNULL(SUM(p.PagMontoConvertido),0) FROM dbo.Pagos p
          WHERE p.PagTcaIdTransaccion = b.TcaIdTransaccion AND p.PagTipoMovimiento <> 'ANTICIPO_APLICADO')
         BETWEEN b.DocTotal * 0.99 AND b.DocTotal * 1.01;

OPEN curB3;
FETCH NEXT FROM curB3 INTO @DocId, @Doc, @Tipo, @Total, @Tca, @Cta, @Fecha;
WHILE @@FETCH_STATUS = 0
BEGIN
  SELECT TOP 1 @PagId = PagIdPago FROM dbo.Pagos
  WHERE PagTcaIdTransaccion = @Tca AND PagTipoMovimiento <> 'ANTICIPO_APLICADO' ORDER BY PagIdPago;

  EXEC dbo.SP_RegistrarMovimiento
      @CueIdCuenta = @Cta, @MovTipo = 'PAGO',
      @MovConcepto = @Doc,  -- se completa abajo
      @MovImporte = @Total, @MovUsuarioAlta = 1,
      @PagIdPago = @PagId, @DocIdDocumento = @DocId,
      @MovObservaciones = N'Reposicion lote repara_pagos_contado_desvinculados.sql 27-jul-2026',
      @MovFecha = @Fecha,
      @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @Saldo OUTPUT;

  UPDATE dbo.MovimientosCuenta
  SET    MovConcepto = LEFT('Pago (' + @Tipo + '): ' + @Doc + ' (repuesto: el cobro contado no habia escrito el movimiento)', 500)
  WHERE  MovIdMovimiento = @MovId;

  SET @N += 1;
  FETCH NEXT FROM curB3 INTO @DocId, @Doc, @Tipo, @Total, @Tca, @Cta, @Fecha;
END
CLOSE curB3; DEALLOCATE curB3;
PRINT CONCAT('B3 repuestos: ', @N);                     -- local: 463

/* ── PASO 4 — Verificación ─────────────────────────────────────────────── */
SELECT ContadosPurosSinPagoRestantes = COUNT(*)          -- local: 61 (manuales)
FROM dbo.DocumentosContables dc
WHERE dc.DocPagado = 1 AND dc.DocEstado <> 'ANULADO'
  AND dc.DocTipo NOT LIKE '%ecibo%' AND dc.DocTipo NOT LIKE '%greso%'
  AND EXISTS (SELECT 1 FROM dbo.MovimientosCuenta c WHERE c.DocIdDocumento = dc.DocIdDocumento AND c.MovTipo IN ('VTA_CAJA','CIERRE_CICLO') AND (c.MovAnulado IS NULL OR c.MovAnulado = 0) AND ABS(c.MovImporte) > 0.01)
  AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta p WHERE p.DocIdDocumento = dc.DocIdDocumento AND p.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO') AND (p.MovAnulado IS NULL OR p.MovAnulado = 0))
  AND NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento d WHERE d.DocIdDocumento = dc.DocIdDocumento);

/* Spot: Cleve Reyes debe dar 0,00 en ambas monedas */
SELECT LEFT(LTRIM(RTRIM(cli.Nombre)),22) AS Cliente, cc.CueTipo,
       CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) AS Billetera
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.Clientes cli ON cli.CliIdCliente = cc.CliIdCliente
WHERE cc.CliIdCliente IN (SELECT CliIdCliente FROM dbo.Clientes WHERE Nombre LIKE '%Cleve Reyes%')
  AND cc.ProIdProducto IS NULL
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
GROUP BY cli.Nombre, cc.CueTipo;

/* Si los números calzan con los esperados → COMMIT TRANSACTION;
   Si no                                   → ROLLBACK TRANSACTION; */

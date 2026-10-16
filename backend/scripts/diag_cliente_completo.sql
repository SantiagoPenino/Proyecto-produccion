/* ============================================================================
   diag_cliente_completo.sql   —   100% SOLO LECTURA, no modifica nada.
   ----------------------------------------------------------------------------
   Corre TODOS los chequeos del catálogo (`CATALOGO_BUGS_SALDO_CLIENTES.md`)
   para UN cliente de una sola vez, siguiendo la guía "Cómo chequear un
   cliente nuevo, de punta a punta" (BUG 1, 2, 3, 4, 5, 7 + saldo en vivo vs
   deuda). Pensado para correr en PRODUCCIÓN (es solo SELECT, sin riesgo).

   CÓMO USARLO:
   1) Si no sabés el CliIdCliente, corré el PASO 0 para buscarlo por nombre.
   2) Poné ese número en @Cli más abajo.
   3) Ejecutá todo el script. Da 7 resultados, en orden:
      0) Cliente encontrado (si buscaste por nombre)
      1) Saldo en vivo vs deuda viva, por moneda (el resumen más importante)
      2) Reconciliación documento por documento (BUG 1 y 4)
      3) Cross-moneda del PAGO (BUG 2)
      4) Cargo con firma "Manual Edicion" (BUG 3)
      5) Cargo en cuenta de moneda equivocada (BUG 7)
      6) PAGO_CRUZADO con anulado asimétrico (BUG 5 — NO TOCAR si aparece,
         solo avisar)
   4) Pegame los resultados de 1, y de cualquiera de 2-6 que no salga vacío.
   ============================================================================ */

SET NOCOUNT ON;

-- ── PASO 0 (opcional) — buscar el cliente por nombre ────────────────────────
-- Descomentar y completar si no sabés el CliIdCliente:
-- SELECT CliIdCliente, RTRIM(IDCliente) AS IDCliente, RTRIM(NombreFantasia) AS NombreFantasia, RTRIM(Nombre) AS Nombre
-- FROM dbo.Clientes WHERE NombreFantasia LIKE '%NOMBRE%' OR Nombre LIKE '%NOMBRE%' OR IDCliente LIKE '%NOMBRE%';

DECLARE @Cli INT = 0;   -- <<< PONER ACÁ el CliIdCliente a chequear

-- ── 1. SALDO EN VIVO vs DEUDA VIVA (el resumen más importante — BUG 6: nunca
--       confiar en CueSaldoActual, por eso se calcula en vivo) ──────────────
SELECT cc.CueIdCuenta, RTRIM(cc.CueTipo) AS CueTipo,
    SaldoEnVivo = (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) FROM dbo.MovimientosCuenta m
                   WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado=0)
                     AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),
    DeudaViva = (SELECT CAST(ISNULL(SUM(dd.DDeImportePendiente),0) AS DECIMAL(18,2)) FROM dbo.DeudaDocumento dd
                 WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA')),
    CueSaldoActual_Cacheado_NO_CONFIAR = CAST(cc.CueSaldoActual AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');

-- ── 2. Reconciliación documento por documento (BUG 1: deuda duplicada, BUG 4: pago mal aplicado) ──
IF OBJECT_ID('tempdb..#pagosResueltos') IS NOT NULL DROP TABLE #pagosResueltos;
;WITH pagosCli AS (
    SELECT m.MovIdMovimiento, m.MovImporte, m.MovFecha, m.MovAnulado, m.DocIdDocumento, m.MovObservaciones,
           DDeIdDesdeObs = CASE WHEN m.MovObservaciones LIKE '%DeudaDoc #%' THEN
               TRY_CAST(LEFT(STUFF(m.MovObservaciones, 1, PATINDEX('%DeudaDoc #%', m.MovObservaciones) + 9, ''),
                   PATINDEX('%[^0-9]%', STUFF(m.MovObservaciones, 1, PATINDEX('%DeudaDoc #%', m.MovObservaciones) + 9, '') + ' ') - 1) AS INT)
           ELSE NULL END
    FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE cc.CliIdCliente = @Cli AND m.MovTipo IN ('PAGO','COBRO')
)
SELECT p.MovIdMovimiento, p.MovImporte, p.MovAnulado,
    DocIdResuelto = COALESCE(p.DocIdDocumento, dd.DocIdDocumento),
    ViaObs = CASE WHEN p.DocIdDocumento IS NULL AND dd.DocIdDocumento IS NOT NULL THEN 1 ELSE 0 END
INTO #pagosResueltos
FROM pagosCli p LEFT JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = p.DDeIdDesdeObs;

IF OBJECT_ID('tempdb..#docsCli') IS NOT NULL DROP TABLE #docsCli;
SELECT dc.DocIdDocumento, Doc = RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero),
    DocTotal = CAST(dc.DocTotal AS DECIMAL(18,2)), dc.DocEstado,
    FilasDeDeudaVivas = (SELECT COUNT(*) FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento = dc.DocIdDocumento AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA')),
    FilasDeDeudaTotal = (SELECT COUNT(*) FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento = dc.DocIdDocumento),
    PendienteSegunDeuda = (SELECT ISNULL(SUM(dd.DDeImportePendiente),0) FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento = dc.DocIdDocumento AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA')),
    CobradoReal = CAST(ISNULL((SELECT SUM(pr.MovImporte) FROM #pagosResueltos pr WHERE pr.DocIdResuelto = dc.DocIdDocumento AND pr.MovAnulado = 0),0) AS DECIMAL(18,2)),
    PagosViaObs = (SELECT COUNT(*) FROM #pagosResueltos pr WHERE pr.DocIdResuelto = dc.DocIdDocumento AND pr.ViaObs = 1 AND pr.MovAnulado = 0)
INTO #docsCli
FROM dbo.DocumentosContables dc WHERE dc.CliIdCliente = @Cli;

SELECT Doc, DocIdDocumento, DocTotal, CobradoReal, FilasDeDeudaVivas, FilasDeDeudaTotal, PagosViaObs,
    EsperadoSegunDeuda = CAST(DocTotal - PendienteSegunDeuda AS DECIMAL(18,2)),
    Alerta = CASE
        WHEN FilasDeDeudaVivas > 1 THEN 'BUG 1: MÁS DE UNA DEUDA VIVA (duplicado sin resolver)'
        WHEN FilasDeDeudaTotal > 0 AND ABS(CobradoReal - (DocTotal - PendienteSegunDeuda)) > 2 THEN 'BUG 4?: LO COBRADO NO COINCIDE CON LA DEUDA'
        WHEN PagosViaObs > 0 THEN 'ⓘ pago encontrado solo vía observaciones (cosmético, ya conocido)'
        ELSE NULL END
FROM #docsCli
WHERE DocEstado <> 'ANULADO'
  AND (FilasDeDeudaVivas > 1 OR (FilasDeDeudaTotal > 0 AND ABS(CobradoReal - (DocTotal - PendienteSegunDeuda)) > 2) OR PagosViaObs > 0)
ORDER BY DocIdDocumento;

DROP TABLE #pagosResueltos; DROP TABLE #docsCli;

-- ── 3. BUG 2 — pago en cuenta de la moneda equivocada ───────────────────────
SELECT Doc = RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero), dc.DocIdDocumento,
    DocMoneda = moDoc.MonSimbolo, DocTotal = CAST(dc.DocTotal AS DECIMAL(18,2)),
    PagoMoneda = moP.MonSimbolo, PagoImporte = CAST(pago.MovImporte AS DECIMAL(18,2)), pago.MovIdMovimiento,
    MismoNumero = CASE WHEN ABS(ABS(pago.MovImporte) - dc.DocTotal) <= 1 THEN 'SÍ' ELSE '' END
FROM dbo.DocumentosContables dc
JOIN dbo.Monedas moDoc ON moDoc.MonIdMoneda = dc.MonIdMoneda
CROSS APPLY (
    SELECT TOP 1 m.MovIdMovimiento, m.CueIdCuenta, m.MovImporte FROM dbo.MovimientosCuenta m
    WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovTipo IN ('PAGO','COBRO') AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
) pago
JOIN dbo.CuentasCliente ccP ON ccP.CueIdCuenta = pago.CueIdCuenta
JOIN dbo.Monedas moP ON moP.MonIdMoneda = ccP.MonIdMoneda
WHERE dc.CliIdCliente = @Cli AND dc.DocEstado <> 'ANULADO' AND ccP.MonIdMoneda <> dc.MonIdMoneda
ORDER BY MismoNumero DESC, dc.DocIdDocumento DESC;

-- ── 4. BUG 3 — cargo con firma "Manual Edicion" ─────────────────────────────
SELECT dc.DocIdDocumento, Doc = RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero),
    dc.DocTotal, mo.MonSimbolo AS DocMoneda, tc.TcaObservaciones,
    CargoMismaMoneda = (SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                         JOIN dbo.CuentasCliente cc2 ON cc2.CueIdCuenta = m.CueIdCuenta
                         WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
                           AND cc2.CueTipo = CASE WHEN dc.MonIdMoneda = 1 THEN 'DINERO_UYU' ELSE 'DINERO_USD' END
                           AND (m.MovAnulado IS NULL OR m.MovAnulado=0))
FROM dbo.DocumentosContables dc
JOIN dbo.TransaccionesCaja tc ON tc.TcaIdTransaccion = dc.TcaIdTransaccion
JOIN dbo.Monedas mo ON mo.MonIdMoneda = dc.MonIdMoneda
WHERE dc.CliIdCliente = @Cli AND tc.TcaObservaciones LIKE '%Manual Edicion%';

-- ── 5. BUG 7 — cargo (VTA_CAJA/CIERRE_CICLO) en cuenta de moneda equivocada ─
--       (join por CueTipo, no por MonIdMoneda: esa columna viene NULL en
--        algunas cuentas — ver nota en fix_crossmoneda_lote1.sql)
SELECT dc.DocIdDocumento, Doc = RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero),
    DocMoneda = moDoc.MonSimbolo, DocTotal = CAST(dc.DocTotal AS DECIMAL(18,2)),
    CargoCueTipo = RTRIM(ccC.CueTipo), CargoImporte = CAST(cargo.MovImporte AS DECIMAL(18,2)),
    cargo.MovIdMovimiento AS CargoMovId, cargo.MovTipo AS CargoTipo,
    MismoNumero = CASE WHEN ABS(ABS(cargo.MovImporte) - dc.DocTotal) <= 1 THEN 'SÍ' ELSE '' END
FROM dbo.DocumentosContables dc
JOIN dbo.Monedas moDoc ON moDoc.MonIdMoneda = dc.MonIdMoneda
CROSS APPLY (
    SELECT TOP 1 m.MovIdMovimiento, m.CueIdCuenta, m.MovImporte, m.MovTipo FROM dbo.MovimientosCuenta m
    WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND m.MovImporte <> 0
) cargo
JOIN dbo.CuentasCliente ccC ON ccC.CueIdCuenta = cargo.CueIdCuenta
WHERE dc.CliIdCliente = @Cli AND dc.DocEstado <> 'ANULADO'
  AND ccC.CueTipo <> CASE WHEN dc.MonIdMoneda = 1 THEN 'DINERO_UYU' ELSE 'DINERO_USD' END
ORDER BY MismoNumero DESC, dc.DocIdDocumento DESC;

-- ── 6. BUG 5 — PAGO_CRUZADO con anulado asimétrico (⚠️ NO ARREGLAR si sale
--       algo acá — solo avisar, ver catálogo, sigue sin resolver en Palmero) ─
;WITH cruzados AS (
    SELECT m.MovIdMovimiento, m.MovFecha, cc.CueTipo, m.MovImporte, m.MovAnulado
    FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE cc.CliIdCliente = @Cli AND m.MovTipo = 'PAGO_CRUZADO'
)
SELECT a.MovIdMovimiento, a.MovImporte, a.MovFecha
FROM cruzados a
JOIN cruzados b ON b.CueTipo <> a.CueTipo AND ABS(DATEDIFF(SECOND, a.MovFecha, b.MovFecha)) <= 1
WHERE a.CueTipo = 'DINERO_UYU' AND a.MovAnulado = 0 AND b.MovAnulado = 1;

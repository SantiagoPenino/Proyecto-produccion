/* ============================================================================
   VyM (Uniformes vym, CliIdCliente 154) — ET-5079 y ET-5814: pasar los cargos a
   la cuenta $ (como dice cada e-ticket) y sacar el parche de AJUSTE del 17/9.

   QUÉ PASÓ (22-sep-2026, verificado en la réplica local = pantalla de prod):
     Los ciclos #431 y #460 (cuenta 73, US$) se cerraron en dólares — cargo
     CIERRE_CICLO −393,34 (mov 31865, nació como ET-4448) y −664,95 (mov 37102,
     nació como ET-5525) en la cuenta US$ — y después cada documento se convirtió
     a e-ticket CONTADO EN PESOS y así fue a DGI: ET-5079 $ 16.100 y ET-5814
     $ 27.200 (ACEPTADO_DGI). Los cobros reales (RC-000479 13/8 y RC-000524 20/8)
     se escribieron en la cuenta $ (+16.100 / +27.200, movs 34995 / 38519), pero
     el cargo quedó varado en dólares (editarFactura de agosto no lo tocaba).
     El 17/9 se emparchó con dos AJUSTE (+US$ 1.058,29 en la 73 y −$ 43.300 en la
     2546): los saldos quedaron en 0, pero los documentos siguen partidos (cargo
     en una cuenta, cobro en la otra) y el 360 los muestra en la columna US$.

   QUÉ HACE (regla: manda lo que fue a DGI; mismo criterio que Emipal FA-393)
     1. Mueve el cargo de ET-5079 (mov 31865) a la cuenta 2546 ($) por −16.100 y
        el de ET-5814 (mov 37102) por −27.200, con concepto/observación de cierre
        cross-moneda. Cada e-ticket queda cargo = cobro en pesos.
     2. ANULA los dos AJUSTE del 17/9 (movs 56356 y 56357): ya no hacen falta y,
        con los cargos en pesos, dejarían la 73 a favor y la 2546 debiendo.
     3. Recalcula MovSaldoPosterior y CueSaldoActual de las cuentas 73 y 2546.
     4. DocCotizacion de ET-5079 = 40,93 (estaba vacía; 16.100 / 393,34).
     NO toca deudas (ya están COBRADAS), ni las ORDEN de los ciclos (quedan en
     US$, como en todos los cierres cross-moneda), ni ningún otro cliente.

   CANDADOS: si documentos, cargos, cobros o ajustes no son EXACTAMENTE los
   descritos, no escribe nada y explica por qué.

   ESPERADO DESPUÉS: cuenta 73 libro 0,00 · cuenta 2546 libro 0,00 (igual que hoy,
   pero sin parche) · ET-5079 y ET-5814 con neto 0 en la cuenta $.

   Correr en PRODUCCIÓN, en SSMS, entero (F5). @SoloVista = 1 (default) solo
   muestra; @SoloVista = 0 aplica. No deja transacciones abiertas.
   ============================================================================ */
USE [SecureAppDB];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SoloVista BIT = 1;   -- << 1 = solo mirar | 0 = aplicar

DECLARE @Cli INT = 154, @CtaUSD INT = 73, @CtaUYU INT = 2546;
DECLARE @Cargos TABLE (MovIdMovimiento INT PRIMARY KEY, DocIdDocumento INT, Doc VARCHAR(20), CargoUSD DECIMAL(18,4), TotalPesos DECIMAL(18,2), MovCobro INT, Cot DECIMAL(18,2));
INSERT INTO @Cargos VALUES (31865, 7387, 'ET-5079', -393.34, 16100.00, 34995, 40.93),
                           (37102, 8574, 'ET-5814', -664.95, 27200.00, 38519, 40.90);
DECLARE @Ajustes TABLE (MovIdMovimiento INT PRIMARY KEY, CueIdCuenta INT, Importe DECIMAL(18,4));
INSERT INTO @Ajustes VALUES (56356, 73, 1058.29), (56357, 2546, -43300.00);

/* ── CANDADOS ─────────────────────────────────────────────────────────────── */
IF EXISTS (SELECT 1 FROM @Cargos c
           WHERE NOT EXISTS (SELECT 1 FROM dbo.DocumentosContables d
                             WHERE d.DocIdDocumento = c.DocIdDocumento AND RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero) = c.Doc
                               AND d.CliIdCliente = @Cli AND d.MonIdMoneda = 1 AND d.DocTotal = c.TotalPesos AND d.CfeEstado = 'ACEPTADO_DGI')
              OR NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                             WHERE m.MovIdMovimiento = c.MovIdMovimiento AND m.CueIdCuenta = @CtaUSD AND m.DocIdDocumento = c.DocIdDocumento
                               AND m.MovTipo = 'CIERRE_CICLO' AND m.MovImporte = c.CargoUSD AND ISNULL(m.MovAnulado, 0) = 0)
              OR NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta p
                             WHERE p.MovIdMovimiento = c.MovCobro AND p.CueIdCuenta = @CtaUYU AND p.DocIdDocumento = c.DocIdDocumento
                               AND p.MovTipo = 'PAGO' AND p.MovImporte = c.TotalPesos AND ISNULL(p.MovAnulado, 0) = 0)
              OR EXISTS (SELECT 1 FROM dbo.MovimientosCuenta o
                         WHERE o.DocIdDocumento = c.DocIdDocumento AND ISNULL(o.MovAnulado, 0) = 0
                           AND o.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO') AND o.MovIdMovimiento NOT IN (c.MovIdMovimiento, c.MovCobro)))
BEGIN RAISERROR('CANDADO: ET-5079 / ET-5814 no estan exactamente como se diagnostico (documento, cargo en US$, cobro en $, sin otros movimientos). No se toca nada.', 16, 1); RETURN; END

IF EXISTS (SELECT 1 FROM @Ajustes a
           WHERE NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                             WHERE m.MovIdMovimiento = a.MovIdMovimiento AND m.CueIdCuenta = a.CueIdCuenta AND m.MovImporte = a.Importe
                               AND m.MovTipo IN ('AJUSTE_POS', 'AJUSTE_NEG') AND m.DocIdDocumento IS NULL AND ISNULL(m.MovAnulado, 0) = 0))
BEGIN RAISERROR('CANDADO: los AJUSTE del 17/9 (56356 +1.058,29 US$ / 56357 -43.300 $) no estan como se diagnostico. No se toca nada.', 16, 1); RETURN; END

IF NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente WHERE CueIdCuenta = @CtaUSD AND CliIdCliente = @Cli AND CueTipo = 'DINERO_USD')
   OR NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente WHERE CueIdCuenta = @CtaUYU AND CliIdCliente = @Cli AND CueTipo = 'DINERO_UYU')
BEGIN RAISERROR('CANDADO: las cuentas 73 (US$) / 2546 ($) no son las de VyM. No se toca nada.', 16, 1); RETURN; END

/* ── ANTES ────────────────────────────────────────────────────────────────── */
SELECT 'ANTES' AS Momento, cc.CueIdCuenta, CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END AS Moneda,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
                                 AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)),
       Guardado = CAST(cc.CueSaldoActual AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WHERE cc.CueIdCuenta IN (@CtaUSD, @CtaUYU) ORDER BY cc.CueIdCuenta;

SELECT 'A MOVER (cargos)' AS Paso, c.Doc, m.MovIdMovimiento, m.CueIdCuenta AS CtaHoy, CONVERT(VARCHAR(16), m.MovFecha, 120) AS Fecha, m.MovImporte AS CargoHoyUSD,
       -c.TotalPesos AS CargoNuevoPesos, @CtaUYU AS CtaNueva, LEFT(m.MovConcepto, 45) AS ConceptoHoy
FROM @Cargos c JOIN dbo.MovimientosCuenta m ON m.MovIdMovimiento = c.MovIdMovimiento;

SELECT 'A ANULAR (parche)' AS Paso, m.MovIdMovimiento, m.CueIdCuenta, CONVERT(VARCHAR(16), m.MovFecha, 120) AS Fecha, m.MovTipo, m.MovImporte, m.MovConcepto
FROM @Ajustes a JOIN dbo.MovimientosCuenta m ON m.MovIdMovimiento = a.MovIdMovimiento;

/* ── APLICAR ──────────────────────────────────────────────────────────────── */
IF @SoloVista = 0
BEGIN
    BEGIN TRANSACTION;

    UPDATE m
    SET m.CueIdCuenta      = @CtaUYU,
        m.MovImporte       = -c.TotalPesos,
        m.MovConcepto      = 'Venta E-Ticket Contado              : ' + c.Doc + ' (Uniformes vym)',
        m.MovObservaciones = LEFT('Conversión desde ciclo USD a UYU @ ' + CONVERT(VARCHAR(10), c.Cot)
                              + ' | FIX 22-sep-2026: el cargo estaba en la cuenta 73 (US$) por ' + CONVERT(VARCHAR(20), c.CargoUSD)
                              + '; el e-ticket se emitio en pesos y fue a DGI por ' + CONVERT(VARCHAR(20), c.TotalPesos)
                              + '. Manda el documento. fix_vym_et5079_et5814_cargos_a_pesos.sql', 500)
    FROM dbo.MovimientosCuenta m JOIN @Cargos c ON c.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE m
    SET m.MovAnulado       = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') + ' ANULADO 22-sep-2026: era el parche del 17/9 por los cargos de '
                              + 'ET-5079/ET-5814 varados en dolares; los cargos ya estan en pesos. fix_vym_et5079_et5814_cargos_a_pesos.sql'), 500)
    FROM dbo.MovimientosCuenta m JOIN @Ajustes a ON a.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE dbo.DocumentosContables SET DocCotizacion = 40.93 WHERE DocIdDocumento = 7387 AND DocCotizacion IS NULL;

    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta IN (@CtaUSD, @CtaUYU) AND ISNULL(m.MovAnulado, 0) = 0
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado, 0) = 0), 0)
    FROM dbo.CuentasCliente cc WHERE cc.CueIdCuenta IN (@CtaUSD, @CtaUYU);

    COMMIT TRANSACTION;
    PRINT 'VyM: cargos de ET-5079/ET-5814 en pesos, AJUSTE del 17/9 anulados, saldos recalculados.';
END
ELSE
    PRINT 'SOLO VISTA: no se escribio nada. Revisar y volver a correr con @SoloVista = 0.';

/* ── DESPUÉS ──────────────────────────────────────────────────────────────── */
SELECT CASE WHEN @SoloVista = 1 THEN 'SIN CAMBIOS (vista previa)' ELSE 'DESPUES' END AS Momento, cc.CueIdCuenta, CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END AS Moneda,
       SaldoLibro = CAST(s.Saldo AS DECIMAL(18,2)),
       DeudasVivas = CAST(dv.Viva AS DECIMAL(18,2)),
       Cuadre = CAST(dv.Viva - CASE WHEN s.Saldo < 0 THEN -s.Saldo ELSE 0 END AS DECIMAL(18,2)),
       Guardado = CAST(cc.CueSaldoActual AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
                AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')), 0)) s
CROSS APPLY (SELECT Viva = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = cc.CueIdCuenta
                AND dd.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO')), 0)) dv
WHERE cc.CueIdCuenta IN (@CtaUSD, @CtaUYU) ORDER BY cc.CueIdCuenta;

SELECT CASE WHEN @SoloVista = 1 THEN 'SIN CAMBIOS (vista previa)' ELSE 'DESPUES' END AS Momento, c.Doc, m.CueIdCuenta AS Cta,
       Cargo = CAST(SUM(CASE WHEN m.MovImporte < 0 THEN m.MovImporte ELSE 0 END) AS DECIMAL(18,2)),
       Cobro = CAST(SUM(CASE WHEN m.MovImporte > 0 THEN m.MovImporte ELSE 0 END) AS DECIMAL(18,2)),
       Neto  = CAST(SUM(m.MovImporte) AS DECIMAL(18,2))
FROM @Cargos c JOIN dbo.MovimientosCuenta m ON m.DocIdDocumento = c.DocIdDocumento
WHERE ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')
GROUP BY c.Doc, m.CueIdCuenta ORDER BY c.Doc, m.CueIdCuenta;

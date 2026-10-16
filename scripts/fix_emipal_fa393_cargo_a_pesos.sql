/* ============================================================================
   EMIPAL (Andres XU, CliIdCliente 376) — FA-393 (doc 6141, N° DGI Serie A 27669)
   Pasa el cargo del libro de la cuenta US$ a la cuenta $, como dice la factura.

   QUÉ PASÓ (22-sep-2026, verificado en la réplica local = pantalla de prod):
     El ciclo #330 (cuenta 359, US$) se cerró el 30/7 16:23 EN DÓLARES: nació
     como FA-392 por US$ 205,44 y el cargo se escribió en la cuenta US$
     (mov 26999, CIERRE_CICLO −205,44, "Facturado (E-FACTURA CREDITO FA-392)").
     Después la factura se editó a PESOS: 205,44 × 40,83 = $ 8.388,12, se
     renumeró FA-393 y así fue a DGI (ACEPTADO). La edición movió la DEUDA a la
     cuenta $ (DeudaDocumento 8582, cuenta 1517, 8.388,12 VENCIDO) pero NO tocó
     el cargo (editarFactura de julio no actualizaba movimientos sin
     observaciones — bug del NULL corregido el 1/9). Quedó:
       · cuenta 359 (US$): libro −205,44  → billetera "US$ −205,44" FALSA
       · cuenta 1517 ($):  libro −56.946,64 (6 facturas) vs deudas vivas
                           65.334,76 (7 facturas) → falta FA-393
     Los otros 6 ciclos de Emipal están bien (marcador 0 en US$ + cargo en $).

   QUÉ HACE (regla: manda lo que fue a DGI)
     1. Mueve el mov 26999 a la cuenta 1517 ($) con importe −8.388,12 y el
        concepto/observación con que quedan los cierres cross-moneda.
     2. Recalcula MovSaldoPosterior y CueSaldoActual de las cuentas 359 y 1517
        (misma fórmula que fix_cargo_libro_al_documento.sql).
     3. Estampa DocCotizacion = 40,83 en FA-393 (estaba NULL; los cierres
        posteriores la guardan).
     NO toca DeudaDocumento (ya está bien, en $), ni las 3 ORDEN del ciclo (en
     US$, como en todos los ciclos de este cliente), ni ningún otro cliente.

   CANDADOS: si el documento, el movimiento o la deuda no son EXACTAMENTE los
   descritos arriba, no escribe nada y explica por qué.

   ESPERADO DESPUÉS: cuenta 359 libro 0,00 · cuenta 1517 libro −65.334,76 =
   deudas vivas 65.334,76 (Cuadre 0).

   Correr en PRODUCCIÓN, en SSMS, entero (F5). @SoloVista = 1 (default) solo
   muestra; @SoloVista = 0 aplica. No deja transacciones abiertas.
   ============================================================================ */
USE [SecureAppDB];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SoloVista BIT = 1;   -- << 1 = solo mirar | 0 = aplicar

DECLARE @Doc INT = 6141, @Mov INT = 26999, @CtaUSD INT = 359, @CtaUYU INT = 1517, @Cli INT = 376,
        @Deuda INT = 8582, @Cot DECIMAL(18,4) = 40.83, @Total DECIMAL(18,2) = 8388.12;

/* ── CANDADOS ─────────────────────────────────────────────────────────────── */
IF NOT EXISTS (SELECT 1 FROM dbo.DocumentosContables d
               WHERE d.DocIdDocumento = @Doc AND RTRIM(d.DocSerie) = 'FA' AND RTRIM(d.DocNumero) = '393'
                 AND d.CliIdCliente = @Cli AND d.MonIdMoneda = 1 AND d.DocTotal = @Total AND d.CfeEstado = 'ACEPTADO_DGI')
BEGIN RAISERROR('CANDADO: el doc 6141 no es FA-393 de Emipal en $ 8.388,12 ACEPTADO_DGI. No se toca nada.', 16, 1); RETURN; END

IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
               WHERE m.MovIdMovimiento = @Mov AND m.CueIdCuenta = @CtaUSD AND m.DocIdDocumento = @Doc
                 AND m.MovTipo = 'CIERRE_CICLO' AND m.MovImporte = -205.44 AND ISNULL(m.MovAnulado, 0) = 0)
BEGIN RAISERROR('CANDADO: el mov 26999 no es el CIERRE_CICLO −205,44 de FA-393 en la cuenta 359. No se toca nada.', 16, 1); RETURN; END

IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
           WHERE m.DocIdDocumento = @Doc AND m.MovIdMovimiento <> @Mov AND ISNULL(m.MovAnulado, 0) = 0
             AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO'))
BEGIN RAISERROR('CANDADO: FA-393 tiene otros movimientos ademas del cargo (¿ya se cobro o ya se corrigio?). Revisar a mano.', 16, 1); RETURN; END

IF NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento dd
               WHERE dd.DDeIdDocumento = @Deuda AND dd.DocIdDocumento = @Doc AND dd.CueIdCuenta = @CtaUYU
                 AND dd.DDeImportePendiente = @Total AND dd.DDeEstado IN ('VENCIDO', 'PENDIENTE'))
BEGIN RAISERROR('CANDADO: la deuda 8582 de FA-393 no esta en la cuenta 1517 por 8.388,12 viva. No se toca nada.', 16, 1); RETURN; END

/* ── ANTES ────────────────────────────────────────────────────────────────── */
SELECT 'ANTES' AS Momento, cc.CueIdCuenta, CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END AS Moneda,
       SaldoLibro  = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                       WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado, 0) = 0
                         AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)),
       DeudasVivas = CAST(ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
                       WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO')), 0) AS DECIMAL(18,2)),
       Guardado    = CAST(cc.CueSaldoActual AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WHERE cc.CueIdCuenta IN (@CtaUSD, @CtaUYU) ORDER BY cc.CueIdCuenta;

SELECT 'MOVIMIENTO A MOVER' AS Paso, m.MovIdMovimiento, m.CueIdCuenta, m.MovFecha, m.MovTipo, m.MovImporte, m.MovConcepto, m.MovObservaciones
FROM dbo.MovimientosCuenta m WHERE m.MovIdMovimiento = @Mov;

/* ── APLICAR ──────────────────────────────────────────────────────────────── */
IF @SoloVista = 0
BEGIN
    BEGIN TRANSACTION;

    UPDATE dbo.MovimientosCuenta
    SET CueIdCuenta      = @CtaUYU,
        MovImporte       = -@Total,
        MovConcepto      = 'Venta E-Factura Credito             : FA-393 (Emipal Sociedad Anonima)',
        MovObservaciones = LEFT('Conversión desde ciclo USD a UYU @ 40.83 | FIX 22-sep-2026: el cargo estaba en la cuenta 359 (US$) '
                              + 'por -205.44 (nacio como FA-392 en dolares); la factura se edito a pesos y fue a DGI como FA-393 '
                              + 'por 8388.12. Manda el documento. fix_emipal_fa393_cargo_a_pesos.sql', 500)
    WHERE MovIdMovimiento = @Mov;

    UPDATE dbo.DocumentosContables SET DocCotizacion = @Cot WHERE DocIdDocumento = @Doc AND DocCotizacion IS NULL;

    -- Saldo corrido y guardado de las DOS cuentas (misma fórmula que el backend).
    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta IN (@CtaUSD, @CtaUYU) AND ISNULL(m.MovAnulado, 0) = 0
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado, 0) = 0), 0)
    FROM dbo.CuentasCliente cc WHERE cc.CueIdCuenta IN (@CtaUSD, @CtaUYU);

    COMMIT TRANSACTION;
    PRINT 'FA-393: cargo movido a la cuenta $ por 8.388,12 y saldos recalculados.';
END
ELSE
    PRINT 'SOLO VISTA: no se escribio nada. Revisar y volver a correr con @SoloVista = 0.';

/* ── DESPUÉS: el libro y las deudas tienen que decir lo mismo ─────────────── */
SELECT CASE WHEN @SoloVista = 1 THEN 'SIN CAMBIOS (vista previa)' ELSE 'DESPUES' END AS Momento,
       cc.CueIdCuenta, CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END AS Moneda,
       SaldoLibro  = CAST(s.Saldo AS DECIMAL(18,2)),
       DeudasVivas = CAST(dv.Viva AS DECIMAL(18,2)),
       Cuadre      = CAST(dv.Viva - CASE WHEN s.Saldo < 0 THEN -s.Saldo ELSE 0 END AS DECIMAL(18,2)),
       Guardado    = CAST(cc.CueSaldoActual AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado, 0) = 0
                  AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')), 0)) s
CROSS APPLY (SELECT Viva = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
                WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO')), 0)) dv
WHERE cc.CueIdCuenta IN (@CtaUSD, @CtaUYU) ORDER BY cc.CueIdCuenta;

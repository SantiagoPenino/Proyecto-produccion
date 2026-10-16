/* ============================================================================
   RXD (RXDSUBLIMACION, CliIdCliente 922, Rollo por adelantado) — cuenta 231 (US$)
   Dos cobros Handy en PESOS escritos en la cuenta en DÓLARES sin convertir.

   QUÉ PASÓ (22-sep-2026, verificado en la réplica local = pantalla de prod):
     PC-3767 (doc 9157, 21/8): retiro diferido RW-24190 por SUB-16710 "bandera 090",
       US$ 34,00 (cargo VTA_CAJA −34 en la cuenta 231). El cliente pagó online por
       Handy $ 1.389,58 pesos (transacción 8605, UYU; = 34 × 40,87) y el PAGO se
       escribió en la cuenta US$ con el número en pesos: +1.389,58 → +1.355,58 falsos.
     PC-3815 (doc 9512, 26/8): ídem, US$ 50,15 cobrados por Handy $ 2.050,63 →
       PAGO +2.050,63 en la cuenta US$ → +2.000,48 falsos.
     1.355,58 + 2.000,48 = 3.356,06 = TODO el "a favor" que muestra RXD. Real: 0.
     Es el mismo bug que el lote del 1/9 (fix_pagos_pesos_en_cuentas_usd_masivo.sql),
     que excluyó a propósito a los clientes Rollo/Semanal — por eso RXD quedó afuera.

   QUÉ HACE (misma regla del 1/9: el cobro va POR EL IMPORTE DEL CARGO de su cuenta)
     · mov 39618: 1.389,58 → 34,00   · mov 40968: 2.050,63 → 50,15
     · recalcula MovSaldoPosterior y CueSaldoActual de la cuenta 231.
     NO toca Pagos/TransaccionesCaja (ahí queda el monto real en pesos, que es lo que
     el 360 muestra como "pagado $ 1.389,58"), ni documentos, ni otras cuentas.

   ESPERADO DESPUÉS: cuenta 231 libro 0,00 (todos sus contado netean).

   Correr en PRODUCCIÓN, en SSMS, entero (F5). @SoloVista = 1 (default) solo muestra;
   @SoloVista = 0 aplica. No deja transacciones abiertas.
   ============================================================================ */
USE [SecureAppDB];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SoloVista BIT = 1;   -- << 1 = solo mirar | 0 = aplicar
DECLARE @Cta INT = 231, @Cli INT = 922;

DECLARE @Fix TABLE (MovIdMovimiento INT PRIMARY KEY, DocIdDocumento INT, Doc VARCHAR(20), ImporteViejo DECIMAL(18,4), ImporteNuevo DECIMAL(18,4), PesosReales DECIMAL(18,2));
INSERT INTO @Fix VALUES (39618, 9157, 'PC-3767', 1389.58, 34.00, 1389.58),
                        (40968, 9512, 'PC-3815', 2050.63, 50.15, 2050.63);

/* ── CANDADOS: cada movimiento tiene que ser EXACTAMENTE el descrito ─────── */
IF EXISTS (SELECT 1 FROM @Fix f
           WHERE NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                             WHERE m.MovIdMovimiento = f.MovIdMovimiento AND m.CueIdCuenta = @Cta AND m.DocIdDocumento = f.DocIdDocumento
                               AND m.MovTipo = 'PAGO' AND m.MovImporte = f.ImporteViejo AND ISNULL(m.MovAnulado, 0) = 0)
              OR NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta c
                             WHERE c.DocIdDocumento = f.DocIdDocumento AND c.CueIdCuenta = @Cta AND c.MovTipo = 'VTA_CAJA'
                               AND c.MovImporte = -f.ImporteNuevo AND ISNULL(c.MovAnulado, 0) = 0)
              OR NOT EXISTS (SELECT 1 FROM dbo.DocumentosContables d
                             WHERE d.DocIdDocumento = f.DocIdDocumento AND RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero) = f.Doc
                               AND d.CliIdCliente = @Cli AND d.MonIdMoneda = 1 AND d.DocTotal = f.PesosReales))
BEGIN RAISERROR('CANDADO: alguno de los dos cobros (39618 / 40968) o su cargo/documento no es el esperado. No se toca nada.', 16, 1); RETURN; END

IF NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cta AND CliIdCliente = @Cli AND CueTipo = 'DINERO_USD')
BEGIN RAISERROR('CANDADO: la cuenta 231 no es la cuenta US$ de RXD. No se toca nada.', 16, 1); RETURN; END

/* ── ANTES ────────────────────────────────────────────────────────────────── */
SELECT 'ANTES' AS Momento, cc.CueIdCuenta,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
                                 AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)),
       DeudasVivas = CAST(ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = cc.CueIdCuenta
                                  AND dd.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO')), 0) AS DECIMAL(18,2)),
       Guardado = CAST(cc.CueSaldoActual AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WHERE cc.CueIdCuenta = @Cta;

SELECT 'A CORREGIR' AS Paso, f.Doc, m.MovIdMovimiento, CONVERT(VARCHAR(16), m.MovFecha, 120) AS Fecha, m.MovImporte AS PagoEscritoUSD,
       f.ImporteNuevo AS PagoCorrectoUSD, f.PesosReales AS CobroRealPesos, LEFT(m.MovConcepto, 50) AS Concepto
FROM @Fix f JOIN dbo.MovimientosCuenta m ON m.MovIdMovimiento = f.MovIdMovimiento;

/* ── APLICAR ──────────────────────────────────────────────────────────────── */
IF @SoloVista = 0
BEGIN
    BEGIN TRANSACTION;

    UPDATE m
    SET m.MovImporte = f.ImporteNuevo,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') + ' FIX_MONEDA_2026-09-22: el cobro decia '
            + CONVERT(VARCHAR(20), CAST(f.ImporteViejo AS DECIMAL(18,2))) + ' en una cuenta en dolares; era el cobro real en pesos ($ '
            + CONVERT(VARCHAR(20), f.PesosReales) + ', Handy) escrito sin convertir. Queda igual al cargo: US$ '
            + CONVERT(VARCHAR(20), CAST(f.ImporteNuevo AS DECIMAL(18,2))) + '. fix_rxd_pagos_pesos_en_cuenta_usd.sql'), 500)
    FROM dbo.MovimientosCuenta m JOIN @Fix f ON f.MovIdMovimiento = m.MovIdMovimiento;

    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = @Cta AND ISNULL(m.MovAnulado, 0) = 0
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado, 0) = 0), 0)
    FROM dbo.CuentasCliente cc WHERE cc.CueIdCuenta = @Cta;

    COMMIT TRANSACTION;
    PRINT 'RXD: los 2 cobros quedaron en dolares (34,00 y 50,15) y la cuenta 231 recalculada.';
END
ELSE
    PRINT 'SOLO VISTA: no se escribio nada. Revisar y volver a correr con @SoloVista = 0.';

/* ── DESPUÉS ──────────────────────────────────────────────────────────────── */
SELECT CASE WHEN @SoloVista = 1 THEN 'SIN CAMBIOS (vista previa)' ELSE 'DESPUES' END AS Momento, cc.CueIdCuenta,
       SaldoLibro = CAST(s.Saldo AS DECIMAL(18,2)),
       DeudasVivas = CAST(dv.Viva AS DECIMAL(18,2)),
       Cuadre = CAST(dv.Viva - CASE WHEN s.Saldo < 0 THEN -s.Saldo ELSE 0 END AS DECIMAL(18,2)),
       Guardado = CAST(cc.CueSaldoActual AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
                AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')), 0)) s
CROSS APPLY (SELECT Viva = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = cc.CueIdCuenta
                AND dd.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO')), 0)) dv
WHERE cc.CueIdCuenta = @Cta;

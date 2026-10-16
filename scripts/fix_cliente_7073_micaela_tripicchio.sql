-- ============================================================================
-- fix_cliente_7073_micaela_tripicchio.sql
-- ----------------------------------------------------------------------------
-- Micaela Tripicchio (cliente 7073, tipo Común). Cuentas: 138 (US$) y 1723 ($).
--
-- ESTADO HOY:  $ −11.700,00 (figura debiendo) · US$ 0,00
-- COMO QUEDA:  $ 0,00 · US$ 0,00
--
-- NO DEBE NADA. Sus dos comprobantes se repartieron entre las DOS cuentas (una
-- parte en dólares, otra en pesos) pero el cobro se asentó SOLO en la de dólares:
--
--   ET-3564 (doc 6242, 30/07, $ 16.360,06)
--       cargo US$   121,47 en la cuenta 138  → cobrado US$ 121,47  ✔
--       cargo $  11.400,00 en la cuenta 1723 → SIN COBRO           ✘
--       caja: transacción 5902 COMPLETADA, cobrado 16.360,06 (el total)
--
--   ET-6684 (doc 9920, 28/08, $ 2.491,00)
--       cargo US$    53,61 en la cuenta 138  → cobrado US$ 53,61   ✔
--       cargo $     300,00 en la cuenta 1723 → SIN COBRO           ✘
--       caja: transacción 9297 COMPLETADA, cobrado 2.491,00 (el total)
--
-- Es la misma falla que se corrigió en el código (el cobro tiene que repartirse
-- igual que el cargo, cuenta por cuenta), pero acá la generó la CAJA al vender.
--
-- QUÉ HACE: registra los dos movimientos de cobro que faltan en la cuenta en pesos,
-- por el importe del cargo de ESA cuenta y con la fecha del comprobante. Después
-- recalcula el saldo corrido y el guardado de las cuentas del cliente.
-- NO toca documentos, ni cargos, ni deudas, ni las transacciones de caja.
--
-- Idempotente: si esos cobros ya están puestos, frena sin tocar nada.
--
-- ABRIR DESDE EL DISCO en SSMS (File → Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Cli INT = 7073;
DECLARE @Cue INT = 1723;   -- cuenta en pesos, la que quedó sin el cobro

DECLARE @Faltan TABLE (DocIdDocumento INT, Importe DECIMAL(18,4), Fecha DATETIME, Etiqueta VARCHAR(20));
INSERT INTO @Faltan VALUES
 (6242, 11400.00, '2026-07-30T20:44:13', 'ET-3564'),
 (9920,   300.00, '2026-08-28T18:51:14', 'ET-6684');

-- ── CANDADOS ────────────────────────────────────────────────────────────────
DECLARE @N INT;

-- (a) la cuenta en pesos NO puede tener ya un cobro de esos documentos
SELECT @N = COUNT(*) FROM dbo.MovimientosCuenta m
JOIN @Faltan f ON f.DocIdDocumento = m.DocIdDocumento
WHERE m.CueIdCuenta = @Cue AND m.MovTipo = 'PAGO' AND m.MovImporte > 0
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);
IF @N > 0
BEGIN
    RAISERROR('Ya hay %d cobro(s) de esos documentos en la cuenta %d. No se repone nada.', 16, 1, @N, @Cue);
    RETURN;
END

-- (b) el cargo de cada documento tiene que estar en esta cuenta por el importe exacto
SELECT @N = COUNT(*) FROM @Faltan f
WHERE NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                  WHERE m.DocIdDocumento = f.DocIdDocumento AND m.CueIdCuenta = @Cue
                    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                    AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')
                    AND ABS(m.MovImporte + f.Importe) < 0.02);
IF @N > 0
BEGIN
    RAISERROR('%d documento(s) no tienen su cargo en la cuenta %d por el importe esperado. No se toca nada.', 16, 1, @N, @Cue);
    RETURN;
END

-- (c) la caja tiene que decir que el cliente pagó el TOTAL del comprobante
SELECT @N = COUNT(*) FROM @Faltan f
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = f.DocIdDocumento
LEFT JOIN dbo.TransaccionesCaja t ON t.TcaIdTransaccion = d.TcaIdTransaccion
WHERE t.TcaIdTransaccion IS NULL
   OR t.TcaEstado NOT IN ('COMPLETADO','COBRADO')
   OR ABS(t.TcaTotalCobrado - d.DocTotal) > 1;
IF @N > 0
BEGIN
    RAISERROR('%d documento(s) no tienen la transacción de caja completada por el total. No se repone nada.', 16, 1, @N);
    RETURN;
END

-- ── ANTES ───────────────────────────────────────────────────────────────────
SELECT Momento = 'ANTES', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo  = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                        WHERE m.CueIdCuenta = cc.CueIdCuenta
                          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                          AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
FROM dbo.CuentasCliente cc
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.CueIdCuenta;

BEGIN TRANSACTION;

    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
         DocIdDocumento, MovFecha, MovUsuarioAlta, MovAnulado, MovObservaciones)
    SELECT @Cue, 'PAGO',
           'Pago (E-Ticket Contado): ' + f.Etiqueta + ' (repuesto: la parte en pesos del cobro no estaba)',
           f.Importe, 0, f.DocIdDocumento, f.Fecha, 1, 0,
           'FIX_CLIENTE_2026-09-01: el comprobante se repartió entre las dos cuentas y el cobro se asentó solo en la de dólares. La caja registró el cobro del total.'
    FROM @Faltan f;
    -- Esperado: 2 filas

    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
        WHERE cc.CliIdCliente = @Cli AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%';

COMMIT TRANSACTION;

-- ── DESPUÉS: las dos cuentas en 0,00 ───────────────────────────────────────
SELECT Momento = 'DESPUES', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo  = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                        WHERE m.CueIdCuenta = cc.CueIdCuenta
                          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                          AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
FROM dbo.CuentasCliente cc
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.CueIdCuenta;

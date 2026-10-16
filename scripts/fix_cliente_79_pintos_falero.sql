-- ============================================================================
-- fix_cliente_79_pintos_falero.sql
-- ----------------------------------------------------------------------------
-- Pintos Falero Alex Daniel (cliente 79, tipo Común). Cuenta 266 ($).
--
-- ESTADO HOY:  $ −15.839,15 (figura debiendo)
-- COMO QUEDA:  $ 0,00
--
-- NO DEBE NADA: pagó las dos facturas en caja y el movimiento de cobro nunca se
-- asentó en el libro mayor.
--
--   FA-75  (doc 3442, 09/07, $ 2.338,01)  → transacción de caja 3349, COMPLETADA,
--          TcaTotalCobrado 2.338,01, 1 pago registrado. DocPagado=1, ACEPTADO_DGI.
--   FA-213 (doc 4833, 21/07, $ 13.944,99) → transacción de caja 4668, COMPLETADA,
--          TcaTotalCobrado 13.945,00, 2 pagos registrados. DocPagado=1, ACEPTADO_DGI.
--
-- Y además tiene TRES cobros sueltos (443,85) por órdenes que ya se cobraron dentro
-- de esas mismas facturas — el cobro quedó contado dos veces:
--   57,15  → SUB-5144 + SUB-5146, facturadas en la FA-75
--   44,16  → SUB-4284 + SUB-4283, facturadas en el PC-1984 (ya cobrado y neteado)
--   342,54 → SUB-6715 + SUB-6818, facturadas en la FA-213
--
-- La cuenta cierra sola: −15.839,15 + 2.338,01 + 13.944,99 − 443,85 = 0,00
--
-- QUÉ HACE:
--   1. Registra los dos movimientos de cobro que faltan, con la fecha de la
--      transacción de caja y vinculados a su documento.
--   2. Anula (MovAnulado = 1, NO borra) los tres cobros sueltos duplicados.
--   3. Recalcula el saldo corrido y el guardado de la cuenta.
-- NO toca documentos, ni cargos, ni deudas, ni las transacciones de caja.
--
-- Idempotente: si los cobros ya están puestos o los sueltos ya anulados, frena.
--
-- ABRIR DESDE EL DISCO en SSMS (File → Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Cli INT = 79;
DECLARE @Cue INT = 266;

-- Los cobros que faltan: documento, importe y fecha de la transacción de caja
DECLARE @Faltan TABLE (DocIdDocumento INT, Importe DECIMAL(18,4), Fecha DATETIME, Etiqueta VARCHAR(20));
INSERT INTO @Faltan VALUES
 (3442,  2338.01, '2026-07-09T14:22:53', 'FA-75'),
 (4833, 13944.99, '2026-07-21T15:43:55', 'FA-213');

-- Los cobros sueltos duplicados
DECLARE @Sueltos TABLE (MovIdMovimiento INT PRIMARY KEY, Motivo VARCHAR(200));
INSERT INTO @Sueltos VALUES
 (16073, 'cobro duplicado: SUB-5144 y SUB-5146 ya se cobraron dentro de la FA-75'),
 (16075, 'cobro duplicado: SUB-4284 y SUB-4283 ya se cobraron dentro del PC-1984'),
 (21691, 'cobro duplicado: SUB-6715 y SUB-6818 ya se cobraron dentro de la FA-213');

-- ── CANDADOS ────────────────────────────────────────────────────────────────
DECLARE @N INT;

-- (a) los tres sueltos tienen que estar vivos y ser de esta cuenta
SELECT @N = COUNT(*) FROM dbo.MovimientosCuenta m
JOIN @Sueltos s ON s.MovIdMovimiento = m.MovIdMovimiento
WHERE m.CueIdCuenta = @Cue AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);
IF @N <> 3
BEGIN
    RAISERROR('Se esperaban 3 cobros sueltos vivos en la cuenta y hay %d. Puede que ya se haya corrido. No se toca nada.', 16, 1, @N);
    RETURN;
END

-- (b) los dos documentos NO pueden tener ya un cobro asentado
SELECT @N = COUNT(*) FROM dbo.MovimientosCuenta m
JOIN @Faltan f ON f.DocIdDocumento = m.DocIdDocumento
WHERE m.MovTipo = 'PAGO' AND m.MovImporte > 0 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);
IF @N > 0
BEGIN
    RAISERROR('Las facturas ya tienen %d cobro(s) asentado(s): no se repone nada.', 16, 1, @N);
    RETURN;
END

-- (c) el cargo de cada documento tiene que estar en esta cuenta por el importe esperado
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

-- ── ANTES ───────────────────────────────────────────────────────────────────
SELECT Momento = 'ANTES', CueIdCuenta = @Cue,
       Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                       WHERE m.CueIdCuenta = @Cue AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                         AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0);

BEGIN TRANSACTION;

    -- 1. Reponer los cobros que faltan
    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
         DocIdDocumento, MovFecha, MovUsuarioAlta, MovAnulado, MovObservaciones)
    SELECT @Cue, 'PAGO',
           'Pago (E-Factura Contado): ' + f.Etiqueta + ' (repuesto: el cobro contado no estaba en el libro)',
           f.Importe, 0, f.DocIdDocumento, f.Fecha, 1, 0,
           'FIX_CLIENTE_2026-09-01: el cliente pagó en caja (transacción COMPLETADA, DocPagado=1, ACEPTADO_DGI) pero el movimiento de cobro nunca se asentó.'
    FROM @Faltan f;
    -- Esperado: 2 filas

    -- 2. Anular los cobros sueltos duplicados
    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') +
            ' FIX_CLIENTE_2026-09-01: ' + s.Motivo + '.'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN @Sueltos s ON s.MovIdMovimiento = m.MovIdMovimiento;
    -- Esperado: 3 filas

    -- 3. Recalcular saldo corrido y guardado
    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta = @Cue AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE dbo.CuentasCliente
    SET CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                 WHERE m.CueIdCuenta = @Cue AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    WHERE CueIdCuenta = @Cue;

COMMIT TRANSACTION;

-- ── DESPUÉS: tiene que quedar en 0,00 ──────────────────────────────────────
SELECT Momento = 'DESPUES', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo  = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                        WHERE m.CueIdCuenta = cc.CueIdCuenta
                          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                          AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
FROM dbo.CuentasCliente cc
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.CueIdCuenta;

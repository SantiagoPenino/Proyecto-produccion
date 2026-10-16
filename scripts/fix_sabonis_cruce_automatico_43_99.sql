-- ============================================================================
-- fix_sabonis_cruce_automatico_43_99.sql
-- ----------------------------------------------------------------------------
-- SABONIS - ARTEIDEA (RUC 213866340011). Revierte el cruce automático de monedas
-- del 19/08 y pone el pago del cliente donde corresponde.
--
-- QUÉ PASÓ:
--   19/08 14:23 — entra una orden de bordado por $ 1.800. El motor de cobertura
--                 automática (contabilidadService, hook de orden creada) ve
--                 "saldo a favor en dólares" y saca US$ 43,99 para cubrirla:
--                    cuenta 126 (US$)  PAGO_CRUZADO  −43,9883
--                    cuenta 2661 ($)   PAGO_CRUZADO  +1.800,00
--                 Ese saldo a favor era el FANTASMA de los pagos en pesos mal
--                 asentados. Plata que no existía.
--   26/08 — el cliente paga el FA-1150 completo en efectivo: $ 5.082,63, con el
--           bordado adentro. Ese pago entró entero a la cuenta de dólares (ya
--           corregido a US$ 80,16, que es la parte en dólares del comprobante),
--           así que los $ 1.800 del bordado no quedaron registrados en ningún lado.
--
-- QUÉ HACE ESTE SCRIPT:
--   1. Anula los dos movimientos del cruce (no los borra: quedan auditables con
--      MovAnulado = 1 y el motivo en MovObservaciones).
--   2. Registra en la cuenta en pesos el PAGO de $ 1.800 que el cliente sí hizo,
--      vinculado al FA-1150.
--   3. Recalcula el saldo corrido de las dos cuentas.
--
-- CÓMO QUEDA:
--   cuenta 2661 ($)   → 0,00   (cargo −1.800 contra el pago +1.800)
--   cuenta 126 (US$)  → sube 43,99. Si ya corriste fix_sabonis_fa598_cargo_faltante,
--                       queda en 0,00. Si todavía no, queda en 5.000,05 y se va a
--                       cero cuando lo corras. El orden entre los dos no importa.
--
-- NO TOCA: el FA-1150 (está ACEPTADO_DGI) ni la orden de bordado.
--
-- NOTA AL MARGEN: la línea de bordado del comprobante dice $ 1.804,88 y el cargo
-- asentado es $ 1.800,00. Esos $ 4,88 son de la otra familia (cargo ≠ líneas) y no
-- se tocan acá.
--
-- ABRIR DESDE EL DISCO en SSMS (File → Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @CueUsd  INT = 126;     -- cuenta en dólares (de donde salió el cruce)
DECLARE @CueUyu  INT = 2661;    -- cuenta en pesos (la que recibió la cobertura)
DECLARE @Doc     INT = 9406;    -- FA-1150
DECLARE @Usuario INT = 1;

DECLARE @MovUsd INT, @MovUyu INT, @ImpUsd DECIMAL(18,4), @ImpUyu DECIMAL(18,4), @N INT;

-- ── Ubicar los dos movimientos del cruce (vivos) ────────────────────────────
SELECT TOP 1 @MovUsd = MovIdMovimiento, @ImpUsd = MovImporte
FROM dbo.MovimientosCuenta
WHERE CueIdCuenta = @CueUsd AND MovTipo = 'PAGO_CRUZADO' AND MovImporte < 0
  AND (MovAnulado IS NULL OR MovAnulado = 0)
ORDER BY MovIdMovimiento DESC;

SELECT TOP 1 @MovUyu = MovIdMovimiento, @ImpUyu = MovImporte
FROM dbo.MovimientosCuenta
WHERE CueIdCuenta = @CueUyu AND MovTipo = 'PAGO_CRUZADO' AND MovImporte > 0
  AND (MovAnulado IS NULL OR MovAnulado = 0)
ORDER BY MovIdMovimiento DESC;

IF @MovUsd IS NULL OR @MovUyu IS NULL
BEGIN
    RAISERROR('No se encontraron los dos movimientos del cruce vivos. Puede que ya se haya corrido este script. No se toca nada.', 16, 1);
    RETURN;
END

-- ── CANDADO: que no haya más de un cruce vivo en ninguna de las dos cuentas ─
SELECT @N = COUNT(*)
FROM dbo.MovimientosCuenta
WHERE MovTipo = 'PAGO_CRUZADO'
  AND (MovAnulado IS NULL OR MovAnulado = 0)
  AND ((CueIdCuenta = @CueUsd AND MovImporte < 0) OR (CueIdCuenta = @CueUyu AND MovImporte > 0));

IF @N <> 2
BEGIN
    SELECT MovIdMovimiento, CueIdCuenta, MovTipo, MovImporte, MovFecha, MovConcepto
    FROM dbo.MovimientosCuenta
    WHERE MovTipo = 'PAGO_CRUZADO' AND (MovAnulado IS NULL OR MovAnulado = 0)
      AND CueIdCuenta IN (@CueUsd, @CueUyu);
    RAISERROR('Se esperaban 2 movimientos de cruce y hay %d (listados arriba). No se toca nada.', 16, 1, @N);
    RETURN;
END

-- ── ANTES ───────────────────────────────────────────────────────────────────
SELECT Momento = 'ANTES',
       MovUsd = @MovUsd, ImporteUsd = @ImpUsd,
       MovUyu = @MovUyu, ImporteUyu = @ImpUyu,
       SaldoUsd = ISNULL((SELECT SUM(MovImporte) FROM dbo.MovimientosCuenta
                          WHERE CueIdCuenta = @CueUsd AND (MovAnulado IS NULL OR MovAnulado = 0)
                            AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0),
       SaldoUyu = ISNULL((SELECT SUM(MovImporte) FROM dbo.MovimientosCuenta
                          WHERE CueIdCuenta = @CueUyu AND (MovAnulado IS NULL OR MovAnulado = 0)
                            AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0);

BEGIN TRANSACTION;

    -- 1. Anular los dos movimientos del cruce
    UPDATE dbo.MovimientosCuenta
    SET MovAnulado = 1,
        MovObservaciones = LEFT(LTRIM(ISNULL(MovObservaciones, '') +
            ' FIX_CRUCE_2026-09-01: cruce automático disparado por el saldo a favor FANTASMA' +
            ' de la cuenta en dólares (pagos en pesos asentados sin convertir). El bordado lo' +
            ' pagó el cliente en efectivo dentro del FA-1150.'), 500)
    WHERE MovIdMovimiento IN (@MovUsd, @MovUyu);
    -- Esperado: 2 filas afectadas

    -- 2. Registrar el pago real del cliente en la cuenta en pesos
    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
         DocIdDocumento, MovFecha, MovUsuarioAlta, MovAnulado, MovObservaciones)
    VALUES
        (@CueUyu, 'PAGO', 'Pago (E-Factura Contado): FA-1150 — parte en pesos',
         ABS(@ImpUyu), 0, @Doc,
         (SELECT DocFechaEmision FROM dbo.DocumentosContables WHERE DocIdDocumento = @Doc),
         @Usuario, 0,
         'FIX_CRUCE_2026-09-01: parte en pesos del cobro del FA-1150 (el cliente pagó $ 5.082,63; la parte en dólares quedó en la cuenta 126).');

    -- 3. Recalcular saldo corrido y saldo guardado de las dos cuentas
    ;WITH ord AS (
        SELECT MovIdMovimiento,
               SUM(MovImporte) OVER (PARTITION BY CueIdCuenta ORDER BY MovFecha, MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS run
        FROM dbo.MovimientosCuenta
        WHERE CueIdCuenta IN (@CueUsd, @CueUyu) AND (MovAnulado IS NULL OR MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(MovImporte) FROM dbo.MovimientosCuenta
                                    WHERE CueIdCuenta = cc.CueIdCuenta
                                      AND (MovAnulado IS NULL OR MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta IN (@CueUsd, @CueUyu);

COMMIT TRANSACTION;

-- ── DESPUÉS ─────────────────────────────────────────────────────────────────
-- Esperado: la cuenta en pesos en 0,00 y la de dólares 43,99 más arriba que antes.
SELECT Momento = 'DESPUES',
       cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       cc.CueSaldoActual AS SaldoGuardado,
       SaldoLibro = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            WHERE m.CueIdCuenta = cc.CueIdCuenta
                              AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                              AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
FROM dbo.CuentasCliente cc
WHERE cc.CueIdCuenta IN (@CueUsd, @CueUyu);

SELECT Momento = 'DESPUES · movimientos del FA-1150 y del cruce',
       m.MovIdMovimiento, m.CueIdCuenta, m.MovTipo, m.MovImporte, m.MovAnulado,
       Concepto = LEFT(m.MovConcepto, 60)
FROM dbo.MovimientosCuenta m
WHERE m.DocIdDocumento = @Doc
   OR m.MovIdMovimiento IN (@MovUsd, @MovUyu)
ORDER BY m.MovIdMovimiento;

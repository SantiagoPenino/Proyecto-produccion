-- ============================================================================
-- PROD_fix_camilo7008_parteD.sql
-- ----------------------------------------------------------------------------
-- CONTINUACION de PROD_fix_camilo7008.sql, que ya se corrio con las partes
-- A, B y C. Esta es la parte D, que se descubrio despues.
--
-- NO correr el script grande de nuevo: sus candados exigen el estado ANTERIOR
-- (los cobros del PC-2216 en 1.050) y va a abortar sin hacer nada.
--
-- (D) PC-3576 — pago espejo fantasma (US$ 389,91).
--     El movimiento 47938 es un PAGO de 389,91 creado en el MISMO SEGUNDO que
--     el cargo (27/08 15:39:32): el pago automatico que el sistema arma cuando
--     un documento nace CONTADO. Pero ese pago no existe:
--         . el movimiento no tiene PagIdPago, ni fila en Pagos, ni recibo
--         . el documento NO tiene TcaIdTransaccion (nadie cobro en caja)
--         . el documento tiene DocPagado = 0
--     Y la deuda del PC-3576 YA esta cubierta por un ANTICIPO_APLICADO de
--     389,91, o sea que se pago con el saldo a favor de la NC-11. Esta cobrado
--     DOS VECES.
--     (El ET-3643 y la FA-1134 del mismo cliente tambien tienen pago espejo,
--      pero los dos tienen su caja real detras. Este no.)
--
-- QUE HACE: anula el movimiento 47938. NADA MAS.
--     La deuda del PC-3576 NO se toca: la sigue cubriendo el anticipo.
--
-- COMO QUEDA:
--       cuenta 11 (US$)  +509,46  ->  +119,55
--       = 541,27 (NC-11, real) - 389,91 (PC-3576) - 31,81 (PC-4026)
--
--       Ese es el saldo a favor VERDADERO de CAMILO-7008: lo que sobra de la
--       nota de credito NC-11 despues de cubrir esos dos pedidos.
--       En pesos queda -270,00 (el PC-2877), que ya dejo la parte C.
--
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @CueUsd INT = 11, @CuePesos INT = 1534;
DECLARE @MovEspejo INT = 47938, @ImporteEspejo DECIMAL(18,4) = 389.91, @Doc3576 INT = 9628;

-- ══ CONTROL: que las partes A, B y C hayan quedado bien ════════════════════
-- No frena nada, es para que se vea de un vistazo antes de seguir.
SELECT Control = 'A - PC-2216 (esperado: cargo -1540 / cobros 1540)',
       Cargo  = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                WHERE m.DocIdDocumento = 4303 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                  AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')), 0) AS DECIMAL(18,2)),
       Cobros = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                WHERE m.DocIdDocumento = 4303 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                  AND m.MovTipo = 'PAGO'), 0) AS DECIMAL(18,2));

SELECT Control = 'B - PC-2082 (esperado: cargo -340)',
       Cargo = CAST((SELECT m.MovImporte FROM dbo.MovimientosCuenta m
                     WHERE m.MovIdMovimiento = 18532) AS DECIMAL(18,2));

SELECT Control = 'C - PC-2877 (esperado: 270,00 PENDIENTE)',
       dd.DDeImporteOriginal, dd.DDeImportePendiente, dd.DDeEstado
FROM dbo.DeudaDocumento dd WHERE dd.DDeIdDocumento = 9018;

-- ══ CANDADOS DE LA PARTE D ═════════════════════════════════════════════════

-- 1 · el pago espejo tiene que estar vivo y sin respaldo
IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
               WHERE m.MovIdMovimiento = @MovEspejo AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo = 'PAGO' AND m.CueIdCuenta = @CueUsd
                 AND ABS(m.MovImporte - @ImporteEspejo) <= 0.01
                 AND m.DocIdDocumento = @Doc3576
                 AND m.PagIdPago IS NULL)
BEGIN
    RAISERROR('El movimiento 47938 ya no esta como lo vio el diagnostico (vivo, PAGO, cuenta 11, 389,91, del PC-3576, sin PagIdPago). Puede que ya se haya anulado. No se toca nada.', 16, 1);
    RETURN;
END

-- 2 · si el PC-3576 tuviera caja, ese cobro seria REAL y el que sobra seria el anticipo
IF EXISTS (SELECT 1 FROM dbo.DocumentosContables WHERE DocIdDocumento = @Doc3576 AND TcaIdTransaccion IS NOT NULL)
BEGIN
    RAISERROR('El PC-3576 SI tiene transaccion de caja: entonces el cobro es real y el que sobra es el anticipo. Revisar a mano. No se toca nada.', 16, 1);
    RETURN;
END

-- 3 · la deuda tiene que estar cubierta por el anticipo, si no queda impaga sin querer
IF NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento dd
               JOIN dbo.ImputacionPago ip ON ip.DDeIdDocumento = dd.DDeIdDocumento
               JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
               WHERE dd.DocIdDocumento = @Doc3576
                 AND p.PagTipoMovimiento = 'ANTICIPO_APLICADO' AND p.PagTcaIdTransaccion IS NULL
                 AND ABS(ip.ImpImporte - @ImporteEspejo) <= 0.01)
BEGIN
    RAISERROR('La deuda del PC-3576 NO esta cubierta por un ANTICIPO_APLICADO de 389,91. Sacar el pago espejo la dejaria impaga. No se toca nada.', 16, 1);
    RETURN;
END

-- ══ ANTES ══════════════════════════════════════════════════════════════════
SELECT Momento = 'ANTES', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (@CueUsd, @CuePesos);

-- ══ EL ARREGLO ═════════════════════════════════════════════════════════════
BEGIN TRANSACTION;

    UPDATE dbo.MovimientosCuenta
    SET MovAnulado = 1,
        MovObservaciones = LEFT(LTRIM(ISNULL(MovObservaciones,'') +
            ' FIX_CAMILO_D_2026-09-08: pago espejo creado en el mismo segundo que el cargo,' +
            ' sin PagIdPago, sin recibo y sin transaccion de caja; el documento tenia' +
            ' DocPagado=0. La deuda ya estaba cubierta por el ANTICIPO_APLICADO de 389,91' +
            ' (saldo a favor de la NC-11): estaba cobrado dos veces. Se anula el espejo.'), 500)
    WHERE MovIdMovimiento = @MovEspejo;

    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta = @CueUsd AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta = @CueUsd;

COMMIT TRANSACTION;

-- ══ DESPUES ════════════════════════════════════════════════════════════════
-- Esperado:  cuenta 11 (US$) = +119,55   |   cuenta 1534 ($) = -270,00
SELECT Momento = 'DESPUES', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (@CueUsd, @CuePesos);

-- La deuda del PC-3576 tiene que seguir COBRADA (la cubre el anticipo)
SELECT Momento = 'DESPUES - PC-3576', dd.DDeIdDocumento, dd.DDeImporteOriginal,
       dd.DDeImportePendiente, dd.DDeEstado
FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento = @Doc3576;

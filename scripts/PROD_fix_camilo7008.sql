-- ============================================================================
-- PROD_fix_camilo7008.sql
-- ----------------------------------------------------------------------------
-- CAMILO-7008 (CliIdCliente 4, Semanal). Hoy figura con plata a favor en las dos
-- cuentas, y no es suya:
--       cuenta 11   (US$) = +1.069,46
--       cuenta 1534 ($)   =    +61,50
--
-- Son CUATRO cosas encadenadas:
--
-- (A) PC-2216 — los COBROS estan asentados por un importe que no es el suyo.
--     La caja cobro $ 62.893,60 (Tca 4162) = US$ 1.540 al TC 40,84, en DOS recibos:
--         RC-000336  US$   520,17   (PagId 55737)
--         RC-000338  US$ 1.019,83   (PagId 55738)
--                    -----------
--                    US$ 1.540,00  = exactamente el cargo (-1.540) y la deuda (1.540, COBRADO)
--     Pero los dos movimientos de la cuenta dicen 1.050 y 1.050 = 2.100.
--     Sobran US$ 560. (NO es un cobro duplicado: son dos cobros reales, de
--     fechas distintas, con recibos distintos; lo que esta mal es el importe
--     con que se asentaron.)
--
-- (B) PC-2082 — el CARGO esta en la moneda equivocada.
--     Documento de $ 340 (pesos), cuenta 1534 (pesos), pero el cargo es -8,50:
--         340 / 40 = 8,50   -> el importe quedo en DOLARES dentro de la cuenta de PESOS.
--     Es el espejo del caso EMB-4353 de CR SPORT. Sobran $ 331,50.
--     (El concepto menciona "Factura ET-1993", un e-Ticket que NO EXISTE: el mismo
--      sintoma del cierre que vimos en Palmero con el ET-6380.)
--
-- (C) PC-2877 — se pago con esa plata a favor que no existia.
--     Deuda 9018: original 270, pendiente 208,50, PARCIAL. Los 61,50 que faltan
--     salieron de un pago ANTICIPO_APLICADO sin caja (PagId 56216), es decir del
--     saldo a favor falso que dejo (B). Al corregir (B) ese saldo desaparece, asi
--     que la deuda tiene que volver por el total. Mismo caso que el PC-3853 de Palmero.
--
-- (D) PC-3576 — pago espejo fantasma (US$ 389,91).
--     El movimiento 47938 es un PAGO de 389,91 creado en el MISMO SEGUNDO que el
--     cargo (27/08 15:39:32): es el pago automatico que el sistema arma cuando un
--     documento nace CONTADO. Pero ese pago no existe:
--         . el movimiento no tiene PagIdPago, ni fila en Pagos, ni recibo
--         . el documento NO tiene TcaIdTransaccion (nadie cobro en caja)
--         . el documento tiene DocPagado = 0
--     Y la deuda del PC-3576 YA esta cubierta por un ANTICIPO_APLICADO de 389,91,
--     o sea que se pago con el saldo a favor de la NC-11. Esta cobrado DOS VECES.
--     (Comparar con el ET-3643 y la FA-1134 del mismo cliente: tambien tienen pago
--      espejo, pero los dos tienen su caja real detras. Este no.)
--     Se anula el movimiento. La deuda queda igual: la sigue cubriendo el anticipo.
--
-- COMO QUEDA (verificado contra PRODUCCION el 8-sep-2026):
--       cuenta 11   (US$) +1.069,46  ->  +119,55
--                          = 541,27 (NC-11, real) - 389,91 (PC-3576) - 31,81 (PC-4026)
--       cuenta 1534 ($)      +61,50  ->    -270,00   (debe el PC-2877 entero)
--       PC-2877: deuda 270,00 PENDIENTE, cobrable desde caja
--
--       Los 119,55 que quedan a favor SI son del cliente: es lo que sobra de la nota
--       de credito NC-11 (aceptada por DGI) despues de cubrir el PC-3576 y el PC-4026.
--
-- NO crea movimientos. El unico que ANULA es el pago espejo del PC-3576 (D).
-- NO toca los recibos ni la caja. NO toca ningun DocTotal.
--
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Cli INT = 4;
DECLARE @CueUsd INT = 11, @CuePesos INT = 1534;

-- (A) PC-2216
DECLARE @MovCobroA INT = 27794, @CorrectoA DECIMAL(18,4) = 520.17;   -- RC-000336
DECLARE @MovCobroB INT = 27795, @CorrectoB DECIMAL(18,4) = 1019.83;  -- RC-000338
-- (B) PC-2082
DECLARE @MovCargoC INT = 18532, @CorrectoC DECIMAL(18,4) = 340.00;   -- DocTotal del PC-2082
-- (C) PC-2877
DECLARE @Deuda2877 INT = 9018, @Fantasma DECIMAL(18,4) = 61.50, @PagFantasma INT = 56216;
-- (D) PC-3576
DECLARE @MovEspejo INT = 47938, @ImporteEspejo DECIMAL(18,4) = 389.91, @Doc3576 INT = 9628;

-- ══ CANDADOS ═══════════════════════════════════════════════════════════════

-- 1 · los dos cobros del PC-2216, vivos, por 1.050 cada uno, en la cuenta USD
IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta
               WHERE MovIdMovimiento = @MovCobroA AND (MovAnulado IS NULL OR MovAnulado = 0)
                 AND MovTipo = 'PAGO' AND CueIdCuenta = @CueUsd
                 AND ABS(MovImporte - 1050) <= 0.01 AND PagIdPago = 55737)
   OR NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta
               WHERE MovIdMovimiento = @MovCobroB AND (MovAnulado IS NULL OR MovAnulado = 0)
                 AND MovTipo = 'PAGO' AND CueIdCuenta = @CueUsd
                 AND ABS(MovImporte - 1050) <= 0.01 AND PagIdPago = 55738)
BEGIN
    RAISERROR('(A) Los cobros 27794/27795 del PC-2216 ya no estan como los vio el diagnostico (vivos, PAGO, cuenta 11, 1.050 c/u). Puede que ya se hayan corregido. No se toca nada.', 16, 1);
    RETURN;
END

-- 2 · los recibos tienen que respaldar los importes nuevos
IF NOT EXISTS (SELECT 1 FROM dbo.Pagos p JOIN dbo.TransaccionesCaja t ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
               WHERE p.PagIdPago = 55737 AND ABS(t.TcaTotalCobrado - @CorrectoA) <= 0.01
                 AND ISNULL(t.TcaEstado,'') NOT IN ('ANULADO','ANULADA'))
   OR NOT EXISTS (SELECT 1 FROM dbo.Pagos p JOIN dbo.TransaccionesCaja t ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
               WHERE p.PagIdPago = 55738 AND ABS(t.TcaTotalCobrado - @CorrectoB) <= 0.01
                 AND ISNULL(t.TcaEstado,'') NOT IN ('ANULADO','ANULADA'))
BEGIN
    RAISERROR('(A) Los recibos RC-000336 / RC-000338 no cobraron 520,17 y 1.019,83. Sin ese respaldo no se corrige nada.', 16, 1);
    RETURN;
END

-- 3 · el cargo del PC-2082, vivo, por -8,50 en la cuenta de PESOS
IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta
               WHERE MovIdMovimiento = @MovCargoC AND (MovAnulado IS NULL OR MovAnulado = 0)
                 AND MovTipo = 'CIERRE_CICLO' AND CueIdCuenta = @CuePesos
                 AND ABS(MovImporte + 8.50) <= 0.01)
BEGIN
    RAISERROR('(B) El cargo 18532 del PC-2082 ya no esta como lo vio el diagnostico (vivo, CIERRE_CICLO, cuenta 1534, -8,50). No se toca nada.', 16, 1);
    RETURN;
END

-- 4 · la relacion 340 / 8,50 tiene que ser una cotizacion razonable
IF (@CorrectoC / 8.50) < 35 OR (@CorrectoC / 8.50) > 45
BEGIN
    RAISERROR('(B) 340 / 8,50 no da una cotizacion razonable. No es el caso de moneda cruzada: revisar a mano.', 16, 1);
    RETURN;
END

-- 5 · la cobertura fantasma del PC-2877 tiene que ser ANTICIPO_APLICADO sin caja
IF NOT EXISTS (SELECT 1 FROM dbo.ImputacionPago ip
               JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
               WHERE ip.DDeIdDocumento = @Deuda2877 AND ip.PagIdPago = @PagFantasma
                 AND p.PagTipoMovimiento = 'ANTICIPO_APLICADO' AND p.PagTcaIdTransaccion IS NULL
                 AND ABS(ip.ImpImporte - @Fantasma) <= 0.01)
BEGIN
    RAISERROR('(C) La cobertura de 61,50 del PC-2877 no es un ANTICIPO_APLICADO sin caja. Puede que ya se haya corregido, o que sea un cobro real. No se toca nada.', 16, 1);
    RETURN;
END

-- 6 · ese pago no puede estar cubriendo ademas otra deuda
IF EXISTS (SELECT 1 FROM dbo.ImputacionPago WHERE PagIdPago = @PagFantasma AND DDeIdDocumento <> @Deuda2877)
BEGIN
    RAISERROR('(C) El pago 56216 tambien esta imputado a OTRA deuda. Sacarlo la desbalancearia. No se toca nada.', 16, 1);
    RETURN;
END

-- 7 · (D) el pago espejo tiene que estar vivo, sin respaldo, y la deuda cubierta
--     por el anticipo. Si tuviera caja o recibo, ese cobro es REAL y no se toca.
IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
               WHERE m.MovIdMovimiento = @MovEspejo AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo = 'PAGO' AND m.CueIdCuenta = @CueUsd
                 AND ABS(m.MovImporte - @ImporteEspejo) <= 0.01
                 AND m.DocIdDocumento = @Doc3576
                 AND m.PagIdPago IS NULL)
BEGIN
    RAISERROR('(D) El movimiento 47938 ya no esta como lo vio el diagnostico (vivo, PAGO, cuenta 11, 389,91, del PC-3576, sin PagIdPago). No se toca nada.', 16, 1);
    RETURN;
END

IF EXISTS (SELECT 1 FROM dbo.DocumentosContables WHERE DocIdDocumento = @Doc3576 AND TcaIdTransaccion IS NOT NULL)
BEGIN
    RAISERROR('(D) El PC-3576 SI tiene transaccion de caja: entonces ese cobro es real y el que sobra es el anticipo. Revisar a mano. No se toca nada.', 16, 1);
    RETURN;
END

IF NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento dd
               JOIN dbo.ImputacionPago ip ON ip.DDeIdDocumento = dd.DDeIdDocumento
               JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
               WHERE dd.DocIdDocumento = @Doc3576
                 AND p.PagTipoMovimiento = 'ANTICIPO_APLICADO' AND p.PagTcaIdTransaccion IS NULL
                 AND ABS(ip.ImpImporte - @ImporteEspejo) <= 0.01)
BEGIN
    RAISERROR('(D) La deuda del PC-3576 NO esta cubierta por un ANTICIPO_APLICADO de 389,91. Sacar el pago espejo la dejaria impaga sin querer. No se toca nada.', 16, 1);
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

SELECT Momento = 'ANTES - PC-2877', dd.DDeIdDocumento, dd.DDeImporteOriginal,
       dd.DDeImportePendiente, dd.DDeEstado
FROM dbo.DeudaDocumento dd WHERE dd.DDeIdDocumento = @Deuda2877;

-- ══ EL ARREGLO ═════════════════════════════════════════════════════════════
BEGIN TRANSACTION;

    -- (A) los cobros del PC-2216 pasan a valer lo que cobro la caja
    UPDATE dbo.MovimientosCuenta
    SET MovImporte = @CorrectoA,
        MovObservaciones = LEFT(LTRIM(ISNULL(MovObservaciones,'') +
            ' FIX_CAMILO_2026-09-08: el cobro estaba asentado por 1.050 cuando el recibo' +
            ' RC-000336 (Tca 5992) cobro US$ 520,17. Se corrige al importe del recibo.'), 500)
    WHERE MovIdMovimiento = @MovCobroA;

    UPDATE dbo.MovimientosCuenta
    SET MovImporte = @CorrectoB,
        MovObservaciones = LEFT(LTRIM(ISNULL(MovObservaciones,'') +
            ' FIX_CAMILO_2026-09-08: el cobro estaba asentado por 1.050 cuando el recibo' +
            ' RC-000338 (Tca 5993) cobro US$ 1.019,83. Se corrige al importe del recibo.' +
            ' Con el anterior suman 1.540 = el cargo y la deuda del PC-2216.'), 500)
    WHERE MovIdMovimiento = @MovCobroB;

    -- (B) el cargo del PC-2082 vuelve a su moneda
    UPDATE dbo.MovimientosCuenta
    SET MovImporte = -@CorrectoC,
        MovObservaciones = LEFT(LTRIM(ISNULL(MovObservaciones,'') +
            ' FIX_CAMILO_2026-09-08: el cargo estaba en DOLARES (8,50) dentro de la cuenta' +
            ' de PESOS. El documento es de $ 340 (340/40 = 8,50). Se corrige al importe' +
            ' del documento, en la moneda de la cuenta.'), 500)
    WHERE MovIdMovimiento = @MovCargoC;

    -- (C) el PC-2877 vuelve a deber: la plata con que se pago no existia
    DELETE FROM dbo.ImputacionPago
    WHERE DDeIdDocumento = @Deuda2877 AND PagIdPago = @PagFantasma;

    DELETE FROM dbo.Pagos
    WHERE PagIdPago = @PagFantasma
      AND NOT EXISTS (SELECT 1 FROM dbo.ImputacionPago ip WHERE ip.PagIdPago = @PagFantasma);

    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = DDeImporteOriginal,
        DDeEstado = 'PENDIENTE',
        DDeFechaCobro = NULL,
        DDeObservaciones = LEFT(LTRIM(ISNULL(DDeObservaciones,'') +
            ' FIX_CAMILO_2026-09-08: los 61,50 figuraban cobrados contra el saldo a favor' +
            ' de la cuenta, pero ese saldo era el cargo mal asentado del PC-2082. No hubo' +
            ' cobro real: se repone la deuda para que contabilidad la cobre.'), 500)
    WHERE DDeIdDocumento = @Deuda2877;

    UPDATE dbo.DocumentosContables SET DocPagado = 0
    WHERE DocIdDocumento = (SELECT DocIdDocumento FROM dbo.DeudaDocumento WHERE DDeIdDocumento = @Deuda2877);

    -- (D) se anula el pago espejo del PC-3576: no hubo cobro. La deuda no se toca,
    --     la sigue cubriendo el ANTICIPO_APLICADO (el saldo a favor de la NC-11).
    UPDATE dbo.MovimientosCuenta
    SET MovAnulado = 1,
        MovObservaciones = LEFT(LTRIM(ISNULL(MovObservaciones,'') +
            ' FIX_CAMILO_2026-09-08: pago espejo creado en el mismo segundo que el cargo,' +
            ' sin PagIdPago, sin recibo y sin transaccion de caja; el documento tenia' +
            ' DocPagado=0. La deuda ya estaba cubierta por el ANTICIPO_APLICADO de 389,91' +
            ' (saldo a favor de la NC-11): estaba cobrado dos veces. Se anula el espejo.'), 500)
    WHERE MovIdMovimiento = @MovEspejo;

    -- Saldo corrido y saldo de cuenta (convencion de la casa)
    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta IN (@CueUsd, @CuePesos)
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta IN (@CueUsd, @CuePesos);

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

-- Esperado: PC-2216 cargo -1.540 y cobros 1.540 (neto 0)
SELECT Momento = 'DESPUES - PC-2216',
       Cargo  = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                WHERE m.DocIdDocumento = 4303 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                  AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')), 0) AS DECIMAL(18,2)),
       Cobros = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                WHERE m.DocIdDocumento = 4303 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                  AND m.MovTipo = 'PAGO'), 0) AS DECIMAL(18,2));

-- Esperado: 270,00 PENDIENTE — lo que contabilidad tiene que salir a cobrar
SELECT Momento = 'DESPUES - PC-2877', Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       d.DocTotal, d.DocPagado, dd.DDeImporteOriginal, dd.DDeImportePendiente, dd.DDeEstado
FROM dbo.DeudaDocumento dd
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = dd.DocIdDocumento
WHERE dd.DDeIdDocumento = @Deuda2877;

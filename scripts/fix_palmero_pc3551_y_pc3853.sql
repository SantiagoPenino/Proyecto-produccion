-- ============================================================================
-- fix_palmero_pc3551_y_pc3853.sql
-- ----------------------------------------------------------------------------
-- REEMPLAZA a fix_cliente_998_palmero_pc3551.sql (ese quedo viejo: se escribio
-- antes de que apareciera el PC-3853). NO correr los dos.
--
-- LA HISTORIA COMPLETA
--
-- 1) PC-3551 (27/08, cierre de ciclo, $ 119.878,26) nacio PARTIDO:
--       . el CARGO  (MovId 41162) fue a la cuenta de DOLARES por US$ 3.485,80
--         (la suma de las 19 ordenes del ciclo, en dolares)
--       . la DEUDA y los 4 COBROS fueron a la cuenta de PESOS por 119.878,26
--    Los cobros son reales: recibos RC-000598/600/602/604, caja COBRADO, en pesos.
--    Resultado: la cuenta en pesos quedo con $ 119.878,26 "a favor" que NO es
--    plata - es el cobro sin su cargo al lado.
--
-- 2) PC-3853 (01/09, $ 18.179,48) se comio 18.179,48 de ese saldo a favor falso.
--    El cierre hizo lo correcto (vio plata a favor, la aplico como pago
--    ANTICIPO_APLICADO y dejo la deuda cobrada), pero la plata no existia.
--    Palmero NO pago ese trabajo.
--
-- QUE HACE ESTE SCRIPT
--   A. Le pasa el cargo del PC-3551 a la cuenta en pesos, donde estan su deuda
--      y sus cobros, por el importe del documento. El PC-3551 queda saldado.
--   B. Le saca al PC-3853 la cobertura fantasma (borra la imputacion y el pago
--      sintetico ANTICIPO_APLICADO, que no tienen recibo ni caja detras) y le
--      devuelve la deuda VIVA, para que contabilidad la cobre.
--
-- COMO QUEDA
--       cuenta 90 (US$)   ->      0,00
--       cuenta 1115 ($)   -> -18.179,48   <- Palmero DEBE el PC-3853. Es la verdad.
--       PC-3551           -> saldado
--       PC-3853           -> deuda viva 18.179,48, cobrable desde caja
--
-- NO anula ni crea movimientos de cuenta corriente. NO toca ningun cobro real.
-- NO toca las 19 ordenes del ciclo.
--
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Cli        INT = 998;
DECLARE @Doc3551    INT = 9564;
DECLARE @MovCargo   INT = 41162;     -- el VTA_CAJA mal ubicado
DECLARE @CueUsd     INT = 90;
DECLARE @CuePesos   INT = 1115;
DECLARE @Deuda3551  INT = 11208;

DECLARE @Doc3853 INT, @Deuda3853 INT;
DECLARE @Total3551 DECIMAL(18,4), @Cobrado3551 DECIMAL(18,4), @ImporteHoy DECIMAL(18,4);
DECLARE @Total3853 DECIMAL(18,4), @Fantasma DECIMAL(18,4), @OtrasImput DECIMAL(18,4);

-- ══ VALIDACIONES ═══════════════════════════════════════════════════════════

-- 1 · El PC-3551 tiene que ser el que creemos
SELECT @Total3551 = d.DocTotal
FROM dbo.DocumentosContables d
WHERE d.DocIdDocumento = @Doc3551 AND d.CliIdCliente = @Cli
  AND RTRIM(d.DocSerie) = 'PC' AND RTRIM(d.DocNumero) = '3551'
  AND ISNULL(d.DocEstado,'') <> 'ANULADO';

IF @Total3551 IS NULL
BEGIN
    RAISERROR('El documento 9564 no es el PC-3551 vivo de Palmero. No se toca nada.', 16, 1);
    RETURN;
END

-- 2 · El cargo del PC-3551 tiene que seguir varado en dolares
SELECT @ImporteHoy = m.MovImporte
FROM dbo.MovimientosCuenta m
WHERE m.MovIdMovimiento = @MovCargo
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo = 'VTA_CAJA' AND m.DocIdDocumento = @Doc3551
  AND m.CueIdCuenta = @CueUsd;

IF @ImporteHoy IS NULL OR ABS(@ImporteHoy + 3485.80) > 0.01
BEGIN
    RAISERROR('El cargo 41162 ya no esta como esperabamos (vivo, VTA_CAJA, cuenta 90, -3485,80). Puede que ya se haya corregido. No se toca nada.', 16, 1);
    RETURN;
END

-- 3 · Los cobros en pesos del PC-3551 tienen que cubrir el documento
SELECT @Cobrado3551 = ISNULL(SUM(m.MovImporte), 0)
FROM dbo.MovimientosCuenta m
WHERE m.DocIdDocumento = @Doc3551 AND m.CueIdCuenta = @CuePesos
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo = 'PAGO' AND m.MovImporte > 0;

IF ABS(@Cobrado3551 - @Total3551) > 0.01
BEGIN
    DECLARE @c VARCHAR(30) = CONVERT(VARCHAR(30), @Cobrado3551);
    DECLARE @t VARCHAR(30) = CONVERT(VARCHAR(30), @Total3551);
    RAISERROR('Los cobros en pesos del PC-3551 (%s) no coinciden con el documento (%s). Hay que mirarlo a mano. No se toca nada.', 16, 1, @c, @t);
    RETURN;
END

-- 4 · El PC-3551 no puede tener ya un cargo en pesos (lo duplicaria)
IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
           WHERE m.DocIdDocumento = @Doc3551 AND m.CueIdCuenta = @CuePesos
             AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
             AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO'))
BEGIN
    RAISERROR('El PC-3551 YA tiene un cargo en la cuenta en pesos. Moverlo duplicaria la deuda. No se toca nada.', 16, 1);
    RETURN;
END

-- 5 · El PC-3853 tiene que existir, vivo, del mismo cliente y en la misma cuenta
SELECT @Doc3853 = d.DocIdDocumento, @Total3853 = d.DocTotal
FROM dbo.DocumentosContables d
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC' AND RTRIM(d.DocNumero) = '3853'
  AND ISNULL(d.DocEstado,'') <> 'ANULADO';

IF @Doc3853 IS NULL
BEGIN
    RAISERROR('No aparece el PC-3853 vivo de Palmero. Este script asume que existe: sin el, mover el cargo del PC-3551 deja la cuenta en un numero que no es el esperado. No se toca nada.', 16, 1);
    RETURN;
END

SELECT @Deuda3853 = dd.DDeIdDocumento
FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento = @Doc3853;

IF @Deuda3853 IS NULL
BEGIN
    RAISERROR('El PC-3853 no tiene fila en DeudaDocumento. No se toca nada.', 16, 1);
    RETURN;
END

-- 6 · La cobertura del PC-3853 tiene que ser el anticipo sintetico y NADA MAS.
--     Si tuviera un cobro real de caja, no se puede reponer la deuda a ciegas.
SELECT @Fantasma = ISNULL(SUM(ip.ImpImporte), 0)
FROM dbo.ImputacionPago ip
JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
WHERE ip.DDeIdDocumento = @Deuda3853
  AND p.PagTipoMovimiento = 'ANTICIPO_APLICADO'
  AND p.PagTcaIdTransaccion IS NULL;

SELECT @OtrasImput = ISNULL(SUM(ip.ImpImporte), 0)
FROM dbo.ImputacionPago ip
LEFT JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
WHERE ip.DDeIdDocumento = @Deuda3853
  -- ISNULL a proposito: si la imputacion quedo sin fila en Pagos, NOT(NULL) daria
  -- UNKNOWN y no la contaria - y esa plata desapareceria de la cuenta.
  AND NOT (ISNULL(p.PagTipoMovimiento,'') = 'ANTICIPO_APLICADO' AND p.PagTcaIdTransaccion IS NULL);

IF @Fantasma <= 0.01
BEGIN
    RAISERROR('El PC-3853 no tiene ninguna cobertura ANTICIPO_APLICADO sin caja. Puede que ya se haya corregido. No se toca nada.', 16, 1);
    RETURN;
END

IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
           WHERE m.DocIdDocumento = @Doc3853 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
             AND m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO') AND m.MovImporte > 0.01)
BEGIN
    RAISERROR('El PC-3853 tiene un abono real en la cuenta corriente. No es solo cobertura fantasma: revisarlo a mano. No se toca nada.', 16, 1);
    RETURN;
END

-- 7 · El pago sintetico no puede estar pagando ademas otra deuda
IF EXISTS (
    SELECT 1 FROM dbo.ImputacionPago ip2
    WHERE ip2.DDeIdDocumento <> @Deuda3853
      AND ip2.PagIdPago IN (SELECT ip.PagIdPago FROM dbo.ImputacionPago ip
                            JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
                            WHERE ip.DDeIdDocumento = @Deuda3853
                              AND p.PagTipoMovimiento = 'ANTICIPO_APLICADO'
                              AND p.PagTcaIdTransaccion IS NULL))
BEGIN
    RAISERROR('El pago de cobertura del PC-3853 tambien esta imputado a OTRA deuda. Sacarlo la desbalancearia. No se toca nada.', 16, 1);
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

SELECT Momento = 'ANTES - DEUDAS', Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       dd.DDeImporteOriginal, dd.DDeImportePendiente, dd.DDeEstado
FROM dbo.DeudaDocumento dd
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = dd.DocIdDocumento
WHERE dd.DocIdDocumento IN (@Doc3551, @Doc3853);

-- ══ EL ARREGLO ═════════════════════════════════════════════════════════════
BEGIN TRANSACTION;

    -- ── A · PC-3551: el cargo se muda a la cuenta en pesos ─────────────────
    UPDATE dbo.MovimientosCuenta
    SET CueIdCuenta = @CuePesos,
        MovImporte  = -@Total3551,
        MovConcepto = 'Facturado (PEDIDOS CAJA PC-3551)',
        MovObservaciones = LEFT(LTRIM(ISNULL(MovObservaciones,'') +
            ' FIX_PALMERO_2026-09-02: el cierre puso el cargo en la cuenta de dolares' +
            ' por US$ 3.485,80 (suma de las 19 ordenes) mientras la deuda y los 4 cobros' +
            ' (RC-598/600/602/604, caja COBRADO) estaban en pesos por 119.878,26.' +
            ' Se muda el cargo a la cuenta en pesos con el importe del documento.'), 500)
    WHERE MovIdMovimiento = @MovCargo;

    -- 'COBRADO' es el estado que usa el sistema para una deuda saldada (9.335 filas
    -- contra 153 de 'PAGADO'). En produccion esta deuda YA figura asi: este UPDATE
    -- no la cambia, queda por idempotencia.
    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = 0,
        DDeEstado = 'COBRADO',
        DDeFechaCobro = ISNULL(DDeFechaCobro, (SELECT MAX(m.MovFecha) FROM dbo.MovimientosCuenta m
                                               WHERE m.DocIdDocumento = @Doc3551 AND m.MovTipo = 'PAGO'
                                                 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0))),
        DDeObservaciones = LEFT(LTRIM(ISNULL(DDeObservaciones,'') +
            ' FIX_PALMERO_2026-09-02: cobrada en su totalidad; quedaba 0,0045 de redondeo.'), 500)
    WHERE DDeIdDocumento = @Deuda3551 AND DocIdDocumento = @Doc3551;

    UPDATE dbo.DocumentosContables SET DocPagado = 1 WHERE DocIdDocumento = @Doc3551;

    -- ── B · PC-3853: se le saca la cobertura fantasma y vuelve a deber ─────
    -- Guardamos los ids del pago sintetico antes de borrar sus imputaciones.
    DECLARE @PagosFantasma TABLE (PagIdPago INT PRIMARY KEY);
    INSERT INTO @PagosFantasma (PagIdPago)
    SELECT DISTINCT ip.PagIdPago
    FROM dbo.ImputacionPago ip
    JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
    WHERE ip.DDeIdDocumento = @Deuda3853
      AND p.PagTipoMovimiento = 'ANTICIPO_APLICADO'
      AND p.PagTcaIdTransaccion IS NULL;

    DELETE ip
    FROM dbo.ImputacionPago ip
    JOIN @PagosFantasma f ON f.PagIdPago = ip.PagIdPago
    WHERE ip.DDeIdDocumento = @Deuda3853;

    -- El pago sintetico no tiene recibo ni caja detras: si queda huerfano se
    -- borra, para que no le figure a Palmero un cobro de 18.179,48 que no existio.
    DELETE p
    FROM dbo.Pagos p
    JOIN @PagosFantasma f ON f.PagIdPago = p.PagIdPago
    WHERE NOT EXISTS (SELECT 1 FROM dbo.ImputacionPago ip WHERE ip.PagIdPago = p.PagIdPago);

    -- La deuda vuelve a nacer por lo que realmente falta cobrar.
    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = CASE WHEN DDeImporteOriginal - @OtrasImput < 0 THEN 0
                                   ELSE DDeImporteOriginal - @OtrasImput END,
        DDeEstado = 'PENDIENTE',
        DDeFechaCobro = NULL,
        DDeObservaciones = LEFT(LTRIM(ISNULL(DDeObservaciones,'') +
            ' FIX_PALMERO_2026-09-02: esta deuda figuraba cobrada contra el saldo a favor' +
            ' de la cuenta, pero ese saldo era el cobro del PC-3551 sin su cargo al lado' +
            ' (documento partido en dos monedas). No hubo cobro real: se repone la deuda' +
            ' para que contabilidad la cobre.'), 500)
    WHERE DDeIdDocumento = @Deuda3853;

    UPDATE dbo.DocumentosContables SET DocPagado = 0 WHERE DocIdDocumento = @Doc3853;

    -- ── Recalcular saldo corrido y saldo de cuenta (convencion de la casa) ─
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
-- Esperado:  cuenta 90 (US$) = 0,00   |   cuenta 1115 ($) = -18.179,48
SELECT Momento = 'DESPUES', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (@CueUsd, @CuePesos);

-- Esperado:  PC-3551 pendiente 0 PAGADO   |   PC-3853 pendiente 18.179,48 PENDIENTE
SELECT Momento = 'DESPUES - DEUDAS', Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       d.DocTotal, d.DocPagado, dd.DDeImporteOriginal, dd.DDeImportePendiente, dd.DDeEstado
FROM dbo.DeudaDocumento dd
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = dd.DocIdDocumento
WHERE dd.DocIdDocumento IN (@Doc3551, @Doc3853);

-- Lo que contabilidad tiene que salir a cobrar
SELECT Resumen = 'A COBRAR', Cliente = RTRIM(cl.Nombre),
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Fecha = d.DocFechaEmision,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Importe = dd.DDeImportePendiente
FROM dbo.DeudaDocumento dd
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = dd.DocIdDocumento
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
JOIN dbo.Clientes cl ON cl.CliIdCliente = d.CliIdCliente
WHERE dd.DocIdDocumento = @Doc3853;

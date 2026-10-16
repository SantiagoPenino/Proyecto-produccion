-- ############################################################################
-- ##  NO CORRER. QUEDO VIEJO.                                               ##
-- ##  Se escribio antes de que apareciera el PC-3853 (01/09), que se comio  ##
-- ##  18.179,48 del saldo a favor falso. Este script deja ese documento     ##
-- ##  figurando cobrado contra plata que ya no existe.                      ##
-- ##  USAR EN SU LUGAR:  scripts/fix_palmero_pc3551_y_pc3853.sql            ##
-- ############################################################################

-- ============================================================================
-- fix_cliente_998_palmero_pc3551.sql
-- ----------------------------------------------------------------------------
-- PALMERO (CliIdCliente 998, cliente SEMANAL). Hoy muestra dos saldos que
-- parecen contradictorios:
--       cuenta 1115 ($)   = +119.878,26   "a favor"
--       cuenta   90 (US$) =   -3.485,80   "debe"
--
-- No son dos cosas: son LAS DOS PATAS DEL MISMO DOCUMENTO.
--
-- PC-3551 (DocIdDocumento 9564) - cierre de ciclo del 27/08, "Pedidos Caja",
-- DocTotal 119.878,26 en PESOS. El cierre lo partio en dos monedas:
--
--   . el CARGO  (MovId 41162, VTA_CAJA) fue a la cuenta de DOLARES por
--     US$ 3.485,80  <- que es la suma de las 19 ordenes del ciclo, en dolares
--   . la DEUDA  (DDeIdDocumento 11208)  quedo en la cuenta de PESOS por 119.878,26
--   . los COBROS (4 PAGO) fueron a la cuenta de PESOS por 119.878,2555
--
-- Los cobros son REALES y estan respaldados por caja: recibos RC-000598,
-- RC-000600, RC-000602 y RC-000604, todos COBRADOS, todos en UYU, que suman
-- exactamente los 119.878,26. El cliente pago todo. No hay plata a favor.
--
-- (De paso confirma el bug del cierre que ya conocemos: el concepto del cargo
--  dice "Facturado (E-TICKET CONTADO ET-6380)" cuando el documento es un
--  Pedido de Caja - y ese ET-6380 no existe en ningun lado.)
--
-- QUE HACE: le pasa el cargo del PC-3551 a la cuenta en pesos, que es donde
-- estan la deuda y los cobros, con el importe del documento. NO crea ni anula
-- movimientos, NO toca ningun cobro, NO toca las 19 ordenes.
--
-- COMO QUEDA:
--       cuenta 1115 ($)   -> 0,00   (119.878,26 cobrado - 119.878,26 de cargo)
--       cuenta   90 (US$) -> 0,00   (se le saca el cargo que no era de ahi)
--
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Doc        INT = 9564;      -- PC-3551
DECLARE @MovCargo   INT = 41162;     -- el VTA_CAJA mal ubicado
DECLARE @CueUsd     INT = 90;        -- donde esta hoy
DECLARE @CuePesos   INT = 1115;      -- donde tiene que estar
DECLARE @Deuda      INT = 11208;

DECLARE @DocTotal DECIMAL(18,4), @Cobrado DECIMAL(18,4), @ImporteHoy DECIMAL(18,4);

-- -- CANDADO 1: el documento tiene que ser el que creemos --------------------
SELECT @DocTotal = d.DocTotal
FROM dbo.DocumentosContables d
WHERE d.DocIdDocumento = @Doc AND d.CliIdCliente = 998
  AND RTRIM(d.DocSerie) = 'PC' AND RTRIM(d.DocNumero) = '3551'
  AND ISNULL(d.DocEstado,'') <> 'ANULADO';

IF @DocTotal IS NULL
BEGIN
    RAISERROR('El documento 9564 no es el PC-3551 vivo de Palmero. No se toca nada.', 16, 1);
    RETURN;
END

-- -- CANDADO 2: el cargo tiene que estar vivo, en dolares y por 3.485,80 -----
SELECT @ImporteHoy = m.MovImporte
FROM dbo.MovimientosCuenta m
WHERE m.MovIdMovimiento = @MovCargo
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo = 'VTA_CAJA' AND m.DocIdDocumento = @Doc
  AND m.CueIdCuenta = @CueUsd;

IF @ImporteHoy IS NULL OR ABS(@ImporteHoy + 3485.80) > 0.01
BEGIN
    RAISERROR('El cargo 41162 ya no esta como esperabamos (vivo, VTA_CAJA, cuenta 90, -3485,80). Puede que ya se haya corregido. No se toca nada.', 16, 1);
    RETURN;
END

-- -- CANDADO 3: los cobros en pesos tienen que cubrir el documento -----------
SELECT @Cobrado = ISNULL(SUM(m.MovImporte), 0)
FROM dbo.MovimientosCuenta m
WHERE m.DocIdDocumento = @Doc AND m.CueIdCuenta = @CuePesos
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo = 'PAGO' AND m.MovImporte > 0;

IF ABS(@Cobrado - @DocTotal) > 0.01
BEGIN
    DECLARE @c VARCHAR(30) = CONVERT(VARCHAR(30), @Cobrado);
    DECLARE @t VARCHAR(30) = CONVERT(VARCHAR(30), @DocTotal);
    RAISERROR('Los cobros en pesos (%s) no coinciden con el documento (%s). Hay que mirarlo a mano. No se toca nada.', 16, 1, @c, @t);
    RETURN;
END

-- -- CANDADO 4: no puede haber ya un cargo del documento en pesos -----------
IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
           WHERE m.DocIdDocumento = @Doc AND m.CueIdCuenta = @CuePesos
             AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
             AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO'))
BEGIN
    RAISERROR('El PC-3551 YA tiene un cargo en la cuenta en pesos. Moverlo duplicaria la deuda. No se toca nada.', 16, 1);
    RETURN;
END

-- -- ANTES -------------------------------------------------------------------
SELECT Momento = 'ANTES', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (@CueUsd, @CuePesos);

-- -- EL ARREGLO --------------------------------------------------------------
BEGIN TRANSACTION;

    -- El cargo se muda a la cuenta en pesos, con el importe del documento.
    UPDATE dbo.MovimientosCuenta
    SET CueIdCuenta = @CuePesos,
        MovImporte  = -@DocTotal,
        MovConcepto = 'Facturado (PEDIDOS CAJA PC-3551)',
        MovObservaciones = LEFT(LTRIM(ISNULL(MovObservaciones,'') +
            ' FIX_PALMERO_PC3551_2026-09-01: el cierre puso el cargo en la cuenta de' +
            ' dolares por US$ 3.485,80 (suma de las 19 ordenes) mientras la deuda y los' +
            ' 4 cobros (RC-598/600/602/604, caja COBRADO) estaban en pesos por 119.878,26.' +
            ' Se muda el cargo a la cuenta en pesos con el importe del documento.'), 500)
    WHERE MovIdMovimiento = @MovCargo;

    -- La deuda queda saldada (arrastraba 0,0045 de redondeo).
    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = 0,
        DDeEstado = 'PAGADO',
        DDeFechaCobro = ISNULL(DDeFechaCobro, (SELECT MAX(m.MovFecha) FROM dbo.MovimientosCuenta m
                                               WHERE m.DocIdDocumento = @Doc AND m.MovTipo = 'PAGO'
                                                 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0))),
        DDeObservaciones = LEFT(LTRIM(ISNULL(DDeObservaciones,'') +
            ' FIX_PALMERO_PC3551_2026-09-01: cobrada en su totalidad; quedaba 0,0045 de redondeo.'), 500)
    WHERE DDeIdDocumento = @Deuda AND DocIdDocumento = @Doc;

    UPDATE dbo.DocumentosContables SET DocPagado = 1 WHERE DocIdDocumento = @Doc;

    -- Recalcular saldo corrido y saldo de cuenta (convencion de la casa).
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

-- -- DESPUES: las dos tienen que dar 0,00 ------------------------------------
SELECT Momento = 'DESPUES', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (@CueUsd, @CuePesos);

-- -- El documento, para control ---------------------------------------------
SELECT Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero), d.DocTotal, d.DocPagado,
       Cargo  = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                        WHERE m.DocIdDocumento = d.DocIdDocumento AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                          AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')), 0),
       Cobros = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                        WHERE m.DocIdDocumento = d.DocIdDocumento AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                          AND m.MovTipo = 'PAGO'), 0),
       DeudaViva = ISNULL((SELECT SUM(x.DDeImportePendiente) FROM dbo.DeudaDocumento x
                           WHERE x.DocIdDocumento = d.DocIdDocumento
                             AND x.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')), 0)
FROM dbo.DocumentosContables d WHERE d.DocIdDocumento = @Doc;

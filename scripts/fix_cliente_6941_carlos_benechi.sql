-- ============================================================================
-- fix_cliente_6941_carlos_benechi.sql
-- ----------------------------------------------------------------------------
-- Carlos Benechi (cliente 6941, tipo Común). Cuentas: 514 (US$) y 1564 ($).
--
-- ESTADO HOY:  pesos +3.600,00 a favor · dólares −34,935
-- COMO QUEDA:  pesos 0,00 · dólares 0,00
--
-- Un cliente Común contado no puede tener saldo: paga y se va. Los dos números
-- salen de tres movimientos que sobran.
--
-- 1) EL CRUCE DEL 14/08 (movimientos 35512 y 35513)
--    La orden SUB-13764 (BANDERAS TITAN 12) vale $ 3.600, pero su cargo se asentó
--    como −88,08 en la cuenta de PESOS (3.600 ÷ 40,93: el importe convertido a
--    dólares, puesto en la cuenta equivocada). El motor de cobertura automática
--    calculó la deuda real (3.600) contra ese cargo enano, y sacó US$ 87,955 —toda
--    la cuenta en dólares— para meter $ 3.600 en la de pesos.
--    Esa cobertura NUNCA hizo falta: la orden se facturó después en la FA-1035
--    (cargo US$ 116,68) y esa factura se cobró entera (US$ 116,68).
--
-- 2) DOS COBROS DUPLICADOS (movimientos 15016 y 17430, US$ 23,76 y 29,26)
--    Cobros de caja por órdenes sueltas, sin documento y sin imputar. Esas mismas
--    órdenes ya se cobraron dentro de sus facturas:
--        DTF-4554 + DTF-4710 → FA-40  (cobrada por US$ 970,99)
--        DTF-5331 + DTF-5471 → FA-108 (cobrada por US$ 1.195,01)
--    El cargo quedó contado una vez y el cobro dos.
--
-- QUÉ HACE: anula (MovAnulado = 1, NO borra) esos cuatro movimientos con el motivo
-- escrito, y recalcula el saldo corrido y el guardado de las dos cuentas.
-- NO toca documentos, ni cargos, ni deudas, ni la orden SUB-13764.
--
-- Idempotente: los movimientos ya anulados no se vuelven a tocar.
--
-- ABRIR DESDE EL DISCO en SSMS (File → Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Cli INT = 6941;
DECLARE @Movs TABLE (MovIdMovimiento INT PRIMARY KEY, Motivo VARCHAR(200));

INSERT INTO @Movs VALUES
 (35512, 'cruce automatico del 14/08 disparado por un cargo mal asentado (la orden SUB-13764 vale $3.600 y su cargo decia -88,08); la orden se facturo y cobro en la FA-1035'),
 (35513, 'contrapartida en pesos del mismo cruce'),
 (15016, 'cobro duplicado: las ordenes DTF-4554/DTF-4710 ya se cobraron dentro de la FA-40'),
 (17430, 'cobro duplicado: las ordenes DTF-5331/DTF-5471 ya se cobraron dentro de la FA-108');

-- ── CANDADO: los 4 movimientos tienen que existir, estar vivos y ser de este cliente
DECLARE @N INT;
SELECT @N = COUNT(*)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN @Movs x ON x.MovIdMovimiento = m.MovIdMovimiento
WHERE cc.CliIdCliente = @Cli AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

IF @N <> 4
BEGIN
    RAISERROR('Se esperaban 4 movimientos vivos del cliente y hay %d. Puede que ya se haya corrido este script. No se toca nada.', 16, 1, @N);
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
ORDER BY cc.MonIdMoneda DESC;

BEGIN TRANSACTION;

    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') +
            ' FIX_CLIENTE_2026-09-01: ' + x.Motivo + '.'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN @Movs x ON x.MovIdMovimiento = m.MovIdMovimiento;
    -- Esperado: 4 filas afectadas

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

-- ── DESPUÉS: las dos cuentas tienen que quedar en 0,00 ─────────────────────
SELECT Momento = 'DESPUES', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo  = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                        WHERE m.CueIdCuenta = cc.CueIdCuenta
                          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                          AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
FROM dbo.CuentasCliente cc
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.MonIdMoneda DESC;

-- ============================================================================
-- fix_cobros_sin_respaldo.sql
-- ----------------------------------------------------------------------------
-- Anula cobros que entraron sin ningún respaldo: `PAGO` positivo SIN documento,
-- SIN transacción de caja y SIN imputar a ninguna deuda. No cancelan nada, y en
-- 374 de los 382 casos el cliente no tiene ningún documento sin cobro — o sea que
-- no hay nada que ese cobro pueda estar pagando (mismo patrón que ya confirmamos
-- en Carlos Benechi y Pintos Falero).
--
-- ESTE SCRIPT NO DECIDE NADA POR SÍ SOLO: hay que cargarle a mano los MovId que
-- verificaste contra el recibo físico y confirmaste que NO existieron. La lista
-- completa, ordenada por importe y con el concepto de cada uno, está en
-- `cobros_sin_respaldo.csv`.
--
-- Los MovId de abajo son los cuatro más grandes que dieron "candidato a duplicado"
-- (el cliente no tiene ningún documento sin cobro). REEMPLAZALOS por los tuyos.
--
-- QUÉ HACE: anula (MovAnulado = 1, NO borra) los movimientos indicados, deja el
-- motivo escrito y recalcula el saldo de las cuentas tocadas.
--
-- CANDADOS — no toca nada si algo no cierra:
--   · el movimiento tiene que estar vivo y ser un PAGO positivo
--   · sin documento, sin transacción de caja y sin imputación (si tiene alguna de
--     las tres, ese cobro SÍ respalda algo y no se puede anular a ciegas)
--   · la cuenta tiene que tener saldo a favor suficiente: sacar el cobro no puede
--     dejarla debiendo
--
-- ABRIR DESDE EL DISCO en SSMS (File → Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

-- ⇩⇩⇩ PONÉ ACÁ LOS MovId VERIFICADOS ⇩⇩⇩
DECLARE @Movs TABLE (MovIdMovimiento INT PRIMARY KEY);
INSERT INTO @Movs VALUES
 (16234),   -- Francisco Viera      $ 4.581,06  concepto "PAGO"
 (13211),   -- SM Sports            $ 1.409,10  "Pago: SB-64303 (Golerodiegolamas)..."
 (14368),   -- IMPRENTA FLAGMA SRL  US$ 485,13  "Pago: XECOUV-14242 (lonalu)..."
 (14922);   -- Franco castro        US$ 473,55  "Pago: DTF-4659 (TALL), DTF-4681 (TALL2)"
-- ⇧⇧⇧ ---------------------------------- ⇧⇧⇧

DECLARE @N INT, @Pedidos INT;
SELECT @Pedidos = COUNT(*) FROM @Movs;

-- ── CANDADO 1: todos tienen que ser cobros sin respaldo, vivos ─────────────
SELECT @N = COUNT(*)
FROM dbo.MovimientosCuenta m
JOIN @Movs x ON x.MovIdMovimiento = m.MovIdMovimiento
LEFT JOIN dbo.Pagos p ON p.PagIdPago = m.PagIdPago
WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo = 'PAGO' AND m.MovImporte > 0
  AND m.DocIdDocumento IS NULL
  AND p.PagTcaIdTransaccion IS NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.ImputacionPago ip WHERE ip.PagIdPago = m.PagIdPago);

IF @N <> @Pedidos
BEGIN
    SELECT m.MovIdMovimiento, m.MovTipo, m.MovImporte, m.MovAnulado, m.DocIdDocumento,
           TieneCaja = CASE WHEN p.PagTcaIdTransaccion IS NOT NULL THEN 'SI' ELSE 'no' END,
           TieneImputacion = CASE WHEN EXISTS (SELECT 1 FROM dbo.ImputacionPago ip WHERE ip.PagIdPago = m.PagIdPago) THEN 'SI' ELSE 'no' END
    FROM dbo.MovimientosCuenta m
    JOIN @Movs x ON x.MovIdMovimiento = m.MovIdMovimiento
    LEFT JOIN dbo.Pagos p ON p.PagIdPago = m.PagIdPago;
    RAISERROR('De los %d movimientos pedidos, solo %d son cobros sin respaldo y vivos (ver arriba). No se toca nada.', 16, 1, @Pedidos, @N);
    RETURN;
END

-- ── CANDADO 2: sacar el cobro no puede dejar la cuenta debiendo ────────────
SELECT @N = COUNT(*)
FROM (SELECT m.CueIdCuenta, ASacar = SUM(m.MovImporte)
      FROM dbo.MovimientosCuenta m JOIN @Movs x ON x.MovIdMovimiento = m.MovIdMovimiento
      GROUP BY m.CueIdCuenta) q
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = q.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE s.Saldo - q.ASacar < -1;

IF @N > 0
BEGIN
    RAISERROR('%d cuenta(s) quedarían DEBIENDO al sacar el cobro: ese cobro está tapando otra cosa. No se toca nada.', 16, 1, @N);
    RETURN;
END

-- ── ANTES ───────────────────────────────────────────────────────────────────
SELECT Momento = 'ANTES', Cliente = RTRIM(cl.Nombre), m.MovIdMovimiento, m.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       CobroQueSeAnula = m.MovImporte,
       SaldoHoy = CAST(s.Saldo AS DECIMAL(18,2)),
       SaldoDespues = CAST(s.Saldo - m.MovImporte AS DECIMAL(18,2)),
       Concepto = LEFT(ISNULL(m.MovConcepto,''), 60)
FROM dbo.MovimientosCuenta m
JOIN @Movs x ON x.MovIdMovimiento = m.MovIdMovimiento
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(y.MovImporte) FROM dbo.MovimientosCuenta y
                                    WHERE y.CueIdCuenta = m.CueIdCuenta
                                      AND (y.MovAnulado IS NULL OR y.MovAnulado = 0)
                                      AND y.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
ORDER BY m.MovImporte DESC;

BEGIN TRANSACTION;

    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') +
            ' FIX_COBRO_SIN_RESPALDO_2026-09-01: cobro sin documento, sin transacción de caja' +
            ' y sin imputar a ninguna deuda; verificado contra el recibo: no existió.'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN @Movs x ON x.MovIdMovimiento = m.MovIdMovimiento;

    ;WITH Tocadas AS (
        SELECT DISTINCT m.CueIdCuenta FROM dbo.MovimientosCuenta m
        JOIN @Movs x ON x.MovIdMovimiento = m.MovIdMovimiento
    ), ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta IN (SELECT CueIdCuenta FROM Tocadas)
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta IN (SELECT DISTINCT m.CueIdCuenta FROM dbo.MovimientosCuenta m
                             JOIN @Movs x ON x.MovIdMovimiento = m.MovIdMovimiento);

COMMIT TRANSACTION;

-- ── DESPUÉS ─────────────────────────────────────────────────────────────────
SELECT Momento = 'DESPUES', Cliente = RTRIM(cl.Nombre), cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            WHERE m.CueIdCuenta = cc.CueIdCuenta
                              AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                              AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (SELECT DISTINCT m.CueIdCuenta FROM dbo.MovimientosCuenta m
                         JOIN @Movs x ON x.MovIdMovimiento = m.MovIdMovimiento)
ORDER BY cl.Nombre;

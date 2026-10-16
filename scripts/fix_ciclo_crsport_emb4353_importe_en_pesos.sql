-- ============================================================================
-- fix_ciclo_crsport_emb4353_importe_en_pesos.sql
-- ----------------------------------------------------------------------------
-- CR SPORT, ciclo 557. El cierre se frena con:
--   "El total del ciclo (2762.22) no coincide con la suma de las lineas de la
--    pre-factura (419.04)".
--
-- LA CAUSA: el movimiento 46316 (orden de bordado EMB-4353 "escudonacional")
-- quedo asentado en la cuenta de DOLARES (222) con el importe EN PESOS:
--
--       US$ 58,80  x  40,85  =  $ 2.401,98   <- lo que dice el movimiento
--
-- El precio real son US$ 58,80 (30 prendas x 1,96, como muestra la pre-factura).
-- El movimiento esta inflado 40,85 veces. Es el mismo patron de "pesos crudos
-- dentro de cuentas de dolares" que ya barrimos en julio, pero este es nuevo y
-- viene del area de BORDADO, que se esta estrenando.
--
-- La cuenta cierra exacta:
--       2.913,72 (total del ciclo) - 151,50 (2 ordenes destildadas) = 2.762,22
--       2.401,98 - 58,80 = 2.343,18 = 2.762,22 - 419,04
--
-- QUE HACE: le corrige el importe al movimiento 46316: -2.401,98 -> -58,80.
--   . NO lo saca del ciclo (la orden es legitima y esta en la cuenta correcta)
--   . NO anula ni crea movimientos
--   . El saldo REAL del cliente no se mueve: los movimientos ORDEN no cuentan
--     para el saldo (si se recalcula CueSaldoActual, que si los incluye).
--
-- DESPUES DE CORRER ESTO el total del ciclo queda en 570,54; menos las dos
-- ordenes que destildaste (131,70 + 19,80) da 419,04 = la pre-factura. La
-- factura sale.
--
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Mov     INT = 46316;
DECLARE @Cue     INT = 222;          -- cuenta USD de CR SPORT
DECLARE @Cic     INT = 557;
DECLARE @Correcto DECIMAL(18,4) = 58.80;    -- 30 x 1,96, lo que cotiza la pre-factura

DECLARE @Actual DECIMAL(18,4), @Ratio DECIMAL(18,6);

-- ── CANDADO 1: el movimiento tiene que estar como lo dejo el diagnostico ──
SELECT @Actual = m.MovImporte
FROM dbo.MovimientosCuenta m
WHERE m.MovIdMovimiento = @Mov
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  AND m.CueIdCuenta = @Cue
  AND m.CicIdCiclo  = @Cic
  AND m.DocIdDocumento IS NULL
  AND m.MovConcepto LIKE '%EMB-4353%';

IF @Actual IS NULL
BEGIN
    RAISERROR('El movimiento 46316 ya no esta como lo vio el diagnostico (vivo, ORDEN, cuenta 222, ciclo 557, sin documento, EMB-4353). Puede que ya se haya corregido. No se toca nada.', 16, 1);
    RETURN;
END

-- ── CANDADO 2: el importe actual tiene que ser el correcto x la cotizacion ─
-- Si no guarda esa relacion, no es "pesos en cuenta de dolares" y hay que mirarlo.
SET @Ratio = ABS(@Actual) / @Correcto;

IF @Ratio < 35 OR @Ratio > 45
BEGIN
    DECLARE @a VARCHAR(30) = CONVERT(VARCHAR(30), @Actual);
    DECLARE @r VARCHAR(30) = CONVERT(VARCHAR(30), @Ratio);
    RAISERROR('El importe actual (%s) no es el precio en dolares por una cotizacion razonable (ratio %s, se esperaba entre 35 y 45). No es el caso de pesos-en-cuenta-USD: revisar a mano. No se toca nada.', 16, 1, @a, @r);
    RETURN;
END

-- ── ANTES ───────────────────────────────────────────────────────────────────
SELECT Momento = 'ANTES', Movimiento = @Mov,
       ImporteActual = CAST(@Actual AS DECIMAL(18,2)),
       ImporteCorrecto = CAST(-@Correcto AS DECIMAL(18,2)),
       CotizacionImplicita = CAST(@Ratio AS DECIMAL(18,2)),
       TotalDelCiclo = CAST((SELECT SUM(ABS(m.MovImporte)) FROM dbo.MovimientosCuenta m
             WHERE m.CicIdCiclo = @Cic AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
               AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND m.MovImporte < 0
               AND m.DocIdDocumento IS NULL
               AND (m.MovObservaciones IS NULL OR m.MovObservaciones NOT LIKE 'CUBIERTO%')) AS DECIMAL(18,2));

-- ── EL ARREGLO ──────────────────────────────────────────────────────────────
BEGIN TRANSACTION;

    UPDATE dbo.MovimientosCuenta
    SET MovImporte = -@Correcto,
        MovObservaciones = LEFT(LTRIM(ISNULL(MovObservaciones,'') +
            ' FIX_EMB4353_2026-09-07: el movimiento tenia el importe EN PESOS (2.401,98)' +
            ' dentro de la cuenta de dolares. El precio real son US$ 58,80 (30 x 1,96,' +
            ' lo que cotiza la pre-factura). 58,80 x 40,85 = 2.401,98. Se corrige el importe.'), 500)
    WHERE MovIdMovimiento = @Mov;

    -- Saldo corrido y saldo de cuenta (convencion de la casa: CueSaldoActual suma todo)
    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta = @Cue AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta = @Cue;

COMMIT TRANSACTION;

-- ── DESPUES: el total del ciclo tiene que dar 570,54 ───────────────────────
-- (menos las dos ordenes que destildes: 131,70 + 19,80 = 419,04 = la pre-factura)
SELECT Momento = 'DESPUES', Ciclo = @Cic,
       TotalDelCiclo = CAST((SELECT SUM(ABS(m.MovImporte)) FROM dbo.MovimientosCuenta m
             WHERE m.CicIdCiclo = @Cic AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
               AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND m.MovImporte < 0
               AND m.DocIdDocumento IS NULL
               AND (m.MovObservaciones IS NULL OR m.MovObservaciones NOT LIKE 'CUBIERTO%')) AS DECIMAL(18,2)),
       SiDestildasLasDos = CAST((SELECT SUM(ABS(m.MovImporte)) FROM dbo.MovimientosCuenta m
             WHERE m.CicIdCiclo = @Cic AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
               AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND m.MovImporte < 0
               AND m.DocIdDocumento IS NULL
               AND m.MovIdMovimiento NOT IN (44459, 44191)
               AND (m.MovObservaciones IS NULL OR m.MovObservaciones NOT LIKE 'CUBIERTO%')) AS DECIMAL(18,2));

-- ── OJO CON ESTO: el cruce automatico de la misma orden ────────────────────
-- La orden EMB-4353 tambien genero un PAGO_CRUZADO que le debita dolares a la
-- cuenta. Si ese cruce se calculo sobre los 2.401,98 inflados, tambien esta mal.
-- Este script NO lo toca: mirar el resultado y decidir.
SELECT Aparte = 'CRUCE DE LA MISMA ORDEN', m.MovIdMovimiento, m.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       m.MovTipo, Importe = CAST(m.MovImporte AS DECIMAL(18,2)), m.MovFecha, m.CicIdCiclo,
       Concepto = LEFT(ISNULL(m.MovConcepto,''), 50)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = (SELECT CliIdCliente FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cue)
  AND m.MovConcepto LIKE '%EMB-4353%'
  AND m.MovIdMovimiento <> @Mov
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

-- ── ¿HAY MAS ORDENES DE BORDADO ASI? ──────────────────────────────────────
-- Bordado se esta estrenando: si el bug es del alta de EMB, hay mas.
-- Movimientos ORDEN vivos en cuentas de DOLARES con importe sospechosamente
-- grande y sin pedido congelado que los respalde.
SELECT Barrido = 'OTRAS ORDENES EMB EN CUENTAS USD', Cliente = LEFT(RTRIM(cl.Nombre), 22),
       m.MovIdMovimiento, Importe = CAST(ABS(m.MovImporte) AS DECIMAL(18,2)),
       m.CueIdCuenta, m.CicIdCiclo, m.MovFecha,
       Concepto = LEFT(ISNULL(m.MovConcepto,''), 45)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
WHERE m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.DocIdDocumento IS NULL
  AND cc.MonIdMoneda = 2
  AND m.MovConcepto LIKE 'EMB-%'
  AND ABS(m.MovImporte) > 500          -- en dolares, una orden de bordado de 500+ es rara
ORDER BY ABS(m.MovImporte) DESC;

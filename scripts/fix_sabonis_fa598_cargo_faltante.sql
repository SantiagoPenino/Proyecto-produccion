-- ============================================================================
-- fix_sabonis_fa598_cargo_faltante.sql
-- ----------------------------------------------------------------------------
-- SABONIS - ARTEIDEA (RUC 213866340011), cuenta USD 126, documento FA-598 (7314).
--
-- La factura está en DGI por US$ 20.000, sus 3 líneas suman 20.000 y el cliente
-- pagó 817.400 pesos (= 20.000 USD a 40,87). Pero el CARGO en el libro mayor
-- quedó en −14.999,95: es el de la venta de recursos de las 17:33 (2.142,85 mts
-- × 7,00), y la edición de la factura de las 17:50 nunca lo pisó.
--
-- POR QUÉ NO LO PISÓ: el UPDATE de editarFactura terminaba en
--     AND NOT (MovObservaciones LIKE 'Cross-moneda:%')
-- y NOT (NULL LIKE 'x%') es UNKNOWN, así que todo movimiento sin observaciones
-- quedaba afuera. Corregido en el código (4 lugares de cfeController), pendiente
-- de deploy. Este script arregla el dato que ya quedó mal.
--
-- QUÉ HACE: pone el cargo en −20.000 (lo que debió hacer la edición), guarda el
-- importe y el concepto viejos en MovObservaciones, y recalcula el saldo corrido
-- de la cuenta igual que el backend. NO toca el documento (está ACEPTADO_DGI) ni
-- el plan de metros.
--
-- DESPUÉS DE CORRERLO la cuenta 126 queda en −43,99. NO es un error de este
-- script, y tampoco es una deuda del cliente: es el rastro de un cruce automático
-- que nunca debió dispararse.
--
-- Qué pasó el 19/08: entró una orden de bordado por 1.800 pesos. El motor de
-- cobertura automática (contabilidadService, hookOrdenCreada) vio "saldo a favor
-- en dólares" y sacó 43,99 para cubrirla. Ese saldo era el FANTASMA de los pagos
-- en pesos mal asentados: plata que no existía. Después, el 26/08, el cliente pagó
-- el FA-1150 completo en efectivo (5.082,63 pesos, bordado incluido).
--
-- Peor todavía: ese motor decide leyendo `CuentasCliente.CueSaldoActual` — la
-- columna cacheada que se sabe corrupta — y no el saldo real del libro. O sea el
-- saldo fantasma no solo se veía mal: movió plata sola.
--
-- El arreglo limpio del fleco NO es "devolverle 43,99": es revertir el cruce (los
-- dos movimientos, +43,99 a la cuenta USD y −1.800 a la de pesos) y registrar los
-- 1.800 pesos que el cliente sí pagó en la cuenta de pesos. Las dos cuentas quedan
-- en cero. Va en un script aparte.
--
-- PENDIENTE Y APARTE: al plan #19 le entraron 2.142,85 metros y la factura vende
-- 1.700 (más una bandera de 8.100). Son 442,85 metros de más. Decisión del usuario.
--
-- ABRIR DESDE EL DISCO en SSMS (File → Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Doc INT = 7314;              -- FA-598
DECLARE @Cue INT = 126;               -- cuenta USD de SABONIS
DECLARE @CargoActual DECIMAL(18,4) = -14999.9500;

DECLARE @DocTotal DECIMAL(18,4), @Mov INT, @N INT;

SELECT @DocTotal = DocTotal FROM dbo.DocumentosContables WHERE DocIdDocumento = @Doc;

-- ── CANDADO 1: un solo movimiento de cargo, y con el importe que esperamos ──
SELECT @N = COUNT(*), @Mov = MIN(MovIdMovimiento)
FROM dbo.MovimientosCuenta
WHERE DocIdDocumento = @Doc
  AND CueIdCuenta = @Cue
  AND MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')
  AND (MovAnulado IS NULL OR MovAnulado = 0)
  AND MovImporte = @CargoActual;

IF @N <> 1
BEGIN
    SELECT MovIdMovimiento, MovTipo, MovImporte, MovConcepto, MovObservaciones
    FROM dbo.MovimientosCuenta WHERE DocIdDocumento = @Doc AND CueIdCuenta = @Cue;
    RAISERROR('Se esperaba 1 cargo de -14.999,95 y hay %d. Puede que ya se haya corrido este script. No se toca nada.', 16, 1, @N);
    RETURN;
END

-- ── CANDADO 2: las líneas del documento tienen que respaldar el total ───────
DECLARE @SumaLineas DECIMAL(18,4);
SELECT @SumaLineas = ISNULL(SUM(DcdTotal), 0) FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento = @Doc;

IF ABS(@SumaLineas - @DocTotal) > 1
BEGIN
    -- RAISERROR no acepta decimales como parámetro: se pasan ya convertidos a texto.
    DECLARE @L VARCHAR(30) = CONVERT(VARCHAR(30), @SumaLineas),
            @T VARCHAR(30) = CONVERT(VARCHAR(30), @DocTotal);
    RAISERROR('Las líneas del documento suman %s y el cabezal dice %s. No coinciden: no se asienta nada.', 16, 1, @L, @T);
    RETURN;
END

-- ── ANTES ───────────────────────────────────────────────────────────────────
SELECT Momento = 'ANTES', DocIdDocumento = @Doc, MovIdMovimiento = @Mov,
       CargoActual = @CargoActual, CargoNuevo = -@DocTotal,
       DocTotal = @DocTotal, SumaLineas = @SumaLineas,
       SaldoLibro = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            WHERE m.CueIdCuenta = @Cue AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                              AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0);

BEGIN TRANSACTION;

    UPDATE dbo.MovimientosCuenta
    SET MovImporte       = -@DocTotal,
        MovConcepto      = 'Venta E-Factura Contado: FA-598',
        MovObservaciones = LEFT(LTRIM(ISNULL(MovObservaciones, '') +
            ' FIX_CARGO_2026-09-01: el cargo estaba en ' + CONVERT(VARCHAR(30), MovImporte) +
            ' (venta de recursos de las 17:33) y la factura se editó a ' + CONVERT(VARCHAR(30), @DocTotal) +
            '. Concepto original: "' + ISNULL(MovConcepto, '') + '".'), 500)
    WHERE MovIdMovimiento = @Mov;
    -- Esperado: 1 fila afectada

    -- Recalcular el saldo corrido y el guardado, igual que el backend.
    ;WITH ord AS (
        SELECT MovIdMovimiento,
               SUM(MovImporte) OVER (ORDER BY MovFecha, MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS run
        FROM dbo.MovimientosCuenta
        WHERE CueIdCuenta = @Cue AND (MovAnulado IS NULL OR MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE dbo.CuentasCliente
    SET CueSaldoActual = ISNULL((SELECT SUM(MovImporte) FROM dbo.MovimientosCuenta
                                 WHERE CueIdCuenta = @Cue AND (MovAnulado IS NULL OR MovAnulado = 0)), 0)
    WHERE CueIdCuenta = @Cue;

COMMIT TRANSACTION;

-- ── DESPUÉS ─────────────────────────────────────────────────────────────────
-- Esperado: FA-598 netea 0 (cargo -20.000 contra cobro +20.000) y el saldo del
-- libro de la cuenta queda en -43,99 (el fleco del bordado).
SELECT Momento = 'DESPUES',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       d.DocTotal,
       Cargos = SUM(CASE WHEN m.MovImporte < 0 THEN m.MovImporte ELSE 0 END),
       Cobros = SUM(CASE WHEN m.MovImporte > 0 THEN m.MovImporte ELSE 0 END),
       Neto   = SUM(m.MovImporte)
FROM dbo.MovimientosCuenta m
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
WHERE m.DocIdDocumento = @Doc AND m.CueIdCuenta = @Cue
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
GROUP BY d.DocSerie, d.DocNumero, d.DocTotal;

SELECT Momento = 'DESPUES · cuenta',
       cc.CueIdCuenta, cc.CueSaldoActual AS SaldoGuardado,
       SaldoLibro = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            WHERE m.CueIdCuenta = cc.CueIdCuenta
                              AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                              AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
FROM dbo.CuentasCliente cc WHERE cc.CueIdCuenta = @Cue;

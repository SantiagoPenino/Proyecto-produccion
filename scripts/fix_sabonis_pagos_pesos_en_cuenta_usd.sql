-- ============================================================================
-- fix_sabonis_pagos_pesos_en_cuenta_usd.sql
-- ----------------------------------------------------------------------------
-- SABONIS - ARTEIDEA (RUC 213866340011), cuenta USD 126.
--
-- Dos facturas EN PESOS cuyo PAGO se asentó en la cuenta de DÓLARES sin convertir.
-- El cargo sí se convirtió bien; el pago entró crudo, ~41 veces más grande:
--
--   FA-1007 (doc 7857, cot 40,87)  cargo −38,40   pago +1.568,64  → sobran 1.530,24
--   FA-1150 (doc 9406, cot 40,78)  cargo −80,16   pago +5.082,63  → sobran 5.002,47
--
-- Esos 6.532,71 son el grueso del "saldo a favor" de US$ 11.488,77 que muestra el
-- Panel 360. No es plata del cliente: es un importe en pesos leído como dólares.
--
-- QUÉ HACE: baja el importe del movimiento de PAGO a la parte EN DÓLARES del
-- documento (la suma de sus cargos en esta cuenta), deja el importe viejo escrito
-- en MovObservaciones (reversible) y recalcula el saldo corrido de la cuenta con
-- la misma fórmula que usa el sistema (recomputarSaldoCuenta).
--
-- QUÉ NO TOCA:
--   · Los documentos: los tres están ACEPTADO_DGI y no se modifican.
--   · La cuenta en pesos (2661): ya está en cero y queda igual.
--   · FA-598 (los otros 5.000,05): ese es un cargo que falta asentar, no un
--     problema de moneda. Va aparte, junto con la decisión de los 442,85 metros
--     de más que entraron al plan #19.
--   · El PAGO_CRUZADO de −43,99 del 19/08: el bordado se cubrió con dólares y
--     después se pagó en pesos dentro del FA-1150. Queda pendiente de decisión.
--
-- Después de correrlo, el saldo a favor de la cuenta 126 pasa de 11.488,77 a
-- 4.956,06 (= los 5.000,05 del FA-598 menos el cruzado de 43,99).
--
-- ABRIR DESDE EL DISCO en SSMS (File → Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Cue INT = 126;   -- cuenta USD de SABONIS

-- Los dos documentos a corregir y el importe que HOY tiene su pago
DECLARE @Casos TABLE (DocId INT, PagoActual DECIMAL(18,4), Cotizacion DECIMAL(18,4));
INSERT INTO @Casos (DocId, PagoActual, Cotizacion)
VALUES (7857, 1568.6400, 40.87),
       (9406, 5082.6300, 40.78);

-- ── ANTES: qué se va a cambiar ──────────────────────────────────────────────
-- PagoNuevo sale de los CARGOS del propio documento en esta cuenta (no de una
-- cuenta a mano): el pago no puede ser mayor que lo que el documento cargó acá.
SELECT Momento = 'ANTES',
       c.DocId,
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       MonedaDoc = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       d.DocTotal,
       c.Cotizacion,
       m.MovIdMovimiento,
       PagoActual = m.MovImporte,
       PagoNuevo  = ABS(ISNULL((SELECT SUM(m2.MovImporte) FROM dbo.MovimientosCuenta m2
                                WHERE m2.DocIdDocumento = c.DocId
                                  AND m2.CueIdCuenta = @Cue
                                  AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0)
                                  AND m2.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')
                                  AND m2.MovImporte < 0), 0)),
       Concepto = LEFT(m.MovConcepto, 60)
FROM @Casos c
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = c.DocId
JOIN dbo.MovimientosCuenta m
     ON m.DocIdDocumento = c.DocId
    AND m.CueIdCuenta = @Cue
    AND m.MovTipo = 'PAGO'
    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    AND m.MovImporte = c.PagoActual;
-- Esperado: 2 filas. FA-1007 1.568,64 → 38,40 · FA-1150 5.082,63 → 80,16

-- ── CANDADO: tienen que ser exactamente 2 movimientos ───────────────────────
DECLARE @N INT;
SELECT @N = COUNT(*)
FROM @Casos c
JOIN dbo.MovimientosCuenta m
     ON m.DocIdDocumento = c.DocId
    AND m.CueIdCuenta = @Cue
    AND m.MovTipo = 'PAGO'
    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    AND m.MovImporte = c.PagoActual;

IF @N <> 2
BEGIN
    RAISERROR('Se esperaban 2 movimientos de PAGO para corregir y hay %d. Puede que ya se haya corrido este script. No se toca nada.', 16, 1, @N);
    RETURN;
END

BEGIN TRANSACTION;

    UPDATE m
    SET m.MovImporte = ABS(ISNULL((SELECT SUM(m2.MovImporte) FROM dbo.MovimientosCuenta m2
                                   WHERE m2.DocIdDocumento = c.DocId
                                     AND m2.CueIdCuenta = @Cue
                                     AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0)
                                     AND m2.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')
                                     AND m2.MovImporte < 0), 0)),
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') +
            ' FIX_MONEDA_2026-09-01: el importe original ' + CONVERT(VARCHAR(30), m.MovImporte) +
            ' estaba en PESOS y se había asentado en la cuenta en dolares (cot. ' +
            CONVERT(VARCHAR(20), c.Cotizacion) + ').'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN @Casos c
         ON c.DocId = m.DocIdDocumento
        AND m.CueIdCuenta = @Cue
        AND m.MovTipo = 'PAGO'
        AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
        AND m.MovImporte = c.PagoActual;
    -- Esperado: 2 filas afectadas

    -- Recalcular el saldo corrido y el saldo guardado de la cuenta, igual que
    -- hace el backend después de cambiar el importe de un movimiento.
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
-- Esperado: los dos documentos netean 0 en la cuenta USD, y el saldo del libro
-- queda en 4.956,06 (lo que falta resolver del FA-598 y del cruzado).
SELECT Momento = 'DESPUES',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Cargos = SUM(CASE WHEN m.MovImporte < 0 THEN m.MovImporte ELSE 0 END),
       Cobros = SUM(CASE WHEN m.MovImporte > 0 THEN m.MovImporte ELSE 0 END),
       Neto   = SUM(m.MovImporte)
FROM dbo.MovimientosCuenta m
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
WHERE m.DocIdDocumento IN (7857, 9406)
  AND m.CueIdCuenta = @Cue
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
GROUP BY d.DocSerie, d.DocNumero;

SELECT Momento = 'DESPUES · cuenta',
       cc.CueIdCuenta,
       cc.CueSaldoActual AS SaldoGuardado,
       SaldoLibro = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            WHERE m.CueIdCuenta = cc.CueIdCuenta
                              AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                              AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
FROM dbo.CuentasCliente cc
WHERE cc.CueIdCuenta = @Cue;

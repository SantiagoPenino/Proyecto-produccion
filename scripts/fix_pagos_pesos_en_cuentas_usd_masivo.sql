-- ============================================================================
-- fix_pagos_pesos_en_cuentas_usd_masivo.sql
-- ----------------------------------------------------------------------------
-- Cobros que se asentaron SIN CONVERTIR en una cuenta de otra moneda: el importe
-- en pesos entró crudo a la cuenta en dólares (~41 veces más grande). El cargo del
-- mismo documento sí quedó convertido, así que el documento nunca netea y al
-- cliente le aparece un "saldo a favor" que no existe.
--
-- Causa: editarFactura (cfeController) creaba el PAGO con DocTotal en la cuenta de
-- la moneda del DOCUMENTO. Ya está corregido en el código (el pago va a la cuenta
-- del cargo y por el importe del cargo) — falta el deploy. Este script arregla lo
-- que ya quedó mal.
--
-- ALCANCE (decidido 01-09-2026): SOLO clientes de tipo Común (1) y sin tipo.
-- En producción al 01-09: 1.801 movimientos, 630 clientes, 631 cuentas.
-- Un cliente Común paga y se va: no puede tener saldo a favor. Por eso son los
-- primeros y los más seguros.
-- NO entran: semanales, los 7 de Rollo por adelantado (su crédito vive en metros y
-- hay que mirarlos uno por uno) ni los 2 Deudores.
--
-- QUÉ HACE: a cada cobro le pone EL IMPORTE DEL CARGO de su propio documento en esa
-- misma cuenta — el que la caja ya asentó convertido. No se calcula ninguna
-- cotización: sale del libro. Deja el importe viejo escrito en MovObservaciones
-- (marca FIX_MONEDA_2026-09-01, reversible) y recalcula el saldo corrido y el saldo
-- guardado de las cuentas tocadas.
--
-- QUÉ NO TOCA: los documentos (nada que haya ido a DGI), los cargos, las deudas, ni
-- los cobros cuyo documento no tenga cargo en esa cuenta (sin referencia = no se
-- toca; en el alcance actual no hay ninguno).
--
-- Es idempotente: una vez corregido, el importe deja de coincidir con el DocTotal y
-- el movimiento ya no entra en la selección. Correrlo de nuevo afecta 0 filas.
--
-- ESPERADO: los saldos de esas cuentas pasan de US$ 3.332.157 a US$ 90.408.
-- 356 clientes quedan en cero, 198 con restos chicos (12.543 en total) y 77 quedan
-- DEBIENDO — esa es plata real sin cobrar que el saldo falso venía tapando.
--
-- ABRIR DESDE EL DISCO en SSMS (File → Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

-- Los cobros a corregir, con el importe que les corresponde.
DECLARE @Fix TABLE (
    MovIdMovimiento INT PRIMARY KEY,
    CueIdCuenta     INT,
    ImporteViejo    DECIMAL(18,4),
    ImporteNuevo    DECIMAL(18,4)
);

INSERT INTO @Fix (MovIdMovimiento, CueIdCuenta, ImporteViejo, ImporteNuevo)
SELECT m.MovIdMovimiento, m.CueIdCuenta, m.MovImporte, x.Cargo
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente     cc ON cc.CueIdCuenta   = m.CueIdCuenta
JOIN dbo.Clientes           cl ON cl.CliIdCliente  = cc.CliIdCliente
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
CROSS APPLY (
    -- El cargo del MISMO documento en la MISMA cuenta: ya está en la moneda correcta.
    SELECT Cargo = ISNULL(ABS(SUM(m2.MovImporte)), 0)
    FROM dbo.MovimientosCuenta m2
    WHERE m2.DocIdDocumento = m.DocIdDocumento
      AND m2.CueIdCuenta    = m.CueIdCuenta
      AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0)
      AND m2.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')
      AND m2.MovImporte < 0
) x
WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo    = 'PAGO'
  AND m.MovImporte > 0
  AND cc.MonIdMoneda <> d.MonIdMoneda                 -- la cuenta es de otra moneda que el documento
  AND ABS(m.MovImporte - d.DocTotal) < 0.02           -- y se estampó el total del documento sin convertir
  AND (cl.TClIdTipoCliente = 1 OR cl.TClIdTipoCliente IS NULL)   -- Común y sin tipo
  AND x.Cargo > 0.005                                 -- sin cargo de referencia no se toca
  AND ABS(m.MovImporte - x.Cargo) > 0.02;             -- y no está ya corregido

-- ── BLOQUE 0: qué se va a tocar (correr solo esto la primera vez) ───────────
SELECT Resumen = 'A CORREGIR',
       Movimientos = COUNT(*),
       Clientes    = COUNT(DISTINCT cc.CliIdCliente),
       Cuentas     = COUNT(DISTINCT f.CueIdCuenta),
       HoyDice     = SUM(f.ImporteViejo),
       DeberiaDecir= SUM(f.ImporteNuevo),
       SeBorra     = SUM(f.ImporteViejo - f.ImporteNuevo)
FROM @Fix f JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = f.CueIdCuenta;
-- Esperado en producción al 01-09-2026: 1.801 movimientos · 630 clientes · 3.241.749 de humo

-- Los 25 más grandes, para mirar de cerca antes de escribir
SELECT TOP 25
       Cliente   = RTRIM(cl.Nombre),
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       MonedaDoc = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       d.DocTotal,
       MonedaCuenta = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       CobroHoy  = f.ImporteViejo,
       CobroReal = f.ImporteNuevo,
       d.DocCotizacion
FROM @Fix f
JOIN dbo.MovimientosCuenta m  ON m.MovIdMovimiento = f.MovIdMovimiento
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
JOIN dbo.CuentasCliente cc    ON cc.CueIdCuenta    = f.CueIdCuenta
JOIN dbo.Clientes cl          ON cl.CliIdCliente   = cc.CliIdCliente
ORDER BY f.ImporteViejo DESC;

-- ── EL ARREGLO ──────────────────────────────────────────────────────────────
BEGIN TRANSACTION;

    UPDATE m
    SET m.MovImporte = f.ImporteNuevo,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') +
            ' FIX_MONEDA_2026-09-01: el cobro decía ' + CONVERT(VARCHAR(30), f.ImporteViejo) +
            ', que era el importe del documento en su moneda asentado sin convertir en esta' +
            ' cuenta. Se ajusta al cargo del mismo documento en esta cuenta.'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN @Fix f ON f.MovIdMovimiento = m.MovIdMovimiento;
    -- Esperado: 1.801 filas afectadas

    -- Recalcular saldo corrido y saldo guardado de las cuentas tocadas, con la
    -- misma fórmula del backend (recomputarSaldoCuenta).
    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM @Fix)
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM @Fix);

COMMIT TRANSACTION;

-- ── DESPUÉS: cómo quedaron las cuentas tocadas ──────────────────────────────
SELECT Estado = CASE WHEN ABS(s.Saldo) < 1 THEN '1 · en cero'
                     WHEN s.Saldo < -1     THEN '2 · queda DEBIENDO (plata sin cobrar)'
                     ELSE                       '3 · queda a favor (resto)' END,
       Cuentas = COUNT(*),
       Total   = SUM(s.Saldo)
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM @Fix)
GROUP BY CASE WHEN ABS(s.Saldo) < 1 THEN '1 · en cero'
              WHEN s.Saldo < -1     THEN '2 · queda DEBIENDO (plata sin cobrar)'
              ELSE                       '3 · queda a favor (resto)' END
ORDER BY 1;

-- Los que quedan DEBIENDO: plata real sin cobrar que el saldo falso venía tapando.
-- Sacar esta lista y pasarla a cobranzas.
SELECT Cliente = RTRIM(cl.Nombre), cl.CliIdCliente, cc.CueIdCuenta,
       Moneda  = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Debe    = -s.Saldo
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM @Fix)
  AND s.Saldo < -1
ORDER BY s.Saldo;

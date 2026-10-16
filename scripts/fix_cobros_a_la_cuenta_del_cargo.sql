-- ============================================================================
-- fix_cobros_a_la_cuenta_del_cargo.sql
-- ----------------------------------------------------------------------------
-- UNA sola regla: el cobro de un documento tiene que estar EN LA CUENTA DEL CARGO
-- y POR EL IMPORTE DEL CARGO. Es lo que hace el código ya corregido
-- (editarFactura); esto repara lo que quedó mal antes.
--
-- Cubre las DOS formas en que se rompió:
--   a) el cobro está en la cuenta correcta pero con el importe SIN CONVERTIR
--      (el total del documento en pesos metido en una cuenta en dólares, ~41x)
--   b) el cobro quedó en OTRA cuenta que el cargo (una queda a favor y la otra
--      debiendo; caso andrea silva PC-2578: cargo US$ 1.423,13 y cobro $ 58.347,53)
--
-- ALCANCE: clientes de tipo Común (1) y sin tipo. NO entran semanales, rollo
-- adelantado ni deudores.
--
-- QUÉ HACE: mueve el cobro a la cuenta del cargo y le pone el importe del cargo
-- (que ya está convertido y asentado por la caja — no se calcula cotización). Deja
-- el importe y la cuenta viejos escritos en MovObservaciones (marca
-- FIX_COBRO_2026-09-01, reversible) y recalcula el saldo corrido y el guardado de
-- TODAS las cuentas tocadas (la de origen y la de destino).
--
-- CANDADOS — solo toca documentos donde no hay nada que interpretar:
--   · el documento tiene cargo vivo en UNA sola cuenta
--   · tiene UN solo cobro vivo
--   · ese cobro equivale al TOTAL del documento (±0,02): es el pago completo mal
--     asentado. Un pago PARCIAL de verdad no se toca nunca.
--   · el cargo es mayor a 0
-- Lo que no cumple queda listado al final para mirarlo a mano.
--
-- NO TOCA: los documentos (nada que haya ido a DGI), los cargos, ni las deudas.
--
-- Es idempotente: una vez corregido, el cobro queda igual al cargo y en su cuenta,
-- así que deja de entrar en la selección. Correrlo de nuevo afecta 0 filas.
--
-- ABRIR DESDE EL DISCO en SSMS (File → Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Fix TABLE (
    MovIdMovimiento INT PRIMARY KEY,
    DocIdDocumento  INT,
    CtaVieja        INT,
    CtaNueva        INT,
    ImporteViejo    DECIMAL(18,4),
    ImporteNuevo    DECIMAL(18,4)
);

;WITH Doc AS (
    -- Un documento por fila, con dónde está su cargo y dónde su cobro.
    SELECT d.DocIdDocumento, d.DocTotal,
           CtaCargo   = MIN(CASE WHEN m.MovImporte < 0 AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') THEN m.CueIdCuenta END),
           CtasCargo  = COUNT(DISTINCT CASE WHEN m.MovImporte < 0 AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') THEN m.CueIdCuenta END),
           Cargo      = SUM(CASE WHEN m.MovImporte < 0 AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') THEN -m.MovImporte ELSE 0 END),
           Cobros     = SUM(CASE WHEN m.MovImporte > 0 AND m.MovTipo = 'PAGO' THEN 1 ELSE 0 END),
           MovCobro   = MIN(CASE WHEN m.MovImporte > 0 AND m.MovTipo = 'PAGO' THEN m.MovIdMovimiento END)
    FROM dbo.DocumentosContables d
    JOIN dbo.MovimientosCuenta m  ON m.DocIdDocumento = d.DocIdDocumento
    JOIN dbo.CuentasCliente     cc ON cc.CueIdCuenta  = m.CueIdCuenta
    JOIN dbo.Clientes           cl ON cl.CliIdCliente = cc.CliIdCliente
    WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND cc.CueTipo LIKE 'DINERO%'
      AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO','PAGO')
      AND ISNULL(d.DocEstado,'') <> 'ANULADO'
      AND (cl.TClIdTipoCliente = 1 OR cl.TClIdTipoCliente IS NULL)
    GROUP BY d.DocIdDocumento, d.DocTotal
)
INSERT INTO @Fix (MovIdMovimiento, DocIdDocumento, CtaVieja, CtaNueva, ImporteViejo, ImporteNuevo)
SELECT p.MovIdMovimiento, x.DocIdDocumento, p.CueIdCuenta, x.CtaCargo, p.MovImporte, x.Cargo
FROM Doc x
JOIN dbo.MovimientosCuenta p ON p.MovIdMovimiento = x.MovCobro
WHERE x.CtasCargo = 1                                  -- el cargo vive en una sola cuenta
  AND x.Cobros    = 1                                  -- y hay un solo cobro
  AND x.Cargo     > 0.005
  AND ABS(p.MovImporte - x.DocTotal) < 0.02            -- el cobro es el TOTAL del documento (no un parcial)
  AND (
        -- (b) está en la cuenta equivocada: siempre se lleva a la del cargo
        p.CueIdCuenta <> x.CtaCargo
        -- (a) está en la cuenta correcta pero con el importe SIN CONVERTIR: solo se
        --     toca cuando la diferencia es de ESCALA (más de 5 veces). Las diferencias
        --     de centavos entre el cargo y el total del documento son redondeo y NO se
        --     tocan (ej. un cobro de 22.090,01 contra un cargo de 22.090,13).
        OR (p.MovImporte > x.Cargo * 5 AND p.MovImporte - x.Cargo > 1)
      );

-- ── BLOQUE 0: qué se va a tocar (correr solo esto la primera vez) ───────────
SELECT Resumen = 'A CORREGIR',
       Cobros      = COUNT(*),
       Documentos  = COUNT(DISTINCT f.DocIdDocumento),
       CambianDeCuenta = SUM(CASE WHEN f.CtaVieja <> f.CtaNueva THEN 1 ELSE 0 END),
       SoloImporte     = SUM(CASE WHEN f.CtaVieja = f.CtaNueva THEN 1 ELSE 0 END),
       HoyDice     = SUM(f.ImporteViejo),
       DeberiaDecir= SUM(f.ImporteNuevo)
FROM @Fix f;

SELECT TOP 25
       Cliente   = RTRIM(cl.Nombre),
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       MonedaDoc = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       d.DocTotal,
       CobroHoy  = f.ImporteViejo,  CuentaHoy  = f.CtaVieja,
       CobroReal = f.ImporteNuevo,  CuentaReal = f.CtaNueva
FROM @Fix f
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = f.DocIdDocumento
JOIN dbo.Clientes cl           ON cl.CliIdCliente  = d.CliIdCliente
ORDER BY f.ImporteViejo DESC;

-- ── EL ARREGLO ──────────────────────────────────────────────────────────────
BEGIN TRANSACTION;

    UPDATE m
    SET m.CueIdCuenta = f.CtaNueva,
        m.MovImporte  = f.ImporteNuevo,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') +
            ' FIX_COBRO_2026-09-01: el cobro estaba en la cuenta ' + CONVERT(VARCHAR(20), f.CtaVieja) +
            ' por ' + CONVERT(VARCHAR(30), f.ImporteViejo) + '. Se lleva a la cuenta del cargo (' +
            CONVERT(VARCHAR(20), f.CtaNueva) + ') por el importe del cargo.'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN @Fix f ON f.MovIdMovimiento = m.MovIdMovimiento;

    -- Recalcular saldo corrido y guardado de TODAS las cuentas tocadas
    -- (la de origen del cobro y la de destino).
    ;WITH Tocadas AS (
        SELECT CtaVieja AS Cue FROM @Fix
        UNION
        SELECT CtaNueva      FROM @Fix
    ), ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta IN (SELECT Cue FROM Tocadas)
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta IN (SELECT CtaVieja FROM @Fix UNION SELECT CtaNueva FROM @Fix);

COMMIT TRANSACTION;

-- ── DESPUÉS: cómo quedaron las cuentas tocadas ──────────────────────────────
SELECT Estado = CASE WHEN ABS(s.Saldo) < 1 THEN '1 · en cero'
                     WHEN s.Saldo < -1     THEN '2 · queda DEBIENDO (plata sin cobrar)'
                     ELSE                       '3 · queda a favor (resto)' END,
       Cuentas = COUNT(*), Total = SUM(s.Saldo)
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (SELECT CtaVieja FROM @Fix UNION SELECT CtaNueva FROM @Fix)
GROUP BY CASE WHEN ABS(s.Saldo) < 1 THEN '1 · en cero'
              WHEN s.Saldo < -1     THEN '2 · queda DEBIENDO (plata sin cobrar)'
              ELSE                       '3 · queda a favor (resto)' END
ORDER BY 1;

-- ── LO QUE NO SE TOCÓ Y HAY QUE MIRAR A MANO ───────────────────────────────
-- Documentos de clientes Común/sin tipo cuyo cargo y cobro no cierran, pero que
-- no cumplen los candados (cargo en dos cuentas, varios cobros, o el cobro no
-- equivale al total del documento — puede ser un parcial legítimo).
SELECT TOP 50
       Cliente   = RTRIM(cl.Nombre),
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       d.DocTotal,
       CtasCargo = COUNT(DISTINCT CASE WHEN m.MovImporte < 0 AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') THEN m.CueIdCuenta END),
       Cobros    = SUM(CASE WHEN m.MovImporte > 0 AND m.MovTipo = 'PAGO' THEN 1 ELSE 0 END),
       Cargo     = SUM(CASE WHEN m.MovImporte < 0 AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') THEN -m.MovImporte ELSE 0 END),
       Cobrado   = SUM(CASE WHEN m.MovImporte > 0 AND m.MovTipo = 'PAGO' THEN m.MovImporte ELSE 0 END),
       Neto      = SUM(m.MovImporte)
FROM dbo.DocumentosContables d
JOIN dbo.MovimientosCuenta m  ON m.DocIdDocumento = d.DocIdDocumento
JOIN dbo.CuentasCliente     cc ON cc.CueIdCuenta  = m.CueIdCuenta
JOIN dbo.Clientes           cl ON cl.CliIdCliente = cc.CliIdCliente
WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND cc.CueTipo LIKE 'DINERO%'
  AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO','PAGO')
  AND ISNULL(d.DocEstado,'') <> 'ANULADO'
  AND (cl.TClIdTipoCliente = 1 OR cl.TClIdTipoCliente IS NULL)
  AND d.DocIdDocumento NOT IN (SELECT DocIdDocumento FROM @Fix)
GROUP BY cl.Nombre, d.DocSerie, d.DocNumero, d.DocTotal
HAVING ABS(SUM(m.MovImporte)) > 1
ORDER BY ABS(SUM(m.MovImporte)) DESC;

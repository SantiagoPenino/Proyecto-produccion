-- ============================================================================
-- diag_cargos_desfasados_vs_doctotal.sql   (SOLO LECTURA — no cambia nada)
-- ----------------------------------------------------------------------------
-- Barrido del bug del NULL en editarFactura (01-09-2026): al editar el importe de
-- una factura, el UPDATE que pisa el cargo del libro mayor terminaba en
--     AND NOT (MovObservaciones LIKE 'Cross-moneda:%')
-- y NOT (NULL LIKE 'x%') da UNKNOWN → todo movimiento SIN observaciones quedaba
-- afuera (el 88% de los cargos). Resultado: el cobro se actualizaba y el cargo
-- quedaba con el importe viejo. Caso que lo destapó: SABONIS FA-598 (cargo
-- 14.999,95 contra una factura editada a 20.000).
--
-- Esta consulta lista los documentos donde el CARGO del libro no coincide con el
-- DocTotal. Cada fila es plata que el libro mayor cuenta distinto que la factura.
--
-- CÓMO COMPARA: el cargo vive en la cuenta y puede estar en otra moneda que el
-- documento. Se convierte el DocTotal a la moneda de la cuenta con DocCotizacion
-- antes de comparar, así una factura en pesos con el cargo en dólares NO aparece
-- como diferencia si está bien convertida.
--
-- QUÉ NO ENTRA (a propósito):
--   · documentos anulados y notas de crédito/débito
--   · los marcadores cross-moneda (importe 0, obs 'Cross-moneda:...')
--   · documentos sin ningún cargo → van en el bloque 3, son otra cosa
--   · documentos con cargos en MÁS DE UNA cuenta → bloque 2, se miran a mano
-- ============================================================================

DECLARE @Tolerancia DECIMAL(18,4) = 1.00;   -- diferencias más chicas son redondeo

;WITH Cargos AS (
    SELECT m.DocIdDocumento,
           Cuentas   = COUNT(DISTINCT m.CueIdCuenta),
           CueIdCuenta = MIN(m.CueIdCuenta),
           Cargo     = SUM(m.MovImporte)
    FROM dbo.MovimientosCuenta m
    WHERE m.DocIdDocumento IS NOT NULL
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')
      AND m.MovImporte < 0
      AND (m.MovObservaciones IS NULL OR m.MovObservaciones NOT LIKE 'Cross-moneda:%')
    GROUP BY m.DocIdDocumento
),
-- Lo que el documento dejó NETO en la cuenta (cargo + cobros). Si el cobro también
-- vino duplicado, el neto da 0 y la cuenta del cliente nunca se movió: el desfasaje
-- es feo pero no cambia lo que el cliente debe. Los que hay que atacar son los de
-- neto distinto de cero.
Netos AS (
    SELECT m.DocIdDocumento, m.CueIdCuenta,
           Cobro = SUM(CASE WHEN m.MovImporte > 0 THEN m.MovImporte ELSE 0 END),
           Neto  = SUM(m.MovImporte)
    FROM dbo.MovimientosCuenta m
    WHERE m.DocIdDocumento IS NOT NULL
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
      AND (m.MovObservaciones IS NULL OR m.MovObservaciones NOT LIKE 'Cross-moneda:%')
    GROUP BY m.DocIdDocumento, m.CueIdCuenta
),
Comparado AS (
    SELECT d.DocIdDocumento,
           d.CliIdCliente,
           Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
           DocTipo   = RTRIM(d.DocTipo),
           d.DocFechaEmision,
           d.DocTotal,
           MonedaDoc    = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
           MonedaCuenta = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
           c.CueIdCuenta,
           c.Cuentas,
           CargoLibro = ABS(c.Cargo),
           -- DocTotal llevado a la moneda de la cuenta donde vive el cargo
           Esperado = CASE
               WHEN d.MonIdMoneda = cc.MonIdMoneda THEN d.DocTotal
               WHEN d.MonIdMoneda = 1 AND cc.MonIdMoneda = 2 AND ISNULL(d.DocCotizacion, 0) > 0 THEN d.DocTotal / d.DocCotizacion
               WHEN d.MonIdMoneda = 2 AND cc.MonIdMoneda = 1 AND ISNULL(d.DocCotizacion, 0) > 0 THEN d.DocTotal * d.DocCotizacion
               ELSE NULL   -- monedas distintas y sin cotización: no comparable
           END,
           d.DocCotizacion,
           d.DocPagado,
           d.CfeEstado,
           Cobro = ISNULL(n.Cobro, 0),
           Neto  = ISNULL(n.Neto, 0)
    FROM Cargos c
    JOIN dbo.DocumentosContables d ON d.DocIdDocumento = c.DocIdDocumento
    JOIN dbo.CuentasCliente cc     ON cc.CueIdCuenta = c.CueIdCuenta
    LEFT JOIN Netos n ON n.DocIdDocumento = c.DocIdDocumento AND n.CueIdCuenta = c.CueIdCuenta
    WHERE ISNULL(d.DocEstado, '') <> 'ANULADO'
      AND RTRIM(d.DocTipo) NOT LIKE '%Nota%'
      AND RTRIM(d.DocTipo) NOT LIKE '%NOTA%'
)
-- ── 1) EL BARRIDO: cargo del libro ≠ total de la factura ────────────────────
SELECT TOP 200
       x.DocIdDocumento, x.Documento, x.DocTipo, x.DocFechaEmision,
       Cliente = RTRIM(cl.Nombre),
       x.MonedaDoc, x.DocTotal, x.MonedaCuenta, x.CueIdCuenta,
       x.CargoLibro,
       Esperado   = CONVERT(DECIMAL(18,2), x.Esperado),
       Diferencia = CONVERT(DECIMAL(18,2), x.Esperado - x.CargoLibro),
       Cobro      = CONVERT(DECIMAL(18,2), x.Cobro),
       -- Lo que el documento dejó realmente en la cuenta. Neto ≈ 0 → el desfasaje
       -- no movió el saldo del cliente (cargo y cobro vinieron mal los dos).
       Neto       = CONVERT(DECIMAL(18,2), x.Neto),
       MueveElSaldo = CASE WHEN ABS(x.Neto) > @Tolerancia THEN 'SI' ELSE 'no' END,
       x.DocPagado, x.CfeEstado
FROM Comparado x
JOIN dbo.Clientes cl ON cl.CliIdCliente = x.CliIdCliente
WHERE x.Cuentas = 1
  AND x.Esperado IS NOT NULL
  AND ABS(x.Esperado - x.CargoLibro) > @Tolerancia
ORDER BY CASE WHEN ABS(x.Neto) > @Tolerancia THEN 0 ELSE 1 END,
         ABS(x.Neto) DESC, ABS(x.Esperado - x.CargoLibro) DESC;

-- ── 1.b) EL TAMAÑO DEL PROBLEMA: cuántos y por cuánto, por moneda ───────────
;WITH Cargos AS (
    SELECT m.DocIdDocumento, Cuentas = COUNT(DISTINCT m.CueIdCuenta),
           CueIdCuenta = MIN(m.CueIdCuenta), Cargo = SUM(m.MovImporte)
    FROM dbo.MovimientosCuenta m
    WHERE m.DocIdDocumento IS NOT NULL
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')
      AND m.MovImporte < 0
      AND (m.MovObservaciones IS NULL OR m.MovObservaciones NOT LIKE 'Cross-moneda:%')
    GROUP BY m.DocIdDocumento
)
SELECT q.Moneda,
       Documentos      = COUNT(*),
       FaltaCargar     = SUM(CASE WHEN q.Dif > 0 THEN q.Dif ELSE 0 END),
       CargadoDeMas    = SUM(CASE WHEN q.Dif < 0 THEN -q.Dif ELSE 0 END)
FROM (
    SELECT Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
           Dif = CASE
               WHEN d.MonIdMoneda = cc.MonIdMoneda THEN d.DocTotal
               WHEN d.MonIdMoneda = 1 AND cc.MonIdMoneda = 2 AND ISNULL(d.DocCotizacion,0) > 0 THEN d.DocTotal / d.DocCotizacion
               WHEN d.MonIdMoneda = 2 AND cc.MonIdMoneda = 1 AND ISNULL(d.DocCotizacion,0) > 0 THEN d.DocTotal * d.DocCotizacion
           END - ABS(c.Cargo)
    FROM Cargos c
    JOIN dbo.DocumentosContables d ON d.DocIdDocumento = c.DocIdDocumento
    JOIN dbo.CuentasCliente cc     ON cc.CueIdCuenta = c.CueIdCuenta
    WHERE c.Cuentas = 1
      AND ISNULL(d.DocEstado,'') <> 'ANULADO'
      AND RTRIM(d.DocTipo) NOT LIKE '%Nota%' AND RTRIM(d.DocTipo) NOT LIKE '%NOTA%'
) q
WHERE ABS(q.Dif) > @Tolerancia
GROUP BY q.Moneda;

-- ── 2) A MANO: documentos con cargos repartidos en más de una cuenta ────────
--    (caso FA-1150: una parte en dólares y otra en pesos). No se pueden comparar
--    contra un único DocTotal sin mirarlos.
SELECT m.DocIdDocumento,
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Cliente   = RTRIM(cl.Nombre),
       d.DocTotal,
       MonedaDoc = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Cuentas   = COUNT(DISTINCT m.CueIdCuenta),
       CargoTotal = SUM(m.MovImporte)
FROM dbo.MovimientosCuenta m
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
JOIN dbo.Clientes cl ON cl.CliIdCliente = d.CliIdCliente
WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')
  AND m.MovImporte < 0
  AND (m.MovObservaciones IS NULL OR m.MovObservaciones NOT LIKE 'Cross-moneda:%')
  AND ISNULL(d.DocEstado,'') <> 'ANULADO'
GROUP BY m.DocIdDocumento, d.DocSerie, d.DocNumero, cl.Nombre, d.DocTotal, d.MonIdMoneda
HAVING COUNT(DISTINCT m.CueIdCuenta) > 1
ORDER BY SUM(m.MovImporte);

-- ── 3) OTRA FAMILIA: documentos sin NINGÚN cargo en el libro ────────────────
--    No es este bug (no hay nada que pisar): son ventas que nunca se asentaron.
SELECT TOP 100
       d.DocIdDocumento,
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       DocTipo   = RTRIM(d.DocTipo),
       Cliente   = RTRIM(cl.Nombre),
       d.DocFechaEmision, d.DocTotal, d.DocPagado
FROM dbo.DocumentosContables d
JOIN dbo.Clientes cl ON cl.CliIdCliente = d.CliIdCliente
WHERE ISNULL(d.DocEstado,'') <> 'ANULADO'
  AND RTRIM(d.DocTipo) NOT LIKE '%Nota%' AND RTRIM(d.DocTipo) NOT LIKE '%NOTA%'
  AND RTRIM(d.DocTipo) NOT LIKE '%Recibo%' AND RTRIM(d.DocTipo) NOT LIKE '%RECIBO%'
  -- Los egresos de caja no cargan cuenta corriente de nadie: no van acá.
  AND RTRIM(d.DocTipo) NOT LIKE '%EGRESO%'
  AND d.DocTotal > 1
  AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                  WHERE m.DocIdDocumento = d.DocIdDocumento
                    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                    AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')
                    AND m.MovImporte < 0)
ORDER BY d.DocTotal DESC;

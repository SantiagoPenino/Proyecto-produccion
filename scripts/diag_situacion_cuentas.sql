-- ============================================================================
-- diag_situacion_cuentas.sql   (SOLO LECTURA — no cambia nada)
-- ----------------------------------------------------------------------------
-- Tablero de situación de las cuentas corrientes. Correlo cuando quieras, antes y
-- después de cada arreglo, para ver si vas para adelante.
--
-- Devuelve 6 cuadros:
--   1. Qué scripts ya se corrieron (por la marca que dejan en los movimientos)
--   2. Cómo están las cuentas, por tipo de cliente
--   3. Los clientes Común que quedan DEBIENDO (la lista para cobranzas)
--   4. Los clientes Común que quedan A FAVOR (no deberían tener)
--   5. Las familias de problemas que quedan, con su tamaño
--   6. Los 20 documentos que más descuadran
--
-- La regla de oro: un cliente Común paga y se va, así que su cuenta debería estar
-- en CERO. Semanales y rollo adelantado sí pueden tener saldo a favor.
-- ============================================================================

-- ── 1 · QUÉ SE CORRIÓ ──────────────────────────────────────────────────────
SELECT Cuadro = '1 · scripts aplicados', Marca = 'FIX_CARGO_DUPLICADO (los 19 de julio)',
       Movimientos = COUNT(*) FROM dbo.MovimientosCuenta WHERE MovObservaciones LIKE '%FIX_CARGO_DUPLICADO%'
UNION ALL SELECT '1 · scripts aplicados', 'FIX_MONEDA (pesos en cuentas de dólares)', COUNT(*)
       FROM dbo.MovimientosCuenta WHERE MovObservaciones LIKE '%FIX_MONEDA_2026-09-01%'
UNION ALL SELECT '1 · scripts aplicados', 'FIX_COBRO (cobro a la cuenta del cargo)', COUNT(*)
       FROM dbo.MovimientosCuenta WHERE MovObservaciones LIKE '%FIX_COBRO_2026-09-01%'
UNION ALL SELECT '1 · scripts aplicados', 'FIX_COBRO_PARTIDO (documentos partidos)', COUNT(*)
       FROM dbo.MovimientosCuenta WHERE MovObservaciones LIKE '%FIX_COBRO_PARTIDO%'
UNION ALL SELECT '1 · scripts aplicados', 'FIX_CRUCE (cruces revertidos)', COUNT(*)
       FROM dbo.MovimientosCuenta WHERE MovObservaciones LIKE '%FIX_CRUCE%'
UNION ALL SELECT '1 · scripts aplicados', 'FIX_CLIENTE (arreglos de a uno)', COUNT(*)
       FROM dbo.MovimientosCuenta WHERE MovObservaciones LIKE '%FIX_CLIENTE_%';

-- ── 2 · CÓMO ESTÁN LAS CUENTAS ─────────────────────────────────────────────
SELECT Cuadro = '2 · estado de las cuentas',
       Tipo = CASE ISNULL(cl.TClIdTipoCliente,0) WHEN 1 THEN 'Comun' WHEN 2 THEN 'Semanal'
                   WHEN 3 THEN 'Rollo adelantado' WHEN 4 THEN 'Deudor' ELSE 'Sin tipo' END,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' WHEN cc.MonIdMoneda = 1 THEN '$'
                     WHEN cc.CueTipo = 'DINERO_USD' THEN 'US$' ELSE '$' END,
       EnCero   = SUM(CASE WHEN ABS(s.Saldo) < 1 THEN 1 ELSE 0 END),
       Debiendo = SUM(CASE WHEN s.Saldo < -1 THEN 1 ELSE 0 END),
       AFavor   = SUM(CASE WHEN s.Saldo > 1 THEN 1 ELSE 0 END),
       TotalDebe   = SUM(CASE WHEN s.Saldo < -1 THEN -s.Saldo ELSE 0 END),
       TotalAFavor = SUM(CASE WHEN s.Saldo > 1 THEN s.Saldo ELSE 0 END)
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueTipo LIKE 'DINERO%' AND cc.CueActiva = 1
GROUP BY CASE ISNULL(cl.TClIdTipoCliente,0) WHEN 1 THEN 'Comun' WHEN 2 THEN 'Semanal'
              WHEN 3 THEN 'Rollo adelantado' WHEN 4 THEN 'Deudor' ELSE 'Sin tipo' END,
         CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' WHEN cc.MonIdMoneda = 1 THEN '$'
              WHEN cc.CueTipo = 'DINERO_USD' THEN 'US$' ELSE '$' END
ORDER BY 2, 3;

-- ── 3 · CLIENTES COMÚN QUE DEBEN (la lista para cobranzas) ────────────────
SELECT TOP 40 Cuadro = '3 · Comun debiendo', Cliente = RTRIM(cl.Nombre), cl.CliIdCliente,
       cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' WHEN cc.MonIdMoneda = 1 THEN '$'
                     WHEN cc.CueTipo = 'DINERO_USD' THEN 'US$' ELSE '$' END,
       Debe = -s.Saldo
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueTipo LIKE 'DINERO%' AND cl.TClIdTipoCliente = 1 AND s.Saldo < -1
ORDER BY s.Saldo;

-- ── 4 · CLIENTES COMÚN CON SALDO A FAVOR (no deberían tener) ──────────────
SELECT TOP 40 Cuadro = '4 · Comun a favor', Cliente = RTRIM(cl.Nombre), cl.CliIdCliente,
       cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' WHEN cc.MonIdMoneda = 1 THEN '$'
                     WHEN cc.CueTipo = 'DINERO_USD' THEN 'US$' ELSE '$' END,
       AFavor = s.Saldo
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueTipo LIKE 'DINERO%' AND cl.TClIdTipoCliente = 1 AND s.Saldo > 1
ORDER BY s.Saldo DESC;

-- ── 5 · LAS FAMILIAS DE PROBLEMAS QUE QUEDAN ──────────────────────────────
;WITH Patas AS (
    SELECT m.DocIdDocumento, m.CueIdCuenta,
           Cargo = SUM(CASE WHEN m.MovImporte < 0 AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') THEN -m.MovImporte ELSE 0 END),
           Cobro = SUM(CASE WHEN m.MovImporte > 0 AND m.MovTipo = 'PAGO' THEN m.MovImporte ELSE 0 END)
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND cc.CueTipo LIKE 'DINERO%'
      AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO','PAGO')
      AND m.DocIdDocumento IS NOT NULL
    GROUP BY m.DocIdDocumento, m.CueIdCuenta
)
SELECT Cuadro = '5 · familias pendientes', Familia = 'a · documento partido: cargo en 2 cuentas y cobro en 1',
       Documentos = COUNT(DISTINCT p.DocIdDocumento), Importe = SUM(p.Cargo)
FROM Patas p
JOIN (SELECT DocIdDocumento, Ctas = SUM(CASE WHEN Cargo > 0.005 THEN 1 ELSE 0 END),
             ConCobro = SUM(CASE WHEN Cobro > 0.005 THEN 1 ELSE 0 END)
      FROM Patas GROUP BY DocIdDocumento) x ON x.DocIdDocumento = p.DocIdDocumento
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = p.DocIdDocumento
WHERE p.Cargo > 0.005 AND p.Cobro <= 0.005 AND x.Ctas > 1 AND x.ConCobro > 0
  AND ISNULL(d.DocEstado,'') <> 'ANULADO'
UNION ALL
SELECT '5 · familias pendientes', 'b · cargo duplicado (2 movimientos iguales)',
       COUNT(*), SUM(q.Cargo)
FROM (SELECT m.DocIdDocumento, Cargo = MIN(-m.MovImporte)
      FROM dbo.MovimientosCuenta m
      JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
      WHERE m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') AND m.MovImporte < 0
        AND (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND ISNULL(d.DocEstado,'') <> 'ANULADO'
      GROUP BY m.DocIdDocumento
      HAVING COUNT(*) = 2 AND MIN(m.MovImporte) = MAX(m.MovImporte)
         AND COUNT(DISTINCT m.CueIdCuenta) = 1) q
UNION ALL
SELECT '5 · familias pendientes', 'c · documento sin ningún cargo en el libro',
       COUNT(*), SUM(d.DocTotal)
FROM dbo.DocumentosContables d
WHERE ISNULL(d.DocEstado,'') <> 'ANULADO' AND d.DocTotal > 1
  AND RTRIM(d.DocTipo) NOT LIKE '%ecibo%' AND RTRIM(d.DocTipo) NOT LIKE '%greso%'
  AND RTRIM(d.DocTipo) NOT LIKE '%Nota%'  AND RTRIM(d.DocTipo) NOT LIKE '%NOTA%'
  AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                  WHERE m.DocIdDocumento = d.DocIdDocumento
                    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                    AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') AND m.MovImporte < 0)
UNION ALL
SELECT '5 · familias pendientes', 'd · cobro en pesos dentro de una cuenta en dólares',
       COUNT(*), SUM(m.MovImporte)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND m.MovTipo = 'PAGO' AND m.MovImporte > 0
  AND cc.MonIdMoneda <> d.MonIdMoneda AND ABS(m.MovImporte - d.DocTotal) < 0.02;

-- ── 6 · LOS 20 DOCUMENTOS QUE MÁS DESCUADRAN ──────────────────────────────
SELECT TOP 20 Cuadro = '6 · peores documentos',
       Cliente = RTRIM(cl.Nombre), Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Tipo = CASE ISNULL(cl.TClIdTipoCliente,0) WHEN 1 THEN 'Comun' WHEN 2 THEN 'Semanal'
                   WHEN 3 THEN 'Rollo' WHEN 4 THEN 'Deudor' ELSE 'Sin tipo' END,
       d.DocFechaEmision, d.DocTotal,
       Cargos = SUM(CASE WHEN m.MovImporte < 0 THEN m.MovImporte ELSE 0 END),
       Cobros = SUM(CASE WHEN m.MovImporte > 0 THEN m.MovImporte ELSE 0 END),
       Neto   = SUM(m.MovImporte)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
JOIN dbo.Clientes cl ON cl.CliIdCliente = d.CliIdCliente
WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND cc.CueTipo LIKE 'DINERO%'
  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
  AND ISNULL(d.DocEstado,'') <> 'ANULADO'
GROUP BY cl.Nombre, cl.TClIdTipoCliente, d.DocSerie, d.DocNumero, d.DocFechaEmision, d.DocTotal
HAVING ABS(SUM(m.MovImporte)) > 1
ORDER BY ABS(SUM(m.MovImporte)) DESC;

-- ============================================================================
-- diag_cuentas_sin_principal.sql            SOLO LECTURA — no modifica nada
-- ============================================================================
-- Problema: hay cuentas de DINERO que nacieron con CueEsPrincipal = 0. Como el
-- sistema trata a toda cuenta de dinero NO principal como una billetera prepaga,
-- las órdenes, facturas y deudas de ese cliente caen adentro de una bolsa que
-- está en cero, y la dejan en negativo sin que nadie haya gastado plata.
--
-- El arreglo del código ya está en el repo (obtenerOCrearCuenta en
-- backend/services/contabilidadService.js, commit c58674d del 2-sep-2026), pero
-- mientras producción no lo tenga desplegado se siguen creando cuentas rotas.
--
-- Este script solo MIRA. La reparación va en fix_cuentas_sin_principal.sql.
-- ============================================================================

SET NOCOUNT ON;

PRINT '=== 1. Cuentas de DINERO que nacieron sin ser principal, por día de alta ===';
SELECT   CONVERT(varchar(10), cc.CueFechaAlta, 120) AS DiaAlta,
         COUNT(*)                                   AS Cuentas,
         SUM(CASE WHEN cc.CueNombre IS NULL THEN 1 ELSE 0 END) AS SinNombre,
         MIN(cc.CueIdCuenta)                        AS DesdeId,
         MAX(cc.CueIdCuenta)                        AS HastaId
FROM     dbo.CuentasCliente cc WITH(NOLOCK)
WHERE    cc.CueActiva = 1
  AND    cc.CueTipo LIKE 'DINERO%'
  AND    ISNULL(cc.CueEsPrincipal, 0) = 0
  AND    ISNULL(RTRIM(cc.CueNombre), '') NOT IN ('BILLETERA UY', 'BILLETERA USD')
GROUP BY CONVERT(varchar(10), cc.CueFechaAlta, 120)
ORDER BY 1 DESC;

PRINT '';
PRINT '=== 2. Las que la reparación va a corregir (una por una) ===';
-- Misma condición EXACTA que usa fix_cuentas_sin_principal.sql:
--   cuenta de dinero, sin nombre (no es una BILLETERA de verdad), no restringida,
--   no principal, y el cliente NO tiene principal DE ESA MISMA MONEDA.
SELECT   cc.CueIdCuenta                       AS Cuenta,
         RTRIM(c.Nombre)                      AS Cliente,
         RTRIM(c.IDCliente)                   AS IDCliente,
         cc.CueTipo                           AS Tipo,
         CONVERT(varchar(10), cc.CueFechaAlta, 120) AS Alta,
         CAST(cc.CueSaldoActual AS DECIMAL(18,2))   AS SaldoColumna,
         CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                      WHERE m.CueIdCuenta = cc.CueIdCuenta
                        AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
              AS DECIMAL(18,2))               AS SaldoLibro,
         (SELECT COUNT(*) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
          WHERE m.CueIdCuenta = cc.CueIdCuenta) AS Movimientos
FROM     dbo.CuentasCliente cc WITH(NOLOCK)
JOIN     dbo.Clientes       c  WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE    cc.CueActiva = 1
  AND    cc.CueTipo LIKE 'DINERO%'
  AND    ISNULL(cc.CueEsPrincipal, 0) = 0
  AND    cc.CueNombre IS NULL
  AND    ISNULL(cc.CueRestringida, 0) = 0
  AND    NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente p WITH(NOLOCK)
                     WHERE p.CliIdCliente = cc.CliIdCliente
                       AND p.CueIdCuenta <> cc.CueIdCuenta
                       AND p.CueActiva    = 1
                       AND p.CueTipo      = cc.CueTipo
                       AND ISNULL(p.CueEsPrincipal, 0) = 1)
ORDER BY cc.CueFechaAlta DESC, cc.CueIdCuenta;

PRINT '';
PRINT '=== 3. Movimientos ORDEN que cayeron en una cuenta NO principal, por día ===';
-- Si hay filas con fecha POSTERIOR al deploy del commit c58674d, el problema
-- sigue vivo y el trigger todavía hace falta.
SELECT   CONVERT(varchar(10), m.MovFecha, 120) AS Dia,
         COUNT(*)                              AS MovimientosOrden,
         COUNT(DISTINCT m.CueIdCuenta)         AS Cuentas,
         CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) AS Importe
FROM     dbo.MovimientosCuenta m  WITH(NOLOCK)
JOIN     dbo.CuentasCliente    cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
WHERE    m.MovTipo = 'ORDEN'
  AND    (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND    cc.CueTipo LIKE 'DINERO%'
  AND    ISNULL(cc.CueEsPrincipal, 0) = 0
GROUP BY CONVERT(varchar(10), m.MovFecha, 120)
ORDER BY 1 DESC;

PRINT '';
PRINT '=== 4. CONTROL: las billeteras de verdad NO se tocan ===';
SELECT   ISNULL(RTRIM(cc.CueNombre), '(sin nombre)') AS Nombre,
         COUNT(*)                                    AS Cuentas,
         SUM(CASE WHEN cc.CueSaldoActual < 0 THEN 1 ELSE 0 END) AS EnNegativo
FROM     dbo.CuentasCliente cc WITH(NOLOCK)
WHERE    cc.CueActiva = 1 AND cc.CueTipo LIKE 'DINERO%'
  AND    ISNULL(cc.CueEsPrincipal, 0) = 0
GROUP BY ISNULL(RTRIM(cc.CueNombre), '(sin nombre)')
ORDER BY COUNT(*) DESC;

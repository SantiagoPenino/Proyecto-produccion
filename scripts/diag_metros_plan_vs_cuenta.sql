/* ============================================================================
   DIAGNÓSTICO — METROS (rollo por adelantado): el plan y la cuenta no cierran.
   SOLO LECTURA. No modifica nada. Correr en PRODUCCIÓN.

   Caso testigo: Támara flores (TF SPORT) — Dry Microporoso 1.83, plan #145.
   La barra del plan dice 89,62 mts restantes y la cuenta dice 34,98 mts.

   Origen (validado en local, 31-ago-2026):
     - Cuando un consumo excede el plan, el movimiento se registra completo en la
       CUENTA pero PlaCantidadUsada queda topeado en PlaCantidadTotal
       (hookEntregaMetros bloque "3a" y consumirRecursoAdelantado). El plan cierra
       en "restante 0" y la deuda de metros vive solo en la cuenta.
     - El plan siguiente arrancaba de cero e ignoraba ese arrastre: solo crearPlan
       heredaba el sobregiro; recargarPlan y la venta de rollo desde caja no.
     - El motor de cobertura decide sobre el PLAN, no sobre la cuenta: sigue
       entregando metros que el cliente ya consumió.

   Las cuentas de DINERO se diagnostican aparte, en
   scripts/diag_cuentas_dinero_descuadre.sql
   ============================================================================ */

DECLARE @Cli INT;
SELECT @Cli = CliIdCliente FROM dbo.Clientes WHERE RTRIM(IDCliente) = 'TF SPORT';
SELECT @Cli AS CliIdCliente;   -- si sale NULL, ajustar el IDCliente de arriba

/* ── 0) RESUMEN EJECUTIVO — 1 sola fila ───────────────────────────────────
   Es el bloque que conviene mirar primero: dice de un vistazo cuántas cuentas
   de metros están descuadradas, para qué lado y por cuánto.
     Infladas    = el plan muestra metros YA consumidos (se los regala al cliente)
     Atascadas   = hay metros comprados que ningún plan activo muestra
     SinMovs     = cuentas con saldo pero sin un solo movimiento (saldo escrito a mano) */
SELECT
    COUNT(*)                                                   AS CuentasDescuadradas,
    SUM(CASE WHEN d.Dif > 0 THEN 1 ELSE 0 END)                 AS Infladas,
    ROUND(SUM(CASE WHEN d.Dif > 0 THEN d.Dif ELSE 0 END), 2)   AS MetrosRegalados,
    SUM(CASE WHEN d.Dif < 0 THEN 1 ELSE 0 END)                 AS Atascadas,
    ROUND(SUM(CASE WHEN d.Dif < 0 THEN -d.Dif ELSE 0 END), 2)  AS MetrosAtascados,
    (SELECT COUNT(*) FROM dbo.CuentasCliente cc2
      WHERE cc2.CueTipo NOT LIKE 'DINERO%'
        AND ISNULL(cc2.CueSaldoActual, 0) <> 0
        AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m2 WHERE m2.CueIdCuenta = cc2.CueIdCuenta)
    )                                                          AS SinMovs
FROM (
    SELECT ROUND(pl.RestantePlanesActivos - cc.CueSaldoActual, 4) AS Dif
    FROM dbo.CuentasCliente cc
    CROSS APPLY (
        SELECT SUM(CASE WHEN p.PlaActivo = 1 THEN p.PlaCantidadTotal - p.PlaCantidadUsada END) AS RestantePlanesActivos
        FROM dbo.PlanesMetros p WHERE p.CueIdCuenta = cc.CueIdCuenta
    ) pl
    WHERE cc.CueTipo NOT LIKE 'DINERO%'
      AND pl.RestantePlanesActivos IS NOT NULL
      AND ABS(pl.RestantePlanesActivos - cc.CueSaldoActual) > 0.01
) d;

/* ── 1) Saldo de la cuenta vs. lo que dicen los planes ────────────────────
   'Dif_MetrosInflados' = metros que la barra del plan muestra de más.
   Ese número es exactamente el que no cierra entre las dos pantallas.      */
SELECT
    cc.CueIdCuenta,
    RTRIM(a.Descripcion)                                    AS Material,
    cc.CueSaldoActual                                       AS SaldoCuenta_VERDAD,
    pl.RestantePlanesActivos                                AS RestantePlan_PANTALLA,
    ROUND(pl.RestantePlanesActivos - cc.CueSaldoActual, 4)  AS Dif_MetrosInflados,
    pl.TotalComprado, pl.TotalUsadoPlanes,
    mv.Entradas, mv.Salidas, mv.NMovs
FROM dbo.CuentasCliente cc
LEFT JOIN dbo.Articulos a ON a.ProIdProducto = cc.ProIdProducto
OUTER APPLY (
    SELECT SUM(CASE WHEN p.PlaActivo = 1 THEN p.PlaCantidadTotal - p.PlaCantidadUsada END) AS RestantePlanesActivos,
           SUM(p.PlaCantidadTotal) AS TotalComprado,
           SUM(p.PlaCantidadUsada) AS TotalUsadoPlanes
    FROM dbo.PlanesMetros p WHERE p.CueIdCuenta = cc.CueIdCuenta
) pl
OUTER APPLY (
    SELECT COUNT(*) AS NMovs,
           SUM(CASE WHEN m.MovImporte > 0 THEN m.MovImporte ELSE 0 END) AS Entradas,
           SUM(CASE WHEN m.MovImporte < 0 THEN -m.MovImporte ELSE 0 END) AS Salidas
    FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
) mv
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo NOT LIKE 'DINERO%';

/* ── 2) Qué PLAN se pasó de rosca ─────────────────────────────────────────
   SumaMovsImputados = suma de los movimientos que llevan "Plan #N" en el
   concepto/observación. Si un plan CERRADO da NEGATIVO, ahí se consumieron
   metros de más que la cuenta absorbió y el plan nunca reflejó.            */
SELECT p.PlaIdPlan, p.PlaActivo, RTRIM(a.Descripcion) AS Material,
       p.PlaCantidadTotal, p.PlaCantidadUsada,
       p.PlaCantidadTotal - p.PlaCantidadUsada AS RestanteSegunPlan,
       x.NMovs, x.SumaMovsImputados,
       ROUND(x.SumaMovsImputados - (p.PlaCantidadTotal - p.PlaCantidadUsada), 4) AS Dif,
       p.PlaFechaAlta
FROM dbo.PlanesMetros p
LEFT JOIN dbo.Articulos a ON a.ProIdProducto = p.ProIdProducto
OUTER APPLY (
    SELECT COUNT(*) AS NMovs, SUM(m.MovImporte) AS SumaMovsImputados
    FROM dbo.MovimientosCuenta m
    WHERE m.CueIdCuenta = p.CueIdCuenta
      AND (m.MovObservaciones LIKE '%Plan #' + CAST(p.PlaIdPlan AS varchar(10)) + '%'
        OR m.MovConcepto     LIKE '%Plan #' + CAST(p.PlaIdPlan AS varchar(10)) + '%'
        OR m.MovConcepto     LIKE '%(Plan '  + CAST(p.PlaIdPlan AS varchar(10)) + ')%')
) x
WHERE p.CliIdCliente = @Cli
ORDER BY p.PlaIdPlan DESC;

/* ── 3) Los movimientos de sobregiro (los que el plan nunca reflejó) ──────
   Son los que el arreglo nuevo hereda como "usado inicial" en la próxima
   carga de metros. Absorbido = ya lo heredó un plan (no se cuenta de nuevo). */
SELECT m.MovIdMovimiento, m.MovFecha, m.MovTipo, m.MovImporte, m.MovSaldoPosterior,
       m.MovConcepto, m.MovObservaciones, m.OrdIdOrden,
       CASE WHEN m.MovObservaciones LIKE '%_ABSORBIDO_PLAN_%' THEN 'SI' ELSE 'NO' END AS Absorbido
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo NOT LIKE 'DINERO%'
  AND (m.MovObservaciones LIKE 'Exceso s/ Plan #%'
    OR m.MovObservaciones LIKE '%Negativo retroactivo%Plan #%'
    OR m.MovSaldoPosterior < 0)
ORDER BY m.MovFecha DESC;

/* ── 4) ALCANCE: todos los clientes con el mismo descuadre de metros ──────
   Dif > 0  → el plan muestra metros que el cliente YA consumió (se los regala).
   Dif < 0  → hay metros comprados que ningún plan activo muestra (no los puede usar). */
SELECT
       cc.CliIdCliente, RTRIM(c.Nombre) AS Cliente, RTRIM(c.IDCliente) AS Codigo,
       cc.CueIdCuenta, RTRIM(a.Descripcion) AS Material,
       cc.CueSaldoActual AS SaldoCuenta,
       pl.RestantePlanesActivos AS RestantePlan,
       ROUND(pl.RestantePlanesActivos - cc.CueSaldoActual, 4) AS Dif_MetrosInflados,
       pl.NPlanes, pl.NPlanesActivos
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.Articulos a ON a.ProIdProducto = cc.ProIdProducto
CROSS APPLY (
    SELECT SUM(CASE WHEN p.PlaActivo = 1 THEN p.PlaCantidadTotal - p.PlaCantidadUsada END) AS RestantePlanesActivos,
           COUNT(*) AS NPlanes,
           SUM(CASE WHEN p.PlaActivo = 1 THEN 1 ELSE 0 END) AS NPlanesActivos
    FROM dbo.PlanesMetros p WHERE p.CueIdCuenta = cc.CueIdCuenta
) pl
WHERE cc.CueTipo NOT LIKE 'DINERO%'
  AND pl.RestantePlanesActivos IS NOT NULL
  AND ABS(pl.RestantePlanesActivos - cc.CueSaldoActual) > 0.01
ORDER BY ABS(pl.RestantePlanesActivos - cc.CueSaldoActual) DESC;

/* ── 5) Cuentas de metros con saldo pero SIN movimientos ──────────────────
   Acá la cuenta tampoco es confiable: el saldo se escribió directo en la
   columna sin registrar el movimiento. Hay que sanearlas ANTES de hacer que
   el motor decida sobre el saldo de la cuenta (el "fix 2").                */
SELECT cc.CueIdCuenta, cc.CliIdCliente, RTRIM(c.Nombre) AS Cliente,
       RTRIM(a.Descripcion) AS Material, cc.CueSaldoActual,
       (SELECT COUNT(*) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta) AS NMovs
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.Articulos a ON a.ProIdProducto = cc.ProIdProducto
WHERE cc.CueTipo NOT LIKE 'DINERO%'
  AND ISNULL(cc.CueSaldoActual, 0) <> 0
  AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta)
ORDER BY ABS(cc.CueSaldoActual) DESC;

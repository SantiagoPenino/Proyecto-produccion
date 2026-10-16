/* ============================================================================
   REGULARIZACIÓN MASIVA — Sobregiro de metros: alinear el PLAN con la CUENTA.
   Correr en PRODUCCIÓN. Modifica dbo.PlanesMetros (PlaCantidadUsada / PlaActivo).
   NO toca CueSaldoActual ni MovimientosCuenta: la cuenta ya tiene la verdad.

   Es el mismo arreglo que se le hizo a Támara flores (TF SPORT) el 31-ago-2026,
   aplicado a TODAS las cuentas de recursos que estén en la misma situación.
   La versión de un solo cliente es fix_sobregiro_metros_cliente.sql.

   Esperado en prod al 31-ago-2026: ~10 cuentas. Son las 13 del grupo A menos las
   dos de Támara (ya regularizadas a mano) y menos CAMILO-7008, que sale por el
   candado 4. Las del grupo B quedan afuera solas por el candado 1.

   CANDADOS (si alguno no se cumple, la cuenta se saltea sin tocarse):
     1. El libro tiene que cerrar: CueSaldoActual = SUM(MovImporte). Si no cierra,
        el saldo de la cuenta no es confiable (grupo B) y NO se puede alinear el
        plan contra él.
     2. Solo actúa cuando el plan muestra de MÁS. Si la cuenta tiene más que los
        planes, no se infla ningún plan: eso se repara caso por caso.
     3. Nunca deja PlaCantidadUsada por encima de PlaCantidadTotal.
     4. Ningún plan de la cuenta puede tener su COMPRA sin registrar en el libro:
        ahí el saldo está bajo por un bug de registro (la venta de rollo por caja
        no dejaba el movimiento de ENTRADA hasta mediados de julio), no porque el
        cliente haya consumido de más. Alinear el plan contra ese saldo le sacaría
        metros que pagó. Deja afuera a CAMILO-7008 y SubliBunker.

   OJO con la columna NoEntra del PASO 1: si es > 0, esa cuenta está en NEGATIVO
   (el cliente debe metros) y el sobregiro no entra completo en el plan. El plan
   queda en 0 y el resto se absorbe en la próxima compra de metros, ya con
   planSobregiroService.js deployado. Al 31-ago-2026 eso les pasa a MARTIN PONTI
   (debe 14,905) y a Posse Gutierrez (debe 34,5725).

   Es idempotente: correrlo dos veces no cambia nada la segunda vez.
   ============================================================================ */

SET NOCOUNT ON;

/* ── Cuentas candidatas (TODAS las del sistema) ────────────────────────── */
IF OBJECT_ID('tempdb..#objetivo') IS NOT NULL DROP TABLE #objetivo;

SELECT
    cc.CueIdCuenta,
    cc.CliIdCliente,
    RTRIM(c.Nombre)                                             AS Cliente,
    RTRIM(c.IDCliente)                                          AS Codigo,
    RTRIM(a.Descripcion)                                        AS Material,
    cc.CueSaldoActual                                           AS SaldoCuenta,
    lib.SumaMovs                                                AS SaldoLibro,
    pl.RestantePlanes,
    ROUND(pl.RestantePlanes - cc.CueSaldoActual, 4)             AS Sobregiro,
    dst.PlanDestino,
    dst.CapacidadLibre
INTO #objetivo
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.Articulos a ON a.ProIdProducto = cc.ProIdProducto
CROSS APPLY (
    SELECT ISNULL(SUM(CASE WHEN ISNULL(m.MovAnulado,0)=0 THEN m.MovImporte END), 0) AS SumaMovs
    FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
) lib
CROSS APPLY (
    -- Restante de TODOS los planes activos de la cuenta (es lo que muestra la pantalla)
    SELECT ISNULL(SUM(p.PlaCantidadTotal - p.PlaCantidadUsada), 0) AS RestantePlanes
    FROM dbo.PlanesMetros p WHERE p.CueIdCuenta = cc.CueIdCuenta AND p.PlaActivo = 1
) pl
OUTER APPLY (
    -- El sobregiro se carga al plan activo MÁS NUEVO, hasta lo que le quede libre
    SELECT TOP 1 p2.PlaIdPlan AS PlanDestino,
           p2.PlaCantidadTotal - p2.PlaCantidadUsada AS CapacidadLibre
    FROM dbo.PlanesMetros p2
    WHERE p2.CueIdCuenta = cc.CueIdCuenta AND p2.PlaActivo = 1
    ORDER BY p2.PlaIdPlan DESC
) dst
WHERE cc.CueTipo NOT LIKE 'DINERO%'
  AND dst.PlanDestino IS NOT NULL                                   -- tiene plan activo
  AND ABS(cc.CueSaldoActual - lib.SumaMovs) < 0.005                 -- candado 1: el libro cierra
  AND ROUND(pl.RestantePlanes - cc.CueSaldoActual, 4) > 0.01        -- candado 2: el plan muestra de más
  -- candado 4: ningún plan de la cuenta puede tener su COMPRA sin registrar en el
  -- libro. Si falta la ENTRADA, el saldo de la cuenta está BAJO por un bug de
  -- registro (no porque el cliente haya consumido de más) y alinear el plan
  -- contra él le sacaría metros que sí pagó. En prod al 31-ago-2026 esto deja
  -- afuera a CAMILO-7008 (le falta registrar una compra de 51,55) y a
  -- SubliBunker (0,41). Se ven en el BLOQUE 2 de
  -- diag_metros_grupoB_saldo_sin_respaldo.sql.
  AND NOT EXISTS (
      SELECT 1
      FROM dbo.PlanesMetros p3
      CROSS APPLY (
          SELECT ISNULL(SUM(m3.MovImporte), 0) AS SumaEntradas
          FROM dbo.MovimientosCuenta m3
          WHERE m3.CueIdCuenta = p3.CueIdCuenta
            AND m3.MovImporte > 0
            AND (m3.MovObservaciones LIKE '%Plan #' + CAST(p3.PlaIdPlan AS varchar(10)) + '%'
              OR m3.MovConcepto     LIKE '%plan #' + CAST(p3.PlaIdPlan AS varchar(10)) + '%')
      ) e3
      WHERE p3.CueIdCuenta = cc.CueIdCuenta
        AND p3.PlaCantidadTotal - e3.SumaEntradas > 0.01
  );

/* ── PASO 1 · ANTES — revisar ESTO antes de dejar correr el PASO 2 ─────── */
SELECT 'ANTES' AS Paso, o.*,
       CASE WHEN o.Sobregiro > o.CapacidadLibre
            THEN ROUND(o.Sobregiro - o.CapacidadLibre, 4) ELSE 0 END AS NoEntra
FROM #objetivo o ORDER BY o.Sobregiro DESC;

SELECT 'TOTALES' AS Paso,
       COUNT(*)                                                                     AS Cuentas,
       ROUND(SUM(o.Sobregiro), 4)                                                   AS SobregiroTotal,
       ROUND(SUM(CASE WHEN o.Sobregiro > o.CapacidadLibre THEN o.CapacidadLibre ELSE o.Sobregiro END), 4) AS SeAbsorbeAhora,
       ROUND(SUM(CASE WHEN o.Sobregiro > o.CapacidadLibre THEN o.Sobregiro - o.CapacidadLibre ELSE 0 END), 4) AS QuedaPendiente
FROM #objetivo o;

/* ── PASO 2 · APLICAR ──────────────────────────────────────────────────── */
BEGIN TRANSACTION;

UPDATE p
SET p.PlaCantidadUsada = p.PlaCantidadUsada
                       + CASE WHEN o.Sobregiro > o.CapacidadLibre THEN o.CapacidadLibre ELSE o.Sobregiro END,
    p.PlaActivo = CASE WHEN p.PlaCantidadUsada
                          + CASE WHEN o.Sobregiro > o.CapacidadLibre THEN o.CapacidadLibre ELSE o.Sobregiro END
                          >= p.PlaCantidadTotal THEN 0 ELSE 1 END,
    p.PlaObservaciones = LEFT(ISNULL(p.PlaObservaciones + ' | ', '')
        + 'Regularizado 31-ago-2026: +'
        + CONVERT(varchar(20), CAST(CASE WHEN o.Sobregiro > o.CapacidadLibre THEN o.CapacidadLibre ELSE o.Sobregiro END AS decimal(18,4)))
        + ' usados por sobregiro de planes anteriores (el saldo de la cuenta no se tocó).', 500)
FROM dbo.PlanesMetros p
JOIN #objetivo o ON o.PlanDestino = p.PlaIdPlan;

/* Si el PASO 1 mostró algo raro: ROLLBACK TRANSACTION; */
COMMIT TRANSACTION;

/* ── PASO 3 · DESPUÉS — Dif_DebeSerCero tiene que dar 0 ────────────────── */
SELECT 'DESPUES' AS Paso,
       o.CueIdCuenta, o.Cliente, o.Material,
       cc.CueSaldoActual                                        AS SaldoCuenta,
       pl.RestantePlanes,
       ROUND(pl.RestantePlanes - cc.CueSaldoActual, 4)          AS Dif_DebeSerCero,
       CASE WHEN ROUND(pl.RestantePlanes - cc.CueSaldoActual, 4) > 0.01
            THEN 'Cuenta en negativo: el cliente debe metros, se absorbe en su próxima compra'
            ELSE 'OK' END                                       AS Nota
FROM #objetivo o
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = o.CueIdCuenta
CROSS APPLY (
    SELECT ISNULL(SUM(CASE WHEN p.PlaActivo = 1 THEN p.PlaCantidadTotal - p.PlaCantidadUsada END), 0) AS RestantePlanes
    FROM dbo.PlanesMetros p WHERE p.CueIdCuenta = cc.CueIdCuenta
) pl
ORDER BY Dif_DebeSerCero DESC;

DROP TABLE #objetivo;

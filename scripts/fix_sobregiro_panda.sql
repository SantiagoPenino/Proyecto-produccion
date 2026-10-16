/* ============================================================================
   REGULARIZACIÓN — Sobregiro de metros: alinear el PLAN con la CUENTA.
   Cliente: Panda Soluciones Empresariales (CliIdCliente 423).
   Correr en PRODUCCIÓN. Modifica dbo.PlanesMetros (PlaCantidadUsada / PlaActivo).
   NO toca CueSaldoActual ni MovimientosCuenta: la cuenta ya tiene la verdad.

   Qué hace: el plan #153 (DTF textil COMUN, cuenta 941) muestra más metros
   disponibles de los que la cuenta realmente tiene — es el arrastre que el
   plan #26 (cerrado el 1/9) nunca reflejó cuando Panda se pasó de esos metros
   antes de comprar el rollo nuevo. Le suma la diferencia a PlaCantidadUsada
   del plan activo, así la barra del plan y el saldo de la cuenta dicen lo
   mismo y el motor de cobertura deja de entregar metros ya gastados.

   Validado en la réplica LOCAL el 09-sep-2026 (con BEGIN TRAN/ROLLBACK propio,
   no quedó nada escrito): sobregiro 23,67, entra completo en el plan #153
   (capacidad libre 64,39), después de aplicar el plan y la cuenta cierran en
   el mismo número (Dif_DebeSerCero = 0). En prod el número puede variar
   levemente si hubo más movimientos entre el 4/9 y que corras esto — el
   script calcula todo en vivo, no usa los valores de acá.

   CANDADOS (si alguno no se cumple, esa cuenta se saltea sin tocarse):
     1. El libro tiene que cerrar: CueSaldoActual = SUM(MovImporte). Si no
        cierra, el saldo de la cuenta no es confiable y NO se alinea el plan.
     2. Solo actúa cuando el plan muestra de MÁS (Grupo A). Si la cuenta
        tuviera más que los planes (Grupo B, como Ricardo Pino), este script
        no toca nada — ese caso se repara distinto.
     3. Nunca deja PlaCantidadUsada por encima de PlaCantidadTotal.

   Es idempotente: correrlo dos veces no cambia nada la segunda vez (después
   de la primera corrida, Sobregiro = 0 y el candado 2 ya no matchea).
   ============================================================================ */

SET NOCOUNT ON;

DECLARE @Cli INT = 423;  -- Panda Soluciones Empresariales

/* ── Cuentas candidatas ────────────────────────────────────────────────── */
IF OBJECT_ID('tempdb..#objetivo') IS NOT NULL DROP TABLE #objetivo;

SELECT
    cc.CueIdCuenta,
    RTRIM(a.Descripcion)                                        AS Material,
    cc.CueSaldoActual                                           AS SaldoCuenta,
    lib.SumaMovs                                                AS SaldoLibro,
    pl.RestantePlanes,
    ROUND(pl.RestantePlanes - cc.CueSaldoActual, 4)             AS Sobregiro,
    dst.PlanDestino,
    dst.CapacidadLibre
INTO #objetivo
FROM dbo.CuentasCliente cc
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
WHERE cc.CliIdCliente = @Cli
  AND cc.CueTipo NOT LIKE 'DINERO%'
  AND dst.PlanDestino IS NOT NULL                                    -- tiene plan activo
  AND ABS(cc.CueSaldoActual - lib.SumaMovs) < 0.005                 -- candado 1: el libro cierra
  AND ROUND(pl.RestantePlanes - cc.CueSaldoActual, 4) > 0.01;       -- candado 2: el plan muestra de más

/* ── PASO 1 · ANTES (revisar antes de aplicar) ─────────────────────────── */
SELECT 'ANTES' AS Paso, o.*,
       CASE WHEN o.Sobregiro > o.CapacidadLibre
            THEN ROUND(o.Sobregiro - o.CapacidadLibre, 4) ELSE 0 END AS NoEntra
FROM #objetivo o ORDER BY o.Sobregiro DESC;

/* ── PASO 2 · APLICAR ──────────────────────────────────────────────────── */
BEGIN TRANSACTION;

UPDATE p
SET p.PlaCantidadUsada = p.PlaCantidadUsada
                       + CASE WHEN o.Sobregiro > o.CapacidadLibre THEN o.CapacidadLibre ELSE o.Sobregiro END,
    p.PlaActivo = CASE WHEN p.PlaCantidadUsada
                          + CASE WHEN o.Sobregiro > o.CapacidadLibre THEN o.CapacidadLibre ELSE o.Sobregiro END
                          >= p.PlaCantidadTotal THEN 0 ELSE 1 END,
    p.PlaObservaciones = LEFT(ISNULL(p.PlaObservaciones + ' | ', '')
        + 'Regularizado 09-sep-2026: +'
        + CONVERT(varchar(20), CAST(CASE WHEN o.Sobregiro > o.CapacidadLibre THEN o.CapacidadLibre ELSE o.Sobregiro END AS decimal(18,4)))
        + ' usados por sobregiro de planes anteriores (el saldo de la cuenta no se tocó).', 500)
FROM dbo.PlanesMetros p
JOIN #objetivo o ON o.PlanDestino = p.PlaIdPlan;

/* Revisar el resultado del PASO 3 y recién ahí decidir.
   Si algo no cuadra: ROLLBACK TRANSACTION;                                   */
COMMIT TRANSACTION;

/* ── PASO 3 · DESPUÉS (la verificación que importa) ────────────────────── */
SELECT 'DESPUES' AS Paso,
       cc.CueIdCuenta,
       RTRIM(a.Descripcion)                                     AS Material,
       cc.CueSaldoActual                                        AS SaldoCuenta,
       pl.RestantePlanes,
       ROUND(pl.RestantePlanes - cc.CueSaldoActual, 4)          AS Dif_DebeSerCero
FROM dbo.CuentasCliente cc
LEFT JOIN dbo.Articulos a ON a.ProIdProducto = cc.ProIdProducto
CROSS APPLY (
    SELECT ISNULL(SUM(CASE WHEN p.PlaActivo = 1 THEN p.PlaCantidadTotal - p.PlaCantidadUsada END), 0) AS RestantePlanes
    FROM dbo.PlanesMetros p WHERE p.CueIdCuenta = cc.CueIdCuenta
) pl
WHERE cc.CueIdCuenta IN (SELECT CueIdCuenta FROM #objetivo)
ORDER BY cc.CueIdCuenta;

/* Detalle de los planes tocados */
SELECT 'PLANES' AS Paso, p.PlaIdPlan, p.CueIdCuenta, p.PlaCantidadTotal, p.PlaCantidadUsada,
       p.PlaCantidadTotal - p.PlaCantidadUsada AS Restante, p.PlaActivo, p.PlaObservaciones
FROM dbo.PlanesMetros p
WHERE p.PlaIdPlan IN (SELECT PlanDestino FROM #objetivo);

DROP TABLE #objetivo;

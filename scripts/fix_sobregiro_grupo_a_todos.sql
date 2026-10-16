/* ============================================================================
   REGULARIZACIÓN — Sobregiro de metros: alinear el PLAN con la CUENTA.
   TODOS los clientes en el caso "Grupo A" (el libro cierra, el plan muestra
   de más). Incluye a Panda Soluciones (fix_sobregiro_panda.sql queda de más
   si corrés este) — correr UNO SOLO de los dos, no hace falta los dos.

   Correr en PRODUCCIÓN. Modifica dbo.PlanesMetros (PlaCantidadUsada / PlaActivo).
   NO toca CueSaldoActual ni MovimientosCuenta: la cuenta ya tiene la verdad.

   09-sep-2026 — DOS CAMBIOS sobre la versión anterior:
   1. Interruptor @SoloVista (mismo estilo que transicion_rollo_negativo.sql):
      con 1 (default) NO escribe nada, solo muestra el PASO 1 y hace ROLLBACK.
      Poner en 0 recién después de revisar la vista previa.
   2. Ya NO cierra el plan (PlaActivo=0) de clientes Rollo o Semanal cuando el
      sobregiro no entra completo — para esos dos tipos el plan NUNCA se
      cierra (sigue en negativo, ver project_bug_rollo_costo_creacion_vs_cobertura_checkin).
      Bug real encontrado con Martín Ponti (Semanal): el script viejo le
      cerró el plan al llegar justo al total, se quedó sin plan activo y sus
      pedidos nuevos se le iban a cobrar en plata. Se reparó a mano con
      fix_reactivar_plan_mp1899.sql — esta versión ya no lo va a repetir.

   Detectados en la réplica LOCAL el 09-sep-2026 (10 cuentas, validado con
   BEGIN TRAN/ROLLBACK propio, no quedó nada escrito):
     MP-1899 (Martín Ponti) 66,68 · Panda Soluciones 23,67 · 211480 (Raul
     Rivero) 11,72 · 39783978 (SRL Tienda Online) 10,16 · DAB (Ploteo) 3,23 ·
     95582723 (Viola Marinsek) 1,29 · Bruzio15 (Bruno Fazio) 0,62 · Selafer
     0,51 · Fadotir 0,47 · LK-ARTS-2541 (Germán Mirasa) 0,03.
   Desde entonces también califican Rodrigo y RXD, una vez que se les
   corrigió el fantasma de la cuenta (Grupo B) y su libro pasó a cerrar.
   En prod los números pueden variar si hubo más movimientos entre el
   diagnóstico y que corras esto — el script calcula todo en vivo.

   CANDADOS (si alguno no se cumple, esa cuenta se saltea sin tocarse):
     1. El libro tiene que cerrar: CueSaldoActual = SUM(MovImporte). Si no
        cierra, el saldo de la cuenta no es confiable y NO se alinea el plan
        (ese es el caso Grupo B, tipo Ricardo Pino — se repara distinto,
        ver [[project_bug_plan_vs_cuenta_metros]]).
     2. Solo actúa cuando el plan muestra de MÁS.
     3. Nunca deja PlaCantidadUsada por encima de PlaCantidadTotal — si el
        sobregiro no entra completo, absorbe hasta el tope (columna NoEntra
        del PASO 1 te dice cuánto queda afuera). Para Común eso cierra el
        plan (correcto); para Rollo/Semanal el plan queda ACTIVO igual,
        mostrando el resto como pendiente hasta la próxima carga.

   Es idempotente: correrlo dos veces no cambia nada la segunda vez.
   ============================================================================ */

SET NOCOUNT ON;

DECLARE @SoloVista BIT = 1;   -- << 1 = solo mirar | 0 = aplicar

BEGIN TRAN;

/* ── Cuentas candidatas (TODOS los clientes) ───────────────────────────── */
IF OBJECT_ID('tempdb..#objetivo') IS NOT NULL DROP TABLE #objetivo;

SELECT
    cc.CueIdCuenta,
    c.CliIdCliente,
    RTRIM(c.IDCliente)                                          AS IDCliente,
    RTRIM(a.Descripcion)                                        AS Material,
    cc.CueSaldoActual                                           AS SaldoCuenta,
    lib.SumaMovs                                                AS SaldoLibro,
    pl.RestantePlanes,
    ROUND(pl.RestantePlanes - cc.CueSaldoActual, 4)             AS Sobregiro,
    dst.PlanDestino,
    dst.CapacidadLibre,
    CASE WHEN UPPER(ISNULL(tc.TClDescripcion,'')) LIKE '%ROLLO%'
           OR UPPER(ISNULL(tc.TClDescripcion,'')) LIKE '%SEMANAL%'
         THEN 1 ELSE 0 END                                      AS EsRolloOSemanal
INTO #objetivo
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.TiposClientes tc ON tc.TClIdTipoCliente = c.TClIdTipoCliente
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
  AND dst.PlanDestino IS NOT NULL                                    -- tiene plan activo
  AND ABS(cc.CueSaldoActual - lib.SumaMovs) < 0.005                 -- candado 1: el libro cierra
  AND ROUND(pl.RestantePlanes - cc.CueSaldoActual, 4) > 0.01;       -- candado 2: el plan muestra de más

/* ── PASO 1 · ANTES (revisar antes de aplicar) ─────────────────────────── */
SELECT 'ANTES' AS Paso, o.*,
       CASE WHEN o.Sobregiro > o.CapacidadLibre
            THEN ROUND(o.Sobregiro - o.CapacidadLibre, 4) ELSE 0 END AS NoEntra
FROM #objetivo o ORDER BY o.Sobregiro DESC;

/* ── PASO 2 · APLICAR ──────────────────────────────────────────────────── */
IF @SoloVista = 0
BEGIN
    UPDATE p
    SET p.PlaCantidadUsada = p.PlaCantidadUsada
                           + CASE WHEN o.Sobregiro > o.CapacidadLibre THEN o.CapacidadLibre ELSE o.Sobregiro END,
        -- Común: si llega al total, se cierra (correcto). Rollo/Semanal: NUNCA se cierra por esto,
        -- sigue activo aunque el sobregiro no haya entrado completo (consume en negativo).
        p.PlaActivo = CASE
                          WHEN o.EsRolloOSemanal = 1 THEN 1
                          WHEN p.PlaCantidadUsada
                               + CASE WHEN o.Sobregiro > o.CapacidadLibre THEN o.CapacidadLibre ELSE o.Sobregiro END
                               >= p.PlaCantidadTotal THEN 0
                          ELSE 1
                       END,
        p.PlaObservaciones = LEFT(ISNULL(p.PlaObservaciones + ' | ', '')
            + 'Regularizado ' + CONVERT(varchar(10), GETDATE(), 120) + ' (lote Grupo A): +'
            + CONVERT(varchar(20), CAST(CASE WHEN o.Sobregiro > o.CapacidadLibre THEN o.CapacidadLibre ELSE o.Sobregiro END AS decimal(18,4)))
            + ' usados por sobregiro de planes anteriores (el saldo de la cuenta no se tocó).', 500)
    FROM dbo.PlanesMetros p
    JOIN #objetivo o ON o.PlanDestino = p.PlaIdPlan;
    PRINT CONCAT('PASO 2: ajustados ', @@ROWCOUNT, ' plan(es).');
END
ELSE
    PRINT 'PASO 2: NO aplicado (vista previa solamente). Poner @SoloVista = 0 para aplicar.';

/* ── PASO 3 · DESPUÉS (la verificación que importa) ────────────────────── */
SELECT 'DESPUES' AS Paso,
       cc.CueIdCuenta,
       RTRIM(c.IDCliente)                                       AS IDCliente,
       RTRIM(a.Descripcion)                                     AS Material,
       cc.CueSaldoActual                                        AS SaldoCuenta,
       pl.RestantePlanes,
       ROUND(pl.RestantePlanes - cc.CueSaldoActual, 4)          AS Dif_DebeSerCero
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
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

IF @SoloVista = 1
BEGIN
    PRINT 'SOLO VISTA: no se escribió nada.';
    ROLLBACK TRAN;
END
ELSE
    COMMIT TRAN;

/* ============================================================================
   REGULARIZACIÓN — Grupo B: RodrigoFalero (CliIdCliente 2394, cuenta 1227,
   DTF textil Común). Corrige el saldo GUARDADO para que coincida con el
   LIBRO real (suma de MovimientosCuenta no anulados).

   Diagnosticado 09-sep-2026: la cuenta arrastra un fantasma de 1.020 metros
   desde una venta de julio (PC-701/PC-1953, plan #18... digo #87 — origen
   real: PC-701 no, el plan de Rodrigo es el #87, nacido con una venta de
   $4.080 el 8/7 cuyo documento quedó "Anulado" sin dejar movimiento, más
   otra venta de $4.000 anulada el mismo día que SÍ dejó un ENTRADA de 500m
   vivo). El usuario decidió: todo lo que ya está cargado en el libro vale
   tal cual, sin auditar contra el estado del documento — la fuente de
   verdad para el fix es pura y simplemente MovimientosCuenta.

   Confirmado en PROD el 09-sep-2026, 13:49: la pantalla "Estado de cuenta"
   YA calcula bien (313,3125, coincide exacto con el libro) — el bug NO
   está en el frontend/backend de visualización, está solo en el campo
   guardado CueSaldoActual (mostraba 1.333,3125 — 1.020 de más, el mismo
   número exacto que el 31-ago). Este script SOLO corrige ese campo.

   OJO: no toca PlanesMetros. Es probable que después de este fix el plan
   #87 (que sigue con su propio total inflado) muestre el cartel amarillo
   de "plan y cuenta no coinciden" — pero ahora sí lo puede resolver
   fix_sobregiro_grupo_a_todos.sql / la lógica de Grupo A, porque el libro
   de esta cuenta ya va a cerrar (candado 1 cumplido). Correr eso después
   si hace falta, no en este script.

   Calcula el saldo EN VIVO al momento de correrlo — no usa el número fijo
   313,31 de hoy, así que puede variar un poco si Rodrigo operó entre que
   se diagnosticó y que se corre esto.
   ============================================================================ */

SET NOCOUNT ON;

-- ── PASO 1 · ANTES (revisar antes de aplicar) ──────────────────────────────
SELECT 'ANTES' AS Paso,
       cc.CueIdCuenta, cc.CueSaldoActual AS SaldoGuardado,
       (SELECT ROUND(SUM(m.MovImporte),4) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0) AS SaldoLibro,
       ROUND(cc.CueSaldoActual - (SELECT SUM(m.MovImporte) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0), 4) AS Fantasma
FROM CuentasCliente cc WHERE cc.CueIdCuenta = 1227;

-- ── PASO 2 · APLICAR ────────────────────────────────────────────────────────
BEGIN TRANSACTION;

UPDATE cc
SET cc.CueSaldoActual = lib.SumaLibro
FROM CuentasCliente cc
CROSS APPLY (
    SELECT ROUND(SUM(m.MovImporte),4) AS SumaLibro
    FROM MovimientosCuenta m
    WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0
) lib
WHERE cc.CueIdCuenta = 1227;

/* Revisar el PASO 3 antes de decidir. Si algo no cuadra: ROLLBACK TRANSACTION; */
COMMIT TRANSACTION;

-- ── PASO 3 · DESPUÉS (la verificación que importa) ─────────────────────────
SELECT 'DESPUES' AS Paso,
       cc.CueIdCuenta, cc.CueSaldoActual AS SaldoGuardado,
       (SELECT ROUND(SUM(m.MovImporte),4) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0) AS SaldoLibro,
       ROUND(cc.CueSaldoActual - (SELECT SUM(m.MovImporte) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0), 4) AS Dif_DebeSerCero
FROM CuentasCliente cc WHERE cc.CueIdCuenta = 1227;

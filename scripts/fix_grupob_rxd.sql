/* ============================================================================
   REGULARIZACIÓN — Grupo B: RXD (CliIdCliente 922, cuenta 958, DTF textil
   Común, plan #35). Corrige el saldo GUARDADO para que coincida con el
   LIBRO real (suma de MovimientosCuenta no anulados).

   Diagnosticado 09-sep-2026: el plan #35 nació el 22/6 de DOS ventas
   (PC-869 $683,32 y PC-870 $1.735,03) que quedaron ANULADAS — transacción
   y documento coinciden en "Anulado" los dos casos — y NINGUNA de las dos
   dejó movimiento en el libro. El fantasma (219,85 m) es 100% ese crédito
   inicial nunca respaldado; las dos recargas posteriores (ET-2285 17/7 y
   PC-3383 19/8, ambas completas y pagadas) SÍ dejaron su ENTRADA correcta
   y sí forman parte del libro. No hace falta ninguna excepción como en
   Rodrigo — acá no hay nada cargado que discutir, el libro ya es la
   verdad completa.

   RXD tiene una SEGUNDA cuenta de metros (2411, plan #130, otro material)
   que está perfecta — plan y cuenta coinciden exacto (146,75 = 146,75).
   Este script NO la toca, es solo para la cuenta 958.

   Qué hace: CueSaldoActual de la cuenta 958 → suma real del libro (en
   vivo, al momento de correr esto). NO toca PlanesMetros — el plan #35
   va a seguir con su total inflado y probablemente muestre el cartel
   amarillo de "plan y cuenta no coinciden" después de este fix, igual que
   pasó con Rodrigo. Eso se resuelve después con
   fix_sobregiro_grupo_a_todos.sql, una vez que el libro de esta cuenta
   cierre (que va a pasar apenas se aplique este script).

   Correr en PRODUCCIÓN, en SSMS. Revisar el PASO 1 y el PASO 3.
   ============================================================================ */

SET NOCOUNT ON;

-- ── PASO 1 · ANTES ──────────────────────────────────────────────────────────
SELECT 'ANTES' AS Paso,
       cc.CueIdCuenta, cc.CueSaldoActual AS SaldoGuardado,
       (SELECT ROUND(SUM(m.MovImporte),4) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0) AS SaldoLibro,
       ROUND(cc.CueSaldoActual - (SELECT SUM(m.MovImporte) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0), 4) AS Fantasma
FROM CuentasCliente cc WHERE cc.CueIdCuenta = 958;

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
WHERE cc.CueIdCuenta = 958;

/* Revisar el PASO 3 antes de decidir. Si algo no cuadra: ROLLBACK TRANSACTION; */
COMMIT TRANSACTION;

-- ── PASO 3 · DESPUÉS (la verificación que importa) ─────────────────────────
SELECT 'DESPUES' AS Paso,
       cc.CueIdCuenta, cc.CueSaldoActual AS SaldoGuardado,
       (SELECT ROUND(SUM(m.MovImporte),4) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0) AS SaldoLibro,
       ROUND(cc.CueSaldoActual - (SELECT SUM(m.MovImporte) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0), 4) AS Dif_DebeSerCero
FROM CuentasCliente cc WHERE cc.CueIdCuenta = 958;

/* ============================================================================
   REGULARIZACIÓN — Grupo B: Le Agency / Efrain2019 (CliIdCliente 725,
   cuenta 2360, DTF textil Común, plan #124). Corrige el saldo GUARDADO
   para que coincida con el LIBRO real (suma de MovimientosCuenta no
   anulados).

   Diagnosticado 09-sep-2026: el plan #124 nació el 6/8 de ET-4160 ($198),
   que quedó ANULADA ("ANULADO POR ANULACION COMPROBANTE") y no dejó
   ningún movimiento en el libro — correcto que no tenga crédito. Las
   otras dos recargas (ET-4166 6/8 y ET-7400 3/9, ambas completas, $198 c/u)
   SÍ dejaron su ENTRADA correcta. Sin precios manuales raros ni señales de
   error — es el bug de siempre ("anular no revierte el recurso").

   Qué hace: CueSaldoActual de la cuenta 2360 → suma real del libro (en
   vivo, al momento de correr esto). NO toca PlanesMetros — el plan #124
   puede mostrar el cartel amarillo después de este fix, igual que pasó
   con Rodrigo/RXD/EMEXEM; se resuelve después con
   fix_sobregiro_grupo_a_todos.sql una vez que el libro de esta cuenta
   cierre.

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
FROM CuentasCliente cc WHERE cc.CueIdCuenta = 2360;

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
WHERE cc.CueIdCuenta = 2360;

/* Revisar el PASO 3 antes de decidir. Si algo no cuadra: ROLLBACK TRANSACTION; */
COMMIT TRANSACTION;

-- ── PASO 3 · DESPUÉS (la verificación que importa) ─────────────────────────
SELECT 'DESPUES' AS Paso,
       cc.CueIdCuenta, cc.CueSaldoActual AS SaldoGuardado,
       (SELECT ROUND(SUM(m.MovImporte),4) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0) AS SaldoLibro,
       ROUND(cc.CueSaldoActual - (SELECT SUM(m.MovImporte) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0), 4) AS Dif_DebeSerCero
FROM CuentasCliente cc WHERE cc.CueIdCuenta = 2360;

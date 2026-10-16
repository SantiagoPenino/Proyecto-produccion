/* ============================================================================
   REGULARIZACIÓN — Grupo B: EMEXEM SAS (CliIdCliente 87, cuenta 509, DTF
   textil Común). Corrige el saldo GUARDADO para que coincida con el LIBRO
   real (suma de MovimientosCuenta no anulados).

   Diagnosticado 09-sep-2026: el plan #18 nació el 18/6 de PC-701 ($2.957,46),
   venta que quedó ANULADA — transacción y documento coinciden en "Anulado",
   sin ambigüedad — y nunca dejó movimiento en el libro. El precio por metro
   de esa venta es consistente con las demás compras del cliente (~$22/m),
   sin descuentos manuales raros: es el bug de siempre ("anular no revierte
   el recurso"), no un error de ficha ni de precio como MAXIC/Mariana.
   Las otras 3 ventas del cliente (PC-173, PC-1702, FA-1077) están todas
   completas, pagadas, y con su ENTRADA correctamente logueada — no hace
   falta ninguna excepción, el libro ya es la verdad completa.

   Qué hace: CueSaldoActual de la cuenta 509 → suma real del libro (en
   vivo, al momento de correr esto). NO toca PlanesMetros — el plan #18 va
   a seguir con su total inflado y va a mostrar el cartel amarillo de
   "plan y cuenta no coinciden" después de este fix (como ya pasó con
   Rodrigo y RXD). Eso se resuelve después con
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
FROM CuentasCliente cc WHERE cc.CueIdCuenta = 509;

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
WHERE cc.CueIdCuenta = 509;

/* Revisar el PASO 3 antes de decidir. Si algo no cuadra: ROLLBACK TRANSACTION; */
COMMIT TRANSACTION;

-- ── PASO 3 · DESPUÉS (la verificación que importa) ─────────────────────────
SELECT 'DESPUES' AS Paso,
       cc.CueIdCuenta, cc.CueSaldoActual AS SaldoGuardado,
       (SELECT ROUND(SUM(m.MovImporte),4) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0) AS SaldoLibro,
       ROUND(cc.CueSaldoActual - (SELECT SUM(m.MovImporte) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0), 4) AS Dif_DebeSerCero
FROM CuentasCliente cc WHERE cc.CueIdCuenta = 509;

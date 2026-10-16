/* ============================================================================
   REGULARIZACIÓN — Grupo B: Fernando Correa / SubliBunker (CliIdCliente
   1219, cuenta 1268, DTF textil Común). Corrige el saldo GUARDADO para
   que coincida con el LIBRO real (suma de MovimientosCuenta no anulados).

   Diagnosticado 09-sep-2026: caso chico y limpio. Las dos ventas reales
   (ET-1174 plan #75, ET-3437 plan #117, $198 c/u, pagadas) están bien
   acreditadas y el consumo de cada plan cierra exacto contra su propia
   carga. La tercera venta (PC-2818, $8,12) se anuló y correctamente no
   dejó nada. La diferencia de 0,82 entre lo guardado y el libro no tiene
   ningún movimiento puntual que la explique — desvío chico y viejo. Los
   dos planes (#75 y #117) ya están cerrados, no queda ninguno activo.

   Qué hace: CueSaldoActual de la cuenta 1268 → suma real del libro (en
   vivo). No hay ningún plan activo que este fix deje pendiente para el
   Grupo A después.

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
FROM CuentasCliente cc WHERE cc.CueIdCuenta = 1268;

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
WHERE cc.CueIdCuenta = 1268;

/* Revisar el PASO 3 antes de decidir. Si algo no cuadra: ROLLBACK TRANSACTION; */
COMMIT TRANSACTION;

-- ── PASO 3 · DESPUÉS (la verificación que importa) ─────────────────────────
SELECT 'DESPUES' AS Paso,
       cc.CueIdCuenta, cc.CueSaldoActual AS SaldoGuardado,
       (SELECT ROUND(SUM(m.MovImporte),4) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0) AS SaldoLibro,
       ROUND(cc.CueSaldoActual - (SELECT SUM(m.MovImporte) FROM MovimientosCuenta m
        WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0), 4) AS Dif_DebeSerCero
FROM CuentasCliente cc WHERE cc.CueIdCuenta = 1268;

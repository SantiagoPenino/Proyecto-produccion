/* ============================================================
   GRUPO C — FACTURA INCONSISTENTE (NO correr sin decidir)
   PRODUCCIÓN | Generado 2026-07-06 | 17 documentos | 15 cuentas

   *** PELIGRO *** El header de la factura NO coincide con la suma de sus lineas. El -DocTotal puede estar mal. Definir/re-emitir la factura antes.
   Fija el importe de la línea de facturación = -DocTotal (la factura). Idempotente.
   Por defecto hace ROLLBACK. Revisá la verificación y cambiá a COMMIT para aplicar.
   ============================================================ */

SET NOCOUNT ON;
BEGIN TRANSACTION;

/* ---- 1) Corregir el importe de cada línea de facturación ---- */
-- CS Fotografia | PC-1641 | VTA_CAJA -1870 -> -2765.84  [header 2765.84 != lineas 1892]
UPDATE dbo.MovimientosCuenta SET MovImporte = -2765.84,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -2765.84 (factura PC-1641)'
WHERE MovIdMovimiento = 11801;

-- Ziba informatica -7061 | PC-1778 | VTA_CAJA -290 -> -698.2  [header 698.2 != lineas 998.2]
UPDATE dbo.MovimientosCuenta SET MovImporte = -698.2,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -698.2 (factura PC-1778)'
WHERE MovIdMovimiento = 13072;

-- 52772419 | PC-1559 | VTA_CAJA -10395 -> -10496.13  [header 10496.13 != lineas 20891.13]
UPDATE dbo.MovimientosCuenta SET MovImporte = -10496.13,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -10496.13 (factura PC-1559)'
WHERE MovIdMovimiento = 11162;

-- 52772419 | PC-1208 | VTA_CAJA -629.84 -> -710.05  [header 710.05 != lineas 3896.84]
UPDATE dbo.MovimientosCuenta SET MovImporte = -710.05,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -710.05 (factura PC-1208)'
WHERE MovIdMovimiento = 8558;

-- ATHA | PC-1558 | VTA_CAJA -5.28 -> -78.48  [header 78.48 != lineas 2990.28]
UPDATE dbo.MovimientosCuenta SET MovImporte = -78.48,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -78.48 (factura PC-1558)'
WHERE MovIdMovimiento = 11157;

-- 42394564 | PC-1274 | VTA_CAJA -87.35 -> -152.51  [header 152.51 != lineas 2747.35]
UPDATE dbo.MovimientosCuenta SET MovImporte = -152.51,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -152.51 (factura PC-1274)'
WHERE MovIdMovimiento = 9205;

-- 31493024 | PC-1678 | VTA_CAJA -15.66 -> -69.03  [header 69.03 != lineas 2193.66]
UPDATE dbo.MovimientosCuenta SET MovImporte = -69.03,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -69.03 (factura PC-1678)'
WHERE MovIdMovimiento = 12097;

-- boracsport | PC-1065 | VTA_CAJA -138.6 -> -182.37  [header 182.37 != lineas 1920.6]
UPDATE dbo.MovimientosCuenta SET MovImporte = -182.37,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -182.37 (factura PC-1065)'
WHERE MovIdMovimiento = 7653;

-- KATERIN BARIDON | PC-1129 | VTA_CAJA -21 -> -60.3  [header 60.3 != lineas 1621]
UPDATE dbo.MovimientosCuenta SET MovImporte = -60.3,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -60.3 (factura PC-1129)'
WHERE MovIdMovimiento = 7964;

-- jbc | PC-1646 | VTA_CAJA -6.82 -> -42.43  [header 42.43 != lineas 1456.82]
UPDATE dbo.MovimientosCuenta SET MovImporte = -42.43,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -42.43 (factura PC-1646)'
WHERE MovIdMovimiento = 11888;

-- sebastianvikingo | PC-1160 | VTA_CAJA -13.5 -> -47.38  [header 47.38 != lineas 1393.5]
UPDATE dbo.MovimientosCuenta SET MovImporte = -47.38,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -47.38 (factura PC-1160)'
WHERE MovIdMovimiento = 8258;

-- AyP | PC-1560 | VTA_CAJA -86.2 -> -115.33  [header 115.33 != lineas 1274.2]
UPDATE dbo.MovimientosCuenta SET MovImporte = -115.33,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -115.33 (factura PC-1560)'
WHERE MovIdMovimiento = 11165;

-- jbc | PC-1417 | VTA_CAJA -34.05 -> -47.63  [header 47.63 != lineas 586.99]
UPDATE dbo.MovimientosCuenta SET MovImporte = -47.63,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -47.63 (factura PC-1417)'
WHERE MovIdMovimiento = 10100;

-- Caroline Ferreira | PC-1235 | VTA_CAJA -77.09 -> -85.99  [header 85.99 != lineas 439.59]
UPDATE dbo.MovimientosCuenta SET MovImporte = -85.99,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -85.99 (factura PC-1235)'
WHERE MovIdMovimiento = 8760;

-- Rgbcreaciones | PC-1373 | VTA_CAJA -63.9 -> -71.18  [header 71.18 != lineas 135.08]
UPDATE dbo.MovimientosCuenta SET MovImporte = -71.18,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -71.18 (factura PC-1373)'
WHERE MovIdMovimiento = 9699;

-- Imprenta Flagma | PC-1397 | VTA_CAJA -57.28 -> -64.4  [header 64.4 != lineas 347.28]
UPDATE dbo.MovimientosCuenta SET MovImporte = -64.4,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -64.4 (factura PC-1397)'
WHERE MovIdMovimiento = 9939;

-- AyP | PC-1855 | VTA_CAJA -12.5 -> -17.35  [header 17.35 != lineas 210.5]
UPDATE dbo.MovimientosCuenta SET MovImporte = -17.35,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -17.35 (factura PC-1855)'
WHERE MovIdMovimiento = 13573;

/* ---- 2) Recomputar saldo corrido (MovSaldoPosterior) de las cuentas afectadas ---- */
;WITH ord AS (
  SELECT MovIdMovimiento,
         SUM(MovImporte) OVER (PARTITION BY CueIdCuenta ORDER BY MovFecha, MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS run
  FROM dbo.MovimientosCuenta
  WHERE CueIdCuenta IN (893,895,301,30,468,668,561,216,221,383,1044,109,302,26,63) AND (MovAnulado IS NULL OR MovAnulado = 0)
)
UPDATE m SET m.MovSaldoPosterior = ord.run
FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

/* ---- 3) Recomputar CueSaldoActual almacenado ---- */
UPDATE cc SET cc.CueSaldoActual = x.s
FROM dbo.CuentasCliente cc
JOIN (SELECT CueIdCuenta, SUM(MovImporte) s FROM dbo.MovimientosCuenta
      WHERE CueIdCuenta IN (893,895,301,30,468,668,561,216,221,383,1044,109,302,26,63) AND (MovAnulado IS NULL OR MovAnulado = 0)
      GROUP BY CueIdCuenta) x ON x.CueIdCuenta = cc.CueIdCuenta;

/* ---- 4) Verificación: saldo mostrado (sin ORDEN) por cuenta ---- */
SELECT cc.CueIdCuenta, RTRIM(cli.NombreFantasia) Cliente,
  (SELECT SUM(MovImporte) FROM dbo.MovimientosCuenta WHERE CueIdCuenta=cc.CueIdCuenta AND (MovAnulado IS NULL OR MovAnulado=0) AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) AS SaldoMostrado
FROM dbo.CuentasCliente cc JOIN dbo.Clientes cli ON cli.CliIdCliente=cc.CliIdCliente
WHERE cc.CueIdCuenta IN (893,895,301,30,468,668,561,216,221,383,1044,109,302,26,63) ORDER BY Cliente;

/* Revisá los resultados. Si están OK cambiá la línea siguiente a COMMIT. */
ROLLBACK TRANSACTION;  -- <<<< cambiar a COMMIT TRANSACTION; para aplicar

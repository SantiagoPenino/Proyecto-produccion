/* ============================================================
   GRUPO B — SUBE EL SALDO PARA IGUALAR LA FACTURA (revisar)
   PRODUCCIÓN | Generado 2026-07-06 | 22 documentos | 22 cuentas

   *** ATENCION *** Factura consistente pero el estado de cuenta debe SUBIR (agrega deuda / quita saldo a favor). Revisar caso por caso antes de COMMIT.
   Fija el importe de la línea de facturación = -DocTotal (la factura). Idempotente.
   Por defecto hace ROLLBACK. Revisá la verificación y cambiá a COMMIT para aplicar.
   ============================================================ */

SET NOCOUNT ON;
BEGIN TRANSACTION;

/* ---- 1) Corregir el importe de cada línea de facturación ---- */
-- Martín Ezequiel Silva Nolasco | PC-1659 | CIERRE_CICLO -393.78 -> -15950.56
UPDATE dbo.MovimientosCuenta SET MovImporte = -15950.56,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -15950.56 (factura PC-1659)'
WHERE MovIdMovimiento = 11923;

-- FRAN29 | PC-940 | VTA_CAJA -1930 -> -2999.46
UPDATE dbo.MovimientosCuenta SET MovImporte = -2999.46,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -2999.46 (factura PC-940)'
WHERE MovIdMovimiento = 6735;

-- Támara flores | PC-1618 | CIERRE_CICLO -1828.23 -> -2771.64
UPDATE dbo.MovimientosCuenta SET MovImporte = -2771.64,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -2771.64 (factura PC-1618)'
WHERE MovIdMovimiento = 11600;

-- De Zuasnabar Aquino Adrian Gaston | PC-1061 | CIERRE_CICLO -670 -> -1050
UPDATE dbo.MovimientosCuenta SET MovImporte = -1050,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -1050 (factura PC-1061)'
WHERE MovIdMovimiento = 7625;

-- 52772419 | PC-50 | VTA_CAJA -484.85 -> -796.62
UPDATE dbo.MovimientosCuenta SET MovImporte = -796.62,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -796.62 (factura PC-50)'
WHERE MovIdMovimiento = 532;

-- 48587911 | PC-319 | VTA_CAJA -14.36 -> -199.17
UPDATE dbo.MovimientosCuenta SET MovImporte = -199.17,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -199.17 (factura PC-319)'
WHERE MovIdMovimiento = 2305;

-- MARTIN PONTI | PC-1498 | CIERRE_CICLO -100.46 -> -267
UPDATE dbo.MovimientosCuenta SET MovImporte = -267,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -267 (factura PC-1498)'
WHERE MovIdMovimiento = 10804;

-- Favio Curbelo | PC-1462 | CIERRE_CICLO -46.86 -> -147.3
UPDATE dbo.MovimientosCuenta SET MovImporte = -147.3,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -147.3 (factura PC-1462)'
WHERE MovIdMovimiento = 10353;

-- 31493024 | PC-571 | VTA_CAJA -31.24 -> -87.09
UPDATE dbo.MovimientosCuenta SET MovImporte = -87.09,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -87.09 (factura PC-571)'
WHERE MovIdMovimiento = 3965;

-- LEROYLEROY | PC-1052 | VTA_CAJA -28.6 -> -69.13
UPDATE dbo.MovimientosCuenta SET MovImporte = -69.13,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -69.13 (factura PC-1052)'
WHERE MovIdMovimiento = 7574;

-- Tony | PC-493 | VTA_CAJA -15.38 -> -47.76
UPDATE dbo.MovimientosCuenta SET MovImporte = -47.76,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -47.76 (factura PC-493)'
WHERE MovIdMovimiento = 3592;

-- Cyberock | PC-684 | VTA_CAJA -31.25 -> -55.65
UPDATE dbo.MovimientosCuenta SET MovImporte = -55.65,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -55.65 (factura PC-684)'
WHERE MovIdMovimiento = 4800;

-- Leticia Núñez | PC-793 | VTA_CAJA -12.65 -> -36.73
UPDATE dbo.MovimientosCuenta SET MovImporte = -36.73,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -36.73 (factura PC-793)'
WHERE MovIdMovimiento = 5418;

-- Auri  Coty | PC-394 | VTA_CAJA -31.92 -> -55.86
UPDATE dbo.MovimientosCuenta SET MovImporte = -55.86,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -55.86 (factura PC-394)'
WHERE MovIdMovimiento = 2949;

-- INDIG0925 | PC-823 | VTA_CAJA -69.4 -> -89.55
UPDATE dbo.MovimientosCuenta SET MovImporte = -89.55,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -89.55 (factura PC-823)'
WHERE MovIdMovimiento = 5671;

-- sonia | PC-288 | VTA_CAJA -9.46 -> -21.37
UPDATE dbo.MovimientosCuenta SET MovImporte = -21.37,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -21.37 (factura PC-288)'
WHERE MovIdMovimiento = 1999;

-- jbc | PC-216 | VTA_CAJA -23.5 -> -30.55
UPDATE dbo.MovimientosCuenta SET MovImporte = -30.55,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -30.55 (factura PC-216)'
WHERE MovIdMovimiento = 1677;

-- KAYRA | PC-568 | VTA_CAJA -11 -> -15.66
UPDATE dbo.MovimientosCuenta SET MovImporte = -15.66,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -15.66 (factura PC-568)'
WHERE MovIdMovimiento = 3928;

-- Gustavo Casas Ana Gourgues | PC-1512 | CIERRE_CICLO -121.55 -> -124.82
UPDATE dbo.MovimientosCuenta SET MovImporte = -124.82,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -124.82 (factura PC-1512)'
WHERE MovIdMovimiento = 10888;

-- Redentor | PC-136 | VTA_CAJA -76.04 -> -78.14
UPDATE dbo.MovimientosCuenta SET MovImporte = -78.14,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -78.14 (factura PC-136)'
WHERE MovIdMovimiento = 1033;

-- ANGEL CARBALLO | PC-1608 | CIERRE_CICLO -70 -> -71.27
UPDATE dbo.MovimientosCuenta SET MovImporte = -71.27,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -71.27 (factura PC-1608)'
WHERE MovIdMovimiento = 11555;

-- Dgt | PC-987 | VTA_CAJA -2.16 -> -2.27
UPDATE dbo.MovimientosCuenta SET MovImporte = -2.27,
  MovObservaciones = N'FIX_SALDO_2026-07-06: importe corregido a -2.27 (factura PC-987)'
WHERE MovIdMovimiento = 7057;

/* ---- 2) Recomputar saldo corrido (MovSaldoPosterior) de las cuentas afectadas ---- */
;WITH ord AS (
  SELECT MovIdMovimiento,
         SUM(MovImporte) OVER (PARTITION BY CueIdCuenta ORDER BY MovFecha, MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS run
  FROM dbo.MovimientosCuenta
  WHERE CueIdCuenta IN (457,898,68,925,30,27,308,472,561,199,248,357,854,69,721,172,383,559,140,424,702,79) AND (MovAnulado IS NULL OR MovAnulado = 0)
)
UPDATE m SET m.MovSaldoPosterior = ord.run
FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

/* ---- 3) Recomputar CueSaldoActual almacenado ---- */
UPDATE cc SET cc.CueSaldoActual = x.s
FROM dbo.CuentasCliente cc
JOIN (SELECT CueIdCuenta, SUM(MovImporte) s FROM dbo.MovimientosCuenta
      WHERE CueIdCuenta IN (457,898,68,925,30,27,308,472,561,199,248,357,854,69,721,172,383,559,140,424,702,79) AND (MovAnulado IS NULL OR MovAnulado = 0)
      GROUP BY CueIdCuenta) x ON x.CueIdCuenta = cc.CueIdCuenta;

/* ---- 4) Verificación: saldo mostrado (sin ORDEN) por cuenta ---- */
SELECT cc.CueIdCuenta, RTRIM(cli.NombreFantasia) Cliente,
  (SELECT SUM(MovImporte) FROM dbo.MovimientosCuenta WHERE CueIdCuenta=cc.CueIdCuenta AND (MovAnulado IS NULL OR MovAnulado=0) AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) AS SaldoMostrado
FROM dbo.CuentasCliente cc JOIN dbo.Clientes cli ON cli.CliIdCliente=cc.CliIdCliente
WHERE cc.CueIdCuenta IN (457,898,68,925,30,27,308,472,561,199,248,357,854,69,721,172,383,559,140,424,702,79) ORDER BY Cliente;

/* Revisá los resultados. Si están OK cambiá la línea siguiente a COMMIT. */
ROLLBACK TRANSACTION;  -- <<<< cambiar a COMMIT TRANSACTION; para aplicar

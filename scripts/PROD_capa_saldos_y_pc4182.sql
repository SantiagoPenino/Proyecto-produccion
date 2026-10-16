-- ============================================================================
-- PROD_capa_saldos_y_pc4182.sql
-- ----------------------------------------------------------------------------
-- CAPA Indumentaria Deportiva (cliente 854).
--
-- Los dos Pedidos Caja del 11/09 estan BIEN: el cargo entro y la deuda se
-- cubrio con el saldo a favor que el cliente ya tenia. No hay que tocarlos.
--
-- Quedan dos cosas sueltas:
--
--   (A) La columna CueSaldoActual de sus cuentas de dinero esta podrida.
--       La cuenta en US$ dice 10.305,61 A FAVOR cuando el libro dice que
--       DEBE 36,68. Ese numero falso es municion para el motor de cruce
--       automatico, que en produccion todavia lee la columna y no el libro.
--       Aca la recalculamos desde el libro, igual que hace el codigo nuevo.
--       Solo cuentas de DINERO: las de METROS usan la misma columna para
--       guardar metros y NO se tocan.
--
--   (B) El PC-4182 quedo con DocPagado = 0 aunque su deuda esta COBRADO y
--       pendiente 0. Paso porque lo crearon contado, se anulo la caja y se
--       paso a credito. Lo dejamos en 1 para que la bandeja no lo muestre
--       como impago.
--
-- Corre en una transaccion. Si algo no cuadra, hace ROLLBACK solo.
--
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Cli INT = 854;
DECLARE @DocPC4182 INT = 12006;

-- ---------------------------------------------------------------- ANTES ----
SELECT Momento = 'ANTES', cc.CueIdCuenta, cc.CueTipo,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       ColumnaGuardada = CAST(cc.CueSaldoActual AS DECIMAL(18,2)),
       SaldoDelLibro = CAST(lib.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte)
                                    FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) lib
WHERE cc.CliIdCliente = @Cli
ORDER BY cc.CueTipo, cc.CueIdCuenta;

BEGIN TRANSACTION;

-- ------------------------------------------- (A) recalcular la columna ----
UPDATE cc
   SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte)
                                   FROM dbo.MovimientosCuenta m
                                   WHERE m.CueIdCuenta = cc.CueIdCuenta
                                     AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                     AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
FROM dbo.CuentasCliente cc
WHERE cc.CliIdCliente = @Cli
  AND cc.CueTipo IN ('DINERO','DINERO_UYU','DINERO_USD');

DECLARE @Cuentas INT = @@ROWCOUNT;

-- -------------------------------------------- (B) PC-4182 a DocPagado ----
-- Solo si su deuda esta realmente saldada. Si no, no lo toca.
UPDATE d
   SET d.DocPagado = 1
FROM dbo.DocumentosContables d
WHERE d.DocIdDocumento = @DocPC4182
  AND d.CliIdCliente = @Cli
  AND ISNULL(d.DocPagado, 0) = 0
  AND EXISTS (SELECT 1 FROM dbo.DeudaDocumento dd
              WHERE dd.DocIdDocumento = d.DocIdDocumento
                AND dd.DDeEstado = 'COBRADO'
                AND ISNULL(dd.DDeImportePendiente, 0) <= 0.005);

DECLARE @Docs INT = @@ROWCOUNT;

-- ------------------------------------------------------------ CONTROL ----
DECLARE @Descuadre INT = (
    SELECT COUNT(*)
    FROM dbo.CuentasCliente cc
    WHERE cc.CliIdCliente = @Cli
      AND cc.CueTipo IN ('DINERO','DINERO_UYU','DINERO_USD')
      AND ABS(ISNULL(cc.CueSaldoActual,0) - ISNULL((SELECT SUM(m.MovImporte)
              FROM dbo.MovimientosCuenta m
              WHERE m.CueIdCuenta = cc.CueIdCuenta
                AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) > 0.01);

IF @Descuadre > 0
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR('ROLLBACK: quedaron %d cuentas de dinero sin cuadrar con el libro. No se cambio nada.', 16, 1, @Descuadre);
    RETURN;
END

COMMIT TRANSACTION;

PRINT 'LISTO. Cuentas de dinero recalculadas: ' + CONVERT(VARCHAR(10), @Cuentas)
    + ' | PC-4182 marcado pagado: ' + CONVERT(VARCHAR(10), @Docs);

-- --------------------------------------------------------------- DESPUES --
SELECT Momento = 'DESPUES', cc.CueIdCuenta, cc.CueTipo,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       ColumnaGuardada = CAST(cc.CueSaldoActual AS DECIMAL(18,2)),
       SaldoDelLibro = CAST(lib.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte)
                                    FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) lib
WHERE cc.CliIdCliente = @Cli
ORDER BY cc.CueTipo, cc.CueIdCuenta;

SELECT Momento = 'DESPUES - LOS DOS PC',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Total = CAST(d.DocTotal AS DECIMAL(18,2)), d.DocPagado,
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)), dd.DDeEstado
FROM dbo.DocumentosContables d
LEFT JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('4181','4182');

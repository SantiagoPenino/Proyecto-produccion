-- ==============================================================================
-- SCRIPT 02: CREAR SNAPSHOT / RESPALDO PREVIO DEL CLIENTE 854 (CAPA)
-- ==============================================================================
-- EJECUTAR ESTE SCRIPT ANTES DE HACER CUALQUIER PRUEBA O COBRO EN EL SISTEMA.
--
-- Crea 3 tablas temporales de respaldo físico en la base de datos:
--   1. dbo._BK_Capa854_Cuentas       (Guarda los saldos actuales)
--   2. dbo._BK_Capa854_Deudas        (Guarda los pendientes y estados de deudas)
--   3. dbo._BK_Capa854_PuntoControl  (Guarda los IDs máximos y fecha de corte)
-- ==============================================================================

SET NOCOUNT ON;

DECLARE @CliIdCliente INT = 854;

PRINT '==============================================================================';
PRINT '  CREANDO SNAPSHOT DE SEGURIDAD PARA CLIENTE 854...';
PRINT '==============================================================================';

-- 1. Eliminar respaldos viejos si existen
IF OBJECT_ID('dbo._BK_Capa854_Cuentas', 'U') IS NOT NULL DROP TABLE dbo._BK_Capa854_Cuentas;
IF OBJECT_ID('dbo._BK_Capa854_Deudas', 'U') IS NOT NULL DROP TABLE dbo._BK_Capa854_Deudas;
IF OBJECT_ID('dbo._BK_Capa854_PuntoControl', 'U') IS NOT NULL DROP TABLE dbo._BK_Capa854_PuntoControl;

-- 2. Respaldar Cuentas del cliente
SELECT 
    CueIdCuenta,
    CliIdCliente,
    CueNombre,
    CueTipo,
    MonIdMoneda,
    CueSaldoActual,
    CueEsPrincipal,
    CueActiva,
    GETDATE() AS FechaRespaldo
INTO dbo._BK_Capa854_Cuentas
FROM dbo.CuentasCliente WITH(NOLOCK)
WHERE CliIdCliente = @CliIdCliente;

PRINT '✓ Cuentas respaldadas: ' + CAST(@@ROWCOUNT AS VARCHAR);

-- 3. Respaldar Deudas del cliente
SELECT 
    dd.DDeIdDocumento,
    dd.CueIdCuenta,
    dd.DocIdDocumento,
    dd.OrdIdOrden,
    dd.DDeImporteOriginal,
    dd.DDeImportePendiente,
    dd.DDeEstado,
    dd.DDeFechaEmision,
    dd.DDeFechaVencimiento,
    GETDATE() AS FechaRespaldo
INTO dbo._BK_Capa854_Deudas
FROM dbo.DeudaDocumento dd WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = dd.CueIdCuenta
WHERE cc.CliIdCliente = @CliIdCliente;

PRINT '✓ Deudas vivas respaldadas: ' + CAST(@@ROWCOUNT AS VARCHAR);

-- 4. Guardar Punto de Control (IDs máximos para detectar adiciones posteriores)
DECLARE @MaxMov INT = ISNULL((SELECT MAX(m.MovIdMovimiento) FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta WHERE cc.CliIdCliente = @CliIdCliente), 0);
DECLARE @MaxPag INT = ISNULL((SELECT MAX(PagIdPago) FROM dbo.Pagos), 0);
DECLARE @MaxImp INT = ISNULL((SELECT MAX(ip.ImpIdImputacion) FROM dbo.ImputacionPago ip JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta WHERE cc.CliIdCliente = @CliIdCliente), 0);
DECLARE @MaxDoc INT = ISNULL((SELECT MAX(DocIdDocumento) FROM dbo.DocumentosContables WHERE CliIdCliente = @CliIdCliente), 0);
DECLARE @MaxDde INT = ISNULL((SELECT MAX(dd.DDeIdDocumento) FROM dbo.DeudaDocumento dd JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta WHERE cc.CliIdCliente = @CliIdCliente), 0);

SELECT 
    @CliIdCliente AS CliIdCliente,
    @MaxMov AS MaxMovId,
    @MaxPag AS MaxPagId,
    @MaxImp AS MaxImpId,
    @MaxDoc AS MaxDocId,
    @MaxDde AS MaxDdeId,
    GETDATE() AS FechaSnapshot
INTO dbo._BK_Capa854_PuntoControl;

PRINT '✓ Punto de control guardado (MaxMov: ' + CAST(@MaxMov AS VARCHAR) + ', MaxPag: ' + CAST(@MaxPag AS VARCHAR) + ')';
PRINT '';
PRINT '==============================================================================';
PRINT '  SNAPSHOT CREADO EXITOSAMENTE.';
PRINT '  Ya puedes realizar tus pruebas en el sistema.';
PRINT '  Si no te convence el resultado, ejecuta: 03_revertir_a_snapshot_854.sql';
PRINT '==============================================================================';

-- Mostrar contenido del snapshot
SELECT * FROM dbo._BK_Capa854_Cuentas;
SELECT * FROM dbo._BK_Capa854_PuntoControl;

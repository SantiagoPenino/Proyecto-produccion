-- ==============================================================================
-- SCRIPT 01: AUDITORÍA Y ESTADO ACTUAL DEL CLIENTE 854 (CAPA Indumentaria)
-- ==============================================================================
-- Este script consulta y desglosa en pantalla:
-- 1. Ficha del cliente y cuentas con sus saldos actuales.
-- 2. Deudas vivas activas (documentos pendientes de cobro).
-- 3. Últimos movimientos contables y pagos registrados.
-- 4. Cuadre comparativo: Deuda viva nominal vs Saldo real de cuenta corriente.
-- ==============================================================================

SET NOCOUNT ON;

DECLARE @CliIdCliente INT = 854;

PRINT '==============================================================================';
PRINT '  AUDITORÍA CONTABLE CLIENTE: CAPA Indumentaria Deportiva (ID ' + CAST(@CliIdCliente AS VARCHAR) + ')';
PRINT '  Fecha de consulta: ' + CONVERT(VARCHAR, GETDATE(), 120);
PRINT '==============================================================================';

-- 1. DATOS DEL CLIENTE
PRINT '';
PRINT '>>> 1. FICHA DEL CLIENTE';
SELECT 
    CliIdCliente,
    CodCliente,
    RTRIM(Nombre) AS Nombre,
    RTRIM(ISNULL(CioRuc, '')) AS RUT_CI,
    RTRIM(ISNULL(Email, '')) AS Email,
    RTRIM(ISNULL(TelefonoTrabajo, '')) AS Telefono
FROM dbo.Clientes WITH(NOLOCK)
WHERE CliIdCliente = @CliIdCliente;

-- 2. CUENTAS Y SALDOS
PRINT '';
PRINT '>>> 2. CUENTAS DE DINERO / RECURSOS Y SALDOS ACTUALES';
SELECT 
    cc.CueIdCuenta,
    RTRIM(ISNULL(cc.CueNombre, '')) AS CueNombre,
    cc.CueTipo,
    CASE WHEN cc.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
    CASE WHEN cc.CueEsPrincipal = 1 THEN 'SÍ' ELSE 'NO' END AS EsPrincipal,
    cc.CueSaldoActual,
    CASE 
        WHEN cc.CueSaldoActual < 0 THEN 'DEUDA (-)'
        WHEN cc.CueSaldoActual > 0 THEN 'A FAVOR (+)'
        ELSE 'EN CERO'
    END AS Situacion,
    CASE WHEN cc.CueActiva = 1 THEN 'ACTIVA' ELSE 'INACTIVA' END AS Estado
FROM dbo.CuentasCliente cc WITH(NOLOCK)
WHERE cc.CliIdCliente = @CliIdCliente
ORDER BY cc.CueEsPrincipal DESC, cc.CueIdCuenta ASC;

-- 3. DEUDAS VIVAS (Documentos pendientes en la pantalla de cobro)
PRINT '';
PRINT '>>> 3. DOCUMENTOS CON DEUDA VIVA (Pantalla Cobrar / Registrar pago)';
SELECT 
    dd.DDeIdDocumento,
    dd.CueIdCuenta,
    COALESCE(
        RTRIM(dc.DocTipo) + ' ' + RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR),
        od.OrdCodigoOrden,
        'Deuda #' + CAST(dd.DDeIdDocumento AS VARCHAR)
    ) AS Comprobante,
    CONVERT(VARCHAR, dd.DDeFechaEmision, 103) AS Emision,
    CONVERT(VARCHAR, dd.DDeFechaVencimiento, 103) AS Vencimiento,
    dd.DDeImporteOriginal,
    dd.DDeImportePendiente,
    dd.DDeEstado,
    DATEDIFF(DAY, dd.DDeFechaVencimiento, GETDATE()) AS DiasVencido
FROM dbo.DeudaDocumento dd WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = dd.CueIdCuenta
LEFT JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = dd.DocIdDocumento
LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = dd.OrdIdOrden
WHERE cc.CliIdCliente = @CliIdCliente
  AND dd.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO')
ORDER BY dd.DDeFechaEmision DESC;

-- 4. ÚLTIMOS 15 MOVIMIENTOS EN CUENTA CORRIENTE
PRINT '';
PRINT '>>> 4. ÚLTIMOS 15 MOVIMIENTOS EN CUENTA CORRIENTE';
SELECT TOP 15
    m.MovIdMovimiento,
    m.CueIdCuenta,
    CONVERT(VARCHAR, m.MovFecha, 120) AS FechaHora,
    m.MovTipo,
    m.MovImporte,
    ISNULL(m.MovSaldoPosterior, 0) AS MovSaldoPosterior,
    RTRIM(ISNULL(m.MovConcepto, '')) AS Concepto,
    m.DocIdDocumento,
    m.PagIdPago,
    CASE WHEN m.MovAnulado = 1 THEN 'ANULADO' ELSE 'VÁLIDO' END AS EstadoMov
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @CliIdCliente
ORDER BY m.MovIdMovimiento DESC;

-- 5. CUADRE RESUMEN (Explicación de la diferencia)
PRINT '';
PRINT '>>> 5. CUADRE RESUMEN: NOMINAL vs CUENTA CORRIENTE';
SELECT 
    ISNULL(SUM(dd.DDeImportePendiente), 0) AS TotalDeudasVivas_Nominal,
    (SELECT TOP 1 cc2.CueSaldoActual 
     FROM dbo.CuentasCliente cc2 
     WHERE cc2.CliIdCliente = @CliIdCliente AND cc2.CueEsPrincipal = 1 AND cc2.CueTipo = 'DINERO_UYU'
    ) AS SaldoRealCuentaCorriente,
    ISNULL(SUM(dd.DDeImportePendiente), 0) + 
    (SELECT TOP 1 cc2.CueSaldoActual 
     FROM dbo.CuentasCliente cc2 
     WHERE cc2.CliIdCliente = @CliIdCliente AND cc2.CueEsPrincipal = 1 AND cc2.CueTipo = 'DINERO_UYU'
    ) AS SaldoAFavorRemanente_SinImputar
FROM dbo.DeudaDocumento dd WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = dd.CueIdCuenta
WHERE cc.CliIdCliente = @CliIdCliente
  AND dd.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO');

-- ============================================================
-- DIAGNÓSTICO: tipos de datos relevantes y valores actuales
-- ============================================================

-- 1. Ver tipo de OrdCantidad en OrdenesDeposito
SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'OrdenesDeposito'
  AND COLUMN_NAME = 'OrdCantidad';

-- 2. Ver tipos actuales de DocumentosContablesDetalle
SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'DocumentosContablesDetalle'
ORDER BY ORDINAL_POSITION;

-- 3. Ver tipo de PedidosCobranzaDetalle.Cantidad
SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'PedidosCobranzaDetalle'
  AND COLUMN_NAME = 'Cantidad';

-- 4. Ver cómo está almacenada la orden SB-61151 (cantidad en ambas fuentes)
SELECT
    od.OrdIdOrden,
    od.OrdCodigoOrden,
    od.OrdCantidad          AS [OrdCantidad_od],
    pcd.Cantidad            AS [Cantidad_pcd],
    pc.NoDocERP,
    pcd.OrdenID             AS [OrdenID_pcd],
    CAST(pcd.OrdenID AS VARCHAR(100)) AS [OrdenID_as_varchar]
FROM dbo.OrdenesDeposito od WITH(NOLOCK)
LEFT JOIN dbo.PedidosCobranza pc WITH(NOLOCK) ON
    CAST(pc.NoDocERP AS VARCHAR(100)) = LEFT(od.OrdCodigoOrden,
        CASE WHEN CHARINDEX(' ', od.OrdCodigoOrden) > 0
             THEN CHARINDEX(' ', od.OrdCodigoOrden) - 1
             ELSE LEN(od.OrdCodigoOrden) END)
LEFT JOIN dbo.PedidosCobranzaDetalle pcd WITH(NOLOCK) ON
    pcd.PedidoCobranzaID = pc.ID
    OR CAST(pcd.OrdenID AS VARCHAR(100)) = od.OrdCodigoOrden
    OR CAST(pcd.OrdenID AS VARCHAR(100)) = RIGHT(od.OrdCodigoOrden,
        LEN(od.OrdCodigoOrden) - CHARINDEX('-', od.OrdCodigoOrden))
WHERE od.OrdCodigoOrden = 'SB-61151';

-- ============================================================
-- CORRECCIÓN: ampliar precisión decimal en DocumentosContablesDetalle
-- Los campos DcdSubtotal, DcdImpuestos, DcdTotal estaban en decimal(18,0)
-- lo que causaba que los importes (ej. 98.11) se redondearan a 98.
-- ============================================================

-- DcdCantidad: decimal(18,4) → guarda metros con 4 decimales exactos (ej. 19.9512)
ALTER TABLE dbo.DocumentosContablesDetalle
    ALTER COLUMN DcdCantidad         decimal(18, 4) NOT NULL;

-- DcdPrecioUnitario: decimal(18,2) → precios con centésimos
ALTER TABLE dbo.DocumentosContablesDetalle
    ALTER COLUMN DcdPrecioUnitario   decimal(18, 2) NULL;

-- DcdSubtotal, DcdImpuestos, DcdTotal, DcdTotalDescuentos → decimal(18,2)
ALTER TABLE dbo.DocumentosContablesDetalle
    ALTER COLUMN DcdSubtotal         decimal(18, 2) NULL;

ALTER TABLE dbo.DocumentosContablesDetalle
    ALTER COLUMN DcdImpuestos        decimal(18, 2) NULL;

ALTER TABLE dbo.DocumentosContablesDetalle
    ALTER COLUMN DcdTotal            decimal(18, 2) NULL;

ALTER TABLE dbo.DocumentosContablesDetalle
    ALTER COLUMN DcdTotalDescuentos  decimal(18, 2) NULL;

-- Verificar resultado
SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'DocumentosContablesDetalle'
ORDER BY ORDINAL_POSITION;

-- ============================================================
-- DIAGNÓSTICO DeudaDocumento
-- ¿Qué tipos tienen las columnas de importe?
-- ============================================================

-- 1. Tipos de columnas de DeudaDocumento
SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'DeudaDocumento'
ORDER BY ORDINAL_POSITION;

-- 2. Valor real almacenado en la deuda 46160
SELECT
    DDeIdDocumento,
    DDeImporteOriginal,
    DDeImportePendiente,
    DDeEstado,
    OrdIdOrden,
    DocIdDocumento
FROM dbo.DeudaDocumento WITH(NOLOCK)
WHERE DDeIdDocumento = 46160
   OR OrdIdOrden = 46160;  -- por si 46160 es el OrdId

-- 3. ¿De qué query se alimenta el panel Pago de Deudas?
-- (busca la fuente del monto US$13.00 para el cliente TULITOS)
SELECT TOP 5
    dd.DDeIdDocumento,
    dd.DDeImporteOriginal,
    dd.DDeImportePendiente,
    dd.DDeEstado,
    dc.DocTotal,
    dc.DocSerie, dc.DocNumero,
    c.Nombre AS ClienteNombre
FROM dbo.DeudaDocumento dd WITH(NOLOCK)
JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = dd.DocIdDocumento
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = dd.CueIdCuenta
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE c.Nombre LIKE '%TULIT%' OR c.NombreFantasia LIKE '%TULIT%'
ORDER BY dd.DDeIdDocumento DESC;

-- ============================================================
-- DIAGNÓSTICO ÁREAS (IMD)
-- ============================================================
SELECT * FROM dbo.Areas WITH(NOLOCK);

-- Veamos qué área tienen asignada las órdenes recientes de impresión digital
SELECT TOP 20 OrdCodigoOrden, AreIdArea, OrdNombreTrabajo 
FROM dbo.OrdenesDeposito WITH(NOLOCK) 
WHERE AreIdArea IS NOT NULL 
ORDER BY OrdIdOrden DESC;

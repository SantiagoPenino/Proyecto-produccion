-- ============================================================
-- AMPLIACIÓN DE PRECISIÓN DECIMAL PARA TABLAS FINANCIERAS
-- ============================================================

-- 1. MovimientosCuenta
ALTER TABLE dbo.MovimientosCuenta ALTER COLUMN MovImporte decimal(18,2) NOT NULL;
ALTER TABLE dbo.MovimientosCuenta ALTER COLUMN MovSaldoPosterior decimal(18,2) NULL;

-- 2. Pagos
ALTER TABLE dbo.Pagos ALTER COLUMN PagCotizacion decimal(18,4) NULL;
ALTER TABLE dbo.Pagos ALTER COLUMN PagMontoConvertido decimal(18,2) NULL;
ALTER TABLE dbo.Pagos ALTER COLUMN PagMontoPago decimal(18,2) NULL;

-- 3. DocumentosContables
ALTER TABLE dbo.DocumentosContables ALTER COLUMN DocSubtotal decimal(18,2) NULL;
ALTER TABLE dbo.DocumentosContables ALTER COLUMN DocImpuestos decimal(18,2) NULL;
ALTER TABLE dbo.DocumentosContables ALTER COLUMN DocTotalDescuentos decimal(18,2) NULL;
ALTER TABLE dbo.DocumentosContables ALTER COLUMN DocTotalRecargos decimal(18,2) NULL;
ALTER TABLE dbo.DocumentosContables ALTER COLUMN DocTotal decimal(18,2) NULL;

-- 4. DeudaDocumento
ALTER TABLE dbo.DeudaDocumento ALTER COLUMN DDeImporteOriginal decimal(18,2) NOT NULL;
ALTER TABLE dbo.DeudaDocumento ALTER COLUMN DDeImportePendiente decimal(18,2) NOT NULL;

-- 5. CiclosCredito
ALTER TABLE dbo.CiclosCredito ALTER COLUMN CicTotalOrdenes decimal(18,2) NULL;
ALTER TABLE dbo.CiclosCredito ALTER COLUMN CicTotalPagos decimal(18,2) NULL;
ALTER TABLE dbo.CiclosCredito ALTER COLUMN CicSaldoFacturar decimal(18,2) NULL;

-- 6. CuentasCliente
ALTER TABLE dbo.CuentasCliente ALTER COLUMN CueSaldoActual decimal(18,2) NOT NULL;
ALTER TABLE dbo.CuentasCliente ALTER COLUMN CueLimiteCredito decimal(18,2) NOT NULL;

PRINT 'Ampliacion de precision decimal completada con exito.';

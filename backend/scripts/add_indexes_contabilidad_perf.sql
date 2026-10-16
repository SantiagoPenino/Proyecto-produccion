-- ============================================================================
-- ÍNDICES DE PERFORMANCE — contabilidad / bandeja CFE / anticipos / deudas
-- 10-ago-2026. Idempotente: se puede correr más de una vez sin efecto.
-- Validado en local: ordenes-anticipo 6,3s→0,3s | deudas-vivas 7,4s→0,13s
-- (junto con los fixes de query en contabilidadController/contabilidadService).
-- Tablas chicas (9k-42k filas): cada CREATE tarda <1s y no bloquea nada apreciable.
-- ============================================================================

-- MovimientosCuenta: la tabla más consultada de contabilidad y no tenía NINGÚN
-- índice fuera de la PK. Estos tres cubren los accesos por cuenta, por ciclo
-- (SubOrdenesJSON de deudas) y por orden (anticipos, auditoría de depósito).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MovimientosCuenta_CueIdCuenta' AND object_id = OBJECT_ID('dbo.MovimientosCuenta'))
    CREATE NONCLUSTERED INDEX IX_MovimientosCuenta_CueIdCuenta ON dbo.MovimientosCuenta (CueIdCuenta);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MovimientosCuenta_CicIdCiclo' AND object_id = OBJECT_ID('dbo.MovimientosCuenta'))
    CREATE NONCLUSTERED INDEX IX_MovimientosCuenta_CicIdCiclo ON dbo.MovimientosCuenta (CicIdCiclo);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MovimientosCuenta_OrdIdOrden' AND object_id = OBJECT_ID('dbo.MovimientosCuenta'))
    CREATE NONCLUSTERED INDEX IX_MovimientosCuenta_OrdIdOrden ON dbo.MovimientosCuenta (OrdIdOrden);

-- PedidosCobranzaDetalle: sin índices fuera de la PK. El DetallesJSON de
-- ordenes-anticipo busca por OrdenID y trae detalle por PedidoCobranzaID.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PedidosCobranzaDetalle_PedidoCobranzaID' AND object_id = OBJECT_ID('dbo.PedidosCobranzaDetalle'))
    CREATE NONCLUSTERED INDEX IX_PedidosCobranzaDetalle_PedidoCobranzaID ON dbo.PedidosCobranzaDetalle (PedidoCobranzaID);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PedidosCobranzaDetalle_OrdenID' AND object_id = OBJECT_ID('dbo.PedidosCobranzaDetalle'))
    CREATE NONCLUSTERED INDEX IX_PedidosCobranzaDetalle_OrdenID ON dbo.PedidosCobranzaDetalle (OrdenID);

-- TransaccionDetalle: sin índices fuera de la PK; deudas-vivas y varios flujos
-- de CFE lo consultan por transacción.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TransaccionDetalle_TcaIdTransaccion' AND object_id = OBJECT_ID('dbo.TransaccionDetalle'))
    CREATE NONCLUSTERED INDEX IX_TransaccionDetalle_TcaIdTransaccion ON dbo.TransaccionDetalle (TcaIdTransaccion);

-- DeudaDocumento: acceso por documento (guard de idempotencia, saldada-por-doc
-- de la auditoría de depósito) y por cuenta (deudas del cliente).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DeudaDocumento_DocIdDocumento' AND object_id = OBJECT_ID('dbo.DeudaDocumento'))
    CREATE NONCLUSTERED INDEX IX_DeudaDocumento_DocIdDocumento ON dbo.DeudaDocumento (DocIdDocumento);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DeudaDocumento_CueIdCuenta' AND object_id = OBJECT_ID('dbo.DeudaDocumento'))
    CREATE NONCLUSTERED INDEX IX_DeudaDocumento_CueIdCuenta ON dbo.DeudaDocumento (CueIdCuenta);

-- DocumentosContables: rango de fechas de la bandeja CFE (y todo listado por emisión).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DocumentosContables_DocFechaEmision' AND object_id = OBJECT_ID('dbo.DocumentosContables'))
    CREATE NONCLUSTERED INDEX IX_DocumentosContables_DocFechaEmision ON dbo.DocumentosContables (DocFechaEmision);

-- Verificación rápida
SELECT i.name AS Indice, OBJECT_NAME(i.object_id) AS Tabla
FROM sys.indexes i
WHERE i.name IN (
    'IX_MovimientosCuenta_CueIdCuenta','IX_MovimientosCuenta_CicIdCiclo','IX_MovimientosCuenta_OrdIdOrden',
    'IX_PedidosCobranzaDetalle_PedidoCobranzaID','IX_PedidosCobranzaDetalle_OrdenID',
    'IX_TransaccionDetalle_TcaIdTransaccion',
    'IX_DeudaDocumento_DocIdDocumento','IX_DeudaDocumento_CueIdCuenta',
    'IX_DocumentosContables_DocFechaEmision')
ORDER BY Tabla, Indice;

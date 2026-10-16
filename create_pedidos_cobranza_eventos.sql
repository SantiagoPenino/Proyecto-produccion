-- [WMS] Trazabilidad de pedidos de venta VEN: una fila por cambio de estado
-- (PENDIENTE, EN_PREPARACION, PREPARADO, RECIBIDO_DEPOSITO, CANCELADO, ENTREGADO)
-- y por nota manual agregada desde "Recibir órdenes de venta" (Inventario).
-- El backend escribe acá con try/catch: si la tabla no existe todavía, el flujo
-- del pedido sigue funcionando igual (solo no queda historial).
IF OBJECT_ID('dbo.PedidosCobranzaEventos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PedidosCobranzaEventos (
        EventoID            INT IDENTITY(1,1) PRIMARY KEY,
        PedidoCobranzaID    INT NOT NULL,
        Tipo                VARCHAR(20) NOT NULL DEFAULT 'ESTADO',  -- 'ESTADO' | 'NOTA'
        Estado              VARCHAR(30) NULL,                       -- estado al que pasó (si Tipo=ESTADO)
        Nota                NVARCHAR(1000) NULL,                    -- texto de la nota (si Tipo=NOTA)
        Usuario             NVARCHAR(100) NULL,
        Fecha               DATETIME NOT NULL DEFAULT GETDATE()
    );

    CREATE INDEX IX_PedidosCobranzaEventos_Pedido
        ON dbo.PedidosCobranzaEventos (PedidoCobranzaID, Fecha);
END

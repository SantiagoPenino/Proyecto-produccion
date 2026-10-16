/* ============================================================================
   add_solicitudes_portal.sql
   Pedidos que arma el CLIENTE desde la Tienda del portal (autogestión) con un producto que tiene
   molde de TIZADA PRO: el cliente sube el arte, elige la tela, carga la lista de jugadores y el arte
   de los extras; al confirmar sale solo a TIZADA PRO y, cuando vuelve la tizada, el pedido se arma solo.

   Por dentro es una Solicitud más (dbo.SolicitudesVendedor): así usa las mismas piezas y telas, la
   misma lista de talles, los mismos editables, el mismo envío a TIZADA y la misma conversión a pedido.
   El vendedor la ve en Ventas › Solicitudes con la marca "Portal" (queda a nombre del asesor del cliente).

   Se puede correr más de una vez. Agrega DOS columnas a dbo.SolicitudesVendedor y no toca datos:
     Origen           'VENDEDOR' (todas las que existen) | 'PORTAL' (las que arma el cliente)
     PortalConfirmado cuándo el cliente tocó "Confirmar pedido". NULL = todavía la está armando
                      (borrador: no aparece en la lista de Solicitudes del vendedor).
   ============================================================================ */
SET NOCOUNT ON;

IF COL_LENGTH('dbo.SolicitudesVendedor', 'Origen') IS NULL
BEGIN
  ALTER TABLE dbo.SolicitudesVendedor ADD Origen varchar(10) NOT NULL
    CONSTRAINT DF_SolVen_Origen DEFAULT ('VENDEDOR') WITH VALUES;
  PRINT 'Columna SolicitudesVendedor.Origen agregada (todas las existentes quedan en VENDEDOR)';
END

IF OBJECT_ID('dbo.CK_SolVen_Origen', 'C') IS NULL
BEGIN
  EXEC('ALTER TABLE dbo.SolicitudesVendedor ADD CONSTRAINT CK_SolVen_Origen CHECK (Origen IN (''VENDEDOR'', ''PORTAL''))');
  PRINT 'Restricción CK_SolVen_Origen creada';
END

IF COL_LENGTH('dbo.SolicitudesVendedor', 'PortalConfirmado') IS NULL
BEGIN
  ALTER TABLE dbo.SolicitudesVendedor ADD PortalConfirmado datetime NULL;
  PRINT 'Columna SolicitudesVendedor.PortalConfirmado agregada';
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SolVen_Portal' AND object_id = OBJECT_ID('dbo.SolicitudesVendedor'))
BEGIN
  EXEC('CREATE INDEX IX_SolVen_Portal ON dbo.SolicitudesVendedor (Origen, CodCliente, Estado) INCLUDE (PortalConfirmado)');
  PRINT 'Índice IX_SolVen_Portal creado';
END

PRINT 'add_solicitudes_portal.sql: OK';

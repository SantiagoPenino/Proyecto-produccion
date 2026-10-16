/* ============================================================================
   add_tizadapro_envios.sql
   Pedidos mandados a TIZADA PRO por su API (/api/externo/v1) para generar la tizada.

   Se puede correr más de una vez. No toca ninguna tabla existente: crea una sola tabla nueva.

   TizadaProEnvios: una fila por cada vez que se manda algo a TIZADA. Es GENÉRICA por origen:
     Origen = 'SOLICITUD' → hoy: un producto de una Solicitud de vendedor
                            (OrigenID = SolicitudID, OrigenItemID = ProductoSolID)
     Origen = 'PORTAL'    → fase 2: un pedido del portal de clientes (OrigenID / OrigenItemID del portal)
   Guarda lo que se mandó, en qué va, las alarmas que devolvió y el resultado (los PDF de la tizada
   y la ficha técnica). La referencia es única: identifica el pedido del lado de TIZADA
   (SOL-<solicitud>-P<producto>-<intento> para las solicitudes).
   ============================================================================ */
SET NOCOUNT ON;

IF OBJECT_ID('dbo.TizadaProEnvios', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.TizadaProEnvios (
    EnvioID          int IDENTITY(1,1) NOT NULL CONSTRAINT PK_TizadaProEnvios PRIMARY KEY,
    Origen           varchar(20)    NOT NULL,      -- SOLICITUD | PORTAL (fase 2)
    OrigenID         int            NOT NULL,      -- SOLICITUD: SolicitudID
    OrigenItemID     int            NULL,          -- SOLICITUD: ProductoSolID
    Referencia       varchar(80)    NOT NULL,      -- la de TIZADA (única)
    Intento          int            NOT NULL,
    Estado           varchar(20)    NOT NULL,      -- REVISADO | EN_COLA | PROCESANDO | LISTO | APLICANDO | APLICADO | RECHAZADO | ERROR | CANCELADO | ERROR_APLICAR
    Etapa            nvarchar(300)  NULL,          -- texto de TIZADA ("armando la tizada · 40 %")
    SoloRevision     bit            NOT NULL CONSTRAINT DF_TizadaProEnvios_Rev DEFAULT (0),
    PedidoJson       nvarchar(max)  NULL,          -- el pedido.json que se mandó
    AlarmasJson      nvarchar(max)  NULL,          -- [{codigo, frena, etapa, mensaje, donde}]
    ResultadoJson    nvarchar(max)  NULL,          -- resultado de TIZADA (archivos, sha256, drive_id, enlace…)
    ArchivosJson     nvarchar(max)  NULL,          -- qué quedó de nuestro lado: [{ArchivoID, nombre, tipo, url}]
    ErrorTexto       nvarchar(1000) NULL,
    UsuarioID        int            NULL,
    FechaEnvio       datetime       NOT NULL CONSTRAINT DF_TizadaProEnvios_Fecha DEFAULT GETDATE(),
    FechaActualizado datetime       NULL,
    FechaFin         datetime       NULL,
    CONSTRAINT UQ_TizadaProEnvios_Ref UNIQUE (Referencia),
    CONSTRAINT CK_TizadaProEnvios_Origen CHECK (Origen IN ('SOLICITUD', 'PORTAL'))
  );
  CREATE INDEX IX_TizadaProEnvios_Origen ON dbo.TizadaProEnvios (Origen, OrigenItemID, EnvioID DESC) INCLUDE (OrigenID);
  CREATE INDEX IX_TizadaProEnvios_Estado ON dbo.TizadaProEnvios (Estado) INCLUDE (Referencia);
  PRINT 'Tabla TizadaProEnvios creada';
END

PRINT 'add_tizadapro_envios.sql: OK';

/* ============================================================================
   add_conversion_solicitud_pedido.sql
   Conversión de la Solicitud del vendedor (Spec 41) en pedido de producción, y base
   del ingreso de pedidos por sistema (docs/api-externa-pedidos-prenda-plan.md).

   Correr DESPUÉS de add_solicitudes_vendedor.sql. Se puede correr más de una vez.

   1. SolicitudesVendedorArchivos: material y copias POR ARCHIVO del diseño pronto de la
      producción principal (los carga el diseñador al subir el archivo).
   2. IntegracionPedidos: una fila por pedido ingresado por sistema. UNIQUE (Origen, IdExterno)
      = el mismo pedido no se puede crear dos veces.
   3. SolicitudesVendedor: ficha de ingreso a producción (FichaJson) y fecha de entrega.
   4. SolicitudesVendedorArchivos: nuevo tipo de archivo COMPROBANTE (comprobante de pago de la seña).
   5. ConfigTiposArchivoReferencia: tipo FICHA_PEDIDO (la ficha PDF que se adjunta al pedido al convertir).
   ============================================================================ */
SET NOCOUNT ON;

-- 0. Orden de los scripts: este va DESPUÉS de add_solicitudes_vendedor.sql -------------
IF OBJECT_ID('dbo.SolicitudesVendedorArchivos', 'U') IS NULL
BEGIN
  RAISERROR('Falta correr primero scripts/add_solicitudes_vendedor.sql (no existe la tabla SolicitudesVendedorArchivos). No se cambió nada.', 16, 1);
  RETURN;
END

-- 1. Material y copias por archivo de diseño pronto ------------------------------
IF COL_LENGTH('dbo.SolicitudesVendedorArchivos', 'Material') IS NULL
BEGIN
  ALTER TABLE dbo.SolicitudesVendedorArchivos ADD
    Material     nvarchar(200) NULL,   -- Articulos.Descripcion elegido por el diseñador (tela de sublimación)
    CodArticulo  varchar(50)   NULL,
    CodStock     varchar(50)   NULL,
    Copias       int           NULL;   -- copias del archivo; NULL = 1
  PRINT 'SolicitudesVendedorArchivos: Material / CodArticulo / CodStock / Copias agregadas';
END

-- 2. Pedidos ingresados por sistema ----------------------------------------------
IF OBJECT_ID('dbo.IntegracionPedidos', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.IntegracionPedidos (
    IntegracionID     int IDENTITY(1,1) NOT NULL CONSTRAINT PK_IntegracionPedidos PRIMARY KEY,
    Origen            varchar(50)    NOT NULL,      -- SOLICITUD_VENDEDOR | (a futuro) nombre del sistema externo
    IdExterno         varchar(100)   NOT NULL,      -- id del pedido en el origen. Solicitud: SOL-{SolicitudID}-P{ProductoSolID}
    Estado            varchar(24)    NOT NULL,      -- PROCESANDO | RECHAZADO | PASANDO_ARCHIVOS | CREADO | ERROR_ARCHIVOS | ERROR
    CodCliente        int            NULL,
    NoDocERP          int            NULL,          -- número del pedido creado (Ordenes.NoDocERP)
    CodigosOrden      nvarchar(500)  NULL,          -- SB-123, PRO-123, ...
    PedidoJson        nvarchar(max)  NULL,          -- el pedido tal como llegó (términos de negocio)
    PayloadJson       nvarchar(max)  NULL,          -- lo que se le entregó al creador de pedidos (igual al de /ventas/pedido-prenda)
    ArchivosJson      nvarchar(max)  NULL,          -- manifiesto de archivos y cuáles ya pasaron a producción
    ErroresJson       nvarchar(max)  NULL,          -- [{codigo, campo, mensaje}]
    UsuarioID         int            NULL,          -- usuario interno que lo disparó
    FechaRecibido     datetime       NOT NULL CONSTRAINT DF_IntPed_Recibido DEFAULT GETDATE(),
    FechaFin          datetime       NULL,
    CONSTRAINT UQ_IntegracionPedidos_Origen UNIQUE (Origen, IdExterno)
  );
  CREATE INDEX IX_IntegracionPedidos_NoDoc ON dbo.IntegracionPedidos (NoDocERP);
  PRINT 'Tabla IntegracionPedidos creada';
END



-- 3. Ficha de ingreso a producción (checklist del taller) ------------------------
--    Datos de cabecera que la maqueta "Ingreso a producción" exige antes de que un
--    pedido entre: muestra, fecha y plazo, indicaciones, dónde se cose, notas internas.
--    Los datos por producto (cómo se define, producto nuevo, medidas, talles,
--    especificaciones técnicas, diseño) van en SolicitudesVendedorProductos.DatosJson.
IF COL_LENGTH('dbo.SolicitudesVendedor', 'FichaJson') IS NULL
BEGIN
  ALTER TABLE dbo.SolicitudesVendedor ADD
    FichaJson          nvarchar(max) NULL,   -- muestra, plazo, indicaciones, dónde se cose, notas internas
    FechaEntrega       date          NULL,   -- fecha que necesita el cliente
    FechaEntregaHasta  date          NULL;   -- si es un rango
  PRINT 'SolicitudesVendedor: FichaJson / FechaEntrega / FechaEntregaHasta agregadas';
END
-- 4. Comprobante de pago de la seña ------------------------------------------------
--    Nuevo tipo de archivo: COMPROBANTE (captura o PDF de la transferencia que manda el
--    cliente). Es informativo: queda en la solicitud y NO mueve la cuenta del cliente.
--    Solo amplía la lista de tipos permitidos: las filas que ya existen no cambian.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SolVenArchivo_Rol' AND definition NOT LIKE '%COMPROBANTE%')
BEGIN
  ALTER TABLE dbo.SolicitudesVendedorArchivos DROP CONSTRAINT CK_SolVenArchivo_Rol;
  ALTER TABLE dbo.SolicitudesVendedorArchivos ADD CONSTRAINT CK_SolVenArchivo_Rol
    CHECK (Rol IN ('ARTE_CLIENTE','REFERENCIA','BOCETO','PLANILLA','TIZADA','DISENO_PRONTO','COMPROBANTE'));
  PRINT 'SolicitudesVendedorArchivos: ahora acepta el tipo COMPROBANTE (comprobante de pago)';
END

-- 5. Tipo de referencia "Ficha del pedido" ---------------------------------------------
--    Al convertir una solicitud, el sistema adjunta a la orden PRO un PDF con todo lo de la
--    solicitud, como referencia de tipo FICHA_PEDIDO. Acá solo se le da nombre visible.
--    Si la tabla de tipos no existe todavía, no pasa nada (el backend usa su lista de respaldo).
IF OBJECT_ID('dbo.ConfigTiposArchivoReferencia', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.ConfigTiposArchivoReferencia WHERE Codigo = 'FICHA_PEDIDO')
BEGIN
  INSERT INTO dbo.ConfigTiposArchivoReferencia (Codigo, Nombre, Activo, Orden) VALUES ('FICHA_PEDIDO', N'Ficha del pedido', 1, 90);
  PRINT 'ConfigTiposArchivoReferencia: tipo FICHA_PEDIDO agregado';
END

PRINT 'add_conversion_solicitud_pedido.sql: OK';

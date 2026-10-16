-- ============================================================================
-- CAPTACIÓN DE SOLICITUDES DE VENDEDORES — modelo de datos + menú (F1)
-- Spec de negocio: specs/41-captacion-de-solicitudes-vendedores.md
-- Plan técnico:    docs/solicitudes-vendedor-plan.md
-- IDEMPOTENTE: se puede correr las veces que haga falta. Todo es ADITIVO
-- (tablas nuevas + filas de menú). No toca ninguna tabla existente.
-- CORRER EN PRODUCCIÓN ANTES DEL DEPLOY DEL CÓDIGO.
--
-- Cliente: se guarda Clientes.CodCliente (el mismo identificador que usa el
-- ingreso de pedidos de prenda, /ventas/pedido-prenda).
-- Usuarios (vendedor, diseñador, autor de eventos): Usuarios.IdUsuario.
-- ============================================================================
SET NOCOUNT ON;

-- 1. Cabecera -----------------------------------------------------------------
IF OBJECT_ID('dbo.SolicitudesVendedor', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SolicitudesVendedor (
    SolicitudID          int IDENTITY(1,1) NOT NULL CONSTRAINT PK_SolicitudesVendedor PRIMARY KEY,
    FechaSolicitud       datetime       NOT NULL CONSTRAINT DF_SolVen_Fecha DEFAULT GETDATE(),
    CodCliente           int            NOT NULL,
    NombreTrabajo        nvarchar(200)  NOT NULL,
    VendedorID           int            NOT NULL,      -- Usuarios.IdUsuario: vendedor que pacta
    Detalle              nvarchar(max)  NOT NULL,      -- lo que pide el cliente (texto libre)
    Observaciones        nvarchar(max)  NULL,
    PreId                int            NULL,          -- Presupuestos.PreId del que salió (opcional; sin FK: esa tabla la crea su pantalla al primer uso)
    PreNumero            varchar(20)    NULL,          -- foto del número de presupuesto
    Estado               varchar(20)    NOT NULL CONSTRAINT DF_SolVen_Estado DEFAULT 'INGRESADA',
                                                       -- INGRESADA | EN_DISENO | PEDIDO_SOLICITADO | CANCELADA
    -- Precio pactado: UNO por Solicitud (RN-SOL.15)
    ModoCobro            varchar(20)    NULL,          -- PRECIO_ESTABLECIDO | POR_AREA
    PrecioPactado        decimal(18,2)  NULL,
    MonIdMoneda          int            NULL,          -- 1 = $ · 2 = US$
    -- Seña: es un DATO, no mueve dinero (RN-SOL.17b / INV-SOL.04)
    RequiereSena         bit            NOT NULL CONSTRAINT DF_SolVen_ReqSena DEFAULT 0,
    SenaMontoRequerido   decimal(18,2)  NULL,
    SenaConfirmada       bit            NOT NULL CONSTRAINT DF_SolVen_SenaConf DEFAULT 0,
    SenaVia              nvarchar(60)   NULL,          -- vía de entrada del dinero
    SenaMonto            decimal(18,2)  NULL,
    SenaReferencia       nvarchar(120)  NULL,
    SenaConfirmadaPor    int            NULL,
    SenaFechaConfirma    datetime       NULL,
    -- Cancelación (RN-SOL.24b)
    MotivoCancelacion    nvarchar(500)  NULL,
    CanceladaPor         int            NULL,
    FechaCancelacion     datetime       NULL,
    UsuarioAlta          int            NOT NULL,
    FechaAlta            datetime       NOT NULL CONSTRAINT DF_SolVen_Alta DEFAULT GETDATE(),
    UsuarioModif         int            NULL,
    FechaModif           datetime       NULL,
    CONSTRAINT CK_SolVen_Estado CHECK (Estado IN ('INGRESADA','EN_DISENO','PEDIDO_SOLICITADO','CANCELADA'))
  );
  CREATE INDEX IX_SolVen_Estado   ON dbo.SolicitudesVendedor (Estado, FechaSolicitud DESC);
  CREATE INDEX IX_SolVen_Cliente  ON dbo.SolicitudesVendedor (CodCliente);
  CREATE INDEX IX_SolVen_Vendedor ON dbo.SolicitudesVendedor (VendedorID, Estado);
  PRINT 'Tabla SolicitudesVendedor creada';
END

-- 1b. Presupuesto asociado (RN-SOL.05b) — por si la tabla se creó con una versión anterior de este script
IF COL_LENGTH('dbo.SolicitudesVendedor', 'PreId') IS NULL
BEGIN
  ALTER TABLE dbo.SolicitudesVendedor ADD PreId int NULL, PreNumero varchar(20) NULL;
  PRINT 'SolicitudesVendedor.PreId / PreNumero agregadas';
END

-- 2. Productos solicitados (un pedido por producto, RN-SOL.26) ------------------
IF OBJECT_ID('dbo.SolicitudesVendedorProductos', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SolicitudesVendedorProductos (
    ProductoSolID        int IDENTITY(1,1) NOT NULL CONSTRAINT PK_SolVenProd PRIMARY KEY,
    SolicitudID          int            NOT NULL CONSTRAINT FK_SolVenProd_Sol REFERENCES dbo.SolicitudesVendedor (SolicitudID),
    Orden                int            NOT NULL CONSTRAINT DF_SolVenProd_Orden DEFAULT 1,
    TipoFabricacion      varchar(20)    NOT NULL,      -- PRODUCTO_TERMINADO | PERSONALIZADO
    ProIdProducto        int            NULL,          -- Articulos.ProIdProducto (obligatorio si PRODUCTO_TERMINADO)
    ProductoNombre       nvarchar(200)  NULL,          -- foto del nombre al cargar
    Cantidad             int            NOT NULL,
    Observaciones        nvarchar(max)  NULL,
    DatosJson            nvarchar(max)  NULL,          -- corte/costura: tipo de molde, origen de tela, bobina, instrucciones
    Activo               bit            NOT NULL CONSTRAINT DF_SolVenProd_Activo DEFAULT 1,
    -- Conversión a pedido (F3, todavía sin construir)
    PedidoNoDocERP       int            NULL,
    FechaConversion      datetime       NULL,
    UsuarioConversion    int            NULL,
    CONSTRAINT CK_SolVenProd_Tipo CHECK (TipoFabricacion IN ('PRODUCTO_TERMINADO','PERSONALIZADO'))
  );
  CREATE INDEX IX_SolVenProd_Sol ON dbo.SolicitudesVendedorProductos (SolicitudID, Activo);
  PRINT 'Tabla SolicitudesVendedorProductos creada';
END

-- 3. Partes a diseñar: producción principal + cada servicio adicional (RN-SOL.18)
IF OBJECT_ID('dbo.SolicitudesVendedorPartes', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SolicitudesVendedorPartes (
    ParteID              int IDENTITY(1,1) NOT NULL CONSTRAINT PK_SolVenParte PRIMARY KEY,
    SolicitudID          int            NOT NULL CONSTRAINT FK_SolVenParte_Sol  REFERENCES dbo.SolicitudesVendedor (SolicitudID),
    ProductoSolID        int            NOT NULL CONSTRAINT FK_SolVenParte_Prod REFERENCES dbo.SolicitudesVendedorProductos (ProductoSolID),
    Tipo                 varchar(12)    NOT NULL,      -- PRINCIPAL | BORDADO | DTF | TPU
    IncluidoEnProducto   bit            NOT NULL CONSTRAINT DF_SolVenParte_Incl DEFAULT 0,   -- viene con el producto terminado: no se quita (RN-SOL.09)
    CantidadTotal        int            NULL,
    PorPrenda            int            NULL,          -- estampados / bordados por prenda
    Ubicacion            nvarchar(300)  NULL,          -- dónde va en la prenda
    ArteOrigen           varchar(10)    NULL,          -- CLIENTE (arte listo) | EMPRESA (se diseña en la empresa)
    DatosJson            nvarchar(max)  NULL,          -- variante, material, tipo de TPU, origen de las prendas…
    Observaciones        nvarchar(max)  NULL,
    Estado               varchar(16)    NOT NULL CONSTRAINT DF_SolVenParte_Estado DEFAULT 'INGRESADO',
                                                       -- INGRESADO | ENVIADO_DISENO | DISENO_INICIADO | DISENADO
    TipoTrabajo          varchar(12)    NULL,          -- REVISAR | DESDE_CERO (se elige al enviar a Diseño)
    DisenadorID          int            NULL,          -- Usuarios.IdUsuario que la tomó
    FechaEnvioDiseno     datetime       NULL,
    UsuarioEnvioDiseno   int            NULL,
    FechaInicioDiseno    datetime       NULL,
    FechaDisenado        datetime       NULL,
    UsuarioDisenado      int            NULL,
    -- Señal "Modificada" (RN-SOL.20b)
    Modificada           bit            NOT NULL CONSTRAINT DF_SolVenParte_Modif DEFAULT 0,
    ModificadaDetalle    nvarchar(max)  NULL,          -- qué cambió (texto legible)
    ModificadaPor        int            NULL,
    ModificadaFecha      datetime       NULL,
    Activo               bit            NOT NULL CONSTRAINT DF_SolVenParte_Activo DEFAULT 1,
    CONSTRAINT CK_SolVenParte_Tipo   CHECK (Tipo IN ('PRINCIPAL','BORDADO','DTF','TPU')),
    CONSTRAINT CK_SolVenParte_Estado CHECK (Estado IN ('INGRESADO','ENVIADO_DISENO','DISENO_INICIADO','DISENADO'))
  );
  CREATE INDEX IX_SolVenParte_Sol     ON dbo.SolicitudesVendedorPartes (SolicitudID, Activo);
  CREATE INDEX IX_SolVenParte_Bandeja ON dbo.SolicitudesVendedorPartes (Estado, DisenadorID);
  PRINT 'Tabla SolicitudesVendedorPartes creada';
END

-- 4. Historial: NO se edita ni se borra (INV-SOL.02). Las Interacciones son
--    eventos de Tipo = 'INTERACCION' (RN-SOL.03).
IF OBJECT_ID('dbo.SolicitudesVendedorEventos', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SolicitudesVendedorEventos (
    EventoID             int IDENTITY(1,1) NOT NULL CONSTRAINT PK_SolVenEvento PRIMARY KEY,
    SolicitudID          int            NOT NULL CONSTRAINT FK_SolVenEvento_Sol REFERENCES dbo.SolicitudesVendedor (SolicitudID),
    ProductoSolID        int            NULL,
    ParteID              int            NULL,
    Tipo                 varchar(24)    NOT NULL,      -- ALTA | EDICION | ESTADO_SOLICITUD | ESTADO_PARTE | INTERACCION | ARCHIVO
                                                       -- | ARCHIVO_SUSTITUIDO | PRECIO | SENA | CAMBIO_ACEPTADO | CANCELACION
    EstadoAnterior       varchar(20)    NULL,
    EstadoNuevo          varchar(20)    NULL,
    Texto                nvarchar(max)  NULL,
    UsuarioID            int            NOT NULL,
    UsuarioNombre        nvarchar(120)  NULL,          -- foto del nombre: el historial no depende de que el usuario siga existiendo
    Fecha                datetime       NOT NULL CONSTRAINT DF_SolVenEvento_Fecha DEFAULT GETDATE()
  );
  CREATE INDEX IX_SolVenEvento_Sol ON dbo.SolicitudesVendedorEventos (SolicitudID, Fecha);
  PRINT 'Tabla SolicitudesVendedorEventos creada';
END

-- 5. Archivos: se suben UNA vez a Drive y el pedido toma el enlace (RN-SOL.13)
IF OBJECT_ID('dbo.SolicitudesVendedorArchivos', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SolicitudesVendedorArchivos (
    ArchivoID            int IDENTITY(1,1) NOT NULL CONSTRAINT PK_SolVenArchivo PRIMARY KEY,
    SolicitudID          int            NOT NULL CONSTRAINT FK_SolVenArchivo_Sol REFERENCES dbo.SolicitudesVendedor (SolicitudID),
    ProductoSolID        int            NULL,
    ParteID              int            NULL,
    EventoID             int            NULL,          -- si se adjuntó en una interacción
    Rol                  varchar(20)    NOT NULL,      -- ARTE_CLIENTE | REFERENCIA | BOCETO | PLANILLA | TIZADA | DISENO_PRONTO
    NombreOriginal       nvarchar(260)  NOT NULL,
    UrlDrive             nvarchar(max)  NOT NULL,      -- 'Pendiente' mientras sube
    TamanoBytes          bigint         NULL,
    AnchoM               decimal(10,4)  NULL,          -- medida del archivo (la mide el navegador, igual que el ingreso de prenda)
    AltoM                decimal(10,4)  NULL,
    Vigente              bit            NOT NULL CONSTRAINT DF_SolVenArchivo_Vig DEFAULT 1,
    ReemplazaA           int            NULL,          -- ArchivoID al que sustituyó (RN-SOL.19b)
    UsuarioSube          int            NOT NULL,
    FechaSubida          datetime       NOT NULL CONSTRAINT DF_SolVenArchivo_Fecha DEFAULT GETDATE(),
    CONSTRAINT CK_SolVenArchivo_Rol CHECK (Rol IN ('ARTE_CLIENTE','REFERENCIA','BOCETO','PLANILLA','TIZADA','DISENO_PRONTO'))
  );
  CREATE INDEX IX_SolVenArchivo_Sol   ON dbo.SolicitudesVendedorArchivos (SolicitudID, Vigente);
  CREATE INDEX IX_SolVenArchivo_Parte ON dbo.SolicitudesVendedorArchivos (ParteID, Rol, Vigente);
  PRINT 'Tabla SolicitudesVendedorArchivos creada';
END

-- 6. Rol "Diseñador". Es un rol de login como cualquier otro: a cada diseñador se le
--    asigna desde la pantalla de Usuarios. El rol Admin siempre puede operar la bandeja.
DECLARE @RolDisenador int;
SELECT @RolDisenador = IdRol FROM dbo.Roles WHERE NombreRol = N'Diseñador';
IF @RolDisenador IS NULL
BEGIN
  INSERT INTO dbo.Roles (NombreRol, Descripcion)
  VALUES (N'Diseñador', N'Diseño: toma trabajos de la Bandeja de Diseño de las solicitudes de vendedores y sube el diseño pronto');
  SET @RolDisenador = SCOPE_IDENTITY();
  PRINT 'Rol Diseñador creado';
END

-- 6b. Excepciones: alguien que tiene OTRO rol (ej. un vendedor) y además diseña.
--     Se habilita persona por persona desde la Bandeja de Diseño (solo Admin).
IF OBJECT_ID('dbo.SolicitudesVendedorDisenadores', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SolicitudesVendedorDisenadores (
    IdUsuario            int            NOT NULL CONSTRAINT PK_SolVenDisenadores PRIMARY KEY,
    Activo               bit            NOT NULL CONSTRAINT DF_SolVenDis_Activo DEFAULT 1,
    FechaAlta            datetime       NOT NULL CONSTRAINT DF_SolVenDis_Alta DEFAULT GETDATE()
  );
  PRINT 'Tabla SolicitudesVendedorDisenadores creada';
END

-- 7. Menú: dos pantallas colgadas de "Ventas" -----------------------------------
DECLARE @Padre int;
SELECT @Padre = IdPadre FROM dbo.Modulos WHERE Ruta = '/vendedores/cliente-360';
IF @Padre IS NULL SELECT @Padre = IdModulo FROM dbo.Modulos WHERE Titulo = 'Ventas' AND Ruta IS NULL;

IF @Padre IS NULL
  PRINT 'AVISO: no se encontró el módulo padre "Ventas"; no se crearon los ítems de menú.';
ELSE
BEGIN
  DECLARE @Pantallas TABLE (Titulo nvarchar(100), Ruta nvarchar(255), Orden int);
  INSERT INTO @Pantallas VALUES
    ('Solicitudes',        '/ventas/solicitudes',     97),
    ('Bandeja de Diseño',  '/ventas/bandeja-diseno',  98);

  INSERT INTO dbo.Modulos (Titulo, IdPadre, Ruta, Icono, IndiceOrden)
  SELECT p.Titulo, @Padre, p.Ruta, NULL, p.Orden
  FROM @Pantallas p
  WHERE NOT EXISTS (SELECT 1 FROM dbo.Modulos m WHERE m.Ruta = p.Ruta);

  -- Quién ve qué en el menú:
  --   Solicitudes       → vendedores: 1 Admin · 7 VENTAS · 8 Administracion · 12 Atención al Cliente
  --   Bandeja de Diseño → 1 Admin + rol Diseñador (y los mismos vendedores, por si alguno está
  --                       habilitado como excepción en SolicitudesVendedorDisenadores)
  --   Grupo "Ventas"    → el rol Diseñador necesita ver el grupo para llegar a su bandeja
  DECLARE @Permisos TABLE (IdRol int, IdModulo int);
  INSERT INTO @Permisos (IdRol, IdModulo)
  SELECT r.IdRol, m.IdModulo
  FROM (VALUES (1), (7), (8), (12)) r (IdRol)
  CROSS JOIN dbo.Modulos m
  WHERE m.Ruta IN (SELECT Ruta FROM @Pantallas);

  INSERT INTO @Permisos (IdRol, IdModulo)
  SELECT @RolDisenador, m.IdModulo FROM dbo.Modulos m WHERE m.Ruta = '/ventas/bandeja-diseno'
  UNION ALL
  SELECT @RolDisenador, @Padre;

  INSERT INTO dbo.PermisosRoles (IdRol, IdModulo)
  SELECT DISTINCT p.IdRol, p.IdModulo
  FROM @Permisos p
  WHERE EXISTS (SELECT 1 FROM dbo.Roles ro WHERE ro.IdRol = p.IdRol)
    AND NOT EXISTS (SELECT 1 FROM dbo.PermisosRoles pr WHERE pr.IdRol = p.IdRol AND pr.IdModulo = p.IdModulo);
  PRINT 'Menú de Solicitudes registrado';
END

PRINT 'add_solicitudes_vendedor.sql: OK';

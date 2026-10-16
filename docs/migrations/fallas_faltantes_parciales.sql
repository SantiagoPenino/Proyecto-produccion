/* =====================================================================
   FALLAS, FALTANTES Y ENTREGAS PARCIALES ENTRE ÁREAS — Fase 0 (modelo de datos)
   Spec 39 (specs/39-fallas-faltantes-y-parciales.md)
   ---------------------------------------------------------------------
   Idempotente: cada bloque verifica antes de crear. Se puede correr más de una vez.
   Todo es ADITIVO: no cambia el significado de ninguna columna existente.

   Qué crea:
     1) Logistica_EnvioOrdenes  — línea por orden dentro de un remito (motivo del pendiente,
                                  cantidad opcional, marca "completa la orden").
     2) Reposiciones            — vínculo explícito madre / orden de falla / área que produce /
                                  área que reportó / origen del insumo / eslabón de la cadena.
     3) SolicitudesInsumo       — tela o prenda del cliente (o producto del local sin stock):
                                  stock encontrado, notificación por portal, decisión, PRE vinculada.
     4) Ordenes: OrdenOrigenID (linaje explícito), EstadoEnvio (SIN_ENVIAR/PARCIAL/COMPLETO),
                 CantidadEsperada (solo se usa donde se cuentan prendas o unidades).
     5) vw_LibroEntregas        — por orden: envíos, último envío marcado, reposiciones y
                                  solicitudes abiertas, "Incompleta".
     6) ConfiguracionGlobal: AREAS_CADENA_REPOSICION (vacío = apagado), PLAZO_SOLICITUD_INSUMO_DIAS (7).
        AREAS_DESPACHO_PARCIAL ya existe (hoy 'DIRECTA'): NO se modifica acá.
     7) TiposFallas para las áreas de bandeja (EMB, EST, TWC, TWT) si no tienen ninguno.
     8) Relleno histórico de Ordenes.OrdenOrigenID a partir del sufijo -F/-R del código.
   ===================================================================== */
SET NOCOUNT ON;

-- ── 1. Logistica_EnvioOrdenes ────────────────────────────────────────────
IF OBJECT_ID('dbo.Logistica_EnvioOrdenes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Logistica_EnvioOrdenes (
        EnvioOrdenID     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Logistica_EnvioOrdenes PRIMARY KEY,
        EnvioID          INT NOT NULL,              -- Logistica_Envios.EnvioID
        OrdenID          INT NOT NULL,              -- orden madre (la que lleva el libro)
        OrdenOrigenID    INT NULL,                  -- si el material viene de una orden de falla, su OrdenID
        ReposicionID     INT NULL,                  -- Reposiciones.ReposicionID que este envío mueve
        EsComplemento    BIT NOT NULL CONSTRAINT DF_EnvioOrdenes_EsComplemento DEFAULT 0,
        CompletaOrden    BIT NOT NULL CONSTRAINT DF_EnvioOrdenes_CompletaOrden DEFAULT 0,
        Cantidad         DECIMAL(12,2) NULL,        -- opcional: solo cuando se conoce
        Unidad           NCHAR(10) NULL,            -- Ordenes.UM al momento del envío
        MotivoPendiente  VARCHAR(30) NULL,          -- FALLA_EN_PROCESO | RESTO_EN_PRODUCCION | NULL
        Bultos           INT NULL,                  -- bultos de esa orden en este remito (informativo)
        UsuarioID        INT NULL,
        Fecha            DATETIME NOT NULL CONSTRAINT DF_EnvioOrdenes_Fecha DEFAULT GETDATE()
    );
    CREATE INDEX IX_EnvioOrdenes_Orden ON dbo.Logistica_EnvioOrdenes (OrdenID);
    CREATE INDEX IX_EnvioOrdenes_Envio ON dbo.Logistica_EnvioOrdenes (EnvioID);
    PRINT 'Creada Logistica_EnvioOrdenes';
END
ELSE PRINT 'Logistica_EnvioOrdenes ya existe';

-- ── 2. Reposiciones ──────────────────────────────────────────────────────
IF OBJECT_ID('dbo.Reposiciones', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Reposiciones (
        ReposicionID          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Reposiciones PRIMARY KEY,
        OrdenMadreID          INT NOT NULL,          -- orden a la que repone, en el área que produce
        OrdenFallaID          INT NULL,              -- orden de falla creada (NULL mientras espera insumo del cliente)
        OrdenReportaID        INT NOT NULL,          -- orden desde la que se reportó (misma que la madre si es falla propia)
        AreaProduce           VARCHAR(20) NOT NULL,
        AreaReporta           VARCHAR(20) NOT NULL,
        Tipo                  VARCHAR(20) NOT NULL,  -- FALLA_PROPIA | FALTANTE
        OrigenInsumo          VARCHAR(20) NOT NULL CONSTRAINT DF_Reposiciones_Origen DEFAULT 'PROPIO', -- PROPIO | TELA_CLIENTE | PRENDA_CLIENTE | PRODUCTO_LOCAL
        Estado                VARCHAR(20) NOT NULL CONSTRAINT DF_Reposiciones_Estado DEFAULT 'PENDIENTE',
                              -- ESPERANDO_INSUMO | BLOQUEADA | PENDIENTE | EN_PRODUCCION | ENVIADA | CERRADA | CANCELADA
        Cantidad              DECIMAL(12,2) NULL,    -- NULL en Sublimación hasta imprimir y medir
        Unidad                NCHAR(10) NULL,
        Motivo                NVARCHAR(200) NULL,
        Nota                  NVARCHAR(MAX) NULL,
        ImagenPath            NVARCHAR(300) NULL,
        ArchivoOrigenID       INT NULL,              -- ArchivosOrden de la madre del que viene lo que falta
        DetallePiezas         NVARCHAR(MAX) NULL,    -- JSON [{cantidad, parte, talle}]
        ReposicionAnteriorID  INT NULL,              -- eslabón previo de la cadena (se libera cuando llega)
        FallaID               INT NULL,              -- FallasProduccion.FallaID
        BobinaNuevaID         INT NULL,              -- bobina usada para la reposición (stock o PRE nueva)
        VenOrdenID            INT NULL,              -- VEN interna por producto del local
        NoDocERP              NCHAR(30) NULL,        -- pedido (denormalizado para consultas por pedido)
        UsuarioID             INT NULL,
        FechaCreacion         DATETIME NOT NULL CONSTRAINT DF_Reposiciones_Fecha DEFAULT GETDATE(),
        FechaCierre           DATETIME NULL
    );
    CREATE INDEX IX_Reposiciones_Madre  ON dbo.Reposiciones (OrdenMadreID, Estado);
    CREATE INDEX IX_Reposiciones_Pedido ON dbo.Reposiciones (NoDocERP, Estado);
    CREATE INDEX IX_Reposiciones_Falla  ON dbo.Reposiciones (OrdenFallaID);
    PRINT 'Creada Reposiciones';
END
ELSE PRINT 'Reposiciones ya existe';

-- ── 3. SolicitudesInsumo ─────────────────────────────────────────────────
IF OBJECT_ID('dbo.SolicitudesInsumo', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SolicitudesInsumo (
        SolicitudID        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SolicitudesInsumo PRIMARY KEY,
        ReposicionID       INT NOT NULL,
        Tipo               VARCHAR(20) NOT NULL,     -- TELA_CLIENTE | PRENDA_CLIENTE | PRODUCTO_LOCAL
        Estado             VARCHAR(20) NOT NULL CONSTRAINT DF_SolInsumo_Estado DEFAULT 'NUEVA', -- NUEVA | NOTIFICADA | RESUELTA | SIN_RESPUESTA
        StockEncontrado    NVARCHAR(MAX) NULL,       -- JSON con bobinas/prendas del mismo cliente e insumo al abrir
        NotificadaPortal   BIT NOT NULL CONSTRAINT DF_SolInsumo_Notif DEFAULT 0,
        FechaNotificacion  DATETIME NULL,
        UsuarioNotifica    INT NULL,
        Decision           VARCHAR(20) NULL,         -- USA_STOCK | TRAE_MAS | ACEPTA_PARCIAL | COMPRA_ADMIN
        MedioConfirmacion  NVARCHAR(50) NULL,        -- PORTAL | TELEFONO | MOSTRADOR | OTRO
        DetalleDecision    NVARCHAR(MAX) NULL,
        UsuarioDecision    INT NULL,
        FechaDecision      DATETIME NULL,
        RecepcionID        INT NULL,                 -- PRE vinculada (TRAE_MAS / COMPRA_ADMIN)
        BobinaUsadaID      INT NULL,                 -- bobina del cliente usada (USA_STOCK o la de la PRE)
        PrendaUsadaID      INT NULL,
        Vencimiento        DATETIME NULL,
        UsuarioID          INT NULL,
        FechaCreacion      DATETIME NOT NULL CONSTRAINT DF_SolInsumo_Fecha DEFAULT GETDATE()
    );
    CREATE INDEX IX_SolInsumo_Estado ON dbo.SolicitudesInsumo (Estado);
    CREATE INDEX IX_SolInsumo_Repo   ON dbo.SolicitudesInsumo (ReposicionID);
    PRINT 'Creada SolicitudesInsumo';
END
ELSE PRINT 'SolicitudesInsumo ya existe';

-- ── 4. Columnas nuevas en Ordenes ────────────────────────────────────────
IF COL_LENGTH('dbo.Ordenes', 'OrdenOrigenID') IS NULL
BEGIN
    ALTER TABLE dbo.Ordenes ADD OrdenOrigenID INT NULL;   -- orden madre de la que desciende (-F, -R)
    PRINT 'Agregada Ordenes.OrdenOrigenID';
END
IF COL_LENGTH('dbo.Ordenes', 'EstadoEnvio') IS NULL
BEGIN
    ALTER TABLE dbo.Ordenes ADD EstadoEnvio VARCHAR(20) NULL; -- NULL = SIN_ENVIAR | PARCIAL | COMPLETO
    PRINT 'Agregada Ordenes.EstadoEnvio';
END
IF COL_LENGTH('dbo.Ordenes', 'CantidadEsperada') IS NULL
BEGIN
    ALTER TABLE dbo.Ordenes ADD CantidadEsperada DECIMAL(12,2) NULL; -- solo donde se cuentan prendas/unidades
    PRINT 'Agregada Ordenes.CantidadEsperada';
END
GO
-- (batch aparte: la columna recién agregada tiene que existir antes de compilar el índice y el relleno)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Ordenes_OrdenOrigenID' AND object_id = OBJECT_ID('dbo.Ordenes'))
    CREATE INDEX IX_Ordenes_OrdenOrigenID ON dbo.Ordenes (OrdenOrigenID) WHERE OrdenOrigenID IS NOT NULL;
GO

-- ── 5. Vista del libro de entregas ───────────────────────────────────────
IF OBJECT_ID('dbo.vw_LibroEntregas', 'V') IS NOT NULL DROP VIEW dbo.vw_LibroEntregas;
GO
CREATE VIEW dbo.vw_LibroEntregas AS
SELECT
    o.OrdenID,
    o.CodigoOrden,
    o.NoDocERP,
    o.AreaID,
    o.UM,
    o.Magnitud,
    o.CantidadEsperada,
    ISNULL(o.EstadoEnvio, 'SIN_ENVIAR')                                         AS EstadoEnvio,
    (SELECT COUNT(*) FROM dbo.Logistica_EnvioOrdenes eo WHERE eo.OrdenID = o.OrdenID) AS Envios,
    (SELECT SUM(eo.Cantidad) FROM dbo.Logistica_EnvioOrdenes eo WHERE eo.OrdenID = o.OrdenID) AS CantidadEnviada,
    CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.Logistica_EnvioOrdenes eo WHERE eo.OrdenID = o.OrdenID AND eo.CompletaOrden = 1) THEN 1 ELSE 0 END AS BIT) AS UltimoEnvioMarcado,
    -- Reposiciones abiertas: las registradas en Reposiciones + las órdenes de falla -F del linaje sin registro
    -- (las que crea hoy el control de impresión) que todavía no terminaron.
    (SELECT COUNT(*) FROM dbo.Reposiciones r WHERE r.OrdenMadreID = o.OrdenID AND r.Estado NOT IN ('CERRADA','CANCELADA'))
    + (SELECT COUNT(*) FROM dbo.Ordenes h
         WHERE (h.OrdenOrigenID = o.OrdenID OR (h.OrdenOrigenID IS NULL AND h.CodigoOrden LIKE o.CodigoOrden + '-F[0-9]%'))
           AND h.CodigoOrden LIKE '%-F[0-9]%'
           AND ISNULL(h.Estado,'') NOT IN ('Finalizado','Cancelado','CANCELADO')
           AND ISNULL(h.EstadoenArea,'') NOT IN ('Finalizado','Cancelado')
           AND ISNULL(h.EstadoLogistica,'') <> 'Canasto Reposiciones'
           AND NOT EXISTS (SELECT 1 FROM dbo.Reposiciones r2 WHERE r2.OrdenFallaID = h.OrdenID)) AS ReposicionesAbiertas,
    (SELECT COUNT(*) FROM dbo.Reposiciones r JOIN dbo.SolicitudesInsumo s ON s.ReposicionID = r.ReposicionID
       WHERE r.OrdenMadreID = o.OrdenID AND s.Estado NOT IN ('RESUELTA')) AS SolicitudesAbiertas,
    CAST(CASE WHEN ISNULL(o.EstadoEnvio,'SIN_ENVIAR') = 'PARCIAL'
               OR EXISTS (SELECT 1 FROM dbo.Reposiciones r WHERE r.OrdenMadreID = o.OrdenID AND r.Estado NOT IN ('CERRADA','CANCELADA'))
               OR EXISTS (SELECT 1 FROM dbo.Ordenes h
                          WHERE (h.OrdenOrigenID = o.OrdenID OR (h.OrdenOrigenID IS NULL AND h.CodigoOrden LIKE o.CodigoOrden + '-F[0-9]%'))
                            AND h.CodigoOrden LIKE '%-F[0-9]%'
                            AND ISNULL(h.Estado,'') NOT IN ('Finalizado','Cancelado','CANCELADO')
                            AND ISNULL(h.EstadoenArea,'') NOT IN ('Finalizado','Cancelado')
                            AND ISNULL(h.EstadoLogistica,'') <> 'Canasto Reposiciones'
                            AND NOT EXISTS (SELECT 1 FROM dbo.Reposiciones r2 WHERE r2.OrdenFallaID = h.OrdenID))
              THEN 1 ELSE 0 END AS BIT) AS Incompleta
FROM dbo.Ordenes o;
GO

-- ── 6. Configuración ─────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'AREAS_CADENA_REPOSICION')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('AREAS_CADENA_REPOSICION', 'ADMIN', '');
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'PLAZO_SOLICITUD_INSUMO_DIAS')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('PLAZO_SOLICITUD_INSUMO_DIAS', 'ADMIN', '7');
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'AREAS_FALLA_BANDEJA')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('AREAS_FALLA_BANDEJA', 'ADMIN', 'EMB,EST,TWC,TWT');

-- ── 7. Tipos de falla para las áreas de bandeja ──────────────────────────
DECLARE @areas TABLE (AreaID VARCHAR(20));
INSERT INTO @areas VALUES ('EMB'), ('EST'), ('TWC'), ('TWT');
INSERT INTO dbo.TiposFallas (AreaID, Titulo, DescripcionDefault, EsFrecuente)
SELECT a.AreaID, t.Titulo, t.Descripcion, 1
FROM @areas a
CROSS JOIN (VALUES
    ('Faltante de insumo',          'Vino menos de lo esperado o no vino'),
    ('Insumo con defecto',          'Lo que vino del área anterior no sirve'),
    ('Pieza dañada en esta área',   'Se arruinó trabajándola acá'),
    ('Cantidad incompleta',         'Faltan unidades para completar la orden')
) t (Titulo, Descripcion)
WHERE NOT EXISTS (SELECT 1 FROM dbo.TiposFallas x WHERE x.AreaID = a.AreaID);

-- ── 8. Relleno histórico del linaje (-F / -R) ────────────────────────────
-- raíz = todo lo que está antes del primer "-F<dígito>" o "-R<dígito>" del código
;WITH hijas AS (
    SELECT o.OrdenID, o.CodigoOrden,
           NULLIF(PATINDEX('%-[FR][0-9]%', o.CodigoOrden), 0) AS pos
    FROM dbo.Ordenes o
    WHERE o.OrdenOrigenID IS NULL AND o.CodigoOrden LIKE '%-[FR][0-9]%'
)
UPDATE o SET OrdenOrigenID = m.OrdenID
FROM dbo.Ordenes o
JOIN hijas h ON h.OrdenID = o.OrdenID AND h.pos IS NOT NULL
CROSS APPLY (SELECT TOP 1 m.OrdenID FROM dbo.Ordenes m
             WHERE m.CodigoOrden = LEFT(h.CodigoOrden, h.pos - 1)
             ORDER BY m.OrdenID) m;
PRINT CONCAT('Linaje rellenado: ', @@ROWCOUNT, ' órdenes');

-- ── Verificación ─────────────────────────────────────────────────────────
SELECT 'Logistica_EnvioOrdenes' AS objeto, CASE WHEN OBJECT_ID('dbo.Logistica_EnvioOrdenes','U') IS NULL THEN 0 ELSE 1 END AS existe
UNION ALL SELECT 'Reposiciones', CASE WHEN OBJECT_ID('dbo.Reposiciones','U') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'SolicitudesInsumo', CASE WHEN OBJECT_ID('dbo.SolicitudesInsumo','U') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'vw_LibroEntregas', CASE WHEN OBJECT_ID('dbo.vw_LibroEntregas','V') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'Ordenes.OrdenOrigenID', CASE WHEN COL_LENGTH('dbo.Ordenes','OrdenOrigenID') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'Ordenes.EstadoEnvio', CASE WHEN COL_LENGTH('dbo.Ordenes','EstadoEnvio') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'Ordenes.CantidadEsperada', CASE WHEN COL_LENGTH('dbo.Ordenes','CantidadEsperada') IS NULL THEN 0 ELSE 1 END;
SELECT COUNT(*) AS hijas_con_linaje FROM dbo.Ordenes WHERE OrdenOrigenID IS NOT NULL;
SELECT COUNT(*) AS hijas_sin_linaje FROM dbo.Ordenes WHERE OrdenOrigenID IS NULL AND CodigoOrden LIKE '%-[FR][0-9]%';

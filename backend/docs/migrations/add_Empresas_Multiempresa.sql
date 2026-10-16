/* =====================================================================
   MIGRACIÓN MULTIEMPRESA  —  add_Empresas_Multiempresa.sql
   ---------------------------------------------------------------------
   Crea dbo.Empresas y agrega EmpIdEmpresa SOLO a dbo.DocumentosContables
   (es donde viven las facturas / CFE, el único lugar que necesita saber
   qué empresa emite). El resto de los documentos usan la empresa por
   defecto. La numeración fiscal la da el CAE de SISNET por caja.
   SQL Server. Correr en SSMS o:
       sqlcmd -S <servidor> -d <base> -i add_Empresas_Multiempresa.sql
   Idempotente (re-ejecutable). HACER BACKUP ANTES.
   Rollback: rollback_Empresas_Multiempresa.sql
   ===================================================================== */
SET XACT_ABORT ON;
GO

/* ---------- LOTE 1: tabla Empresas ---------------------------------- */
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
               WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Empresas')
BEGIN
  CREATE TABLE dbo.Empresas (
    EmpIdEmpresa        int IDENTITY(1,1) NOT NULL
        CONSTRAINT PK_Empresas PRIMARY KEY,
    -- Identidad / cabecera del comprobante --
    EmpRuc              varchar(20)   NOT NULL,
    EmpRazonSocial      nvarchar(255) NOT NULL,   -- razón social legal (socios)
    EmpNombreFantasia   nvarchar(255) NULL,       -- "Centro de Impresión Digital"
    EmpSlogan           nvarchar(200) NULL,
    EmpDireccion        nvarchar(255) NULL,
    EmpCiudad           nvarchar(100) NULL,
    EmpDepartamento     nvarchar(100) NULL,
    EmpPais             nvarchar(50)  NOT NULL CONSTRAINT DF_Emp_Pais  DEFAULT('Uruguay'),
    EmpTelefono         varchar(50)   NULL,
    EmpEmail            varchar(150)  NULL,
    EmpWeb              varchar(150)  NULL,
    EmpLogoUrl          varchar(300)  NULL,       -- p.ej. /assets/images/logo/u.png
    EmpColorPrimario    varchar(10)   NULL CONSTRAINT DF_Emp_Color DEFAULT('#0d47a1'),
    -- Config SISNET POR EMPRESA (Opción B) --
    EmpSisnetWsdlUrl    varchar(500)  NULL,
    EmpSisnetUser       varchar(100)  NULL,
    EmpSisnetPass       varchar(255)  NULL,       -- CIFRADO (AES-GCM). NUNCA texto plano.
    EmpSisnetCaja       varchar(50)   NULL,       -- claveUnicaCaja / punto de emisión
    EmpSisnetTasaBasica varchar(50)   NULL CONSTRAINT DF_Emp_TB DEFAULT('tasa_basica'),
    EmpSisnetTasaMinima varchar(50)   NULL CONSTRAINT DF_Emp_TM DEFAULT('tasa_Minima'),
    -- Control --
    EmpActiva           bit NOT NULL CONSTRAINT DF_Emp_Activa DEFAULT(1),
    EmpPorDefecto       bit NOT NULL CONSTRAINT DF_Emp_Def    DEFAULT(0),
    EmpFechaAlta        datetime NOT NULL CONSTRAINT DF_Emp_Fecha DEFAULT(GETDATE())
  );
  PRINT 'OK: tabla dbo.Empresas creada';
END
ELSE PRINT 'INFO: dbo.Empresas ya existe';
GO

/* ---------- LOTE 2: seed Empresa 1 (actual) + Empresa 2 (plantilla) -- */
IF NOT EXISTS (SELECT 1 FROM dbo.Empresas WHERE EmpRuc='218973270018')
BEGIN
  -- Empresa 1 = la que factura hoy. Los campos SISNET replican el .env actual.
  -- EmpSisnetPass queda NULL => el servicio usa el fallback del .env (comportamiento idéntico a hoy).
  INSERT INTO dbo.Empresas
    (EmpRuc, EmpRazonSocial, EmpNombreFantasia, EmpDireccion, EmpCiudad, EmpDepartamento,
     EmpLogoUrl, EmpSisnetWsdlUrl, EmpSisnetUser, EmpSisnetPass, EmpSisnetCaja,
     EmpActiva, EmpPorDefecto)
  VALUES
    ('218973270018',
     'LALINDE MORALES HECTOR ARTIGAS, LALINDE FALERO FELIPE Y OTROS',
     'Centro de Impresión Digital',
     'VILARDEBO 2031', 'MONTEVIDEO', 'Montevideo',
     NULL,  -- EmpLogoUrl vacío = usa el wordmark "user"+CMYK actual; la Empresa 2 carga su propio logo (PNG)
     'http://test.sisnet.com.uy:8062/EfacturaWeb/wsService?wsdl',
     'admin', NULL, '1/TEST',
     1, 1);   -- Activa, Por defecto

  -- Empresa 2: PLANTILLA INACTIVA. Completar RUC/datos/credenciales y activar desde el ABM.
  INSERT INTO dbo.Empresas
    (EmpRuc, EmpRazonSocial, EmpNombreFantasia, EmpActiva, EmpPorDefecto)
  VALUES
    ('000000000000', 'SEGUNDA EMPRESA (COMPLETAR)', 'Completar', 0, 0);

  PRINT 'OK: empresas sembradas (Empresa 1 activa/por defecto, Empresa 2 plantilla inactiva)';
END
ELSE PRINT 'INFO: seed de empresas ya aplicado';
GO

/* ---------- LOTE 3: exactamente UNA empresa por defecto ------------- */
-- Índice único filtrado: como máximo una fila con EmpPorDefecto=1.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UQ_Empresa_PorDefecto')
BEGIN
  CREATE UNIQUE INDEX UQ_Empresa_PorDefecto
    ON dbo.Empresas(EmpPorDefecto)
    WHERE EmpPorDefecto = 1;
  PRINT 'OK: índice único UQ_Empresa_PorDefecto creado';
END
ELSE PRINT 'INFO: UQ_Empresa_PorDefecto ya existe';
GO

/* ---------- LOTE 4: columna EmpIdEmpresa SOLO en DocumentosContables -
   Es el único lugar que necesita el emisor. Las facturas viven acá.
   (TransaccionesCaja NO la lleva: la caja física es una sola y el efectivo
    no se separa por empresa. SecuenciaDocumentos tampoco: la numeración
    fiscal la da SISNET por caja.) */
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_NAME='DocumentosContables' AND COLUMN_NAME='EmpIdEmpresa')
   ALTER TABLE dbo.DocumentosContables ADD EmpIdEmpresa int NULL;
GO
PRINT 'OK: columna EmpIdEmpresa agregada a DocumentosContables (idempotente)';
GO

/* ---------- LOTE 5: backfill — documentos existentes = por defecto -- */
DECLARE @def int = (SELECT TOP 1 EmpIdEmpresa FROM dbo.Empresas
                    WHERE EmpPorDefecto=1 ORDER BY EmpIdEmpresa);
IF @def IS NULL
BEGIN
  RAISERROR('No hay empresa por defecto; abortando backfill.', 16, 1);
  RETURN;
END

UPDATE dbo.DocumentosContables SET EmpIdEmpresa=@def WHERE EmpIdEmpresa IS NULL;
PRINT 'OK: backfill DocumentosContables con EmpIdEmpresa por defecto = ' + CAST(@def AS varchar(10));
GO

/* ---------- LOTE 6: red de seguridad (DEFAULT) + índice ------------- */
-- DEFAULT=1: si un INSERT olvida setear la empresa, cae en la primera (por defecto).
IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name='DF_Doc_Emp')
   ALTER TABLE dbo.DocumentosContables ADD CONSTRAINT DF_Doc_Emp DEFAULT (1) FOR EmpIdEmpresa;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Doc_Emp')
   CREATE INDEX IX_Doc_Emp ON dbo.DocumentosContables(EmpIdEmpresa);
GO
PRINT 'OK: default e índice creados';
GO

/* ---------- LOTE 7 (OPCIONAL): FK real ----------------------------------
   Tu repo usa FKs lógicas (no declaradas). Descomentá si querés integridad
   referencial dura. Requiere que el backfill haya dejado 0 filas NULL.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_Doc_Emp')
   ALTER TABLE dbo.DocumentosContables WITH CHECK
   ADD CONSTRAINT FK_Doc_Emp FOREIGN KEY (EmpIdEmpresa) REFERENCES dbo.Empresas(EmpIdEmpresa);
GO
------------------------------------------------------------------------- */

PRINT '===== Migración multiempresa COMPLETADA =====';
GO

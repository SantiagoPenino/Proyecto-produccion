/* =====================================================================
   PRODUCCIÓN — MULTIEMPRESA + PARÁMETROS DGI  (script consolidado)
   Fecha: 03/07/2026
   ---------------------------------------------------------------------
   Incluye:
     1. Tabla dbo.Empresas + seed POBLADO:
        - Empresa 1 (LALINDE / Centro de Impresión Digital) con la config
          SISNET del ambiente dedicado (mail SISNET 03/07/2026).
        - Empresa 2 (FEMTEX SAS) sin config SISNET (pendiente de SISNET).
     2. Columna EmpIdEmpresa SOLO en dbo.DocumentosContables + backfill.
     3. Índice único de empresa por defecto + índice + DEFAULT.
     4. Parámetros DGI en ConfiguracionGlobal (umbral 10.000 UI, valor UI)
        con la convención de la casa: AreaID = 'ADMIN'.
     5. Verificaciones finales.

   Correr en SSMS o: sqlcmd -S <servidor> -d <base> -i este_archivo.sql
   IDEMPOTENTE (re-ejecutable). ⚠️ HACER BACKUP ANTES.
   Rollback: rollback_Empresas_Multiempresa.sql

   ⚠️ CONTRASEÑAS SISNET: NO van por SQL (quedarían en texto plano).
      Cargarlas después del deploy en Configuración → Empresas (se cifran
      con SISNET_ENC_KEY), o dejar NULL para usar el fallback del backend/.env.
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
    EmpRazonSocial      nvarchar(255) NOT NULL,
    EmpNombreFantasia   nvarchar(255) NULL,
    EmpSlogan           nvarchar(200) NULL,
    EmpDireccion        nvarchar(255) NULL,
    EmpCiudad           nvarchar(100) NULL,
    EmpDepartamento     nvarchar(100) NULL,
    EmpPais             nvarchar(50)  NOT NULL CONSTRAINT DF_Emp_Pais  DEFAULT('Uruguay'),
    EmpTelefono         varchar(50)   NULL,
    EmpEmail            varchar(150)  NULL,
    EmpWeb              varchar(150)  NULL,
    EmpLogoUrl          varchar(300)  NULL,       -- PNG/JPG (el PDF NO soporta SVG); NULL = wordmark "user"+CMYK
    EmpColorPrimario    varchar(10)   NULL CONSTRAINT DF_Emp_Color DEFAULT('#0d47a1'),
    -- Config SISNET POR EMPRESA --
    EmpSisnetWsdlUrl    varchar(500)  NULL,
    EmpSisnetUser       varchar(100)  NULL,
    EmpSisnetPass       varchar(255)  NULL,       -- CIFRADO (AES-GCM) vía ABM. NUNCA texto plano.
    EmpSisnetCaja       varchar(50)   NULL,       -- claveUnicaCaja / punto de emisión (NO es el RUC)
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

/* ---------- LOTE 2: seed POBLADO ------------------------------------ */
-- Empresa 1 = LALINDE (la que factura hoy) — ambiente SISNET dedicado (mail 03/07/2026)
-- ⚠️ Lunes 06/07 (go-live): confirmar con SISNET si URL o Clave Única cambian al
--    apuntar a DGI real; si cambian, actualizarlas desde Configuración → Empresas.
IF NOT EXISTS (SELECT 1 FROM dbo.Empresas WHERE EmpRuc='218973270018')
BEGIN
  INSERT INTO dbo.Empresas
    (EmpRuc, EmpRazonSocial, EmpNombreFantasia, EmpDireccion, EmpCiudad, EmpDepartamento,
     EmpLogoUrl, EmpSisnetWsdlUrl, EmpSisnetUser, EmpSisnetPass, EmpSisnetCaja,
     EmpActiva, EmpPorDefecto)
  VALUES
    ('218973270018',
     'LALINDE MORALES HECTOR ARTIGAS, LALINDE FALERO FELIPE Y OTROS',
     'Centro de Impresión Digital',
     'VILARDEBO 2031', 'MONTEVIDEO', 'Montevideo',
     '/assets/images/logo/u-simple-black.png',
     'http://cloud.datacenter.sisnetsoftware.com.uy:10413/EfacturaWeb/wsService?wsdl',
     'lalinde',
     NULL,                -- contraseña: cargar por ABM post-deploy (o fallback .env)
     'LALINDE/TEST',      -- Clave Única del mail de SISNET
     1, 1);               -- Activa + POR DEFECTO
  PRINT 'OK: Empresa 1 (LALINDE) sembrada';
END
ELSE PRINT 'INFO: Empresa 1 ya existe';
GO

-- Empresa 2 = FEMTEX SAS — SIN config SISNET (pedir a SISNET su ambiente/clave única).
-- Queda ACTIVA para poder seleccionarla en la factura (PDF), pero el envío a DGI
-- está BLOQUEADO por el sistema hasta que tenga EmpSisnetCaja cargada.
IF NOT EXISTS (SELECT 1 FROM dbo.Empresas WHERE EmpRuc='219902540010')
BEGIN
  INSERT INTO dbo.Empresas
    (EmpRuc, EmpRazonSocial, EmpNombreFantasia, EmpActiva, EmpPorDefecto)
  VALUES
    ('219902540010', 'FEMTEX SAS', 'FEMTEX SAS', 1, 0);
  PRINT 'OK: Empresa 2 (FEMTEX SAS) sembrada';
END
ELSE PRINT 'INFO: Empresa 2 ya existe';
GO

/* ---------- LOTE 3: exactamente UNA empresa por defecto ------------- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UQ_Empresa_PorDefecto')
BEGIN
  CREATE UNIQUE INDEX UQ_Empresa_PorDefecto
    ON dbo.Empresas(EmpPorDefecto)
    WHERE EmpPorDefecto = 1;
  PRINT 'OK: índice único UQ_Empresa_PorDefecto creado';
END
ELSE PRINT 'INFO: UQ_Empresa_PorDefecto ya existe';
GO

/* ---------- LOTE 4: columna EmpIdEmpresa SOLO en DocumentosContables - */
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_NAME='DocumentosContables' AND COLUMN_NAME='EmpIdEmpresa')
   ALTER TABLE dbo.DocumentosContables ADD EmpIdEmpresa int NULL;
GO
PRINT 'OK: columna EmpIdEmpresa en DocumentosContables (idempotente)';
GO

/* ---------- LOTE 5: backfill — documentos existentes = empresa por defecto */
DECLARE @def int = (SELECT TOP 1 EmpIdEmpresa FROM dbo.Empresas
                    WHERE EmpPorDefecto=1 ORDER BY EmpIdEmpresa);
IF @def IS NULL
BEGIN
  RAISERROR('No hay empresa por defecto; abortando backfill.', 16, 1);
  RETURN;
END
UPDATE dbo.DocumentosContables SET EmpIdEmpresa=@def WHERE EmpIdEmpresa IS NULL;
PRINT 'OK: backfill de DocumentosContables completado';
GO

/* ---------- LOTE 6: DEFAULT + índice -------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name='DF_Doc_Emp')
   ALTER TABLE dbo.DocumentosContables ADD CONSTRAINT DF_Doc_Emp DEFAULT (1) FOR EmpIdEmpresa;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Doc_Emp')
   CREATE INDEX IX_Doc_Emp ON dbo.DocumentosContables(EmpIdEmpresa);
GO
PRINT 'OK: default e índice creados';
GO

/* ---------- LOTE 7: parámetros DGI (Unidades Indexadas) ------------- */
-- Umbral para identificar al comprador en e-Tickets: DGI_LIMITE_UI × DGI_VALOR_UI.
-- Editables luego desde Configuración → Empresas → "Parámetros DGI" (sin rebuild).
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave='DGI_LIMITE_UI')
  INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('DGI_LIMITE_UI', 'ADMIN', '10000');
ELSE
  UPDATE dbo.ConfiguracionGlobal SET Valor='10000' WHERE Clave='DGI_LIMITE_UI';

IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave='DGI_VALOR_UI')
  INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('DGI_VALOR_UI', 'ADMIN', '6.5321');
ELSE
  UPDATE dbo.ConfiguracionGlobal SET Valor='6.5321' WHERE Clave='DGI_VALOR_UI';
PRINT 'OK: parámetros DGI sembrados (DGI_LIMITE_UI=10000, DGI_VALOR_UI=6.5321)';
GO

/* ---------- LOTE 8: VERIFICACIONES (revisar resultados) -------------- */
-- 8.1 Empresas: LALINDE debe ser EmpIdEmpresa=1, Activa=1, PorDefecto=1
SELECT EmpIdEmpresa, EmpRuc, EmpNombreFantasia, EmpActiva, EmpPorDefecto,
       EmpSisnetUser, EmpSisnetCaja, EmpSisnetWsdlUrl
FROM dbo.Empresas ORDER BY EmpIdEmpresa;

-- 8.2 Documentos sin empresa: debe dar 0
SELECT COUNT(*) AS DocsSinEmpresa FROM dbo.DocumentosContables WHERE EmpIdEmpresa IS NULL;

-- 8.3 Parámetros DGI: deben aparecer las 2 filas con AreaID=ADMIN
SELECT Clave, AreaID, Valor FROM dbo.ConfiguracionGlobal WHERE Clave LIKE 'DGI_%';

-- 8.4 Mapeo de numeración unificada (07/08 → una secuencia; 01/02 → otra)
SELECT c.CodDocumento, LTRIM(RTRIM(c.Detalle)) AS Detalle, c.SecIdSecuencia,
       s.SecPrefijo, s.SecUltimoNumero
FROM dbo.Config_TiposDocumento c
LEFT JOIN dbo.SecuenciaDocumentos s ON s.SecIdSecuencia = c.SecIdSecuencia
WHERE c.CodDocumento IN ('01','02','07','08');
GO

PRINT '===== SCRIPT DE PRODUCCIÓN COMPLETADO — revisar los 4 SELECT de verificación =====';
GO

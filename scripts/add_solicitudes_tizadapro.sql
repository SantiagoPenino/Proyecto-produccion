/* ══════════════════════════════════════════════════════════════════════════
   SOLICITUDES DE VENDEDORES — tizadas de TizadaPro vinculadas a la solicitud
   ══════════════════════════════════════════════════════════════════════════
   TizadaPro (base TizadaPro, mismo servidor SQL) genera la tizada; nosotros SOLO
   la leemos. El vínculo con la solicitud se guarda de NUESTRO lado porque
   TizadaPro borra sus trabajos viejos (va por el trabajo 2148 y guarda 1).

   Qué hace (idempotente, solo agrega):
     A. Tabla dbo.SolicitudesVendedorTizadas: qué trabajo de TizadaPro se usó en
        la producción principal de un producto, con una COPIA del resultado
        (hojas por tela, consumo, ancho, piezas) tomada al vincular.
     B. SolicitudesVendedorArchivos.TizadaID / TizadaHoja: el PDF que el
        diseñador sube a mano queda atado a la hoja de la tizada de la que salió
        (de ahí salen la tela, el ancho y los metros, no de medir el archivo).

   Requisito aparte, en PRODUCCIÓN: el usuario SQL del backend necesita permiso
   de LECTURA sobre la base TizadaPro (ver sección C, comentada).
   Orden: correr ANTES del deploy del backend. Correrlo dos veces no cambia nada.
   ══════════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
GO

/* ── A. Tabla de tizadas vinculadas ────────────────────────────────────── */
IF OBJECT_ID('dbo.SolicitudesVendedorTizadas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SolicitudesVendedorTizadas (
        TizadaID       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SolVenTizadas PRIMARY KEY,
        SolicitudID    INT            NOT NULL,
        ProductoSolID  INT            NOT NULL,
        ParteID        INT            NOT NULL,              -- la producción principal (sublimación)
        TrabajoID      INT            NOT NULL,              -- TizadaPro.dbo.trabajo.id
        TrabajoRef     NVARCHAR(128)  NULL,                  -- TizadaPro.dbo.trabajo.legacy_id (ej. 20260925-151147-1819)
        MoldeRef       NVARCHAR(800)  NULL,                  -- trabajo.moldes (id del molde en TizadaPro)
        MoldeNombre    NVARCHAR(800)  NULL,
        Piezas         INT            NULL,
        FechaTizada    DATETIME2      NULL,                  -- cuándo se generó en TizadaPro
        ResultadoJson  NVARCHAR(MAX)  NOT NULL,              -- copia del resultado al momento de vincular
        Vigente        BIT            NOT NULL CONSTRAINT DF_SolVenTizadas_Vigente DEFAULT (1),
        UsuarioVincula INT            NULL,
        FechaVincula   DATETIME       NOT NULL CONSTRAINT DF_SolVenTizadas_Fecha DEFAULT (GETDATE())
    );
    CREATE INDEX IX_SolVenTizadas_Solicitud ON dbo.SolicitudesVendedorTizadas (SolicitudID, Vigente);
    PRINT 'A. Tabla dbo.SolicitudesVendedorTizadas creada.';
END
ELSE PRINT 'A. dbo.SolicitudesVendedorTizadas ya existía.';
GO

/* ── B. Archivo ← hoja de la tizada ────────────────────────────────────── */
IF COL_LENGTH('dbo.SolicitudesVendedorArchivos', 'TizadaID') IS NULL
BEGIN
    ALTER TABLE dbo.SolicitudesVendedorArchivos ADD TizadaID INT NULL, TizadaHoja NVARCHAR(260) NULL;
    PRINT 'B. Columnas SolicitudesVendedorArchivos.TizadaID / TizadaHoja agregadas.';
END
ELSE PRINT 'B. SolicitudesVendedorArchivos.TizadaID ya existía.';
GO

/* ── C. PRODUCCIÓN: permiso de lectura sobre TizadaPro ─────────────────────
   Reemplazar <usuario_backend> por el login que usa el backend (DB_USER del .env)
   y correr UNA vez. En local no hace falta si el backend entra como sysadmin.

USE TizadaPro;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '<usuario_backend>')
    CREATE USER [<usuario_backend>] FOR LOGIN [<usuario_backend>];
ALTER ROLE db_datareader ADD MEMBER [<usuario_backend>];
*/

/* ── D. Verificación ───────────────────────────────────────────────────── */
SELECT
    CASE WHEN OBJECT_ID('dbo.SolicitudesVendedorTizadas', 'U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS TablaTizadas,
    CASE WHEN COL_LENGTH('dbo.SolicitudesVendedorArchivos', 'TizadaID') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS ColumnaArchivo,
    CASE WHEN DB_ID('TizadaPro') IS NOT NULL THEN 'OK' ELSE 'NO ESTÁ EN ESTE SERVIDOR' END AS BaseTizadaPro;
GO

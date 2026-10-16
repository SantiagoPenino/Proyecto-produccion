/* =============================================================================
   add_EnvioEmail.sql
   -----------------------------------------------------------------------------
   Historial ÚNICO de correos enviados por el sistema, para cualquier módulo.

   POR QUÉ GENÉRICA:
   Arranca con el envío del PDF de la Bandeja CFE, pero la idea es que ahí caigan
   también los estados de cuenta, los recibos y lo que venga. Si cada módulo se
   armara su propia tabla, no habría forma de contestar "¿qué le mandamos a este
   cliente?" sin unir cinco lugares distintos.

   CÓMO SE IDENTIFICA CADA ENVÍO:
     EEmModulo → de qué parte del sistema salió ('CFE', 'ESTADO_CUENTA', ...)
     EEmRefId  → el id dentro de ese módulo (DocIdDocumento, ColIdCola, ...)
   No hay foreign key a propósito: la referencia apunta a tablas distintas según
   el módulo, así que la integridad la garantiza el código y no una FK que sería
   imposible de declarar.

   EEmCliIdCliente se guarda aparte para poder listar todo lo enviado a un cliente
   sin importar de qué módulo salió (sirve para el Panel 360).

   Se guarda una fila POR INTENTO, incluidos los fallidos: un envío que rebotó es
   justamente lo que hay que poder ver. Y se guarda el destinatario REAL usado, no
   el de la ficha: si el operador lo corrigió a mano, lo que importa es a dónde fue.

   Es aditiva: el código funciona igual antes y después (si la tabla no existe, el
   correo sale lo mismo y solo no queda registrado).

   Correr una sola vez en la base de PRODUCCIÓN.
   ============================================================================= */

USE SecureAppDB;
GO

SET NOCOUNT ON;

IF OBJECT_ID('dbo.EnvioEmail', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.EnvioEmail (
        EEmIdEnvio      INT            IDENTITY(1,1) NOT NULL,
        -- Origen del envío
        EEmModulo       VARCHAR(30)    NOT NULL,      -- CFE | ESTADO_CUENTA | RECIBO | ...
        EEmRefId        INT            NULL,          -- id dentro de ese módulo
        EEmRefTexto     NVARCHAR(120)  NULL,          -- referencia legible: "E-Factura Serie A N° 27614"
        EEmCliIdCliente INT            NULL,          -- para ver todo lo enviado a un cliente
        -- Qué se mandó y a quién
        EEmDestinatario NVARCHAR(200)  NOT NULL,
        EEmAsunto       NVARCHAR(300)  NULL,
        EEmAdjunto      NVARCHAR(200)  NULL,          -- nombre del archivo adjunto
        -- Resultado
        EEmEstado       VARCHAR(20)    NOT NULL,      -- ENVIADO | SIMULADO | ERROR
        EEmProveedor    VARCHAR(20)    NULL,          -- resend | brevo
        EEmError        NVARCHAR(500)  NULL,
        -- Auditoría
        EEmFecha        DATETIME       NOT NULL CONSTRAINT DF_EEm_Fecha DEFAULT (GETDATE()),
        EEmUsuarioAlta  INT            NULL,
        CONSTRAINT PK_EnvioEmail PRIMARY KEY CLUSTERED (EEmIdEnvio)
    );

    -- "¿Cuál fue el último envío de este documento?" — se pregunta por CADA fila del
    -- listado de la bandeja: sin este índice, cada listado escanea la tabla entera.
    CREATE NONCLUSTERED INDEX IX_EnvioEmail_Ref
        ON dbo.EnvioEmail (EEmModulo, EEmRefId, EEmFecha DESC);

    -- "¿Qué le mandamos a este cliente?" (Panel 360)
    CREATE NONCLUSTERED INDEX IX_EnvioEmail_Cliente
        ON dbo.EnvioEmail (EEmCliIdCliente, EEmFecha DESC);

    PRINT 'Tabla dbo.EnvioEmail creada.';
END
ELSE
    PRINT 'La tabla dbo.EnvioEmail ya existe: no se modifica.';
GO

/* ── Migración desde la versión anterior, atada solo a facturas ──────────────
   dbo.DocumentoEnvioEmail fue el primer intento (add_DocumentoEnvioEmail.sql).
   Si llegó a crearse, se copian sus filas y se la renombra en vez de borrarla:
   así queda el respaldo por si hubiera que mirarlo. Se puede eliminar a mano
   más adelante con:  DROP TABLE dbo.DocumentoEnvioEmail_migrado;              */
IF OBJECT_ID('dbo.DocumentoEnvioEmail', 'U') IS NOT NULL
BEGIN
    DECLARE @copiadas INT = 0;

    INSERT INTO dbo.EnvioEmail
        (EEmModulo, EEmRefId, EEmDestinatario, EEmAsunto, EEmEstado,
         EEmProveedor, EEmError, EEmFecha, EEmUsuarioAlta)
    SELECT 'CFE', v.DocIdDocumento, v.DEmDestinatario, v.DEmAsunto, v.DEmEstado,
           v.DEmProveedor, v.DEmError, v.DEmFecha, v.DEmUsuarioAlta
    FROM dbo.DocumentoEnvioEmail v
    WHERE NOT EXISTS (
        SELECT 1 FROM dbo.EnvioEmail e
        WHERE e.EEmModulo = 'CFE' AND e.EEmRefId = v.DocIdDocumento AND e.EEmFecha = v.DEmFecha
    );
    SET @copiadas = @@ROWCOUNT;

    EXEC sp_rename 'dbo.DocumentoEnvioEmail', 'DocumentoEnvioEmail_migrado';
    PRINT 'Migración: ' + CAST(@copiadas AS VARCHAR(10))
        + ' fila(s) copiadas. La tabla vieja quedó como dbo.DocumentoEnvioEmail_migrado.';
END
ELSE
    PRINT 'No existe dbo.DocumentoEnvioEmail: nada que migrar.';
GO

/* Verificación */
SELECT TOP 10 EEmIdEnvio, EEmModulo, EEmRefId, EEmRefTexto, EEmDestinatario,
              EEmEstado, EEmProveedor, EEmFecha
FROM dbo.EnvioEmail
ORDER BY EEmIdEnvio DESC;

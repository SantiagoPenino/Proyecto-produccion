-- Servicio Técnico: borrar TODAS las solicitudes (son de prueba) y lo que cuelga de ellas.
--   * Historial de cada solicitud, adjuntos (filas) y avisos de la campanita que abren una solicitud.
--   * Los cambios de máquina y usos de insumos que apunten a una solicitud quedan, sin la referencia
--     (los insumos ya se descontaron del stock: eso no se devuelve acá).
--   * Los tickets viejos (TicketsMantenimiento) que se copiaron: si quedan, st-etapa1.sql los vuelve
--     a copiar cuando se corre de nuevo. Ya no los usa nada del sistema.
--   * Si no queda ninguna solicitud, la numeración vuelve a arrancar en ST-00001.
-- Para borrar solo algunas, cambiar el SELECT que llena @Sol (ej. WHERE SolId IN (1, 2) o
-- WHERE LegacyTicketId IS NOT NULL para solo las copiadas del sistema anterior).
-- Los archivos adjuntos en disco quedan en <ST_ADJUNTOS_PATH>/solicitud/<SolId>: borrarlos a mano si hay.
USE SecureAppDB;
GO
SET XACT_ABORT ON;
IF OBJECT_ID('dbo.ST_InsumosUso') IS NULL
BEGIN
    PRINT 'Faltan las tablas de Servicio Técnico (scripts st-etapa1..4): no se hace nada.';
    RETURN;
END

BEGIN TRAN;

DECLARE @Sol TABLE (SolId INT PRIMARY KEY, LegacyTicketId VARCHAR(20) NULL);
INSERT INTO @Sol (SolId, LegacyTicketId)
SELECT SolId, LegacyTicketId FROM dbo.ST_Solicitudes;

-- Lo que se va a borrar
SELECT x.SolId, x.Titulo, x.Estado, x.LegacyTicketId, x.FechaSolicitud
FROM dbo.ST_Solicitudes x JOIN @Sol s ON s.SolId = x.SolId
ORDER BY x.SolId;

DELETE h FROM dbo.ST_Historial h JOIN @Sol s ON h.Entidad = 'SOLICITUD' AND h.EntidadId = s.SolId;
PRINT CONCAT(@@ROWCOUNT, ' filas de historial de solicitudes borradas');

DELETE a FROM dbo.ST_Adjuntos a JOIN @Sol s ON a.Entidad = 'SOLICITUD' AND a.EntidadId = s.SolId;
PRINT CONCAT(@@ROWCOUNT, ' adjuntos borrados (filas)');

DELETE n FROM dbo.NotificacionesUsuario n JOIN @Sol s ON n.Url = CONCAT('/servicio-tecnico?sol=', s.SolId);
PRINT CONCAT(@@ROWCOUNT, ' avisos borrados');

UPDATE c SET SolId = NULL FROM dbo.ST_CambiosEquipo c JOIN @Sol s ON c.SolId = s.SolId;
PRINT CONCAT(@@ROWCOUNT, ' cambios de máquina quedan sin la solicitud');

UPDATE u SET SolId = NULL FROM dbo.ST_InsumosUso u JOIN @Sol s ON u.SolId = s.SolId;
PRINT CONCAT(@@ROWCOUNT, ' usos de insumos quedan sin la solicitud');

DELETE x FROM dbo.ST_Solicitudes x JOIN @Sol s ON x.SolId = s.SolId;
PRINT CONCAT(@@ROWCOUNT, ' solicitudes borradas');

DELETE t FROM dbo.TicketsMantenimiento t JOIN @Sol s ON t.TicketID = s.LegacyTicketId;
PRINT CONCAT(@@ROWCOUNT, ' tickets viejos borrados');

COMMIT;

IF NOT EXISTS (SELECT 1 FROM dbo.ST_Solicitudes)
    DBCC CHECKIDENT ('dbo.ST_Solicitudes', RESEED, 0);   -- la próxima es ST-00001

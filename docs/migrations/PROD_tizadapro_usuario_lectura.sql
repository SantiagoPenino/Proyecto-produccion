/* ══════════════════════════════════════════════════════════════════════════
   PRODUCCIÓN — usuario de SOLO LECTURA para la base TizadaPro (13-oct-2026)
   ══════════════════════════════════════════════════════════════════════════
   Para que el sistema (en local, por el túnel 127.0.0.1,1434) LEA la base de TIZADA PRO
   de producción sin usar "sa". Este usuario solo puede hacer SELECT en TizadaPro:
   no puede escribir ahí ni ver SecureAppDB.

   Antes de correrlo: cambiá  CAMBIAR_ESTA_CLAVE  por una contraseña fuerte.
   Después, en backend/.env:  TIZADAPRO_DB_USER=tizadapro_lectura  y  TIZADAPRO_DB_PASSWORD=<esa clave>.
   Correrlo dos veces no cambia nada la segunda vez.
   ══════════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
USE [master];
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'tizadapro_lectura')
BEGIN
    CREATE LOGIN [tizadapro_lectura] WITH PASSWORD = 'CAMBIAR_ESTA_CLAVE', CHECK_POLICY = ON, DEFAULT_DATABASE = [TizadaPro];
    PRINT 'Login tizadapro_lectura creado.';
END
ELSE PRINT 'Login tizadapro_lectura ya existía.';
GO
USE [TizadaPro];
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'tizadapro_lectura')
BEGIN
    CREATE USER [tizadapro_lectura] FOR LOGIN [tizadapro_lectura];
    PRINT 'Usuario tizadapro_lectura creado en TizadaPro.';
END
ALTER ROLE [db_datareader] ADD MEMBER [tizadapro_lectura];
PRINT 'tizadapro_lectura: solo lectura (db_datareader) en TizadaPro.';
GO
/* Verificación: tiene que decir db_datareader y nada más */
SELECT dp.name AS usuario, r.name AS rol
FROM sys.database_role_members m
JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
JOIN sys.database_principals dp ON dp.principal_id = m.member_principal_id
WHERE dp.name = 'tizadapro_lectura';
GO

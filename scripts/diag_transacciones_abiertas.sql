/* ============================================================================
   SOLO LECTURA — ¿Qué transacciones hay abiertas en producción y quién bloquea a quién?
   Correr en SSMS contra el servidor de producción. No modifica nada.

   Cómo leerlo:
     · Bloque A: si en la ventana donde corriste un script te da > 0, esa ventana tiene
       una transacción abierta. Cerrala con:   ROLLBACK TRANSACTION;
       (deshace lo que ese script hizo dentro de la transacción; no toca nada más).
     · Bloque B: una fila por sesión con transacción abierta en todo el servidor.
       program_name 'Microsoft SQL Server Management Studio - Query' = una ventana de SSMS;
       'node' / 'tedious' = el backend de la aplicación (NO matar).
     · Bloque C: la transacción abierta más vieja de la base (DBCC OPENTRAN).
     · Bloque D: sesiones bloqueadas y quién las bloquea.
   Para cerrar una transacción de OTRA ventana de SSMS que quedó colgada:
     KILL <session_id>;   -- solo si es tuya (host_name / login_name) y es SSMS, nunca la app
   ============================================================================ */
USE [SecureAppDB];
SET NOCOUNT ON;

/* A · Esta ventana. En una ventana NUEVA tiene que dar 0 y 0. Si ImplicitTransactions da 1,
      SSMS abre una transacción con cada sentencia y las deja colgadas hasta un COMMIT/ROLLBACK:
      Tools > Options > Query Execution > SQL Server > ANSI > destildar SET IMPLICIT_TRANSACTIONS. */
SELECT Bloque = 'A', TransaccionesAbiertasEnEstaVentana = @@TRANCOUNT, Sesion = @@SPID,
       ImplicitTransactions = CASE WHEN (@@OPTIONS & 2) = 2 THEN 1 ELSE 0 END;

/* B · Todas las sesiones con transacción abierta */
SELECT Bloque = 'B',
       s.session_id, s.login_name, s.host_name, s.program_name, s.status,
       s.open_transaction_count,
       at.transaction_id, at.name AS transaccion, at.transaction_begin_time,
       MinutosAbierta = DATEDIFF(MINUTE, at.transaction_begin_time, GETDATE()),
       Base = DB_NAME(dt.database_id),
       r.blocking_session_id, r.wait_type, r.command,
       UltimoSQL = SUBSTRING(st.text, 1, 300)
FROM sys.dm_exec_sessions s
JOIN sys.dm_tran_session_transactions t ON t.session_id = s.session_id
JOIN sys.dm_tran_active_transactions at ON at.transaction_id = t.transaction_id
LEFT JOIN sys.dm_tran_database_transactions dt ON dt.transaction_id = t.transaction_id AND dt.database_id = DB_ID('SecureAppDB')
LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
LEFT JOIN sys.dm_exec_connections c ON c.session_id = s.session_id
OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) st
WHERE s.is_user_process = 1
ORDER BY at.transaction_begin_time;

/* C · La más vieja de la base */
DBCC OPENTRAN('SecureAppDB');

/* D · Bloqueos vigentes */
SELECT Bloque = 'D',
       Bloqueada = r.session_id, Bloqueador = r.blocking_session_id,
       r.wait_type, SegundosEsperando = r.wait_time / 1000, r.command, Base = DB_NAME(r.database_id),
       ProgramaBloqueado = sb.program_name, ProgramaBloqueador = sk.program_name, HostBloqueador = sk.host_name,
       SQLBloqueado = SUBSTRING(st.text, 1, 300)
FROM sys.dm_exec_requests r
LEFT JOIN sys.dm_exec_sessions sb ON sb.session_id = r.session_id
LEFT JOIN sys.dm_exec_sessions sk ON sk.session_id = r.blocking_session_id
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) st
WHERE r.blocking_session_id <> 0;

/* E · Candados sobre las filas de Mazzoni (cuenta 381 / TCA 10277), si alguien las tiene tomadas */
SELECT Bloque = 'E', l.request_session_id AS session_id, OBJECT_NAME(p.object_id) AS Tabla,
       l.resource_type, l.request_mode, l.request_status, Filas = COUNT(*)
FROM sys.dm_tran_locks l
LEFT JOIN sys.partitions p ON p.hobt_id = l.resource_associated_entity_id
WHERE l.resource_database_id = DB_ID('SecureAppDB')
  AND l.resource_type IN ('KEY','RID','PAGE','OBJECT')
  AND OBJECT_NAME(p.object_id) IN ('MovimientosCuenta','DeudaDocumento','Pagos','ImputacionPago','TransaccionesCaja','CuentasCliente','DocumentosContables','Cont_AsientosCabecera')
GROUP BY l.request_session_id, OBJECT_NAME(p.object_id), l.resource_type, l.request_mode, l.request_status
ORDER BY l.request_session_id, Tabla;

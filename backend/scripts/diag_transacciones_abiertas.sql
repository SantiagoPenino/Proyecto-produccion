/* ============================================================================
   diag_transacciones_abiertas.sql   —   SOLO LECTURA
   ----------------------------------------------------------------------------
   Chequeo rápido: ¿hay alguna transacción abierta, sesión bloqueada, o lock
   colgado sobre una tabla real? Correr tal cual, no toca nada.
   ============================================================================ */

SET NOCOUNT ON;

-- 1. Transacciones activas (si esto da filas, hay algo sin COMMIT/ROLLBACK)
SELECT
    s.session_id, t.transaction_id, t.name, t.transaction_begin_time,
    SegundosAbierta = DATEDIFF(SECOND, t.transaction_begin_time, GETDATE())
FROM sys.dm_tran_active_transactions t
JOIN sys.dm_tran_session_transactions s ON s.transaction_id = t.transaction_id;

-- 2. Sesiones bloqueadas esperando a otra (si esto da filas, hay un bloqueo real)
SELECT blocking_session_id, session_id, wait_type, wait_time, wait_resource, status, command
FROM sys.dm_exec_requests
WHERE blocking_session_id <> 0;

-- 3. Locks sobre tablas reales (no cuenta el lock normal de nivel DATABASE)
SELECT
    l.request_session_id, DB_NAME(l.resource_database_id) AS DB,
    l.resource_type, l.request_mode, l.request_status,
    Tabla = OBJECT_NAME(p.object_id)
FROM sys.dm_tran_locks l
LEFT JOIN sys.partitions p ON p.hobt_id = l.resource_associated_entity_id
WHERE l.resource_database_id = DB_ID()
  AND l.request_session_id <> @@SPID
  AND l.resource_type <> 'DATABASE';

-- 4. Todas las sesiones de usuario conectadas ahora (para ver qué anda abierto)
SELECT
    session_id, login_name, host_name, program_name, status,
    open_transaction_count, last_request_start_time,
    SegundosDesdeUltimoRequest = DATEDIFF(SECOND, last_request_start_time, GETDATE())
FROM sys.dm_exec_sessions
WHERE is_user_process = 1
ORDER BY last_request_start_time;

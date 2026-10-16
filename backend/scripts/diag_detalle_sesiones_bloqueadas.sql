/* ============================================================================
   diag_detalle_sesiones_bloqueadas.sql   —   SOLO LECTURA
   ----------------------------------------------------------------------------
   Detalle de las sesiones puntuales que aparecieron bloqueando en el chequeo
   general (diag_transacciones_abiertas.sql). Ajustá la lista de @Sesiones
   según lo que veas en ese momento.
   ============================================================================ */
SET NOCOUNT ON;

SELECT
    s.session_id, s.status, s.open_transaction_count, s.login_time,
    s.last_request_start_time, s.last_request_end_time,
    SegundosInactiva = DATEDIFF(SECOND, s.last_request_end_time, GETDATE()),
    c.most_recent_sql_handle,
    UltimoSQL = t.text
FROM sys.dm_exec_sessions s
JOIN sys.dm_exec_connections c ON c.session_id = s.session_id
CROSS APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) t
WHERE s.session_id IN (61, 58, 76)  -- <-- ajustar a las sesiones que veas colgadas
ORDER BY s.session_id;

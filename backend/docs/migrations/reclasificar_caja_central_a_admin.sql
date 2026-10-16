/* ==============================================================================
   RECLASIFICACIÓN Caja Central -> Administrativa   (EsCajaAdmin 0 -> 1)
   Fecha: 2026-07-07   Rama: integracioncontabilidad
   ------------------------------------------------------------------------------
   Mueve a la Caja Administrativa los movimientos que quedaron mal en el arqueo
   CENTRAL (EsCajaAdmin=0). Todo va por CRITERIO (no por Id), porque el identity
   de producción NO coincide con el de local. Es IDEMPOTENTE: el guard
   "EsCajaAdmin=0" hace que re-ejecutar no vuelva a tocar nada.

   Los movimientos administrativos "nativos" son EsCajaAdmin=1 + StuIdSesion=NULL.

   3 grupos (mismos que se validaron en local):
     C) Huérfanas : EsCajaAdmin=0 Y StuIdSesion NULL  -> invisibles a TODO arqueo
     A) Anticipos : ANTICIPO en central               -> operación administrativa
     B) Online    : e-Ticket 07 de cobro Handy/MercadoPago caído en central

   Se DEJAN en central (ventas físicas reales): recibos 05, y 40/07/01 de mostrador
   de las cajeras físicas (GABY/Tamara), y los egresos de caja.

   >>> CORRER EN SSMS. Revisar los SELECT de PREVIEW antes de hacer COMMIT. <<<
   ============================================================================== */

SET NOCOUNT ON;
BEGIN TRAN;

/* ---------- PREVIEW: revisar contra la realidad de PRODUCCIÓN ---------- */

-- C) Huérfanas por tipo (deberían ser Pedido-Caja '40' de la caja administrativa)
SELECT 'C_huerfanas' AS Grupo, t.TcaTipoDocumento,
       COALESCE(u.Nombre,u.Usuario,'?') AS Usuario,
       COUNT(*) AS Cant, SUM(t.TcaTotalCobrado) AS Total
FROM dbo.TransaccionesCaja t
LEFT JOIN dbo.Usuarios u ON u.IdUsuario = t.TcaUsuarioId
WHERE t.EsCajaAdmin=0 AND t.StuIdSesion IS NULL
  AND t.TcaEstado IN ('COMPLETADO','COMPLETADA','COBRADO')
GROUP BY t.TcaTipoDocumento, COALESCE(u.Nombre,u.Usuario,'?');

-- A) Anticipos en central (verificar que sean de la caja administrativa)
SELECT 'A_anticipos' AS Grupo, COALESCE(u.Nombre,u.Usuario,'?') AS Usuario,
       COUNT(*) AS Cant, SUM(t.TcaTotalCobrado) AS Total
FROM dbo.TransaccionesCaja t
LEFT JOIN dbo.Usuarios u ON u.IdUsuario = t.TcaUsuarioId
WHERE t.EsCajaAdmin=0 AND t.TcaTipoDocumento='ANTICIPO'
  AND t.TcaEstado IN ('COMPLETADO','COMPLETADA','COBRADO')
GROUP BY COALESCE(u.Nombre,u.Usuario,'?');

-- B) Online (Handy/MercadoPago) caídos en central
SELECT 'B_online' AS Grupo, COUNT(*) AS Cant, SUM(t.TcaTotalCobrado) AS Total
FROM dbo.TransaccionesCaja t
LEFT JOIN dbo.Usuarios u ON u.IdUsuario = t.TcaUsuarioId
WHERE t.EsCajaAdmin=0 AND t.TcaTipoDocumento='07'
  AND ( ISNULL(u.Nombre,'')+ISNULL(u.Usuario,'') LIKE '%Online%'
     OR t.TcaObservaciones LIKE 'Cobro Handy%'
     OR t.TcaObservaciones LIKE 'Cobro Mercado%' )
  AND t.TcaEstado IN ('COMPLETADO','COMPLETADA','COBRADO');


/* ---------- UPDATES ---------- */

-- C) Huérfanas: solo cambia la bandera (ya tienen StuIdSesion NULL)
UPDATE dbo.TransaccionesCaja
   SET EsCajaAdmin=1
WHERE EsCajaAdmin=0 AND StuIdSesion IS NULL AND TcaTipoDocumento='40'
  AND TcaEstado IN ('COMPLETADO','COMPLETADA','COBRADO');
PRINT 'C) Huerfanas 40 reclasificadas: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

-- A) Anticipos: a admin y se les quita la sesión (para salir del cierre central)
UPDATE dbo.TransaccionesCaja
   SET EsCajaAdmin=1, StuIdSesion=NULL
WHERE EsCajaAdmin=0 AND TcaTipoDocumento='ANTICIPO'
  AND TcaEstado IN ('COMPLETADO','COMPLETADA','COBRADO');
PRINT 'A) Anticipos reclasificados: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

-- B) Online: a admin y se les quita la sesión
UPDATE t
   SET t.EsCajaAdmin=1, t.StuIdSesion=NULL
FROM dbo.TransaccionesCaja t
LEFT JOIN dbo.Usuarios u ON u.IdUsuario = t.TcaUsuarioId
WHERE t.EsCajaAdmin=0 AND t.TcaTipoDocumento='07'
  AND ( ISNULL(u.Nombre,'')+ISNULL(u.Usuario,'') LIKE '%Online%'
     OR t.TcaObservaciones LIKE 'Cobro Handy%'
     OR t.TcaObservaciones LIKE 'Cobro Mercado%' )
  AND t.TcaEstado IN ('COMPLETADO','COMPLETADA','COBRADO');
PRINT 'B) Online reclasificados: ' + CAST(@@ROWCOUNT AS VARCHAR(10));


/* ---------- POST-CHECK ---------- */

-- Qué queda en CENTRAL (debería ser solo mostrador físico legítimo)
SELECT 'CENTRAL_restante' AS Estado, TcaTipoDocumento,
       COUNT(*) AS Cant, SUM(TcaTotalCobrado) AS Total
FROM dbo.TransaccionesCaja
WHERE EsCajaAdmin=0 AND TcaEstado IN ('COMPLETADO','COMPLETADA','COBRADO')
GROUP BY TcaTipoDocumento;

-- Huérfanas restantes: DEBE dar 0. Si da >0, hay órfanas de OTRO tipo -> revisar a mano.
SELECT 'Huerfanas_restantes' AS Chequeo, COUNT(*) AS Cant
FROM dbo.TransaccionesCaja
WHERE EsCajaAdmin=0 AND StuIdSesion IS NULL
  AND TcaEstado IN ('COMPLETADO','COMPLETADA','COBRADO');

/* ==============================================================================
   Revisar los resultados de arriba y ejecutar UNA de las dos:
       COMMIT;      -- si todo cuadra
       ROLLBACK;    -- si algo no cierra, deja producción intacta
   ============================================================================== */
-- COMMIT;
-- ROLLBACK;

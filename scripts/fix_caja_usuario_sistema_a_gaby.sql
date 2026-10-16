-- ############################################################################
-- ##  NO CORRER EL PASO 2 COMO ESTA.  (revisado 1/9/2026)                    ##
-- ############################################################################
-- Este script nacio para pasar los movimientos "Sistema" a GABY. Despues se vio
-- en la base que NO son de Gaby:
--
--   TcaUsuarioId = 282801  ->  es el CodCliente de MIA FALERO, no un IdUsuario.
--   Mia existe como usuaria interna: MiaF, IdUsuario 47.
--
-- Mia opero el mostrador logueada con su cuenta de CLIENTE del portal. Gaby solo
-- abrio la sesion 54. Poner esos 31 cobros a nombre de Gaby seria falsear la
-- auditoria: le atribuye cobros que no hizo.
--
-- Mismo patron: 5713314 = Fabiana Limpias (usuaria FabianaL, 51), 3 tickets.
--               5713345 = MARIO TURNIANSKY, 1 ticket, sin usuario interno claro.
--               70       = el fallback fantasma del codigo, 6 movs de julio.
--
-- DECISION TOMADA: los historicos NO se tocan por ahora. El PASO 2 queda como
-- referencia; si algun dia se corre, va con @GabyId reemplazado por el operador
-- REAL de cada grupo (47 para los de Mia, 51 para los de Fabiana).
--
-- La causa de raiz ya esta corregida en el codigo (sin deploy todavia):
--   backend/routes/contabilidadRoutes.js  -> router.use('/caja', soloInternoConRol())
--   backend/controllers/cajaController.js -> req.user.id sin el fallback || 70
-- Los PASOS 0, 1 y 3 (solo SELECT) siguen siendo validos.
-- ############################################################################

-- ============================================================================
-- fix_caja_usuario_sistema_a_gaby.sql
-- ----------------------------------------------------------------------------
-- La columna USUARIO de "Movimientos del Turno" muestra "Sistema" en una pila de
-- e-Tickets del 1/9/2026. Este script los pasa a GABY.
--
-- POR QUÉ DICE "Sistema":
--   La grilla arma el nombre con:
--       COALESCE(u.Nombre, u.Usuario, 'Sistema')
--       LEFT JOIN dbo.Usuarios u ON u.IdUsuario = t.TcaUsuarioId
--   (backend/controllers/cajaController.js:371 y :379)
--   O sea: "Sistema" NO es un usuario. Es lo que se imprime cuando el
--   TcaUsuarioId de la transacción es NULL o apunta a un IdUsuario que NO EXISTE
--   en dbo.Usuarios. El backend, cuando no puede resolver quién es el operador,
--   graba el fallback `req.user?.id || 70` — y el usuario 70 no existe.
--
-- OJO — ESTO NO ARREGLA EL DESCUADRE:
--   TcaUsuarioId es una etiqueta de auditoría. No entra en ningún total: los
--   importes salen de dbo.Pagos / dbo.EgresosCaja. Cambiar el nombre del operador
--   no mueve un peso del arqueo. Si la caja está descuadrada, la causa es otra
--   (mirá el PASO 0, que sí apunta a plata).
--
-- CÓMO CORRERLO: los pasos 0 y 1 son SELECT, no tocan nada. Corré esos primero,
-- mirá el resultado, y recién ahí el PASO 2.
-- ============================================================================


-- ============================================================================
-- PASO 0 — (DESCUADRE) Movimientos del día por sesión y por bucket
-- ----------------------------------------------------------------------------
-- Esto sí mira plata. Un e-Ticket que quedó en la sesión equivocada, o del lado
-- equivocado de Central/Administrativa, descuadra el arqueo. El usuario "Sistema"
-- suele venir de la mano de eso, porque es el mismo síntoma: la transacción se
-- creó fuera del contexto de caja normal.
-- OJO CON LA HORA: en producción el SQL Server está en UTC y la pantalla muestra
-- hora de Uruguay (UTC-3). Las 10:25 a.m. de la grilla son las 13:25 en TcaFecha.
-- Abajo se muestran las dos.
-- ============================================================================
SELECT
    t.StuIdSesion,
    s.StuEstado,
    ua.Usuario                              AS SesionAbiertaPor,
    CAST(t.EsCajaAdmin AS INT)              AS EsCajaAdmin,   -- 0=Central 1=Administrativa
    COALESCE(u.Nombre, u.Usuario, 'Sistema') AS UsuarioQueMuestra,
    COUNT(*)                                AS Movimientos,
    SUM(CASE WHEN p.PagIdMonedaPago = 2 THEN p.PagMontoPago ELSE 0 END) AS Total_USD,
    SUM(CASE WHEN p.PagIdMonedaPago = 2 THEN 0 ELSE p.PagMontoPago END) AS Total_UYU
FROM dbo.TransaccionesCaja t
JOIN dbo.Pagos p              ON p.PagTcaIdTransaccion = t.TcaIdTransaccion
LEFT JOIN dbo.Usuarios u      ON u.IdUsuario     = t.TcaUsuarioId
LEFT JOIN dbo.SesionesTurno s ON s.StuIdSesion   = t.StuIdSesion
LEFT JOIN dbo.Usuarios ua     ON ua.IdUsuario    = s.StuUsuarioAbre
WHERE t.TcaFecha >= '2026-09-01 03:00' AND t.TcaFecha < '2026-09-02 03:00'   -- 1/9 hora Uruguay
  AND t.TcaEstado IN ('COMPLETADO','COMPLETADA','COBRADO')
  AND p.PagTipoMovimiento <> 'ANULADO'
GROUP BY t.StuIdSesion, s.StuEstado, ua.Usuario, t.EsCajaAdmin,
         COALESCE(u.Nombre, u.Usuario, 'Sistema')
ORDER BY t.StuIdSesion, EsCajaAdmin;


-- ============================================================================
-- PASO 1 — Listar UNA POR UNA las transacciones que dicen "Sistema"
-- ----------------------------------------------------------------------------
-- Verificá que la lista sea la de la pantalla antes de actualizar nada.
-- La columna TcaUsuarioId te dice qué guardó el backend (NULL, 70, u otro id
-- huérfano). SesionAbiertaPor es la evidencia real de quién estaba en la caja.
-- ============================================================================
SELECT
    t.TcaIdTransaccion,
    DATEADD(HOUR, -3, t.TcaFecha)           AS Fecha_Uruguay,
    t.TcaFecha                              AS Fecha_UTC_enBase,
    ISNULL(t.TcaSerieDoc,'') + '-' + ISNULL(t.TcaNumeroDoc,'Pendiente') AS Comprobante,
    t.TcaTipoDocumento,
    c.Nombre                                AS Cliente,
    t.TcaTotalCobrado,
    t.TcaMonedaBase,
    t.TcaUsuarioId                          AS UsuarioIdGuardado,
    CASE WHEN t.TcaUsuarioId IS NULL THEN 'NULL'
         ELSE 'huérfano: no existe en Usuarios' END AS PorQueDiceSistema,
    t.StuIdSesion,
    ua.Usuario                              AS SesionAbiertaPor,
    CAST(t.EsCajaAdmin AS INT)              AS EsCajaAdmin
FROM dbo.TransaccionesCaja t
LEFT JOIN dbo.Usuarios u      ON u.IdUsuario   = t.TcaUsuarioId
LEFT JOIN dbo.Clientes c      ON c.CliIdCliente = t.TcaClienteId
LEFT JOIN dbo.SesionesTurno s ON s.StuIdSesion  = t.StuIdSesion
LEFT JOIN dbo.Usuarios ua     ON ua.IdUsuario   = s.StuUsuarioAbre
WHERE t.TcaFecha >= '2026-09-01 03:00' AND t.TcaFecha < '2026-09-02 03:00'
  AND u.IdUsuario IS NULL          -- <<< esto es exactamente "muestra Sistema"
ORDER BY t.TcaFecha;

-- Y confirmá que Gaby es el 32 también en producción (en la réplica local lo es):
SELECT IdUsuario, Usuario, Nombre FROM dbo.Usuarios WHERE Usuario LIKE '%gaby%' OR Nombre LIKE '%gaby%';


-- ============================================================================
-- PASO 2 — LA ACTUALIZACIÓN
-- ----------------------------------------------------------------------------
-- Descomentá el bloque y corré. Está en transacción con ROLLBACK al final:
-- la primera pasada te muestra el resultado SIN guardar. Cuando el listado
-- "DESPUES" sea el correcto, cambiá ROLLBACK por COMMIT y volvé a correr.
--
-- Antes de correr, poné en @Ids los TcaIdTransaccion del PASO 1 que querés
-- pasar a Gaby. Va por lista explícita a propósito: es más seguro que un rango
-- de fechas, no depende de la conversión UTC y no te lleva puesta ninguna
-- transacción de otro operador.
-- ============================================================================
/*
BEGIN TRAN;

DECLARE @GabyId INT = (SELECT TOP 1 IdUsuario FROM dbo.Usuarios WHERE Usuario = 'Gaby');
IF @GabyId IS NULL BEGIN RAISERROR('No encontré el usuario Gaby',16,1); ROLLBACK; RETURN; END

DECLARE @Ids TABLE (Id INT PRIMARY KEY);
INSERT INTO @Ids (Id) VALUES
    -- (0000),   <<<< PEGÁ ACÁ los TcaIdTransaccion del PASO 1, uno por línea
    -- (0000),
    (0);          -- borrá esta línea placeholder

-- Foto de cómo estaban (guardala del output por las dudas)
SELECT 'ANTES' AS Momento, t.TcaIdTransaccion, t.TcaSerieDoc, t.TcaNumeroDoc, t.TcaUsuarioId
FROM dbo.TransaccionesCaja t JOIN @Ids i ON i.Id = t.TcaIdTransaccion;

UPDATE t
   SET t.TcaUsuarioId = @GabyId
FROM dbo.TransaccionesCaja t
JOIN @Ids i ON i.Id = t.TcaIdTransaccion
WHERE NOT EXISTS (SELECT 1 FROM dbo.Usuarios u WHERE u.IdUsuario = t.TcaUsuarioId);
--     ^ candado: solo toca las que hoy muestran "Sistema". Si alguna de la lista
--       ya tenía un operador de verdad, se la saltea en vez de pisarlo.

PRINT 'Transacciones actualizadas: ' + CAST(@@ROWCOUNT AS VARCHAR);

SELECT 'DESPUES' AS Momento, t.TcaIdTransaccion, t.TcaSerieDoc, t.TcaNumeroDoc,
       t.TcaUsuarioId, COALESCE(u.Nombre, u.Usuario, 'Sistema') AS UsuarioQueMuestra
FROM dbo.TransaccionesCaja t
JOIN @Ids i ON i.Id = t.TcaIdTransaccion
LEFT JOIN dbo.Usuarios u ON u.IdUsuario = t.TcaUsuarioId;

ROLLBACK;   -- <<<< cambiá por COMMIT cuando el listado DESPUES sea el correcto
*/


-- ============================================================================
-- PASO 3 — EL DESCUADRE (esto es otra cosa, y es lo que te falta plata)
-- ----------------------------------------------------------------------------
-- El PASO 0 mostró 53 movimientos "Venta Online Automática" con StuIdSesion = 54
-- Y EsCajaAdmin = 1. Esa combinación no debería existir: lo administrativo va con
-- StuIdSesion NULL (como las filas de Cecilia, Matias Siri y Naty, que están bien).
--
-- Por qué descuadra: la pantalla de caja lee DOS endpoints distintos y filtran
-- distinto sobre la MISMA sesión.
--
--   Grilla de movimientos  → getMovimientosTurno  (cajaController.js:381)
--       WHERE t.StuIdSesion = @Sid AND t.EsCajaAdmin = 0     <-- SÍ filtra
--
--   Total del arqueo       → getResumenSesion     (cajaController.js:275)
--       WHERE StuIdSesion = @Id                              <-- NO filtra
--
-- Entonces esos 53 movimientos SUMAN en el total que el sistema espera en caja,
-- pero NO APARECEN en la lista que ve la cajera. Cuenta la plata, le da bien
-- contra lo que ve, y el sistema le reclama de más. Los egresos tienen el mismo
-- agujero (cajaController.js:279, tampoco filtra EsCajaAdmin).
--
-- Esta query te da el número exacto de la diferencia. TcaTotalCobrado ya viene
-- convertido a pesos (cajaService.js:122 montoConvertido), así que es un solo total.
-- ============================================================================
SELECT
    'Lo que suma el arqueo (getResumenSesion)' AS Concepto,
    COUNT(*)                        AS Movs,
    ISNULL(SUM(TcaTotalCobrado),0)  AS Total_UYU
FROM dbo.TransaccionesCaja WITH(NOLOCK)
WHERE StuIdSesion = 54 AND TcaEstado IN ('COMPLETADO','COMPLETADA','COBRADO')
UNION ALL
SELECT
    'Lo que muestra la grilla (EsCajaAdmin = 0)',
    COUNT(*), ISNULL(SUM(TcaTotalCobrado),0)
FROM dbo.TransaccionesCaja WITH(NOLOCK)
WHERE StuIdSesion = 54 AND TcaEstado IN ('COMPLETADO','COMPLETADA','COBRADO')
  AND EsCajaAdmin = 0
UNION ALL
SELECT
    '>>> DESCUADRE: administrativas colgadas de la sesión 54',
    COUNT(*), ISNULL(SUM(TcaTotalCobrado),0)
FROM dbo.TransaccionesCaja WITH(NOLOCK)
WHERE StuIdSesion = 54 AND TcaEstado IN ('COMPLETADO','COMPLETADA','COBRADO')
  AND EsCajaAdmin = 1;

-- Y el detalle de esas 53, para mirarlas de a una antes de decidir qué hacer:
SELECT
    t.TcaIdTransaccion,
    DATEADD(HOUR,-3,t.TcaFecha) AS Fecha_Uruguay,
    ISNULL(t.TcaSerieDoc,'') + '-' + ISNULL(t.TcaNumeroDoc,'Pendiente') AS Comprobante,
    t.TcaTipoDocumento, c.Nombre AS Cliente, t.TcaTotalCobrado, t.TcaMonedaBase,
    t.TcaUsuarioId, t.StuIdSesion, CAST(t.EsCajaAdmin AS INT) AS EsCajaAdmin
FROM dbo.TransaccionesCaja t WITH(NOLOCK)
LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = t.TcaClienteId
WHERE t.StuIdSesion = 54 AND t.EsCajaAdmin = 1
  AND t.TcaEstado IN ('COMPLETADO','COMPLETADA','COBRADO')
ORDER BY t.TcaFecha;

-- NOTA: no te dejo acá el UPDATE que las despega de la sesión. Hay dos arreglos
-- posibles (soltar StuIdSesion en esas 53, o poner el filtro EsCajaAdmin = 0 en
-- getResumenSesion, que es el fondo del asunto y evita que vuelva a pasar mañana)
-- y conviene decidirlo antes de tocar el cierre de un turno que está ABIERTO.

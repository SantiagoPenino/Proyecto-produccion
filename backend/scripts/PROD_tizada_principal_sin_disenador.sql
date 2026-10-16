/* =============================================================================
   Bandeja de Diseño: producciones principales con TIZADA PRO que quedaron SIN DUEÑO
   Base: SecureAppDB (sirve igual en LOCAL y en PRODUCCION)            15/10/2026

   El problema: hasta el 15/10, mandar la tizada a TIZADA PRO desde la Bandeja / la pantalla de Diseño no dejaba
   el trabajo a nombre de nadie. Cuando la tizada volvía, la producción principal quedaba "Diseñado" con
   DisenadorID NULL y no aparecía en ninguna pestaña de la bandeja ("Mis trabajos" filtra por diseñador).
   El código ya lo corrige para lo nuevo (solicitudesVendedorTizadaPro.quedarseConLaPrincipal). Este script
   arregla lo que ya quedó así.

   Qué hace la PARTE 2: a cada producción principal con molde de TIZADA PRO, sin diseñador, en "Diseño iniciado"
   o "Diseñado", de una solicitud que no está cancelada y de un producto que todavía no es pedido, le pone como
   diseñador a QUIEN MANDÓ su último pedido a TIZADA PRO (TizadaProEnvios.UsuarioID; no cuentan los de "Revisar
   en TIZADA"), solo si esa persona es diseñadora (rol Diseñador, habilitada en la bandeja o Admin). Deja una
   línea en el Historial de la solicitud.
   Qué NO toca: el estado, los archivos, la tizada, el pedido ni nada de la solicitud. Las que mandó alguien que
   no es diseñador (por ejemplo el envío automático de la Tienda) quedan como están: salen en la PARTE 1 para
   decidirlas a mano.

   Cómo correrlo: primero todo con @Aplicar = 0 (muestra qué haría y deshace). Si está bien, @Aplicar = 1.
   Se puede correr dos veces: solo toca las que siguen sin diseñador.
   ============================================================================= */
USE SecureAppDB;
GO
SET NOCOUNT ON;

DECLARE @Aplicar bit = 0;   -- 0 = solo mostrar (deshace) · 1 = aplicar

/* -----------------------------------------------------------------------------
   PARTE 1 - DIAGNÓSTICO (SOLO LECTURA): las huérfanas y a quién quedarían
   ----------------------------------------------------------------------------- */
IF OBJECT_ID('tempdb..#Huerfanas') IS NOT NULL DROP TABLE #Huerfanas;

SELECT pa.ParteID, pa.SolicitudID, pa.ProductoSolID, pa.Estado,
       CONVERT(varchar(16), pa.FechaDisenado, 120)  AS FechaDisenado,
       LTRIM(RTRIM(c.Nombre))                       AS Cliente,
       s.NombreTrabajo,
       env.Referencia                               AS UltimaTizada,
       env.Estado                                   AS EstadoTizada,
       env.UsuarioID                                AS MandoUsuarioID,
       LTRIM(RTRIM(u.Nombre))                       AS MandoNombre,
       ro.NombreRol                                 AS MandoRol,
       CAST(CASE WHEN u.IdUsuario IS NOT NULL AND u.Activo = 1
                  AND (u.IdRol = 1 OR ro.NombreRol IN (N'Admin', N'Diseñador') OR d.IdUsuario IS NOT NULL)
                 THEN 1 ELSE 0 END AS bit)          AS EsDisenador
INTO #Huerfanas
FROM dbo.SolicitudesVendedorPartes pa
JOIN dbo.SolicitudesVendedorProductos p ON p.ProductoSolID = pa.ProductoSolID AND p.Activo = 1 AND p.PedidoNoDocERP IS NULL
JOIN dbo.SolicitudesVendedor s          ON s.SolicitudID = pa.SolicitudID AND s.Estado <> 'CANCELADA'
JOIN dbo.ProductoVentaConfig vc         ON vc.ProIdProducto = p.ProIdProducto AND NULLIF(LTRIM(RTRIM(vc.TizadaProMoldeRef)), '') IS NOT NULL
LEFT JOIN dbo.Clientes c                ON c.CodCliente = s.CodCliente
OUTER APPLY (SELECT TOP 1 e.Referencia, e.Estado, e.UsuarioID
             FROM dbo.TizadaProEnvios e
             WHERE e.Origen = 'SOLICITUD' AND e.OrigenItemID = pa.ProductoSolID AND ISNULL(e.SoloRevision, 0) = 0
               AND e.Estado IN ('APLICADO', 'EN_COLA', 'PROCESANDO', 'LISTO', 'APLICANDO')
             ORDER BY e.EnvioID DESC) env
LEFT JOIN dbo.Usuarios u                ON u.IdUsuario = env.UsuarioID
LEFT JOIN dbo.Roles ro                  ON ro.IdRol = u.IdRol
LEFT JOIN dbo.SolicitudesVendedorDisenadores d ON d.IdUsuario = u.IdUsuario AND d.Activo = 1
WHERE pa.Activo = 1 AND pa.Tipo = 'PRINCIPAL' AND pa.DisenadorID IS NULL
  AND pa.Estado IN ('DISENO_INICIADO', 'DISENADO');

SELECT h.*,
       CASE WHEN h.MandoUsuarioID IS NULL THEN 'QUEDA: no hay un pedido a TIZADA de este producto (decidir a mano)'
            WHEN h.EsDisenador = 0       THEN 'QUEDA: lo mandó alguien que no es diseñador (decidir a mano)'
            ELSE CONCAT('PASA a "Mis trabajos" de ', h.MandoNombre) END AS QueHace
FROM #Huerfanas h
ORDER BY h.SolicitudID, h.ParteID;

/* -----------------------------------------------------------------------------
   PARTE 2 - ARREGLO (con @Aplicar = 0 muestra y deshace)
   ----------------------------------------------------------------------------- */
BEGIN TRANSACTION;
BEGIN TRY
    DECLARE @Hechas TABLE (ParteID int, SolicitudID int, ProductoSolID int, UsuarioID int, Nombre nvarchar(200), Referencia varchar(80));

    UPDATE pa
       SET pa.DisenadorID = h.MandoUsuarioID,
           pa.FechaInicioDiseno = ISNULL(pa.FechaInicioDiseno, ISNULL(pa.FechaDisenado, GETDATE()))
    OUTPUT inserted.ParteID, inserted.SolicitudID, inserted.ProductoSolID, h.MandoUsuarioID, h.MandoNombre, h.UltimaTizada
      INTO @Hechas (ParteID, SolicitudID, ProductoSolID, UsuarioID, Nombre, Referencia)
    FROM dbo.SolicitudesVendedorPartes pa
    JOIN #Huerfanas h ON h.ParteID = pa.ParteID
    WHERE pa.DisenadorID IS NULL AND h.EsDisenador = 1;

    -- Historial de la solicitud (solo se inserta, como hace el sistema)
    INSERT INTO dbo.SolicitudesVendedorEventos (SolicitudID, ProductoSolID, ParteID, Tipo, Texto, UsuarioID, UsuarioNombre)
    SELECT x.SolicitudID, x.ProductoSolID, x.ParteID, 'EDICION',
           CONCAT(N'Producción principal: queda a nombre de ', x.Nombre, N' (mandó la tizada a TIZADA PRO, ', x.Referencia,
                  N'). Arreglo de datos del 15/10: antes la tizada no dejaba el trabajo a nombre de nadie.'),
           x.UsuarioID, N'Arreglo de datos'
    FROM @Hechas x;

    SELECT h.ParteID, h.SolicitudID, h.Nombre AS QuedaANombreDe, h.Referencia AS Tizada FROM @Hechas h ORDER BY h.SolicitudID;
    SELECT COUNT(*) AS Arregladas, @Aplicar AS Aplicado FROM @Hechas;

    IF @Aplicar = 1 COMMIT TRANSACTION;
    ELSE ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

-- Después: tienen que quedar solo las que decide alguien a mano (o ninguna)
SELECT pa.ParteID, pa.SolicitudID, pa.Estado, pa.DisenadorID
FROM dbo.SolicitudesVendedorPartes pa
JOIN #Huerfanas h ON h.ParteID = pa.ParteID
WHERE pa.DisenadorID IS NULL;

DROP TABLE #Huerfanas;

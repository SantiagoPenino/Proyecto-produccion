-- =====================================================================
-- DIAGNÓSTICO (SOLO LECTURA): avisos de WhatsApp de un cliente
-- Para cada orden en depósito de los últimos @Dias días muestra:
--   * si el sistema llegó a mandar el aviso a Callbell (HistorialOrdenes 'Avisado' / 'Sistema (WSP)')
--   * si alguien lo reenvió a mano (estado 12 = "Avisar de nuevo")
--   * qué pasó ANTES del primer reenvío
-- Lectura del resultado (columna Diagnostico):
--   NUNCA_SALIO      -> el sistema no mandó nada antes del reenvío (problema nuestro: filtros/estado)
--   SALIO_Y_REENVIADO-> el sistema SÍ se lo pasó a Callbell y aun así hubo que reenviar
--                       (se perdió entre Callbell y WhatsApp: mirar el estado del mensaje en Callbell)
--   SIN_AVISO        -> no tiene aviso y nadie lo reenvió
--   OK               -> avisado una vez, sin reenvío
-- =====================================================================
USE [SecureAppDB];
SET NOCOUNT ON;

DECLARE @IDCliente VARCHAR(50) = 'Cabala_uy';
DECLARE @Dias      INT         = 30;

;WITH Ord AS (
    SELECT od.OrdIdOrden, od.OrdCodigoOrden, od.OrdEstadoActual, od.OrdAvisoWsp,
           od.OrdFechaAvisoWsp, od.BultosEsperados, od.OrdFechaIngresoOrden,
           cli.TelefonoTrabajo
    FROM dbo.OrdenesDeposito od WITH (NOLOCK)
    JOIN dbo.Clientes cli WITH (NOLOCK) ON cli.CliIdCliente = od.CliIdCliente
    WHERE LTRIM(RTRIM(cli.IDCliente)) = @IDCliente
      AND od.OrdFechaIngresoOrden >= DATEADD(DAY, -@Dias, GETDATE())
),
Hist AS (
    SELECT o.OrdIdOrden,
           Ingresado     = (SELECT MIN(h.HEOFechaEstado) FROM dbo.HistoricoEstadosOrdenes h WITH (NOLOCK)
                            WHERE h.OrdIdOrden = o.OrdIdOrden AND h.EOrIdEstadoOrden = 1),
           PrimerReenvio = (SELECT MIN(h.HEOFechaEstado) FROM dbo.HistoricoEstadosOrdenes h WITH (NOLOCK)
                            WHERE h.OrdIdOrden = o.OrdIdOrden AND h.EOrIdEstadoOrden = 12),
           CantReenvios  = (SELECT COUNT(*) FROM dbo.HistoricoEstadosOrdenes h WITH (NOLOCK)
                            WHERE h.OrdIdOrden = o.OrdIdOrden AND h.EOrIdEstadoOrden = 12),
           Recorrido     = (SELECT STRING_AGG(CAST(h.EOrIdEstadoOrden AS VARCHAR(5)) + '@' + CONVERT(VARCHAR(16), h.HEOFechaEstado, 120), ' > ')
                                   WITHIN GROUP (ORDER BY h.HEOFechaEstado)
                            FROM dbo.HistoricoEstadosOrdenes h WITH (NOLOCK) WHERE h.OrdIdOrden = o.OrdIdOrden)
    FROM Ord o
),
Avisos AS (
    -- Cada aviso que el job le pasó a Callbell deja una fila 'Avisado' de 'Sistema (WSP)'
    SELECT o.OrdIdOrden, ho.FechaInicio
    FROM Ord o
    JOIN dbo.Ordenes ord WITH (NOLOCK) ON ord.CodigoOrden = o.OrdCodigoOrden
    JOIN dbo.HistorialOrdenes ho WITH (NOLOCK) ON ho.OrdenID = ord.OrdenID
    WHERE ho.Estado = 'Avisado' AND ho.Usuario LIKE 'Sistema (WSP)%'
)
SELECT
    o.OrdCodigoOrden,
    o.OrdEstadoActual                                    AS EstadoHoy,
    o.TelefonoTrabajo,
    CONVERT(VARCHAR(16), h.Ingresado, 120)               AS Ingresado,
    (SELECT COUNT(*) FROM Avisos a WHERE a.OrdIdOrden = o.OrdIdOrden)                                  AS AvisosMandados,
    CONVERT(VARCHAR(16), (SELECT MIN(a.FechaInicio) FROM Avisos a WHERE a.OrdIdOrden = o.OrdIdOrden), 120) AS PrimerAviso,
    DATEDIFF(MINUTE, h.Ingresado, (SELECT MIN(a.FechaInicio) FROM Avisos a WHERE a.OrdIdOrden = o.OrdIdOrden)) AS MinutosHastaAviso,
    h.CantReenvios,
    CONVERT(VARCHAR(16), h.PrimerReenvio, 120)           AS PrimerReenvio,
    Diagnostico = CASE
        WHEN h.PrimerReenvio IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM Avisos a WHERE a.OrdIdOrden = o.OrdIdOrden AND a.FechaInicio < h.PrimerReenvio)
            THEN 'NUNCA_SALIO'
        WHEN h.PrimerReenvio IS NOT NULL THEN 'SALIO_Y_REENVIADO'
        WHEN NOT EXISTS (SELECT 1 FROM Avisos a WHERE a.OrdIdOrden = o.OrdIdOrden) THEN 'SIN_AVISO'
        ELSE 'OK'
    END,
    o.BultosEsperados,
    h.Recorrido
FROM Ord o
JOIN Hist h ON h.OrdIdOrden = o.OrdIdOrden
ORDER BY o.OrdIdOrden DESC;

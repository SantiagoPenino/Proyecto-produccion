-- =====================================================================
-- DIAGNÓSTICO (SOLO LECTURA): órdenes que se pagaron con la billetera EN EL MISMO
-- MOMENTO de entrar al depósito y por eso nunca recibieron el WhatsApp.
--
-- Causa (código anterior al commit f08e495 del 29-sep): al recibir en depósito, si la
-- billetera cubría la orden ENTERA, el motor contable pasaba la orden de 1 (Ingresado)
-- a 7 sin dejar historial. El job de WhatsApp solo mira estados 1 y 6 → nunca la avisó.
-- Firma: BultosEsperados NULL (el paso de bultos ya no la tocó porque estaba en 7)
--        + CONSUMO_CUENTA "CUBIERTO_CUENTA" a +-2 min del ingreso.
--
-- PARTE A: un cliente, orden por orden.
-- PARTE B: todos los clientes, por semana (para saber si sigue pasando HOY y a cuántos).
-- PARTE C: las que siguen en depósito sin aviso (hay que avisarlas a mano).
-- =====================================================================
USE [SecureAppDB];
SET NOCOUNT ON;

DECLARE @IDCliente VARCHAR(50) = 'Cabala_uy';
DECLARE @Dias      INT         = 30;

IF OBJECT_ID('tempdb..#Ing') IS NOT NULL DROP TABLE #Ing;

SELECT od.OrdIdOrden, od.OrdCodigoOrden, od.CliIdCliente, LTRIM(RTRIM(cli.IDCliente)) AS IDCliente,
       od.OrdEstadoActual, od.BultosEsperados, od.OrdAvisoWsp,
       Ingreso = (SELECT MIN(h.HEOFechaEstado) FROM dbo.HistoricoEstadosOrdenes h WITH (NOLOCK)
                  WHERE h.OrdIdOrden = od.OrdIdOrden AND h.EOrIdEstadoOrden = 1)
INTO #Ing
FROM dbo.OrdenesDeposito od WITH (NOLOCK)
JOIN dbo.Clientes cli WITH (NOLOCK) ON cli.CliIdCliente = od.CliIdCliente
WHERE od.OrdFechaIngresoOrden >= DATEADD(DAY, -@Dias, GETDATE());

IF OBJECT_ID('tempdb..#Res') IS NOT NULL DROP TABLE #Res;

SELECT i.*,
       PagadaConBilleteraAlIngresar = CASE WHEN EXISTS (
            SELECT 1 FROM dbo.MovimientosCuenta m WITH (NOLOCK)
            WHERE m.OrdIdOrden = i.OrdIdOrden
              AND m.MovTipo = 'CONSUMO_CUENTA'
              AND m.MovObservaciones LIKE 'CUBIERTO[_]CUENTA%'          -- entera (no PARCIAL)
              AND ABS(DATEDIFF(SECOND, i.Ingreso, m.MovFecha)) <= 120) THEN 1 ELSE 0 END,
       AvisoAutomatico = CASE WHEN EXISTS (
            SELECT 1 FROM dbo.Ordenes o WITH (NOLOCK)
            JOIN dbo.HistorialOrdenes ho WITH (NOLOCK) ON ho.OrdenID = o.OrdenID
            WHERE o.CodigoOrden = i.OrdCodigoOrden
              AND ho.Estado = 'Avisado' AND ho.Usuario LIKE 'Sistema (WSP)%'
              AND ho.FechaInicio < ISNULL((SELECT MIN(h.HEOFechaEstado) FROM dbo.HistoricoEstadosOrdenes h WITH (NOLOCK)
                                           WHERE h.OrdIdOrden = i.OrdIdOrden AND h.EOrIdEstadoOrden = 12), '99991231')
       ) THEN 1 ELSE 0 END
INTO #Res
FROM #Ing i;

-- PARTE A ─ el cliente
SELECT OrdCodigoOrden, CONVERT(VARCHAR(16), Ingreso, 120) AS Ingreso, OrdEstadoActual AS EstadoHoy,
       BultosEsperados, PagadaConBilleteraAlIngresar, AvisoAutomatico
FROM #Res WHERE IDCliente = @IDCliente
ORDER BY OrdIdOrden DESC;

-- PARTE B ─ todos los clientes, por semana
SELECT Semana = CONVERT(VARCHAR(10), DATEADD(DAY, 1 - DATEPART(WEEKDAY, Ingreso), CAST(Ingreso AS DATE)), 120),
       PagadasConBilleteraAlIngresar = SUM(PagadaConBilleteraAlIngresar),
       DeEsasSinAvisoAutomatico      = SUM(CASE WHEN PagadaConBilleteraAlIngresar = 1 AND AvisoAutomatico = 0 THEN 1 ELSE 0 END),
       ClientesAfectados             = COUNT(DISTINCT CASE WHEN PagadaConBilleteraAlIngresar = 1 AND AvisoAutomatico = 0 THEN CliIdCliente END),
       RestoSinAvisoAutomatico       = SUM(CASE WHEN PagadaConBilleteraAlIngresar = 0 AND AvisoAutomatico = 0 THEN 1 ELSE 0 END),
       TotalIngresadas               = COUNT(*)
FROM #Res WHERE Ingreso IS NOT NULL
GROUP BY DATEADD(DAY, 1 - DATEPART(WEEKDAY, Ingreso), CAST(Ingreso AS DATE))
ORDER BY 1 DESC;

-- PARTE C ─ siguen en depósito (sin entregar ni cancelar) y nadie las avisó
SELECT IDCliente, OrdCodigoOrden, CONVERT(VARCHAR(16), Ingreso, 120) AS Ingreso, OrdEstadoActual AS EstadoHoy
FROM #Res
WHERE PagadaConBilleteraAlIngresar = 1 AND AvisoAutomatico = 0
  AND OrdEstadoActual NOT IN (9, 10, 11, 12)
  AND ISNULL(OrdAvisoWsp, 0) = 0
ORDER BY IDCliente, Ingreso;

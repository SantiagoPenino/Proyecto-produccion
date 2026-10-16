/* =====================================================================================
   ANÁLISIS: retiros pendientes en Caja y POR QUÉ siguen ahí (06-oct-2026).
   SOLO LECTURA. Correr entero en SSMS contra SecureAppDB.

   Reproduce la consulta de Caja (GET /apiordenesRetiro/caja → ordenesRetiroController.ordenesRetiroCaja):
       OReEstadoActual <> 6  Y  OrdenesRetiro.PagIdPago IS NULL
       Y alguna orden con OrdenesDeposito.PagIdPago IS NULL que NO esté cubierta entera
         por la billetera (CONSUMO_CUENTA 'CUBIERTO_CUENTA_%')
       Y el filtro de la pestaña:  @TipoCliente = 1 → COMUNES, 3 → ROLLOS,
                                   NULL → TODOS (que en Caja excluye Semanales).
   La pestaña filtra fila a fila: el retiro sale si ALGUNA de sus órdenes (pagas o no)
   es de un cliente de ese tipo (cliente de la orden, si no el del retiro).

   CAUSA POR ORDEN (de cada orden sin PagIdPago, la primera que aplique):
     A CANCELADA/PERDIDA        la orden está en estado 10/11
     B COSTO 0                  reposición -R/-F, cubierta por plan, exonerada…
     C DOC PAGADO               tiene factura / pedido caja emitido y PAGADO
     D DOC IMPAGO               tiene documento pero debe (cuenta corriente)
     E CONSUMIDO DEL PLAN       movimiento ENTREGA (metros descontados del rollo)
     F PAGO CRUZADO             movimiento PAGO_CRUZADO a favor de la orden
     G BILLETERA PARCIAL        consumo CUBIERTO_PARCIAL de la billetera
     H CARGO CTA CTE SIN DOC    movimiento ORDEN en la cuenta, sin documento
     I PAGO ONLINE SIN ESTAMPAR el retiro tiene ReferenciaPagoOnline
     Z SIN PAGO NI CARGO        no hay nada en ningún lado
   CAUSA DEL RETIRO = la peor de sus órdenes (Z es la peor, A la más inocua).

   GRUPO DE ESTADO DEL RETIRO:
     ENTREGADO            5
     AUTORIZADO/EN VIAJE  9, 10
     DICE ABONADO         3, 4, 8  (estado de pagado pero sin PagIdPago)
     EN LOCAL SIN ABONAR  1, 2, 7
   ===================================================================================== */
USE [SecureAppDB];
SET NOCOUNT ON;

DECLARE @TipoCliente INT = 1;   -- 1 = COMUNES (pestaña de la captura), 3 = ROLLOS, NULL = TODOS

/* ---- Retiros que Caja muestra ------------------------------------------------------ */
IF OBJECT_ID('tempdb..#APC_Caja') IS NOT NULL DROP TABLE #APC_Caja;
SELECT r.OReIdOrdenRetiro, r.FormaRetiro, r.OReEstadoActual, r.OReFechaAlta, r.CodCliente,
       r.ReferenciaPagoOnline, r.ORePasarPorCaja
INTO #APC_Caja
FROM OrdenesRetiro r WITH (NOLOCK)
WHERE r.OReEstadoActual <> 6
  AND r.PagIdPago IS NULL
  AND EXISTS (
      SELECT 1 FROM OrdenesDeposito od2 WITH (NOLOCK)
      WHERE od2.OReIdOrdenRetiro = r.OReIdOrdenRetiro
        AND od2.PagIdPago IS NULL
        AND NOT EXISTS (
            SELECT 1
            FROM (SELECT od2.OrdIdOrden AS Id
                  UNION ALL SELECT erpX.OrdenID FROM Ordenes erpX WITH (NOLOCK) WHERE erpX.CodigoOrden = od2.OrdCodigoOrden) idsX
            JOIN MovimientosCuenta cb WITH (NOLOCK) ON cb.OrdIdOrden = idsX.Id
            JOIN CuentasCliente ccb WITH (NOLOCK) ON ccb.CueIdCuenta = cb.CueIdCuenta
            WHERE ccb.CliIdCliente = od2.CliIdCliente
              AND cb.MovTipo = 'CONSUMO_CUENTA'
              AND ISNULL(cb.MovAnulado, 0) = 0
              AND cb.MovObservaciones LIKE 'CUBIERTO[_]CUENTA[_]%'))
  AND EXISTS (
      -- mismo filtro de pestaña que Caja (fila a fila sobre TODAS las órdenes del retiro)
      SELECT 1
      FROM OrdenesDeposito o WITH (NOLOCK)
      LEFT JOIN Clientes c  WITH (NOLOCK) ON c.CliIdCliente = o.CliIdCliente
      LEFT JOIN Clientes cr WITH (NOLOCK) ON cr.CodCliente = r.CodCliente
      WHERE o.OReIdOrdenRetiro = r.OReIdOrdenRetiro
        AND (   (@TipoCliente IS NOT NULL AND COALESCE(c.TClIdTipoCliente, cr.TClIdTipoCliente) = @TipoCliente)
             OR (@TipoCliente IS NULL AND (COALESCE(c.TClIdTipoCliente, cr.TClIdTipoCliente) IS NULL
                                           OR COALESCE(c.TClIdTipoCliente, cr.TClIdTipoCliente) <> 2))));

/* ---- Órdenes sin PagIdPago de esos retiros, con su causa ---------------------------- */
IF OBJECT_ID('tempdb..#APC_Ord') IS NOT NULL DROP TABLE #APC_Ord;
SELECT k.OReIdOrdenRetiro, od.OrdIdOrden, od.OrdCodigoOrden, od.CliIdCliente, od.OrdEstadoActual,
       od.MonIdMoneda, ISNULL(od.OrdCostoFinal, 0) AS Costo,
       D.DocIdDocumento, D.DocSerie, D.DocNumero,
       CASE WHEN D.DocIdDocumento IS NULL THEN NULL
            WHEN D.DocPagado = 1 THEN 1
            WHEN EXISTS (SELECT 1 FROM DeudaDocumento dd WHERE dd.DocIdDocumento = D.DocIdDocumento)
             AND NOT EXISTS (SELECT 1 FROM DeudaDocumento dd WHERE dd.DocIdDocumento = D.DocIdDocumento AND dd.DDeImportePendiente > 0.005)
            THEN 1 ELSE 0 END AS DocPagado,
       ISNULL(M.Entrega, 0) AS Entrega, ISNULL(M.PagoCruzado, 0) AS PagoCruzado,
       ISNULL(M.ParcialBill, 0) AS ParcialBill, ISNULL(M.CargoSinDoc, 0) AS CargoSinDoc,
       CAST(NULL AS VARCHAR(30)) AS Causa, CAST(NULL AS INT) AS Rango
INTO #APC_Ord
FROM #APC_Caja k
JOIN OrdenesDeposito od WITH (NOLOCK) ON od.OReIdOrdenRetiro = k.OReIdOrdenRetiro AND od.PagIdPago IS NULL
OUTER APPLY (
    -- Documento emitido por la orden: el movimiento ORDEN queda con DocIdDocumento
    -- (por id de depósito, id de Ordenes o código al inicio del concepto; ver auditDepositoController).
    SELECT TOP 1 dc.DocIdDocumento, dc.DocSerie, dc.DocNumero, dc.DocPagado
    FROM MovimientosCuenta m WITH (NOLOCK)
    JOIN CuentasCliente cc WITH (NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta AND cc.CliIdCliente = od.CliIdCliente
    JOIN DocumentosContables dc WITH (NOLOCK) ON dc.DocIdDocumento = m.DocIdDocumento AND ISNULL(dc.DocEstado, '') <> 'ANULADO'
    WHERE m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO') AND ISNULL(m.MovAnulado, 0) = 0
      AND (m.OrdIdOrden = od.OrdIdOrden
           OR m.OrdIdOrden IN (SELECT o2.OrdenID FROM Ordenes o2 WITH (NOLOCK) WHERE o2.CodigoOrden = od.OrdCodigoOrden)
           OR m.MovConcepto LIKE LTRIM(RTRIM(od.OrdCodigoOrden)) + ' %')
    ORDER BY m.MovIdMovimiento DESC
) D
OUTER APPLY (
    -- Otros movimientos de la cuenta del cliente que apuntan a la orden (mismos ids que Caja)
    SELECT MAX(CASE WHEN m.MovTipo = 'ENTREGA' THEN 1 ELSE 0 END) AS Entrega,
           MAX(CASE WHEN m.MovTipo = 'PAGO_CRUZADO' AND m.MovImporte > 0 THEN 1 ELSE 0 END) AS PagoCruzado,
           MAX(CASE WHEN m.MovTipo = 'CONSUMO_CUENTA' AND m.MovObservaciones LIKE 'CUBIERTO[_]PARCIAL%' THEN 1 ELSE 0 END) AS ParcialBill,
           MAX(CASE WHEN m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO') AND m.DocIdDocumento IS NULL
                     AND ISNULL(m.MovObservaciones, '') NOT LIKE 'CUBIERTO%' THEN 1 ELSE 0 END) AS CargoSinDoc
    FROM (SELECT od.OrdIdOrden AS Id
          UNION ALL SELECT o3.OrdenID FROM Ordenes o3 WITH (NOLOCK) WHERE o3.CodigoOrden = od.OrdCodigoOrden) ids
    JOIN MovimientosCuenta m WITH (NOLOCK) ON m.OrdIdOrden = ids.Id AND ISNULL(m.MovAnulado, 0) = 0
    JOIN CuentasCliente cc WITH (NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta AND cc.CliIdCliente = od.CliIdCliente
) M;

UPDATE o SET
    Causa = x.Causa, Rango = x.Rango
FROM #APC_Ord o
JOIN #APC_Caja k ON k.OReIdOrdenRetiro = o.OReIdOrdenRetiro
CROSS APPLY (SELECT
    CASE WHEN o.OrdEstadoActual IN (10, 11)        THEN 'A CANCELADA/PERDIDA'
         WHEN o.Costo <= 0                         THEN 'B COSTO 0'
         WHEN o.DocPagado = 1                      THEN 'C DOC PAGADO'
         WHEN o.DocIdDocumento IS NOT NULL         THEN 'D DOC IMPAGO'
         WHEN o.Entrega = 1                        THEN 'E CONSUMIDO DEL PLAN'
         WHEN o.PagoCruzado = 1                    THEN 'F PAGO CRUZADO'
         WHEN o.ParcialBill = 1                    THEN 'G BILLETERA PARCIAL'
         WHEN o.CargoSinDoc = 1                    THEN 'H CARGO CTA CTE SIN DOC'
         WHEN k.ReferenciaPagoOnline IS NOT NULL   THEN 'I PAGO ONLINE SIN ESTAMPAR'
         ELSE 'Z SIN PAGO NI CARGO' END AS Causa) c
CROSS APPLY (SELECT CASE LEFT(c.Causa, 1) WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 WHEN 'D' THEN 4
                     WHEN 'E' THEN 5 WHEN 'F' THEN 6 WHEN 'G' THEN 7 WHEN 'H' THEN 8 WHEN 'I' THEN 9 ELSE 10 END AS Rango,
                    c.Causa) x;

/* ---- Un renglón por retiro --------------------------------------------------------- */
IF OBJECT_ID('tempdb..#APC_Ret') IS NOT NULL DROP TABLE #APC_Ret;
SELECT k.OReIdOrdenRetiro,
       ISNULL(k.FormaRetiro, 'R') + '-' + CAST(k.OReIdOrdenRetiro AS VARCHAR(20)) AS Retiro,
       k.OReEstadoActual, er.EORNombreEstado AS EstadoRetiro,
       CASE WHEN k.OReEstadoActual = 5 THEN '1 ENTREGADO'
            WHEN k.OReEstadoActual IN (9, 10) THEN '2 AUTORIZADO/EN VIAJE'
            WHEN k.OReEstadoActual IN (3, 4, 8) THEN '3 DICE ABONADO'
            ELSE '4 EN LOCAL SIN ABONAR' END AS GrupoEstado,
       k.OReFechaAlta, DATEDIFF(DAY, k.OReFechaAlta, GETDATE()) AS Dias,
       k.ReferenciaPagoOnline, k.ORePasarPorCaja,
       cr.IDCliente, LTRIM(RTRIM(cr.Nombre)) AS Cliente, tcr.TClDescripcion AS TipoCliente,
       (SELECT COUNT(*) FROM OrdenesDeposito a WITH (NOLOCK) WHERE a.OReIdOrdenRetiro = k.OReIdOrdenRetiro) AS OrdenesTotal,
       (SELECT COUNT(*) FROM OrdenesDeposito a WITH (NOLOCK) WHERE a.OReIdOrdenRetiro = k.OReIdOrdenRetiro AND a.PagIdPago IS NOT NULL) AS OrdenesConPago,
       a.N AS OrdenesSinPago, a.MaxRango,
       a.AcobrarUYU, a.AcobrarUSD, a.TotalUYU, a.TotalUSD,
       CAST(CASE
           WHEN a.MaxRango <= 2     THEN '1 NADA QUE COBRAR (costo 0 / cancelada)'
           WHEN a.MaxRango = 3      THEN '2 COBRADO POR DOCUMENTO'
           WHEN a.MaxRango = 4      THEN '3 FACTURADO, DOC IMPAGO'
           WHEN a.MaxRango = 5      THEN '4 CONSUMIDO DEL PLAN'
           WHEN a.MaxRango IN (6, 7) THEN '5 PAGADO X BILLETERA/CRUZADO'
           WHEN a.MaxRango = 8      THEN '6 CARGO EN CTA CTE SIN DOC'
           WHEN a.MaxRango = 9      THEN '7 PAGO ONLINE SIN ESTAMPAR'
           ELSE                          '8 SIN PAGO NI CARGO' END AS VARCHAR(60)) AS Causa
INTO #APC_Ret
FROM #APC_Caja k
LEFT JOIN EstadosOrdenesRetiro er ON er.EORIdEstadoOrden = k.OReEstadoActual
LEFT JOIN Clientes cr WITH (NOLOCK) ON cr.CodCliente = k.CodCliente
LEFT JOIN TiposClientes tcr ON tcr.TClIdTipoCliente = cr.TClIdTipoCliente
CROSS APPLY (
    SELECT COUNT(*) AS N, MAX(o.Rango) AS MaxRango,
           -- "a cobrar" = solo lo que no tiene ni pago ni documento ni consumo (H, I, Z)
           SUM(CASE WHEN o.Rango >= 8 AND o.MonIdMoneda <> 2 THEN o.Costo ELSE 0 END) AS AcobrarUYU,
           SUM(CASE WHEN o.Rango >= 8 AND o.MonIdMoneda = 2  THEN o.Costo ELSE 0 END) AS AcobrarUSD,
           SUM(CASE WHEN o.MonIdMoneda <> 2 THEN o.Costo ELSE 0 END) AS TotalUYU,
           SUM(CASE WHEN o.MonIdMoneda = 2  THEN o.Costo ELSE 0 END) AS TotalUSD
    FROM #APC_Ord o WHERE o.OReIdOrdenRetiro = k.OReIdOrdenRetiro
) a;

/* ---- R0. Control: tiene que dar el número de la pantalla (211 en Comunes, 06-oct) --- */
SELECT 'R0. TOTAL EN CAJA' AS Bloque, @TipoCliente AS TipoCliente, COUNT(*) AS Retiros,
       SUM(OrdenesSinPago) AS OrdenesSinPago, SUM(OrdenesConPago) AS OrdenesYaPagas
FROM #APC_Ret;

/* ---- R1. Causa × estado del retiro ------------------------------------------------- */
SELECT 'R1. CAUSA x ESTADO' AS Bloque, Causa,
       COUNT(*) AS Retiros,
       SUM(CASE WHEN GrupoEstado = '1 ENTREGADO' THEN 1 ELSE 0 END) AS Entregado,
       SUM(CASE WHEN GrupoEstado = '2 AUTORIZADO/EN VIAJE' THEN 1 ELSE 0 END) AS AutorizadoEnViaje,
       SUM(CASE WHEN GrupoEstado = '3 DICE ABONADO' THEN 1 ELSE 0 END) AS DiceAbonado,
       SUM(CASE WHEN GrupoEstado = '4 EN LOCAL SIN ABONAR' THEN 1 ELSE 0 END) AS EnLocalSinAbonar,
       SUM(AcobrarUYU) AS AcobrarUYU, SUM(AcobrarUSD) AS AcobrarUSD,
       SUM(TotalUYU) AS TotalUYU, SUM(TotalUSD) AS TotalUSD,
       MIN(OReFechaAlta) AS MasViejo, MAX(OReFechaAlta) AS MasNuevo
FROM #APC_Ret GROUP BY Causa ORDER BY Causa;

/* ---- R2. Causa × antigüedad -------------------------------------------------------- */
SELECT 'R2. CAUSA x ANTIGUEDAD' AS Bloque, Causa,
       SUM(CASE WHEN Dias <= 7 THEN 1 ELSE 0 END)               AS Hasta7d,
       SUM(CASE WHEN Dias BETWEEN 8 AND 30 THEN 1 ELSE 0 END)   AS De8a30d,
       SUM(CASE WHEN Dias BETWEEN 31 AND 90 THEN 1 ELSE 0 END)  AS De31a90d,
       SUM(CASE WHEN Dias > 90 THEN 1 ELSE 0 END)               AS MasDe90d
FROM #APC_Ret GROUP BY Causa ORDER BY Causa;

/* ---- R3. Causa por ORDEN (un retiro mezcla órdenes de distinta causa) --------------- */
SELECT 'R3. CAUSA x ORDEN' AS Bloque, Causa, COUNT(*) AS Ordenes,
       SUM(CASE WHEN MonIdMoneda <> 2 THEN Costo ELSE 0 END) AS UYU,
       SUM(CASE WHEN MonIdMoneda = 2 THEN Costo ELSE 0 END) AS USD
FROM #APC_Ord GROUP BY Causa ORDER BY Causa;

/* ---- R4. Señales extra --------------------------------------------------------------- */
SELECT 'R4. SEÑALES' AS Bloque,
       SUM(CASE WHEN OrdenesConPago > 0 THEN 1 ELSE 0 END) AS RetirosCobradosEnParte,
       SUM(CASE WHEN ReferenciaPagoOnline IS NOT NULL THEN 1 ELSE 0 END) AS ConReferenciaPagoOnline,
       SUM(CASE WHEN ORePasarPorCaja = 1 THEN 1 ELSE 0 END) AS MarcadosPasarPorCaja,
       SUM(CASE WHEN GrupoEstado = '3 DICE ABONADO' THEN 1 ELSE 0 END) AS EstadoAbonadoSinPago
FROM #APC_Ret;

/* ---- R5. Detalle por retiro (orden: causa, más viejo primero) ----------------------- */
SELECT 'R5. DETALLE' AS Bloque, r.Causa, r.Retiro, r.EstadoRetiro, r.GrupoEstado, r.OReFechaAlta, r.Dias,
       r.IDCliente, r.Cliente, r.TipoCliente,
       r.OrdenesTotal, r.OrdenesConPago, r.OrdenesSinPago,
       r.AcobrarUYU, r.AcobrarUSD, r.TotalUYU, r.TotalUSD, r.ReferenciaPagoOnline,
       (SELECT STRING_AGG(CAST(o.OrdCodigoOrden + ' ' + CAST(o.Costo AS VARCHAR(20))
                               + CASE WHEN o.MonIdMoneda = 2 THEN ' USD' ELSE ' UYU' END
                               + ' -> ' + o.Causa
                               + ISNULL(' [' + o.DocSerie + '-' + CAST(o.DocNumero AS VARCHAR(20)) + ']', '') AS NVARCHAR(MAX)), ' | ')
          FROM #APC_Ord o WHERE o.OReIdOrdenRetiro = r.OReIdOrdenRetiro) AS Ordenes
FROM #APC_Ret r
ORDER BY r.Causa, r.OReFechaAlta;

/* =====================================================================================
   POR CLIENTE (06-oct). Se arma por ORDEN (cliente de la orden; si no tiene, el del retiro).
   "Sin documento" = causas H (cargo en cta cte sin doc) + Z (sin pago ni cargo) + I.
   EquivUSD es solo para ordenar: pesos ÷ última cotización.
   ===================================================================================== */
DECLARE @Cot DECIMAL(18, 4) = (SELECT TOP 1 CotDolar FROM Cotizaciones ORDER BY CotFecha DESC);

IF OBJECT_ID('tempdb..#APC_Cli') IS NOT NULL DROP TABLE #APC_Cli;
SELECT COALESCE(c.CliIdCliente, cr.CliIdCliente) AS CliIdCliente,
       COALESCE(c.IDCliente, cr.IDCliente) AS IDCliente,
       LTRIM(RTRIM(COALESCE(c.Nombre, cr.Nombre))) AS Cliente,
       tc.TClDescripcion AS TipoCliente,
       o.OReIdOrdenRetiro, k.OReEstadoActual, k.OReFechaAlta,
       ISNULL(k.FormaRetiro, 'R') + '-' + CAST(k.OReIdOrdenRetiro AS VARCHAR(20)) AS Retiro,
       o.OrdCodigoOrden, o.MonIdMoneda, o.Costo, o.Causa, o.Rango,
       o.DocSerie, o.DocNumero
INTO #APC_Cli
FROM #APC_Ord o
JOIN #APC_Caja k ON k.OReIdOrdenRetiro = o.OReIdOrdenRetiro
LEFT JOIN Clientes c  WITH (NOLOCK) ON c.CliIdCliente = o.CliIdCliente
LEFT JOIN Clientes cr WITH (NOLOCK) ON cr.CodCliente = k.CodCliente
LEFT JOIN TiposClientes tc ON tc.TClIdTipoCliente = COALESCE(c.TClIdTipoCliente, cr.TClIdTipoCliente);

/* ---- R6. Resumen por cliente (los que más deben sin documento, primero) ------------- */
SELECT 'R6. POR CLIENTE' AS Bloque, x.IDCliente, x.Cliente, x.TipoCliente,
       x.Retiros, x.RetirosEntregados, x.RetirosEnLocal, x.Ordenes,
       x.OrdSinDoc, x.SinDocUYU, x.SinDocUSD,
       CAST(x.SinDocUSD + x.SinDocUYU / NULLIF(@Cot, 0) AS DECIMAL(18, 2)) AS SinDocEquivUSD,
       x.OrdSinNada, x.SinNadaUYU, x.SinNadaUSD,
       x.OrdDocImpago, x.DocImpagoUYU, x.DocImpagoUSD,
       x.OrdResueltas,
       x.MayorOrdenUSD, x.MayorOrdenUYU,
       x.MasViejo, x.MasNuevo,
       (SELECT STRING_AGG(r.Retiro, ', ') WITHIN GROUP (ORDER BY r.OReIdOrdenRetiro)
          FROM (SELECT DISTINCT Retiro, OReIdOrdenRetiro FROM #APC_Cli WHERE ISNULL(CliIdCliente, -1) = ISNULL(x.CliIdCliente, -1)) r) AS ListaRetiros
FROM (
    SELECT CliIdCliente, IDCliente, Cliente, TipoCliente,
           COUNT(DISTINCT OReIdOrdenRetiro) AS Retiros,
           COUNT(DISTINCT CASE WHEN OReEstadoActual = 5 THEN OReIdOrdenRetiro END) AS RetirosEntregados,
           COUNT(DISTINCT CASE WHEN OReEstadoActual IN (1, 2, 3, 4, 7, 8) THEN OReIdOrdenRetiro END) AS RetirosEnLocal,
           COUNT(*) AS Ordenes,
           SUM(CASE WHEN Rango >= 8 THEN 1 ELSE 0 END) AS OrdSinDoc,
           SUM(CASE WHEN Rango >= 8 AND MonIdMoneda <> 2 THEN Costo ELSE 0 END) AS SinDocUYU,
           SUM(CASE WHEN Rango >= 8 AND MonIdMoneda = 2  THEN Costo ELSE 0 END) AS SinDocUSD,
           SUM(CASE WHEN Rango = 10 THEN 1 ELSE 0 END) AS OrdSinNada,
           SUM(CASE WHEN Rango = 10 AND MonIdMoneda <> 2 THEN Costo ELSE 0 END) AS SinNadaUYU,
           SUM(CASE WHEN Rango = 10 AND MonIdMoneda = 2  THEN Costo ELSE 0 END) AS SinNadaUSD,
           SUM(CASE WHEN Rango = 4 THEN 1 ELSE 0 END) AS OrdDocImpago,
           SUM(CASE WHEN Rango = 4 AND MonIdMoneda <> 2 THEN Costo ELSE 0 END) AS DocImpagoUYU,
           SUM(CASE WHEN Rango = 4 AND MonIdMoneda = 2  THEN Costo ELSE 0 END) AS DocImpagoUSD,
           SUM(CASE WHEN Rango IN (1, 2, 3, 5, 6, 7) THEN 1 ELSE 0 END) AS OrdResueltas,
           MAX(CASE WHEN MonIdMoneda = 2  THEN Costo END) AS MayorOrdenUSD,
           MAX(CASE WHEN MonIdMoneda <> 2 THEN Costo END) AS MayorOrdenUYU,
           MIN(OReFechaAlta) AS MasViejo, MAX(OReFechaAlta) AS MasNuevo
    FROM #APC_Cli
    GROUP BY CliIdCliente, IDCliente, Cliente, TipoCliente
) x
ORDER BY CAST(x.SinDocUSD + x.SinDocUYU / NULLIF(@Cot, 0) AS DECIMAL(18, 2)) DESC, x.Retiros DESC;

/* ---- R7. Órdenes sin documento (H/I/Z) por cliente, la más cara primero ------------- */
SELECT 'R7. ORDENES SIN DOC' AS Bloque, IDCliente, Cliente, Retiro,
       CASE OReEstadoActual WHEN 5 THEN 'Entregado' ELSE CAST(OReEstadoActual AS VARCHAR(5)) END AS EstadoRetiro,
       OReFechaAlta, OrdCodigoOrden,
       CASE WHEN MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS Moneda, Costo, Causa
FROM #APC_Cli
WHERE Rango >= 8
ORDER BY Cliente, CASE WHEN MonIdMoneda = 2 THEN Costo ELSE Costo / NULLIF(@Cot, 0) END DESC;

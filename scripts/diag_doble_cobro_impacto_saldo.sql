/* ============================================================================
   diag_doble_cobro_impacto_saldo.sql      SOLO LECTURA — no escribe nada
   ----------------------------------------------------------------------------
   Sigue a diag_doble_cobro_detalle.sql: una vez identificados los pares
   ORDEN/DOCUMENTO duplicados, este script mira qué pasó DESPUÉS con la
   cuenta de cada cliente afectado.

   Bloque 1 (RESUMEN): por cada cuenta con un caso de cobro doble, calcula el
   saldo con la MISMA fórmula que usa el cuadre nocturno (SUM(MovimientosCuenta)
   excluyendo ORDEN/ORDEN_ANTICIPO — esa es la verdad, no CueSaldoActual) y lo
   compara contra la deuda documentada viva. Así se ve, para cada caso, uno de
   tres escenarios:
     - SaldoLibro > 0 y ronda el importe duplicado  -> el sobrante quedó
       VISIBLE como saldo a favor en la cuenta. Se puede devolver o acreditar
       directamente: no se tocó nada más.
     - SaldoLibro cerca de 0 (o negativo)            -> el sobrante YA SE GASTÓ,
       probablemente cubrió otra orden/ciclo sin que nadie lo note. Hay que
       mirar el detalle (bloque 2) para encontrar en qué se fue.
     - VivaDoc > 0 a la vez                          -> la cuenta además tiene
       deuda documentada pendiente: ahí el saldo a favor puede estar
       compensando esa deuda en vez de ser plata suelta.

   Bloque 2 (DETALLE): todos los movimientos de esas cuentas, en orden
   cronológico, para reconstruir la película completa de cada cliente.
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @Top INT = 20;

IF OBJECT_ID('tempdb..#CuentasAfectadas') IS NOT NULL DROP TABLE #CuentasAfectadas;

;WITH OrdDoc AS (
    SELECT DISTINCT o.OrdIdOrden, o.DocIdDocumento, o.CueIdCuenta FROM dbo.MovimientosCuenta o WITH(NOLOCK)
    WHERE o.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND o.DocIdDocumento IS NOT NULL AND (o.MovAnulado IS NULL OR o.MovAnulado = 0)
), PagoOrden AS (
    SELECT p.OrdIdOrden, p.CueIdCuenta, Importe = SUM(p.MovImporte) FROM dbo.MovimientosCuenta p WITH(NOLOCK)
    WHERE p.MovTipo IN ('PAGO','PAGO_CRUZADO') AND p.MovImporte > 0 AND p.DocIdDocumento IS NULL AND p.OrdIdOrden IS NOT NULL
      AND (p.MovAnulado IS NULL OR p.MovAnulado = 0)
    GROUP BY p.OrdIdOrden, p.CueIdCuenta
), PagoDoc AS (
    SELECT d.DocIdDocumento, d.CueIdCuenta, Importe = SUM(d.MovImporte) FROM dbo.MovimientosCuenta d WITH(NOLOCK)
    WHERE d.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO') AND d.MovImporte > 0 AND d.DocIdDocumento IS NOT NULL
      AND (d.MovAnulado IS NULL OR d.MovAnulado = 0)
    GROUP BY d.DocIdDocumento, d.CueIdCuenta
)
SELECT TOP (ISNULL(@Top, 100000))
       od.CueIdCuenta, od.OrdIdOrden, od.DocIdDocumento,
       Doc = RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR),
       PagoOrdenImp = SUM(po.Importe), PagoDocImp = MAX(pd.Importe),
       -- proxy del monto realmente duplicado: el menor de los dos (el mayor puede incluir más cosas)
       Duplicado = CASE WHEN SUM(po.Importe) <= MAX(pd.Importe) THEN SUM(po.Importe) ELSE MAX(pd.Importe) END
INTO   #CuentasAfectadas
FROM OrdDoc od
JOIN PagoOrden po ON po.OrdIdOrden = od.OrdIdOrden AND po.CueIdCuenta = od.CueIdCuenta
JOIN PagoDoc  pd ON pd.DocIdDocumento = od.DocIdDocumento AND pd.CueIdCuenta = od.CueIdCuenta
JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = od.DocIdDocumento
WHERE RTRIM(dc.DocSerie) IN ('PC','ET','FA') AND ISNULL(dc.DocEstado,'') <> 'ANULADO'
GROUP BY od.CueIdCuenta, od.OrdIdOrden, od.DocIdDocumento, dc.DocSerie, dc.DocNumero
ORDER BY SUM(po.Importe) DESC;

-- ── Bloque 1: resumen por cuenta ────────────────────────────────────────────
SELECT
    ca.Doc, Cliente = RTRIM(c.Nombre), cc.CueIdCuenta,
    Cuenta = ISNULL(cc.CueNombre, 'principal'), cc.CueEsPrincipal, cc.CueRestringida,
    Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
    Duplicado    = CAST(ca.Duplicado AS DECIMAL(18,2)),
    SaldoLibro   = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                    WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)),
    Guardado     = CAST(cc.CueSaldoActual AS DECIMAL(18,2)),
    VivaDoc      = CAST(ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd WITH(NOLOCK)
                    WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DocIdDocumento IS NOT NULL
                      AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND dd.DDeImportePendiente > 0.01), 0) AS DECIMAL(18,2)),
    Diagnostico = CASE
        WHEN ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                      WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                        AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
             >= ca.Duplicado - 1
          THEN 'SOBRANTE VISIBLE: se puede devolver/acreditar directo'
        ELSE 'SOBRANTE YA CONSUMIDO: revisar el detalle para ver en qué orden se gastó'
      END
FROM #CuentasAfectadas ca
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = ca.CueIdCuenta
JOIN dbo.Clientes c        WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
ORDER BY ca.PagoOrdenImp DESC;

-- ── Bloque 2: detalle cronológico de movimientos de esas cuentas ───────────
SELECT
    Cliente = RTRIM(c.Nombre), cc.CueIdCuenta, Cuenta = ISNULL(cc.CueNombre,'principal'),
    m.MovFecha, Usuario = RTRIM(ISNULL(u.Usuario,'?')), m.MovTipo,
    Importe = CAST(m.MovImporte AS DECIMAL(18,2)),
    m.OrdIdOrden, m.DocIdDocumento,
    Concepto = LEFT(m.MovConcepto, 90),
    Anulado = ISNULL(m.MovAnulado, 0)
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.Clientes c        WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.Usuarios u   WITH(NOLOCK) ON u.IdUsuario = m.MovUsuarioAlta
WHERE m.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #CuentasAfectadas)
ORDER BY cc.CueIdCuenta, m.MovFecha;

DROP TABLE #CuentasAfectadas;

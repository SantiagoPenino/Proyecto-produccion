/* ============================================================================
   diag_estado_actual_comunes.sql          SOLO LECTURA — no escribe nada
   ----------------------------------------------------------------------------
   Punto de partida para seguir diagnosticando despues del arreglo del
   cobro doble: muestra el saldo REAL actual (no una simulacion) de todas
   las cuentas de los clientes que fueron tocados por
   "Correccion cobro doble billetera+caja", ordenados por el que tiene mas
   resto sin explicar primero.

   Como seguir con cada uno que no de 0,00 (o muy cerca):
     1. diag_conciliacion_completa_cliente.sql (@CliIdCliente = el que sea)
        -> documento por documento, para encontrar de donde sale el resto.
     2. Si aparece algo del mismo tipo que Iqui (ET-3523/NC-000012): decidir
        con el usuario si se ajusta o se investiga mas, NUNCA en lote.
   ============================================================================ */

SET NOCOUNT ON;

SELECT
    RTRIM(c.Nombre) AS Cliente, c.CliIdCliente, cc.CueIdCuenta,
    Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
    SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                  WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                    AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)),
    VivaDoc = CAST(ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd WITH(NOLOCK)
                  WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DocIdDocumento IS NOT NULL
                    AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND dd.DDeImportePendiente > 0.01), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueEsPrincipal = 1 AND cc.CueTipo LIKE 'DINERO%'
  AND cc.CliIdCliente IN (
      SELECT DISTINCT cc2.CliIdCliente FROM dbo.MovimientosCuenta m WITH(NOLOCK)
      JOIN dbo.CuentasCliente cc2 WITH(NOLOCK) ON cc2.CueIdCuenta = m.CueIdCuenta
      WHERE m.MovConcepto LIKE N'Correccion cobro doble billetera+caja%'
        AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  )
ORDER BY ABS(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
             WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
               AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) DESC;

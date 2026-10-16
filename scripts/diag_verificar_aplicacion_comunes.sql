/* ============================================================================
   diag_verificar_aplicacion_comunes.sql   SOLO LECTURA — no escribe nada
   ----------------------------------------------------------------------------
   Verifica que fix_cobro_doble_fantasma_comunes.sql (y/o
   fix_compensar_moneda_comunes.sql) se hayan aplicado bien, y que el bug de
   re-deteccion (corregido despues) no haya alcanzado a aplicar una misma
   correccion dos veces sobre la misma orden.

   Bloque 1: cuantas correcciones y compensaciones hay en total, y desde
             cuando (para saber si ya se corrio el lote).
   Bloque 2: CUALQUIER orden con MAS DE UNA correccion "Correccion cobro
             doble billetera+caja" -> si aparece algo aca, es el bug de
             re-deteccion en accion, hay que revisarlo antes de seguir.
   Bloque 3: estado actual puntual de Iqui ferreri (el caso que ya
             conocemos), para chequear a ojo.
   ============================================================================ */

SET NOCOUNT ON;

SELECT 'Bloque 1: resumen de lo aplicado' AS etapa;
SELECT MovTipo, Cantidad = COUNT(*), PrimerMov = MIN(MovFecha), UltimoMov = MAX(MovFecha),
       Total = CAST(SUM(MovImporte) AS DECIMAL(18,2))
FROM dbo.MovimientosCuenta WITH(NOLOCK)
WHERE MovConcepto LIKE N'Correccion cobro doble billetera+caja%'
   OR MovConcepto LIKE N'Compensacion entre monedas del mismo cliente%'
GROUP BY MovTipo
ORDER BY MovTipo;

SELECT 'Bloque 2: ordenes con la correccion aplicada MAS DE UNA VEZ (bug si aparece algo)' AS etapa;
SELECT m.OrdIdOrden, Veces = COUNT(*), Total = CAST(SUM(m.MovImporte) AS DECIMAL(18,2)),
       Cuentas = STRING_AGG(CAST(m.CueIdCuenta AS VARCHAR), ', ')
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
WHERE m.MovConcepto LIKE N'Correccion cobro doble billetera+caja - orden%'
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
GROUP BY m.OrdIdOrden
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

SELECT 'Bloque 3: estado actual de Iqui ferreri' AS etapa;
SELECT cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente, Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CliIdCliente = 795 AND cc.CueEsPrincipal = 1 AND cc.CueTipo LIKE 'DINERO%';

SELECT 'Bloque 4: movimientos de correccion/compensacion de Iqui, en orden' AS etapa;
SELECT m.MovFecha, m.CueIdCuenta, m.MovTipo, Importe = CAST(m.MovImporte AS DECIMAL(18,2)), m.MovConcepto
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = 795
  AND (m.MovConcepto LIKE N'Correccion cobro doble%' OR m.MovConcepto LIKE N'Compensacion entre monedas%' OR m.MovConcepto LIKE N'Cliente Comun sin saldo%')
ORDER BY m.MovFecha;

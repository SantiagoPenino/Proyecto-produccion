/* ============================================================================
   diag_saldo_cliente_puntual.sql          SOLO LECTURA — no escribe nada
   ----------------------------------------------------------------------------
   Foto completa de UN cliente: todas sus cuentas (todas las monedas, todas
   las secundarias) con el mismo modelo del cuadre nocturno, más el historial
   completo de movimientos para reconstruir de dónde salió un saldo a favor
   que no debería estar (caso típico: cliente Común/Deudor que el modelo dice
   que tiene que estar en CERO y no lo está).

   EDITAR @Busca antes de correr: nombre (o parte del nombre) o CodCliente.
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @Busca NVARCHAR(100) = N'Iqui ferreri';   -- <<< cambiar acá

IF OBJECT_ID('tempdb..#Cli') IS NOT NULL DROP TABLE #Cli;
SELECT CliIdCliente, Nombre = RTRIM(Nombre), Tipo = CASE TClIdTipoCliente
         WHEN 1 THEN 'Comun' WHEN 2 THEN 'Semanal' WHEN 3 THEN 'Rollo' WHEN 4 THEN 'Deudor' ELSE 'sin tipo' END
INTO   #Cli
FROM   dbo.Clientes
WHERE  Nombre LIKE '%' + @Busca + '%'
   OR (ISNUMERIC(@Busca) = 1 AND CodCliente = TRY_CAST(@Busca AS INT))
   OR RTRIM(IDCliente) = @Busca;

SELECT * FROM #Cli;   -- por si el nombre matchea más de uno, revisar antes de seguir

-- ── Todas las cuentas del/los cliente(s), con el mismo modelo del cuadre ───
SELECT
    cl.Nombre, cl.Tipo, cc.CueIdCuenta, Cuenta = ISNULL(cc.CueNombre,'principal'),
    cc.CueEsPrincipal, cc.CueRestringida, cc.CueActiva,
    Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
    SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                  WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                    AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)),
    Guardado = CAST(cc.CueSaldoActual AS DECIMAL(18,2)),
    VivaDoc  = CAST(ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd WITH(NOLOCK)
                  WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DocIdDocumento IS NOT NULL
                    AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND dd.DDeImportePendiente > 0.01), 0) AS DECIMAL(18,2)),
    Esperado = CASE WHEN cl.Tipo IN ('Comun','Deudor') THEN 'CERO' ELSE 'puede deber = VivaDoc' END
FROM #Cli cl
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CliIdCliente = cl.CliIdCliente
WHERE cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.CueIdCuenta;

-- ── Historial completo de movimientos, todas las cuentas, en orden ─────────
SELECT
    cl.Nombre, cc.CueIdCuenta, Cuenta = ISNULL(cc.CueNombre,'principal'),
    Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
    m.MovFecha, Usuario = RTRIM(ISNULL(u.Usuario,'?')), m.MovTipo,
    Importe = CAST(m.MovImporte AS DECIMAL(18,2)),
    m.OrdIdOrden, m.DocIdDocumento,
    Concepto = LEFT(m.MovConcepto, 100),
    Anulado = ISNULL(m.MovAnulado, 0)
FROM #Cli cl
JOIN dbo.CuentasCliente cc     WITH(NOLOCK) ON cc.CliIdCliente = cl.CliIdCliente AND cc.CueTipo LIKE 'DINERO%'
JOIN dbo.MovimientosCuenta m   WITH(NOLOCK) ON m.CueIdCuenta = cc.CueIdCuenta
LEFT JOIN dbo.Usuarios u       WITH(NOLOCK) ON u.IdUsuario = m.MovUsuarioAlta
ORDER BY cc.CueIdCuenta, m.MovFecha;

DROP TABLE #Cli;
